import { NotFoundError } from "@hmcts/deed-poll";
import { describe, expect, it } from "vitest";
import { pathSegment } from "./path-segment.js";

// `casePath` and `referralPath` carry the full delimiter matrix against their own prefixes; this pins the shared
// contract once, for every other id a path is built from (referral, saved query, Gazette batch, email).
describe("pathSegment", () => {
  // Written out rather than computed with `encodeURIComponent`, so a wrong encoder cannot agree with itself.
  it.each([
    ["an ordinary id", "query-1", "query-1"],
    ["a slash", "a/b", "a%2Fb"],
    ["a query delimiter", "a?b=c", "a%3Fb%3Dc"],
    ["a fragment delimiter", "a#b", "a%23b"],
    ["CR and LF", "a\r\nb", "a%0D%0Ab"],
    ["a literal encoded slash, encoded again rather than decoded", "%2F", "%252F"],
    ["three dots, which is not a dot segment", "...", "..."]
  ])("should encode %s exactly once", (_label, value, expected) => {
    expect(pathSegment(value, "Query id")).toBe(expected);
  });

  // A browser drops a `.` or `..` segment, which encoding leaves alone, so these would name a parent path.
  it.each(["", ".", ".."])("should refuse %j as not found", (value) => {
    expect(() => pathSegment(value, "Query id")).toThrow(NotFoundError);
  });

  it("should refuse with a message naming only what the caller said the id was", () => {
    expect(() => pathSegment("..", "Gazette batch id")).toThrow("Gazette batch id is not a usable path segment");
  });
});
