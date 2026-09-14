import { describe, expect, it } from "vitest";
import { buildPaging, type CaseListCounts, parsePage } from "./list-paging.js";

const href = (page: number) => `/deed-polls?page=${page}`;

/** api's envelope minus its rows: the four counts, which are the only numbers this file works from. */
const counts = (page: number, total: number, size = 25): CaseListCounts => ({ page, size, total, totalPages: Math.ceil(total / size) });

describe("deed-poll/list-paging", () => {
  describe("parsePage", () => {
    it("should read the page a URL asks for", () => {
      expect(parsePage("3")).toBe(3);
    });

    it("should answer undefined for no page, leaving api's first", () => {
      expect(parsePage(undefined)).toBeUndefined();
    });

    it("should fall back rather than forward a page api would refuse", () => {
      // api's refusal of these is developer-facing, and the first page is a safe answer to a shared link.
      expect(parsePage("nonsense")).toBeUndefined();
      expect(parsePage("0")).toBeUndefined();
      expect(parsePage("-2")).toBeUndefined();
      expect(parsePage("1.5")).toBeUndefined();
    });

    it("should read the first of a repeated parameter", () => {
      expect(parsePage(["2", "9"])).toBe(2);
    });
  });

  describe("buildPaging", () => {
    it("should state the range from api's counts rather than from the rows on screen", () => {
      const paging = buildPaging(counts(1, 213), href);

      expect(paging.first).toBe(1);
      expect(paging.last).toBe(25);
      expect(paging.total).toBe(213);
      expect(paging.totalPages).toBe(9);
    });

    it("should offset the range by the page, so page 4 reads as the rows it holds", () => {
      const paging = buildPaging(counts(4, 213), href);

      expect(paging.first).toBe(76);
      expect(paging.last).toBe(100);
    });

    it("should stop the range at the total on a part-full last page", () => {
      const paging = buildPaging(counts(9, 213), href);

      expect(paging.first).toBe(201);
      expect(paging.last).toBe(213);
    });

    it("should state no range for an empty result set", () => {
      const paging = buildPaging({ page: 1, size: 25, total: 0, totalPages: 0 }, href);

      expect(paging.first).toBe(0);
      expect(paging.last).toBe(0);
      expect(paging.links).toBeNull();
    });

    it("should state no range for a page past the end, which holds no rows to number", () => {
      // "76 to 73 of 73" is what stating one would produce; the page's empty message is the honest answer.
      const paging = buildPaging(counts(4, 73), href);

      expect(paging.first).toBe(0);
      expect(paging.last).toBe(0);
    });

    it("should offer no links at all when one page holds everything", () => {
      expect(buildPaging(counts(1, 12), href).links).toBeNull();
    });

    it("should offer a next and no previous on the first page", () => {
      const links = buildPaging(counts(1, 213), href).links;

      expect(links?.previous).toBeUndefined();
      expect(links?.next).toEqual({ href: "/deed-polls?page=2" });
    });

    it("should offer a previous and no next on the last page", () => {
      const links = buildPaging(counts(9, 213), href).links;

      expect(links?.previous).toEqual({ href: "/deed-polls?page=8" });
      expect(links?.next).toBeUndefined();
    });

    it("should number every page when they all fit", () => {
      const links = buildPaging(counts(2, 60), href).links;

      expect(links?.items).toEqual([
        { number: 1, href: "/deed-polls?page=1", current: false },
        { number: 2, href: "/deed-polls?page=2", current: true },
        { number: 3, href: "/deed-polls?page=3", current: false }
      ]);
    });

    it("should keep the first, the last and the current page's neighbours, eliding the rest", () => {
      const links = buildPaging(counts(5, 213), href).links;

      expect(links?.items).toEqual([
        { number: 1, href: "/deed-polls?page=1", current: false },
        { ellipsis: true },
        { number: 4, href: "/deed-polls?page=4", current: false },
        { number: 5, href: "/deed-polls?page=5", current: true },
        { number: 6, href: "/deed-polls?page=6", current: false },
        { ellipsis: true },
        { number: 9, href: "/deed-polls?page=9", current: false }
      ]);
    });

    it("should show a single skipped page as its number rather than as three dots", () => {
      const links = buildPaging(counts(4, 150), href).links;

      expect(links?.items).toEqual([
        { number: 1, href: "/deed-polls?page=1", current: false },
        { number: 2, href: "/deed-polls?page=2", current: false },
        { number: 3, href: "/deed-polls?page=3", current: false },
        { number: 4, href: "/deed-polls?page=4", current: true },
        { number: 5, href: "/deed-polls?page=5", current: false },
        { number: 6, href: "/deed-polls?page=6", current: false }
      ]);
    });
  });
});
