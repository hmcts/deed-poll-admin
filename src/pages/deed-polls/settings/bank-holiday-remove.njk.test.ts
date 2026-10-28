import path from "node:path";
import { fileURLToPath } from "node:url";
import { findBankHolidays } from "@hmcts/deed-poll";
import nunjucks from "nunjucks";
import { describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../express-doubles.js";
import { addPathFilters } from "../../../path-filters.js";
import { GET } from "./bank-holidays/[date]/remove.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findBankHolidays: vi.fn()
}));

const STARTER_VIEWS = path.join(fileURLToPath(import.meta.url), "../../../../../libs/express-govuk-starter/src");
const environment = nunjucks.configure(
  [
    path.join(fileURLToPath(import.meta.resolve("govuk-frontend")), "..", ".."),
    path.join(STARTER_VIEWS, "govuk-frontend/views"),
    path.join(STARTER_VIEWS, "cookies/views"),
    path.join(fileURLToPath(import.meta.url), "../../../..", "pages")
  ],
  { autoescape: true }
);
addPathFilters(environment);

describe("the bank holiday removal confirmation", () => {
  it("should name the day, warn, and offer one POST with Cancel as a link", async () => {
    // Arrange
    vi.mocked(findBankHolidays).mockResolvedValue([{ date: "2026-12-25", name: "<Christmas Day>" }]);
    const res = pageResponse();
    res.locals.locale = "en";

    // Act
    await GET(pageRequest({ deliveryManager: true, accessToken: "dm-token", params: { date: "2026-12-25" } }), res);
    const model = res.render.mock.calls[0]?.[1];
    const markup = environment.render("deed-polls/settings/bank-holiday-remove.njk", { ...model.en, ...model });

    // Assert
    expect(markup).toMatch(/<title>\s*Are you sure you want to remove this bank holiday\?/);
    expect(markup).toContain("25-12-26");
    expect(markup).toContain("&lt;Christmas Day&gt;");
    expect(markup).toContain("Referral windows will run on this day once it is removed.");
    expect(markup.match(/<form/g)).toHaveLength(1);
    expect(markup).toContain('<form method="post" action="/deed-polls/settings/bank-holidays/2026-12-25/remove" novalidate>');
    expect(markup).toContain("govuk-button--warning");
    expect(markup).toContain('<a class="govuk-link" href="/deed-polls/settings#bank-holidays">Cancel</a>');
  });
});
