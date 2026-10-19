import { ConflictError, NotFoundError, withdrawReferral } from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../../../express-doubles.js";
import { POST } from "./withdraw.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  withdrawReferral: vi.fn()
}));

const PARAMS = { id: "case-1", referralId: "ref-1" };

const CALLER = { accessToken: "session-token" };

function request() {
  return pageRequest({ params: PARAMS, body: {}, accessToken: "session-token" });
}

const response = pageResponse;

describe("withdraw a referral", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "test";
    vi.mocked(withdrawReferral).mockResolvedValue({ id: "ref-1", state: "Withdrawn" } as never);
  });

  it("should withdraw the referral named in the path and return to the case's referrals tab", async () => {
    const res = response();

    await POST(request(), res);

    expect(withdrawReferral).toHaveBeenCalledWith("case-1", "ref-1", CALLER);
    expect(res.redirect).toHaveBeenCalledWith("/deed-polls/case-1#referrals");
  });

  it("should send the session's token and nothing else, because api decides who may withdraw", async () => {
    await POST(pageRequest({ params: PARAMS, body: {}, name: "A Caseworker", accessToken: "session-token" }), response());

    expect(withdrawReferral).toHaveBeenCalledWith("case-1", "ref-1", CALLER);
  });

  it("should send a refused withdrawal back to the referral with the conflict flag, not to an error page", async () => {
    // api's second 409: the referral was closed or withdrawn while this page was open.
    vi.mocked(withdrawReferral).mockRejectedValue(new ConflictError("Referral ref-1 is already terminal"));
    const res = response();

    await POST(request(), res);

    expect(res.redirect).toHaveBeenCalledWith("/deed-polls/case-1/referrals/ref-1?withdraw=conflict");
  });

  it("should let a 404 reach the error handler rather than pretending the withdrawal happened", async () => {
    vi.mocked(withdrawReferral).mockRejectedValue(new NotFoundError("Referral ref-1 not found"));

    await expect(POST(request(), response())).rejects.toThrow(NotFoundError);
  });

  it("should let an unreachable api reach the error handler", async () => {
    vi.mocked(withdrawReferral).mockRejectedValue(new Error("deed-poll-api call failed (unavailable): deed-poll-api could not be reached"));

    await expect(POST(request(), response())).rejects.toThrow(/unavailable/);
  });

  // `../../../../../case-path.test.ts` holds the full payload matrix; this pins both destinations.
  describe("a case id carrying URL delimiters", () => {
    const RAW = { id: "a/b?c#d", referralId: "ref/1" };
    const ENCODED_CASE = "/deed-polls/a%2Fb%3Fc%23d";

    function delimited(params: Record<string, string> = RAW) {
      return pageRequest({ params, body: {}, accessToken: "session-token" });
    }

    it("should withdraw under the raw ids and return to the encoded case's referrals tab", async () => {
      const res = response();

      await POST(delimited(), res);

      expect(withdrawReferral).toHaveBeenCalledWith(RAW.id, RAW.referralId, CALLER);
      expect(res.redirect).toHaveBeenCalledWith(`${ENCODED_CASE}#referrals`);
    });

    it("should send a conflict to the encoded referral, encoding the referral id exactly once", async () => {
      vi.mocked(withdrawReferral).mockRejectedValue(new ConflictError("already terminal"));
      const res = response();

      await POST(delimited(), res);

      expect(res.redirect).toHaveBeenCalledWith(`${ENCODED_CASE}/referrals/ref%2F1?withdraw=conflict`);
    });

    it.each(["", ".", ".."])("should 404 a withdrawal under case %j before anything is written", async (id) => {
      const res = response();

      await expect(POST(delimited({ id, referralId: "ref-1" }), res)).rejects.toThrow(NotFoundError);

      expect(withdrawReferral).not.toHaveBeenCalled();
      expect(res.redirect).not.toHaveBeenCalled();
    });
  });
});
