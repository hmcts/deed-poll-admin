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
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findDeedPolls, findSavedQueries, InvalidInputError } from "@hmcts/deed-poll";
import nunjucks from "nunjucks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../express-doubles.js";
import { GET } from "./index.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPolls: vi.fn(),
  findSavedQueries: vi.fn()
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

/**
 * The `name="…"` attributes of every control in the markup, which is what a GET form submits.
 *
 * The leading space is load-bearing: the rows also carry `data-value-name`, which is the name of a control
 * the *browser* may build rather than a control being submitted, and matching it would count a control that
 * is not there.
 */
const controlNames = (markup: string): string[] => [...markup.matchAll(/ name="([^"]+)"/g)].map((match) => match[1]);

describe("deed-polls list template", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findDeedPolls).mockResolvedValue({ filter: "all", cases: [], page: 1, size: 25, total: 0, totalPages: 0 } as never);
    vi.mocked(findSavedQueries).mockResolvedValue([] as never);
  });

  it("submits the builder as a GET, because the URL is the query and a POST could not be bookmarked", async () => {
    const markup = await render();

    expect(markup).toContain('<form method="get" action="/deed-polls"');
  });

  it("carries the tab through the builder, so applying a query stays on the tab it was built on", async () => {
    const markup = await render({ filter: "enroled" });

    expect(markup).toContain('<input type="hidden" name="filter" value="enroled">');
  });

  it("carries the search term through the builder, so applying a filter narrows the search", async () => {
    const markup = await render({ q: "Smith" });

    expect(markup).toContain('<input type="hidden" name="q" value="Smith">');
  });

  it("carries no search control when nothing was searched, rather than submitting an empty q", async () => {
    const markup = await render();

    expect(markup).not.toContain('name="q"');
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

  it("asks for a missing value with a hint and no error markup, since the row is a step part-way through", async () => {
    const markup = await render({ where: "type:is:" });

    expect(markup).toContain('id="field-0-hint" class="govuk-hint">Enter a value to use this condition');
    expect(markup).toMatch(/id="field-0"[^>]*aria-describedby="field-0-hint"/);
    // The three ways this could be dressed up as a mistake, and is not: an error message, an errored form
    // group, and an entry in the error summary.
    expect(markup).not.toContain("govuk-error-message");
    expect(markup).not.toContain("govuk-form-group--error");
    expect(markup).not.toContain("govuk-error-summary");
    // And the control the hint is asking for a value in is on screen, which is the whole point.
    expect(markup).toMatch(/<select[^>]*name="value-0-0"/);
  });

  it("states an unused condition above the table, where a caseworker reading the results will see it", async () => {
    vi.mocked(findDeedPolls).mockResolvedValue({ filter: "all", cases: [record], page: 1, size: 25, total: 1, totalPages: 1 } as never);

    const markup = await render({ where: ["type:is:Adult", "newForename:is:"] });
    const statement = markup.indexOf("Condition 2 was not used, because it is not complete.");

    expect(statement).toBeGreaterThan(-1);
    expect(markup.indexOf('class="govuk-inset-text"')).toBeLessThan(markup.indexOf("<table"));
    expect(statement).toBeLessThan(markup.indexOf("<table"));
  });

  it("states nothing when every condition ran, so the page is quiet about a query it answered in full", async () => {
    const markup = await render({ where: "type:is:Adult" });

    expect(markup).not.toContain("govuk-inset-text");
    expect(markup).not.toContain("was not used");
  });

  it("offers the saved-query pages as links outside the builder's form, since saving is a page of its own", async () => {
    const markup = await render({ filter: "open", where: "type:is:Adult" });
    const afterForm = markup.slice(markup.lastIndexOf("</form>"));

    // Read after the last `</form>` so a link that drifted inside the GET form — where it would submit the
    // builder rather than open the save page — fails rather than passing on a substring match.
    expect(afterForm).toContain('href="/deed-polls/queries/new?filter=open&amp;where=type%3Ais%3AAdult"');
    expect(afterForm).toContain('href="/deed-polls/queries"');
  });

  it("shows every field the chooser offers, and not the ones api computes", async () => {
    const markup = await render();

    expect(markup).toContain('<option value="state">State</option>');
    expect(markup).not.toContain('value="daysReceivedToEnroled"');
  });

  it("groups the field chooser by tab and section, so the fields are not one flat list of 43", async () => {
    const markup = await render();
    const chooser = markup.slice(markup.indexOf('name="field-0"'));
    const groups = [...chooser.slice(0, chooser.indexOf("</select>")).matchAll(/<optgroup label="([^"]+)">/g)].map((match) => match[1]);

    expect(groups).toContain("Application: Names");
    expect(groups).toContain("Enrolment");
    // The placeholder is above every group rather than inside the first one, where it would be announced
    // as one of that section's fields.
    expect(chooser.indexOf("Choose a case field")).toBeLessThan(chooser.indexOf("<optgroup"));
  });

  /**
   * The enhancement's half of the page, which is markup and metadata and no behaviour: the browser swapping
   * a control in is driven in `deed-polls.spec.ts`, because a DOM is the only place it can be. What a
   * template test can hold is that everything the script reads is on the page and that none of it is a
   * second copy of a domain rule.
   */
  describe("the value control's enhancement", () => {
    /** The metadata block as the browser parses it. */
    const metadataFrom = (markup: string): Record<string, any> => {
      const opening = '<script type="application/json" id="query-builder-metadata">';
      const start = markup.indexOf(opening) + opening.length;

      return JSON.parse(markup.slice(start, markup.indexOf("</script>", start)));
    };

    it("carries the field, operator and control metadata once, as JSON the browser can parse", async () => {
      const markup = await render();
      const metadata = metadataFrom(markup);

      expect(metadata.fields.type).toEqual({ kind: "enum", options: expect.arrayContaining([{ value: "Adult", text: "Adult" }]) });
      expect(metadata.operators.between).toEqual({ label: "is between", arity: 2 });
      expect(metadata.kinds.date.operators).toContain("before");
      expect(metadata.kinds.date.controls["1"]).toBe("date");
      // The words the swapped-in controls read, which have no macro to default them.
      expect(metadata.labels.chooseValue).toBe("Choose a value");
      expect(metadata.labels.announceValue).toContain("{n}");
      // Once, so the page is not carrying the same table per row.
      expect([...markup.matchAll(/id="query-builder-metadata"/g)]).toHaveLength(1);
    });

    it("gives each row the names the script needs, rather than leaving it to compose them", async () => {
      const markup = await render({ where: "dateReceived:between:2026-03-01,2026-04-01" });

      expect(markup).toContain('data-query-row="0"');
      expect(markup).toContain('data-condition-number="1"');
      expect(markup).toContain('data-value-name="value-0-0"');
      expect(markup).toContain('data-upper-value-name="value-0-1"');
    });

    it("marks the two choosers and the column the control is swapped into", async () => {
      const markup = await render();

      expect(markup).toMatch(/<select[^>]*id="field-0"[^>]*data-query-field/);
      expect(markup).toMatch(/<select[^>]*id="op-0"[^>]*data-query-operator/);
      expect(markup).toContain('<div class="govuk-grid-column-one-quarter" data-query-values>');
    });

    it("gives the builder one polite live region, empty until something changes", async () => {
      const markup = await render();

      expect(markup).toContain('<div class="govuk-visually-hidden" aria-live="polite" data-query-announcer></div>');
      // Polite and not assertive: a control appearing is not worth interrupting a caseworker mid-sentence.
      expect(markup).not.toContain('aria-live="assertive"');
    });

    it("still asks for the value with a plain control, so the page works with the script blocked", async () => {
      const markup = await render({ where: "type:is:" });

      // The metadata is a data block, not a script: nothing on this page executes to make the builder work.
      expect(markup).toMatch(/<select[^>]*name="value-0-0"/);
      expect(markup).toMatch(/<button[^>]*type="submit"[^>]*name="apply"/);
    });
  });

  it("keeps the chosen field selected inside its group, so the round trip comes back showing it", async () => {
    const markup = await render({ where: "newSurname:is:Lovelace" });

    expect(markup).toMatch(/<optgroup label="Application: Names">[\s\S]*?<option value="newSurname" selected>New surname<\/option>/);
  });

  describe("the filter bar", () => {
    /** The nav on its own, so an assertion about what the bar carries cannot be satisfied by the rest of the page. */
    const filterNav = (markup: string): string => markup.match(/<nav class="app-filter-nav"[\s\S]*?<\/nav>/)?.[0] ?? "";

    /**
     * One group of the bar, since the saved-query group renders the same markup as the status group.
     *
     * A count of items across the whole `<nav>` was the plan-10 assertion, and it would now be satisfied by
     * five items spread over two groups — so a count of statuses is scoped to the group it counts.
     */
    const group = (nav: string, index: number): string => [...nav.matchAll(/<div class="app-filter-nav__group">[\s\S]*?<\/div>/g)][index]?.[0] ?? "";

    it("renders the tabs as a list, because a set of sibling destinations is one", async () => {
      const nav = filterNav(await render());

      expect(nav).toContain('<ul class="app-filter-nav__list">');
      expect([...group(nav, 0).matchAll(/<li class="app-filter-nav__item">/g)]).toHaveLength(5);
    });

    it("marks the current tab with aria-current=page rather than a strong, since you-are-here is not importance", async () => {
      const nav = filterNav(await render({ filter: "enroled" }));

      expect(nav).toContain('<span class="app-filter-nav__current" aria-current="page">Enroled</span>');
      expect(nav).not.toContain("<strong");
      expect(nav).not.toContain('aria-current="true"');
      // One current entry, so the other four are still links to somewhere.
      expect([...nav.matchAll(/aria-current=/g)]).toHaveLength(1);
    });

    it("does not fade the tabs a caseworker has already used, which would read as progress through them", async () => {
      const nav = filterNav(await render());

      expect([...nav.matchAll(/class="govuk-link govuk-link--no-visited-state"/g)]).toHaveLength(4);
    });

    it("leaves the spacing to the component, so the markup carries no override utilities", async () => {
      const nav = filterNav(await render());

      expect(nav).not.toContain("govuk-!-");
    });

    it("renders the caseworker's selected queries as a second group of the same markup", async () => {
      vi.mocked(findSavedQueries).mockResolvedValue([
        {
          id: "q-1",
          name: "Adult, open",
          description: null,
          filter: "open",
          conditions: ["type:is:Adult"],
          sortField: null,
          sortDirection: null,
          shared: false,
          selected: true,
          editable: true
        }
      ] as never);

      const nav = filterNav(await render({ filter: "open", where: "type:is:Adult" }));

      expect([...nav.matchAll(/<div class="app-filter-nav__group">/g)]).toHaveLength(2);
      expect(group(nav, 1)).toContain('<h2 class="app-filter-nav__group-label">Saved queries</h2>');
      // The request is that query, so its entry says "you are here" rather than linking to where you are.
      expect(group(nav, 1)).toContain('<span class="app-filter-nav__current" aria-current="page">Adult, open</span>');
    });

    it("links a selected query that is not the one being looked at, carrying its whole query in the URL", async () => {
      vi.mocked(findSavedQueries).mockResolvedValue([
        {
          id: "q-1",
          name: "Adult, open",
          description: null,
          filter: "open",
          conditions: ["type:is:Adult"],
          sortField: null,
          sortDirection: null,
          shared: false,
          selected: true,
          editable: true
        }
      ] as never);

      const nav = filterNav(await render());

      expect(group(nav, 1)).toContain(
        '<a class="govuk-link govuk-link--no-visited-state" href="/deed-polls?filter=open&amp;where=type%3Ais%3AAdult">Adult, open</a>'
      );
    });

    it("labels the group, ready for plan 11's saved queries to sit in a second one", async () => {
      const nav = filterNav(await render());

      expect(nav).toMatch(/<div class="app-filter-nav__group">\s*<h2 class="app-filter-nav__group-label">Status<\/h2>/);
      // Wording true of every group the bar can hold, since the second one is saved queries and not
      // statuses — plan 11's decision 4. The group's own label is what says "status".
      expect(nav).toContain('aria-label="Filter cases"');
      expect(nav).not.toContain("Filter by status");
    });

    it("renders one group when the caseworker has selected no queries, so an empty labelled group is never drawn", async () => {
      const nav = filterNav(await render());

      expect([...nav.matchAll(/<div class="app-filter-nav__group">/g)]).toHaveLength(1);
    });

    /**
     * The stylesheet and not the markup, because "distinguishable by something other than weight" is a rule
     * about how the current entry is drawn — and the only other place that claim could live is a screenshot.
     */
    it("distinguishes the current tab with a border, not by boldness alone", async () => {
      const partial = await readFile(path.join(fileURLToPath(import.meta.url), "../../../assets/css/components/_filter-nav.scss"), "utf8");
      const currentRule = partial.match(/\.app-filter-nav__current \{[^}]*\}/)?.[0] ?? "";

      expect(currentRule).toMatch(/border-bottom: \d+px solid/);
    });
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
