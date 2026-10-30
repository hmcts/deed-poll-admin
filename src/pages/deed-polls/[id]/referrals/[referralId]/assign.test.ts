import {
  assignReferral,
  ConflictError,
  findDeedPoll,
  findMasterChoices,
  findReferral,
  InvalidInputError,
  NotFoundError,
  UnauthorizedError
} from "@hmcts/deed-poll";
import type { Request } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../../../express-doubles.js";
import { GET, POST } from "./assign.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPoll: vi.fn(),
  findReferral: vi.fn(),
  findMasterChoices: vi.fn(),
  assignReferral: vi.fn()
}));

const SULLIVAN = "6c1f0d4e-2b3a-4c5d-8e9f-0a1b2c3d4e5f";
const JUDGE = "8e3b2f60-4d5c-4e7f-a01b-2c3d4e5f6071";

/** api's Masters list at 09:00 on 28-10-26: Sullivan with room, Master Judge full. */
const MASTERS = {
  masters: [
    { id: SULLIVAN, name: "Master Sullivan", email: "s@example.com", available: true, linked: true, revision: 0, assignedInWindow: 3 },
    { id: JUDGE, name: "Master Judge", email: "j@example.com", available: true, linked: false, revision: 0, assignedInWindow: 10 }
  ],
  window: { date: "2026-10-28", slot: "AM" },
  cap: 10
};

const found = { id: "case-1", displayReference: "KBDP2026-00001", notes: [], witnesses: [], documents: [] };

const OPEN = { id: "ref-1", state: "Open", reasons: ["Minor"], migrated: false };

/** With Master Judge since 20 October, due seven days later. */
const CLAIMED = {
  ...OPEN,
  state: "Claimed",
  assignedMaster: { id: JUDGE, name: "Master Judge" },
  assignedAt: new Date("2026-10-20T09:00:00Z"),
  directionDueBy: new Date("2026-10-27T09:00:00Z")
};

const PARAMS = { id: "case-1", referralId: "ref-1" };
const CALLER = { accessToken: "session-token" };
const REFERRAL_HREF = "/deed-polls/case-1/referrals/ref-1";

function request(body: Record<string, unknown> = {}, params: Record<string, string> = PARAMS): Request {
  return pageRequest({ params, body, accessToken: "session-token" });
}

const response = pageResponse;
const model = (res: ReturnType<typeof response>) => res.render.mock.calls[0][1];

describe("assign a referral page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "test";
    vi.mocked(findDeedPoll).mockResolvedValue(found as never);
    vi.mocked(findReferral).mockResolvedValue(OPEN as never);
    vi.mocked(findMasterChoices).mockResolvedValue(MASTERS as never);
    vi.mocked(assignReferral).mockResolvedValue(CLAIMED as never);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-28T09:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("GET", () => {
    it("should say the time starts again without a number when api's instants do not give one", async () => {
      vi.mocked(findReferral).mockResolvedValue({ ...CLAIMED, directionDueBy: null } as never);
      const res = response();

      await GET(request(), res);

      expect(model(res).restartsWindow).toBe("If you assign it to another Master, their time to give a direction starts from today.");
    });

    it.each(["Decided", "Closed", "Withdrawn"])("should send a %s referral back to its page with the conflict flag rather than draw a form", async (state) => {
      vi.mocked(findReferral).mockResolvedValue({ ...CLAIMED, state } as never);
      const res = response();

      await GET(request(), res);

      expect(res.render).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(`${REFERRAL_HREF}?assign=conflict`);
    });

    it("should draw the page with no question and no submit when the Masters list cannot be read", async () => {
      vi.mocked(findMasterChoices).mockRejectedValue(new Error("deed-poll-api call failed (unavailable)"));
      vi.spyOn(console, "error").mockImplementation(() => {});
      const res = response();

      await GET(request(), res);

      expect(model(res)).toMatchObject({ isMastersUnavailable: true, masterItems: [] });
    });

    it("should say there is nobody to assign to when no Master is available", async () => {
      vi.mocked(findMasterChoices).mockResolvedValue({ ...MASTERS, masters: [{ ...MASTERS.masters[0], available: false }] } as never);
      const res = response();

      await GET(request(), res);

      expect(model(res)).toMatchObject({ isMastersUnavailable: false, hasNoMasters: true });
    });

    it("should keep the submit on a reassignment when every Master is full, because the current one can be chosen again", async () => {
      vi.mocked(findReferral).mockResolvedValue(CLAIMED as never);
      vi.mocked(findMasterChoices).mockResolvedValue({ ...MASTERS, masters: [{ ...MASTERS.masters[0], assignedInWindow: 10 }, MASTERS.masters[1]] } as never);
      const res = response();

      await GET(request(), res);

      expect(model(res).isEveryMasterFull).toBe(false);
    });

    it("should let a 401 on the Masters list end the session rather than degrade", async () => {
      vi.mocked(findMasterChoices).mockRejectedValue(new UnauthorizedError("expired"));

      await expect(GET(request(), response())).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it("should let a missing referral be the 404 page", async () => {
      vi.mocked(findReferral).mockRejectedValue(new NotFoundError("Referral ref-1 not found"));

      await expect(GET(request(), response())).rejects.toBeInstanceOf(NotFoundError);
    });

    it("should refuse a dot-segment referral id before any read", async () => {
      await expect(GET(request({}, { id: "case-1", referralId: ".." }), response())).rejects.toBeInstanceOf(NotFoundError);
      expect(findReferral).not.toHaveBeenCalled();
    });
  });

  describe("POST", () => {
    it("should assign the chosen Master and return to the referral with the assigned flag", async () => {
      const res = response();

      await POST(request({ masterId: SULLIVAN }), res);

      expect(assignReferral).toHaveBeenCalledWith("case-1", "ref-1", SULLIVAN, CALLER);
      expect(res.redirect).toHaveBeenCalledWith(`${REFERRAL_HREF}?assigned=1`);
    });

    it("should ask which Master, at 400 and with nothing sent, when none was chosen", async () => {
      const res = response();

      await POST(request({}), res);

      expect(assignReferral).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(model(res).errors).toEqual({ masterId: "Select which Master this referral should go to" });
      expect(model(res).errorList).toEqual([{ text: "Select which Master this referral should go to", href: "#masterId" }]);
    });

    it("should redraw at 409 with api's sentence beside the radios when the Master filled since the page was drawn", async () => {
      vi.mocked(assignReferral).mockRejectedValue(
        new ConflictError("full", [{ field: "masterId", message: "Master Sullivan has no room left for this morning" }])
      );
      const res = response();

      await POST(request({ masterId: SULLIVAN }), res);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.redirect).not.toHaveBeenCalled();
      expect(model(res).errors).toEqual({ masterId: "Master Sullivan has no room left for this morning" });
      // The posted choice is still the one on screen.
      expect(model(res).masterItems[0]).toMatchObject({ value: SULLIVAN, checked: true });
    });

    it("should send a refusal for the referral's state back to the referral, whose fresh read says why", async () => {
      vi.mocked(assignReferral).mockRejectedValue(new ConflictError("Referral ref-1 is not waiting for a direction"));
      const res = response();

      await POST(request({ masterId: SULLIVAN }), res);

      expect(res.redirect).toHaveBeenCalledWith(`${REFERRAL_HREF}?assign=conflict`);
      expect(res.render).not.toHaveBeenCalled();
    });

    it("should place api's refusal of an unavailable Master beside the radios", async () => {
      vi.mocked(assignReferral).mockRejectedValue(new InvalidInputError("bad", [{ field: "masterId", message: "Select a Master who is available" }]));
      const res = response();

      await POST(request({ masterId: SULLIVAN }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(model(res).errors).toEqual({ masterId: "Select a Master who is available" });
    });

    it("should log a rejection naming no control and show the page's own sentence instead of api's", async () => {
      vi.mocked(assignReferral).mockRejectedValue(new InvalidInputError("body unreadable", []));
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      const res = response();

      await POST(request({ masterId: SULLIVAN }), res);

      expect(model(res).errorList).toEqual([{ text: "The referral could not be assigned. Try again." }]);
      expect(logged).toHaveBeenCalledWith(expect.stringContaining("body unreadable"));
    });

    it("should let an unreachable api reach the error handler", async () => {
      vi.mocked(assignReferral).mockRejectedValue(new Error("deed-poll-api call failed (unavailable)"));

      await expect(POST(request({ masterId: SULLIVAN }), response())).rejects.toThrow("unavailable");
    });

    it("should refuse a dot-segment referral id before the write", async () => {
      await expect(POST(request({ masterId: SULLIVAN }, { id: "case-1", referralId: "." }), response())).rejects.toBeInstanceOf(NotFoundError);
      expect(assignReferral).not.toHaveBeenCalled();
    });
  });
});
