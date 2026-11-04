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
  second: "2-digit",
  hourCycle: "h23"
});

/**
 * api's `ReferralWindows.openAt` (plan F1, decision F-4): the referral window open at a moment, in `Europe/London`, or
 * null between the windows, before the morning's, after the afternoon's and all day on a day that is not a working
 * day. A window is open from its start, inclusive, to its end, exclusive.
 *
 * Window times are `HH:mm`, which compare as text in time order; the moment is read to the second, so 10:29:59 is
 * still inside a window ending at 10:30. `isWorkingDay` takes a `yyyy-MM-dd` day.
 */
export function openAt(at: Date, times: WindowTimes, isWorkingDay: (day: string) => boolean): ReferralWindow | null {
  const { day, time } = londonParts(at);
  if (!isWorkingDay(day)) return null;
  if (time >= times.morningStart && time < times.morningEnd) return { date: day, slot: "AM" };
  if (time >= times.afternoonStart && time < times.afternoonEnd) return { date: day, slot: "PM" };
  return null;
}

/**
 * api's `ReferralWindows.nextToOpen`: the first window to open strictly after a moment, so inside a window its
 * successor. Before the morning's start on a working day that morning, from it until the afternoon's start that
 * afternoon, and from then, or on a day that is not a working day, the next working day's morning.
 */
export function nextToOpen(at: Date, times: WindowTimes, isWorkingDay: (day: string) => boolean): ReferralWindow {
  const { day, time } = londonParts(at);
  if (isWorkingDay(day)) {
    if (time < times.morningStart) return { date: day, slot: "AM" };
    if (time < times.afternoonStart) return { date: day, slot: "PM" };
  }
  return { date: nextWorkingDay(day, isWorkingDay), slot: "AM" };
}

/** The moment a window opens: its date at the morning's or the afternoon's start time, in London. */
export function opensAt(window: ReferralWindow, times: WindowTimes): Date {
  return londonInstant(window.date, window.slot === "AM" ? times.morningStart : times.afternoonStart);
}

/** The moment a window closes: its date at the morning's or the afternoon's end time, in London. */
export function closesAt(window: ReferralWindow, times: WindowTimes): Date {
  return londonInstant(window.date, window.slot === "AM" ? times.morningEnd : times.afternoonEnd);
}

/** The `yyyy-MM-dd` day a moment falls on in London. */
export function londonDay(at: Date): string {
  return londonParts(at).day;
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
  return { day: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}:${parts.second}` };
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

// The window times are on the quarter hour between 00:00 and 23:45, and London's clocks change at 01:00 UTC, so
// correcting a UTC guess by the offset found there, then once more at the corrected moment, lands on the time.
function londonInstant(day: string, time: string): Date {
  const guess = Date.parse(`${day}T${time}:00Z`);
  const first = guess - offsetMinutes(new Date(guess)) * 60_000;
  return new Date(guess - offsetMinutes(new Date(first)) * 60_000);
}

function offsetMinutes(at: Date): number {
  const { day, time } = londonParts(at);
  return (Date.parse(`${day}T${time}Z`) - Math.floor(at.getTime() / 1000) * 1000) / 60_000;
}

/** The four `HH:mm` window times, as the process settings hold them. */
export interface WindowTimes {
  morningStart: string;
  morningEnd: string;
  afternoonStart: string;
  afternoonEnd: string;
}

export interface ReferralWindow {
  date: string;
  slot: "AM" | "PM";
}
