import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { filterFor, LIST_FILTERS } from "../deed-poll/list-filters.js";
import { DEEDPOLL_ADMIN, DEEDPOLL_CASEWORKER, DEEDPOLL_DELIVERY_MANAGER, DEEDPOLL_JUDICIAL, DEEDPOLL_TEAM_LEADER } from "./roles.js";

describe("staff boundary integration", () => {
  it("should keep the mock's role table aligned without a circular library dependency", () => {
    const source = readFileSync(new URL("../../../deed-poll-api-client/src/mock/caller-access.ts", import.meta.url), "utf8");
    const roles = [...source.matchAll(/^ {2}"([^"]+)": \{/gm)].map((match) => match[1]);
    expect(roles.toSorted()).toEqual([DEEDPOLL_ADMIN, DEEDPOLL_CASEWORKER, DEEDPOLL_DELIVERY_MANAGER, DEEDPOLL_JUDICIAL, DEEDPOLL_TEAM_LEADER].toSorted());
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
