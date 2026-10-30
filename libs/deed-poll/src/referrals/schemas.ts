/**
 * The two referral forms: raising one — the four things a caseworker ticks, chooses or types — and recording the
 * applicant's answer to *Request confirmation to proceed*, which is one answer and a note.
 *
 * Everything below about members, bounds and where a message lives applies to both; `recordConfirmationSchema`
 * carries what is particular to it.
 *
 * **The members are never restated.** `reasons` and `urgency` are built from the client's published member
 * arrays, exactly as `../deed-poll/enums/option-sets.ts` builds its objects, so a member added at api's end
 * reaches the form's schema without an edit here and one that disappears is a type error rather than a 400
 * discovered on the wire.
 *
 * **The two conditional requirements are api's rules, applied here as the second of two guards.** api
 * requires `notes` when `Other` is among the reasons and `urgencyReason` when `urgency` is `Urgent`, and it
 * answers 400 for either regardless of what this schema does. What the `superRefine` below buys is a message
 * beside the control instead of a round trip to learn the same thing — the reason `schema-primitives.ts`
 * rejects a `null` api would also reject. The wire schema in `libs/deed-poll-api-client` deliberately does
 * *not* carry these rules, because its job is the shape of the body and not the form's behaviour; this is
 * where this repo's copies of api's rules live for a form to render.
 *
 * **The bounds are api's too, and may only ever be lowered.** `CreateReferralRequest` publishes `notes` as
 * ≤1000 characters and `urgencyReason` as ≤500, and this is the **only** guard on them before the wire: the
 * adapter validates the response it gets back, not the body it sends, so `WIRE_SCHEMAS.CreateReferralRequest`
 * is a type source and not a second check. Widen either bound and api's 400 is what a caseworker meets.
 *
 * **`urgency` is required here while api leaves it optional**, which is a narrowing rather than a
 * disagreement: the form always renders both radios, so "no answer" is not a body it can send, and the
 * `urgencyReason` rule hinges on the answer — a referral with no urgency would make that rule unaskable. The
 * requirement is stated in the `superRefine` rather than by leaving the enum non-optional, because zod skips
 * an object's refinements once a field has failed its own parse: a missing `urgency` would then suppress the
 * `notes` message as well, and a caseworker who ticked `Other` and skipped the radios would pay two
 * submissions to learn two things the form already knew — the round trip this whole schema exists to avoid.
 *
 * The messages live here rather than in the page, following `../saved-queries/schemas.ts`: `notes` has two
 * different things to say about it — required-because-Other and too-long — and a page that maps one message
 * per field cannot say both. The *labels* are the page's, per the plan's decision 2: the wire values are
 * api's enum members, the human wording is ours.
 */
import { CONFIRMATION_OUTCOME, REFERRAL_REASON, REFERRAL_SEND_LIMITS, URGENCY } from "@hmcts/deed-poll-api-client";
import { z } from "zod";
import { MINOR_DETAIL_REASONS, REFERRAL_REASON_LABEL } from "./referrals-view.js";

/** api's `CreateReferralRequest.notes` maxLength. */
export const MAX_REFERRAL_NOTES = 1000;

/** api's `RecordConfirmationRequest.note` maxLength. Same cap as a referral's notes, a different field. */
export const MAX_CONFIRMATION_NOTE = 1000;

/** api's `CreateReferralRequest.urgencyReason` maxLength. */
export const MAX_REFERRAL_URGENCY_REASON = 500;

/** The reason that pairs with a rule: ticking it makes `notes` mandatory, at api's end and here. */
const REASON_REQUIRING_NOTES = "Other";

/** The reason a minor's details refine — see `MINOR_DETAIL_REASONS`. */
const MINOR_REASON = "Minor";

/** The minor's details that cannot both be true, as the Masters listed them in pairs, and as api refuses them. */
const CONTRADICTORY_MINOR_DETAILS = [
  ["MinorParentalConsent", "MinorNoParentalConsent"],
  ["MinorStepparentConsent", "MinorNoStepparentConsent"],
  ["MinorAged16Or17Consented", "MinorAged16Or17NotConsented"]
] as const;

/** The urgency that pairs with a rule: choosing it makes `urgencyReason` mandatory. */
const URGENCY_REQUIRING_REASON = "Urgent";

export const createReferralSchema = z
  .object({
    // Checkboxes, so an untouched group posts nothing at all and the error has to land on the group rather
    // than on a box. `.min(1)`, the absent-value message and the member message all say the same thing for
    // that reason — the member one because zod's default for an enum prints every member it accepts, which is
    // api's vocabulary rather than a sentence, and a tampered post is not worth showing it for.
    reasons: z
      .array(z.enum(REFERRAL_REASON, { error: "Select at least one reason for referring this case" }), {
        error: "Select at least one reason for referring this case"
      })
      .min(1, "Select at least one reason for referring this case"),
    // Blank becomes `undefined` rather than `""`: api takes no null on a create, and an empty note is the
    // absence of one rather than a note that says nothing. Trimmed before it is measured, so "   " is a
    // blank rather than three characters — `../notes/schemas.ts` holds the same reasoning, and it is what
    // makes the conditional rule below refuse whitespace where `Other` demands an explanation.
    notes: z
      .string({ error: `Notes must be ${MAX_REFERRAL_NOTES} characters or fewer` })
      .trim()
      .max(MAX_REFERRAL_NOTES, `Notes must be ${MAX_REFERRAL_NOTES} characters or fewer`)
      .optional()
      .transform((value) => (value === undefined || value === "" ? undefined : value)),
    // Optional in the shape and required in the `superRefine` — see the docblock. A value api does not
    // publish still fails here, which only a tampered post can do.
    urgency: z.enum(URGENCY, { error: "Select how urgent this referral is" }).optional(),
    urgencyReason: z
      .string({ error: `The reason for urgency must be ${MAX_REFERRAL_URGENCY_REASON} characters or fewer` })
      .trim()
      .max(MAX_REFERRAL_URGENCY_REASON, `The reason for urgency must be ${MAX_REFERRAL_URGENCY_REASON} characters or fewer`)
      .optional()
      .transform((value) => (value === undefined || value === "" ? undefined : value))
  })
  .superRefine((referral, ctx) => {
    // `path` is what makes `zodErrorToFieldErrors` address the issue to a control, so the error summary's
    // link resolves. An issue raised without one is addressed to the form, which is not where a caseworker
    // needs to look for either of these.
    if (!referral.urgency) {
      ctx.addIssue({ code: "custom", path: ["urgency"], message: "Select how urgent this referral is" });
    }
    if (referral.reasons.includes(REASON_REQUIRING_NOTES) && !referral.notes) {
      ctx.addIssue({ code: "custom", path: ["notes"], message: "Enter the other reason for referring this case" });
    }
    if (referral.urgency === URGENCY_REQUIRING_REASON && !referral.urgencyReason) {
      ctx.addIssue({ code: "custom", path: ["urgencyReason"], message: "Enter why this referral is urgent" });
    }
    for (const issue of minorDetailIssues(referral.reasons)) {
      ctx.addIssue({ code: "custom", ...issue });
    }
  });

/**
 * A minor's details beneath "Applicant is a minor" (Master Sullivan's feedback, Steve, 2026-10-27): at least one when
 * the box is ticked, none without it, and never both halves of a pair. api refuses the last two and will refuse the
 * first; this app asks first, so the caseworker sees the sentence beside the boxes rather than a refused write.
 *
 * The details are addressed to `minorDetails`, the revealed group's id, and a detail without `Minor` to `reasons`,
 * because the group it was ticked in is hidden once "Applicant is a minor" is unticked.
 */
function minorDetailIssues(reasons: readonly string[]): { path: string[]; message: string }[] {
  const details = reasons.filter((reason) => (MINOR_DETAIL_REASONS as readonly string[]).includes(reason));
  const isMinor = reasons.includes(MINOR_REASON);
  if (isMinor && details.length === 0) {
    return [{ path: ["minorDetails"], message: "Select what applies to the minor's application" }];
  }
  if (!isMinor && details.length > 0) {
    return [{ path: ["reasons"], message: "Select Applicant is a minor, or untick what applies to the minor's application" }];
  }
  const contradiction = CONTRADICTORY_MINOR_DETAILS.find(([first, second]) => details.includes(first) && details.includes(second));

  return contradiction
    ? [
        {
          path: ["minorDetails"],
          message: `Select either ${REFERRAL_REASON_LABEL[contradiction[0]]} or ${REFERRAL_REASON_LABEL[contradiction[1]]}, not both`
        }
      ]
    : [];
}

/**
 * The record-the-applicant's-response form: one answer, and the note that evidences it.
 *
 * **`outcome` is the only required property, as it is at api's end**, and the members are api's published array
 * rather than two strings typed out again — so a third answer added there is a type error here instead of a
 * radio nobody rendered. The absent-value message and the member message say the same thing: a post naming a
 * value the form never offered is tampering, and zod's default for an enum prints api's whole vocabulary.
 *
 * **The note is optional and must stay optional.** api trims it and treats whitespace-only as none, which is why
 * the transform below matches `createReferralSchema`'s rather than doing something of its own — and it is capped
 * at api's published 1,000, enforced here so a 1,001st character is a message beside the field rather than a 400
 * a caseworker cannot act on. Widen the cap and api's 400 is what they meet.
 *
 * **Nothing here refuses a second answer or an unasked referral.** Both are states of the referral rather than
 * facts about this form, api answers 409 for each, and a schema that guessed would be a second authority going
 * stale the moment another caseworker recorded the answer.
 */
export const recordConfirmationSchema = z.object({
  outcome: z.enum(CONFIRMATION_OUTCOME, { error: "Select what the applicant said about proceeding" }),
  note: z
    .string({ error: `The note must be ${MAX_CONFIRMATION_NOTE} characters or fewer` })
    .trim()
    .max(MAX_CONFIRMATION_NOTE, `The note must be ${MAX_CONFIRMATION_NOTE} characters or fewer`)
    .optional()
    .transform((value) => (value === undefined || value === "" ? undefined : value))
});

/** The referral queue's selection messages, beside the controls they are about. */
export const SEND_SELECTION_MESSAGES = {
  none: "Select at least one referral to send",
  unknown: "Select referrals from the list",
  tooMany: `Select at most ${REFERRAL_SEND_LIMITS.maxAllocations} referrals at once`,
  noMaster: "Choose a Master for this referral"
} as const;

/**
 * The referral queue's selection (plan Fa1), as the queue's form and the review's hidden inputs both post it: each
 * ticked referral's id under `referrals`, and its Master under `master-<referralId>`.
 *
 * **Only the ticked rows travel.** A Master chosen on a row left unticked is not part of the selection, so it is
 * dropped rather than refused. Every id reads as a UUID, as api's are, and none is ticked twice; a value no form
 * offered is reported on the selection, never echoed. The bound is api's `maxItems`. Everything else (the window,
 * each referral still waiting, each Master available, the cap) is api's to decide at the send.
 */
export const sendSelectionSchema = z.record(z.string(), z.unknown()).transform((body, ctx) => {
  const ticked: unknown[] = body.referrals === undefined ? [] : Array.isArray(body.referrals) ? body.referrals : [body.referrals];
  const refuse = (path: string, message: string) => {
    ctx.addIssue({ code: "custom", path: [path], message });
    return z.NEVER;
  };

  if (ticked.length === 0) return refuse("referrals", SEND_SELECTION_MESSAGES.none);
  if (!ticked.every(isUuid) || new Set(ticked).size !== ticked.length) return refuse("referrals", SEND_SELECTION_MESSAGES.unknown);
  if (ticked.length > REFERRAL_SEND_LIMITS.maxAllocations) return refuse("referrals", SEND_SELECTION_MESSAGES.tooMany);

  const unchosen = ticked.filter((referralId) => !isUuid(body[`master-${referralId}`]));
  for (const referralId of unchosen) ctx.addIssue({ code: "custom", path: [`master-${referralId}`], message: SEND_SELECTION_MESSAGES.noMaster });
  if (unchosen.length > 0) return z.NEVER;

  return { allocations: ticked.map((referralId) => ({ referralId, masterId: body[`master-${referralId}`] as string })) };
});

function isUuid(value: unknown): value is string {
  return z.uuid().safeParse(value).success;
}

/** What a validated raise-a-referral form holds. The referral's state and author are api's, so neither is here. */
export type CreateReferralInput = z.output<typeof createReferralSchema>;

/** What a validated record-the-response form holds. The recorder and the date are api's, so neither is here. */
export type RecordConfirmationInput = z.output<typeof recordConfirmationSchema>;

/** What a validated queue selection holds: each referral with its Master, in the order they were ticked. */
export type SendSelection = z.output<typeof sendSelectionSchema>;
