/**
 * The Delivery Manager settings page, behind its two forms (plan `docs/plans/20261026-dm-settings-page.md`).
 *
 * Each section posts on its own with only its own revision. The section a POST came from is the *primary* one and
 * is redrawn from the body, never re-read: swapping a fresh revision in under typed text would let the next Save
 * overwrite a change nobody has seen. The other section is *additive*, read again from api, and degrades to a
 * sentence with no form if that read fails, so it can never cost the primary section its errors.
 */
import {
  ACCESS_GAZETTE,
  type Caller,
  ConflictError,
  can,
  ForbiddenError,
  findGazetteSettings,
  findProcessSettings,
  gazetteSettingsFormSchema,
  InvalidInputError,
  processSettingsFormSchema,
  saveGazetteSettings,
  saveProcessSettings,
  UnauthorizedError
} from "@hmcts/deed-poll";
import config from "config";
import type { Request, Response } from "express";
import { callerFromRequest, userFromRequest } from "../auth/current-user.js";
import { forLog } from "../for-log.js";
import { cy, en } from "./content.js";

const PATH = "/deed-polls/settings";
const PROCESS = "process-settings";
const GAZETTE = "gazette-recipient";
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
  const saved = req.query.saved === PROCESS || req.query.saved === GAZETTE ? req.query.saved : undefined;
  await render(req, res, 200, {}, saved);
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
  res.redirect(303, `${PATH}?saved=${PROCESS}#${PROCESS}`);
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
  res.redirect(303, `${PATH}?saved=${GAZETTE}#${GAZETTE}`);
}

function contentFor(res: Response) {
  return res.locals.locale === "cy" ? cy : en;
}

function bodyOf(req: Request): Record<string, unknown> {
  return (req.body ?? {}) as Record<string, unknown>;
}

/** What to redraw for a control: a repeated or bracketed name is invalid, and is redrawn empty rather than as an array. */
function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
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

/** Renders the page, reading whichever section was not given: on a GET both, after a refused POST the other one. */
async function render(req: Request, res: Response, status: number, given: { process?: ProcessSection; gazette?: GazetteSection }, saved?: string) {
  const caller = callerFromRequest(req);
  const locale = res.locals.locale === "cy" ? "cy-GB" : "en-GB";
  const holdsGazette = can(userFromRequest(req), ACCESS_GAZETTE);
  const [process, gazette] = await Promise.all([
    given.process ?? storedProcess(caller, locale),
    holdsGazette ? (given.gazette ?? storedGazette(caller, locale)) : undefined
  ]);
  res.status(status).render("deed-polls/settings/index", {
    en,
    cy,
    process,
    gazette,
    savedSection: saved === GAZETTE && !holdsGazette ? undefined : saved,
    // XUI checks staff-admin itself, so this is a link and never a permission. Per environment from the chart.
    xuiStaffAdminUrl: config.get<string>("externalLinks.xuiStaffAdmin"),
    errorList: errorList(process, gazette)
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

/**
 * A section's read, or `null` if it failed. No read on this page is the whole page, so each degrades on its own,
 * with a log line for whoever is asked why. Except api's 401: that is the session ending, not a panel failing.
 */
async function degraded<T>(name: string, read: () => Promise<T>): Promise<T | null> {
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
function errorList(process: ProcessSection, gazette: GazetteSection | undefined) {
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
      : [])
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
