/**
 * The slots a caseworker fills on an email, checked against the rules api published for them.
 *
 * **Not a zod schema, and that is the one design decision in this file.** Every other form in this repo has a
 * schema in `schemas.ts` because its fields are known when the code is written; an email's fields are not. api
 * publishes `EmailSlotResponse` — a name, a cap and whether it is required — per template, and `template` is a
 * bare string with no member list, so a template api adds later arrives with slots this repo has never seen. A
 * hand-written schema would refuse the new template's fields or silently ignore them; a rule matrix read off the
 * metadata renders and validates it with no edit here. That is the same shape `../deed-poll/deed-poll-validation.ts`
 * takes for the per-Type required sets, and it returns the same `FieldError[]` a zod rejection does, so whatever
 * renders the errors cannot tell the two apart.
 *
 * **This is the second of two guards and api is the authority** — decision 7 of
 * `docs/plans/notify-2-caseworker-email-tab.md`. api answers 400 naming each offending slot regardless of what
 * happens here; what this buys is a message beside the control instead of a round trip to learn the same thing,
 * exactly as `../schema-primitives.ts` rejects a `null` api would also reject. So the rules are **mirrored, never
 * reimplemented**: the cap is api's `maxLength` rather than a number typed here, and where the two ever disagree
 * api's message is what the page shows.
 *
 * **The field names are `snake_case` and stay that way.** They are GOV.UK Notify placeholder names, which makes
 * each one the personalisation key, the request-body key and — because api's 400 addresses its errors to them —
 * the name of the form control at once. Renaming one to this repo's camelCase convention breaks the
 * personalisation silently: Notify substitutes nothing and the applicant reads the template with an empty
 * quotation in it.
 */
import type { EmailSlot } from "@hmcts/deed-poll-api-client";
import type { FieldError } from "../errors.js";

/**
 * The business's wording for the slots api ships, keyed by placeholder name.
 *
 * `Object.hasOwn` guards every lookup, so an inherited member name — `"constructor"`, `"toString"` — cannot
 * resolve to a function off `Object.prototype` and reach a page as a label.
 */
const EMAIL_SLOT_LABEL: Record<string, string> = {
  judges_reason: "The Master's reason for refusing the application",
  additional_notes: "Additional notes for the applicant"
};

/** The one slot with a rule of its own to explain — see `requiredMessage`. */
const JUDGES_REASON = "judges_reason";

/**
 * Check one template's slot values, collecting every failure rather than stopping at the first.
 *
 * **Every offending slot at once**, which is what a GOV.UK error summary is for: a caseworker who over-ran the
 * judge's reason and left the notes as prose that will not fit should pay one submission to learn both, not two.
 *
 * `values` is the raw submitted body, so a slot arriving as something other than text — an array from a
 * duplicated control, an object from a tampered post — is a field error rather than a crash, mirroring api's own
 * "must be text". A slot whose `name` api did not publish is skipped: there is no control to address an error to
 * and nothing to put on the wire under.
 *
 * **Blank is absent, which is what makes `required` mean anything**: a judge's reason of spaces must not satisfy
 * it, because an email quoting a judge as having said nothing reads as a quotation until somebody opens it. The
 * trimmed value is what comes back in `slots`, so what was checked is what is sent.
 */
export function validateEmailSlots(slots: readonly EmailSlot[], values: Record<string, unknown>): SlotValidation {
  const errors: FieldError[] = [];
  const validated: Record<string, string> = {};

  for (const slot of slots) {
    const name = slot.name;
    if (name === null || name === undefined || name === "") continue;

    const submitted = values[name];
    if (submitted !== undefined && submitted !== null && typeof submitted !== "string") {
      errors.push({ field: name, message: `${emailSlotLabel(name)} must be text` });
      continue;
    }

    const value = typeof submitted === "string" ? submitted.trim() : "";
    if (value === "") {
      // Required-and-blank only. An absent optional slot is omitted from the body rather than sent as `""`,
      // because api pre-populates an omitted slot and an empty string is a caseworker's answer to it.
      if (slot.required) errors.push({ field: name, message: requiredMessage(name) });
      continue;
    }

    // Refused rather than truncated, as api refuses it: a shortened quotation of a judge is worse than a
    // caseworker being asked to shorten one.
    if (value.length > slot.maxLength) {
      errors.push({ field: name, message: `${emailSlotLabel(name)} must be ${slot.maxLength} characters or fewer` });
      continue;
    }

    validated[name] = value;
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, slots: validated };
}

/**
 * What a caseworker reads above the control for one slot.
 *
 * Keyed by api's placeholder names, with a humanised fallback rather than a blank label: `template` is an open
 * set, so a slot this repo has never seen is a real arrival and `additional_notes` reading "Additional notes" is
 * better than a control with no label at all. The known names get the business's wording, which is this repo's
 * to choose exactly as `../referrals/referrals-view.ts` chooses the referral reasons'.
 */
export function emailSlotLabel(name: string): string {
  return Object.hasOwn(EMAIL_SLOT_LABEL, name) ? EMAIL_SLOT_LABEL[name] : humanise(name);
}

/**
 * Why a required slot cannot be left empty, in the caseworker's terms.
 *
 * `judges_reason` gets its own sentence because the control is not empty when the page opens — api pre-populates
 * it from the judge's direction — so "enter the reason" alone reads as a contradiction to somebody who deleted
 * text that was already there.
 */
function requiredMessage(name: string): string {
  if (name === JUDGES_REASON) return "Enter the Master's reason for refusing the application, as the applicant will read it";

  return `Enter ${lowerFirst(emailSlotLabel(name))}`;
}

/** `additional_notes` → "Additional notes". For a slot with no entry in the label map. */
function humanise(name: string): string {
  const words = name
    .split("_")
    .filter((word) => word.length > 0)
    .join(" ");

  return words.length > 0 ? words.charAt(0).toUpperCase() + words.slice(1) : name;
}

/** "The Master's reason…" → "the Master's reason…", so a label reads as part of a sentence. */
function lowerFirst(label: string): string {
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/**
 * The outcome: the trimmed values ready for the wire, or every field error at once.
 *
 * A discriminated union rather than a thrown error, because the caller is a page handler with a form to
 * re-render — the same reasoning `safeParse` is used for everywhere else in this repo.
 *
 * `slots` is a `Record<string, string>` rather than the adapter's `EmailSlotsWrite`, because the slot set is
 * api's metadata at runtime and not a shape known here; it is assignable to that type, so nothing between this
 * and the wire needs a cast.
 */
export type SlotValidation = { ok: true; slots: Record<string, string> } | { ok: false; errors: FieldError[] };
