import { findReferralQueue, NotFoundError } from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../express-doubles.js";
import { GET } from "./index.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findReferralQueue: vi.fn()
}));

const CALLER = { accessToken: "team-leader-token" };
const WINDOW = {
  current: { date: "2026-10-30", slot: "AM", closesAt: "2026-10-30T10:30:00Z" },
  next: { date: "2026-10-30", slot: "PM", opensAt: "2026-10-30T14:00:00Z" },
  cap: 10,
  sent: 4,
  masters: [{ id: "master-1", name: "Master Sullivan", sentInWindow: 3 }]
};
const QUEUED = { id: "referral-1", caseId: "case-1", displayReference: "KBDP2026-00001", reasons: ["Other"], urgency: "Urgent" };
const SENT = {
  id: "referral-2",
  caseId: "case-2",
  displayReference: "KBDP2026-00002",
  reasons: ["Other"],
  assignedMaster: { id: "master-1", name: "Master Sullivan" }
};
const page = (referrals: unknown[], extra: Record<string, unknown> = {}) => ({
  referrals,
  page: 1,
  size: 25,
  total: referrals.length,
  totalPages: 1,
  ...extra
});

describe("referral queue page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findReferralQueue).mockImplementation(
      async (query) => (query.state === "Claimed" ? page([SENT], { window: WINDOW }) : page([QUEUED], { window: WINDOW })) as never
    );
  });

  it("should read both halves of the queue, forwarding only each tab's own page", async () => {
    const res = pageResponse();

    await GET(pageRequest({ teamLeader: true, accessToken: "team-leader-token", query: { page: "2", sentPage: "3", sort: "x", size: "1" } }), res);

    expect(findReferralQueue).toHaveBeenCalledTimes(2);
    expect(findReferralQueue).toHaveBeenCalledWith({ state: "Open", page: 2 }, CALLER);
    expect(findReferralQueue).toHaveBeenCalledWith({ state: "Claimed", page: 3 }, CALLER);
  });

  it.each([undefined, "0", "-1", "nonsense"])("should leave the default page to api for %s", async (value) => {
    await GET(pageRequest({ teamLeader: true, accessToken: "team-leader-token", query: { page: value } }), pageResponse());

    expect(findReferralQueue).toHaveBeenCalledWith({ state: "Open", page: undefined }, CALLER);
  });

  it("should build each row's check and reassign links through the path helpers, carrying the case", async () => {
    const res = pageResponse();

    await GET(pageRequest({ teamLeader: true }), res);

    const model = res.render.mock.calls[0][1];
    expect(res.render.mock.calls[0][0]).toBe("deed-polls/referrals/index");
    expect(model.toSend.rows[0]).toMatchObject({ reference: "KBDP2026-00001", isUrgent: true, checkHref: "/deed-polls/referrals/referral-1?case=case-1" });
    expect(model.withMaster.rows[0]).toMatchObject({ master: "Master Sullivan", reassignHref: "/deed-polls/referrals/referral-2/reassign?case=case-2" });
    expect(model.masterOptions).toEqual([{ value: "master-1", text: "Master Sullivan" }]);
  });

  it("should word the window from the To send read", async () => {
    const res = pageResponse();

    await GET(pageRequest({ teamLeader: true }), res);

    expect(res.render.mock.calls[0][1].windowText).toEqual({ state: "This morning’s window closes at 10:30.", count: "4 of 10 referrals sent." });
  });

  it.each([
    [{ date: "2026-10-30", slot: "PM", opensAt: "2026-10-30T14:00:00Z" }, "Referrals can be sent from 14:00 today."],
    [{ date: "2026-10-31", slot: "AM", opensAt: "2026-10-31T07:00:00Z" }, "Referrals can be sent from 07:00 tomorrow."],
    [{ date: "2026-11-02", slot: "AM", opensAt: "2026-11-02T07:00:00Z" }, "Referrals can be sent from 07:00 on Monday 2 November 2026."]
  ])("should say when sending opens outside a window (%o)", async (next, sentence) => {
    vi.useFakeTimers({ now: new Date("2026-10-30T11:00:00Z"), toFake: ["Date"] });
    vi.mocked(findReferralQueue).mockResolvedValue(page([QUEUED], { window: { ...WINDOW, current: null, sent: 0, next } }) as never);
    const res = pageResponse();

    await GET(pageRequest({ teamLeader: true }), res);
    vi.useRealTimers();

    expect(res.render.mock.calls[0][1].windowText).toEqual({ state: sentence, count: "0 of 10 referrals sent." });
  });

  it("should say the afternoon's window inside one", async () => {
    vi.mocked(findReferralQueue).mockResolvedValue(
      page([], { window: { ...WINDOW, current: { date: "2026-10-30", slot: "PM", closesAt: "2026-10-30T14:30:00Z" } } }) as never
    );
    const res = pageResponse();

    await GET(pageRequest({ teamLeader: true }), res);

    expect(res.render.mock.calls[0][1].windowText.state).toBe("This afternoon’s window closes at 14:30.");
  });

  it("should carry no window text when api sent no window", async () => {
    vi.mocked(findReferralQueue).mockResolvedValue(page([QUEUED]) as never);
    const res = pageResponse();

    await GET(pageRequest({ teamLeader: true }), res);

    expect(res.render.mock.calls[0][1]).toMatchObject({ window: null, windowText: null, masterOptions: [] });
  });

  it("should degrade the With a Master tab, and log, when its read fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(findReferralQueue).mockImplementation(async (query) => {
      if (query.state === "Claimed") throw new Error("deed-poll-api call failed (unavailable)\r\nforged");
      return page([QUEUED], { window: WINDOW }) as never;
    });
    const res = pageResponse();

    await GET(pageRequest({ teamLeader: true }), res);

    expect(res.render.mock.calls[0][1]).toMatchObject({ withMaster: null, toSend: { rows: [expect.objectContaining({ id: "referral-1" })] } });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("referral queue (with a Master) unavailable"));
    expect(log.mock.calls[0][0]).not.toMatch(/[\r\n]/);
    log.mockRestore();
  });

  it("should fail the page when the To send read fails", async () => {
    vi.mocked(findReferralQueue).mockImplementation(async (query) => {
      if (query.state === "Open") throw new NotFoundError("gone");
      return page([SENT]) as never;
    });

    await expect(GET(pageRequest({ teamLeader: true }), pageResponse())).rejects.toBeInstanceOf(NotFoundError);
  });

  it("should page each tab to its own fragment", async () => {
    vi.mocked(findReferralQueue).mockResolvedValue(page([QUEUED], { total: 60, totalPages: 3, window: WINDOW }) as never);
    const res = pageResponse();

    await GET(pageRequest({ teamLeader: true }), res);

    const model = res.render.mock.calls[0][1];
    expect(model.toSend.paging.links.next.href).toBe("/deed-polls/referrals?page=2#to-send");
    expect(model.withMaster.paging.links.next.href).toBe("/deed-polls/referrals?sentPage=2#with-a-master");
    expect(model.toSend.pagingSummary).toBe("1 to 25 of 60 referrals");
  });
});
