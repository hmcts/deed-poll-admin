import { describe, expect, it } from "vitest";
import { pageRequest, pageResponse } from "../../../../express-doubles.js";
import * as route from "./index.js";

describe("the add-a-Master form's own address", () => {
  // A refused add renders at this address, so the language link and a reload GET it.
  it("should redirect a GET to the masters section of the service settings page", async () => {
    const res = pageResponse();

    await route.GET(pageRequest({ deliveryManager: true }), res);

    expect(res.redirect).toHaveBeenCalledExactlyOnceWith(302, "/deed-polls/settings#masters");
    expect(res.render).not.toHaveBeenCalled();
  });

  it("should keep the POST that adds the Master", () => {
    expect(Object.keys(route).sort()).toEqual(["GET", "POST"]);
  });
});
