const ZONE = "Europe/London";
// api's `ReferralWindows.SEARCH_DAYS`: a year of non-working days is a broken holiday list, not a calendar.
const SEARCH_DAYS = 366;
const LOCAL = new Intl.DateTimeFormat("en-GB", {
  timeZone: ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23"
});

/**
 * api's `ReferralWindows.windowFor` (plan D2, decisions D-5 to D-7): the referral window a moment counts towards, in
 * `Europe/London`. On a working day, before the morning window ends is that day's morning (so before it opens too),
 * before the afternoon window ends is that day's afternoon (so between the two too), and later is the next working
 * day's morning. A day that is not a working day goes to the next working day's morning.
 *
 * Window times are `HH:mm`, which compare as text in time order, so a minute is the finest boundary, as api's
 * `LocalTime.isBefore` is at the times a Delivery Manager can store. `isWorkingDay` takes a `yyyy-MM-dd` day.
 */
export function windowFor(at: Date, times: WindowTimes, isWorkingDay: (day: string) => boolean): ReferralWindow {
  const { day, time } = londonParts(at);
  if (!isWorkingDay(day)) return { date: nextWorkingDay(day, isWorkingDay), slot: "AM" };
  if (time < times.morningEnd) return { date: day, slot: "AM" };
  if (time < times.afternoonEnd) return { date: day, slot: "PM" };
  return { date: nextWorkingDay(day, isWorkingDay), slot: "AM" };
}

/** Monday to Friday and not a listed bank holiday (decision D-7), as api's `BankHolidays.isWorkingDay`. */
export function isWeekdayNotIn(holidays: (day: string) => boolean): (day: string) => boolean {
  return (day) => {
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    return weekday !== 0 && weekday !== 6 && !holidays(day);
  };
}

function londonParts(at: Date): { day: string; time: string } {
  const parts = Object.fromEntries(LOCAL.formatToParts(at).map((part) => [part.type, part.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

function nextWorkingDay(day: string, isWorkingDay: (day: string) => boolean): string {
  const candidate = new Date(`${day}T00:00:00Z`);
  for (let i = 0; i < SEARCH_DAYS; i++) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
    const next = candidate.toISOString().slice(0, 10);
    if (isWorkingDay(next)) return next;
  }
  throw new Error(`No working day within ${SEARCH_DAYS} days`);
}

export interface WindowTimes {
  morningEnd: string;
  afternoonEnd: string;
}

export interface ReferralWindow {
  date: string;
  slot: "AM" | "PM";
}
