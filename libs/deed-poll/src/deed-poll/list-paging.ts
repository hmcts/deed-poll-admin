/**
 * Which page of the case list is on screen: the page a URL asks for, and the pagination a template renders
 * from **api's counts**.
 *
 * The plan's decision 9, and the one thing this file exists to prevent: **nothing here counts rows.**
 * `page`, `size`, `total` and `totalPages` all come from api's list envelope, because the rows on screen
 * are one page of them and a local count would say "6 applications" about a result set of 213. The range
 * in words — "1 to 25 of 213" — is arithmetic on those four numbers and nothing else, so a caseworker can
 * tell whether to refine the query rather than only that there is a next page.
 *
 * The words are not here. A template gets numbers and hrefs; the page it belongs to owns the sentence,
 * for the reason `query-builder.ts` takes its `QueryLabels` as an argument.
 */
import type { CaseList } from "@hmcts/deed-poll-api-client";

/**
 * How far either side of the current page a number is always shown. One, per the GOV.UK pagination
 * guidance: first, last, current and its neighbours, with an ellipsis standing in for the rest.
 */
const NEIGHBOURS = 1;

/**
 * The page a URL asks for, or `undefined` for api's first.
 *
 * A page that is not a whole number of 1 or more falls back rather than being sent, which is the same
 * choice `filterFor` makes: `?page=nonsense` off a shared link is answered with the first page, and
 * forwarding api's developer-facing refusal of it would tell a caseworker nothing they can act on. A page
 * past the end is **not** caught here — api answers it with an empty page, and how many pages there are is
 * api's count to give, not this app's to guess before asking.
 */
export function parsePage(raw: unknown): number | undefined {
  const entry = Array.isArray(raw) ? raw[0] : raw;
  if (typeof entry !== "string" && typeof entry !== "number") return undefined;

  const page = Number(entry);

  return Number.isInteger(page) && page >= 1 ? page : undefined;
}

/**
 * The pagination for a page of results: where in the total this page sits, and the links to the others.
 *
 * `links` is `null` when there is nothing to page through — one page or none — so the component is absent
 * rather than rendered as a single number a caseworker can click to arrive where they already are.
 *
 * `first` is 0 for a page holding no rows, which covers both an empty result set and a page number past
 * the end. A range is not stated for either: "76 to 73 of 73" is what stating one would produce, and the
 * page's empty message is the honest answer.
 */
export function buildPaging(counts: CaseListCounts, href: (page: number) => string): CaseListPaging {
  const { page, size, total, totalPages } = counts;
  const beyondEnd = total === 0 || page > totalPages;
  const first = beyondEnd ? 0 : (page - 1) * size + 1;

  return {
    page,
    size,
    total,
    totalPages,
    first,
    last: first === 0 ? 0 : Math.min(page * size, total),
    links:
      totalPages < 2
        ? null
        : {
            previous: page > 1 ? { href: href(page - 1) } : undefined,
            next: page < totalPages ? { href: href(page + 1) } : undefined,
            items: pageItems(page, totalPages, href)
          }
  };
}

/** The numbered links, with an ellipsis wherever a run of pages is left out. */
function pageItems(page: number, totalPages: number, href: (page: number) => string): CaseListPageItem[] {
  const numbers = pageNumbers(page, totalPages);
  const link = (number: number): CaseListPageItem => ({ number, href: href(number), current: number === page });

  return numbers.flatMap((number, index) => {
    const skipped = index === 0 ? 0 : number - numbers[index - 1] - 1;
    if (skipped === 0) return [link(number)];
    // A single skipped page is shown as itself: three dots standing in for one number is longer than the
    // number, and a caseworker cannot click it.
    if (skipped === 1) return [link(number - 1), link(number)];

    return [{ ellipsis: true }, link(number)];
  });
}

/** The pages that get a number of their own: the first, the last, and the current with its neighbours. */
function pageNumbers(page: number, totalPages: number): number[] {
  const wanted = new Set([1, totalPages, ...Array.from({ length: NEIGHBOURS * 2 + 1 }, (_, offset) => page - NEIGHBOURS + offset)]);

  return [...wanted].filter((number) => number >= 1 && number <= totalPages).sort((left, right) => left - right);
}

/**
 * api's four counts, and the only source of them.
 *
 * Structurally the list envelope minus its rows, so a page hands its own response straight in. api counts
 * across every page, which is exactly what cannot be inferred from the rows one page holds.
 */
export type CaseListCounts = Omit<CaseList, "cases" | "filter">;

/** One numbered link, or the ellipsis standing in for the pages between two of them. */
export type CaseListPageItem = { number: number; href: string; current: boolean } | { ellipsis: true };

export interface CaseListPagingLinks {
  previous?: { href: string };
  next?: { href: string };
  items: CaseListPageItem[];
}

/** Where this page sits in the whole result set, and how to reach the rest of it. */
export interface CaseListPaging {
  page: number;
  size: number;
  total: number;
  totalPages: number;
  /** The first row's position in the whole result set, 1-based, or 0 for a page holding no rows. */
  first: number;
  last: number;
  /** `null` when there is one page or none, so nothing to page through. */
  links: CaseListPagingLinks | null;
}
