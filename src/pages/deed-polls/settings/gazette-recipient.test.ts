import { describe, expect, it } from "vitest";
import { pageRequest, pageResponse } from "../../../express-doubles.js";
import * as route from "./gazette-recipient.js";

describe("the Gazette recipient section's own address", () => {
  // A refused save renders at this address, so the language link and a reload GET it.
  it("should redirect a GET to the recipient section of the service settings page", async () => {
    const res = pageResponse();

    await route.GET(pageRequest({ deliveryManager: true }), res);

    expect(res.redirect).toHaveBeenCalledExactlyOnceWith(302, "/deed-polls/settings#gazette-recipient");
    expect(res.render).not.toHaveBeenCalled();
  });

  it("should keep the POST that saves the recipient", () => {
    expect(Object.keys(route).sort()).toEqual(["GET", "POST"]);
  });
});
