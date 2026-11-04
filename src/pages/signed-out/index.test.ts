import { describe, expect, it } from "vitest";
import { pageRequest, pageResponse } from "../../express-doubles.js";
import { GET } from "./index.js";

function renderedModel(res: ReturnType<typeof pageResponse>): Record<string, unknown> {
  return res.render.mock.calls[0][1] as Record<string, unknown>;
}

describe("the signed-out page", () => {
  it("should render the page rather than redirect, so signing in again takes a click", () => {
    const res = pageResponse();

    GET(pageRequest({ signedIn: false }), res);

    expect(res.render).toHaveBeenCalledWith("signed-out/index", expect.anything());
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it("should carry Welsh copy with the same keys as the English", () => {
    const res = pageResponse();

    GET(pageRequest({ signedIn: false }), res);

    const { en, cy } = renderedModel(res) as { en: Record<string, string>; cy: Record<string, string> };
    expect(Object.keys(cy)).toEqual(Object.keys(en));
    expect(cy.signIn).toBe("Mewngofnodi eto");
  });
});
