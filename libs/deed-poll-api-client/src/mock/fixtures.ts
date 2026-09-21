/**
 * The three behaviours the mock can be put into, as data.
 *
 * `deed-poll-api` is not deployed, so every local run and every test of this app talks to the mock. What
 * matters is that the awkward paths are as easy to reach as the happy one: a build that has only ever
 * been driven through a working api has never rendered its "try again shortly" page.
 *
 * Scenarios are switched over HTTP (`POST /__mock/scenario`) rather than by restarting with a different
 * environment variable, so one Playwright run can walk the happy path and then a failure path without a
 * second server.
 *
 * Three, not five: this app has no payment and no submit, so the only axes that matter are "is api
 * there" and "does api refuse a write". `deed-poll-web`'s client has five for the journey it serves.
 */
import type { WireDocumentType, WireEmailHistory } from "../api/wire.js";

export const MOCK_SCENARIOS = {
  "happy-path": { caseWrite: "accept", reachable: true },
  /**
   * Every case write comes back 400 with a field error, whatever it contains.
   *
   * The point is not to model a rule — the mock enforces api's real refusals anyway — but to prove the
   * pages put api's complaint onto the right input's error summary rather than showing a banner.
   */
  "write-rejection": { caseWrite: "reject", reachable: true },
  /** Every contract route answers 503, leaving only the `__mock` control routes and the health paths. */
  "api-unavailable": { caseWrite: "accept", reachable: false }
} as const satisfies Record<string, MockFixture>;

export const DEFAULT_SCENARIO: MockScenario = "happy-path";

/** What `write-rejection` answers a case create or patch with. */
export const MOCK_WRITE_REJECTION = {
  error: "Case could not be saved",
  errors: [{ field: "newForename", message: "Enter the new forename" }]
} as const;

/**
 * The document types the mock serves.
 *
 * Fixed ids, because a page under test has to be able to select one, and fixed applicability lists so the
 * upload form has something to filter by. The integers are Dynamics option-set values — 1-4 for marital
 * status, 1-6 for case type — matching what api publishes.
 */
export const MOCK_DOCUMENT_TYPES: readonly WireDocumentType[] = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Birth certificate", applicableMaritalStatuses: [1, 2, 3, 4], applicableTypes: [1, 2, 3, 4, 5, 6] },
  { id: "22222222-2222-4222-8222-222222222222", name: "Marriage certificate", applicableMaritalStatuses: [2, 3, 4], applicableTypes: [1, 2] },
  { id: "33333333-3333-4333-8333-333333333333", name: "Passport", applicableMaritalStatuses: [1, 2, 3, 4], applicableTypes: [1, 2, 3, 4, 5, 6] }
];

/**
 * api's `EmailTemplate.APPLICATION_REJECTED` member NAME, which is what an outbox row's `template` column holds.
 *
 * Not the same string as the key — see `MOCK_EMAIL_TEMPLATES`. Named here because the seeded history rows below
 * store the column, not the key.
 */
export const APPLICATION_REJECTED = "APPLICATION_REJECTED";

/**
 * The email types the mock serves, restating api's `EmailTemplate` enum as data.
 *
 * One member, because api ships one: the other three in `NOTIFY_TEMPLATE_TAXONOMY.md` §6 are notify-3 and
 * notify-4. Here for the reason `MOCK_DOCUMENT_TYPES` is here — it is reference data api owns and the mock has
 * to serve, and a page under test has to be able to name one.
 *
 * **`key` and `member` are two spellings of one template and both are on the wire.** The key is the URL token
 * and what `EmailTypeResponse.template` and `EmailHistoryResponse.template` publish; the member name is what the
 * outbox row stores, because a Notify template UUID differs per environment and a row holding one would stop
 * being readable the moment a template was re-pointed. Conflating them makes the history unreadable.
 *
 * `slots` and `resolvedKeys` together are the template's whole personalisation, and the split is the rule the
 * mock has to enforce: the slots are the caseworker's to fill and the resolved keys are api's to compute, so a
 * body naming one of the latter is refused and told which it was. A caseworker who could set `reference_number`
 * could tell an applicant a reference that is not theirs.
 */
export const MOCK_EMAIL_TEMPLATES: readonly MockEmailTemplate[] = [
  {
    key: "application-rejected",
    member: APPLICATION_REJECTED,
    displayName: "Application rejected",
    /** `CaseEmailService.NO_REFUSAL`, verbatim: prose for a caseworker rather than a code to branch on. */
    notApplicable: "This case has no referral that a Master has refused, so there is no refusal to tell the applicant about",
    /**
     * The caps are api's `EmailSlot` caps, which are the referral direction's and the referral notes' — so a
     * direction a judge could record is always sendable unedited.
     */
    slots: [
      { name: "judges_reason", required: true, maxLength: 4000 },
      { name: "additional_notes", required: false, maxLength: 1000 }
    ],
    /** `ApplicationRejectedPersonalisation.RESOLVED_KEYS`. */
    resolvedKeys: ["reference_number", "online_application_reference", "old_forename", "old_surname", "applied_online"]
  }
];

/**
 * One case's correspondence history, in the four states a caseworker can be shown one.
 *
 * Seeded rather than sent, because three of the four are unreachable through the contract: a send drains
 * immediately here, so driving the mock only through `POST …/emails/{template}` would produce nothing but
 * `Sent` rows carrying content — and the three sentences decision 15 of
 * `docs/plans/notify-2-caseworker-email-tab.md` requires would have nothing to render against.
 *
 * **The four are not variations on one row; they are four different things to say.** A `Pending` email has not
 * gone yet, a `Failed` one never did and needs a phone call, and a `Sent` one with no stored text was sent
 * before api began keeping it and never will have any — which is a different reassurance from "this has not
 * gone yet". `notifyState` alone does not distinguish the last two, which is why there are two `Sent` rows.
 *
 * A referral id each, because one email per referral is a unique index at api's end: four rows sharing one
 * would be a history the contract cannot produce.
 *
 * Newest first is the order the MOCK applies rather than the order of this array — `createdOn` decides it, so a
 * row added here in the wrong place still reaches a page in the right one.
 */
export const MOCK_EMAIL_HISTORY: readonly MockNotification[] = [
  {
    id: "e1111111-1111-4111-8111-111111111111",
    referralId: "f1111111-1111-4111-8111-111111111111",
    template: APPLICATION_REJECTED,
    recipient: "applicant@example.com",
    state: "Sent",
    failureReason: null,
    subject: "Your application to enrol a deed poll has been refused",
    // Several paragraphs, because a body is not a table cell — decision 14 puts it on a page of its own for
    // this reason. Markdown-flavoured as Notify's text rendering is, so the bullet arrives as an asterisk.
    body: [
      "Dear applicant,",
      "Regarding your application to change your name from Sam Smith (reference KBDP2026-00042).",
      "The Master has refused your application for the following reason:",
      "The evidence supplied does not establish the applicant's identity.",
      "We will refund your fee. To arrange this we need:",
      "* the name of the account you paid from",
      "* the address to send a cheque to",
      "Kind regards,"
    ].join("\n\n"),
    createdOn: new Date("2026-03-18T11:05:00"),
    createdBy: "caseworker@example.com"
  },
  {
    id: "e2222222-2222-4222-8222-222222222222",
    referralId: "f2222222-2222-4222-8222-222222222222",
    template: APPLICATION_REJECTED,
    recipient: "applicant@example.com",
    state: "Sent",
    failureReason: null,
    // Both null, and permanently so: api refuses to fetch a sent email's wording back out of Notify, so
    // anything sent before it began capturing the rendering has none and never will — notify-5's constraint on
    // backfill. A page must say that rather than render a blank panel.
    subject: null,
    body: null,
    createdOn: new Date("2026-01-09T09:30:00"),
    createdBy: "caseworker@example.com"
  },
  {
    id: "e3333333-3333-4333-8333-333333333333",
    referralId: "f3333333-3333-4333-8333-333333333333",
    template: APPLICATION_REJECTED,
    recipient: "applicant@example.com",
    // Enqueued and not yet drained. No content, because there is no rendering until Notify accepts the send —
    // and no `failureReason` either, since nothing has been attempted.
    state: "Pending",
    failureReason: null,
    subject: null,
    body: null,
    createdOn: new Date("2026-03-20T16:45:00"),
    createdBy: "caseworker@example.com"
  },
  {
    id: "e4444444-4444-4444-8444-444444444444",
    referralId: "f4444444-4444-4444-8444-444444444444",
    template: APPLICATION_REJECTED,
    recipient: "wrong-address@example.com",
    // The one row a caseworker has to act on, which is why `failureReason` is what makes it actionable: the
    // applicant was never told, and only a person can decide to ring them.
    state: "Failed",
    failureReason: "GOV.UK Notify rejected the recipient address (PERMANENT, status 400)",
    subject: null,
    body: null,
    createdOn: new Date("2026-02-27T14:20:00"),
    createdBy: "caseworker@example.com"
  }
];

// `Object.hasOwn`, not `in`: `in` walks the prototype chain, so "toString" and "constructor" would pass
// as scenarios. The lookups that follow then yield `undefined`, whose falsy `reachable` makes the mock
// answer 503 to every contract route for the rest of the process instead of rejecting the typo.
export function isMockScenario(value: unknown): value is MockScenario {
  return typeof value === "string" && Object.hasOwn(MOCK_SCENARIOS, value);
}

/** One email type as the mock holds it — api's `EmailTemplate` member, flattened. */
export interface MockEmailTemplate {
  /** The URL token and the key every response publishes. */
  key: string;
  /** The enum member name, which is what an outbox row's `template` column stores. */
  member: string;
  displayName: string;
  notApplicable: string;
  slots: readonly { name: string; required: boolean; maxLength: number }[];
  resolvedKeys: readonly string[];
}

/**
 * One email attempt as the mock holds it, which is less than api's row and deliberately so.
 *
 * Absent: `personalisation`, `templateVersion`, `attempts`, `nextAttemptAt`, `providerNotificationId` and
 * `failureVerdict`. The first is only read to resolve attachment ids and the one shipped template declares no
 * document keys, so there is nothing for it to carry; the rest are the outbox's own bookkeeping and reach no
 * response. A field here that no page can see would be a second opinion about api's internals.
 *
 * Here rather than beside `MockCase`'s other children in `server.ts` so that the history fixture below can be
 * typed without `server.ts` and this file importing each other.
 */
export interface MockNotification {
  id: string;
  /** api's half of the idempotency key, with `template`: one email per referral, ever. */
  referralId: string;
  /** The member NAME — `APPLICATION_REJECTED`, not `application-rejected`. */
  template: string;
  /** Frozen at send, so a later edit to the case cannot redirect an email already owed. */
  recipient: string;
  state: NonNullable<WireEmailHistory["notifyState"]>;
  failureReason: string | null;
  /** Both null until Notify accepts the send, and null forever on anything sent before api kept them. */
  subject: string | null;
  body: string | null;
  createdOn: Date;
  /** The caseworker who sent it, who authored part of what the applicant read. */
  createdBy: string;
}

interface MockFixture {
  /** Whether a case create or patch is applied, or refused with `MOCK_WRITE_REJECTION`. */
  caseWrite: "accept" | "reject";
  /** When false every contract route answers 503. */
  reachable: boolean;
}

export type MockScenario = keyof typeof MOCK_SCENARIOS;
