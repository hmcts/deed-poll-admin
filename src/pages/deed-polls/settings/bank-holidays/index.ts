import type { Request, Response } from "express";

export { addBankHolidaySection as POST } from "../../../../service-settings/page.js";

// A refused add renders at this address, so the language link and a reload GET it.
export const GET = (_req: Request, res: Response) => {
  res.redirect(302, "/deed-polls/settings#bank-holidays");
};
