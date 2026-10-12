/**
 * Request/response doubles for page tests.
 *
 * Shared rather than inlined per file, and the reason is a change this app has already lived through.
 * Phase 5 moved identity from a request header to a session, and
 * every page test that had built its own double with a `header()` function broke at once, because the
 * doubles had no `session` for the namespace helper to write to. One place to change would have been
 * one edit.
 *
 * `pageRequest({ teamLeader: true })` is the signed-in-as-an-teamLeader case, which is what most tests actually
 * want to express; the session shape is an implementation detail they should not have to know.
 *
 * Excluded from the build in `tsconfig.json`: it imports `vitest`, so it must not reach `dist`.
 */
import { currentUser, DEEDPOLL_DELIVERY_MANAGER, DEEDPOLL_JUDICIAL, DEEDPOLL_TEAM_LEADER, type Role } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { vi } from "vitest";

export interface PageRequestOptions {
  params?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
  /** Signed in at all. Defaults to true, since `requireAuth` means a page only runs when someone is. */
  signedIn?: boolean;
  /** Signed in holding the privileged role. */
  teamLeader?: boolean;
  deliveryManager?: boolean;
  roles?: Role[];
  /**
   * Signed in holding the judicial role — the persona `/judicial/**` is for.
   *
   * Independent of `teamLeader` rather than a level above it, because the two are separate personas: a
   * judicial test user who also passed as an teamLeader would make "a caseworker is refused the judicial
   * area" untestable in the direction that matters.
   */
  judicial?: boolean;
  /** Display name recorded in the audit columns. */
  name?: string;
  /** An in-flight login, as `startFlow` leaves it. Only the three flow endpoints care. */
  flow?: unknown;
  /** The stored id token, which logout needs to end the IDAM session. */
  idToken?: string;
  /**
   * The stored access token, which every `deed-poll-api` call is made with.
   *
   * Defaults to undefined rather than to a value, because a page that reads it and a page that does
   * not are both ordinary — and a default would make "the token reaches api" untestable by making it
   * true whether or not the page passed one on.
   */
  accessToken?: string;
  /**
   * The IDAM subject the session was established for.
   *
   * Only the persona switcher reads it — it is how the strip marks which persona you currently are — and it
   * is deliberately not derived from `teamLeader`/`judicial`, because the two answer different questions: those
   * say what the session may do, this says who IDAM authenticated. A session whose subject matches no
   * persona is the ordinary case for a real user, not an error.
   */
  subject?: string;
  originalUrl?: string;
}

export function pageRequest({
  params,
  query,
  body,
  signedIn = true,
  teamLeader = false,
  deliveryManager = false,
  roles: explicitRoles,
  judicial = false,
  name,
  flow,
  idToken,
  accessToken,
  subject,
  originalUrl
}: PageRequestOptions = {}): RequestDouble {
  const roles =
    explicitRoles ??
    [deliveryManager ? DEEDPOLL_DELIVERY_MANAGER : undefined, teamLeader ? DEEDPOLL_TEAM_LEADER : undefined, judicial ? DEEDPOLL_JUDICIAL : undefined].filter(
      (role): role is Role => role !== undefined
    );
  const user = signedIn ? currentUser(roles, name) : undefined;

  const req = {
    params: params ?? {},
    query: query ?? {},
    body,
    originalUrl: originalUrl ?? "/",
    session: sessionDouble({
      ...(user ? { user } : {}),
      ...(flow ? { flow } : {}),
      ...(idToken ? { idToken } : {}),
      ...(accessToken ? { accessToken } : {}),
      ...(subject ? { subject } : {})
    })
  } as unknown as RequestDouble;

  return req;
}

/**
 * A session with the three callback-style methods `express-session` provides.
 *
 * Modelled rather than stubbed to `undefined` because the code under test depends on what they *do*,
 * not just that they are called: `signIn` regenerates before writing the user, and a double whose
 * `regenerate` did nothing would pass whether or not that ordering held. So `regenerate` clears the
 * data, as the real one does, and writing the user first would lose it.
 *
 * Each takes an error-first callback, and each can be made to fail — the save/regenerate error paths
 * are the ones that would otherwise sign someone in without persisting it.
 */
export function sessionDouble(deedPoll: Record<string, unknown> = {}): SessionDouble {
  const session = {
    deedPoll,
    save: vi.fn((callback?: (error?: Error) => void) => callback?.()),
    regenerate: vi.fn((callback?: (error?: Error) => void) => {
      session.deedPoll = {};
      callback?.();
    }),
    destroy: vi.fn((callback?: (error?: Error) => void) => {
      session.deedPoll = {};
      callback?.();
    })
  } as unknown as SessionDouble;

  return session;
}

export type SessionDouble = Request["session"] & {
  deedPoll: Record<string, unknown>;
  save: ReturnType<typeof vi.fn>;
  regenerate: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
};

export type RequestDouble = Request & { session: SessionDouble };

export type ResponseDouble = Response & {
  render: ReturnType<typeof vi.fn>;
  redirect: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
};

export function pageResponse(): ResponseDouble {
  const res = {
    render: vi.fn(),
    redirect: vi.fn(),
    status: vi.fn(),
    setHeader: vi.fn(),
    locals: {}
  } as unknown as ResponseDouble;
  res.status.mockReturnValue(res);
  return res;
}
