/**
 * Where the signed-in user lives between requests, and how the pages read it.
 *
 * This **replaces** `userFromHeaders` as the identity source for this app. The header scheme was
 * always a stand-in — anyone who could reach the service could send `x-user-roles: deedpoll-admin`
 * and become an admin — and Phase 5 is where it goes. It is not merely disabled: reading it is gone
 * from this app entirely, so there is no configuration under which it comes back.
 *
 * Namespaced under `deedPoll` per `.claude/rules/frontend.md`, so a second journey added later cannot
 * collide with it in the same store.
 *
 * Every save below goes through `./guarded-session-store.ts`, which refuses one based on a session that has since been
 * destroyed, expired or written by another request, and the refusal rejects the save's promise. So none of these can
 * put a logged-out session back, and none can replace newer tokens with the snapshot its request started from.
 */
import { type CallerAccess, type CurrentUser, currentUser, holdsCallerAccess, plainHttpPermitted } from "@hmcts/deed-poll";
import type { Request } from "express";
import type { SessionData } from "express-session";
import { type RefreshClaim, SessionWriteRefusedError } from "./guarded-session-store.js";
import type { AuthFlowState, IdamTokens } from "./idam.js";

/** The service name the chart's per-PR Redis subchart gets: `{{ .Release.Name }}-redis-master`. */
const PREVIEW_REDIS_HOST = /^deed-poll-admin-pr-\d+-redis-master$/;

/**
 * The range a session limit may take, in seconds. The floor leaves room for the two-minute warning and a reply to
 * it; the ceiling is the 24-hour cookie these limits replace, so a value above it would be no limit at all.
 */
const MIN_IDLE_TIMEOUT_SECONDS = 300;
const MAX_ABSOLUTE_TIMEOUT_SECONDS = 86_400;

/** How long the store keeps a session nobody is signed in to: enough to finish a sign-in at IDAM. */
const ANONYMOUS_STORE_TTL_SECONDS = 600;
/** How long past the absolute deadline the store keeps a signed-in session, so `sessionLifetime` always ends it first. */
const SIGNED_IN_STORE_GRACE_SECONDS = 900;

/**
 * How many times a write re-reads the session and re-applies its own change after another request's write moved the
 * revision. A refresh's attempts reuse the tokens IDAM already issued, so none of them spends the refresh token again.
 */
const RECONCILE_ATTEMPTS = 3;

/** How `express-session` 1.19's `reload` reports a session the store no longer holds: this message, and no code. */
const RELOAD_FOUND_NOTHING = "failed to load session";

interface DeedPollSession {
  user?: CurrentUser;
  /** Present only between the redirect out to IDAM and the callback back. */
  flow?: AuthFlowState;
  /**
   * The IDAM subject this session was established for.
   *
   * Kept separate from `user` because it is not something authorization is decided on — it is the
   * identity a later refresh is checked against, so the token IDAM hands back cannot quietly describe
   * somebody else. See `refreshTokens`.
   */
  subject?: string;
  /** Kept so logout can end the IDAM session as well as this one. */
  idToken?: string;
  /** Refresh token from IDAM, used to extend the session without re-authentication. */
  refreshToken?: string;
  /** Access token from IDAM, presented to `deed-poll-api` as the caller's bearer credential. */
  accessToken?: string;
  /** Unix timestamp (seconds) when the access token expires. */
  tokenExpiresAt?: number;
  /**
   * Unix timestamp (seconds) of the sign-in this session belongs to: the start of the absolute limit. Only `signIn`
   * writes it, so no refresh can move the deadline. OWASP plan 03, decision 1.
   */
  authenticatedAt?: number;
  /** Unix timestamp (seconds) of the last request that counts as activity: the start of the idle limit. */
  lastSeenAt?: number;
  /** Where a GET was heading when its session timed out, for the timed-out page's sign-in link. Anonymous only. */
  timedOutReturnTo?: string;
}

type SessionWithDeedPoll = Request["session"] & { deedPoll?: DeedPollSession };

/**
 * Read the namespace without creating it.
 *
 * Separate from `writableNamespace` because creating it is not free: `express-session` decides whether to
 * persist a brand-new session by hashing it, so assigning `deedPoll = {}` makes an anonymous session
 * "modified" and it is written to the store despite `saveUninitialized: false`. `requireAuth` is global
 * and calls `sessionUser` on every non-public request, so the mutating form meant one Redis key per
 * anonymous request — every crawler hit and every redirect to `/login` — each held for the cookie's full
 * `maxAge`. The store is a shared cache, so that is someone else's eviction as well as ours.
 */
function namespace(req: Request): DeedPollSession | undefined {
  return (req.session as SessionWithDeedPoll).deedPoll;
}

/** For the writers only, which are all on a path that is about to put something in the session anyway. */
function writableNamespace(req: Request): DeedPollSession {
  const session = req.session as SessionWithDeedPoll;
  session.deedPoll ??= {};
  return session.deedPoll;
}

/**
 * The placeholder in `config/default.json`, which is checked into a public repository.
 *
 * A session cookie is signed with this secret, and after Phase 5 the session is what says a caller is
 * signed in and what api has granted them. So a known secret is not a weak secret — it is no
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

/**
 * The session cookie's name: `__Host-deed-poll-admin-sid` wherever cookies are secure, `deed-poll-admin-sid` where
 * plain http is permitted.
 *
 * The `__Host-` prefix makes the browser accept the cookie only if it is Secure, has `Path=/` and has no `Domain`, so
 * a sibling `*.platform.hmcts.net` site cannot plant or overwrite this app's session. Browsers refuse it over plain
 * http, hence the local form. Not the library default `connect.sid`, which names the framework. Renaming signs every
 * user out once. OWASP plan 03, Task 13.
 */
export function sessionCookieName(): string {
  return plainHttpPermitted() ? "deed-poll-admin-sid" : "__Host-deed-poll-admin-sid";
}

/**
 * Refuse to start on session limits that would not limit anything, and return them once checked.
 *
 * Both values come from `config` with `__format: "json"`, so a mistyped chart value arrives as a string or a fraction
 * rather than failing to parse. Unlike the guards above this applies everywhere, local runs included: a nonsense
 * limit is as wrong on a laptop as in a pod, and the defaults in `config/default.json` satisfy it. The messages name
 * the setting and the rule, never the value. See OWASP plan 03, decision 6.
 */
export function assertSessionTimeouts(idle: unknown, absolute: unknown): SessionTimeouts {
  if (!Number.isInteger(idle) || (idle as number) < MIN_IDLE_TIMEOUT_SECONDS) {
    throw new Error(`SESSION_IDLE_TIMEOUT_SECONDS must be a whole number of seconds, at least ${MIN_IDLE_TIMEOUT_SECONDS}.`);
  }
  if (!Number.isInteger(absolute) || (absolute as number) > MAX_ABSOLUTE_TIMEOUT_SECONDS) {
    throw new Error(`SESSION_ABSOLUTE_TIMEOUT_SECONDS must be a whole number of seconds, at most ${MAX_ABSOLUTE_TIMEOUT_SECONDS}.`);
  }
  if ((idle as number) >= (absolute as number)) {
    throw new Error("SESSION_IDLE_TIMEOUT_SECONDS must be shorter than SESSION_ABSOLUTE_TIMEOUT_SECONDS, or the idle limit could never apply.");
  }
  return { idleSeconds: idle as number, absoluteSeconds: absolute as number };
}

/**
 * How long Redis keeps a session, in seconds, derived from the session rather than from its cookie.
 *
 * connect-redis otherwise takes the TTL from `cookie.expires`, which express-session slides forward on every request,
 * so the key would live as long as anyone kept using it. Here a signed-in session lives until fifteen minutes past
 * its absolute deadline, whatever its activity, so the middleware rather than eviction ends it and signs the user out
 * of IDAM. Anything else lives ten minutes. Never below one second: connect-redis deletes the key on zero or less,
 * which would lose a session mid-request. OWASP plan 03, decision 5.
 */
export function sessionStoreTtl(limits: SessionTimeouts): (sess: SessionData) => number {
  return (sess) => {
    const stored = (sess as SessionData & { deedPoll?: DeedPollSession }).deedPoll;
    if (!stored?.user || stored.authenticatedAt === undefined) return ANONYMOUS_STORE_TTL_SECONDS;
    const remaining = stored.authenticatedAt + limits.absoluteSeconds - nowSeconds();
    return Math.max(1, remaining + SIGNED_IN_STORE_GRACE_SECONDS);
  };
}

/**
 * Refuse to start on a session store URL that cannot be the real one, outside development and test.
 *
 * Two accidents, one guard, and both are silent. `config/default.json` carries
 * `redis://localhost:6379`, so a `redis-url` entry missing or renamed in an environment's vault does not
 * fail — it falls back to a loopback address, and the only symptom is a readiness probe that never goes
 * green next to a repeating `ECONNREFUSED 127.0.0.1:6379`. And a cleartext `redis://` to a real host puts
 * everything this session holds on the wire unencrypted: the IDAM id, access and refresh tokens above.
 * `hmcts/deed-poll-infra` writes a `rediss://` URL against the TLS port, so plain `redis://` in a deployed
 * environment means the value did not come from there.
 *
 * Same allowlist and the same reason as `assertSessionSecret` and `assertIdamSettings`: a
 * `!== "production"` test would accept both in `aat`, in preview, and anywhere `NODE_ENV` is unset.
 *
 * **One exception, for preview only.** Each pull request gets its own throwaway Redis from the chart's subchart,
 * which speaks only `redis://`, and every deployed pod runs `NODE_ENV=production`, so preview could never start.
 * `plaintextPermitted` (`REDIS_PLAINTEXT_PERMITTED`, set only in `values.preview.template.yaml` and pinned there
 * by `src/deployment-chart.test.ts`) admits `redis://` **only** to a host shaped like that subchart's service,
 * `deed-poll-admin-pr-<n>-redis-master`: a bare in-namespace name that no Azure Cache host can match. The tokens
 * still cross the cluster network unencrypted, but only to a per-PR store of short-lived AAT test sessions.
 * Accepted by the tech lead on 2026-10-13 (OWASP blocker B3).
 */
export function assertRedisUrl(url: string, plaintextPermitted = false): void {
  if (plainHttpPermitted()) return;

  // Only ever the scheme and host reach a message. The real value is `rediss://:<access-key>@host:6380`,
  // so interpolating `url` whole would put the cache's access key into stdout and App Insights — where a
  // startup failure is read by more people, and kept for longer, than anything else this app logs.
  const { protocol, hostname } = parseRedisUrl(url);

  // `[::1]` alongside the two IPv4 spellings, because `URL` keeps the brackets on an IPv6 host and a
  // loopback that got past this guard is exactly the silent failure it exists to stop.
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") {
    throw new Error(
      `REDIS_URL is ${protocol}//${hostname} under NODE_ENV ${JSON.stringify(process.env.NODE_ENV)}, which is config/default.json's local placeholder. Nothing is listening on loopback in a pod, so readiness would never go green. It comes from the redis-url key vault entry.`
    );
  }

  if (protocol !== "rediss:") {
    if (plaintextPermitted && protocol === "redis:" && PREVIEW_REDIS_HOST.test(hostname)) return;

    throw new Error(
      `REDIS_URL uses ${protocol} under NODE_ENV ${JSON.stringify(process.env.NODE_ENV)}. Sessions carry IDAM access and refresh tokens, so an unencrypted connection puts them on the wire. The redis-url key vault entry is written as rediss:// against the TLS port.`
    );
  }
}

/**
 * `new URL` throws `TypeError: Invalid URL` and nothing else — no setting name, no origin — so the one
 * input shape this guard exists to explain would be the one it said least about. Rethrown with the same
 * detail as the two checks above, and like them quoting neither the value nor its length: a truncated or
 * mis-quoted vault entry is still an access key.
 */
function parseRedisUrl(url: string): URL {
  try {
    return new URL(url);
  } catch {
    throw new Error(
      `REDIS_URL is not a URL under NODE_ENV ${JSON.stringify(process.env.NODE_ENV)}. The value is not quoted here because it may still carry the access key. It comes from the redis-url key vault entry, written as rediss://<host>:<port>.`
    );
  }
}

/** The signed-in user, or undefined. Undefined means not signed in — never "signed in with no access". */
export function sessionUser(req: Request): CurrentUser | undefined {
  const stored = namespace(req)?.user;
  // The stored `/me` answer is revalidated and its flags rebuilt, so neither a stale flag nor a session from before
  // this shape grants anything.
  return stored ? currentUser(stored, stored.name) : undefined;
}

/**
 * Whether the signed-in user's stored value is a `/me` answer at all, which a session saved before admin read
 * `/me` is not. An answer of no access is still an answer, so only the older session is asked for one.
 */
export function sessionHoldsAccess(req: Request): boolean {
  return holdsCallerAccess(namespace(req)?.user);
}

/**
 * Store a `/me` answer for a session that held none, keeping its name, and save it before resolving.
 *
 * Saved explicitly for the reason `touchLastSeen` is: an end-of-request write of the whole session could overwrite
 * tokens a concurrent request had just refreshed. Touches no token and neither clock.
 *
 * Reloaded first, because this runs after an await on api: the snapshot this request started with can predate a
 * refresh another request has since saved. Only the user is written onto what the store holds now, and nothing is
 * written if that already holds an answer. Reload-then-save is not atomic, so a write landing between the two is a
 * `conflict`, answered by reading again (`saveReconciled`). A session that has gone rejects with `isSessionGone`.
 */
export async function storeAccess(req: Request, access: CallerAccess): Promise<void> {
  await reload(req);
  await saveReconciled(req, (session) => {
    if (holdsCallerAccess(session?.user)) return false;
    const writable = writableNamespace(req);
    writable.user = currentUser(access, writable.user?.name);
    return true;
  });
}

/**
 * Whether a session write or re-read failed because the session itself has gone: logged out, replaced by a sign-in,
 * or expired, by another request while this one held it. Such a request must go on signed out, not as the user its
 * snapshot describes.
 */
export function isSessionGone(error: unknown): boolean {
  return error instanceof SessionWriteRefusedError && error.reason === "missing";
}

export function startFlow(req: Request, flow: AuthFlowState): void {
  writableNamespace(req).flow = flow;
}

/**
 * Take the in-flight flow and clear it in one step, so a code cannot be replayed against the same
 * session: the second attempt finds no verifier and is refused.
 */
export function takeFlow(req: Request): AuthFlowState | undefined {
  const session = namespace(req);
  if (!session) return undefined;
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
export function signIn(req: Request, user: CurrentUser, subject: string, tokens: IdamTokens): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) return reject(error);
      const session = writableNamespace(req);
      session.user = user;
      session.subject = subject;
      session.idToken = tokens.idToken;
      session.accessToken = tokens.accessToken;
      session.refreshToken = tokens.refreshToken;
      session.tokenExpiresAt = tokens.expiresAt;
      // Both clocks start here and only here, so a login and a persona switch each begin a fresh session.
      session.authenticatedAt = nowSeconds();
      session.lastSeenAt = session.authenticatedAt;
      req.session.save((saveError) => (saveError ? reject(saveError) : resolve()));
    });
  });
}

/**
 * The access token, for calling `deed-poll-api` as the signed-in caseworker.
 *
 * api authenticates every caseworker route and derives both the audit author and the admin status from
 * this token, so it is what identity now travels on — not the `CurrentUser` above, which stays what
 * this app's own pages read for their own decisions.
 */
export function sessionAccessToken(req: Request): string | undefined {
  return namespace(req)?.accessToken;
}

/** The id token, for ending the IDAM session at logout. */
export function sessionIdToken(req: Request): string | undefined {
  return namespace(req)?.idToken;
}

/** The refresh token, for extending the session without re-authentication. */
export function sessionRefreshToken(req: Request): string | undefined {
  return namespace(req)?.refreshToken;
}

/** Unix timestamp (seconds) when the current access token expires, or undefined if not logged in. */
export function sessionTokenExpiry(req: Request): number | undefined {
  return namespace(req)?.tokenExpiresAt;
}

/** The IDAM subject this session was established for, which a refresh is checked against. */
export function sessionSubject(req: Request): string | undefined {
  return namespace(req)?.subject;
}

/**
 * When this session was signed in and when it was last active, or undefined unless both are recorded.
 *
 * Undefined rather than a partial answer because a signed-in session without both is one this app cannot time,
 * and the lifetime check ends it rather than guessing.
 */
export function sessionTimestamps(req: Request): SessionTimestamps | undefined {
  const session = namespace(req);
  if (session?.authenticatedAt === undefined || session.lastSeenAt === undefined) return undefined;
  return { authenticatedAt: session.authenticatedAt, lastSeenAt: session.lastSeenAt };
}

/**
 * Record activity now, and save it before resolving.
 *
 * Saved explicitly, at the start of a request, rather than left to `express-session`'s end-of-request write: that
 * write is of the whole session, so a slow upload finishing late could overwrite tokens a concurrent request had
 * just refreshed, and spend a rotated refresh token. OWASP plan 03, decision 3.
 *
 * When another request wrote first (a refresh, say) the session is read again and only the clock is moved on what it
 * now holds, never back, so this request goes on with the winner's tokens rather than writing its own over them. A
 * session that has gone rejects with `isSessionGone`.
 */
export function touchLastSeen(req: Request): Promise<void> {
  const now = nowSeconds();
  return saveReconciled(req, (session) => {
    if (!session?.user) return false;
    writableNamespace(req).lastSeenAt = Math.max(session.lastSeenAt ?? 0, now);
    return true;
  });
}

/**
 * Replace a timed-out session with a fresh anonymous one, holding at most where the user was heading.
 *
 * Regenerated rather than destroyed: the new session carries the destination to the timed-out page, and its id was
 * never the signed-in one. It holds no user or tokens, so `requireAuth` treats it as anonymous, and its store
 * lifetime is the short anonymous one. The caller must already have passed `returnTo` through `safeReturnTo`.
 */
export function restartAfterTimeout(req: Request, returnTo: string | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) return reject(error);
      if (returnTo !== undefined) writableNamespace(req).timedOutReturnTo = returnTo;
      req.session.save((saveError) => (saveError ? reject(saveError) : resolve()));
    });
  });
}

/** Where a timed-out GET was heading, if `restartAfterTimeout` recorded one. */
export function sessionTimedOutReturnTo(req: Request): string | undefined {
  return namespace(req)?.timedOutReturnTo;
}

/**
 * Update stored tokens after a successful refresh, with the `/me` answer for the new token when api gave one.
 *
 * Does NOT regenerate the session — the user was already authenticated, this just extends it. Without an answer
 * the previous one is kept, so a failed `/me` costs no access the caller already had. Written with the tokens in
 * one save rather than a second one.
 *
 * Holds no refresh lease, so the store guards it only by revision. The refresh itself publishes through
 * `publishRefresh`, which also requires the lease; this is the same write without one.
 */
export function updateTokens(req: Request, tokens: IdamTokens, access?: CallerAccess): Promise<void> {
  applyTokens(writableNamespace(req), tokens, access);
  return save(req);
}

/**
 * Take this session's refresh lease, waiting a bounded time if another request (on any instance) holds it.
 *
 * On `acquired` the session has been read again from the store, so the caller decides from what the store holds now,
 * not from the snapshot its request started with: the request it waited on may already have installed new tokens.
 * Fails closed when the store cannot coordinate, rather than refreshing unguarded.
 */
export async function claimRefresh(req: Request): Promise<RefreshClaim> {
  const store = coordinator(req);
  const claim = await store.claimRefresh(req.sessionID, req.session as unknown as SessionData);
  if (claim.outcome !== "acquired") return claim;
  try {
    await reload(req);
  } catch (error) {
    await releaseRefresh(req, claim.lease);
    throw error;
  }
  return claim;
}

/** Give up a refresh lease. A failure is logged and swallowed: the lease expires by itself, and nothing was written. */
export async function releaseRefresh(req: Request, lease: string): Promise<void> {
  // A destroyed session took its lease with it.
  if (!req.session) return;
  try {
    await coordinator(req).releaseRefresh(req.sessionID, lease);
  } catch (error) {
    console.warn("session refresh lease could not be released; it will expire:", error instanceof Error ? error.name : "unknown");
  }
}

/**
 * Store refreshed tokens and the `/me` answer for them in one save, under the refresh lease.
 *
 * Refused outright if the lease has expired or passed to another request (`SessionWriteRefusedError` `lease`), and if
 * the session has gone (`missing`), and never retried with IDAM for either. Another request's write in the meantime
 * (`conflict`) is answered by reading the session again and applying the same tokens to what it now holds, so an
 * activity save or a backfilled answer is kept rather than overwritten with this request's snapshot.
 */
export function publishRefresh(req: Request, lease: string, tokens: IdamTokens, access?: CallerAccess): Promise<void> {
  const store = coordinator(req);
  return saveReconciled(req, () => {
    applyTokens(writableNamespace(req), tokens, access);
    store.attachRefreshLease(req.session as unknown as SessionData, lease);
    return true;
  });
}

/** Destroy the whole session, not just the namespace — logout should leave nothing behind. */
export function signOut(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.destroy((error) => (error ? reject(error) : resolve()));
  });
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function applyTokens(session: DeedPollSession, tokens: IdamTokens, access: CallerAccess | undefined): void {
  if (access && session.user) session.user = currentUser(access, session.user.name);
  session.accessToken = tokens.accessToken;
  session.refreshToken = tokens.refreshToken;
  session.tokenExpiresAt = tokens.expiresAt;
  // `authenticatedAt` and `lastSeenAt` are not touched either: a refresh moving them would make the session endless.
  // `subject` is deliberately not touched: it records who this session was established for, and a
  // refresh that describes someone else is refused by `refreshTokens` rather than adopted here.
  //
  // The id token is optional in a refresh response (OIDC Core §12.2), so the old one is kept when
  // none arrives — it is only needed as the `id_token_hint` at logout, where a stale one still names
  // the right session.
  if (tokens.idToken) session.idToken = tokens.idToken;
}

/**
 * Apply `change` to the session and save it; if another request's write moved the revision first, read the session
 * again and apply the same change to what it now holds, a bounded number of times. `change` sees the namespace as it
 * stands and answers whether there is anything to write, so a re-read that already holds the change writes nothing.
 * Only a `conflict` is retried: a session that has gone, a lost lease or a store failure rejects at once.
 */
async function saveReconciled(req: Request, change: (session: DeedPollSession | undefined) => boolean): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    if (!change(namespace(req))) return;
    try {
      await save(req);
      return;
    } catch (error) {
      if (!(error instanceof SessionWriteRefusedError) || error.reason !== "conflict" || attempt >= RECONCILE_ATTEMPTS) throw error;
    }
    await reload(req);
  }
}

function save(req: Request): Promise<void> {
  return new Promise((resolve, reject) => req.session.save((error) => (error ? reject(error) : resolve())));
}

/** Read the session again from the store. One that has gone is reported as the refusal a write to it would get. */
function reload(req: Request): Promise<void> {
  return new Promise((resolve, reject) =>
    req.session.reload((error) => {
      if (!error) return resolve();
      reject(error instanceof Error && error.message === RELOAD_FOUND_NOTHING ? new SessionWriteRefusedError("missing") : error);
    })
  );
}

/** The store, if it is one that can coordinate refreshes. Anything else is refused rather than refreshed unguarded. */
function coordinator(req: Request): RefreshCoordinator {
  const store = req.sessionStore as Partial<RefreshCoordinator> | undefined;
  if (typeof store?.claimRefresh !== "function" || typeof store.attachRefreshLease !== "function" || typeof store.releaseRefresh !== "function") {
    throw new Error("the session store cannot coordinate token refreshes");
  }
  return store as RefreshCoordinator;
}

/** Session lifetime limits in seconds, as checked by `assertSessionTimeouts`. */
export interface SessionTimeouts {
  idleSeconds: number;
  absoluteSeconds: number;
}

/** What the refresh needs of the store: `GuardedSessionStore`, or a double of it. */
export interface RefreshCoordinator {
  claimRefresh(sid: string, sess: SessionData): Promise<RefreshClaim>;
  attachRefreshLease(sess: SessionData, lease: string): void;
  releaseRefresh(sid: string, lease: string): Promise<void>;
}

/** When a session was signed in and last active, in Unix seconds. */
export interface SessionTimestamps {
  authenticatedAt: number;
  lastSeenAt: number;
}
