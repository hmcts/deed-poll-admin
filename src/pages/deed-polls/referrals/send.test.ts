import { ConflictError, findReferralQueue, InvalidInputError, sendReferrals } from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../express-doubles.js";
import { GET, POST } from "./send.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findReferralQueue: vi.fn(),
  sendReferrals: vi.fn()
}));

const CALLER = { accessToken: "team-leader-token" };
const REFERRAL_1 = "11111111-1111-4111-8111-111111111111";
const REFERRAL_2 = "22222222-2222-4222-8222-222222222222";
const MASTER_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MASTER_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const WINDOW = {
  current: { date: "2026-10-30", slot: "AM", closesAt: "2026-10-30T10:30:00Z" },
  next: { date: "2026-10-30", slot: "PM", opensAt: "2026-10-30T14:00:00Z" },
  cap: 10,
  sent: 9,
  masters: [
    { id: MASTER_1, name: "Master Sullivan", sentInWindow: 3 },
    { id: MASTER_2, name: "Master Judge", sentInWindow: 1 }
  ]
};
const QUEUED = [
  { id: REFERRAL_1, caseId: "case-1", displayReference: "KBDP2026-00001", reasons: ["Other"] },
  { id: REFERRAL_2, caseId: "case-2", displayReference: "KBDP2026-00002", reasons: ["Other"] }
];
const SELECTION = { page: "1", referrals: [REFERRAL_1, REFERRAL_2], [`master-${REFERRAL_1}`]: MASTER_1, [`master-${REFERRAL_2}`]: MASTER_2 };
const sentTo = (id: string, masterId: string) => ({ id, caseId: "case", reasons: [], assignedMaster: { id: masterId, name: "Master" } });

async function post(body: Record<string, unknown>) {
  const res = pageResponse();
  await POST(pageRequest({ teamLeader: true, accessToken: "team-leader-token", body }), res);
  return { res, view: res.render.mock.calls[0]?.[0], model: res.render.mock.calls[0]?.[1] };
}

describe("referral queue send", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findReferralQueue).mockResolvedValue({ referrals: QUEUED, page: 1, size: 25, total: 2, totalPages: 1, window: WINDOW } as never);
  });

  it("should send a GET back to the queue", () => {
    const res = pageResponse();

    GET(pageRequest({ teamLeader: true }), res);

    expect(res.redirect).toHaveBeenCalledWith("/deed-polls/referrals");
  });

  it("should send each pair and redirect to the queue with what api says it sent", async () => {
    vi.mocked(sendReferrals).mockResolvedValue({ referrals: [sentTo(REFERRAL_1, MASTER_1), sentTo(REFERRAL_2, MASTER_2)], window: WINDOW } as never);

    const { res } = await post(SELECTION);

    expect(sendReferrals).toHaveBeenCalledWith(
      {
        allocations: [
          { referralId: REFERRAL_1, masterId: MASTER_1 },
          { referralId: REFERRAL_2, masterId: MASTER_2 }
        ]
      },
      CALLER
    );
    expect(res.redirect).toHaveBeenCalledWith(303, "/deed-polls/referrals?sent=2&masters=2");
  });

  it("should read a replayed send (api's no-op) as the same success", async () => {
    vi.mocked(sendReferrals).mockResolvedValue({ referrals: [sentTo(REFERRAL_1, MASTER_1), sentTo(REFERRAL_2, MASTER_1)], window: WINDOW } as never);

    const { res } = await post(SELECTION);

    expect(res.redirect).toHaveBeenCalledWith(303, "/deed-polls/referrals?sent=2&masters=1");
  });

  it("should refuse a selection whose shape no form sends, without sending", async () => {
    const { res, view } = await post({ referrals: "not-a-referral" });

    expect(sendReferrals).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(view).toBe("deed-polls/referrals/index");
  });

  it("should redraw the check page with api's sentence when no window is open", async () => {
    const sentence = "Referrals can only be sent during a referral window. The next one opens at 14:00 today.";
    vi.mocked(sendReferrals).mockRejectedValue(new ConflictError(sentence));

    const { res, view, model } = await post(SELECTION);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(view).toBe("deed-polls/referrals/review");
    expect(model.errorList).toEqual([{ text: sentence }]);
  });

  it("should redraw the check page with api's sentence over the cap, from a fresh read with no Send", async () => {
    const sentence = "Only 1 more referral can be sent this morning. Remove 1 and try again.";
    vi.mocked(sendReferrals).mockRejectedValue(new ConflictError(sentence));

    const { view, model } = await post(SELECTION);

    expect(view).toBe("deed-polls/referrals/review");
    expect(model.errorList).toEqual([{ text: sentence }]);
    expect(model.canSend).toBe(false);
  });

  it("should send a referral no longer waiting back to the queue", async () => {
    const message = "This referral is no longer waiting to be sent";
    vi.mocked(sendReferrals).mockRejectedValue(new ConflictError(message, [{ field: "allocations[1].referralId", message }]));

    const { res, view, model } = await post(SELECTION);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(view).toBe("deed-polls/referrals/index");
    expect(model.errorList[0].text).toBe("A referral you selected is no longer waiting to be sent. Check the list and select again.");
  });

  it("should place an unavailable Master beside its row on the queue, in api's words", async () => {
    vi.mocked(sendReferrals).mockRejectedValue(
      new InvalidInputError("Select a Master who is available", [{ field: "allocations[1].masterId", message: "Select a Master who is available" }])
    );

    const { res, view, model } = await post(SELECTION);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(view).toBe("deed-polls/referrals/index");
    expect(model.toSend.rows[0].masterError).toBe("");
    expect(model.toSend.rows[1]).toMatchObject({ isSelected: true, masterValue: MASTER_2, masterError: "Select a Master who is available" });
    expect(model.errorList).toEqual([{ text: "Select a Master who is available", href: "#master-2" }]);
  });

  it("should redraw the check page with its own sentence, and log api's, for a 400 it cannot place", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(sendReferrals).mockRejectedValue(new InvalidInputError("allocations: too many\r\nforged", [{ field: "allocations", message: "x" }]));

    const { res, view, model } = await post(SELECTION);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(view).toBe("deed-polls/referrals/review");
    expect(model.errorList).toEqual([{ text: "The referrals could not be sent. Go back to the referrals and try again." }]);
    expect(log.mock.calls[0][0]).not.toMatch(/[\r\n]/);
    log.mockRestore();
  });

  it("should let any other failure reach the error handler", async () => {
    vi.mocked(sendReferrals).mockRejectedValue(new Error("deed-poll-api call failed (timeout)"));

    await expect(post(SELECTION)).rejects.toThrow("timeout");
  });
});
