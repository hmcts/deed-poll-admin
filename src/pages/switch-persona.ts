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
 * **A token request that fails reaches the 500 page, and that is task 3's deliberate limit.** Locally the only
 * causes are the simulator being down or `yarn idam:users` not having been run. In AAT there is a third — the
 * client is not registered for `password` — and telling the tester which of the three it was is task 5's job,
 * together with the personas AAT cannot offer at all. A message invented here would have to be wrong about AAT.
 */
import type { NextFunction, Request, Response } from "express";
import { passwordGrantLogin } from "../auth/password-grant.js";
import { personaCredentials, personaSwitcherEnabled } from "../auth/persona-switcher.js";
import { signIn } from "../auth/session.js";
import { idamSettings } from "../auth/settings.js";

export const POST = async (req: Request, res: Response, next: NextFunction) => {
  if (!personaSwitcherEnabled()) return next();

  // The body is whatever was posted, so the id is `unknown` all the way into the lookup — `personaCredentials`
  // resolves it against the configured personas or not at all.
  const credentials = personaCredentials((req.body as { persona?: unknown } | undefined)?.persona);
  if (!credentials) return next();

  const switched = await passwordGrantLogin(idamSettings(), credentials.username, credentials.password);
  await signIn(req, switched.user, switched.subject, switched.tokens);

  // `/` and not a list path: `src/pages/index.ts` decides which home the new persona gets, and a destination
  // chosen here would be a second copy of that routing — wrong for the judge the day it drifts.
  res.redirect("/");
};
