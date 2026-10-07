import path from "node:path";
import { fileURLToPath } from "node:url";
import { findGazetteReadyCases } from "@hmcts/deed-poll";
import nunjucks from "nunjucks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../express-doubles.js";
import { GET } from "./index.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findGazetteReadyCases: vi.fn()
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
const RECORD = {
  id: "case-1",
  displayReference: "KBDP2026-00001",
  privacy: "Normal",
  dateReceived: new Date("2026-03-01T00:00:00Z"),
  type: "Adult",
  state: "Enroled",
  newForename: "Ada",
  newSurname: "Lovelace"
};
const PAGE = { filter: "readyForPublication", cases: [RECORD], page: 1, size: 25, total: 26, totalPages: 2 };

async function render(query: Record<string, unknown> = {}, locale = "en") {
  const res = pageResponse();
  res.locals.locale = locale;
  await GET(pageRequest({ admin: true, accessToken: "admin-token", query }), res);
  const model = res.render.mock.calls[0][1];
  return { model, markup: environment.render("deed-polls/gazette/index.njk", { ...model[locale], ...model }) };
}

describe("Gazette ready list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findGazetteReadyCases).mockResolvedValue(PAGE as never);
  });

  it("should forward only the page and caller, dropping bookmarked sort and narrowing", async () => {
    const { markup } = await render({ page: "2", size: "1", sort: "newSurname:desc", filter: "all", where: "state:is:Returned", q: "Ada" });
    expect(findGazetteReadyCases).toHaveBeenCalledExactlyOnceWith({ page: 2 }, { accessToken: "admin-token" });
    expect(markup).not.toMatch(/sort=|where=|filter=|size=|q=|aria-sort|type="checkbox"/);
    expect(markup).not.toContain("<form");
  });

  it.each([undefined, "invalid", "0", "-1", "1.5"])("should leave the default page to API for %s", async (page) => {
    await render({ page });
    expect(findGazetteReadyCases).toHaveBeenCalledWith({ page: undefined }, { accessToken: "admin-token" });
  });

  it("should preserve API row order and link to case details and history", async () => {
    vi.mocked(findGazetteReadyCases).mockResolvedValue({ ...PAGE, cases: [{ ...RECORD, id: "case-2", displayReference: "SECOND" }, RECORD] } as never);
    const { markup } = await render();
    expect(markup.indexOf('href="/deed-polls/case-2"')).toBeLessThan(markup.indexOf('href="/deed-polls/case-1"'));
    expect(markup).toContain("KBDP2026-00001");
    expect(markup).toContain("Ada");
    expect(markup).toContain("Lovelace");
    expect(markup).toContain("1 March 2026");
    expect(markup).toContain('href="/deed-polls/gazette/history"');
    expect(markup).toContain('href="/deed-polls"');
    expect(markup).toContain("Applications enrolled longest ago are first");
  });

  it("should use API paging metadata and totals instead of the number of rows", async () => {
    vi.mocked(findGazetteReadyCases).mockResolvedValue({ ...PAGE, page: 2, size: 10, total: 43, totalPages: 5 } as never);
    const { markup } = await render({ page: "2" });
    expect(markup).toContain("11 to 20 of 43 applications");
    expect(markup).toContain('href="/deed-polls/gazette?page=1"');
    expect(markup).toContain('href="/deed-polls/gazette?page=3"');
    expect(markup).toContain('aria-current="page"');
  });

  it("should show an empty queue with history navigation and no table or paging", async () => {
    vi.mocked(findGazetteReadyCases).mockResolvedValue({ ...PAGE, cases: [], total: 0, totalPages: 0 } as never);
    const { markup } = await render();
    expect(markup).toContain("There are no applications ready for the London Gazette");
    expect(markup).toContain('href="/deed-polls/gazette/history"');
    expect(markup).not.toMatch(/govuk-table|govuk-pagination|0 to 0/);
  });

  it("should distinguish an out-of-range page from an empty queue and offer the first page", async () => {
    vi.mocked(findGazetteReadyCases).mockResolvedValue({ ...PAGE, cases: [], page: 9 } as never);
    const { markup } = await render({ page: "9" });
    expect(markup).toContain("There are no applications on this page");
    expect(markup).toContain('href="/deed-polls/gazette">Go to the first page');
    expect(markup).not.toContain("There are no applications ready");
    expect(markup).not.toContain("201 to");
  });

  it("should omit pagination for one page", async () => {
    vi.mocked(findGazetteReadyCases).mockResolvedValue({ ...PAGE, total: 1, totalPages: 1 } as never);
    const { markup } = await render();
    expect(markup).not.toContain("govuk-pagination");
  });

  it("should escape case references and names", async () => {
    vi.mocked(findGazetteReadyCases).mockResolvedValue({
      ...PAGE,
      cases: [{ ...RECORD, displayReference: "<script>reference</script>", newForename: "<b>Ada</b>", newSurname: "<i>Lovelace</i>" }]
    } as never);
    const { markup } = await render();
    expect(markup).toContain("&lt;script&gt;reference&lt;/script&gt;");
    expect(markup).toContain("&lt;b&gt;Ada&lt;/b&gt;");
    expect(markup).toContain("&lt;i&gt;Lovelace&lt;/i&gt;");
    expect(markup).not.toContain("<script>reference");
  });

  it("should render Welsh page copy and paging summary", async () => {
    const { markup } = await render({}, "cy");
    expect(markup).toContain("Ceisiadau sy’n barod ar gyfer y London Gazette");
    expect(markup).toContain("Hanes anfon");
    expect(markup).toContain("Cyfeirnod");
    expect(markup).toContain("1 i 25 o 26 o geisiadau");
    expect(markup).not.toContain("Applications enrolled longest ago");
  });

  it("should propagate a failed read to the shared error handler without claiming the list is empty", async () => {
    const error = new Error("API unavailable");
    vi.mocked(findGazetteReadyCases).mockRejectedValue(error);
    const res = pageResponse();
    await expect(GET(pageRequest({ admin: true }), res)).rejects.toBe(error);
    expect(res.render).not.toHaveBeenCalled();
  });
});
