import { describe, expect, it } from "vitest";
import { pageRequest, pageResponse } from "../../../express-doubles.js";
import * as route from "./settings.js";

describe("the old Gazette recipient address", () => {
  it("should redirect to the recipient section of the service settings page", async () => {
    const res = pageResponse();

    await route.GET(pageRequest({ deliveryManager: true }), res);

    expect(res.redirect).toHaveBeenCalledExactlyOnceWith(302, "/deed-polls/settings#gazette-recipient");
    expect(res.render).not.toHaveBeenCalled();
  });

  it("should publish no POST, because the form now posts to the settings page", () => {
    expect(Object.keys(route)).toEqual(["GET"]);
  });
});
