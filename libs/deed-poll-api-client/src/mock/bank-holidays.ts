import { BANK_HOLIDAY_LIMITS, type WireBankHoliday } from "../api/wire.js";

const KEYS = new Set(["date", "name"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** api's bank holiday list, keyed on the date: one name per day, earliest first, a duplicate date a 409. */
export function createBankHolidays() {
  const holidays = new Map<string, string>();

  return {
    reset() {
      holidays.clear();
    },
    list(): WireBankHoliday[] {
      return [...holidays.entries()].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)).map(([date, name]) => ({ date, name }));
    },
    add(body: unknown): Reply {
      const fields = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
      const unknownKey = Object.keys(fields).find((key) => !KEYS.has(key));
      if (unknownKey) return invalid(unknownKey, `${unknownKey} cannot be supplied.`);
      const date = fields.date;
      if (!isCalendarDate(date)) return invalid("date", "Enter the date as yyyy-MM-dd.");
      const name = typeof fields.name === "string" ? fields.name.trim() : "";
      if (name.length < 1 || name.length > BANK_HOLIDAY_LIMITS.maxNameLength) {
        return invalid("name", `Enter a name of 1 to ${BANK_HOLIDAY_LIMITS.maxNameLength} characters.`);
      }
      if (holidays.has(date)) return { status: 409, body: { error: "That date is already a bank holiday." } };

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
