import { findDeedPolls, InvalidInputError } from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../express-doubles.js";
import { GET } from "./index.js";

// The filters and the row formatting are the domain's, and tested there. Only the api call is
// replaced, so this exercises the page against the real filter and view-model logic.
vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPolls: vi.fn()
}));

/** api's list envelope: the rows plus the counts every page of it carries. */
const page = (cases: unknown[]) => ({ filter: "all", cases, page: 1, size: 25, total: cases.length, totalPages: cases.length === 0 ? 0 : 1 });

const record = {
  id: "case-1",
  displayReference: "KBDP2026-00001",
  privacy: "Normal",
  dateReceived: new Date("2026-03-01T00:00:00.000Z"),
  type: "Adult",
  state: "Received",
  newForename: "Ada"
};

describe("deed-polls list page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findDeedPolls).mockResolvedValue(page([]) as never);
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
    expect(res.render).toHaveBeenCalledWith("deed-polls/index", expect.objectContaining({ activeFilter: "all" }));
  });

  it("presents the caseworker's own token, so api authenticates and audits as them", async () => {
    await GET(pageRequest({ accessToken: "caseworker-token" }), pageResponse());

    expect(findDeedPolls).toHaveBeenCalledWith({ filter: "all", conditions: [] }, { accessToken: "caseworker-token" });
  });

  it("marks the active filter so the tab bar can show which is current", async () => {
    const res = pageResponse();

    await GET(pageRequest({ query: { filter: "open" } }), res);

    expect(res.render).toHaveBeenCalledWith("deed-polls/index", expect.objectContaining({ activeFilter: "open" }));
  });

  it("passes the filter tabs without their where clauses", async () => {
    const res = pageResponse();

    await GET(pageRequest(), res);

    const model = res.render.mock.calls[0][1];
    for (const tab of model.filters) {
      expect(Object.keys(tab)).toEqual(["key", "label", "href"]);
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

    it("applies the tab and the query together, because a query narrows within the selected tab", async () => {
      await GET(pageRequest({ query: { filter: "open", where: "type:is:Adult" } }), pageResponse());

      expect(findDeedPolls).toHaveBeenCalledWith({ filter: "open", conditions: [{ field: "type", operator: "is", values: ["Adult"] }] }, expect.anything());
    });

    it("carries the query on every tab link, so switching tab keeps the conditions", async () => {
      const res = pageResponse();

      await GET(pageRequest({ query: { filter: "open", where: "type:is:Adult" } }), res);

      const model = res.render.mock.calls[0][1];
      expect(model.filters.map((tab: { href: string }) => tab.href)).toEqual([
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

    it("renders the value control the chosen field's kind asks for", async () => {
      const res = pageResponse();

      await GET(pageRequest({ query: { where: ["dateReceived:is:2026-03-01", "type:is:Adult", "inPerson:is:true"] } }), res);

      expect(res.render.mock.calls[0][1].queryRows.map((row: { control: string }) => row.control)).toEqual(["date", "select", "radios"]);
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

      expect(res.render.mock.calls[0][1].filters[2].href).toBe("/deed-polls?filter=received&sort=state%3Adesc");
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
