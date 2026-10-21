/**
 * Where logout lands when IDAM's end-session page is unavailable: IDAM advertises none, or cannot be reached (R04;
 * plan `docs/plans/completed/20261021-r04b-signed-out-page.md`).
 *
 * Public, because its visitor has just signed out. Sign-in is a link, never a redirect: `/` would send an anonymous
 * visitor straight to IDAM, and during an outage IDAM's own session survives, so the person who clicked "Sign out"
 * on a shared PC would be signed back in once IDAM recovers. For the same reason the copy says "this service" and not
 * everywhere.
 */
import type { Request, Response } from "express";

const en = {
  title: "You have signed out",
  body: "You have signed out of this service.",
  signIn: "Sign in again"
};

// English pending translation, like the rest of the service's new copy; "Mewngofnodi eto" is the timed-out page's.
const cy = {
  ...en,
  signIn: "Mewngofnodi eto"
};

export const GET = async (_req: Request, res: Response) => {
  res.render("signed-out/index", { en, cy, signInHref: "/login" });
};
