import { sendReferrals as apiSendReferrals, getReferralQueue } from "@hmcts/deed-poll-api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, NotFoundError } from "../errors.js";
import { buildQueueRows, buildQueueWindowView, buildSendReview, findReferralQueue, sendReferrals, summariseSend } from "./queue.js";

vi.mock("@hmcts/deed-poll-api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll-api-client")>()),
  getReferralQueue: vi.fn(),
  sendReferrals: vi.fn()
}));

const CALLER = { accessToken: "team-leader-token" };
// Friday 30 October 2026, 09:00 in London: British Summer Time ended on the 25th, so London is UTC.
const NOW = new Date("2026-10-30T09:00:00Z");
const MASTERS = [
  { id: "master-1", name: "Master Sullivan", sentInWindow: 3 },
  { id: "master-2", name: null, sentInWindow: 1 }
];
const OPEN_WINDOW = {
  current: { date: "2026-10-30", slot: "AM" as const, closesAt: "2026-10-30T10:30:00Z" },
  next: { date: "2026-10-30", slot: "PM" as const, opensAt: "2026-10-30T14:00:00Z" },
  cap: 10,
  sent: 4,
  masters: MASTERS
};
const ITEM = {
  id: "referral-1",
  caseId: "case-1",
  displayReference: "KBDP2026-00001",
  state: "Open" as const,
  newForename: "Ada",
  newMiddleName: null,
  newSurname: "Lovelace",
  reasons: ["Minor", "MinorTransgender", "Other"],
  urgency: "Urgent" as const,
  createdBy: "Casey Worker",
  createdOn: "2026-10-28T11:00:00Z"
};

describe("referrals/queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DEED_POLL_API_URL = "http://api.test";
  });

  describe("findReferralQueue", () => {
    it("should forward only the state and page with the caller's token", async () => {
      vi.mocked(getReferralQueue).mockResolvedValue({ ok: true, data: { referrals: [], page: 2, size: 25, total: 0, totalPages: 0 } } as never);

      await findReferralQueue({ state: "Claimed", page: 2 }, CALLER);

      expect(getReferralQueue).toHaveBeenCalledWith({ state: "Claimed", page: 2 }, expect.objectContaining({ accessToken: "team-leader-token" }));
    });

    it("should throw NotFoundError when api answers 404", async () => {
      vi.mocked(getReferralQueue).mockResolvedValue({ ok: false, error: { kind: "not-found", status: 404, message: "gone" } } as never);

      await expect(findReferralQueue({}, CALLER)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("buildQueueWindowView", () => {
    it("should say which window is open, when it closes in London and how many of the cap are sent", () => {
      const view = buildQueueWindowView(OPEN_WINDOW, NOW);

      expect(view).toEqual({
        isOpen: true,
        slot: "AM",
        closesAt: "10:30",
        opensAt: "14:00",
        opensDay: "today",
        opensDate: "Friday 30 October 2026",
        cap: 10,
        sent: 4,
        room: 6,
        masters: [
          { id: "master-1", name: "Master Sullivan", sent: 3 },
          { id: "master-2", name: "Not recorded", sent: 1 }
        ]
      });
    });

    it("should format the closing time in London summer time", () => {
      const view = buildQueueWindowView(
        { ...OPEN_WINDOW, current: { date: "2026-07-01", slot: "AM", closesAt: "2026-07-01T09:30:00Z" } },
        new Date("2026-07-01T08:00:00Z")
      );

      expect(view?.closesAt).toBe("10:30");
    });

    it("should say when the next window opens outside a window", () => {
      const view = buildQueueWindowView({ ...OPEN_WINDOW, current: null, sent: 0 }, NOW);

      expect(view).toMatchObject({ isOpen: false, slot: null, closesAt: null, opensAt: "14:00", opensDay: "today", sent: 0, room: 10 });
    });

    it.each([
      ["2026-10-31", "tomorrow"],
      ["2026-11-02", "later"]
    ])("should call a next window on %s %s", (date, day) => {
      const view = buildQueueWindowView({ ...OPEN_WINDOW, current: null, next: { date, slot: "AM", opensAt: `${date}T07:00:00Z` } }, NOW);

      expect(view?.opensDay).toBe(day);
      expect(view?.opensAt).toBe("07:00");
    });

    it("should name the day of a next window after tomorrow", () => {
      const view = buildQueueWindowView({ ...OPEN_WINDOW, current: null, next: { date: "2026-11-02", slot: "AM", opensAt: "2026-11-02T07:00:00Z" } }, NOW);

      expect(view?.opensDate).toBe("Monday 2 November 2026");
    });

    it("should leave no room, rather than a negative one, when the cap is below what was sent", () => {
      expect(buildQueueWindowView({ ...OPEN_WINDOW, cap: 3, sent: 4 }, NOW)?.room).toBe(0);
    });

    it("should answer null when api sent no window", () => {
      expect(buildQueueWindowView(null, NOW)).toBeNull();
      expect(buildQueueWindowView(undefined, NOW)).toBeNull();
    });
  });

  describe("buildQueueRows", () => {
    it("should keep api's order and word each cell", () => {
      const rows = buildQueueRows([ITEM, { ...ITEM, id: "referral-2", urgency: "Normal" }]);

      expect(rows.map((row) => row.id)).toEqual(["referral-1", "referral-2"]);
      expect(rows[0]).toEqual({
        id: "referral-1",
        caseId: "case-1",
        reference: "KBDP2026-00001",
        newName: "Ada Lovelace",
        reasons: ["Applicant is a minor: Transgender", "Other"],
        isUrgent: true,
        raisedBy: "Casey Worker",
        raisedOn: "28-10-26",
        master: null,
        sentOn: null,
        dueBy: null
      });
      expect(rows[1].isUrgent).toBe(false);
    });

    it("should carry who has a sent referral, since when and when the direction is due", () => {
      const [row] = buildQueueRows([
        {
          ...ITEM,
          state: "Claimed",
          assignedMaster: { id: "master-1", name: "Master Sullivan" },
          assignedAt: "2026-10-29T08:00:00Z",
          directionDueBy: "2026-11-05T08:00:00Z"
        }
      ]);

      expect(row).toMatchObject({ master: "Master Sullivan", sentOn: "29-10-26", dueBy: "05-11-26" });
    });

    it("should use placeholders for what api did not send", () => {
      const [row] = buildQueueRows([{ id: "referral-3", caseId: "case-3", reasons: [], assignedMaster: { id: "master-2", name: null } }]);

      expect(row).toMatchObject({
        reference: "Not recorded",
        newName: "Not recorded",
        raisedBy: "Not recorded",
        raisedOn: "Not recorded",
        master: "Not recorded"
      });
    });
  });

  describe("sendReferrals", () => {
    const SELECTION = { allocations: [{ referralId: "referral-1", masterId: "master-1" }] };

    it("should send the selection's pairs in their order and nothing else", async () => {
      vi.mocked(apiSendReferrals).mockResolvedValue({ ok: true, data: { referrals: [], window: null } } as never);

      await sendReferrals(SELECTION, CALLER);

      expect(apiSendReferrals).toHaveBeenCalledWith({ allocations: SELECTION.allocations }, expect.anything());
    });

    it("should carry api's field on a refused referral", async () => {
      vi.mocked(apiSendReferrals).mockResolvedValue({
        ok: false,
        error: {
          kind: "conflict",
          status: 409,
          message: "This referral is no longer waiting to be sent",
          fieldErrors: [{ field: "allocations[0].referralId", message: "This referral is no longer waiting to be sent" }]
        }
      } as never);

      const refusal = await sendReferrals(SELECTION, CALLER).catch((error: unknown) => error);

      expect(refusal).toBeInstanceOf(ConflictError);
      expect((refusal as ConflictError).errors).toEqual([{ field: "allocations[0].referralId", message: "This referral is no longer waiting to be sent" }]);
    });
  });

  describe("summariseSend", () => {
    it("should count the referrals api answered with and the distinct Masters holding them", () => {
      const sentTo = (id: string) => ({ ...ITEM, state: "Claimed" as const, assignedMaster: { id, name: id } });

      expect(summariseSend({ referrals: [sentTo("master-1"), sentTo("master-2"), sentTo("master-1")], window: null } as never)).toEqual({
        referrals: 3,
        masters: 2
      });
    });
  });

  describe("buildSendReview", () => {
    const window = (sent: number, isOpen = true) => {
      const view = buildQueueWindowView({ ...OPEN_WINDOW, sent, current: isOpen ? OPEN_WINDOW.current : null }, NOW);
      if (view === null) throw new Error("no window");
      return view;
    };
    const SECOND = { ...ITEM, id: "referral-2", displayReference: "KBDP2026-00002", urgency: "Normal" as const };
    const selection = (...pairs: [string, string][]) => ({ allocations: pairs.map(([referralId, masterId]) => ({ referralId, masterId })) });

    it("should list each pair in the selection's order with its referral and its Master", () => {
      const review = buildSendReview(window(4), [ITEM, SECOND] as never, selection(["referral-2", "master-1"], ["referral-1", "master-2"]));

      expect(review.rows.map((row) => [row.reference, row.masterName, row.isUrgent])).toEqual([
        ["KBDP2026-00002", "Master Sullivan", false],
        ["KBDP2026-00001", "Not recorded", true]
      ]);
      expect(review).toMatchObject({ count: 2, sentAfter: 6, isOverRoom: false, canSend: true, missing: [], unavailable: [] });
    });

    it("should allow a selection that exactly fills the room left", () => {
      const review = buildSendReview(window(9), [ITEM] as never, selection(["referral-1", "master-1"]));

      expect(review).toMatchObject({ sentAfter: 10, isOverRoom: false, canSend: true });
    });

    it("should refuse to draw a send over the room left", () => {
      const review = buildSendReview(window(9), [ITEM, SECOND] as never, selection(["referral-1", "master-1"], ["referral-2", "master-1"]));

      expect(review).toMatchObject({ count: 2, isOverRoom: true, canSend: false });
    });

    it("should not draw a send outside a window", () => {
      const review = buildSendReview(window(0, false), [ITEM] as never, selection(["referral-1", "master-1"]));

      expect(review.canSend).toBe(false);
    });

    it("should not draw a send when api sent no window, and say nothing about the Masters it could not list", () => {
      const review = buildSendReview(null, [ITEM] as never, selection(["referral-1", "master-1"]));

      expect(review).toMatchObject({ canSend: false, unavailable: [] });
      expect(review.rows[0].masterName).toBe("Not recorded");
    });

    it("should report a ticked referral no longer on the page and a Master no longer available", () => {
      const review = buildSendReview(
        window(0),
        [ITEM, SECOND] as never,
        selection(["gone", "master-1"], ["referral-1", "master-9"], ["referral-2", "master-1"])
      );

      expect(review).toMatchObject({ missing: ["gone"], unavailable: ["referral-1"], canSend: false });
      expect(review.rows.map((row) => row.id)).toEqual(["referral-2"]);
    });
  });
});
