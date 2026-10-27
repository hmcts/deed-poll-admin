/**
 * Record a direction on a referral this judge holds — the form, the check-your-answers step, and the one call
 * that commits it.
 *
 * **Three steps, one route, no persisted draft.** api models a direction as a single transition
 * (`referrals-api-2` decision 7): there is no draft resource to PATCH and no half-recorded state to resume. So
 * the form posts to itself, the check step re-renders from the values it was posted (hidden fields), and the
 * confirm posts the complete direction once. Nothing is written anywhere — session or api — until the judge
 * confirms, which means an abandoned direction leaves nothing behind and a judge who closes the tab has not
 * half-directed a referral. The state travels through the request because that is this app's norm
 * (`referrals-admin-3` decision 7, and the `deed-polls/index.ts` docblock that states it for the case list).
 *
 * **"Change" is a button, not a link, and that is what carries the state back.** The GOV.UK pattern's change
 * links are `GET`s, which is only possible when the answers are stored somewhere to come back to. Here they are
 * in the request, so the way back to the form is a submit that re-posts them — a link would silently empty the
 * form, which is the one failure a judge would notice too late.
 *
 * **The attestation is a declaration and a button, not a tick box.** The Design System's check-answers pattern
 * puts the declaration above the submit and treats pressing it as the attestation; a confirmation checkbox in
 * front of a button that already confirms is the pattern it warns against. The wording is display-only and
 * flagged in the plan for a judicial-facing pass.
 *
 * **Reading the referral before rendering is the guard and the caption, not a scoping pre-read.** Both are
 * load-bearing: a judge must see *which* application they are directing before they attest to it — the
 * reference is on the application view, so it is theirs to see — and a referral that is not in their hands has no
 * direction to take, so they are sent back to the referral rather than shown a form whose submit can only be
 * refused. The confirm step reads nothing: it is one atomic call, and api re-checks the hold itself.
 *
 * **`?change=1` is the same journey for a direction this judge has already given** (plan decision 5). The referral
 * must be `Decided` rather than `Claimed` — api shows a decided referral only to the judge who directed it — the
 * form arrives prefilled from that direction, the words say "change", and the confirm calls `changeDirection`
 * (api's `PUT`) instead of `recordDirection`. Every href this page renders carries the flag, so each step of the
 * journey arrives in the same mode, and its 409 has its own sentence on the referral: there is no direction from
 * this judge to change, which is a state and names no one. Any other value of the flag is a new direction.
 *
 * **The two refusals divide by visibility, exactly as claiming does.** api checks visibility before the hold,
 * so a referral taken out from under this judge — withdrawn, closed, or claimed by someone else — is a **404**
 * and is rendered as decision 10's "no longer available", never as "somebody else has it". The **409** is the
 * narrower case of a referral they can still see but do not hold (it went back to the pool, or they have already
 * directed it), and that one names the state rather than a person. Reading the 409 as the only lapse would
 * render the commonest lapse there is as a fault.
 */
import {
  buildJudicialReferral,
  ConflictError,
  changeDirection,
  DIRECTION_DECISION_CHOICES,
  type DirectionInput,
  directionSchema,
  type FieldError,
  getReferral,
  InvalidInputError,
  MASTER_DECISION_LABEL,
  MAX_DIRECTIONS_TEXT,
  NotFoundError,
  recordDirection,
  zodErrorToFieldErrors
} from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../../../auth/current-user.js";
import { forLog } from "../../../../for-log.js";
import { referralPath } from "../../../../judicial-referral-path.js";

const POOL_PATH = "/judicial/referrals";

/**
 * The submit that commits. Only this literal records anything — the other two steps render.
 *
 * Checked against the literal rather than inferred from the presence of a body, so a re-post of the form (a
 * refresh on the check step, say) cannot be mistaken for an attestation the judge did not make.
 */
const CONFIRM = "confirm";

/** The submit on the check step that goes back to the form, carrying the answers with it. */
const CHANGE = "change";

/** The query flag, and its one value, that makes this the journey for changing a direction already given. */
const CHANGE_FLAG = "1";

// The order the controls appear in, so the error summary reads down the page rather than in whatever order the
// issues arrived: the decision, the Gazette question, then the directions or reasons (Master Sullivan's feedback,
// Steve, 2026-10-27), because a Yes to the Gazette question is what makes the text required.
const FIELD_ORDER = ["decision", "changesToStandardPublication", "directionsText"];

const en = {
  title: "Record a direction",
  heading: "Record a direction",
  decisionLegend: "What is your direction on this application?",
  // Says what the two words commit to. "Approved"/"Rejected" are api's members and the case's own vocabulary,
  // so they are not re-worded here — the hint is where the meaning goes.
  decisionHint: "This is recorded against the application as the Master’s decision.",
  // The Masters' own label. Not "(optional)": it is required when there are changes to the standard publication,
  // and the hint says when, rather than leaving a Master to discover it by being refused.
  directionsLabel: "Directions/Reasons",
  directionsHint: "If there are changes to the standard publication, say whether to publish nothing or what to publish.",
  // The Masters' wording. Yes means do not publish, or publish only as the directions say.
  gazetteLegend: "Are there any changes to the standard publications in the Gazette?",
  gazetteHint:
    "For example, do not publish, or publish the last name only. This is your direction. It is not taken from the reasons the court gave for the referral.",
  yes: "Yes",
  no: "No",
  continueLabel: "Continue",
  cancel: "Cancel",
  errorSummaryTitle: "There is a problem",
  // A 400 from api naming no control this form renders. Its own text is written for whoever reads api's logs,
  // so this stands in for it — the same split every form in this app makes.
  directionRefused: "The direction could not be recorded. Check your answers and try again.",
  // The check step's own words. One content pair for both steps, because they are two renderings of one answer
  // and a wording that differed between them would read as two different directions.
  checkTitle: "Check your direction",
  checkHeading: "Check your direction",
  decisionLabel: "Decision",
  directionsSummaryLabel: "Directions/Reasons",
  gazetteLabel: "Changes to the standard publications in the Gazette",
  noneGiven: "None given",
  // Decision 6's attestation, as a declaration above the submit. Working text — a judicial-facing wording and
  // Welsh pass can revise it.
  declaration: "By recording this direction you confirm it is your direction on this application.",
  // What happens afterwards, because a judge attesting to a direction should know it is not final until the office
  // closes the referral.
  afterwards: "You can change or withdraw your direction until the office closes the referral.",
  confirm: "Confirm and record the direction",
  change: "Change your answers",
  directionsTextMax: MAX_DIRECTIONS_TEXT
};

// English content in the cy shape — see the note in ../../../deed-polls/index.ts.
const cy = { ...en };

/** The same pages when the judge is changing a direction already given: every word that says "record" says "change". */
const changeEn = {
  ...en,
  title: "Change your direction",
  heading: "Change your direction",
  checkTitle: "Check your changed direction",
  checkHeading: "Check your changed direction",
  declaration: "By changing this direction you confirm it is your direction on this application.",
  // api keeps the earlier direction on its audit trail and writes the caseworker a case note, so both are said.
  afterwards: "Your earlier direction stays on record, and the office is told you changed it.",
  confirm: "Confirm and change the direction"
};

const changeCy = { ...changeEn };

/** The "no longer available" page's words, as `../[referralId].ts` renders them. See decision 10. */
const unavailableEn = {
  title: "This referral is no longer available",
  heading: "This referral is no longer available",
  body: "This referral is no longer in the shared list. Choose another referral from the list.",
  // The pool, and named as the shared navigation names it — a refused read published no state to derive My
  // referrals from, and it is a list this referral has left as well.
  backToPool: "Back to referrals for a direction"
};

const unavailableCy = { ...unavailableEn };

export const GET = async (req: Request, res: Response) => {
  const referral = await held(req, res);
  if (!referral) return;

  render(res, referral, referral.current, {});
};

export const POST = async (req: Request, res: Response) => {
  // Before any read or write, so refusing an unusable id cannot follow either.
  const referralHref = referralPath(req.params.referralId);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const isChange = isChangeJourney(req);

  // Back to the form with the answers still on it, and with no errors: a judge who pressed Change is going back
  // to edit an answer, not submitting one, so validating it here would show them problems with a direction they
  // have already said they want to change.
  if (body.action === CHANGE) {
    const referral = await held(req, res);
    if (!referral) return;

    return render(res, referral, values(body), {});
  }

  const parsed = directionSchema.safeParse(submitted(body));

  if (!parsed.success) {
    // The schema's own messages, as `../../../deed-polls/[id]/referrals/new.ts` renders them: `directionsText`
    // has one thing to say but the two radios' wording belongs beside the rule that rejects them.
    return rerender(req, res, 400, values(body), fieldMessages(zodErrorToFieldErrors(parsed.error)));
  }

  if (body.action !== CONFIRM) {
    const referral = await held(req, res);
    if (!referral) return;

    return res.render("judicial/referrals/direction-check", {
      reference: referral.reference,
      // The answers twice over: once as the words a judge reads back, once as the fields that carry them to the
      // confirm. Built here rather than in the template so the two cannot disagree about what was entered.
      answers: {
        decision: MASTER_DECISION_LABEL[parsed.data.decision],
        directionsText: parsed.data.directionsText ?? "",
        changesToStandardPublication: parsed.data.changesToStandardPublication
      },
      values: values(body),
      directionHref: directionHref(referral.id, isChange),
      referralHref: referralPath(referral.id),
      // The check step's own `title`, because the layout puts `title` in the `<title>` element: one content pair
      // for both steps means the form's name would otherwise be announced over a page headed "Check your
      // direction", which is the accessibility rule this file could break with nothing to show it.
      en: checkStep(words(isChange).en),
      cy: checkStep(words(isChange).cy)
    });
  }

  return commitDirection(req, res, parsed.data, referralHref, isChange);
};

async function commitDirection(req: Request, res: Response, direction: DirectionInput, referralHref: string, isChange: boolean) {
  try {
    // One call, complete. Nothing is read first: api re-checks the hold, and a pre-read's answer would be stale by
    // the time it was acted on.
    const commit = isChange ? changeDirection : recordDirection;
    await commit(req.params.referralId, direction, callerFromRequest(req));
  } catch (error) {
    // Visible but not in this judge's hands — it went back to the pool, or they have already directed it; for a
    // change, there is no direction of theirs to replace. Their answers are gone with it, which is unavoidable:
    // the referral's state is what the page they land on shows.
    if (error instanceof ConflictError) {
      return res.redirect(`${referralHref}?direction=${refusal(isChange)}`);
    }
    // Not visible at all, which api answers identically for withdrawn, closed, another judge's and never-there.
    if (error instanceof NotFoundError) return unavailable(res);
    if (error instanceof InvalidInputError) return apiRefused(req, res, error);
    throw error;
  }

  res.redirect(`${referralHref}?direction=${isChange ? "changed" : "recorded"}`);
}

/** Whether this request is the change journey. Only the one literal value counts, so a stray flag records anew. */
function isChangeJourney(req: Request): boolean {
  return req.query.change === CHANGE_FLAG;
}

/** The content pair for this journey. */
function words(isChange: boolean): { en: typeof en; cy: typeof en } {
  return isChange ? { en: changeEn, cy: changeCy } : { en, cy };
}

/** What the referral page is told when the referral is not in the state this journey needs. */
function refusal(isChange: boolean): string {
  return isChange ? "notchangeable" : "notheld";
}

/**
 * The words for this request's language.
 *
 * Needed only for the strings this handler resolves itself — the two Gazette labels and api's stand-in refusal.
 * Everything else reaches the template as the `en`/`cy` pair it picks from.
 */
function content(res: Response, isChange: boolean): typeof en {
  const pair = words(isChange);

  return res.locals.locale === "cy" ? pair.cy : pair.en;
}

/** One content pair as the check step's, so the `title` the layout renders matches the heading on the page. */
function checkStep(content: typeof en): typeof en {
  return { ...content, title: content.checkTitle };
}

/**
 * The referral this judge is directing, or nothing — having already rendered or redirected.
 *
 * Three outcomes, and the caller returns on two of them: the referral is theirs to direct, it is not visible
 * (the "no longer available" page, 404), or it is visible but not in their hands (back to the referral, where
 * the control that *does* apply is offered — claim it, or read the direction already recorded). On the change
 * journey "theirs to direct" is `Decided` rather than `Claimed`, and `current` is the direction given, as the
 * form's raw values, to prefill it with.
 */
async function held(req: Request, res: Response): Promise<HeldReferral | undefined> {
  const { referralId } = req.params;
  // Before the read, so GET refuses an unusable id without asking api about it.
  const referralHref = referralPath(referralId);

  let detail: Awaited<ReturnType<typeof getReferral>>;
  try {
    detail = await getReferral(referralId, callerFromRequest(req));
  } catch (error) {
    // Only the 404 is this page's to render; anything else is a fault and belongs on the 500 page.
    if (!(error instanceof NotFoundError)) throw error;

    unavailable(res);
    return undefined;
  }

  const view = buildJudicialReferral(detail);
  const isChange = isChangeJourney(req);

  if (!(isChange ? view.changeable : view.directable)) {
    res.redirect(`${referralHref}?direction=${refusal(isChange)}`);
    return undefined;
  }

  // The reference is the application view's, so a referral api sent no application with has no caption — and the
  // page renders none rather than inventing one.
  return { id: referralId, reference: view.application?.reference ?? "", isChange, current: isChange ? currentValues(detail) : {} };
}

/**
 * The direction already given, as the form posts it — strings, so the radios re-check — with an unrecorded Gazette
 * answer left unanswered rather than read as "No".
 */
function currentValues(detail: Awaited<ReturnType<typeof getReferral>>): Record<string, unknown> {
  return {
    decision: detail.decision ?? undefined,
    directionsText: detail.directionsText ?? "",
    changesToStandardPublication: typeof detail.changesToStandardPublication === "boolean" ? String(detail.changesToStandardPublication) : undefined
  };
}

/** api's 400: its own words where they name a control this form renders, this page's where they do not. */
function apiRefused(req: Request, res: Response, error: InvalidInputError) {
  const messages = fieldMessages(error.errors);
  const placed = Object.keys(messages).filter((field) => FIELD_ORDER.includes(field));
  const unplaceable = Object.keys(messages).filter((field) => !FIELD_ORDER.includes(field));
  const body = (req.body ?? {}) as Record<string, unknown>;

  if (unplaceable.length > 0 || placed.length === 0) {
    console.error(`direction refused with rejections this form cannot place (${unplaceable.join(", ") || "no field named"}): ${forLog(error.message)}`);
    return rerender(
      req,
      res,
      400,
      values(body),
      Object.fromEntries(placed.map((field) => [field, messages[field]])),
      content(res, isChangeJourney(req)).directionRefused
    );
  }

  return rerender(req, res, 400, values(body), messages);
}

/**
 * The submitted body as the schema's shape.
 *
 * `changesToStandardPublication` is compared to the two literals rather than coerced, the `declarant` treatment in
 * `../../../deed-polls/[id]/witnesses/new.ts`: the radio's "no" posts the string `"false"`, which is truthy, so
 * `Boolean(body.changesToStandardPublication)` would silently withhold every deed poll it was asked about. Anything else —
 * including no selection at all — stays `undefined`, so the schema rejects it and the judge is asked the
 * question rather than having it answered for them.
 */
function submitted(body: Record<string, unknown>): Record<string, unknown> {
  return {
    decision: body.decision,
    directionsText: body.directionsText,
    changesToStandardPublication: booleanFrom(body.changesToStandardPublication)
  };
}

function booleanFrom(value: unknown): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;

  return undefined;
}

/**
 * The body as the controls want it back — the three raw values, so the radios re-check and the textarea still
 * holds what was typed.
 *
 * Deliberately not `submitted(body)`, whose `changesToStandardPublication` is a boolean: the radios compare against the
 * strings they post, and `false` is not `"false"`.
 */
function values(body: Record<string, unknown>): Record<string, unknown> {
  return {
    decision: body.decision,
    directionsText: body.directionsText,
    changesToStandardPublication: body.changesToStandardPublication
  };
}

/** Rejections keyed by the control they belong against. */
function fieldMessages(errors: FieldError[]): Record<string, string> {
  return Object.fromEntries(errors.map((error) => [error.field.split(/[.[]/)[0], error.message]));
}

/**
 * The form again, with what was entered and what is wrong with it.
 *
 * Re-renders rather than redirecting with `?error=`, as every form in this app does, and here the stake is the
 * highest of them: up to 4,000 characters of a judge's directions.
 */
async function rerender(
  req: Request,
  res: Response,
  status: number,
  submittedValues: Record<string, unknown>,
  errors: Record<string, string>,
  formError?: string
) {
  const referral = await held(req, res);
  if (!referral) return;

  res.status(status);
  render(res, referral, submittedValues, errors, formError);
}

function render(res: Response, referral: HeldReferral, submittedValues: Record<string, unknown>, errors: Record<string, string>, formError?: string) {
  const text = content(res, referral.isChange);
  const pair = words(referral.isChange);

  res.render("judicial/referrals/direction-form", {
    reference: referral.reference,
    // The values are api's enum members and go on the wire unchanged; the words are this repo's. Checked state
    // is worked out here rather than in the template, so it is computed once in something testable.
    decisionItems: DIRECTION_DECISION_CHOICES.map((choice) => ({ ...choice, checked: submittedValues.decision === choice.value })),
    // Resolved against the request's locale, not taken from `en`: the items are built here rather than in the
    // template, so unlike every other string on this page they do not reach the template as an `en`/`cy` pair
    // for it to pick from — and these two label the one answer that cannot be taken back.
    gazetteItems: [
      { value: "true", text: text.yes, checked: submittedValues.changesToStandardPublication === "true" },
      { value: "false", text: text.no, checked: submittedValues.changesToStandardPublication === "false" }
    ],
    values: submittedValues,
    errors,
    errorList: summaryList(errors, formError),
    directionHref: directionHref(referral.id, referral.isChange),
    referralHref: referralPath(referral.id),
    en: pair.en,
    cy: pair.cy
  });
}

/**
 * Error-summary rows, ordered by the controls rather than by whatever order the errors arrived in.
 *
 * The form-level row carries no `href`, as `../../../deed-polls/[id]/referrals/new.ts` explains: it stands in
 * for a rejection that names no control here, so there is nothing to send focus to.
 */
function summaryList(errors: Record<string, string>, formError?: string): { text: string; href?: string }[] {
  const rows = FIELD_ORDER.filter((field) => errors[field]).map((field) => ({ text: errors[field], href: `#${field}` }));

  return formError ? [{ text: formError }, ...rows] : rows;
}

/** Decision 10's page, and the same template the referral view renders for an invisible referral. */
function unavailable(res: Response) {
  res.status(404).render("judicial/referrals/unavailable", { poolPath: POOL_PATH, en: unavailableEn, cy: unavailableCy });
}

function directionHref(referralId: string, isChange: boolean): string {
  const query = isChange ? `?change=${CHANGE_FLAG}` : "";
  return `${referralPath(referralId)}/direction${query}`;
}

/** A referral this judge may direct on this journey, and the values its form starts with. */
interface HeldReferral {
  id: string;
  reference: string;
  isChange: boolean;
  current: Record<string, unknown>;
}
