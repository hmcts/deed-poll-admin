/**
 * View models for the Email tab and the compose form: what has been sent, what may be sent now, and the fields
 * a caseworker fills to send one.
 *
 * Here rather than in the pages for the reason `../referrals/referrals-view.ts` gives — a template cannot format
 * a timestamp without a bespoke Nunjucks environment, and a view model can be tested directly — plus one this
 * surface adds: **the tab and the compose form read the same payload**, so a template resolved as sendable on one
 * and not the other would offer a button leading to a 404. Both go through `sendableTemplates` below.
 *
 * **The state wording is a rule, not a preference** — decision 10 of
 * `docs/plans/notify-2-caseworker-email-tab.md`. api knows that Notify *accepted* an email and nothing more:
 * there are no delivery callbacks in this estate and no open or download concept anywhere in the Notify client,
 * so no label built here may read as proof that the applicant received or read anything. A caseworker who
 * concluded from this screen that an applicant has their deed poll, when the email bounced, is the failure the
 * tab exists to prevent.
 *
 * **Nothing here decides whether an email may be sent.** api publishes `applicable` with the sentence saying why
 * not, and `provisioned` separately; a local rule about refusals and referral states would be a second authority
 * on somebody else's decision and would go stale the moment a judge re-decided the referral. What is decided here
 * is only which of api's two flags withholds the button and what the page says instead.
 */
import type { CaseEmails, EmailHistory, EmailSlot, EmailType, NotifyState } from "@hmcts/deed-poll-api-client";
import { formatTimestamp, NOT_RECORDED } from "../deed-poll/case-header.js";
import { emailSlotLabel } from "./slot-validation.js";

/**
 * What a caseworker reads in the state column, in the words the service can stand behind.
 *
 * **`Sent` is deliberately not the word "Sent" on its own.** api's own schema description says it means "accepted
 * by GOV.UK Notify; it does not mean delivered", and the tab has to say something a caseworker cannot misread as
 * receipt. `Pending` is the row that has not left yet and `Failed` is the one that needs a phone call — the
 * difference between the three is the whole reason the column exists.
 *
 * Do not add "Delivered", "Viewed", "Opened" or "Downloaded" here. None of them is a fact this service holds, and
 * the tab's test asserts their absence so a later well-meaning wording change fails rather than shipping.
 */
export const NOTIFY_STATE_LABEL: Record<NotifyState, string> = {
  Pending: "Waiting to send",
  Sent: "Accepted by Notify",
  Failed: "Failed"
};

/**
 * Tag colour per state, so the outbox is scannable.
 *
 * Blue for an email still on its way, green for one Notify has taken, red for one that never left. Colour is
 * never the only carrier — the tag prints its state.
 */
export const NOTIFY_STATE_TAG: Record<NotifyState, string> = {
  Pending: "govuk-tag--blue",
  Sent: "govuk-tag--green",
  Failed: "govuk-tag--red"
};

/**
 * The business's wording for the template keys api ships. Unknown keys are humanised — see `emailTemplateLabel`.
 *
 * **These must match api's `templateName` for the same key, because both appear in the same panel.** The history
 * table renders api's `templateName` (`orLabel` prefers it) while the Send button renders this map, since the
 * availability list publishes no name. This said "Application refused" against api's "Application rejected", so one
 * template was called two things a few lines apart on one screen — and `orLabel`'s own docblock claimed the map
 * existed to stop exactly that.
 *
 * Aligned to api rather than the other way round: api's value is already on the caseworker's screen in every
 * history row, so changing this one is the smaller change and leaves a single source. **Whether "rejected" or
 * "refused" is the right word is a copy question for the business** — api's `EmailTemplate` javadoc calls the
 * template "Enrolment refused" while its `displayName` says "Application rejected", so the inconsistency exists
 * upstream too. If the answer is "refused", it changes in api's `displayName` and follows here.
 */
const EMAIL_TEMPLATE_LABEL: Record<string, string> = {
  "application-rejected": "Application rejected"
};

/** Why an applicable template still cannot be sent: api has the key but this environment has no Notify template. */
const NOT_PROVISIONED = "This email cannot be sent in this environment yet, because its template has not been set up in GOV.UK Notify";

/** api published a template with neither `applicable` nor a reason — a shape its schema permits and nobody expects. */
const NO_REASON_GIVEN = "This email cannot be sent for this case at the moment";

/**
 * Why an email has no wording to show, per state — decision 15, and the three are not the same thing.
 *
 * A `Pending` row has not gone yet, a `Failed` one never went, and a `Sent` one with nothing stored was sent
 * before api began capturing the text and never will have any: api refuses to fetch it back from Notify, which
 * is notify-5's own constraint on backfill. "Sent before we started keeping the text" is a different
 * reassurance from "this has not gone yet", so each gets its own sentence and none of them is a blank panel —
 * which is what a caseworker reads as a fault.
 */
const NO_BODY: Record<NotifyState, string> = {
  Pending: "This email has not been sent yet, so there is no wording to show.",
  Failed: "This email was not sent, so there is no wording to show.",
  Sent: "This email was sent before the service began keeping the wording, so no copy of it was stored here and none can be recovered."
};

/**
 * No wording and no state either, which is a claim about the read rather than about the email.
 *
 * `notifyState` is nullable on the wire, so this is reachable, and none of `NO_BODY`'s three sentences may be
 * borrowed for it — each asserts a history this row does not have.
 */
const NO_BODY_NO_STATE = "No wording was recorded for this email.";

/**
 * An attachment api published with no name, which its schema permits.
 *
 * Named rather than dropped, because a document the applicant received and this page does not list is the one
 * omission a caseworker cannot see — where a row saying only that something was attached is at least true.
 */
const UNNAMED_DOCUMENT = "Unnamed document";

/**
 * The tab: every email this case has had, and which ones may be sent now.
 *
 * **api's order is kept.** Its history answers newest first, which is the order correspondence is read in, and a
 * second sort here would be this repo deciding something api has already decided.
 *
 * **`sendable` is a list even though api ships one template**, and that is the design intent rather than
 * speculation: the tab renders what api says is sendable, so a template arriving with notify-3, notify-4 or
 * notify-6 appears with no change here. Decision 2 as amended removed the "which email?" picker because a radio
 * list of one option reads as an unfinished feature — if more than one is ever applicable, that is the trigger to
 * build one, and the list is what makes the trigger visible.
 *
 * **`unsendable` carries api's sentence, because a missing button is otherwise indistinguishable from a bug.** An
 * applicant with no email address and a case no Master has refused are the common cases, and the caseworker is
 * owed the reason rather than a screen with nothing on it.
 */
export function buildEmailsView(emails: CaseEmails): EmailsView {
  const rows = emails.history.map(buildEmailRow);
  // The two lists are one partition of api's availability, so they are taken from the same set: a template
  // missing from both would be one the tab neither offers nor explains, which is the state a caseworker cannot
  // distinguish from a bug.
  const sendable = new Set(sendableTemplates(emails));

  return {
    rows,
    count: rows.length,
    unavailable: false,
    sendable: [...sendable].map((type) => ({ template: type.template ?? "", name: emailTemplateLabel(type.template) })),
    unsendable: emails.availability.filter((type) => !sendable.has(type)).map(buildUnsendable)
  };
}

/**
 * The tab when the emails read failed, so the panel degrades rather than the page.
 *
 * **`unavailable` is a third state and deliberately not `count: 0` with no button.** The two say opposite things:
 * "nothing has been sent to this applicant" is a fact, and "we could not find out" is the absence of one — and
 * rendering the second as the first would tell a caseworker an applicant has never been written to on a page that
 * otherwise looks normal. Nothing is corrupted either way, but the caseworker would have been misinformed by the
 * page rather than told by it. Same argument as `../referrals/referrals-view.ts`'s `unavailableReferralsView`.
 *
 * No `sendable` and no `unsendable`, for the reason that view gives too: the compose page reads the same endpoint,
 * so a button would lead to a page that cannot load either.
 */
export function unavailableEmailsView(): EmailsView {
  return { rows: [], count: 0, unavailable: true, sendable: [], unsendable: [] };
}

/**
 * The compose form for one template: its slots, in api's order, each with the value the caseworker will see.
 *
 * `null` when the template is not one this case may send — an unknown key, a template api says is not applicable,
 * or one this environment has not provisioned. **The caller answers 404 to all three**, because the template is a
 * route parameter and therefore user input; distinguishing them would tell somebody probing which keys exist.
 *
 * `submitted` is the body of a failed attempt, and a slot present in it wins over api's default **untrimmed and
 * unaltered**: a caseworker who has just been told their text is too long must get their own words back to shorten,
 * not the pre-populated ones they replaced. A slot absent from it falls back to `slotDefaults`, which is how the
 * judge's direction reaches the form without spending a Notify call on a preview (decision 8).
 */
export function buildComposeView(emails: CaseEmails, template: string, submitted: Record<string, unknown> = {}): EmailComposeView | null {
  const type = sendableTemplates(emails).find((candidate) => candidate.template === template);
  if (!type) return null;

  const defaults = emails.slotDefaults.find((candidate) => candidate.template === template)?.fields ?? {};

  return {
    template,
    name: emailTemplateLabel(template),
    fields: type.slots.filter(hasName).map((slot) => buildComposeField(slot, submitted, defaults))
  };
}

/**
 * One email's own page: what it said, who it went to, what became of it, and what it carried.
 *
 * **Read out of the payload the tab already fetched, not from a call of its own.** api answers the whole tab —
 * availability, history and slot defaults — in one response (decision 8), so the content page reads its row from
 * the same `history` the table rendered. There is no per-notification endpoint and nothing here needs one.
 *
 * `null` for an id that is not in this case's history, which the caller answers 404 to: the id is a route
 * parameter and therefore user input, and api's scoping is what makes another case's email absent from this
 * payload rather than a filter written here.
 *
 * **`body` is plain text and stays that way.** `EmailHistoryResponse.body` is the text rendering of the template
 * api captured from Notify's send acceptance, so it goes through Nunjucks autoescaping — never `| safe` and never
 * the preview's `srcdoc` iframe, which is a different field of a different shape (decision 12). Notify's body is
 * Markdown-flavoured, so bullets arrive as `*`; they are rendered as they are rather than passed through a
 * Markdown renderer, which would put caseworker free text back through exactly the escaping problem the iframe
 * exists to avoid.
 *
 * **`body` and `missingBody` are alternatives and exactly one of them is set.** A body that is only whitespace
 * counts as absent, because a panel with nothing visible in it reads as a fault rather than as an explanation.
 */
export function buildEmailDetail(emails: CaseEmails, notificationId: string): EmailDetailView | null {
  const email = emails.history.find((candidate) => candidate.id === notificationId);
  if (!email) return null;

  // Untrimmed for the render — the text is the email's own layout, and its leading blank line is part of it —
  // but trimmed to decide whether there is anything to render at all.
  const body = typeof email.body === "string" ? email.body : "";
  const hasBody = body.trim().length > 0;
  let missingBody: string | null = null;
  if (!hasBody) {
    missingBody = email.notifyState ? NO_BODY[email.notifyState] : NO_BODY_NO_STATE;
  }

  return {
    id: email.id,
    template: orLabel(email.templateName, email.template),
    subject: orPlaceholder(email.subject, NOT_RECORDED),
    recipient: orPlaceholder(email.recipient, NOT_RECORDED),
    state: email.notifyState ? NOTIFY_STATE_LABEL[email.notifyState] : NOT_RECORDED,
    stateTagClasses: email.notifyState ? NOTIFY_STATE_TAG[email.notifyState] : "govuk-tag--grey",
    sentOn: formatTimestamp(email.createdOn),
    sentBy: orPlaceholder(email.createdBy, NOT_RECORDED),
    // api's own prose, and the field that makes a failure actionable — a caseworker reading "the recipient
    // address was rejected" knows to ring the applicant, where "Failed" alone tells them only to worry.
    failureReason: typeof email.failureReason === "string" && email.failureReason.trim().length > 0 ? email.failureReason : null,
    body: hasBody ? body : null,
    missingBody,
    // Empty for every email today: the one shipped template carries no attachments, and notify-4 is blocked on
    // document generation. Rendered anyway, so the first email that does carry one needs no change here.
    documents: email.documents.map((document) => ({ id: document.id, name: orPlaceholder(document.name, UNNAMED_DOCUMENT) }))
  };
}

/**
 * One email type in the business's words, or the key humanised.
 *
 * **An unrecognised template renders rather than disappearing.** `EmailTypeResponse.template` is a bare string with
 * no member list, so `contract.test.ts` cannot pin the set and a template api adds arrives here with nothing
 * failing — which is the intent. A row or a button labelled "Chase missing documents" from the key beats one
 * labelled "Not recorded", and `Object.hasOwn` keeps an inherited member name off the page as a label.
 */
export function emailTemplateLabel(key: string | null | undefined): string {
  if (key === null || key === undefined || key === "") return NOT_RECORDED;

  return Object.hasOwn(EMAIL_TEMPLATE_LABEL, key) ? EMAIL_TEMPLATE_LABEL[key] : humaniseKey(key);
}

/**
 * The templates this case may actually send, which is **both** of api's flags and not just `applicable`.
 *
 * `provisioned` is the separate question of whether this environment has a real Notify template behind the key,
 * and it is false everywhere until notify-0 runs. Offering the button without it sends the caseworker to a preview
 * that answers api's 502 — an `unavailable` and therefore the 500 page — for a reason the tab already knew and
 * could have said in a sentence.
 */
function sendableTemplates(emails: CaseEmails): EmailType[] {
  return emails.availability.filter((type) => type.applicable && type.provisioned && typeof type.template === "string" && type.template !== "");
}

/**
 * One row of the outbox, every cell already a display string.
 *
 * `templateName` first, because it is api's own label for the row's stored template member and survives a key
 * being re-pointed; the local map is the fallback so the words on the tab match the words on the button, which are
 * built from the availability list where no `templateName` is published.
 *
 * An absent `notifyState` is "Not recorded" and a grey tag, which is a claim about the read rather than about the
 * email — the alternative is inventing one of three states that mean very different things to a caseworker.
 */
function buildEmailRow(email: EmailHistory): EmailRow {
  return {
    id: email.id,
    template: orLabel(email.templateName, email.template),
    state: email.notifyState ? NOTIFY_STATE_LABEL[email.notifyState] : NOT_RECORDED,
    stateTagClasses: email.notifyState ? NOTIFY_STATE_TAG[email.notifyState] : "govuk-tag--grey",
    sentOn: formatTimestamp(email.createdOn),
    sentBy: orPlaceholder(email.createdBy, NOT_RECORDED)
  };
}

/**
 * One template that cannot be sent, with the sentence saying why.
 *
 * api's `reason` when it published one — it is prose written for a caseworker rather than a code to branch on, so
 * it is rendered unaltered. The provisioning sentence is this repo's, because api answers `reason: null` for a
 * template that *is* applicable and simply has no Notify template behind it.
 */
function buildUnsendable(type: EmailType): UnsendableEmailView {
  return {
    template: type.template ?? "",
    name: emailTemplateLabel(type.template),
    // **`provisioned === false`, not `applicable` alone.** `sendableTemplates` requires three things — applicable,
    // provisioned, and a usable template key — so a row can land here while being both applicable and provisioned,
    // by having a null or empty `template`. Branching on `applicable` then stated the provisioning sentence about a
    // row that *is* provisioned: a claim that is simply false, and unfalsifiable by the caseworker reading it. The
    // sentence now appears only when provisioning is genuinely what is missing; anything else falls to api's own
    // `reason` or, failing that, the generic one that claims nothing about a cause.
    reason: type.applicable && type.provisioned === false ? NOT_PROVISIONED : orPlaceholder(type.reason, NO_REASON_GIVEN)
  };
}

/** One slot as a form control: api's name and rules, this repo's label, and the text to render in it. */
function buildComposeField(slot: NamedEmailSlot, submitted: Record<string, unknown>, defaults: Record<string, string>): EmailComposeField {
  const typed = submitted[slot.name];

  return {
    // api's `snake_case` placeholder name, unrenamed: it is the control's name, the body's key and the field
    // api's own 400 addresses its errors to, so a camelCase version here would break all three at once.
    name: slot.name,
    label: emailSlotLabel(slot.name),
    maxLength: slot.maxLength,
    required: slot.required,
    value: typeof typed === "string" ? typed : (defaults[slot.name] ?? "")
  };
}

/** A slot api published with a usable name. One without has no control to render and nothing to send it under. */
function hasName(slot: EmailSlot): slot is NamedEmailSlot {
  return typeof slot.name === "string" && slot.name !== "";
}

/** api's own label for a template, else the local wording for its key. */
function orLabel(templateName: string | null | undefined, template: string | null | undefined): string {
  const name = typeof templateName === "string" ? templateName.trim() : "";

  return name.length > 0 ? name : emailTemplateLabel(template);
}

/** `chase-missing-documents` → "Chase missing documents". For a key with no entry in the label map. */
function humaniseKey(key: string): string {
  const words = key
    .split("-")
    .filter((word) => word.length > 0)
    .join(" ");

  return words.length > 0 ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

/**
 * A stored value, or the placeholder for one that is not there — trimmed first, so a value that is only
 * whitespace reads as absent rather than as a blank cell.
 *
 * A private copy of `../referrals/referrals-view.ts`'s helper for the reason `../judicial/view.ts` keeps its own:
 * it is three lines of formatting with no rule in it, and `orPlaceholder` on this package's flat public surface
 * would say nothing about the domain it belongs to.
 */
function orPlaceholder(raw: string | null | undefined, placeholder: string): string {
  const value = typeof raw === "string" ? raw.trim() : "";

  return value.length > 0 ? value : placeholder;
}

/** One email this case has had, as the tab's table renders it. No content — that is the per-email page's. */
export interface EmailRow {
  /** The outbox row's id, which is the only key the per-email page takes. */
  id: string;
  template: string;
  /** Notify's acceptance, never its delivery. See `NOTIFY_STATE_LABEL`. */
  state: string;
  stateTagClasses: string;
  sentOn: string;
  /** The caseworker api stamped on the row from their own token. */
  sentBy: string;
}

/** One attachment an email carried, as its own page lists it. */
export interface EmailDocumentView {
  id: string;
  name: string;
}

/** One email's content and its fate, as the per-email page renders it. Every field is already a display string. */
export interface EmailDetailView {
  id: string;
  template: string;
  subject: string;
  /** The address api froze into the outbox row, which is not necessarily the case's address today. */
  recipient: string;
  /** Notify's acceptance, never its delivery. See `NOTIFY_STATE_LABEL`. */
  state: string;
  stateTagClasses: string;
  sentOn: string;
  sentBy: string;
  /** api's prose on a failure, where it published any. `null` is the absence of one, not a success. */
  failureReason: string | null;
  /**
   * The wording that was sent, as plain text. **Rendered through autoescaping with newlines preserved in CSS** —
   * decision 12. `null` when there is none, and `missingBody` then says which of the reasons it is.
   */
  body: string | null;
  /** The sentence explaining an absent body. `null` exactly when `body` is set, and never both. */
  missingBody: string | null;
  /** Empty for every email today — the one shipped template has no attachments. */
  documents: EmailDocumentView[];
}

/** One email type the caseworker may send now, and where the button goes. */
export interface SendableEmailView {
  /** api's template key — the route parameter the compose page takes. */
  template: string;
  name: string;
}

/** One email type that cannot be sent, and the sentence the tab shows instead of a button. */
export interface UnsendableEmailView {
  template: string;
  name: string;
  /** api's prose where it gave one, unaltered. */
  reason: string;
}

/** A case's correspondence, as the detail page's Email tab renders it. */
export interface EmailsView {
  /** Newest first, as api answered them. */
  rows: EmailRow[];
  /** Row count, shown as a caption. Meaningless when `unavailable` — nothing was read. */
  count: number;
  /**
   * The read failed, so no field here is a claim about the case. The panel says so rather than rendering an
   * empty table — see `unavailableEmailsView` for why the two cannot share a state.
   */
  unavailable: boolean;
  /** Every type that may be sent now. One button each; api ships one template today. */
  sendable: SendableEmailView[];
  /** Every type that may not, with its reason, so an absent button is explained rather than mysterious. */
  unsendable: UnsendableEmailView[];
}

/** One slot as the compose form renders it. `name` is api's `snake_case` placeholder name and stays that way. */
export interface EmailComposeField {
  name: string;
  label: string;
  /** api's cap, enforced locally by `validateEmailSlots` and again by api. */
  maxLength: number;
  required: boolean;
  /** The caseworker's own text where they have typed any, else api's pre-populated default. */
  value: string;
}

/** The compose form for one template. */
export interface EmailComposeView {
  /** api's template key, for the form's action. */
  template: string;
  name: string;
  /** In api's published order, which is the order the email reads. */
  fields: EmailComposeField[];
}

/** A slot api published a name for, narrowed so `buildComposeField` needs no second check. */
type NamedEmailSlot = EmailSlot & { name: string };
