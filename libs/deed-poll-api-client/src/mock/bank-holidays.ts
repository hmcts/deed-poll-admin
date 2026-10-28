import { BANK_HOLIDAY_LIMITS, type WireBankHoliday } from "../api/wire.js";

const KEYS = new Set(["date", "name"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/**
 * The GOV.UK England and Wales dates api's `V42__masters_and_referral_process_settings.sql` seeds, copied from it
 * (api copied them from https://www.gov.uk/bank-holidays on 2026-10-28). A reset restores them.
 */
const SEEDED: readonly (readonly [string, string])[] = [
  ["2026-01-01", "New Year's Day"],
  ["2026-04-03", "Good Friday"],
  ["2026-04-06", "Easter Monday"],
  ["2026-05-04", "Early May bank holiday"],
  ["2026-05-25", "Spring bank holiday"],
  ["2026-08-31", "Summer bank holiday"],
  ["2026-12-25", "Christmas Day"],
  ["2026-12-28", "Boxing Day (substitute day)"],
  ["2027-01-01", "New Year's Day"],
  ["2027-03-26", "Good Friday"],
  ["2027-03-29", "Easter Monday"],
  ["2027-05-03", "Early May bank holiday"],
  ["2027-05-31", "Spring bank holiday"],
  ["2027-08-30", "Summer bank holiday"],
  ["2027-12-27", "Christmas Day (substitute day)"],
  ["2027-12-28", "Boxing Day (substitute day)"],
  ["2028-01-03", "New Year's Day (substitute day)"],
  ["2028-04-14", "Good Friday"],
  ["2028-04-17", "Easter Monday"],
  ["2028-05-01", "Early May bank holiday"],
  ["2028-05-29", "Spring bank holiday"],
  ["2028-08-28", "Summer bank holiday"],
  ["2028-12-25", "Christmas Day"],
  ["2028-12-26", "Boxing Day"]
];
const ALREADY_LISTED = "This date is already a bank holiday.";

/**
 * api's `BankHolidays`, restated in its words: keyed on the date, one name per day, earliest first, a duplicate
 * date a 409 naming `date`, and a removal of an unlisted or malformed date a 404. Starts at api's seed.
 */
export function createBankHolidays() {
  const holidays = new Map<string, string>(SEEDED);

  return {
    reset() {
      holidays.clear();
      for (const [date, name] of SEEDED) holidays.set(date, name);
    },
    list(): WireBankHoliday[] {
      return [...holidays.entries()].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)).map(([date, name]) => ({ date, name }));
    },
    add(body: unknown): Reply {
      const fields = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
      const unknownKey = Object.keys(fields).find((key) => !KEYS.has(key));
      if (unknownKey) return invalid(unknownKey, "Only date and name may be supplied.");
      const date = fields.date;
      if (!isCalendarDate(date)) return invalid("date", "Enter the date as yyyy-MM-dd, like 2029-01-01.");
      const name = typeof fields.name === "string" ? fields.name.trim() : "";
      if (name.length < 1 || name.length > BANK_HOLIDAY_LIMITS.maxNameLength) {
        return invalid("name", `Enter the bank holiday's name, at most ${BANK_HOLIDAY_LIMITS.maxNameLength} characters.`);
      }
      if (holidays.has(date)) return { status: 409, body: { error: ALREADY_LISTED, errors: [{ field: "date", message: ALREADY_LISTED }] } };

      holidays.set(date, name);
      return { status: 201, body: { date, name } };
    },
    /** True when the date was listed. A date that is not, or is not a calendar date, is api's 404. */
    remove(date: string): boolean {
      return isCalendarDate(date) && holidays.delete(date);
    }
  };
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function invalid(field: string, message: string): Reply {
  return { status: 400, body: { error: message, errors: [{ field, message }] } };
}

interface Reply {
  status: number;
  body: unknown;
}
