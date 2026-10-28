/**
 * The confirmation in front of removing a bank holiday. The GET only reads; the removal is the page's one POST.
 *
 * A removal of a date that is no longer listed reads as done: what the Delivery Manager asked for, that the day is not a
 * bank holiday, is true, and a second click of the button is the usual way to get there.
 */
import { deleteBankHoliday, findBankHolidays, NotFoundError } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../auth/current-user.js";
import { pathSegment } from "../path-segment.js";
import { cy, en } from "./content.js";
import { contentFor, SAVED, SETTINGS_PATH, savedRedirect, shortDate } from "./page.js";

export async function showBankHolidayRemove(req: Request, res: Response) {
  const path = removePath(req.params.date);
  const holiday = (await findBankHolidays(callerFromRequest(req))).find((each) => each.date === req.params.date);
  if (!holiday) throw new NotFoundError("No such bank holiday on the list");
  res.render("deed-polls/settings/bank-holiday-remove", {
    en,
    cy,
    // The page shares the settings page's content, whose `title` is the settings page's own.
    title: contentFor(res).removeBankHolidayTitle,
    backLink: `${SETTINGS_PATH}#bank-holidays`,
    holiday: { path, date: shortDate(holiday.date), name: holiday.name ?? "" },
    settingsPath: `${SETTINGS_PATH}#bank-holidays`
  });
}

export async function removeBankHolidayPage(req: Request, res: Response) {
  removePath(req.params.date);
  try {
    await deleteBankHoliday(req.params.date, callerFromRequest(req));
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
  }
  savedRedirect(res, SAVED.bankHolidayRemoved);
}

/** Built before any read or write, so a refused date can never follow a removal. */
function removePath(date: string): string {
  return `${SETTINGS_PATH}/bank-holidays/${pathSegment(date, "Bank holiday date")}/remove`;
}
