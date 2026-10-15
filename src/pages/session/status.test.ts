import { describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../express-doubles.js";
import { GET } from "./status.js";

function response(locals: Record<string, unknown> = {}) {
  const res = pageResponse();
  Object.assign(res.locals, locals);
  const extras = res as unknown as { json: ReturnType<typeof vi.fn>; sendStatus: ReturnType<typeof vi.fn> };
  extras.json = vi.fn();
  extras.sendStatus = vi.fn();
  return res as typeof res & typeof extras;
}

describe("GET /session/status", () => {
  // The figures come from sessionLifetime, which is the only thing that knows the limits and never bumps this path.
  it("should report the seconds remaining that sessionLifetime worked out", () => {
    const timeout = { idleSeconds: 1800, idleRemaining: 900, absoluteRemaining: 20_000 };
    const res = response({ sessionClock: timeout });

    GET(pageRequest({ signedIn: true }), res);

    expect(res.json).toHaveBeenCalledWith(timeout);
  });

  it("should not touch the session, so a status check is never activity", () => {
    const req = pageRequest({ signedIn: true });
    req.session.deedPoll.lastSeenAt = 1_700_000_000;

    GET(req, response({ sessionClock: { idleSeconds: 1800, idleRemaining: 0, absoluteRemaining: 0 } }));

    expect(req.session.deedPoll.lastSeenAt).toBe(1_700_000_000);
    expect(req.session.save).not.toHaveBeenCalled();
  });

  it("should answer 401 to an anonymous request rather than redirecting it to sign in", () => {
    const res = response();

    GET(pageRequest({ signedIn: false }), res);

    expect(res.sendStatus).toHaveBeenCalledWith(401);
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it("should never be cached", () => {
    const res = response({ sessionClock: { idleSeconds: 1800, idleRemaining: 1, absoluteRemaining: 1 } });

    GET(pageRequest({ signedIn: true }), res);

    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
  });
});
