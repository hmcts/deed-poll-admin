import { listMasters } from "@hmcts/deed-poll-api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildMasterChoices, findMasterChoices } from "./master-choices.js";

vi.mock("@hmcts/deed-poll-api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll-api-client")>()),
  listMasters: vi.fn()
}));

const CALLER = { accessToken: "caseworker-token" };
const master = (id: string, name: string, available = true) => ({ id, name, email: `${id}@example.com`, available, linked: false, revision: 0 });

const list = (overrides: Record<string, unknown> = {}) => ({
  masters: [master("m-1", "Master Sullivan"), master("m-2", "Master Wren", false), master("m-3", "Master Judge")],
  ...overrides
});

describe("referrals/master-choices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DEED_POLL_API_URL = "http://api.test";
  });

  describe("findMasterChoices", () => {
    it("should answer api's whole list", async () => {
      vi.mocked(listMasters).mockResolvedValue({ ok: true, data: list() } as never);

      const result = await findMasterChoices(CALLER);

      expect(result).toEqual(list());
    });
  });

  describe("buildMasterChoices", () => {
    it("should offer the available Masters in api's order, none of them full, because api F1 sends no counts", () => {
      const view = buildMasterChoices(list(), undefined);

      expect(view.window).toBeNull();
      expect(view.choices).toEqual([
        { id: "m-1", name: "Master Sullivan", held: 0, cap: 0, isFull: false, isChecked: false },
        { id: "m-3", name: "Master Judge", held: 0, cap: 0, isFull: false, isChecked: false }
      ]);
    });

    it("should not offer a Master api sent with no name, because a radio with no label identifies nobody", () => {
      const nameless = { ...master("m-4", ""), name: null };

      const view = buildMasterChoices(list({ masters: [master("m-1", "Master Sullivan"), nameless] }), undefined);

      expect(view.choices.map((choice) => choice.id)).toEqual(["m-1"]);
    });

    it("should not offer a Master whose name is only whitespace, and should label the rest without their padding", () => {
      const blank = master("m-4", "   ");
      const padded = master("m-5", "  Master Wren ");

      const view = buildMasterChoices(list({ masters: [blank, padded] }), undefined);

      expect(view.choices.map((choice) => [choice.id, choice.name])).toEqual([["m-5", "Master Wren"]]);
    });

    it("should check the Master whose id was chosen, and nothing for an id that matches no Master", () => {
      expect(buildMasterChoices(list(), "m-1").choices.map((choice) => choice.isChecked)).toEqual([true, false]);
      expect(buildMasterChoices(list(), "m-9").choices.map((choice) => choice.isChecked)).toEqual([false, false]);
    });

    it("should offer nothing when every Master is unavailable", () => {
      expect(buildMasterChoices(list({ masters: [master("m-2", "Master Wren", false)] }), undefined).choices).toEqual([]);
    });
  });
});
