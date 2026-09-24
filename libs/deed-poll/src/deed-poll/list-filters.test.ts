import { LIST_FILTER } from "@hmcts/deed-poll-api-client";
import { describe, expect, it } from "vitest";
import { DeedPollState } from "./enums/option-sets.js";
import { AWAITING_CONFIRMATION_FILTER, filterFor, filterTabs, LIST_FILTERS } from "./list-filters.js";

describe("deed-poll/list-filters", () => {
  it("puts 'all' first, since it is both the default and the fallback", () => {
    expect(LIST_FILTERS[0].key).toBe("all");
  });

  it("gives 'all' no where clause, so it does not filter", () => {
    expect(LIST_FILTERS[0].where).toBeUndefined();
  });

  it("defines 'open' by exclusion, so a state added later shows up as open", () => {
    // The safe direction: a new state appearing in a caseworker's open list is noticeable, whereas
    // one silently missing from it is not.
    const open = LIST_FILTERS.find((f) => f.key === "open");

    expect(open?.where).toEqual({ state: { notIn: [DeedPollState.Enroled, DeedPollState.Returned] } });
  });

  it("covers every terminal state with its own filter, and the one worklist that is not a state", () => {
    const keys = LIST_FILTERS.map((f) => f.key);

    expect(keys).toEqual(["all", "open", "received", "enroled", "returned", "awaitingConfirmation"]);
  });

  it("is api's own filter vocabulary in api's own order, so the tab bar cannot offer a key api refuses", () => {
    // api resolves the key this app sends and `LIST_FILTER` is the published enum, so a tab this file added
    // alone would earn a 400 and one api added alone would be a worklist with no way to reach it. The order
    // matters too: it is the order the tabs render in, and api appends rather than inserting.
    expect(LIST_FILTERS.map((f) => f.key)).toEqual([...LIST_FILTER]);
  });

  it("gives the awaiting-confirmation tab no where clause, since a case is on it for a date and not a state", () => {
    // `notify-3b` decision 2: there is no ninth case state, and a case waiting for a confirmation still reads
    // `Returned`. A `where` here would be a second opinion about which cases are waiting.
    expect(LIST_FILTERS.find((f) => f.key === AWAITING_CONFIRMATION_FILTER)?.where).toBeUndefined();
    expect(LIST_FILTERS.find((f) => f.key === AWAITING_CONFIRMATION_FILTER)?.label).toBe("Awaiting confirmation");
  });

  describe("filterFor", () => {
    it("resolves a known key", () => {
      expect(filterFor("enroled").key).toBe("enroled");
    });

    it("falls back to 'all' for an unrecognised key rather than throwing", () => {
      // The key comes from a URL a caseworker may have edited or bookmarked against an older
      // version. Showing everything is a safe answer; a 400 on the service's front page is not.
      expect(filterFor("nonsense").key).toBe("all");
      expect(filterFor(undefined).key).toBe("all");
      expect(filterFor(null).key).toBe("all");
    });

    it("falls back for a non-string, which a repeated query parameter produces", () => {
      expect(filterFor(["open", "enroled"]).key).toBe("all");
    });
  });

  describe("filterTabs", () => {
    it("drops the where clause, which is not the template's business", () => {
      for (const tab of filterTabs()) {
        expect(Object.keys(tab)).toEqual(["key", "label"]);
      }
    });

    it("preserves order, because it is the order the tabs render in", () => {
      expect(filterTabs().map((t) => t.key)).toEqual(LIST_FILTERS.map((f) => f.key));
    });
  });
});
