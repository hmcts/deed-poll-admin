/**
 * A Master's "Change" page: name, email and availability, at the revision the list returned.
 *
 * api publishes no single-Master read, so the page finds its Master on the list. A refused save redraws from the body
 * with its original revision, never a fresh one, and re-reads only whether the Master has signed in, which decides the
 * warning: a changed email unlinks them until the new address signs in. If that read fails the warning is shown,
 * because saying it of a Master who has not signed in costs less than leaving it off one who has.
 */
import { ConflictError, findMasters, InvalidInputError, masterChangeFormSchema, NotFoundError, saveMasterChange } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../auth/current-user.js";
import { pathSegment } from "../path-segment.js";
import { cy, en } from "./content.js";
import { bodyOf, contentFor, degraded, masterFieldErrors, SAVED, SETTINGS_PATH, savedRedirect, textOf } from "./page.js";

const CONTROL_IDS = { name: "#master-name", email: "#master-email", available: "#available" } as const;

export async function showMasterChange(req: Request, res: Response) {
  const path = masterPath(req.params.masterId);
  const master = (await findMasters(callerFromRequest(req))).find((each) => each.id === req.params.masterId);
  if (!master) throw new NotFoundError("No such Master on the list");
  render(res, 200, {
    path,
    isLinked: master.linked,
    values: { name: master.name ?? "", email: master.email ?? "", available: String(master.available), revision: String(master.revision) },
    errors: {}
  });
}

export async function saveMasterChangePage(req: Request, res: Response) {
  const path = masterPath(req.params.masterId);
  const content = contentFor(res);
  const body = bodyOf(req);
  const values = { name: textOf(body.name), email: textOf(body.email), available: textOf(body.available), revision: textOf(body.revision) };
  const refused = async (status: number, failure: { errors?: MasterErrors; reloadText?: string }) =>
    render(res, status, {
      path,
      isLinked: await isLinked(req),
      values,
      errors: failure.errors ?? {},
      ...(failure.reloadText ? { reloadText: failure.reloadText } : {})
    });

  const parsed = masterChangeFormSchema({
    name: content.masterNameError,
    email: content.masterEmailError,
    available: content.masterAvailableError,
    reload: content.masterReload
  }).safeParse(body);
  if (!parsed.success) {
    const issue = (field: string) => parsed.error.issues.find((each) => each.path[0] === field)?.message;
    const errors = Object.fromEntries((["name", "email", "available"] as const).flatMap((field) => (issue(field) ? [[field, issue(field)]] : [])));
    return refused(400, { errors, reloadText: issue("revision") });
  }
  try {
    await saveMasterChange(req.params.masterId, parsed.data, callerFromRequest(req));
  } catch (error) {
    // api checks the revision before the email, so a 409 naming `email` is at the current revision: only the address is wrong.
    if (error instanceof ConflictError) {
      return error.errors.some((each) => each.field === "email")
        ? refused(409, { errors: { email: content.masterDuplicateError } })
        : refused(409, { reloadText: content.masterConflict });
    }
    if (error instanceof InvalidInputError) {
      const fields = error.errors.map((each) => each.field);
      const errors = masterFieldErrors(fields, content);
      const reloadText = fields.includes("revision") ? content.masterReload : Object.keys(errors).length > 0 ? undefined : content.masterRefused;
      return refused(400, { errors, reloadText });
    }
    throw error;
  }
  savedRedirect(res, SAVED.masterChanged);
}

/** Built before any read or write, so a refused id can never follow a save. */
function masterPath(id: string): string {
  return `${SETTINGS_PATH}/masters/${pathSegment(id, "Master id")}`;
}

async function isLinked(req: Request): Promise<boolean> {
  const masters = await degraded("masters", () => findMasters(callerFromRequest(req)));
  return masters?.find((each) => each.id === req.params.masterId)?.linked ?? masters === null;
}

function render(res: Response, status: number, master: MasterChange) {
  const errorList = [
    ...(["name", "email", "available"] as const).flatMap((field) => {
      const text = master.errors[field];
      return text ? [{ text, href: CONTROL_IDS[field] }] : [];
    }),
    ...(master.reloadText ? [{ text: master.reloadText, href: "#reload-master" }] : [])
  ];
  const settingsPath = `${SETTINGS_PATH}#masters`;
  // The page shares the settings page's content, whose `title` is the settings page's own.
  res
    .status(status)
    .render("deed-polls/settings/master", { en, cy, title: contentFor(res).masterChangeTitle, master, settingsPath, backLink: settingsPath, errorList });
}

type MasterErrors = Partial<Record<"name" | "email" | "available", string>>;

interface MasterChange {
  path: string;
  isLinked: boolean;
  values: { name: string; email: string; available: string; revision: string };
  errors: MasterErrors;
  /** Set when the Master must be read again before saving, so the page has no Save. */
  reloadText?: string;
}
