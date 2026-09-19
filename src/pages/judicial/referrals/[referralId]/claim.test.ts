import { ConflictError, claimReferral, getReferral, NotFoundError } from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../../express-doubles.js";
import { POST } from "./claim.js";

// `getReferral` is stubbed although this page never calls it — that is the point: the "no pre-read" test below
// asserts the absence, which needs a spy to assert against.
vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  claimReferral: vi.fn(),
  getReferral: vi.fn()
}));

const CALLER = { accessToken: "judge-token" };

function request(referralId = "ref-1") {
  return pageRequest({ params: { referralId }, judicial: true, accessToken: "judge-token" });
}

describe("claiming a judicial referral", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(claimReferral).mockResolvedValue({ id: "ref-1", state: "Claimed" } as never);
  });

  // No body and no holder: api's sub-resource names the transition and takes the judge from the token.
  it("should claim the referral by id with the judge's token alone", async () => {
    await POST(request(), pageResponse());

    expect(claimReferral).toHaveBeenCalledWith("ref-1", CALLER);
  });

  // Nothing is read first — the pool is shared, so a pre-read's answer is stale before it can be acted on.
  // Asserted against `getReferral`, which is the read a pre-check would make: counting `claimReferral`'s calls
  // says only that the write happened once, which a handler that read the referral first would also satisfy.
  it("should not read the referral before claiming it", async () => {
    await POST(request(), pageResponse());

    expect(getReferral).not.toHaveBeenCalled();
    expect(claimReferral).toHaveBeenCalledTimes(1);
  });

  it("should land the judge on the referral it just claimed, which re-reads its state", async () => {
    const res = pageResponse();

    await POST(request(), res);

    expect(res.redirect).toHaveBeenCalledWith("/judicial/referrals/ref-1");
  });

  it("should escape the referral id in the URL it redirects to", async () => {
    const res = pageResponse();

    await POST(request("ref 1/../evil"), res);

    expect(res.redirect).toHaveBeenCalledWith("/judicial/referrals/ref%201%2F..%2Fevil");
  });

  // api checks visibility before state, so a 409 is only reachable for a referral this judge can still see and
  // cannot claim: they hold it, or they have already directed it. Back to the *referral*, not the pool — it is
  // theirs and no longer on the pool's list, so "choose another referral" would send them away from their work.
  it("should send the judge to the referral when api 409s the claim, because the 409 means it is already theirs", async () => {
    vi.mocked(claimReferral).mockRejectedValue(new ConflictError("Referral ref-1 is Claimed and can only be claimed while it is Open"));
    const res = pageResponse();

    await POST(request(), res);

    expect(res.redirect).toHaveBeenCalledWith("/judicial/referrals/ref-1?claim=held");
  });

  it("should escape the referral id in the URL it redirects a 409 to", async () => {
    vi.mocked(claimReferral).mockRejectedValue(new ConflictError("Referral is Claimed"));
    const res = pageResponse();

    await POST(request("ref 1/../evil"), res);

    expect(res.redirect).toHaveBeenCalledWith("/judicial/referrals/ref%201%2F..%2Fevil?claim=held");
  });

  // The pool is only for the refusal that means the referral has gone: api answers 404 for one another judge has
  // taken, so this is the branch a beaten judge takes — and it must read as "gone", never as "somebody's".
  it("should send the judge back to the pool with 'no longer available' when the referral is not visible", async () => {
    vi.mocked(claimReferral).mockRejectedValue(new NotFoundError("Referral ref-1 not found"));
    const res = pageResponse();

    await POST(request(), res);

    expect(res.redirect).toHaveBeenCalledWith("/judicial/referrals?claim=unavailable");
  });

  it("should let any other failure reach the error handler rather than dressing it as a race", async () => {
    vi.mocked(claimReferral).mockRejectedValue(new Error("deed-poll-api call failed (unavailable)"));

    await expect(POST(request(), pageResponse())).rejects.toThrow("unavailable");
  });

  it("should render nothing at all, because claiming is not a page", async () => {
    const res = pageResponse();

    await POST(request(), res);

    expect(res.render).not.toHaveBeenCalled();
  });
});
