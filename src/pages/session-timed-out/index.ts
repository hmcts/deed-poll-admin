/**
 * Where a timed-out session lands, after `sessionLifetime` has ended it here and at IDAM.
 *
 * Public, because the user it is for is no longer signed in. A GET arrives from IDAM's end-session redirect once
 * this address is registered for the client (OWASP plan 03, Task 10); until then IDAM returns to `/`. A timed-out
 * POST never arrives here as a request: `sessionLifetime` renders this page itself, with a 401, because what was
 * submitted was not saved and must not be replayed.
 */
import type { Request, Response } from "express";
import { safeReturnTo } from "../../auth/return-to.js";
import { sessionTimedOutReturnTo } from "../../auth/session.js";

const en = {
  title: "You have been signed out",
  body: "You were signed out because you had not used the service for a while, or had been signed in for too long. This protects the information in the service.",
  unsavedText: "Any changes you were making were not saved.",
  signIn: "Sign in again"
};

const cy = {
  title: "Rydych wedi cael eich allgofnodi",
  body: "Cawsoch eich allgofnodi oherwydd nad oeddech wedi defnyddio’r gwasanaeth ers tro, neu oherwydd eich bod wedi mewngofnodi am ormod o amser. Mae hyn yn diogelu’r wybodaeth yn y gwasanaeth.",
  unsavedText: "Ni chafodd unrhyw newidiadau yr oeddech yn eu gwneud eu cadw.",
  signIn: "Mewngofnodi eto"
};

export const GET = async (req: Request, res: Response) => {
  // Through `safeReturnTo` again on the way out, although it was stored that way: this link is a redirect sink.
  const returnTo = safeReturnTo(sessionTimedOutReturnTo(req));
  renderTimedOut(res, { unsaved: false, signInHref: `/login?returnTo=${encodeURIComponent(returnTo)}` });
};

/** Shared with `sessionLifetime`, which renders this page for a timed-out POST. */
export function renderTimedOut(res: Response, view: TimedOutView): void {
  res.render("session-timed-out/index", { en, cy, ...view });
}

interface TimedOutView {
  /** True for a timed-out POST: what was submitted was not saved. */
  unsaved: boolean;
  signInHref: string;
}
