import { describe, expect, it } from "vitest";
import { pageRequest, pageResponse } from "../../express-doubles.js";
import { GET } from "./index.js";

function timedOutRequest(timedOutReturnTo?: string) {
  const req = pageRequest({ signedIn: false });
  if (timedOutReturnTo !== undefined) req.session.deedPoll.timedOutReturnTo = timedOutReturnTo;
  return req;
}

function renderedModel(res: ReturnType<typeof pageResponse>): Record<string, unknown> {
  return res.render.mock.calls[0][1] as Record<string, unknown>;
}

describe("the timed-out page", () => {
  it("should offer to sign in again, back to where the timed-out request was going", () => {
    const res = pageResponse();

    GET(timedOutRequest("/deed-polls/case-1?tab=notes"), res);

    expect(res.render).toHaveBeenCalledWith("session-timed-out/index", expect.anything());
    expect(renderedModel(res)).toMatchObject({ unsaved: false, signInHref: "/login?returnTo=%2Fdeed-polls%2Fcase-1%3Ftab%3Dnotes" });
  });

  it("should send sign-in to the root when nothing was recorded", () => {
    const res = pageResponse();

    GET(timedOutRequest(), res);

    expect(renderedModel(res)).toMatchObject({ signInHref: "/login?returnTo=%2F" });
  });

  // The stored value already went through `safeReturnTo`, but this link is a redirect sink in its own right.
  it.each(["//evil.example", "/\\evil.example", "https://evil.example"])("should fall back to the root for %o", (stored) => {
    const res = pageResponse();

    GET(timedOutRequest(stored), res);

    expect(renderedModel(res)).toMatchObject({ signInHref: "/login?returnTo=%2F" });
  });

  it("should carry Welsh copy with the same keys as the English", () => {
    const res = pageResponse();

    GET(timedOutRequest(), res);

    const { en, cy } = renderedModel(res) as { en: Record<string, string>; cy: Record<string, string> };
    expect(Object.keys(cy)).toEqual(Object.keys(en));
  });
});
