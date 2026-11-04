/**
 * The direction a judge records on a referral they hold: the decision, the free text, and the publication call.
 *
 * **`decision` is `MasterDecision` and never a judicial enum of its own.** api reuses the members the case's
 * own `masterDecision` column carries (`referrals-api-2` decision 5), so the members come from the client's
 * published array exactly as `../referrals/schemas.ts` takes its reasons from `REFERRAL_REASON` — a member
 * added at api's end reaches this form without an edit here.
 *
 * **`directionsText` is optional on a standard publication, and required when there are changes** — api's rule
 * (`ReferralSchemas.parseDirection`), checked here first so the Master sees it beside the textarea rather than as a
 * refused write. An approval that needs no comment is a real answer, but "Yes" to the Gazette question alone does
 * not say whether to publish nothing or only the last name, and the text is the one place that does. The 4000-character bound is
 * api's `maxLength`, and like every bound in this repo it may only ever be lowered: this schema is the only
 * guard on the body before the wire, because the adapter validates the response it gets back and not the body
 * it sends.
 *
 * **`changesToStandardPublication` is a required boolean with no default** — the Master's answer to "Are there any
 * changes to the standard publications in the Gazette?" (Master Sullivan's feedback, Steve, 2026-10-27), where Yes
 * means do not publish or publish only as the directions say. It is the one field worth being pedantic about: publication cannot be taken back, and the radio's "no" posts the string `"false"`, which is truthy.
 * The page converts the two literals (the `declarant` pattern in `witnesses/new.ts`) so an unanswered pair of
 * radios stays `undefined` and fails here, rather than arriving as a silent `true`. It is never derived from
 * the caseworker's referral reasons — the reason for referring is not the judge's decision.
 *
 * The messages live here rather than in the page, following `../referrals/schemas.ts`: `directionsText` has
 * only one thing to say, but keeping all three beside the shape is what lets a page map one message per field
 * without owning the vocabulary.
 */
import { MASTER_DECISION } from "@hmcts/deed-poll-api-client";
import { z } from "zod";

/** api's `JudicialDirectionRequest.directionsText` maxLength. */
export const MAX_DIRECTIONS_TEXT = 4000;

export const directionSchema = z
  .object({
    decision: z.enum(MASTER_DECISION, { error: "Select whether the application is approved or rejected" }),
    // Not `.optional()`: an unanswered radio pair must fail rather than default, and the message is the one the
    // Master sees beside the control.
    changesToStandardPublication: z.boolean({ error: "Select whether there are any changes to the standard publications in the Gazette" }),
    // Blank becomes `undefined` rather than `""`, trimmed before it is measured — the same treatment
    // `../referrals/schemas.ts` gives its optional free text, so whitespace is the absence of a comment.
    directionsText: z
      .string({ error: `Directions or reasons must be ${MAX_DIRECTIONS_TEXT} characters or fewer` })
      .trim()
      .max(MAX_DIRECTIONS_TEXT, `Directions or reasons must be ${MAX_DIRECTIONS_TEXT} characters or fewer`)
      .optional()
      .transform((value) => (value === undefined || value === "" ? undefined : value))
  })
  .superRefine((direction, context) => {
    if (direction.changesToStandardPublication && direction.directionsText === undefined) {
      context.addIssue({
        code: "custom",
        path: ["directionsText"],
        message: "Enter the directions or reasons, saying what changes about the Gazette publication"
      });
    }
  });

/**
 * What a validated direction form holds — the three fields api's body takes and nothing else.
 *
 * The state, the decider and the decision date are api's: it stamps them from the transition, the token and its
 * own clock, which is why none of them is here to send.
 */
export type DirectionInput = z.output<typeof directionSchema>;
