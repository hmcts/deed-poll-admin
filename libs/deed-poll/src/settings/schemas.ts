import { BANK_HOLIDAY_LIMITS, MASTER_LIMITS, PROCESS_SETTINGS_LIMITS, WINDOW_TIME_PATTERN } from "@hmcts/deed-poll-api-client";
import { z } from "zod";
import { settingsRevision } from "../schema-primitives.js";

// ASCII digits only, unlike the case form's `readNumericInput`: a sign, a fraction or an exponent is not a
// spelling of a duration anyone types into a days box (plan `docs/plans/20261026-dm-settings-page.md`).
const DIGITS = /^\d{1,4}$/;
const WINDOW_TIME = new RegExp(WINDOW_TIME_PATTERN);
const MINUTES_PER_DAY = 1440;
// api's `MasterEmail`: exactly one `@` with something either side, and no whitespace once trimmed.
const MASTER_EMAIL = /^[^\s@]+@[^\s@]+$/;
const DAY = /^\d{1,2}$/;
const YEAR = /^\d{4}$/;

/** api's processing window is whole minutes; the form asks for whole days of it. */
export const PROCESSING_DAYS_LIMITS = {
  min: PROCESS_SETTINGS_LIMITS.minProcessingMinutes / MINUTES_PER_DAY,
  max: PROCESS_SETTINGS_LIMITS.maxProcessingMinutes / MINUTES_PER_DAY
} as const;

/**
 * Reads the referral process section into api's `UpdateProcessSettingsRequest`, every field sent because the form
 * draws every one. Each issue's path is the control it belongs to. The ordering rule is api's, restated so a
 * Delivery Manager sees it beside the field api would name: the morning end, the afternoon start or the afternoon end.
 */
export function processSettingsFormSchema(messages: ProcessSettingsFormMessages) {
  return z
    .object({
      processingDays: wholeNumber(PROCESSING_DAYS_LIMITS.min, PROCESSING_DAYS_LIMITS.max, messages.processingDays),
      reminderIntervalHours: wholeNumber(PROCESS_SETTINGS_LIMITS.minReminderHours, PROCESS_SETTINGS_LIMITS.maxReminderHours, messages.reminderIntervalHours),
      windowCap: wholeNumber(PROCESS_SETTINGS_LIMITS.minWindowCap, PROCESS_SETTINGS_LIMITS.maxWindowCap, messages.windowCap),
      morningWindowStart: windowTime(messages.morningWindowStart),
      morningWindowEnd: windowTime(messages.morningWindowEnd),
      afternoonWindowStart: windowTime(messages.afternoonWindowStart),
      afternoonWindowEnd: windowTime(messages.afternoonWindowEnd),
      revision: settingsRevision(messages.reload)
    })
    .transform(({ processingDays, ...settings }, context) => {
      // `HH:mm` compares as text, so no time arithmetic is needed.
      const ordering = [
        [settings.morningWindowStart >= settings.morningWindowEnd, "morningWindowEnd", messages.morningOrder],
        [settings.morningWindowEnd >= settings.afternoonWindowStart, "afternoonWindowStart", messages.windowsOrder],
        [settings.afternoonWindowStart >= settings.afternoonWindowEnd, "afternoonWindowEnd", messages.afternoonOrder]
      ] as const;
      const refused = ordering.find(([isOutOfOrder]) => isOutOfOrder);
      if (refused) {
        context.addIssue({ code: "custom", path: [refused[1]], message: refused[2] });
        return z.NEVER;
      }
      return { referralClaimExpiryMinutes: processingDays * MINUTES_PER_DAY, ...settings };
    });
}

/** Reads "Add a Master" into api's `CreateMasterRequest`. A new Master is available, which is api's default. */
export function masterFormSchema(messages: MasterFormMessages) {
  return z.object({ name: masterName(messages.name), email: masterEmail(messages.email) });
}

/**
 * Reads a Master's "Change" page into api's `UpdateMasterRequest`. Every field is sent because the page draws every
 * one; api treats an unchanged value as no change.
 */
export function masterChangeFormSchema(messages: MasterChangeFormMessages) {
  return z.object({
    name: masterName(messages.name),
    email: masterEmail(messages.email),
    available: z.enum(["true", "false"], { error: messages.available }).transform((value) => value === "true"),
    revision: settingsRevision(messages.reload)
  });
}

/**
 * Reads "Add a bank holiday" into api's `CreateBankHolidayRequest`. The date comes from a GOV.UK date input's three
 * parts, so every date issue is on `date`, the input's id.
 */
export function bankHolidayFormSchema(messages: BankHolidayFormMessages) {
  return z
    .object({
      "date-day": z.unknown(),
      "date-month": z.unknown(),
      "date-year": z.unknown(),
      name: z.string({ error: messages.name }).trim().min(1, messages.name).max(BANK_HOLIDAY_LIMITS.maxNameLength, messages.name)
    })
    .transform((input, context) => {
      const date = calendarDate(input["date-day"], input["date-month"], input["date-year"]);
      if (!date) {
        context.addIssue({ code: "custom", path: ["date"], message: messages.date });
        return z.NEVER;
      }
      return { date, name: input.name };
    });
}

function wholeNumber(min: number, max: number, message: string) {
  return z
    .string({ error: message })
    .trim()
    .refine((value) => DIGITS.test(value), message)
    .transform(Number)
    .refine((value) => value >= min && value <= max, message);
}

function windowTime(message: string) {
  return z
    .string({ error: message })
    .trim()
    .refine((value) => WINDOW_TIME.test(value), message);
}

function masterName(message: string) {
  return z.string({ error: message }).trim().min(1, message).max(MASTER_LIMITS.maxNameLength, message);
}

function masterEmail(message: string) {
  return z
    .string({ error: message })
    .trim()
    .max(MASTER_LIMITS.maxEmailLength, message)
    .refine((value) => MASTER_EMAIL.test(value), message);
}

/** `yyyy-MM-dd`, or null for anything that is not a real calendar day, a repeated or bracketed part included. */
function calendarDate(...parts: unknown[]): string | null {
  if (!parts.every((part) => typeof part === "string")) return null;
  const [day, month, year] = (parts as string[]).map((part) => part.trim());
  if (!DAY.test(day) || !DAY.test(month) || !YEAR.test(year)) return null;
  const date = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null;
}

export interface ProcessSettingsFormMessages {
  processingDays: string;
  reminderIntervalHours: string;
  windowCap: string;
  morningWindowStart: string;
  morningWindowEnd: string;
  afternoonWindowStart: string;
  afternoonWindowEnd: string;
  morningOrder: string;
  windowsOrder: string;
  afternoonOrder: string;
  reload: string;
}

export interface MasterFormMessages {
  name: string;
  email: string;
}

export interface MasterChangeFormMessages extends MasterFormMessages {
  available: string;
  reload: string;
}

export interface BankHolidayFormMessages {
  date: string;
  name: string;
}
