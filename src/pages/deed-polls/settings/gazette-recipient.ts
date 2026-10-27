import type { Request, Response } from "express";
import { saveGazetteSection } from "../../../service-settings/page.js";

export const POST = saveGazetteSection;

// A refused save renders at this address, so the language link and a reload GET it. Without this they were a 404.
export const GET = async (_req: Request, res: Response) => {
  res.redirect(302, "/deed-polls/settings#gazette-recipient");
};
