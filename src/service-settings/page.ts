/**
 * The Delivery Manager settings page, behind its forms (plans `docs/plans/20261026-dm-settings-page.md` and
 * `docs/plans/20261028-da1-settings-contract-mock-and-page.md`).
 *
 * Each section posts on its own with only its own revision. The section a POST came from is the *primary* one and
 * is redrawn from the body, never re-read: swapping a fresh revision in under typed text would let the next Save
 * overwrite a change nobody has seen. The other section is *additive*, read again from api, and degrades to a
 * sentence with no form if that read fails, so it can never cost the primary section its errors. The Masters and the
 * bank holidays are lists with an add form under each: the lists are always read, and only a refused add form is
 * redrawn from the body.
 */
import {
  ACCESS_GAZETTE,
  bankHolidayFormSchema,
  type Caller,
  ConflictError,
  can,
  ForbiddenError,
  findBankHolidays,
  findGazetteSettings,
  findMasters,
  findProcessSettings,
  gazetteSettingsFormSchema,
  InvalidInputError,
  masterFormSchema,
  processSettingsFormSchema,
  saveBankHoliday,
  saveGazetteSettings,
  saveNewMaster,
  saveProcessSettings,
  UnauthorizedError
} from "@hmcts/deed-poll";
import config from "config";
import type { Request, Response } from "express";
import { callerFromRequest, userFromRequest } from "../auth/current-user.js";
import { forLog } from "../for-log.js";
import { pathSegment } from "../path-segment.js";
import { cy, en } from "./content.js";

export const SETTINGS_PATH = "/deed-polls/settings";
/** Each `?saved=` a save redirects with, and the section it returns to. */
export const SAVED = {
  process: { key: "process-settings", section: "process-settings" },
  gazette: { key: "gazette-recipient", section: "gazette-recipient" },
  masterAdded: { key: "master-added", section: "masters" },
  masterChanged: { key: "master-changed", section: "masters" },
  bankHolidayAdded: { key: "bank-holiday-added", section: "bank-holidays" },
  bankHolidayRemoved: { key: "bank-holiday-removed", section: "bank-holidays" }
} as const;

const PATH = SETTINGS_PATH;
const GAZETTE = SAVED.gazette.key;
const SAVED_KEYS: ReadonlySet<string> = new Set(Object.values(SAVED).map((each) => each.key));
const PROCESS_CONTROLS = [
  "processingDays",
  "reminderIntervalHours",
  "masterWindowCap",
  "morningWindowStart",
  "morningWindowEnd",
  "afternoonWindowStart",
  "afternoonWindowEnd"
] as const;
const MINUTES_PER_DAY = 1440;

export async function showSettings(req: Request, res: Response) {
  const saved = typeof req.query.saved === "string" && SAVED_KEYS.has(req.query.saved) ? req.query.saved : undefined;
  await render(req, res, 200, {}, saved);
}

/** Every redirect after a save goes through here, so a section's banner and its fragment cannot drift apart. */
export function savedRedirect(res: Response, saved: (typeof SAVED)[keyof typeof SAVED]) {
  res.redirect(303, `${PATH}?saved=${saved.key}#${saved.section}`);
}

export async function saveProcessSection(req: Request, res: Response) {
  const content = contentFor(res);
  const body = bodyOf(req);
  const values = Object.fromEntries([...PROCESS_CONTROLS, "revision"].map((name) => [name, textOf(body[name])])) as ProcessValues;
  const parsed = processSettingsFormSchema({
    processingDays: content.processingDaysError,
    reminderIntervalHours: content.reminderIntervalError,
    masterWindowCap: content.masterWindowCapError,
    morningWindowStart: content.morningWindowStartError,
    morningWindowEnd: content.morningWindowEndError,
    afternoonWindowStart: content.afternoonWindowStartError,
    afternoonWindowEnd: content.afternoonWindowEndError,
    morningOrder: content.morningOrderError,
    windowsOrder: content.windowsOrderError,
    afternoonOrder: content.afternoonOrderError,
    reload: content.processReload
  }).safeParse(body);
  if (!parsed.success) {
    const issue = (path: string) => parsed.error.issues.find((each) => each.path[0] === path)?.message;
    const errors = Object.fromEntries(PROCESS_CONTROLS.flatMap((name) => (issue(name) ? [[name, issue(name)]] : [])));
    return render(req, res, 400, { process: processFailure(values, { errors, reloadText: issue("revision") }) });
  }
  try {
    await saveProcessSettings(parsed.data, callerFromRequest(req));
  } catch (error) {
    if (error instanceof ConflictError) return render(req, res, 409, { process: processFailure(values, { reloadText: content.processConflict }) });
    if (error instanceof InvalidInputError) {
      const errors = apiFieldErrors(
        error.errors.map((each) => each.field),
        content
      );
      const hasControl = Object.keys(errors).length > 0;
      const reloadText = error.errors.some((each) => each.field === "revision") ? content.processReload : hasControl ? undefined : content.processRefused;
      return render(req, res, 400, { process: processFailure(values, { errors, reloadText }) });
    }
    throw error;
  }
  savedRedirect(res, SAVED.process);
}

export async function saveGazetteSection(req: Request, res: Response) {
  // The area gate admits every Delivery Manager; this section is also Gazette's, and api checks that capability too.
  if (!can(userFromRequest(req), ACCESS_GAZETTE)) {
    throw new ForbiddenError(`${req.method} ${req.baseUrl}${req.path} requires ${ACCESS_GAZETTE}`, { reason: "role", requiredCapability: ACCESS_GAZETTE });
  }
  const content = contentFor(res);
  const body = bodyOf(req);
  const values = { recipientEmail: textOf(body.recipientEmail), revision: textOf(body.revision) };
  const parsed = gazetteSettingsFormSchema({ required: content.gazetteRequired, invalid: content.gazetteInvalid, reload: content.gazetteReload }).safeParse(
    body
  );
  if (!parsed.success) {
    const issue = (path: string) => parsed.error.issues.find((each) => each.path[0] === path)?.message;
    return render(req, res, 400, { gazette: gazetteFailure(values, { emailError: issue("recipientEmail"), reloadText: issue("revision") }) });
  }
  try {
    await saveGazetteSettings(parsed.data, callerFromRequest(req));
  } catch (error) {
    if (error instanceof ConflictError) return render(req, res, 409, { gazette: gazetteFailure(values, { reloadText: content.gazetteConflict }) });
    if (error instanceof InvalidInputError) {
      const emailError = error.errors.some((field) => field.field === "recipientEmail") ? content.gazetteInvalid : undefined;
      return render(req, res, 400, { gazette: gazetteFailure(values, { emailError, reloadText: emailError ? undefined : content.gazetteRefused }) });
    }
    throw error;
  }
  savedRedirect(res, SAVED.gazette);
}

export async function addMasterSection(req: Request, res: Response) {
  const content = contentFor(res);
  const body = bodyOf(req);
  const values = { name: textOf(body.name), email: textOf(body.email) };
  const parsed = masterFormSchema({ name: content.masterNameError, email: content.masterEmailError }).safeParse(body);
  if (!parsed.success) {
    const issue = (path: string) => parsed.error.issues.find((each) => each.path[0] === path)?.message;
    return render(req, res, 400, { masterAdd: { values, errors: dropEmpty({ name: issue("name"), email: issue("email") }) } });
  }
  try {
    await saveNewMaster(parsed.data, callerFromRequest(req));
  } catch (error) {
    // A new Master has no revision, so api's only 409 here is an email another Master holds.
    if (error instanceof ConflictError) return render(req, res, 409, { masterAdd: { values, errors: { email: content.masterDuplicateError } } });
    if (error instanceof InvalidInputError) {
      const errors = masterFieldErrors(
        error.errors.map((each) => each.field),
        content
      );
      return render(req, res, 400, { masterAdd: { values, errors, ...(Object.keys(errors).length > 0 ? {} : { refusedText: content.masterRefused }) } });
    }
    throw error;
  }
  savedRedirect(res, SAVED.masterAdded);
}

export async function addBankHolidaySection(req: Request, res: Response) {
  const content = contentFor(res);
  const body = bodyOf(req);
  const values = { day: textOf(body["date-day"]), month: textOf(body["date-month"]), year: textOf(body["date-year"]), name: textOf(body.name) };
  const parsed = bankHolidayFormSchema({ date: content.bankHolidayDateError, name: content.bankHolidayNameError }).safeParse(body);
  if (!parsed.success) {
    const issue = (path: string) => parsed.error.issues.find((each) => each.path[0] === path)?.message;
    return render(req, res, 400, { holidayAdd: { values, errors: dropEmpty({ date: issue("date"), name: issue("name") }) } });
  }
  try {
    await saveBankHoliday(parsed.data, callerFromRequest(req));
  } catch (error) {
    if (error instanceof ConflictError) return render(req, res, 409, { holidayAdd: { values, errors: { date: content.bankHolidayDuplicateError } } });
    if (error instanceof InvalidInputError) {
      const fields = error.errors.map((each) => each.field);
      const errors = dropEmpty({
        date: fields.includes("date") ? content.bankHolidayDateError : undefined,
        name: fields.includes("name") ? content.bankHolidayNameError : undefined
      });
      return render(req, res, 400, { holidayAdd: { values, errors, ...(Object.keys(errors).length > 0 ? {} : { refusedText: content.bankHolidayRefused }) } });
    }
    throw error;
  }
  savedRedirect(res, SAVED.bankHolidayAdded);
}

/** api's field errors on a Master, in this page's words, keyed on the field. Shared with the "Change" page. */
export function masterFieldErrors(fields: string[], content: typeof en): Partial<Record<"name" | "email" | "available", string>> {
  return dropEmpty({
    name: fields.includes("name") ? content.masterNameError : undefined,
    email: fields.includes("email") ? content.masterEmailError : undefined,
    available: fields.includes("available") ? content.masterAvailableError : undefined
  });
}

export function contentFor(res: Response) {
  return res.locals.locale === "cy" ? cy : en;
}

export function bodyOf(req: Request): Record<string, unknown> {
  return (req.body ?? {}) as Record<string, unknown>;
}

/** What to redraw for a control: a repeated or bracketed name is invalid, and is redrawn empty rather than as an array. */
export function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** A bank holiday's day as `dd-mm-yy`, the form Steve chose for the Master's page, from api's `yyyy-MM-dd`. */
export function shortDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}-${month}-${year.slice(2)}`;
}

function dropEmpty<K extends string>(errors: Record<K, string | undefined>): Partial<Record<K, string>> {
  return Object.fromEntries(Object.entries(errors).filter(([, text]) => text !== undefined)) as Partial<Record<K, string>>;
}

/**
 * api's field errors in this page's words, on the control holding the field. The form has already checked each time's
 * format, so api naming a window's end or the afternoon start is its ordering rule, which it reports on those fields.
 */
function apiFieldErrors(fields: string[], content: typeof en): ProcessErrors {
  const messages: Record<string, [ProcessControl, string]> = {
    referralClaimExpiryMinutes: ["processingDays", content.processingDaysError],
    reminderIntervalHours: ["reminderIntervalHours", content.reminderIntervalError],
    masterWindowCap: ["masterWindowCap", content.masterWindowCapError],
    morningWindowStart: ["morningWindowStart", content.morningWindowStartError],
    morningWindowEnd: ["morningWindowEnd", content.morningOrderError],
    afternoonWindowStart: ["afternoonWindowStart", content.windowsOrderError],
    afternoonWindowEnd: ["afternoonWindowEnd", content.afternoonOrderError]
  };
  return Object.fromEntries(fields.flatMap((field) => (Object.hasOwn(messages, field) ? [messages[field]] : [])));
}

function processFailure(values: ProcessValues, failure: SectionErrors & { errors?: ProcessErrors }): ProcessForm {
  return { isAvailable: true, values, errors: failure.errors ?? {}, ...(failure.reloadText ? { reloadText: failure.reloadText } : {}) };
}

function gazetteFailure(values: GazetteValues, errors: SectionErrors & { emailError?: string }): GazetteForm {
  return { isAvailable: true, values, isUnset: false, ...errors };
}

/**
 * Renders the page, reading whichever section was not given: on a GET every one, after a refused POST the others.
 * The two lists are always read; only their add forms can be given.
 */
async function render(
  req: Request,
  res: Response,
  status: number,
  given: {
    process?: ProcessSection;
    gazette?: GazetteSection;
    masterAdd?: AddForm<MasterAddValues, "name" | "email">;
    holidayAdd?: AddForm<HolidayAddValues, "date" | "name">;
  },
  saved?: string
) {
  const caller = callerFromRequest(req);
  const locale = res.locals.locale === "cy" ? "cy-GB" : "en-GB";
  const holdsGazette = can(userFromRequest(req), ACCESS_GAZETTE);
  const [process, gazette, masters, bankHolidays] = await Promise.all([
    given.process ?? storedProcess(caller, locale),
    holdsGazette ? (given.gazette ?? storedGazette(caller, locale)) : undefined,
    storedMasters(caller),
    storedBankHolidays(caller)
  ]);
  const masterAdd = given.masterAdd ?? { values: { name: "", email: "" }, errors: {} };
  const holidayAdd = given.holidayAdd ?? { values: { day: "", month: "", year: "", name: "" }, errors: {} };
  res.status(status).render("deed-polls/settings/index", {
    en,
    cy,
    process,
    gazette,
    masters,
    masterAdd,
    bankHolidays,
    holidayAdd,
    savedSection: saved === GAZETTE && !holdsGazette ? undefined : saved,
    // XUI checks staff-admin itself, so this is a link and never a permission. Per environment from the chart.
    xuiStaffAdminUrl: config.get<string>("externalLinks.xuiStaffAdmin"),
    errorList: errorList(process, gazette, masterAdd, holidayAdd)
  });
}

async function storedProcess(caller: Caller, locale: string): Promise<ProcessSection> {
  const settings = await degraded("process settings", () => findProcessSettings(caller));
  if (!settings) return { isAvailable: false };
  return {
    isAvailable: true,
    values: {
      // A window api holds in part-days (only an old claim window can be) is shown as it is, never rounded, so the
      // digits-only form refuses it and a Save cannot silently change it.
      processingDays: String(Number((settings.referralClaimExpiryMinutes / MINUTES_PER_DAY).toFixed(2))),
      reminderIntervalHours: String(settings.reminderIntervalHours),
      masterWindowCap: String(settings.masterWindowCap),
      morningWindowStart: settings.morningWindowStart ?? "",
      morningWindowEnd: settings.morningWindowEnd ?? "",
      afternoonWindowStart: settings.afternoonWindowStart ?? "",
      afternoonWindowEnd: settings.afternoonWindowEnd ?? "",
      revision: String(settings.revision)
    },
    errors: {},
    isNeverChanged: !settings.updatedAt,
    ...attribution(settings, locale)
  };
}

async function storedGazette(caller: Caller, locale: string): Promise<GazetteSection> {
  const settings = await degraded("gazette settings", () => findGazetteSettings(caller));
  if (!settings) return { isAvailable: false };
  return {
    isAvailable: true,
    values: { recipientEmail: settings.recipientEmail ?? "", revision: String(settings.revision) },
    isUnset: !settings.recipientEmail,
    ...attribution(settings, locale)
  };
}

async function storedMasters(caller: Caller): Promise<ListSection<MasterRow>> {
  const masters = await degraded("masters", () => findMasters(caller));
  if (!masters) return { isAvailable: false };
  return {
    isAvailable: true,
    rows: masters.map((master) => ({
      changePath: `${PATH}/masters/${pathSegment(master.id, "Master id")}`,
      name: master.name ?? "",
      email: master.email ?? "",
      isAvailable: master.available,
      isLinked: master.linked
    }))
  };
}

async function storedBankHolidays(caller: Caller): Promise<ListSection<HolidayRow>> {
  const holidays = await degraded("bank holidays", () => findBankHolidays(caller));
  if (!holidays) return { isAvailable: false };
  return {
    isAvailable: true,
    rows: holidays.map((holiday) => ({
      removePath: `${PATH}/bank-holidays/${pathSegment(holiday.date, "Bank holiday date")}/remove`,
      date: shortDate(holiday.date),
      name: holiday.name ?? ""
    }))
  };
}

/**
 * A section's read, or `null` if it failed. No read on this page is the whole page, so each degrades on its own,
 * with a log line for whoever is asked why. Except api's 401: that is the session ending, not a panel failing.
 */
export async function degraded<T>(name: string, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof UnauthorizedError) throw error;
    console.error(`${name} unavailable: ${forLog(error instanceof Error ? error.message : String(error))}`);
    return null;
  }
}

function attribution(settings: { updatedBy?: string | null; updatedAt?: Date | null }, locale: string) {
  return {
    updatedBy: settings.updatedBy ?? undefined,
    updatedAt: settings.updatedAt?.toLocaleString(locale, { dateStyle: "long", timeStyle: "short", timeZone: "Europe/London" })
  };
}

/** Every link names a control the page draws. */
function errorList(
  process: ProcessSection,
  gazette: GazetteSection | undefined,
  masterAdd: AddForm<MasterAddValues, "name" | "email">,
  holidayAdd: AddForm<HolidayAddValues, "date" | "name">
) {
  return [
    ...(process.isAvailable
      ? [
          ...PROCESS_CONTROLS.flatMap((name) => {
            const text = process.errors[name];
            return text ? [{ text, href: `#${name}` }] : [];
          }),
          ...(process.reloadText ? [{ text: process.reloadText, href: "#reload-process-settings" }] : [])
        ]
      : []),
    ...(gazette?.isAvailable
      ? [
          ...(gazette.emailError ? [{ text: gazette.emailError, href: "#recipientEmail" }] : []),
          ...(gazette.reloadText ? [{ text: gazette.reloadText, href: "#reload-gazette-recipient" }] : [])
        ]
      : []),
    ...(masterAdd.errors.name ? [{ text: masterAdd.errors.name, href: "#master-name" }] : []),
    ...(masterAdd.errors.email ? [{ text: masterAdd.errors.email, href: "#master-email" }] : []),
    ...(masterAdd.refusedText ? [{ text: masterAdd.refusedText, href: "#master-name" }] : []),
    ...(holidayAdd.errors.date ? [{ text: holidayAdd.errors.date, href: "#bank-holiday-date-day" }] : []),
    ...(holidayAdd.errors.name ? [{ text: holidayAdd.errors.name, href: "#bank-holiday-name" }] : []),
    ...(holidayAdd.refusedText ? [{ text: holidayAdd.refusedText, href: "#bank-holiday-date-day" }] : [])
  ];
}

type ProcessControl = (typeof PROCESS_CONTROLS)[number];

type ProcessValues = Record<ProcessControl | "revision", string>;

type ProcessErrors = Partial<Record<ProcessControl, string>>;

interface GazetteValues {
  recipientEmail: string;
  revision: string;
}

/** `reloadText` set means the stored value must be read again before this section can save, so it has no Save. */
interface SectionErrors {
  reloadText?: string;
  updatedBy?: string;
  updatedAt?: string;
}

interface ProcessForm extends SectionErrors {
  isAvailable: true;
  values: ProcessValues;
  /** Only a read can say so: a refused POST redraws from the body, which carries no attribution. */
  isNeverChanged?: boolean;
  errors: ProcessErrors;
}

interface GazetteForm extends SectionErrors {
  isAvailable: true;
  values: GazetteValues;
  isUnset: boolean;
  emailError?: string;
}

type ProcessSection = { isAvailable: false } | ProcessForm;

type GazetteSection = { isAvailable: false } | GazetteForm;

interface MasterAddValues {
  name: string;
  email: string;
}

interface HolidayAddValues {
  day: string;
  month: string;
  year: string;
  name: string;
}

/** An add form under a list. It has no revision, so a refusal it cannot place on a control is `refusedText`. */
interface AddForm<V, K extends string> {
  values: V;
  errors: Partial<Record<K, string>>;
  refusedText?: string;
}

interface MasterRow {
  changePath: string;
  name: string;
  email: string;
  isAvailable: boolean;
  isLinked: boolean;
}

interface HolidayRow {
  removePath: string;
  date: string;
  name: string;
}

type ListSection<R> = { isAvailable: false } | { isAvailable: true; rows: R[] };
