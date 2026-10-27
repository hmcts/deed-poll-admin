import type { Request, Response } from "express";

// The recipient moved onto the service settings page. Only GET is kept, because the service is not yet live and
// so no open form can still post here.
export const GET = async (_req: Request, res: Response) => {
  res.redirect(302, "/deed-polls/settings#gazette-recipient");
};
