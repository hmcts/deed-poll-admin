/**
 * The raise-a-referral form: the four things a caseworker ticks, chooses or types.
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
 * `urgencyReason` rule hinges on the answer — a referral with no urgency would make that rule unaskable.
 *
 * The messages live here rather than in the page, following `../saved-queries/schemas.ts`: `notes` has two
 * different things to say about it — required-because-Other and too-long — and a page that maps one message
 * per field cannot say both. The *labels* are the page's, per the plan's decision 2: the wire values are
 * api's enum members, the human wording is ours.
 */
import { REFERRAL_REASON, URGENCY } from "@hmcts/deed-poll-api-client";
import { z } from "zod";

/** api's `CreateReferralRequest.notes` maxLength. */
export const MAX_REFERRAL_NOTES = 1000;

/** api's `CreateReferralRequest.urgencyReason` maxLength. */
export const MAX_REFERRAL_URGENCY_REASON = 500;

/** The reason that pairs with a rule: ticking it makes `notes` mandatory, at api's end and here. */
const REASON_REQUIRING_NOTES = "Other";

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
    urgency: z.enum(URGENCY, { error: "Select how urgent this referral is" }),
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
    if (referral.reasons.includes(REASON_REQUIRING_NOTES) && !referral.notes) {
      ctx.addIssue({ code: "custom", path: ["notes"], message: "Enter the other reason for referring this case" });
    }
    if (referral.urgency === URGENCY_REQUIRING_REASON && !referral.urgencyReason) {
      ctx.addIssue({ code: "custom", path: ["urgencyReason"], message: "Enter why this referral is urgent" });
    }
  });

/** What a validated raise-a-referral form holds. The referral's state and author are api's, so neither is here. */
export type CreateReferralInput = z.output<typeof createReferralSchema>;
