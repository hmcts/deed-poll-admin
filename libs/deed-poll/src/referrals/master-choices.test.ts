import { listMasters } from "@hmcts/deed-poll-api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildMasterChoices, findMasterChoices } from "./master-choices.js";

vi.mock("@hmcts/deed-poll-api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll-api-client")>()),
  listMasters: vi.fn()
}));

const CALLER = { accessToken: "caseworker-token" };
// 09:00 on 28 October 2026 in London (GMT from the 25th).
const MORNING = new Date("2026-10-28T09:00:00Z");

const master = (id: string, name: string, assignedInWindow: number, available = true) => ({
  id,
  name,
  email: `${id}@example.com`,
  available,
  linked: false,
  revision: 0,
  assignedInWindow
});

const list = (overrides: Record<string, unknown> = {}) => ({
  masters: [master("m-1", "Master Sullivan", 3), master("m-2", "Master Wren", 0, false), master("m-3", "Master Judge", 10)],
  window: { date: "2026-10-28", slot: "AM" as const },
  cap: 10,
  ...overrides
});

describe("referrals/master-choices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DEED_POLL_API_URL = "http://api.test";
  });

  describe("findMasterChoices", () => {
    it("should answer api's whole list, window and cap included", async () => {
      vi.mocked(listMasters).mockResolvedValue({ ok: true, data: list() } as never);

      const result = await findMasterChoices(CALLER);

      expect(result).toEqual(list());
    });
  });

  describe("buildMasterChoices", () => {
    it("should offer the available Masters in api's order, each with their count against the cap", () => {
      const view = buildMasterChoices(list(), undefined, MORNING);

      expect(view.choices).toEqual([
        { id: "m-1", name: "Master Sullivan", held: 3, cap: 10, isFull: false, isChecked: false },
        { id: "m-3", name: "Master Judge", held: 10, cap: 10, isFull: true, isChecked: false }
      ]);
    });

    it("should check the Master whose id was chosen, and nothing for an id that matches no Master", () => {
      expect(buildMasterChoices(list(), "m-1", MORNING).choices.map((choice) => choice.isChecked)).toEqual([true, false]);
      expect(buildMasterChoices(list(), "m-9", MORNING).choices.map((choice) => choice.isChecked)).toEqual([false, false]);
    });

    it("should say the window is today when api's window date is today in London", () => {
      expect(buildMasterChoices(list(), undefined, MORNING).window).toEqual({ slot: "AM", isToday: true, date: "28-10-26" });
    });

    it("should read today in London rather than UTC, so 00:30 BST is already the next day", () => {
      // 23:30 UTC on 1 October is 00:30 on 2 October in London.
      const view = buildMasterChoices(list({ window: { date: "2026-10-02", slot: "AM" } }), undefined, new Date("2026-10-01T23:30:00Z"));

      expect(view.window?.isToday).toBe(true);
    });

    it("should give a later window's day as dd-mm-yy, not as today", () => {
      const view = buildMasterChoices(list({ window: { date: "2026-10-29", slot: "AM" } }), undefined, new Date("2026-10-28T17:00:00Z"));

      expect(view.window).toEqual({ slot: "AM", isToday: false, date: "29-10-26" });
    });

    it("should carry no window when api sent none", () => {
      expect(buildMasterChoices(list({ window: null }), undefined, MORNING).window).toBeNull();
    });

    it("should offer nothing when every Master is unavailable", () => {
      expect(buildMasterChoices(list({ masters: [master("m-2", "Master Wren", 0, false)] }), undefined, MORNING).choices).toEqual([]);
    });
  });
});
