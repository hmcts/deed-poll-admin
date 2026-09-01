/**
 * Where the signed-in user lives between requests, and how the pages read it.
 *
 * This **replaces** `userFromHeaders` as the identity source for `apps/web`. The header scheme was
 * always a stand-in — anyone who could reach the service could send `x-user-roles: deedpoll-admin`
 * and become an admin — and Phase 5 is where it goes. It is not merely disabled: reading it is gone
 * from this app entirely, so there is no configuration under which it comes back.
 *
 * Namespaced under `deedPoll` per `.claude/rules/frontend.md`, so it cannot collide with the
 * onboarding journey's session data in the same store.
 */
import type { CurrentUser } from "@hmcts/deed-poll";
import type { Request } from "express";
import type { AuthFlowState } from "./idam.js";

interface DeedPollSession {
  user?: CurrentUser;
  /** Present only between the redirect out to IDAM and the callback back. */
  flow?: AuthFlowState;
  /** Kept so logout can end the IDAM session as well as this one. */
  idToken?: string;
}

type SessionWithDeedPoll = Request["session"] & { deedPoll?: DeedPollSession };

function namespace(req: Request): DeedPollSession {
  const session = req.session as SessionWithDeedPoll;
  session.deedPoll ??= {};
  return session.deedPoll;
}

/** The signed-in user, or undefined. Undefined means not signed in — never "signed in with no roles". */
export function sessionUser(req: Request): CurrentUser | undefined {
  return namespace(req).user;
}

export function startFlow(req: Request, flow: AuthFlowState): void {
  namespace(req).flow = flow;
}

/**
 * Take the in-flight flow and clear it in one step, so a code cannot be replayed against the same
 * session: the second attempt finds no verifier and is refused.
 */
export function takeFlow(req: Request): AuthFlowState | undefined {
  const session = namespace(req);
  const flow = session.flow;
  session.flow = undefined;
  return flow;
}

/**
 * Record a successful login.
 *
 * The session id is regenerated first. Without that, a session fixation attack works: an attacker
 * plants a known session cookie, the victim logs in, and the attacker's cookie is now authenticated.
 * Regenerating means the id the victim ends up with was never known to anyone else.
 */
export function signIn(req: Request, user: CurrentUser, idToken: string | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) return reject(error);
      const session = namespace(req);
      session.user = user;
      session.idToken = idToken;
      req.session.save((saveError) => (saveError ? reject(saveError) : resolve()));
    });
  });
}

/** The id token, for ending the IDAM session at logout. */
export function sessionIdToken(req: Request): string | undefined {
  return namespace(req).idToken;
}

/** Destroy the whole session, not just the namespace — logout should leave nothing behind. */
export function signOut(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.destroy((error) => (error ? reject(error) : resolve()));
  });
}
