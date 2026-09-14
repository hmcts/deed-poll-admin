/**
 * The case list's own markup, rendered rather than asserted through the view model.
 *
 * The view model is tested where it is built (`query-builder.test.ts`); what this file exists for is the
 * one thing a model cannot show: that the builder is **usable with JavaScript disabled**. Add and Remove
 * being submit buttons inside a GET form, and the value control actually being the one the field's kind
 * asks for, are properties of the template — and the plan's decision 7 is that a query builder which dies
 * with a CSP change is worse than a slower one.
 *
 * The model comes from the page handler rather than being hand-built here, so a name the handler stops
 * passing fails this test too. `en` is spread over it because `renderInterceptorMiddleware` is what does
 * that in a real request, and the double does not run middleware.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findDeedPolls, InvalidInputError } from "@hmcts/deed-poll";
import nunjucks from "nunjucks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../express-doubles.js";
import { GET } from "./index.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPolls: vi.fn()
}));

// The three roots `configureGovuk` mounts, minus the assets it also wires up: govuk-frontend's macros,
// the starter's layouts, and this app's pages.
const STARTER_VIEWS = path.join(fileURLToPath(import.meta.url), "../../../../libs/express-govuk-starter/src");
const environment = nunjucks.configure(
  [
    path.join(fileURLToPath(import.meta.resolve("govuk-frontend")), "..", ".."),
    path.join(STARTER_VIEWS, "govuk-frontend/views"),
    path.join(STARTER_VIEWS, "cookies/views"),
    path.join(fileURLToPath(import.meta.url), "../../..", "pages")
  ],
  { autoescape: true }
);

/** One row, since the table — and so its sortable headers — renders only for a result set with rows in it. */
const record = {
  id: "case-1",
  displayReference: "KBDP2026-00001",
  privacy: "Normal",
  dateReceived: new Date("2026-03-01T00:00:00.000Z"),
  type: "Adult",
  state: "Received",
  newForename: "Ada"
};

/** The list page as a browser receives it, for the query the URL carries. */
const render = async (query: Record<string, unknown> = {}): Promise<string> => {
  const res = pageResponse();
  await GET(pageRequest({ query }), res);
  const model = res.render.mock.calls[0][1];

  return environment.render("deed-polls/index.njk", { ...model, ...model.en });
};

/** The `name="…"` attributes of every control in the markup, which is what a GET form submits. */
const controlNames = (markup: string): string[] => [...markup.matchAll(/name="([^"]+)"/g)].map((match) => match[1]);

describe("deed-polls list template", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findDeedPolls).mockResolvedValue({ filter: "all", cases: [], page: 1, size: 25, total: 0, totalPages: 0 } as never);
  });

  it("submits the builder as a GET, because the URL is the query and a POST could not be bookmarked", async () => {
    const markup = await render();

    expect(markup).toContain('<form method="get" action="/deed-polls"');
  });

  it("carries the tab through the builder, so applying a query stays on the tab it was built on", async () => {
    const markup = await render({ filter: "enroled" });

    expect(markup).toContain('<input type="hidden" name="filter" value="enroled">');
  });

  it("adds and removes rows with submit buttons, so the builder needs no JavaScript at all", async () => {
    const markup = await render({ where: "type:is:Adult" });

    expect(markup).toMatch(/<button[^>]*type="submit"[^>]*name="add"/);
    // Its own row's index, so removing the first row does not need JavaScript to say which row it was.
    expect(markup).toMatch(/<button[^>]*type="submit" value="0" name="remove"/);
    expect(markup).toMatch(/<button[^>]*type="submit"[^>]*name="apply"/);
  });

  it("joins the rows with the word and, since api ANDs them and offers no other choice", async () => {
    const markup = await render({ where: ["type:is:Adult", "state:is:Received"] });
    const joins = markup.match(/>and</g) ?? [];

    expect(joins).toHaveLength(1);
  });

  it("needs no joining word for a single row", async () => {
    const markup = await render({ where: "type:is:Adult" });

    expect(markup.match(/>and</g)).toBeNull();
  });

  it("asks for a date with the three parts of a date input", async () => {
    const markup = await render({ where: "dateReceived:is:2026-03-01" });

    expect(controlNames(markup)).toEqual(expect.arrayContaining(["value-0-0-day", "value-0-0-month", "value-0-0-year"]));
    expect(markup).toContain('value="2026"');
  });

  it("asks for both bounds of a between separately", async () => {
    const markup = await render({ where: "dateReceived:between:2026-03-01,2026-04-01" });

    expect(controlNames(markup)).toEqual(expect.arrayContaining(["value-0-0-day", "value-0-1-day"]));
  });

  it("asks for an enum with a select of its members, with the chosen one selected", async () => {
    const markup = await render({ where: "type:is:Minor" });

    expect(markup).toMatch(/<select[^>]*name="value-0-0"/);
    expect(markup).toContain('<option value="Minor" selected>Minor</option>');
  });

  it("asks for isOneOf with checkboxes sharing one name, which is how a set arrives", async () => {
    const markup = await render({ where: "type:isOneOf:Adult,Minor" });

    expect(markup).toMatch(/<input class="govuk-checkboxes__input" id="value-0-0" name="value-0-0" type="checkbox" value="Adult" checked>/);
    expect(controlNames(markup).filter((name) => name === "value-0-0")).toHaveLength(6);
  });

  it("asks for a boolean with Yes and No radios", async () => {
    const markup = await render({ where: "inPerson:is:true" });

    expect(markup).toMatch(/<input class="govuk-radios__input"[^>]*type="radio" value="true" checked>/);
    expect(markup).toContain("Yes");
  });

  it("asks for a number with a number input", async () => {
    const markup = await render({ where: "ageOfMinor:gt:4" });

    expect(markup).toContain('id="value-0-0" name="value-0-0" type="number" value="4">');
  });

  it("asks for text with a text input", async () => {
    const markup = await render({ where: "newForename:contains:Ada" });

    expect(markup).toContain('id="value-0-0" name="value-0-0" type="text" value="Ada">');
  });

  it("renders no value control at all for isEmpty, so nothing implies a value is wanted", async () => {
    const markup = await render({ where: "parents:isEmpty" });

    expect(controlNames(markup)).not.toContain("value-0-0");
    expect(controlNames(markup)).toEqual(expect.arrayContaining(["field-0", "op-0"]));
  });

  it("offers only the operators the chosen field's kind admits", async () => {
    const markup = await render({ where: "inPerson:is:true" });
    const operators = markup.slice(markup.indexOf('name="op-0"'));

    expect(operators.slice(0, operators.indexOf("</select>"))).not.toContain("contains");
  });

  it("announces a refused row with its own controls, so a screen reader reaches the error from the row", async () => {
    vi.mocked(findDeedPolls).mockRejectedValue(new InvalidInputError("Case query is not valid", [{ field: "where.0", message: "names no case field" }]));

    const markup = await render({ where: "type:is:Adult" });

    expect(markup).toContain('id="field-0-error" class="govuk-error-message"');
    expect(markup).toMatch(/id="field-0"[^>]*aria-describedby="field-0-error"/);
    expect(markup).toContain("govuk-form-group--error");
  });

  it("shows every field the chooser offers, and not the ones api computes", async () => {
    const markup = await render();

    expect(markup).toContain('<option value="state">State</option>');
    expect(markup).not.toContain('value="daysReceivedToEnroled"');
  });

  describe("the order and the page", () => {
    /** One page of a longer result set: the counts a caseworker pages through. */
    const results = (page: number) => ({ filter: "all", cases: [record], page, size: 25, total: 213, totalPages: 9 });

    it("makes each column heading a link, so reordering needs no JavaScript either", async () => {
      vi.mocked(findDeedPolls).mockResolvedValue(results(1) as never);

      const markup = await render();

      expect(markup).toContain('<a class="govuk-link" href="/deed-polls?sort=dateReceived%3Aasc">');
      expect(markup).toContain("Sort by </span>Received");
    });

    it("marks how the table is ordered with aria-sort, which the link text does not say", async () => {
      vi.mocked(findDeedPolls).mockResolvedValue(results(1) as never);

      const markup = await render({ sort: "state:desc" });

      expect(markup).toMatch(/<th[^>]*aria-sort="descending"[^>]*>\s*<a class="govuk-link" href="\/deed-polls\?sort=state%3Aasc"/);
      expect([...markup.matchAll(/aria-sort="none"/g)]).toHaveLength(5);
    });

    it("carries the order through the builder as a control of its own, since the form submits as a GET", async () => {
      vi.mocked(findDeedPolls).mockResolvedValue(results(1) as never);

      const markup = await render({ sort: "state:desc" });

      expect(markup).toContain('<input type="hidden" name="sort" value="state:desc">');
    });

    it("carries no sort control when the table is in api's own order, rather than naming a default", async () => {
      const markup = await render();

      expect(markup).not.toContain('name="sort"');
    });

    it("states the range and the total in words, from api's counts", async () => {
      vi.mocked(findDeedPolls).mockResolvedValue(results(4) as never);

      const markup = await render({ page: "4" });

      expect(markup).toContain("76 to 100 of 213 applications");
    });

    it("renders the pagination with the pages api says there are", async () => {
      vi.mocked(findDeedPolls).mockResolvedValue(results(4) as never);

      const markup = await render({ page: "4" });

      expect(markup).toContain('<nav class="govuk-pagination"');
      expect(markup).toContain('href="/deed-polls?page=3" rel="prev"');
      expect(markup).toContain('href="/deed-polls?page=5" rel="next"');
      expect(markup).toContain('aria-label="Page 9"');
      expect(markup).toContain("&ctdot;");
    });

    it("renders no pagination when one page holds everything", async () => {
      vi.mocked(findDeedPolls).mockResolvedValue({ filter: "all", cases: [record], page: 1, size: 25, total: 1, totalPages: 1 } as never);

      const markup = await render();

      expect(markup).not.toContain("govuk-pagination");
      expect(markup).toContain("1 to 1 of 1 applications");
    });
  });
});
