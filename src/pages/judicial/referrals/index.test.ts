import { describe, expect, it } from "vitest";
import { pageRequest, pageResponse } from "../../../express-doubles.js";
import { GET } from "./index.js";

describe("the old judicial pool path", () => {
  it("should redirect to My referrals, because a Master has no pool to work from", () => {
    const res = pageResponse();

    GET(pageRequest({ judicial: true }), res);

    expect(res.redirect).toHaveBeenCalledWith("/judicial/referrals/mine");
    expect(res.render).not.toHaveBeenCalled();
  });

  it("should drop the pool's page number, which means nothing on My referrals", () => {
    const res = pageResponse();

    GET(pageRequest({ judicial: true, query: { page: "3" } }), res);

    expect(res.redirect).toHaveBeenCalledWith("/judicial/referrals/mine");
  });
});
