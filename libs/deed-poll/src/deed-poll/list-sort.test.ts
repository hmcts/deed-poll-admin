import { describe, expect, it } from "vitest";
import { buildSortHeaders, type CaseListSort, parseSort, serialiseSort } from "./list-sort.js";
import { CASE_LIST_COLUMNS } from "./list-view.js";

/** What a page passes in: the whole order, so a header link can be asserted to carry all of it. */
const href = (sort: CaseListSort) => `/deed-polls?sort=${serialiseSort(sort)}`;

describe("deed-poll/list-sort", () => {
  describe("parseSort", () => {
    it("should read a field and a direction", () => {
      expect(parseSort("dateReceived:desc")).toEqual({ field: "dateReceived", direction: "desc" });
    });

    it("should default an omitted direction to ascending, as api does", () => {
      expect(parseSort("state")).toEqual({ field: "state", direction: "asc" });
    });

    it("should answer undefined when no order was asked for, leaving api's newest-first default", () => {
      expect(parseSort(undefined)).toBeUndefined();
      expect(parseSort(null)).toBeUndefined();
    });

    it("should drop an order on a field the table does not show, rather than reordering by an invisible cell", () => {
      // Decision 8. api would happily order by it — this app cannot show why the rows moved.
      expect(parseSort("applicantEmail:asc")).toBeUndefined();
    });

    it("should drop a direction that is not one of api's two", () => {
      expect(parseSort("state:sideways")).toBeUndefined();
    });

    it("should read the first of a repeated parameter, since a URL may carry the name twice", () => {
      expect(parseSort(["type:desc", "state:asc"])).toEqual({ field: "type", direction: "desc" });
    });

    it("should round-trip through serialiseSort for every sortable column", () => {
      for (const column of CASE_LIST_COLUMNS) {
        for (const direction of ["asc", "desc"] as const) {
          const sort = { field: column.sort, direction };

          expect(parseSort(serialiseSort(sort))).toEqual(sort);
        }
      }
    });
  });

  describe("serialiseSort", () => {
    it("should write the direction out even though api defaults it, so a header link says which way it points", () => {
      expect(serialiseSort({ field: "state", direction: "asc" })).toBe("state:asc");
    });

    it("should answer undefined for no order, so nothing is written into a bookmarked URL", () => {
      expect(serialiseSort(undefined)).toBeUndefined();
    });
  });

  describe("buildSortHeaders", () => {
    it("should offer one header per column the table shows, and no others", () => {
      const headers = buildSortHeaders(undefined, href);

      expect(headers.map((header) => header.label)).toEqual(CASE_LIST_COLUMNS.map((column) => column.label));
    });

    it("should link an unsorted column to ascending", () => {
      const headers = buildSortHeaders(undefined, href);

      expect(headers[2]).toEqual({ label: "Received", field: "dateReceived", href: "/deed-polls?sort=dateReceived:asc", ariaSort: "none" });
    });

    it("should reverse the column that is in force, so clicking it again flips the order", () => {
      const ascending = buildSortHeaders({ field: "dateReceived", direction: "asc" }, href)[2];
      const descending = buildSortHeaders({ field: "dateReceived", direction: "desc" }, href)[2];

      expect(ascending.href).toBe("/deed-polls?sort=dateReceived:desc");
      expect(ascending.ariaSort).toBe("ascending");
      expect(descending.href).toBe("/deed-polls?sort=dateReceived:asc");
      expect(descending.ariaSort).toBe("descending");
    });

    it("should leave every other column pointing at ascending while one is in force", () => {
      const headers = buildSortHeaders({ field: "dateReceived", direction: "desc" }, href);

      expect(headers.filter((header) => header.ariaSort === "none").map((header) => header.href)).toEqual([
        "/deed-polls?sort=displayReference:asc",
        "/deed-polls?sort=privacy:asc",
        "/deed-polls?sort=type:asc",
        "/deed-polls?sort=state:asc",
        "/deed-polls?sort=newForename:asc",
        "/deed-polls?sort=newSurname:asc"
      ]);
    });
  });
});
