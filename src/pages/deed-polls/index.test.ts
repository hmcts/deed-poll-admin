import { findDeedPolls, findSavedQueries, InvalidInputError } from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../express-doubles.js";
import { GET } from "./index.js";

// The filters and the row formatting are the domain's, and tested there. Only the api calls are
// replaced, so this exercises the page against the real filter, nav and view-model logic.
vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPolls: vi.fn(),
  findSavedQueries: vi.fn()
}));

/** api's list envelope: the rows plus the counts every page of it carries. */
const page = (cases: unknown[]) => ({ filter: "all", cases, page: 1, size: 25, total: cases.length, totalPages: cases.length === 0 ? 0 : 1 });

/**
 * The keys of every nav entry the render marked current.
 *
 * A list rather than a single value, because "exactly one entry is current" is half of what the assertion
 * is for: a bar with two current entries tells a screen-reader user they are in two places.
 */
const currentEntries = (res: ReturnType<typeof pageResponse>): string[] =>
  res.render.mock.calls[0][1].filterGroups.flatMap((group: { entries: { key: string; current: boolean }[] }) =>
    group.entries.filter((entry) => entry.current).map((entry) => entry.key)
  );

const record = {
  id: "case-1",
  displayReference: "KBDP2026-00001",
  privacy: "Normal",
  dateReceived: new Date("2026-03-01T00:00:00.000Z"),
  type: "Adult",
  state: "Received",
  newForename: "Ada"
};

/**
 * One of api's saved queries, with only the properties the nav reads spelled out.
 *
 * `selected` defaults to true because the nav is the selection: a test that wants an unselected one says
 * so, and every other test in here is about a query that is in the caseworker's list.
 */
const savedQuery = (fields: Record<string, unknown>) => ({
  description: null,
  searchTerm: null,
  sortField: null,
  sortDirection: null,
  shared: false,
  selected: true,
  editable: true,
  ownerName: "A Caseworker",
  ...fields
});

describe("deed-polls list page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findDeedPolls).mockResolvedValue(page([]) as never);
    vi.mocked(findSavedQueries).mockResolvedValue([] as never);
  });

  it("renders its own template, qualified by directory so it cannot be shadowed by pages/index.njk", async () => {
    vi.mocked(findDeedPolls).mockResolvedValue(page([record]) as never);
    const res = pageResponse();

    await GET(pageRequest(), res);

    expect(res.render).toHaveBeenCalledWith(
      "deed-polls/index",
      expect.objectContaining({
        cases: [expect.objectContaining({ id: "case-1", reference: "KBDP2026-00001", dateReceived: "1 March 2026", type: "Adult" })]
      })
    );
  });

  it("asks for the default filter when none was chosen, so the default view is everything", async () => {
    await GET(pageRequest(), pageResponse());

    expect(findDeedPolls).toHaveBeenCalledWith({ filter: "all", conditions: [] }, expect.anything());
  });

  it("sends api the key of the requested filter, rather than a clause of its own", async () => {
    await GET(pageRequest({ query: { filter: "enroled" } }), pageResponse());

    expect(findDeedPolls).toHaveBeenCalledWith({ filter: "enroled", conditions: [] }, expect.anything());
  });

  it("falls back to 'all' for an unrecognised filter rather than erroring", async () => {
    const res = pageResponse();

    await GET(pageRequest({ query: { filter: "nonsense" } }), res);

    expect(findDeedPolls).toHaveBeenCalledWith({ filter: "all", conditions: [] }, expect.anything());
    expect(currentEntries(res)).toEqual(["all"]);
  });

  it("presents the caseworker's own token, so api authenticates and audits as them", async () => {
    await GET(pageRequest({ accessToken: "caseworker-token" }), pageResponse());

    expect(findDeedPolls).toHaveBeenCalledWith({ filter: "all", conditions: [] }, { accessToken: "caseworker-token" });
  });

  it("decides which entry is current in the handler, since a saved query's identity is not its label", async () => {
    const res = pageResponse();

    await GET(pageRequest({ query: { filter: "open" } }), res);

    // One current entry, and the tab bar is told which rather than comparing keys in the template.
    expect(currentEntries(res)).toEqual(["open"]);
  });

  it("carries the filter into the builder's hidden control separately from the nav's current entry", async () => {
    const res = pageResponse();

    await GET(pageRequest({ query: { filter: "open" } }), res);

    expect(res.render).toHaveBeenCalledWith("deed-polls/index", expect.objectContaining({ filterValue: "open" }));
  });

  it("groups the nav's entries under a label, so a second group costs no template change", async () => {
    const res = pageResponse();

    await GET(pageRequest(), res);

    const groups = res.render.mock.calls[0][1].filterGroups;
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Status");
    expect(groups[0].entries).toHaveLength(5);
  });

  it("passes the filter tabs without their where clauses", async () => {
    const res = pageResponse();

    await GET(pageRequest(), res);

    const model = res.render.mock.calls[0][1];
    for (const entry of model.filterGroups[0].entries) {
      expect(Object.keys(entry)).toEqual(["key", "label", "href", "current"]);
    }
  });

  it("provides both en and cy content objects", async () => {
    const res = pageResponse();

    await GET(pageRequest(), res);

    const model = res.render.mock.calls[0][1];
    expect(Object.keys(model.en)).toEqual(Object.keys(model.cy));
  });

  it("renders an empty case list without failing, so the empty state is the template's job", async () => {
    const res = pageResponse();

    await GET(pageRequest(), res);

    expect(res.render).toHaveBeenCalledWith("deed-polls/index", expect.objectContaining({ cases: [] }));
  });

  describe("the saved-query group", () => {
    /** The nav's second group, or undefined when the bar holds only the statuses. */
    const savedGroup = (res: ReturnType<typeof pageResponse>) => res.render.mock.calls[0][1].filterGroups[1];

    it("appends the caseworker's selected queries as a second labelled group", async () => {
      vi.mocked(findSavedQueries).mockResolvedValue([
        savedQuery({ id: "q-1", name: "Adult, this month", filter: "open", conditions: ["type:is:Adult"] })
      ] as never);
      const res = pageResponse();

      await GET(pageRequest(), res);

      expect(res.render.mock.calls[0][1].filterGroups).toHaveLength(2);
      expect(savedGroup(res).label).toBe("Saved queries");
      // Keyed on the id, not the name: two queries may be called the same thing.
      expect(savedGroup(res).entries).toEqual([
        { key: "q-1", label: "Adult, this month", href: "/deed-polls?filter=open&where=type%3Ais%3AAdult", current: false }
      ]);
    });

    it("reads the selection from the one call that answers both screens, with the caseworker's own token", async () => {
      await GET(pageRequest({ accessToken: "caseworker-token" }), pageResponse());

      expect(findSavedQueries).toHaveBeenCalledTimes(1);
      expect(findSavedQueries).toHaveBeenCalledWith({ accessToken: "caseworker-token" });
    });

    it("leaves out a query the caseworker has not selected, because the group is their own list", async () => {
      vi.mocked(findSavedQueries).mockResolvedValue([
        savedQuery({ id: "q-1", name: "Mine", filter: "open", conditions: [] }),
        savedQuery({ id: "q-2", name: "Somebody else's", filter: "returned", conditions: [], shared: true, selected: false })
      ] as never);
      const res = pageResponse();

      await GET(pageRequest(), res);

      expect(savedGroup(res).entries.map((entry: { key: string }) => entry.key)).toEqual(["q-1"]);
    });

    it("marks the saved query current when the request is the query it describes", async () => {
      vi.mocked(findSavedQueries).mockResolvedValue([
        savedQuery({ id: "q-1", name: "Adult, open", filter: "open", conditions: ["type:is:Adult"] }),
        savedQuery({ id: "q-2", name: "Everything", filter: "all", conditions: [] })
      ] as never);
      const res = pageResponse();

      await GET(pageRequest({ query: { filter: "open", where: "type:is:Adult" } }), res);

      expect(
        savedGroup(res)
          .entries.filter((entry: { current: boolean }) => entry.current)
          .map((entry: { key: string }) => entry.key)
      ).toEqual(["q-1"]);
    });

    it("renders no second group when the caseworker has selected nothing, rather than a heading over nothing", async () => {
      vi.mocked(findSavedQueries).mockResolvedValue([savedQuery({ id: "q-2", name: "Not mine", filter: "all", conditions: [], selected: false })] as never);
      const res = pageResponse();

      await GET(pageRequest(), res);

      expect(res.render.mock.calls[0][1].filterGroups).toHaveLength(1);
    });

    it("still renders the cases when the saved queries cannot be read, since the nav is not the page's job", async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(findDeedPolls).mockResolvedValue(page([record]) as never);
      vi.mocked(findSavedQueries).mockRejectedValue(new Error("deed-poll-api call failed (unavailable)"));
      const res = pageResponse();

      await GET(pageRequest(), res);

      const model = res.render.mock.calls[0][1];
      expect(model.cases).toHaveLength(1);
      expect(model.filterGroups).toHaveLength(1);
      expect(res.status).not.toHaveBeenCalled();
      expect(logged).toHaveBeenCalledWith(expect.stringContaining("saved queries unavailable"));
    });

    it("degrades the same way when api also refuses the query, so neither failure hides the other", async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(findDeedPolls).mockRejectedValue(new InvalidInputError("refused", [{ field: "where", message: "Unknown field" }]));
      vi.mocked(findSavedQueries).mockRejectedValue(new Error("deed-poll-api call failed (unavailable)"));
      const res = pageResponse();

      await GET(pageRequest({ query: { where: "nonsense:is:1" } }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][1].filterGroups).toHaveLength(1);
      expect(logged).toHaveBeenCalledWith(expect.stringContaining("saved queries unavailable"));
    });
  });

  describe("the query", () => {
    it("sends api the conditions the URL carries, so the query is the URL and not a session draft", async () => {
      await GET(pageRequest({ query: { where: ["type:is:Adult", "dateReceived:after:2026-01-01"] } }), pageResponse());

      expect(findDeedPolls).toHaveBeenCalledWith(
        {
          filter: "all",
          conditions: [
            { field: "type", operator: "is", values: ["Adult"] },
            { field: "dateReceived", operator: "after", values: ["2026-01-01"] }
          ]
        },
        expect.anything()
      );
    });

    it("renders the rows a query answered with, and the rows it was built from beside them", async () => {
      vi.mocked(findDeedPolls).mockResolvedValue(page([record]) as never);
      const res = pageResponse();

      await GET(pageRequest({ query: { where: "newForename:is:Ada" } }), res);

      const model = res.render.mock.calls[0][1];
      expect(model.cases).toEqual([expect.objectContaining({ reference: "KBDP2026-00001", newForename: "Ada" })]);
      expect(model.queryRows).toHaveLength(1);
      expect(model.queryRows[0].values[0].value).toBe("Ada");
      expect(model.errorSummary).toEqual([]);
    });

    it("applies the tab and the query together, because a query narrows within the selected tab", async () => {
      await GET(pageRequest({ query: { filter: "open", where: "type:is:Adult" } }), pageResponse());

      expect(findDeedPolls).toHaveBeenCalledWith({ filter: "open", conditions: [{ field: "type", operator: "is", values: ["Adult"] }] }, expect.anything());
    });

    it("carries the query on every tab link, so switching tab keeps the conditions", async () => {
      const res = pageResponse();

      await GET(pageRequest({ query: { filter: "open", where: "type:is:Adult" } }), res);

      const model = res.render.mock.calls[0][1];
      expect(model.filterGroups[0].entries.map((tab: { href: string }) => tab.href)).toEqual([
        "/deed-polls?where=type%3Ais%3AAdult",
        "/deed-polls?filter=open&where=type%3Ais%3AAdult",
        "/deed-polls?filter=received&where=type%3Ais%3AAdult",
        "/deed-polls?filter=enroled&where=type%3Ais%3AAdult",
        "/deed-polls?filter=returned&where=type%3Ais%3AAdult"
      ]);
    });

    it("offers a way back to the unfiltered tab, keeping the tab and dropping the conditions", async () => {
      const res = pageResponse();

      await GET(pageRequest({ query: { filter: "open", where: "type:is:Adult" } }), res);

      expect(res.render.mock.calls[0][1].clearHref).toBe("/deed-polls?filter=open");
    });

    it("offers to save the query as the URL states it, so the save page needs no hidden inputs", async () => {
      const res = pageResponse();

      await GET(pageRequest({ query: { filter: "open", where: "type:is:Adult", sort: "dateReceived:desc" } }), res);

      expect(res.render.mock.calls[0][1].saveQueryHref).toBe("/deed-polls/queries/new?filter=open&where=type%3Ais%3AAdult&sort=dateReceived%3Adesc");
    });

    it("offers to save an unfiltered list, which is a view somebody wants a tab for too", async () => {
      const res = pageResponse();

      await GET(pageRequest(), res);

      expect(res.render.mock.calls[0][1].saveQueryHref).toBe("/deed-polls/queries/new");
    });

    it("offers the library, which is not query-specific and so carries nothing", async () => {
      const res = pageResponse();

      await GET(pageRequest({ query: { filter: "open" } }), res);

      expect(res.render.mock.calls[0][1].libraryHref).toBe("/deed-polls/queries");
    });

    it("renders one empty row for a list with no query, since an empty row is the invitation to filter", async () => {
      const res = pageResponse();

      await GET(pageRequest(), res);

      const rows = res.render.mock.calls[0][1].queryRows;
      expect(rows).toHaveLength(1);
      expect(rows[0].control).toBe("none");
    });

    it("renders no value control for isEmpty, rather than a disabled box implying a value is wanted", async () => {
      const res = pageResponse();

      await GET(pageRequest({ query: { where: "parents:isEmpty" } }), res);

      const row = res.render.mock.calls[0][1].queryRows[0];
      expect(row.control).toBe("none");
      expect(row.values).toEqual([]);
    });

    it("answers 200 for a condition with no value yet, keeping the row and the results already on screen", async () => {
      vi.mocked(findDeedPolls).mockResolvedValue(page([record]) as never);
      const res = pageResponse();

      await GET(pageRequest({ query: { where: "type:is:" } }), res);

      expect(res.status).not.toHaveBeenCalled();
      const model = res.render.mock.calls[0][1];
      // The row survives, so the value control is on screen for the value to be typed into.
      expect(model.queryRows).toHaveLength(1);
      expect(model.queryRows[0].control).toBe("select");
      expect(model.queryRows[0].hint).toBe("Enter a value to use this condition");
      expect(model.queryRows[0].error).toBeUndefined();
      expect(model.errorSummary).toEqual([]);
      expect(model.cases).toHaveLength(1);
    });

    it("states above the table which condition the query ran without, since filtering by less than was asked is worse", async () => {
      const res = pageResponse();

      await GET(pageRequest({ query: { where: ["type:is:Adult", "newForename:is:"] } }), res);

      expect(res.render.mock.calls[0][1].unusedConditions).toBe("Condition 2 was not used, because it is not complete.");
    });

    it("names every unused condition in one statement, reading as a sentence", async () => {
      const res = pageResponse();

      await GET(pageRequest({ query: { where: ["type:is:", "newForename:is:", "ageOfMinor:between:3"] } }), res);

      expect(res.render.mock.calls[0][1].unusedConditions).toBe("Conditions 1, 2 and 3 were not used, because they are not complete.");
    });

    it("states nothing for a query every condition of which ran", async () => {
      const res = pageResponse();

      await GET(pageRequest({ query: { where: ["type:is:Adult", "parents:isEmpty"] } }), res);

      expect(res.render.mock.calls[0][1].unusedConditions).toBe("");
    });

    it("treats an operator compared without a value as complete, rather than asking for one it renders no control for", async () => {
      const res = pageResponse();

      await GET(pageRequest({ query: { where: ["parents:isEmpty", "newForename:isNotEmpty"] } }), res);

      const model = res.render.mock.calls[0][1];
      expect(model.queryRows.map((row: { hint?: string }) => row.hint)).toEqual([undefined, undefined]);
      expect(model.unusedConditions).toBe("");
      expect(res.status).not.toHaveBeenCalled();
    });

    it("asks for both bounds of a between holding one of two, and runs the query without it", async () => {
      const res = pageResponse();

      await GET(pageRequest({ query: { where: "ageOfMinor:between:3" } }), res);

      const model = res.render.mock.calls[0][1];
      expect(model.queryRows[0].hint).toBe("Enter both values to use this condition");
      expect(model.unusedConditions).toBe("Condition 1 was not used, because it is not complete.");
      expect(res.status).not.toHaveBeenCalled();
    });

    it("renders the value control the chosen field's kind asks for", async () => {
      const res = pageResponse();

      await GET(pageRequest({ query: { where: ["dateReceived:is:2026-03-01", "type:is:Adult", "inPerson:is:true"] } }), res);

      expect(res.render.mock.calls[0][1].queryRows.map((row: { control: string }) => row.control)).toEqual(["date", "select", "radios"]);
    });
  });

  describe("the search", () => {
    it("sends api the term the URL carries, so the matching is api's and nothing is searched here", async () => {
      await GET(pageRequest({ query: { q: "Smith" } }), pageResponse());

      expect(findDeedPolls).toHaveBeenCalledWith({ filter: "all", q: "Smith", conditions: [], sort: undefined, page: undefined }, expect.anything());
    });

    it("trims the term, since a leading space is a paste rather than a search for one", async () => {
      await GET(pageRequest({ query: { q: "  Smith  " } }), pageResponse());

      expect(findDeedPolls).toHaveBeenCalledWith(expect.objectContaining({ q: "Smith" }), expect.anything());
    });

    it("sends no term for a search of only whitespace, leaving the list exactly as it is without one", async () => {
      await GET(pageRequest({ query: { q: "   " } }), pageResponse());

      expect(findDeedPolls).toHaveBeenCalledWith({ filter: "all", q: undefined, conditions: [], sort: undefined, page: undefined }, expect.anything());
    });

    it("applies the term with the tab and the query, because api ANDs a search within them", async () => {
      await GET(pageRequest({ query: { q: "Smith", filter: "open", where: "type:is:Adult" } }), pageResponse());

      expect(findDeedPolls).toHaveBeenCalledWith(
        expect.objectContaining({ filter: "open", q: "Smith", conditions: [{ field: "type", operator: "is", values: ["Adult"] }] }),
        expect.anything()
      );
    });

    it("carries the term on every tab link, so switching tab searches within the other tab", async () => {
      const res = pageResponse();

      await GET(pageRequest({ query: { q: "Smith", filter: "open" } }), res);

      expect(res.render.mock.calls[0][1].filterGroups[0].entries.map((tab: { href: string }) => tab.href)).toEqual([
        "/deed-polls?q=Smith",
        "/deed-polls?filter=open&q=Smith",
        "/deed-polls?filter=received&q=Smith",
        "/deed-polls?filter=enroled&q=Smith",
        "/deed-polls?filter=returned&q=Smith"
      ]);
    });

    it("carries the term on every sort header, so reordering results does not silently widen them", async () => {
      const res = pageResponse();

      await GET(pageRequest({ query: { q: "Smith" } }), res);

      for (const header of res.render.mock.calls[0][1].sortHeaders) {
        expect(header.href).toContain("q=Smith");
      }
    });

    it("carries the term on every page link, since page 2 of a search is a page of that search", async () => {
      vi.mocked(findDeedPolls).mockResolvedValue({ filter: "all", cases: [], page: 2, size: 25, total: 60, totalPages: 3 } as never);
      const res = pageResponse();

      await GET(pageRequest({ query: { q: "Smith", page: "2" } }), res);

      const { links } = res.render.mock.calls[0][1].paging;
      expect(links.previous).toEqual({ href: "/deed-polls?q=Smith" });
      expect(links.next).toEqual({ href: "/deed-polls?q=Smith&page=3" });
    });

    it("keeps the term on the clear link, which clears the conditions and not the search", async () => {
      const res = pageResponse();

      await GET(pageRequest({ query: { q: "Smith", filter: "open", where: "type:is:Adult" } }), res);

      expect(res.render.mock.calls[0][1].clearHref).toBe("/deed-polls?filter=open&q=Smith");
    });

    it("carries the term through a builder submission, so applying a filter narrows the search", async () => {
      const res = pageResponse();

      await GET(pageRequest({ query: { apply: "true", q: "Smith", "field-0": "type", "op-0": "is", "value-0-0": "Adult" } }), res);

      expect(res.redirect).toHaveBeenCalledWith("/deed-polls?q=Smith&where=type%3Ais%3AAdult");
    });

    it("hands the search form the active query as hidden inputs, so a search composes with it", async () => {
      const res = pageResponse();

      await GET(pageRequest({ query: { q: "Smith", filter: "open", where: ["type:is:Adult", "state:is:Received"], sort: "state:desc" } }), res);

      const model = res.render.mock.calls[0][1];
      expect(model.searchTerm).toBe("Smith");
      expect(model.searchWhere).toEqual(["type:is:Adult", "state:is:Received"]);
      expect(model.filterValue).toBe("open");
      expect(model.sortValue).toBe("state:desc");
    });

    it("leaves a blank builder row out of the search form's hidden inputs, since it narrows nothing", async () => {
      const res = pageResponse();

      await GET(pageRequest({ query: { where: [":", "type:is:Adult"] } }), res);

      expect(res.render.mock.calls[0][1].searchWhere).toEqual(["type:is:Adult"]);
    });

    it("shows an empty box when nothing was searched, rather than the word undefined", async () => {
      const res = pageResponse();

      await GET(pageRequest(), res);

      expect(res.render.mock.calls[0][1].searchTerm).toBe("");
    });

    it("renders the empty list with the term still in the box, because a search that finds nothing is not an error", async () => {
      const res = pageResponse();

      await GET(pageRequest({ query: { q: "Nobody" } }), res);

      const model = res.render.mock.calls[0][1];
      expect(model.cases).toEqual([]);
      expect(model.searchTerm).toBe("Nobody");
      expect(model.errorSummary).toEqual([]);
      expect(res.status).not.toHaveBeenCalled();
    });

    it("redirects to the case api matched the reference exactly, rather than rendering a list of one", async () => {
      vi.mocked(findDeedPolls).mockResolvedValue({ ...page([record]), referenceMatch: "case-1" } as never);
      const res = pageResponse();

      await GET(pageRequest({ query: { q: "KBDP2026-00001" } }), res);

      expect(res.redirect).toHaveBeenCalledWith("/deed-polls/case-1");
      expect(res.render).not.toHaveBeenCalled();
    });

    it("does not redirect for a single row api reported no reference match for, since one name match is a list", async () => {
      vi.mocked(findDeedPolls).mockResolvedValue({ ...page([record]), referenceMatch: null } as never);
      const res = pageResponse();

      await GET(pageRequest({ query: { q: "Ada" } }), res);

      expect(res.redirect).not.toHaveBeenCalled();
      expect(res.render.mock.calls[0][1].cases).toHaveLength(1);
    });
  });

  describe("the order and the page", () => {
    it("sends api the order the URL asks for", async () => {
      await GET(pageRequest({ query: { sort: "dateReceived:desc" } }), pageResponse());

      expect(findDeedPolls).toHaveBeenCalledWith({ filter: "all", conditions: [], sort: "dateReceived:desc", page: undefined }, expect.anything());
    });

    it("sends no order for one on a field the table does not show, leaving api's default", async () => {
      // Decision 8: a reordering by a cell that is not on screen reads as a bug rather than an answer.
      await GET(pageRequest({ query: { sort: "applicantEmail:asc" } }), pageResponse());

      expect(findDeedPolls).toHaveBeenCalledWith({ filter: "all", conditions: [], sort: undefined, page: undefined }, expect.anything());
    });

    it("sends api the page the URL asks for", async () => {
      await GET(pageRequest({ query: { page: "4" } }), pageResponse());

      expect(findDeedPolls).toHaveBeenCalledWith({ filter: "all", conditions: [], sort: undefined, page: 4 }, expect.anything());
    });

    it("sends no page for one api would refuse, since its wording for that is developer-facing", async () => {
      await GET(pageRequest({ query: { page: "nonsense" } }), pageResponse());

      expect(findDeedPolls).toHaveBeenCalledWith({ filter: "all", conditions: [], sort: undefined, page: undefined }, expect.anything());
    });

    it("carries the tab and every condition on each sort link, and returns to the first page", async () => {
      const res = pageResponse();

      await GET(pageRequest({ query: { filter: "open", where: ["type:is:Adult", "state:is:Received"], page: "3" } }), res);

      expect(res.render.mock.calls[0][1].sortHeaders.map((header: { href: string }) => header.href)).toEqual([
        "/deed-polls?filter=open&where=type%3Ais%3AAdult&where=state%3Ais%3AReceived&sort=displayReference%3Aasc",
        "/deed-polls?filter=open&where=type%3Ais%3AAdult&where=state%3Ais%3AReceived&sort=privacy%3Aasc",
        "/deed-polls?filter=open&where=type%3Ais%3AAdult&where=state%3Ais%3AReceived&sort=dateReceived%3Aasc",
        "/deed-polls?filter=open&where=type%3Ais%3AAdult&where=state%3Ais%3AReceived&sort=type%3Aasc",
        "/deed-polls?filter=open&where=type%3Ais%3AAdult&where=state%3Ais%3AReceived&sort=state%3Aasc",
        "/deed-polls?filter=open&where=type%3Ais%3AAdult&where=state%3Ais%3AReceived&sort=newForename%3Aasc"
      ]);
    });

    it("flips the column that is in force and says so with aria-sort", async () => {
      const res = pageResponse();

      await GET(pageRequest({ query: { sort: "state:asc" } }), res);

      const header = res.render.mock.calls[0][1].sortHeaders[4];
      expect(header).toEqual({ label: "State", field: "state", href: "/deed-polls?sort=state%3Adesc", ariaSort: "ascending" });
    });

    it("carries the tab, the conditions and the order on every page link", async () => {
      vi.mocked(findDeedPolls).mockResolvedValue({ filter: "open", cases: [], page: 2, size: 25, total: 60, totalPages: 3 } as never);
      const res = pageResponse();

      await GET(pageRequest({ query: { filter: "open", where: "type:is:Adult", sort: "state:desc", page: "2" } }), res);

      const { links } = res.render.mock.calls[0][1].paging;
      expect(links.previous).toEqual({ href: "/deed-polls?filter=open&where=type%3Ais%3AAdult&sort=state%3Adesc" });
      expect(links.next).toEqual({ href: "/deed-polls?filter=open&where=type%3Ais%3AAdult&sort=state%3Adesc&page=3" });
      expect(links.items.map((item: { number: number }) => item.number)).toEqual([1, 2, 3]);
    });

    it("keeps the tab and the order on the tab links, and returns them to the first page", async () => {
      const res = pageResponse();

      await GET(pageRequest({ query: { filter: "open", sort: "state:desc", page: "3" } }), res);

      expect(res.render.mock.calls[0][1].filterGroups[0].entries[2].href).toBe("/deed-polls?filter=received&sort=state%3Adesc");
    });

    it("states the range and the total from api's counts rather than from the rows on screen", async () => {
      vi.mocked(findDeedPolls).mockResolvedValue({ filter: "all", cases: [record], page: 4, size: 25, total: 213, totalPages: 9 } as never);
      const res = pageResponse();

      await GET(pageRequest({ query: { page: "4" } }), res);

      expect(res.render.mock.calls[0][1].pagingSummary).toBe("76 to 100 of 213 applications");
    });

    it("states no range for an empty result set, since the empty message is the answer", async () => {
      const res = pageResponse();

      await GET(pageRequest(), res);

      expect(res.render.mock.calls[0][1].pagingSummary).toBe("");
      expect(res.render.mock.calls[0][1].paging.links).toBeNull();
    });

    it("offers no paging for a refused query, which has no page of results to be one of", async () => {
      vi.mocked(findDeedPolls).mockRejectedValue(new InvalidInputError("Case query is not valid", [{ field: "where.0", message: "is not a member of state" }]));
      const res = pageResponse();

      await GET(pageRequest({ query: { where: "state:is:Nonsense" } }), res);

      expect(res.render.mock.calls[0][1].paging).toBeNull();
    });
  });

  describe("a builder submission", () => {
    it("redirects to the canonical URL, so the address bar holds the bookmarkable query and not the form's controls", async () => {
      const res = pageResponse();

      await GET(pageRequest({ query: { apply: "true", filter: "open", "field-0": "type", "op-0": "is", "value-0-0": "Adult" } }), res);

      expect(res.redirect).toHaveBeenCalledWith("/deed-polls?filter=open&where=type%3Ais%3AAdult");
      expect(findDeedPolls).not.toHaveBeenCalled();
    });

    it("keeps the order the results were in and drops the page, because a new query has its own pages", async () => {
      const res = pageResponse();
      const query = { apply: "true", sort: "state:desc", page: "3", "field-0": "type", "op-0": "is", "value-0-0": "Adult" };

      await GET(pageRequest({ query }), res);

      expect(res.redirect).toHaveBeenCalledWith("/deed-polls?where=type%3Ais%3AAdult&sort=state%3Adesc");
    });

    it("adds an empty row on Add condition, which is what makes the builder work without JavaScript", async () => {
      const res = pageResponse();

      await GET(pageRequest({ query: { add: "condition", "field-0": "type", "op-0": "is", "value-0-0": "Adult" } }), res);

      expect(res.redirect).toHaveBeenCalledWith("/deed-polls?where=type%3Ais%3AAdult&where=%3A");
    });

    it("drops the row Remove named and keeps the rest", async () => {
      const res = pageResponse();
      const query = {
        remove: "0",
        "field-0": "type",
        "op-0": "is",
        "value-0-0": "Adult",
        "field-1": "newForename",
        "op-1": "is",
        "value-1-0": "Ada"
      };

      await GET(pageRequest({ query }), res);

      expect(res.redirect).toHaveBeenCalledWith("/deed-polls?where=newForename%3Ais%3AAda");
    });

    it("redirects to the bare list when the last row is removed, rather than leaving an empty parameter behind", async () => {
      const res = pageResponse();

      await GET(pageRequest({ query: { remove: "0", "field-0": "type", "op-0": "is", "value-0-0": "Adult" } }), res);

      expect(res.redirect).toHaveBeenCalledWith("/deed-polls");
    });

    it("re-renders rather than redirecting when a date does not exist, keeping the parts on screen beside the error", async () => {
      const res = pageResponse();
      const query = {
        apply: "true",
        "field-0": "dateReceived",
        "op-0": "is",
        "value-0-0-day": "31",
        "value-0-0-month": "2",
        "value-0-0-year": "2026"
      };

      await GET(pageRequest({ query }), res);

      expect(res.redirect).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);

      const model = res.render.mock.calls[0][1];
      expect(model.queryRows[0].error).toBe("Date received must be a real date");
      expect(model.queryRows[0].values[0].dateParts).toEqual({ day: "31", month: "2", year: "2026" });
      expect(model.errorSummary).toEqual([{ text: "Condition 1: Date received must be a real date", href: "#field-0" }]);
    });

    it("does not send the row a bad date left incomplete, so the results already on screen survive", async () => {
      const query = { apply: "true", "field-0": "dateReceived", "op-0": "is", "value-0-0-day": "31", "value-0-0-month": "2", "value-0-0-year": "2026" };

      await GET(pageRequest({ query }), pageResponse());

      expect(findDeedPolls).toHaveBeenCalledWith({ filter: "all", conditions: [{ field: "dateReceived", operator: "is", values: [""] }] }, expect.anything());
    });
  });

  describe("a query api refuses", () => {
    it("renders the refusal against the row it belongs to rather than answering 500", async () => {
      vi.mocked(findDeedPolls).mockRejectedValue(new InvalidInputError("Case query is not valid", [{ field: "where.0", message: "is not a member of state" }]));
      const res = pageResponse();

      await GET(pageRequest({ query: { where: "state:is:Nonsense" } }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      const model = res.render.mock.calls[0][1];
      expect(model.queryRows[0].error).toBe("is not a member of state");
      expect(model.errorSummary).toEqual([{ text: "Condition 1: is not a member of state", href: "#field-0" }]);
      expect(model.cases).toEqual([]);
    });

    it("keeps its 400 and its error summary, and says nothing about an unfinished row beside it", async () => {
      vi.mocked(findDeedPolls).mockRejectedValue(new InvalidInputError("Case query is not valid", [{ field: "where.0", message: "is not a member of state" }]));
      const res = pageResponse();

      await GET(pageRequest({ query: { where: ["state:is:Nonsense", "newForename:is:"] } }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      const model = res.render.mock.calls[0][1];
      expect(model.errorSummary).toEqual([{ text: "Condition 1: is not a member of state", href: "#field-0" }]);
      // The refused row carries the refusal and no hint; the unfinished one carries the hint and is stated.
      expect(model.queryRows.map((row: { error?: string; hint?: string }) => [row.error, row.hint])).toEqual([
        ["is not a member of state", undefined],
        [undefined, "Enter a value to use this condition"]
      ]);
      expect(model.unusedConditions).toBe("Condition 2 was not used, because it is not complete.");
    });

    it("addresses the refusal to the row rather than to its position on the wire, since incomplete rows are not sent", async () => {
      vi.mocked(findDeedPolls).mockRejectedValue(new InvalidInputError("Case query is not valid", [{ field: "where.0", message: "is not a member of state" }]));
      const res = pageResponse();

      await GET(pageRequest({ query: { where: [":", "state:is:Nonsense"] } }), res);

      expect(res.render.mock.calls[0][1].queryRows.map((row: { error?: string }) => row.error)).toEqual([undefined, "is not a member of state"]);
    });

    it("stands its own copy in for a refusal naming no condition, since api's wording for those is developer-facing", async () => {
      vi.mocked(findDeedPolls).mockRejectedValue(
        new InvalidInputError("Case list paging is not valid", [{ field: "page", message: "takes a whole number of 1 or more" }])
      );
      const res = pageResponse();

      await GET(pageRequest({ query: { where: "type:is:Adult" } }), res);

      expect(res.render.mock.calls[0][1].errorSummary).toEqual([{ text: "These filters could not be applied. Check them and try again." }]);
    });

    it("lets anything that is not a refused query reach the error handler, because it is not the caseworker's to correct", async () => {
      vi.mocked(findDeedPolls).mockRejectedValue(new Error("deed-poll-api call failed (unavailable)"));

      await expect(GET(pageRequest(), pageResponse())).rejects.toThrow("unavailable");
    });
  });
});
