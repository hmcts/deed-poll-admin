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
import { type CurrentUser, plainHttpPermitted } from "@hmcts/deed-poll";
import type { Request } from "express";
import type { AuthFlowState } from "./idam.js";

interface DeedPollSession {
  user?: CurrentUser;
  /** Present only between the redirect out to IDAM and the callback back. */
  flow?: AuthFlowState;
  /** Kept so logout can end the IDAM session as well as this one. */
  idToken?: string;
  /** Refresh token from IDAM, used to extend the session without re-authentication. */
  refreshToken?: string;
  /** Access token from IDAM, currently unused but kept for future API calls. */
  accessToken?: string;
  /** Unix timestamp (seconds) when the access token expires. */
  tokenExpiresAt?: number;
}

type SessionWithDeedPoll = Request["session"] & { deedPoll?: DeedPollSession };

function namespace(req: Request): DeedPollSession {
  const session = req.session as SessionWithDeedPoll;
  session.deedPoll ??= {};
  return session.deedPoll;
}

/**
 * The placeholder in `config/default.json`, which is checked into a public repository.
 *
 * A session cookie is signed with this secret, and after Phase 5 the session is what says a caller is
 * signed in and which roles they hold. So a known secret is not a weak secret — it is no
 * authentication at all: anyone can mint a cookie asserting `deedpoll-admin` and skip IDAM entirely.
 * The login flow this app now has would be decoration.
 */
const PLACEHOLDER_SESSION_SECRET = "session-secret";

/**
 * Refuse to start with the checked-in session secret outside development and test.
 *
 * Failing at startup rather than warning, because the failure it prevents is silent: everything works,
 * users log in, and the sessions are forgeable. Nothing about running would reveal it.
 *
 * Same allowlist as `plainHttpPermitted` and for the same reason — a `!== "production"` test would
 * leave the placeholder acceptable in `aat`, in a preview environment, and anywhere `NODE_ENV` is
 * simply unset.
 */
export function assertSessionSecret(secret: string): void {
  if (secret !== PLACEHOLDER_SESSION_SECRET || plainHttpPermitted()) return;

  throw new Error(
    `SESSION_SECRET is still the placeholder from config/default.json under NODE_ENV ${JSON.stringify(process.env.NODE_ENV)}. Session cookies signed with it are forgeable, so anyone could assert any role without logging in. Set it from the key vault.`
  );
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

export interface TokenSet {
  idToken?: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

/**
 * Record a successful login.
 *
 * The session id is regenerated first. Without that, a session fixation attack works: an attacker
 * plants a known session cookie, the victim logs in, and the attacker's cookie is now authenticated.
 * Regenerating means the id the victim ends up with was never known to anyone else.
 */
export function signIn(req: Request, user: CurrentUser, tokens: TokenSet): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) return reject(error);
      const session = namespace(req);
      session.user = user;
      session.idToken = tokens.idToken;
      session.accessToken = tokens.accessToken;
      session.refreshToken = tokens.refreshToken;
      session.tokenExpiresAt = tokens.expiresAt;
      req.session.save((saveError) => (saveError ? reject(saveError) : resolve()));
    });
  });
}

/** The id token, for ending the IDAM session at logout. */
export function sessionIdToken(req: Request): string | undefined {
  return namespace(req).idToken;
}

/** The refresh token, for extending the session without re-authentication. */
export function sessionRefreshToken(req: Request): string | undefined {
  return namespace(req).refreshToken;
}

/** Unix timestamp (seconds) when the current access token expires, or undefined if not logged in. */
export function sessionTokenExpiry(req: Request): number | undefined {
  return namespace(req).tokenExpiresAt;
}

/**
 * Update stored tokens after a successful refresh.
 *
 * Does NOT regenerate the session — the user was already authenticated, this just extends it.
 */
export function updateTokens(req: Request, tokens: TokenSet): Promise<void> {
  return new Promise((resolve, reject) => {
    const session = namespace(req);
    session.accessToken = tokens.accessToken;
    session.refreshToken = tokens.refreshToken;
    session.tokenExpiresAt = tokens.expiresAt;
    // ID token may or may not be refreshed depending on IDAM's response
    if (tokens.idToken) session.idToken = tokens.idToken;
    req.session.save((error) => (error ? reject(error) : resolve()));
  });
}

/** Destroy the whole session, not just the namespace — logout should leave nothing behind. */
export function signOut(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.destroy((error) => (error ? reject(error) : resolve()));
  });
}
