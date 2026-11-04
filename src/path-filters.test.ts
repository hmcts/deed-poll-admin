import nunjucks from "nunjucks";
import { describe, expect, it } from "vitest";
import { addPathFilters } from "./path-filters.js";

const env = addPathFilters(new nunjucks.Environment([], { autoescape: true }));

describe("path filters", () => {
  it("encodes an id as exactly one segment under its area", () => {
    expect(env.renderString("{{ id | casePath }}", { id: "a/b?c#d" })).toBe("/deed-polls/a%2Fb%3Fc%23d");
    expect(env.renderString("{{ id | referralPath }}", { id: "r/1" })).toBe("/judicial/referrals/r%2F1");
    expect(env.renderString("/x/{{ id | pathSegment }}/edit", { id: "n?1" })).toBe("/x/n%3F1/edit");
  });

  it.each(["", ".", ".."])("refuses %j rather than naming a parent path", (id) => {
    expect(() => env.renderString("{{ id | casePath }}", { id })).toThrow();
    expect(() => env.renderString("{{ id | pathSegment }}", { id })).toThrow();
  });
});
