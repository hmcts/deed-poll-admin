/**
 * Both directions, because a gate tested only for who it admits is a gate that may admit everyone.
 */
import {
  ACCESS_GAZETTE,
  DEEDPOLL_ADMIN,
  DEEDPOLL_CASEWORKER,
  DEEDPOLL_DELIVERY_MANAGER,
  DEEDPOLL_JUDICIAL,
  DEEDPOLL_TEAM_LEADER,
  ForbiddenError
} from "@hmcts/deed-poll";
import type { NextFunction } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../express-doubles.js";
import { requireAuth } from "./require-auth.js";
import { requireCapability, requireJudicial, requireRole } from "./require-role.js";

describe("requireJudicial", () => {
  let next: NextFunction;

  beforeEach(() => {
    next = vi.fn();
  });

  it("lets a judicial user through", () => {
    requireJudicial()(pageRequest({ judicial: true, originalUrl: "/judicial/referrals" }), pageResponse(), next);

    expect(next).toHaveBeenCalledWith();
  });

  it("refuses an authenticated caseworker with a ForbiddenError", () => {
    // The persona boundary, and the reason this is a refusal rather than a hidden link: a caseworker
    // does not arrive at a judicial URL by being offered one.
    requireJudicial()(pageRequest({ originalUrl: "/judicial/referrals" }), pageResponse(), next);

    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
  });

  it("refuses an admin, because the judicial role is not a privilege the admin role contains", () => {
    requireJudicial()(pageRequest({ teamLeader: true, originalUrl: "/judicial/referrals" }), pageResponse(), next);

    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
  });

  it("admits a user holding both roles", () => {
    requireJudicial()(pageRequest({ teamLeader: true, judicial: true }), pageResponse(), next);

    expect(next).toHaveBeenCalledWith();
  });

  it("refuses a request with no session user at all, rather than falling through", () => {
    // `requireAuth` runs first and should make this unreachable — which is why it is asserted: the
    // behaviour nobody notices until that gate has a hole.
    requireJudicial()(pageRequest({ signedIn: false }), pageResponse(), next);

    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
  });

  it("does not render or set a status itself, leaving the 403 to the one error mapping", () => {
    // `src/errors.ts` answers ForbiddenError with a 403 and the shared not-found view. A second
    // rendering here would be a second opinion on the status and on how much a refusal discloses.
    const res = pageResponse();

    requireJudicial()(pageRequest(), res, next);

    expect(res.render).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("names the role and the path in the error, for the log rather than the page", () => {
    requireJudicial()(pageRequest({ originalUrl: "/judicial/referrals/abc" }), pageResponse(), next);

    const error = vi.mocked(next).mock.calls[0][0] as unknown as ForbiddenError;
    expect(error.message).toContain(DEEDPOLL_JUDICIAL);
    expect(error.message).toContain("/judicial/referrals/abc");
  });
});

describe("requireRole", () => {
  it("gates on the role it is given, so a second area needs no second middleware", () => {
    const next = vi.fn();

    requireRole(DEEDPOLL_JUDICIAL)(pageRequest({ judicial: true }), pageResponse(), next);

    expect(next).toHaveBeenCalledWith();
  });
});

describe("Gazette area access", () => {
  const paths = [
    "/deed-polls/gazette",
    "/deed-polls/gazette/history",
    "/deed-polls/gazette/settings",
    "/deed-polls/gazette/batch",
    "/deed-polls/gazette/requests",
    "/deed-polls/gazette/requests/a-batch"
  ];
  it.each([DEEDPOLL_TEAM_LEADER, DEEDPOLL_ADMIN, DEEDPOLL_CASEWORKER, DEEDPOLL_JUDICIAL])(
    "should refuse every Gazette page and form to %s before any API call",
    (role) => {
      for (const path of paths) {
        for (const method of ["GET", "POST"]) {
          const req = pageRequest({ roles: [role], originalUrl: path });
          Object.assign(req, { method, path });
          const res = pageResponse();
          const apiCall = vi.fn();
          const next = vi.fn((error?: unknown) => {
            if (!error) apiCall();
          });
          requireCapability(ACCESS_GAZETTE)(req, res, next);
          expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
          expect(apiCall).not.toHaveBeenCalled();
          expect(res.render).not.toHaveBeenCalled();
        }
      }
    }
  );
  it.each([false, true])("should admit Delivery Manager independently, with judicial %s", (judicial) => {
    const next = vi.fn();
    requireCapability(ACCESS_GAZETTE)(pageRequest({ deliveryManager: true, judicial }), pageResponse(), next);
    expect(next).toHaveBeenCalledExactlyOnceWith();
  });
  it.each(paths)("should redirect anonymous visitors to login for %s before checking capabilities", (url) => {
    const req = pageRequest({ signedIn: false, originalUrl: url });
    Object.assign(req, { method: "GET", path: url });
    const res = pageResponse();
    const gate = vi.fn(() => requireCapability(ACCESS_GAZETTE)(req, res, vi.fn()));
    requireAuth()(req, res, gate);
    expect(res.redirect).toHaveBeenCalledWith(`/login?returnTo=${encodeURIComponent(url)}`);
    expect(gate).not.toHaveBeenCalled();
  });
});
