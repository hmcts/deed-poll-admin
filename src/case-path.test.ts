import { NotFoundError } from "@hmcts/deed-poll";
import { describe, expect, it } from "vitest";
import { casePath } from "./case-path.js";

// An origin the paths are resolved against, standing in for the app's own: what is asserted is that the case id
// cannot move a browser off it, nor into a query, a fragment or a second segment.
const ORIGIN = "https://admin.deed-poll.test";

describe("casePath", () => {
  // The expected paths are written out rather than computed with `encodeURIComponent`, so a wrong encoder cannot
  // agree with itself.
  it.each([
    ["an ordinary id", "case-1", "/deed-polls/case-1"],
    ["a UUID", "0b6f1c3e-2a4d-4e8f-9c1a-7d5e3b2f1a90", "/deed-polls/0b6f1c3e-2a4d-4e8f-9c1a-7d5e3b2f1a90"],
    ["a slash", "a/b", "/deed-polls/a%2Fb"],
    ["a backslash, which a browser reads as a slash", "a\\b", "/deed-polls/a%5Cb"],
    ["a query delimiter", "a?b=c", "/deed-polls/a%3Fb%3Dc"],
    ["a fragment delimiter", "a#b", "/deed-polls/a%23b"],
    ["a percent sign", "50%", "/deed-polls/50%25"],
    ["a space", "a b", "/deed-polls/a%20b"],
    ["Unicode", "café-名", "/deed-polls/caf%C3%A9-%E5%90%8D"],
    ["CR and LF", "a\r\nLocation: x", "/deed-polls/a%0D%0ALocation%3A%20x"],
    ["an absolute URL", "https://evil.example/x", "/deed-polls/https%3A%2F%2Fevil.example%2Fx"],
    ["a protocol-relative URL", "//evil.example", "/deed-polls/%2F%2Fevil.example"],
    ["traversal containing slashes", "../../judicial", "/deed-polls/..%2F..%2Fjudicial"],
    ["a literal encoded slash, encoded again rather than decoded", "%2F", "/deed-polls/%252F"],
    ["literal encoded dots, encoded again rather than decoded", "%2e%2e", "/deed-polls/%252e%252e"],
    ["three dots, which is not a dot segment", "...", "/deed-polls/..."]
  ])("should keep %s as one encoded path segment", (_label, caseId, expected) => {
    const path = casePath(caseId);

    expect(path).toBe(expected);
  });

  it.each(["case-1", "a/b", "a\\b", "a?b=c", "a#b", "50%", "a\r\nb", "https://evil.example/x", "//evil.example", "../../judicial", "%2e%2e"])(
    "should resolve %j to this origin, with no query, no fragment and one segment under /deed-polls",
    (caseId) => {
      const url = new URL(casePath(caseId), ORIGIN);

      expect(url.origin).toBe(ORIGIN);
      expect(url.search).toBe("");
      expect(url.hash).toBe("");
      expect(url.pathname.split("/")).toEqual(["", "deed-polls", expect.any(String)]);
      expect(decodeURIComponent(url.pathname.split("/")[2])).toBe(caseId);
    }
  );

  // `encodeURIComponent` leaves dots alone and a browser removes a `.` or `..` segment, so these would name the case
  // list or the site root rather than a case. No case can be there, so they are the 404 a missing case is.
  it.each(["", ".", ".."])("should refuse %j as not found", (caseId) => {
    expect(() => casePath(caseId)).toThrow(NotFoundError);
  });

  it("should refuse with a fixed message that repeats nothing it was given", () => {
    const messages = ["", ".", ".."].map((caseId) => {
      try {
        casePath(caseId);
        return "no error";
      } catch (error) {
        return (error as Error).message;
      }
    });

    expect(new Set(messages).size).toBe(1);
    expect(messages[0]).toBe("Case id is not a usable path segment");
  });
});
