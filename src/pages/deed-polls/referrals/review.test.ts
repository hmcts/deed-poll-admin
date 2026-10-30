import { findReferralQueue } from "@hmcts/deed-poll";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../express-doubles.js";
import { GET, POST } from "./review.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findReferralQueue: vi.fn()
}));

const CALLER = { accessToken: "team-leader-token" };
const REFERRAL_1 = "11111111-1111-4111-8111-111111111111";
const REFERRAL_2 = "22222222-2222-4222-8222-222222222222";
const MASTER_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MASTER_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OPEN_WINDOW = {
  current: { date: "2026-10-30", slot: "AM", closesAt: "2026-10-30T10:30:00Z" },
  next: { date: "2026-10-30", slot: "PM", opensAt: "2026-10-30T14:00:00Z" },
  cap: 10,
  sent: 4,
  masters: [
    { id: MASTER_1, name: "Master Sullivan", sentInWindow: 3 },
    { id: MASTER_2, name: "Master Judge", sentInWindow: 1 }
  ]
};
const QUEUED = [
  { id: REFERRAL_1, caseId: "case-1", displayReference: "KBDP2026-00001", reasons: ["Other"], urgency: "Urgent" },
  { id: REFERRAL_2, caseId: "case-2", displayReference: "KBDP2026-00002", reasons: ["Other"], urgency: "Normal" }
];
const SELECTION = { page: "2", referrals: [REFERRAL_1, REFERRAL_2], [`master-${REFERRAL_1}`]: MASTER_1, [`master-${REFERRAL_2}`]: MASTER_2 };

function arrange({ window = OPEN_WINDOW as unknown, queued = QUEUED } = {}) {
  vi.mocked(findReferralQueue).mockResolvedValue({ referrals: queued, page: 2, size: 25, total: 27, totalPages: 2, window } as never);
}

async function post(body: Record<string, unknown>) {
  const res = pageResponse();
  await POST(pageRequest({ teamLeader: true, accessToken: "team-leader-token", body }), res);
  return { res, view: res.render.mock.calls[0]?.[0], model: res.render.mock.calls[0]?.[1] };
}

describe("referral queue review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    arrange();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should send a GET back to the queue, because a selection only arrives posted", () => {
    const res = pageResponse();

    GET(pageRequest({ teamLeader: true }), res);

    expect(res.redirect).toHaveBeenCalledWith("/deed-polls/referrals");
  });

  it("should re-read the page of the queue the selection was made on and list each pair with its Master", async () => {
    const { view, model } = await post(SELECTION);

    expect(findReferralQueue).toHaveBeenCalledWith({ state: "Open", page: 2 }, CALLER);
    expect(view).toBe("deed-polls/referrals/review");
    expect(model.rows.map((row: { reference: string; masterName: string; isUrgent: boolean }) => [row.reference, row.masterName, row.isUrgent])).toEqual([
      ["KBDP2026-00001", "Master Sullivan", true],
      ["KBDP2026-00002", "Master Judge", false]
    ]);
    expect(model.page).toBe(2);
  });

  it("should total the window after the send and draw Send inside a window", async () => {
    const { model } = await post(SELECTION);

    expect(model.totals).toEqual(["This sends 2 referrals.", "6 of 10 will have been sent this morning."]);
    expect(model.canSend).toBe(true);
  });

  it("should word one referral and the afternoon's window", async () => {
    arrange({ window: { ...OPEN_WINDOW, current: { date: "2026-10-30", slot: "PM", closesAt: "2026-10-30T14:30:00Z" } } });

    const { model } = await post({ referrals: REFERRAL_1, [`master-${REFERRAL_1}`]: MASTER_1 });

    expect(model.totals).toEqual(["This sends 1 referral.", "5 of 10 will have been sent this afternoon."]);
  });

  it("should draw no Send outside a window, saying when sending opens", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-30T11:00:00Z"), toFake: ["Date"] });
    arrange({ window: { ...OPEN_WINDOW, current: null, sent: 0 } });

    const { model } = await post(SELECTION);

    expect(model.canSend).toBe(false);
    expect(model.totals).toEqual(["Referrals can be sent from 14:00 today.", "Go back to the referrals and send them once the window opens."]);
  });

  it("should draw no Send over the room left, saying how many more fit", async () => {
    arrange({ window: { ...OPEN_WINDOW, sent: 9 } });

    const { model } = await post(SELECTION);

    expect(model.canSend).toBe(false);
    expect(model.totals).toEqual(["Only 1 more referral can be sent this morning.", "Go back to the referrals and select fewer."]);
  });

  it("should say no more fit once the window is full", async () => {
    arrange({ window: { ...OPEN_WINDOW, sent: 10 } });

    const { model } = await post(SELECTION);

    expect(model.totals[0]).toBe("No more referrals can be sent this morning.");
  });

  it("should draw no Send when api sent no window", async () => {
    arrange({ window: null });

    const { model } = await post(SELECTION);

    expect(model.canSend).toBe(false);
    expect(model.totals).toEqual(["The referral window could not be read, so these referrals cannot be sent at the moment. Try again shortly."]);
  });

  describe("a selection that cannot be reviewed redraws the queue", () => {
    it("should refuse nothing ticked, on the selection", async () => {
      const { res, view, model } = await post({ page: "1", [`master-${REFERRAL_1}`]: MASTER_1 });

      expect(res.status).toHaveBeenCalledWith(400);
      expect(view).toBe("deed-polls/referrals/index");
      expect(model.selectionError).toBe("Select at least one referral to send");
      expect(model.errorList).toEqual([{ text: "Select at least one referral to send", href: "#select-1" }]);
    });

    it("should link the selection's error to the tab when the page it redraws has no rows", async () => {
      arrange({ queued: [] });

      const { model } = await post({ page: "1" });

      expect(model.errorList).toEqual([{ text: "Select at least one referral to send", href: "#to-send" }]);
    });

    it("should refuse a ticked row with no Master beside its select, keeping the selection", async () => {
      const { res, model } = await post({ referrals: [REFERRAL_1, REFERRAL_2], [`master-${REFERRAL_1}`]: MASTER_1, [`master-${REFERRAL_2}`]: "" });

      expect(res.status).toHaveBeenCalledWith(400);
      expect(model.toSend.rows[0]).toMatchObject({ isSelected: true, masterValue: MASTER_1, masterError: "" });
      expect(model.toSend.rows[1]).toMatchObject({ isSelected: true, masterValue: "", masterError: "Choose a Master for this referral" });
      expect(model.errorList).toEqual([{ text: "Choose a Master for this referral", href: "#master-2" }]);
    });

    it("should redraw the page the selection was made on", async () => {
      await post({ page: "2" });

      expect(findReferralQueue).toHaveBeenCalledWith({ state: "Open", page: 2 }, CALLER);
    });

    it("should say the page has changed, not that a referral was sent, when a ticked referral has left the page", async () => {
      arrange({ queued: [QUEUED[1]] });

      const { res, view, model } = await post(SELECTION);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(view).toBe("deed-polls/referrals/index");
      expect(model.errorList).toEqual([
        { text: "The referrals on this page have changed since you selected them. Check the list and select again.", href: "#to-send" }
      ]);
    });

    it("should place a Master no longer available beside its row", async () => {
      arrange({ window: { ...OPEN_WINDOW, masters: [OPEN_WINDOW.masters[0]] } });

      const { res, view, model } = await post(SELECTION);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(view).toBe("deed-polls/referrals/index");
      expect(model.toSend.rows[1].masterError).toBe("Select a Master who is available");
    });
  });
});
