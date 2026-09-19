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

  // Decision 5: two judges reading the same shared page is ordinary, so the 409 is a message on the pool
  // rather than an error page — and the judge is returned to where the next piece of work is.
  it("should send the judge back to the pool with 'already claimed' when api refuses the claim", async () => {
    vi.mocked(claimReferral).mockRejectedValue(new ConflictError("Referral ref-1 is not Open"));
    const res = pageResponse();

    await POST(request(), res);

    expect(res.redirect).toHaveBeenCalledWith("/judicial/referrals?claim=taken");
  });

  // Directing and claiming divide the same way: api checks visibility before the state, so a referral taken
  // out from under this judge is a 404 and not a 409 — and it must read as "gone", never as "somebody's".
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
