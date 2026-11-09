import type { Request, Response } from "express";

export { saveGazetteSection as POST } from "../../../service-settings/page.js";

// A refused save renders at this address, so the language link and a reload GET it. Without this they were a 404.
export const GET = (_req: Request, res: Response) => {
  res.redirect(302, "/deed-polls/settings#gazette-recipient");
};
