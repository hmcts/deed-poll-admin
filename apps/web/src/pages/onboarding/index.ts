import type { Request, Response } from "express";

export const GET = (_req: Request, res: Response) => {
  res.redirect("/onboarding/start");
};
