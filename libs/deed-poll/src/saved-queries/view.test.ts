import type { SavedQuery } from "@hmcts/deed-poll-api-client";
import { describe, expect, it } from "vitest";
import { buildSavedQueryLibrary, buildSavedQueryNav, savedQueryHref, savedQueryLink, savedQueryStored } from "./view.js";

const LIST_PATH = "/deed-polls";

/** A saved query as api answers with one: every property present, so a test states only what it varies. */
const savedQuery = (overrides: Partial<SavedQuery> = {}): SavedQuery => ({
  id: "sq-1",
  name: "Awaiting enrolment",
  description: "Received cases with a Gazette notice",
  shared: false,
  ownerId: "owner-1",
  ownerName: "A Caseworker",
  filter: "received",
  conditions: [],
  sortField: null,
  sortDirection: null,
  searchTerm: null,
  selected: true,
  editable: true,
  createdBy: "A Caseworker",
  modifiedBy: "A Caseworker",
  createdOn: null,
  modifiedOn: null,
  ...overrides
});

describe("saved-queries/view", () => {
  describe("savedQueryLink", () => {
    it("should read the stored condition strings back into builder rows", () => {
      // The wire property is `conditions`, and it carries the same `field:operator:value` strings the
      // `where` parameter takes — which is what lets a saved query round-trip a list URL unchanged.
      const link = savedQueryLink(savedQuery({ conditions: ["newSurname:contains:Smith, John", "parents:isEmpty"] }));

      expect(link.conditions).toEqual([
        { field: "newSurname", operator: "contains", values: ["Smith, John"] },
        { field: "parents", operator: "isEmpty", values: [] }
      ]);
    });

    it("should restore the search term, so a saved search reopens as the search it was", () => {
      expect(savedQueryLink(savedQuery({ searchTerm: "Threepwood" })).q).toBe("Threepwood");
    });

    it("should carry no term for a query api holds none for", () => {
      // `undefined` rather than null: `caseListSearch` omits an undefined `q`, so the URL is the one it was
      // before a term was ever storable.
      expect(savedQueryLink(savedQuery({ searchTerm: null })).q).toBeUndefined();
    });

    it("should carry no page, because a saved query never stores one", () => {
      expect(savedQueryLink(savedQuery())).not.toHaveProperty("page");
    });

    it("should fall back to the first filter for a key api no longer publishes", () => {
      expect(savedQueryLink(savedQuery({ filter: "nonsense" })).filter).toBe("all");
    });

    it("should fall back to the first filter when none was stored", () => {
      expect(savedQueryLink(savedQuery({ filter: null })).filter).toBe("all");
    });

    it("should keep a stored order, writing the direction out in full", () => {
      expect(savedQueryLink(savedQuery({ sortField: "dateReceived", sortDirection: "desc" })).sort).toBe("dateReceived:desc");
    });

    it("should default an order with no direction to ascending, as api does", () => {
      expect(savedQueryLink(savedQuery({ sortField: "dateReceived", sortDirection: null })).sort).toBe("dateReceived:asc");
    });

    it("should drop an order by a field the table does not show, leaving api's own default", () => {
      // The same rule `parseSort` applies to a hand-edited URL: reordering the rows by a cell that is not
      // on screen reads as a bug rather than as an answer.
      expect(savedQueryLink(savedQuery({ sortField: "applicantEmail", sortDirection: "asc" })).sort).toBeUndefined();
    });

    it("should drop an order whose direction is neither of api's two", () => {
      expect(savedQueryLink(savedQuery({ sortField: "dateReceived", sortDirection: "sideways" })).sort).toBeUndefined();
    });
  });

  describe("savedQueryHref", () => {
    it("should build the list URL through caseListSearch, encoding the conditions", () => {
      const query = savedQuery({ filter: "open", conditions: ["newSurname:contains:Smith & Son"], sortField: "dateReceived", sortDirection: "desc" });

      expect(savedQueryHref(query, LIST_PATH)).toBe("/deed-polls?filter=open&where=newSurname%3Acontains%3ASmith+%26+Son&sort=dateReceived%3Adesc");
    });

    it("should omit the first filter, so a query over everything is a bare list URL", () => {
      expect(savedQueryHref(savedQuery({ filter: "all", conditions: [] }), LIST_PATH)).toBe("/deed-polls");
    });
  });

  describe("buildSavedQueryNav", () => {
    it("should render only the queries the caller has selected", () => {
      const queries = [savedQuery({ id: "sq-1", selected: true }), savedQuery({ id: "sq-2", name: "Somebody else's", selected: false })];

      expect(buildSavedQueryNav(queries, { listPath: LIST_PATH }).map((entry) => entry.key)).toEqual(["sq-1"]);
    });

    it("should keep api's order rather than sorting locally", () => {
      const queries = [savedQuery({ id: "sq-1", name: "Beta" }), savedQuery({ id: "sq-2", name: "Alpha" })];

      expect(buildSavedQueryNav(queries, { listPath: LIST_PATH }).map((entry) => entry.label)).toEqual(["Beta", "Alpha"]);
    });

    it("should key an entry on the query's id rather than its name, which is not an identity", () => {
      const queries = [savedQuery({ id: "sq-1", name: "Mine" }), savedQuery({ id: "sq-2", name: "Mine" })];

      expect(buildSavedQueryNav(queries, { listPath: LIST_PATH }).map((entry) => entry.key)).toEqual(["sq-1", "sq-2"]);
    });

    it("should mark an entry current when the request describes the same query", () => {
      const query = savedQuery({ filter: "received", conditions: ["parents:isEmpty"], sortField: "dateReceived", sortDirection: "desc" });

      const entries = buildSavedQueryNav([query], {
        listPath: LIST_PATH,
        current: { filter: "received", conditions: [{ field: "parents", operator: "isEmpty", values: [] }], sort: "dateReceived:desc" }
      });

      expect(entries[0].current).toBe(true);
    });

    it("should mark an entry current on the serialised conditions, not on object identity", () => {
      // A condition read off a URL and one read off a stored string are different objects describing the
      // same question, and `values` differs in shape for a no-value operator depending on which produced it.
      const query = savedQuery({ filter: "all", conditions: ["newSurname:contains:Smith"] });

      const entries = buildSavedQueryNav([query], {
        listPath: LIST_PATH,
        current: { filter: "all", conditions: [{ field: "newSurname", operator: "contains", values: ["Smith"] }] }
      });

      expect(entries[0].current).toBe(true);
    });

    it("should not mark an entry current when the request narrows the same conditions under another tab", () => {
      const query = savedQuery({ filter: "received", conditions: ["parents:isEmpty"] });

      const entries = buildSavedQueryNav([query], {
        listPath: LIST_PATH,
        current: { filter: "enroled", conditions: [{ field: "parents", operator: "isEmpty", values: [] }] }
      });

      expect(entries[0].current).toBe(false);
    });

    it("should not mark an entry current when the order differs", () => {
      const query = savedQuery({ filter: "all", conditions: [], sortField: "dateReceived", sortDirection: "desc" });

      const entries = buildSavedQueryNav([query], { listPath: LIST_PATH, current: { filter: "all", conditions: [], sort: "dateReceived:asc" } });

      expect(entries[0].current).toBe(false);
    });

    it("should stay current on a later page of the same query", () => {
      // A caseworker on page 2 is still looking at that query; an entry that stopped being current when
      // they paged would be telling them otherwise.
      const query = savedQuery({ filter: "received", conditions: [] });

      const entries = buildSavedQueryNav([query], { listPath: LIST_PATH, current: { filter: "received", conditions: [], page: 2 } });

      expect(entries[0].current).toBe(true);
    });

    it("should mark nothing current when the page has no request to compare", () => {
      expect(buildSavedQueryNav([savedQuery()], { listPath: LIST_PATH })[0].current).toBe(false);
    });

    it("should render nothing for an empty selection, leaving the page to omit the group", () => {
      expect(buildSavedQueryNav([], { listPath: LIST_PATH })).toEqual([]);
    });
  });

  describe("buildSavedQueryLibrary", () => {
    it("should carry api's flags through untouched, both ways", () => {
      // `editable` is api's statement, derived from the predicate its write paths refuse on. The row
      // repeats it and never computes it — a client rendering an edit button on its own reasoning would be
      // a second authority on somebody else's rule.
      const queries = [
        savedQuery({ id: "sq-1", shared: true, selected: true, editable: false }),
        savedQuery({ id: "sq-2", shared: false, selected: false, editable: true })
      ];

      expect(buildSavedQueryLibrary(queries, LIST_PATH).map(({ id, shared, selected, editable }) => ({ id, shared, selected, editable }))).toEqual([
        { id: "sq-1", shared: true, selected: true, editable: false },
        { id: "sq-2", shared: false, selected: false, editable: true }
      ]);
    });

    it("should include the link to each query's own list URL", () => {
      const rows = buildSavedQueryLibrary([savedQuery({ filter: "enroled", conditions: [] })], LIST_PATH);

      expect(rows[0].href).toBe("/deed-polls?filter=enroled");
    });

    it("should render the owner's name as api sends it", () => {
      expect(buildSavedQueryLibrary([savedQuery({ ownerName: "A Caseworker" })], LIST_PATH)[0].ownerName).toBe("A Caseworker");
    });

    it("should show the placeholder for a query api recorded no owner name for", () => {
      expect(buildSavedQueryLibrary([savedQuery({ ownerName: null })], LIST_PATH)[0].ownerName).toBe("Not recorded");
    });

    it("should show the placeholder for an owner name that is only whitespace", () => {
      expect(buildSavedQueryLibrary([savedQuery({ ownerName: "   " })], LIST_PATH)[0].ownerName).toBe("Not recorded");
    });

    it("should give an absent description as an empty string, so a template can ask rather than render null", () => {
      expect(buildSavedQueryLibrary([savedQuery({ description: null })], LIST_PATH)[0].description).toBe("");
    });

    it("should list every query the caller can see, not only their selection", () => {
      const queries = [savedQuery({ id: "sq-1", selected: true }), savedQuery({ id: "sq-2", selected: false })];

      expect(buildSavedQueryLibrary(queries, LIST_PATH)).toHaveLength(2);
    });
  });

  describe("savedQueryStored", () => {
    it("should store the tab, the conditions, the order and the term as api's five columns", () => {
      const stored = savedQueryStored({
        filter: "received",
        conditions: [{ field: "newSurname", operator: "contains", values: ["Smith"] }],
        sort: "dateReceived:desc",
        q: "Threepwood"
      });

      expect(stored).toEqual({
        filter: "received",
        conditions: ["newSurname:contains:Smith"],
        sortField: "dateReceived",
        sortDirection: "desc",
        searchTerm: "Threepwood"
      });
    });

    it("should round-trip a link through both directions unchanged, so the two stay inverses", () => {
      const link = {
        filter: "enroled",
        conditions: [{ field: "newSurname", operator: "contains", values: ["Smith, John"] }],
        sort: "displayReference:asc",
        q: "Threepwood"
      };

      const stored = savedQueryStored(link);

      expect(savedQueryLink(savedQuery({ ...stored, conditions: stored.conditions ?? [] }))).toEqual(link);
    });

    it("should trim the term, so a stored one matches what a search would have run", () => {
      expect(savedQueryStored({ q: "  Threepwood  " }).searchTerm).toBe("Threepwood");
    });

    it("should store no term for a blank one, rather than an empty string", () => {
      // `""` in api's column is a stored term that matches everything, where an absent one is no search at
      // all. The two are not the same query and a blank box means the second.
      expect(savedQueryStored({ q: "   " }).searchTerm).toBeUndefined();
      expect(savedQueryStored({}).searchTerm).toBeUndefined();
    });

    it("should leave a half-filled condition unstored, so the query finds what was on screen", () => {
      // The state "Add condition" leaves a row in. It is left off the wire when the list is queried, so a
      // saved query that carried it would find something other than what was named.
      const stored = savedQueryStored({
        conditions: [
          { field: "newSurname", operator: "contains", values: ["Smith"] },
          { field: "", operator: "", values: [] }
        ]
      });

      expect(stored.conditions).toEqual(["newSurname:contains:Smith"]);
    });

    it("should store no order for a sort the table cannot show, rather than one nobody can see", () => {
      const stored = savedQueryStored({ filter: "all", conditions: [], sort: "applicantEmail:asc" });

      expect(stored.sortField).toBeUndefined();
      expect(stored.sortDirection).toBeUndefined();
    });

    it("should fall back to the first filter for a key api's enum does not carry", () => {
      // A hand-edited `?filter=nonsense` is the same everywhere else on the list: it shows everything.
      expect(savedQueryStored({ filter: "nonsense", conditions: [] }).filter).toBe("all");
    });

    it("should store an unfiltered, unsorted list as empty conditions and no order", () => {
      expect(savedQueryStored({})).toEqual({ filter: "all", conditions: [], sortField: undefined, sortDirection: undefined });
    });
  });
});
