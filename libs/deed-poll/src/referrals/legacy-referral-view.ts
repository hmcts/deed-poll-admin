/**
 * The previous system's referral record, as a read-only snapshot on the Referrals tab.
 *
 * **Why this exists at all.** `referrals-admin-4` decision 2 retires the "Referral to Master" fields for new
 * work: referrals are raised, read and closed through api's referral entity, and the editable tab those fields
 * sat on goes. But a migrated case may carry a real business record in them — which judge, what they directed,
 * when the decision came back — and retiring a field must not make its value unreadable.
 *
 * **Built from `LEGACY_REFERRAL_TAB`, never from a list of labels typed out here.** The field defs carry the
 * labels and the kinds, so `formatValue` renders a date, an enum and a boolean exactly as the case detail page
 * always did, and a label corrected in one place is corrected on this panel too.
 *
 * **Populated fields only, which is the opposite of the detail card's rule.** That page keeps empty rows so
 * every field stays where staff expect it on a form they are still filling in (`../deed-poll/detail-view.ts`).
 * There is no such form any more: this is a historical record, and a column of "Not provided" against ten
 * retired fields would say a case has referral history it does not have.
 *
 * **`null` when nothing is populated, and the panel then renders no section.** The absence of these values is
 * the evidence that there is no snapshot — not `migratedRecord`, which says where a case came from rather than
 * whether these ten fields hold anything. One of the ten is excluded from that test rather than from the
 * snapshot, because api populates it on every case — see `ALWAYS_POPULATED_FIELDS`.
 */
import { formatValue } from "../deed-poll/detail-view.js";
import { type FieldDef, LEGACY_REFERRAL_TAB } from "../deed-poll/form-fields.js";

/** The retired fields, flattened once. */
const LEGACY_REFERRAL_FIELDS: FieldDef[] = LEGACY_REFERRAL_TAB.sections.flatMap((section) => section.fields);

/**
 * The retired field whose value is **no evidence of a referral**, because api publishes one for every case.
 *
 * `publishToLondonGazette` is `z.boolean()` on the wire — not nullable, and `deed-poll-validation.ts` defaults it
 * to `false` at create — so "does this case hold a value?" is `true` of every case ever raised. Counting it as
 * evidence put a "Previous system referral information" heading on all of them, over a single row, on cases that
 * had never been near the judiciary. It is a live case field that happened to sit on the referral form: it gates
 * `dateNoticeSentToLondonGazette` through `getFieldRules`, which is why it has a value whether or not anyone
 * answered a question.
 *
 * It is still **rendered** in a snapshot that exists — a migrated referral's Gazette answer is part of that
 * record — it just cannot bring one into being on its own.
 */
const ALWAYS_POPULATED_FIELDS = ["publishToLondonGazette"];

/**
 * The populated legacy referral fields, or null when the case holds nothing anybody recorded about a referral.
 *
 * Takes the case as a property bag rather than a `DeedPoll`, like `buildDetailTabs` does: the names come from
 * the field defs, so a typed parameter would only restate the metadata that is already the source of truth.
 */
export function buildLegacyReferralView(record: Record<string, unknown>): LegacyReferralView | null {
  const populated = LEGACY_REFERRAL_FIELDS.filter((field) => isPopulated(record[field.name]));
  const recorded = populated.filter((field) => !ALWAYS_POPULATED_FIELDS.includes(field.name));

  if (recorded.length === 0) return null;

  return { rows: populated.map((field) => ({ key: field.label, value: formatValue(field, record[field.name]) })) };
}

/**
 * Does this case actually hold a value for the field?
 *
 * **`false` and `0` count as values.** `publishToLondonGazette` is a boolean, and a stored `false` is the answer
 * "no" that somebody recorded — dropping it would turn a decided question back into an unasked one. So the test
 * is for absence (null, undefined, blank, no selections) rather than for falsiness.
 */
function isPopulated(raw: unknown): boolean {
  if (raw === null || raw === undefined) return false;
  if (typeof raw === "string") return raw.trim().length > 0;
  if (Array.isArray(raw)) return raw.length > 0;

  return true;
}

/** The snapshot as its summary list renders it. Only fields the case holds a value for. */
export interface LegacyReferralView {
  rows: { key: string; value: string }[];
}
