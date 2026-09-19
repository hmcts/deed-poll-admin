import { beforeEach, describe, expect, it, vi } from "vitest";
import { beginLogin } from "../auth/idam.js";
import { pageRequest, pageResponse } from "../express-doubles.js";
import { GET } from "./login.js";

vi.mock("../auth/idam.js", () => ({ beginLogin: vi.fn() }));
vi.mock("../auth/settings.js", () => ({ idamSettings: () => ({ issuerUrl: "https://idam.example/o" }) }));

const FLOW = { codeVerifier: "a-verifier", state: "a-state", returnTo: "/deed-polls" };

describe("the login page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(beginLogin).mockResolvedValue({ authorizationUrl: "https://idam.example/o/authorize?state=a-state", flow: FLOW });
  });

  it("redirects the browser to IDAM", async () => {
    const res = pageResponse();

    await GET(pageRequest({ signedIn: false }), res);

    expect(res.redirect).toHaveBeenCalledWith("https://idam.example/o/authorize?state=a-state");
  });

  it("stores the flow in the session, so the callback can check state and PKCE", async () => {
    const req = pageRequest({ signedIn: false });

    await GET(req, pageResponse());

    expect(req.session.deedPoll.flow).toEqual(FLOW);
  });

  it("saves the session before redirecting", async () => {
    // The redirect leaves for IDAM immediately. If the PKCE verifier has not reached the store by the
    // time the callback arrives — possibly on another pod — the exchange fails.
    const req = pageRequest({ signedIn: false });
    const res = pageResponse();

    await GET(req, res);

    expect(req.session.save).toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalled();
  });

  it("renders a 500 rather than redirecting when the session cannot be saved", async () => {
    // Redirecting anyway would send the user to IDAM to complete a flow whose verifier was never
    // stored — they would come back to an unexplained failure instead of a page saying so.
    const req = pageRequest({ signedIn: false });
    req.session.save.mockImplementation((callback: (error?: Error) => void) => callback(new Error("store down")));
    const res = pageResponse();

    await GET(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.render).toHaveBeenCalledWith("errors/500");
    expect(res.redirect).not.toHaveBeenCalled();
  });

  describe("when someone is already signed in", () => {
    it("sends them where they were heading instead of round the flow again", async () => {
      const res = pageResponse();

      await GET(pageRequest({ query: { returnTo: "/deed-polls/case-1" } }), res);

      expect(res.redirect).toHaveBeenCalledWith("/deed-polls/case-1");
      expect(beginLogin).not.toHaveBeenCalled();
    });
  });

  describe("returnTo", () => {
    it("is passed through to the flow when it is a path on this site", async () => {
      await GET(pageRequest({ signedIn: false, query: { returnTo: "/deed-polls/case-1" } }), pageResponse());

      expect(beginLogin).toHaveBeenCalledWith(expect.anything(), "/deed-polls/case-1");
    });

    // The service root and not the case list, because which home is right depends on roles that do not
    // exist until the token comes back — `pages/index.ts` resolves the persona on the way through.
    it("defaults to the service root when absent, so the persona decides the landing page", async () => {
      await GET(pageRequest({ signedIn: false }), pageResponse());

      expect(beginLogin).toHaveBeenCalledWith(expect.anything(), "/");
    });

    // `returnTo` arrives in a query string, so it is attacker-controlled. Sending the user to it
    // unchecked makes /login an open redirect that borrows this service's domain to launder a phishing
    // link — the URL the victim sees and trusts is ours.
    it.each([
      ["an absolute URL", "https://evil.example"],
      ["a protocol-relative URL, which browsers read as absolute", "//evil.example"],
      ["a scheme-only URL", "javascript:alert(1)"],
      ["a relative path that is not rooted", "deed-polls"],
      ["an array, as a repeated query parameter arrives", ["/deed-polls", "https://evil.example"] as unknown as string],
      ["an empty string", ""]
    ])("refuses %s and falls back to the service root", async (_case, returnTo) => {
      await GET(pageRequest({ signedIn: false, query: { returnTo } }), pageResponse());

      expect(beginLogin).toHaveBeenCalledWith(expect.anything(), "/");
    });

    it("refuses an off-site destination for someone already signed in, too", async () => {
      // The same check has to hold on this branch: it redirects without going near IDAM, so a hole
      // here is an open redirect that needs no login at all.
      const res = pageResponse();

      await GET(pageRequest({ query: { returnTo: "//evil.example" } }), res);

      expect(res.redirect).toHaveBeenCalledWith("/");
    });
  });
});
