import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { filterFor, LIST_FILTERS } from "../deed-poll/list-filters.js";
import { DEEDPOLL_DELIVERY_MANAGER } from "./roles.js";

describe("staff boundary integration", () => {
  it("should keep the mock claim aligned without a circular library dependency", () => {
    const source = readFileSync(new URL("../../../deed-poll-api-client/src/mock/server.ts", import.meta.url), "utf8");
    expect(source.match(/const GAZETTE_ROLE = "([^"]+)"/)?.[1]).toBe(DEEDPOLL_DELIVERY_MANAGER);
  });

  it("should keep the Gazette worklist outside ordinary list filters", () => {
    expect(filterFor("readyForPublication").key).toBe("all");
    expect(LIST_FILTERS.map((filter) => filter.key)).not.toContain("readyForPublication");
    const root = new URL("../", import.meta.url);
    const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"));
    for (const file of files.filter((file) => !file.startsWith("gazette/"))) {
      expect(readFileSync(new URL(file, root), "utf8"), file).not.toMatch(/import\s*\{[^}]*\bREADY_FOR_PUBLICATION_FILTER\b/);
    }
  });
});
