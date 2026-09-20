/**
 * The persona switch: sign the caller in as one of the configured test personas, then send them to `/`.
 *
 * **`POST` and nothing else** (decision 6). The module exports no `GET`, so `simple-router` registers none and
 * a crafted URL — in a mail, in an `<img>` on another site — cannot change anybody's persona. `requireAuth` is
 * global, so a switch also needs an existing session: the strip is only rendered to someone signed in, and
 * there is no persona to change before that.
 *
 * **It swaps identity, not roles.** `passwordGrantLogin` obtains a real IDAM token for the persona's own user,
 * so api authorises the new persona correctly and stamps the audit columns with it. See that file for why the
 * obvious alternative — rewriting `CurrentUser.roles` — produces a UI that lies.
 *
 * **`signIn` and deliberately not `updateTokens`.** Three reasons, and the middle one is the trap this task
 * exists for:
 *
 *   - It replaces the **refresh token** as well as the access token. `refreshMiddleware` renews five minutes
 *     before expiry, so a session left holding the previous user's refresh token quietly reverts to them
 *     mid-test — which presents as the app losing your persona at random rather than as a bug here.
 *   - It replaces `subject`, which `updateTokens` deliberately does not touch. A switch that left the old
 *     subject in place would make the *next* refresh fail the identity check in `refreshTokens` and sign the
 *     tester out instead, so the half-measure is broken either way round.
 *   - It regenerates the session id, as any change of authenticated identity should.
 *
 * **A refusal is a 404, via `next()` to the not-found handler.** Both the shut gate and an unknown persona id
 * take that path: it is the same non-enumerability argument as `/judicial/**`'s, so nothing about the response
 * says whether this route exists in this environment or which ids it would accept.
 *
 * **A persona that cannot be obtained renders its reason and not the 500 page** (task 5). `loginAsPersona`
 * classifies the failure — an unpublished role, a client registered for neither grant type, IDAM unreachable —
 * and this handler's only job is to say so on a page. The distinction that matters is between *this* and the
 * two refusals above: a 404 is "there is no such thing here", and a 503 with a reason is "there is, and it
 * cannot work in this environment, and here is who fixes that". A tester told the first about the second goes
 * looking for a bug in the switcher.
 */
import type { NextFunction, Request, Response } from "express";
import { personaFor, personaSwitcherEnabled } from "../auth/persona-switcher.js";
import { loginAsPersona } from "../auth/persona-users.js";
import { signIn } from "../auth/session.js";
import { idamSettings } from "../auth/settings.js";

/**
 * The refusal page's own text, English only.
 *
 * Same reasoning as the strip's `COPY` (`src/auth/persona-switcher.ts`): `scripts/extract-welsh-strings.mjs`
 * builds the translation request from `src/locales` and the page directories on its `INCLUDE` list, so text put
 * there would bill a translator for a development tool whose audience is whoever is testing the service.
 */
const COPY = {
  title: "This persona is not available in this environment",
  back: "Back",
  backLink: "/",
  /** The strip is on this page too, so "go back and pick another" is a real instruction rather than a gesture. */
  guidance: "Use the persona switcher above to choose another, or carry on as the persona you are now."
};

export const POST = async (req: Request, res: Response, next: NextFunction) => {
  if (!personaSwitcherEnabled()) return next();

  // The body is whatever was posted, so the id is `unknown` all the way into the lookup — `personaFor` resolves
  // it against the configured personas or not at all.
  const persona = personaFor((req.body as { persona?: unknown } | undefined)?.persona);
  if (!persona) return next();

  const switched = await loginAsPersona(idamSettings(), persona);
  if (!switched.ok) {
    // 503 and not 400: nothing the tester sent is wrong, and nothing they can retype makes it work. It is also
    // not a 500 — this is a known state of a known environment, and the page names it.
    return res.status(503).render("switch-persona", { ...COPY, personaName: persona.name, reason: switched.reason });
  }

  await signIn(req, switched.login.user, switched.login.subject, switched.login.tokens);

  // `/` and not a list path: `src/pages/index.ts` decides which home the new persona gets, and a destination
  // chosen here would be a second copy of that routing — wrong for the judge the day it drifts.
  res.redirect("/");
};
