import { beforeEach, describe, expect, it, vi } from "vitest";
import { endSessionUrl } from "../auth/idam.js";
import { pageRequest, pageResponse } from "../express-doubles.js";
import { GET } from "./logout.js";

vi.mock("../auth/idam.js", () => ({ endSessionUrl: vi.fn() }));
vi.mock("../auth/settings.js", () => ({ idamSettings: () => ({ issuerUrl: "https://idam.example/o" }) }));

const AWAY = "https://idam.example/o/endSession?id_token_hint=an-id-token";

function signedIn() {
  return pageRequest({ admin: true, name: "An Admin", idToken: "an-id-token" });
}

describe("the logout page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(endSessionUrl).mockResolvedValue(AWAY);
  });

  it("destroys the local session", async () => {
    const req = signedIn();

    await GET(req, pageResponse());

    expect(req.session.destroy).toHaveBeenCalled();
    expect(req.session.deedPoll.user).toBeUndefined();
  });

  it("then sends the browser to IDAM to end that session too", async () => {
    const res = pageResponse();

    await GET(signedIn(), res);

    expect(res.redirect).toHaveBeenCalledWith(AWAY);
  });

  it("reads the id token before destroying the session, since destroying it removes the token", async () => {
    // Ordering, and it is easy to get wrong: taking the token after `signOut` would pass `undefined`
    // and IDAM would prompt the user to confirm which session to end.
    await GET(signedIn(), pageResponse());

    expect(endSessionUrl).toHaveBeenCalledWith(expect.anything(), "an-id-token");
  });

  it("signs out locally even when the issuer advertises no end-session endpoint", async () => {
    // The local half is the half that matters, so say it is done rather than pretending the IDAM
    // session is gone as well.
    vi.mocked(endSessionUrl).mockResolvedValue(undefined);
    const req = signedIn();
    const res = pageResponse();

    await GET(req, res);

    expect(req.session.destroy).toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith("/");
  });

  it("works for someone who is not signed in, rather than failing", async () => {
    // A bookmarked /logout, or a second click. Both should be harmless.
    const res = pageResponse();

    await GET(pageRequest({ signedIn: false }), res);

    expect(endSessionUrl).toHaveBeenCalledWith(expect.anything(), undefined);
    expect(res.redirect).toHaveBeenCalled();
  });

  it("leaves the user signed out locally even if the IDAM lookup throws", async () => {
    // Local first is the whole point of the ordering: the failure that matters is being left
    // authenticated here, and by this point that cannot happen.
    vi.mocked(endSessionUrl).mockRejectedValue(new Error("IDAM unreachable"));
    const req = signedIn();

    await expect(GET(req, pageResponse())).rejects.toThrow("IDAM unreachable");

    expect(req.session.destroy).toHaveBeenCalled();
    expect(req.session.deedPoll.user).toBeUndefined();
  });
});
