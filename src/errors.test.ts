/**
 * The domain-error-to-page mapping, which had no unit test until the role gate made its 403 branch reachable.
 *
 * It was covered only by whichever page test happened to throw past it and by the judicial e2e journey — and
 * that journey does not run in the pipeline (`e2e-tests` has no `test` script, and only `@smoke` runs after a
 * deploy). So the one place that decides what a refused caseworker sees was verified by nothing CI runs.
 *
 * What matters here is the status/view pairing rather than the rendering: a 403 answering the **404** view is
 * what keeps `/judicial/**` non-enumerable, and it is exactly the kind of deliberate mismatch a later reader
 * "corrects".
 */
import { ConflictError, ForbiddenError, InvalidInputError, NotFoundError, UnauthorizedError } from "@hmcts/deed-poll";
import type { NextFunction } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { domainErrorHandler } from "./errors.js";
import { pageResponse } from "./express-doubles.js";

const REQUEST = { path: "/judicial/referrals" } as never;

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

  // The pairing the judicial area's non-enumeration rests on: 403 so the refusal is honest to a client, the 404
  // view so a caseworker who guessed the URL is not told there is something behind it. `errors/403` exists and is
  // deliberately not used here — it belongs to the login flow, where the user knows who they are.
  it("should answer a forbidden request with a 403 status on the 404 view, disclosing nothing", () => {
    const res = pageResponse();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    domainErrorHandler()(new ForbiddenError("/judicial/referrals requires the caseworker-deedpoll-judicial role"), REQUEST, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.render).toHaveBeenCalledWith("errors/404");
    expect(res.render).not.toHaveBeenCalledWith("errors/403");
    error.mockRestore();
  });

  // The render is the end of the road — the starter's handler, the only thing in the chain that logs, is never
  // reached — so a refusal on the app's one authorization boundary leaves no trace unless this line writes it.
  it("should log the refusal, because nothing downstream of it will", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    domainErrorHandler()(new ForbiddenError("/judicial/referrals requires the caseworker-deedpoll-judicial role"), REQUEST, pageResponse(), next);

    expect(error).toHaveBeenCalledWith(expect.stringContaining("/judicial/referrals requires the caseworker-deedpoll-judicial role"));
    error.mockRestore();
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

    it("should hand a failure to end the session to the starter's handler", async () => {
      const failure = new Error("redis unavailable");
      const destroy = vi.fn((callback: (error?: Error) => void) => callback(failure));
      const res = pageResponse();

      await domainErrorHandler()(new UnauthorizedError("deed-poll-api answered 401"), { method: "GET", session: { destroy } } as never, res, next);

      expect(next).toHaveBeenCalledWith(failure);
      expect(res.render).not.toHaveBeenCalled();
    });
  });

  it("should pass a conflict on, because the page that can name the state is the one that must catch it", () => {
    const error = new ConflictError("Case c-1 already has an open referral");

    domainErrorHandler()(error, REQUEST, pageResponse(), next);

    expect(next).toHaveBeenCalledWith(error);
  });

  // The document download route streams, so by the time it fails the status is already on the wire. Attempting a
  // second set of headers would throw inside the error handler itself.
  it("should hand a failure back to Express untouched once the response has begun", () => {
    const error = new NotFoundError("Document d-1 not found");
    const res = pageResponse();
    (res as { headersSent: boolean }).headersSent = true;

    domainErrorHandler()(error, REQUEST, res, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(res.render).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
