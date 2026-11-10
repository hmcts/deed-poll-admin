/**
 * Both directions, because a gate tested only for who it admits is a gate that may admit everyone.
 */
import { ACCESS_GAZETTE, ForbiddenError, MANAGE_PROCESS_CONFIG, VIEW_MANAGEMENT_INFORMATION } from "@hmcts/deed-poll";
import type { NextFunction } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../express-doubles.js";
import { requireAuth } from "./require-auth.js";
import { requireCapability, requireJudicial, requireStaff } from "./require-role.js";

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

  it("names the access and the path in the error, for the log rather than the page", () => {
    requireJudicial()(mounted("/judicial", "GET", "/judicial/referrals/abc"), pageResponse(), next);

    const error = vi.mocked(next).mock.calls[0][0] as unknown as ForbiddenError;
    expect(error.message).toBe("GET /judicial/referrals/abc requires judicial access");
  });

  // The query string is whatever the caller typed or followed — on a list, a search — and the message is logged.
  it("leaves the query string and fragment out of the error", () => {
    const url = `/judicial/referrals?q=${encodeURIComponent("MARKER-Q Smith")}&where=${encodeURIComponent('surname = "MARKER-WHERE"')}&page=MARKER-PAGE#MARKER-FRAGMENT`;

    requireJudicial()(mounted("/judicial", "POST", url), pageResponse(), next);

    const error = vi.mocked(next).mock.calls[0][0] as unknown as ForbiddenError;
    expect(error.message).toBe("POST /judicial/referrals requires judicial access");
    expect(error.message).not.toContain("MARKER");
  });

  it("marks its refusal as the role gate's, so the one error mapping records it as such", () => {
    requireJudicial()(pageRequest({ originalUrl: "/judicial/referrals" }), pageResponse(), next);

    const error = vi.mocked(next).mock.calls[0][0] as unknown as ForbiddenError;
    expect(error.reason).toBe("role");
  });

  it.each(["teamLeader", "deliveryManager", "legacyAdmin", "caseworker", "none"] as const)("refuses a %s, whose stored answer is not judicial", (persona) => {
    requireJudicial()(pageRequest({ persona, originalUrl: "/judicial/referrals" }), pageResponse(), next);

    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
  });

  it("refuses a session whose stored answer is malformed, even one that still lists the judicial role", () => {
    const access = { roles: ["caseworker-deedpoll-judicial"], isJudicial: true, judicial: "true", capabilities: [] };

    requireJudicial()(pageRequest({ access, originalUrl: "/judicial/referrals" }), pageResponse(), next);

    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
  });
});

/** OWASP plan 01 Task 8: the caseworker area admits `staff` in api's answer, and nobody else. */
describe("requireStaff", () => {
  let next: NextFunction;

  beforeEach(() => {
    next = vi.fn();
  });

  it.each(["caseworker", "teamLeader", "deliveryManager", "legacyAdmin"] as const)("lets a %s through, whose stored answer is staff", (persona) => {
    requireStaff()(pageRequest({ persona, originalUrl: "/deed-polls" }), pageResponse(), next);

    expect(next).toHaveBeenCalledWith();
  });

  it("refuses a judge who holds only the judicial role, with a role-gate ForbiddenError", () => {
    requireStaff()(pageRequest({ persona: "judge", originalUrl: "/deed-polls/abc" }), pageResponse(), next);

    const error = vi.mocked(next).mock.calls[0][0] as unknown as ForbiddenError;
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error.reason).toBe("role");
  });

  it("admits a user holding staff and judicial both", () => {
    requireStaff()(pageRequest({ teamLeader: true, judicial: true, originalUrl: "/deed-polls" }), pageResponse(), next);

    expect(next).toHaveBeenCalledWith();
  });

  it.each([
    ["a session api gave no area to", { persona: "none" as const }],
    ["a request with no session user at all", { signedIn: false }],
    ["a session whose stored answer is malformed", { access: { staff: "true", judicial: false, capabilities: [] } }]
  ])("refuses %s, rather than falling through", (_case, options) => {
    requireStaff()(pageRequest({ ...options, originalUrl: "/deed-polls" } as Parameters<typeof pageRequest>[0]), pageResponse(), next);

    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
  });

  it("names the area and the path in the error, without the query string", () => {
    requireStaff()(mounted("/deed-polls", "GET", `/deed-polls/abc?q=${encodeURIComponent("MARKER Smith")}`), pageResponse(), next);

    const error = vi.mocked(next).mock.calls[0][0] as unknown as ForbiddenError;
    expect(error.message).toBe("GET /deed-polls/abc requires staff access");
    expect(error.message).not.toContain("MARKER");
  });

  it("does not render or set a status itself, leaving the 403 to the one error mapping", () => {
    const res = pageResponse();

    requireStaff()(pageRequest({ persona: "judge" }), res, next);

    expect(res.render).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
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
  it.each(["teamLeader", "legacyAdmin", "caseworker", "judge", "none"] as const)(
    "should refuse every Gazette page and form to %s before any API call",
    (persona) => {
      for (const path of paths) {
        for (const method of ["GET", "POST"]) {
          const req = pageRequest({ persona, originalUrl: path });
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
  it("should name the method, the whole path and the capability, and leave the query out", () => {
    const next = vi.fn();
    const url = `/deed-polls/gazette/history?q=${encodeURIComponent("MARKER-Q Smith")}&sort=MARKER-SORT#MARKER-FRAGMENT`;

    requireCapability(ACCESS_GAZETTE)(mounted("/deed-polls/gazette", "GET", url, "caseworker"), pageResponse(), next);

    const error = next.mock.calls[0][0] as ForbiddenError;
    expect(error.message).toBe(`GET /deed-polls/gazette/history requires ${ACCESS_GAZETTE}`);
    expect(error.message).not.toContain("MARKER");
  });
  it("should mark its refusal as the role gate's and name the capability it wanted", () => {
    const next = vi.fn();
    requireCapability(ACCESS_GAZETTE)(pageRequest({ persona: "caseworker" }), pageResponse(), next);
    const error = next.mock.calls[0][0] as ForbiddenError;
    expect(error.reason).toBe("role");
    expect(error.requiredCapability).toBe(ACCESS_GAZETTE);
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

describe("Service settings area access", () => {
  const paths = ["/deed-polls/settings", "/deed-polls/settings/gazette-recipient"];
  it.each(["teamLeader", "legacyAdmin", "caseworker", "judge", "none"] as const)(
    "should refuse every settings page and form to %s before any API call",
    (persona) => {
      for (const path of paths) {
        for (const method of ["GET", "POST"]) {
          const req = pageRequest({ persona, originalUrl: path });
          Object.assign(req, { method, path });
          const res = pageResponse();
          const apiCall = vi.fn();
          const next = vi.fn((error?: unknown) => {
            if (!error) apiCall();
          });
          requireCapability(MANAGE_PROCESS_CONFIG)(req, res, next);
          expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
          expect(apiCall).not.toHaveBeenCalled();
          expect(res.render).not.toHaveBeenCalled();
        }
      }
    }
  );
  it.each([false, true])("should admit a Delivery Manager, with judicial %s", (judicial) => {
    const next = vi.fn();
    requireCapability(MANAGE_PROCESS_CONFIG)(pageRequest({ deliveryManager: true, judicial }), pageResponse(), next);
    expect(next).toHaveBeenCalledExactlyOnceWith();
  });
  it("should mark its refusal as the role gate's and name the capability it wanted", () => {
    const next = vi.fn();
    requireCapability(MANAGE_PROCESS_CONFIG)(pageRequest({ persona: "teamLeader" }), pageResponse(), next);
    const error = next.mock.calls[0][0] as ForbiddenError;
    expect(error.reason).toBe("role");
    expect(error.requiredCapability).toBe(MANAGE_PROCESS_CONFIG);
  });
  it.each(paths)("should redirect anonymous visitors to login for %s before checking capabilities", (url) => {
    const req = pageRequest({ signedIn: false, originalUrl: url });
    Object.assign(req, { method: "GET", path: url });
    const res = pageResponse();
    const gate = vi.fn(() => requireCapability(MANAGE_PROCESS_CONFIG)(req, res, vi.fn()));
    requireAuth()(req, res, gate);
    expect(res.redirect).toHaveBeenCalledWith(`/login?returnTo=${encodeURIComponent(url)}`);
    expect(gate).not.toHaveBeenCalled();
  });
});

describe("Management information area access", () => {
  const paths = ["/deed-polls/management-information", "/deed-polls/management-information/volume.csv"];
  it.each(["legacyAdmin", "caseworker", "judge", "none"] as const)("should refuse the page and every CSV to %s before any API call", (persona) => {
    for (const path of paths) {
      const req = pageRequest({ persona, originalUrl: path });
      Object.assign(req, { method: "GET", path });
      const res = pageResponse();
      const next = vi.fn();
      requireCapability(VIEW_MANAGEMENT_INFORMATION)(req, res, next);
      expect(next).toHaveBeenCalledExactlyOnceWith(expect.any(ForbiddenError));
      expect(res.render).not.toHaveBeenCalled();
    }
  });
  it.each(["teamLeader", "deliveryManager"] as const)("should admit %s", (persona) => {
    const next = vi.fn();
    requireCapability(VIEW_MANAGEMENT_INFORMATION)(pageRequest({ persona }), pageResponse(), next);
    expect(next).toHaveBeenCalledExactlyOnceWith();
  });
  it("should mark its refusal as the role gate's and name the capability it wanted", () => {
    const next = vi.fn();
    requireCapability(VIEW_MANAGEMENT_INFORMATION)(pageRequest({ persona: "caseworker" }), pageResponse(), next);
    const error = next.mock.calls[0][0] as ForbiddenError;
    expect(error.reason).toBe("role");
    expect(error.requiredCapability).toBe(VIEW_MANAGEMENT_INFORMATION);
  });
});

/** A refused request as Express hands it to a gate mounted at `baseUrl`: `path` is the rest, without query or fragment. */
function mounted(baseUrl: string, method: string, originalUrl: string, persona?: "caseworker") {
  const req = pageRequest({ persona, originalUrl });
  return Object.assign(req, { method, baseUrl, path: originalUrl.split(/[?#]/, 1)[0].slice(baseUrl.length) });
}
