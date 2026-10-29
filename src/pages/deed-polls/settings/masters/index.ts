import type { Request, Response } from "express";
import { addMasterSection } from "../../../../service-settings/page.js";

export const POST = addMasterSection;

// A refused add renders at this address, so the language link and a reload GET it.
export const GET = async (_req: Request, res: Response) => {
  res.redirect(302, "/deed-polls/settings#masters");
};
