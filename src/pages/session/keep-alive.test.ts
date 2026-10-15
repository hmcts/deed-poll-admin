import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../express-doubles.js";
import { POST } from "./keep-alive.js";

const NOW = new Date("2026-10-15T12:00:00Z");
const NOW_SECONDS = NOW.getTime() / 1000;

function response() {
  const res = pageResponse();
  (res as unknown as { sendStatus: ReturnType<typeof vi.fn> }).sendStatus = vi.fn();
  return res as typeof res & { sendStatus: ReturnType<typeof vi.fn> };
}

describe("POST /session/keep-alive", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should record activity now and answer 204, for the warning's Stay signed in button", async () => {
    const req = pageRequest({ signedIn: true });
    req.session.deedPoll.authenticatedAt = NOW_SECONDS - 3600;
    req.session.deedPoll.lastSeenAt = NOW_SECONDS - 1700;
    const res = response();

    await POST(req, res);

    expect(req.session.deedPoll.lastSeenAt).toBe(NOW_SECONDS);
    expect(req.session.save).toHaveBeenCalled();
    expect(res.sendStatus).toHaveBeenCalledWith(204);
  });

  // Only the idle clock moves, so staying signed in can never pass the absolute limit.
  it("should leave the sign-in time alone, so it cannot move the absolute deadline", async () => {
    const req = pageRequest({ signedIn: true });
    req.session.deedPoll.authenticatedAt = NOW_SECONDS - 3600;
    req.session.deedPoll.lastSeenAt = NOW_SECONDS - 1700;

    await POST(req, response());

    expect(req.session.deedPoll.authenticatedAt).toBe(NOW_SECONDS - 3600);
  });

  it("should answer 401 to an anonymous request rather than redirecting it to sign in", async () => {
    const req = pageRequest({ signedIn: false });
    const res = response();

    await POST(req, res);

    expect(res.sendStatus).toHaveBeenCalledWith(401);
    expect(res.redirect).not.toHaveBeenCalled();
    expect(req.session.save).not.toHaveBeenCalled();
  });

  it("should never be cached", async () => {
    const res = response();

    await POST(pageRequest({ signedIn: true }), res);

    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
  });
});
