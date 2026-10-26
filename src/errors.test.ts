/**
 * The domain-error-to-page mapping, which had no unit test until the role gate made its 403 branch reachable.
 *
 * It was covered only by whichever page test happened to throw past it and by the judicial e2e journey — and
 * that journey does not run in the pipeline (`e2e-tests` has no `test` script, and only `@smoke` runs after a
 * deploy). So the one place that decides what a refused caseworker sees was verified by nothing CI runs.
 *
 * What matters here is the status/view pairing rather than the rendering: a 403 answering the **404** view is
 * what keeps a guessed `/judicial/**` URL from saying whether that resource exists, and it is exactly the kind of
 * deliberate mismatch a later reader "corrects". The 403 status still discloses the area (review finding R14).
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { type AddressInfo, connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, pipeline } from "node:stream";
import { ACCESS_GAZETTE, ConflictError, ForbiddenError, InvalidInputError, NotFoundError, TooManyRequestsError, UnauthorizedError } from "@hmcts/deed-poll";
import { trackEvent } from "@hmcts-cft/cloud-native-platform";
import { errorHandler } from "@hmcts-cft/express-govuk-starter";
import express, { type NextFunction } from "express";
import nunjucks from "nunjucks";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireCapability, requireJudicial } from "./auth/require-role.js";
import { requireSameOrigin } from "./auth/same-origin.js";
import { domainErrorHandler } from "./errors.js";
import { pageResponse } from "./express-doubles.js";

vi.mock("@hmcts-cft/cloud-native-platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts-cft/cloud-native-platform")>()),
  trackEvent: vi.fn()
}));

const REQUEST = { path: "/judicial/referrals", session: {} } as never;

describe("domainErrorHandler", () => {
  let next: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    next = vi.fn();
  });

  it("should render the 404 page for a case that is not there", () => {
    const res = pageResponse();

    domainErrorHandler()(new NotFoundError("Case c-1 not found"), REQUEST, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.render).toHaveBeenCalledWith("errors/404");
    expect(next).not.toHaveBeenCalled();
  });

  // 403 so the refusal is honest to a client, which also tells it the area exists and is closed to it (R14); the
  // 404 view so a caseworker who guessed the URL is not told whether that resource exists. `errors/403` exists and
  // is deliberately not used here — it belongs to the login flow, where the user knows who they are.
  it("should answer a forbidden request with a 403 status on the 404 view, which names nothing about the resource", () => {
    const res = pageResponse();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    domainErrorHandler()(new ForbiddenError("/judicial/referrals requires judicial access"), REQUEST, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.render).toHaveBeenCalledWith("errors/404");
    expect(res.render).not.toHaveBeenCalledWith("errors/403");
    error.mockRestore();
  });

  // The render is the end of the road — the starter's handler, the only thing in the chain that logs, is never
  // reached — so a refusal on the app's one authorization boundary leaves no trace unless this line writes it.
  it("should log the refusal, because nothing downstream of it will", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    domainErrorHandler()(new ForbiddenError("/judicial/referrals requires judicial access"), REQUEST, pageResponse(), next);

    expect(error).toHaveBeenCalledWith(expect.stringContaining("/judicial/referrals requires judicial access"));
    error.mockRestore();
  });

  it("should log an api message on one line when the message carries a newline", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    domainErrorHandler()(new ForbiddenError("refused\nINFO auth.login.succeeded subject=forged"), REQUEST, pageResponse(), next);

    expect(error).toHaveBeenCalledWith("forbidden: refusedINFO auth.login.succeeded subject=forged");
    error.mockRestore();
  });

  describe("security events for a refusal", () => {
    const refusedRequest = {
      method: "POST",
      baseUrl: "",
      path: "/deed-polls/gazette/batch",
      originalUrl: "/deed-polls/gazette/batch?q=Smith",
      sessionID: "a-refused-session-id",
      session: { deedPoll: { subject: "idam-subject-1", accessToken: "a-refused-token" } }
    } as never;
    const common = {
      subject: "idam-subject-1",
      sid: createHash("sha256").update("a-refused-session-id").digest("hex").slice(0, 16),
      env: "test",
      method: "POST",
      route: "/deed-polls/gazette/batch"
    };

    beforeEach(() => {
      vi.spyOn(console, "error").mockImplementation(() => {});
    });

    it("should emit one authz.denied from the role gate, with the capability it wanted", () => {
      const error = new ForbiddenError("/deed-polls/gazette/batch requires ACCESS_GAZETTE", {
        reason: "role",
        requiredCapability: "ACCESS_GAZETTE"
      });

      domainErrorHandler()(error, refusedRequest, pageResponse(), next);

      expect(vi.mocked(trackEvent).mock.calls).toEqual([["authz.denied", { ...common, source: "role", requiredCapability: "ACCESS_GAZETTE" }]]);
    });

    it("should emit one authz.denied sourced to api when api refuses, which is what a bare ForbiddenError means", () => {
      domainErrorHandler()(new ForbiddenError("Gazette access refused"), refusedRequest, pageResponse(), next);

      expect(vi.mocked(trackEvent).mock.calls).toEqual([["authz.denied", { ...common, source: "api" }]]);
    });

    it("should emit one csrf.refused, not authz.denied, for a cross-site write", () => {
      const error = new ForbiddenError("POST /deed-polls/gazette/batch from a same-site initiator", {
        reason: "same-origin",
        fetchSite: "same-site"
      });

      domainErrorHandler()(error, refusedRequest, pageResponse(), next);

      expect(vi.mocked(trackEvent).mock.calls).toEqual([["csrf.refused", { ...common, fetchSite: "same-site" }]]);
    });

    it("should record the origin's host for a cross-site write from a browser without fetch metadata", () => {
      const error = new ForbiddenError("POST /deed-polls/gazette/batch from cross-origin https://evil.example", {
        reason: "same-origin",
        originHost: "evil.example"
      });

      domainErrorHandler()(error, refusedRequest, pageResponse(), next);

      expect(vi.mocked(trackEvent).mock.calls).toEqual([["csrf.refused", { ...common, originHost: "evil.example" }]]);
    });

    it("should keep the token, the query string and the log message out of the event", () => {
      domainErrorHandler()(new ForbiddenError("Gazette access refused"), refusedRequest, pageResponse(), next);

      const serialised = JSON.stringify(vi.mocked(trackEvent).mock.calls);
      expect(serialised).not.toContain("a-refused-token");
      expect(serialised).not.toContain("Smith");
      expect(serialised).not.toContain("a-refused-session-id");
      expect(serialised).not.toContain("Gazette access refused");
    });
  });

  // The gates' messages are this handler's log line, so the one place to prove a refusal logs no request value is
  // over real HTTP with the gates mounted as `app.ts` mounts them, capturing what is actually written.
  describe("what a gate's refusal writes to the log", () => {
    const QUERY = `?q=${encodeURIComponent("MARKER-Q Smith")}&where=${encodeURIComponent('surname = "MARKER-WHERE"')}&other=MARKER-OTHER`;
    const app = express()
      .use((req, res, next) => {
        Object.assign(req, { session: {} });
        Object.assign(res, { render: (view: string) => res.send(view) });
        next();
      })
      .use(requireSameOrigin())
      .use("/judicial", requireJudicial())
      .use("/deed-polls/gazette", requireCapability(ACCESS_GAZETTE))
      .use((_req, res) => res.send("reached"))
      .use(domainErrorHandler());

    let logged: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      logged = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      logged.mockRestore();
    });

    it.each([
      [
        "a same-site write",
        () => request(app).post(`/deed-polls/new${QUERY}`).set("Sec-Fetch-Site", "same-site"),
        "POST /deed-polls/new from a same-site initiator",
        "csrf.refused"
      ],
      [
        "a write with an unrecognised Sec-Fetch-Site",
        () => request(app).post(`/deed-polls/new${QUERY}`).set("Sec-Fetch-Site", "MARKER-SITE"),
        "POST /deed-polls/new from an unrecognised Sec-Fetch-Site value",
        "csrf.refused"
      ],
      [
        "a cross-origin write without fetch metadata",
        () => request(app).post(`/deed-polls/new${QUERY}`).set("Origin", "https://MARKER-ORIGIN.example"),
        "POST /deed-polls/new from a cross-origin Origin",
        "csrf.refused"
      ],
      [
        "a non-judge on the judicial area",
        () => request(app).get(`/judicial/referrals${QUERY}`),
        "GET /judicial/referrals requires judicial access",
        "authz.denied"
      ],
      [
        "a caller without Gazette access",
        () => request(app).get(`/deed-polls/gazette/history${QUERY}`),
        `GET /deed-polls/gazette/history requires ${ACCESS_GAZETTE}`,
        "authz.denied"
      ]
    ])("should log %s with its route and reason and no query or header value", async (_case, send, line, event) => {
      const response = await send();

      expect(response.status).toBe(403);
      expect(response.text).toBe("errors/404");
      expect(logged.mock.calls).toEqual([[`forbidden: ${line}`]]);
      expect(vi.mocked(trackEvent).mock.calls.map(([name]) => name)).toEqual([event]);
      expect(JSON.stringify([logged.mock.calls, vi.mocked(trackEvent).mock.calls])).not.toContain("MARKER");
    });

    it("should still admit a same-origin write and a read outside the gated areas", async () => {
      const write = await request(app).post(`/deed-polls/new${QUERY}`).set("Sec-Fetch-Site", "same-origin");
      const read = await request(app).get(`/deed-polls${QUERY}`);

      expect([write.text, read.text]).toEqual(["reached", "reached"]);
      expect(logged).not.toHaveBeenCalled();
    });
  });

  // A handler that validates input is expected to catch this and re-render its form with the errors against the
  // fields. Reaching here means one did not, so it is passed on to be logged as the bug it is.
  it("should pass an uncaught validation failure on to be logged rather than rendering a form-shaped page", () => {
    const error = new InvalidInputError("400", [{ field: "decision", message: "Select a decision" }]);
    const res = pageResponse();

    domainErrorHandler()(error, REQUEST, res, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(res.render).not.toHaveBeenCalled();
  });

  describe("when api refuses the session's token", () => {
    const sessionRequest = (method: string) => {
      const destroy = vi.fn((callback: (error?: Error) => void) => callback());
      return { req: { method, originalUrl: "/deed-polls/c-1/notes/new", session: { destroy } } as never, destroy };
    };

    beforeEach(() => {
      vi.spyOn(console, "error").mockImplementation(() => {});
    });

    // What an AAT persona hit once testing-support swept its user: every page a 500, with no route back to
    // sign-in. Signing out first is what makes the link work — `/login` with a live session hands the same
    // token straight back.
    it("should end the session and render the sign-in-again page with a 401", async () => {
      const { req, destroy } = sessionRequest("GET");
      const res = pageResponse();

      await domainErrorHandler()(new UnauthorizedError("deed-poll-api answered 401"), req, res, next);

      expect(destroy).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.render).toHaveBeenCalledWith("errors/401", { returnTo: "/deed-polls/c-1/notes/new" });
      expect(next).not.toHaveBeenCalled();
    });

    // The reason this was unmapped until 2026-10-07, and still the reason it must not redirect: when IDAM's own
    // session silently re-issues a token api refuses again, a redirect to `/login` loops; a link cannot.
    it("should never redirect, so a token api always refuses cannot loop", async () => {
      const { req } = sessionRequest("GET");
      const res = pageResponse();

      await domainErrorHandler()(new UnauthorizedError("deed-poll-api answered 401"), req, res, next);

      expect(res.redirect).not.toHaveBeenCalled();
    });

    it("should offer no way back to a form submission, which has no page to return to", async () => {
      const { req } = sessionRequest("POST");
      const res = pageResponse();

      await domainErrorHandler()(new UnauthorizedError("deed-poll-api answered 401"), req, res, next);

      expect(res.render).toHaveBeenCalledWith("errors/401", { returnTo: null });
    });

    it("should emit api_401 with the subject and sid of the session it ends, read before ending it", async () => {
      const req = {
        method: "GET",
        baseUrl: "/deed-polls",
        path: "/c-1/notes/new",
        originalUrl: "/deed-polls/c-1/notes/new?q=Smith",
        sessionID: "a-refused-session-id",
        session: { deedPoll: { subject: "idam-subject-1", accessToken: "a-refused-token" } } as Record<string, unknown>
      };
      // express-session drops the id and the data along with the session.
      req.session.destroy = vi.fn((callback: (error?: Error) => void) => {
        Reflect.deleteProperty(req, "sessionID");
        Reflect.deleteProperty(req.session, "deedPoll");
        callback();
      });

      await domainErrorHandler()(new UnauthorizedError("deed-poll-api answered 401"), req as never, pageResponse(), next);

      expect(vi.mocked(trackEvent).mock.calls).toEqual([
        [
          "auth.session.ended",
          {
            subject: "idam-subject-1",
            sid: createHash("sha256").update("a-refused-session-id").digest("hex").slice(0, 16),
            env: "test",
            method: "GET",
            route: "/deed-polls/c-1/notes/new",
            reason: "api_401"
          }
        ]
      ]);
      expect(JSON.stringify(vi.mocked(trackEvent).mock.calls)).not.toContain("a-refused-token");
    });

    it("should hand a failure to end the session to the starter's handler", async () => {
      const failure = new Error("redis unavailable");
      const destroy = vi.fn((callback: (error?: Error) => void) => callback(failure));
      const res = pageResponse();

      await domainErrorHandler()(new UnauthorizedError("deed-poll-api answered 401"), { method: "GET", session: { destroy } } as never, res, next);

      expect(next).toHaveBeenCalledWith(failure);
      expect(res.render).not.toHaveBeenCalled();
    });
  });

  describe("when a limit refuses the caller", () => {
    it("should answer 429 with Retry-After and the wait in minutes when the wait is known", () => {
      const res = pageResponse();

      domainErrorHandler()(new TooManyRequestsError("rate limited", 120), REQUEST, res, next);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.setHeader).toHaveBeenCalledWith("Retry-After", "120");
      expect(res.render).toHaveBeenCalledWith("errors/429", { retryAfterMinutes: 2 });
      expect(next).not.toHaveBeenCalled();
    });

    // "Try again in 0 minutes" would read as "now", and a partial minute is still a wait.
    it.each([
      [1, 1],
      [0, 1],
      [61, 2],
      [3600, 60]
    ])("should round %i seconds up to %i minutes, never below one", (seconds, minutes) => {
      const res = pageResponse();

      domainErrorHandler()(new TooManyRequestsError("rate limited", seconds), REQUEST, res, next);

      expect(res.render).toHaveBeenCalledWith("errors/429", { retryAfterMinutes: minutes });
    });

    it("should answer 429 with no Retry-After and no wait when the wait is unknown", () => {
      const res = pageResponse();

      domainErrorHandler()(new TooManyRequestsError("rate limited", null), REQUEST, res, next);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.setHeader).not.toHaveBeenCalled();
      expect(res.render).toHaveBeenCalledWith("errors/429", { retryAfterMinutes: null });
    });
  });

  it("should pass a conflict on, because the page that can name the state is the one that must catch it", () => {
    const error = new ConflictError("Case c-1 already has an open referral");

    domainErrorHandler()(error, REQUEST, pageResponse(), next);

    expect(next).toHaveBeenCalledWith(error);
  });

  // The document download route streams, so by the time it fails the status is already on the wire. Attempting a
  // second set of headers would throw inside the error handler itself.
  // Passed on, the starter's handler would render over the sent headers and throw outside any handler.
  it("should cut the response off and log, rather than pass on, a failure once the response has begun", () => {
    const error = new Error("api's body failed mid-stream");
    const res = Object.assign(pageResponse(), { headersSent: true, destroy: vi.fn() });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    domainErrorHandler()(error, REQUEST, res, next);

    expect(res.destroy).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(res.render).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith("response failed after its headers were sent: api's body failed mid-stream");
    consoleError.mockRestore();
  });

  it("should survive a browser closing a streamed response mid-body, with the starter's renderer behind it", async () => {
    const body = new PassThrough();
    const reached = Promise.withResolvers<void>();
    const views = mkdtempSync(join(tmpdir(), "views-"));
    mkdirSync(join(views, "errors"));
    writeFileSync(join(views, "errors", "500.njk"), "500");
    const app = express();
    nunjucks.configure(views, { express: app });
    app.set("view engine", "njk");
    app.get("/stream", (_req, res, next) => {
      res.setHeader("Content-Type", "application/pdf");
      res.flushHeaders();
      body.write("%PDF-");
      reached.resolve();
      pipeline(body, res, (error) => {
        if (error) next(error);
      });
    });
    app.use(domainErrorHandler());
    // The starter's real handler: its render would answer over the sent headers and throw outside any handler.
    app.use(errorHandler());
    const server = app.listen(0);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const socket = connect((server.address() as AddressInfo).port, "127.0.0.1");
    socket.write("GET /stream HTTP/1.1\r\nHost: localhost\r\n\r\n");
    await reached.promise;
    const closed = new Promise((resolve) => body.once("close", resolve));
    socket.destroy();
    await closed;
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
    await new Promise((resolve) => server.close(resolve));
  });

  it("should log nothing when the browser closed a streamed response before its end", () => {
    const error = Object.assign(new Error("Premature close"), { code: "ERR_STREAM_PREMATURE_CLOSE" });
    const res = Object.assign(pageResponse(), { headersSent: true, destroy: vi.fn() });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    domainErrorHandler()(error, REQUEST, res, next);

    expect(res.destroy).toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
