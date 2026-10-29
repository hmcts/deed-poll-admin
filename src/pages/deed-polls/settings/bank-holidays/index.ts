import type { Request, Response } from "express";
import { addBankHolidaySection } from "../../../../service-settings/page.js";

export const POST = addBankHolidaySection;

// A refused add renders at this address, so the language link and a reload GET it.
export const GET = async (_req: Request, res: Response) => {
  res.redirect(302, "/deed-polls/settings#bank-holidays");
};
