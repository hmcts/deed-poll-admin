import path from "node:path";
import { fileURLToPath } from "node:url";
import { findGazetteHistory } from "@hmcts/deed-poll";
import nunjucks from "nunjucks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../express-doubles.js";
import { GET } from "./history.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findGazetteHistory: vi.fn()
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
const BATCH = {
  sentAt: new Date("2026-01-02T09:30:00Z"),
  sentBy: "Admin One",
  caseCount: 101,
  referenceNumbers: ["FROZEN-001", "FROZEN-002"],
  referencesTruncated: true
};
const PAGE = { batches: [BATCH], page: 1, size: 25, total: 26, totalPages: 2 };

async function render(query: Record<string, unknown> = {}, locale = "en") {
  const res = pageResponse();
  res.locals.locale = locale;
  await GET(pageRequest({ teamLeader: true, accessToken: "admin-token", query }), res);
  const model = res.render.mock.calls[0][1];
  return environment.render("deed-polls/gazette/history.njk", { ...model[locale], ...model });
}

describe("Gazette send history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findGazetteHistory).mockResolvedValue(PAGE);
  });

  it("should forward only page and caller", async () => {
    const markup = await render({ page: "2", size: "1", sort: "sentAt:asc", q: "sender" });
    expect(findGazetteHistory).toHaveBeenCalledExactlyOnceWith({ page: 2 }, { accessToken: "admin-token" });
    expect(markup).not.toMatch(/sort=|size=|q=|<form/);
  });

  it.each([undefined, "invalid", "0", "-1", "1.5"])("should leave default paging to API for %s", async (page) => {
    await render({ page });
    expect(findGazetteHistory).toHaveBeenCalledWith({ page: undefined }, { accessToken: "admin-token" });
  });

  it("should show sender, timestamp, full count and ordered plain reference previews", async () => {
    const markup = await render();
    expect(markup).toContain("Admin One");
    expect(markup).toContain("2 January 2026 at 9:30am");
    expect(markup).toMatch(/govuk-table__cell[^>]*>101<\/td>/);
    expect(markup.indexOf("FROZEN-001")).toBeLessThan(markup.indexOf("FROZEN-002"));
    expect(markup).toContain("Only some application references are shown.");
    expect(markup).toContain('href="/deed-polls/gazette"');
    expect(markup).not.toMatch(/href="[^" ]*(?:FROZEN|history\/)/);
  });

  it("should preserve batch order returned by API", async () => {
    vi.mocked(findGazetteHistory).mockResolvedValue({ ...PAGE, batches: [BATCH, { ...BATCH, sentBy: "Admin Two" }] });
    const markup = await render();
    expect(markup.indexOf("Admin One")).toBeLessThan(markup.indexOf("Admin Two"));
  });

  it.each([true, false])("should show truncation solely according to the API flag %s", async (referencesTruncated) => {
    vi.mocked(findGazetteHistory).mockResolvedValue({ ...PAGE, batches: [{ ...BATCH, referencesTruncated }] });
    expect((await render()).includes("Only some application references are shown.")).toBe(referencesTruncated);
  });

  it("should use API page, size and totals even when they differ from the request and row count", async () => {
    vi.mocked(findGazetteHistory).mockResolvedValue({ ...PAGE, page: 2, size: 10, total: 43, totalPages: 5 });
    const markup = await render({ page: "3" });
    expect(markup).toContain("11 to 20 of 43 sends");
    expect(markup).toContain('href="/deed-polls/gazette/history?page=1"');
    expect(markup).toContain('href="/deed-polls/gazette/history?page=3"');
    expect(markup).toContain('aria-current="page"');
  });

  it("should show empty history with navigation and no table or pagination", async () => {
    vi.mocked(findGazetteHistory).mockResolvedValue({ ...PAGE, batches: [], total: 0, totalPages: 0 });
    const markup = await render();
    expect(markup).toContain("No notices have been sent to the London Gazette.");
    expect(markup).toContain('href="/deed-polls/gazette"');
    expect(markup).not.toMatch(/govuk-table|govuk-pagination|0 to 0/);
  });

  it("should distinguish out-of-range history from no history and offer recovery", async () => {
    vi.mocked(findGazetteHistory).mockResolvedValue({ ...PAGE, batches: [], page: 9 });
    const markup = await render({ page: "9" });
    expect(markup).toContain("There are no sends on this page.");
    expect(markup).toContain('href="/deed-polls/gazette/history">Go to the first page');
    expect(markup).not.toContain("No notices have been sent");
    expect(markup).not.toContain("201 to");
  });

  it("should omit pagination for a single page", async () => {
    vi.mocked(findGazetteHistory).mockResolvedValue({ ...PAGE, total: 1, totalPages: 1 });
    expect(await render()).not.toContain("govuk-pagination");
  });

  it("should escape hostile sender and reference text through the real table macro", async () => {
    vi.mocked(findGazetteHistory).mockResolvedValue({
      ...PAGE,
      batches: [
        {
          ...BATCH,
          sentBy: '<script>alert("sender")</script>',
          referenceNumbers: ['<img src=x onerror="alert(1)">', "A & B"]
        }
      ]
    });
    const markup = await render();
    expect(markup).toContain("&lt;script&gt;alert(&quot;sender&quot;)&lt;/script&gt;");
    expect(markup).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(markup).toContain("A &amp; B");
    expect(markup).not.toMatch(/<script>alert|<img src=x/);
  });

  it("should render Welsh headings, truncation and paging copy", async () => {
    const markup = await render({}, "cy");
    expect(markup).toContain("Hanes anfon i’r London Gazette");
    expect(markup).toContain("Anfonwyd gan");
    expect(markup).toContain("Dim ond rhai cyfeirnodau ceisiadau sy’n cael eu dangos.");
    expect(markup).toContain("1 i 25 o 26 o gofnodion anfon");
    expect(markup).not.toContain("Only some application references");
  });

  it("should propagate failures to the shared handler without rendering empty history", async () => {
    const error = new Error("API unavailable");
    vi.mocked(findGazetteHistory).mockRejectedValue(error);
    const res = pageResponse();
    await expect(GET(pageRequest({ teamLeader: true }), res)).rejects.toBe(error);
    expect(res.render).not.toHaveBeenCalled();
  });
});

it("should link a public batch ID to its complete membership and keep old missing IDs unlinked", async () => {
  const batchId = "00000000-0000-4000-8000-000000000001";
  vi.mocked(findGazetteHistory).mockResolvedValue({ ...PAGE, batches: [{ ...BATCH, batchId }, BATCH] });
  const markup = await render();
  expect(markup.match(new RegExp(`/deed-polls/gazette/requests/${batchId}`, "g"))).toHaveLength(1);
  expect(markup).toContain("View request and all application references");
});
