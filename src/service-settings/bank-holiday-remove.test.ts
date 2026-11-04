import { deleteBankHoliday, ForbiddenError, findBankHolidays, NotFoundError } from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../express-doubles.js";
import { removeBankHolidayPage, showBankHolidayRemove } from "./bank-holiday-remove.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  deleteBankHoliday: vi.fn(),
  findBankHolidays: vi.fn()
}));

const CALLER = { accessToken: "dm-token" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(findBankHolidays).mockResolvedValue([{ date: "2026-12-25", name: "Christmas Day" }]);
  vi.mocked(deleteBankHoliday).mockResolvedValue(undefined);
});

function request(date = "2026-12-25") {
  return pageRequest({ deliveryManager: true, accessToken: "dm-token", params: { date } });
}

describe("removing a bank holiday", () => {
  it("should confirm the listed day before anything is removed", async () => {
    // Arrange
    const res = pageResponse();

    // Act
    await showBankHolidayRemove(request(), res);

    // Assert
    expect(deleteBankHoliday).not.toHaveBeenCalled();
    expect(res.render).toHaveBeenCalledWith(
      "deed-polls/settings/bank-holiday-remove",
      expect.objectContaining({
        title: "Are you sure you want to remove this bank holiday?",
        holiday: { path: "/deed-polls/settings/bank-holidays/2026-12-25/remove", date: "25-12-26", name: "Christmas Day" },
        settingsPath: "/deed-polls/settings#bank-holidays"
      })
    );
  });

  it("should answer NotFoundError for a day that is not listed", async () => {
    await expect(showBankHolidayRemove(request("2026-12-24"), pageResponse())).rejects.toBeInstanceOf(NotFoundError);
  });

  it("should remove the day on the POST and redirect to the bank holidays section", async () => {
    const res = pageResponse();

    await removeBankHolidayPage(request(), res);

    expect(deleteBankHoliday).toHaveBeenCalledExactlyOnceWith("2026-12-25", CALLER);
    expect(res.redirect).toHaveBeenCalledWith(303, "/deed-polls/settings?saved=bank-holiday-removed#bank-holidays");
  });

  it("should read a day already removed as removed, because that is what was asked for", async () => {
    vi.mocked(deleteBankHoliday).mockRejectedValue(new NotFoundError("not listed"));
    const res = pageResponse();

    await removeBankHolidayPage(request(), res);

    expect(res.redirect).toHaveBeenCalledWith(303, "/deed-polls/settings?saved=bank-holiday-removed#bank-holidays");
  });

  it("should let any other failure reach the error pages", async () => {
    vi.mocked(deleteBankHoliday).mockRejectedValue(new ForbiddenError("nope"));

    await expect(removeBankHolidayPage(request(), pageResponse())).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("should refuse a dot-segment date before any read or removal", async () => {
    await expect(showBankHolidayRemove(request(".."), pageResponse())).rejects.toBeInstanceOf(NotFoundError);
    await expect(removeBankHolidayPage(request("."), pageResponse())).rejects.toBeInstanceOf(NotFoundError);

    expect(findBankHolidays).not.toHaveBeenCalled();
    expect(deleteBankHoliday).not.toHaveBeenCalled();
  });
});
