import { NotFoundError } from "@hmcts/deed-poll";
import { describe, expect, it } from "vitest";
import { referralPath } from "./judicial-referral-path.js";

// The same contract as `casePath`, under the judicial pool's prefix — see `./case-path.test.ts`.
const ORIGIN = "https://admin.deed-poll.test";

describe("referralPath", () => {
  // Written out rather than computed with `encodeURIComponent`, so a wrong encoder cannot agree with itself.
  it.each([
    ["an ordinary id", "ref-1", "/judicial/referrals/ref-1"],
    ["a UUID", "0b6f1c3e-2a4d-4e8f-9c1a-7d5e3b2f1a90", "/judicial/referrals/0b6f1c3e-2a4d-4e8f-9c1a-7d5e3b2f1a90"],
    ["a slash", "a/b", "/judicial/referrals/a%2Fb"],
    ["a query delimiter", "a?b=c", "/judicial/referrals/a%3Fb%3Dc"],
    ["a fragment delimiter", "a#b", "/judicial/referrals/a%23b"],
    ["a percent sign", "50%", "/judicial/referrals/50%25"],
    ["traversal containing slashes", "../../deed-polls", "/judicial/referrals/..%2F..%2Fdeed-polls"],
    ["a literal encoded slash, encoded again rather than decoded", "%2F", "/judicial/referrals/%252F"]
  ])("should keep %s as one encoded path segment", (_label, referralId, expected) => {
    const path = referralPath(referralId);

    expect(path).toBe(expected);
  });

  it.each(["ref-1", "a/b", "a?b=c", "a#b", "50%", "../../deed-polls", "%2F"])(
    "should resolve %j to this origin, with no query, no fragment and one segment under /judicial/referrals",
    (referralId) => {
      const url = new URL(referralPath(referralId), ORIGIN);

      expect(url.origin).toBe(ORIGIN);
      expect(url.search).toBe("");
      expect(url.hash).toBe("");
      expect(url.pathname.split("/")).toEqual(["", "judicial", "referrals", expect.any(String)]);
      expect(decodeURIComponent(url.pathname.split("/")[3])).toBe(referralId);
    }
  );

  // A browser removes a `.` or `..` segment, so these would name the pool or the area's parent, not a referral.
  it.each(["", ".", ".."])("should refuse %j as not found", (referralId) => {
    expect(() => referralPath(referralId)).toThrow(NotFoundError);
  });

  it("should refuse with a fixed message that repeats nothing it was given", () => {
    const messages = ["", ".", ".."].map((referralId) => {
      try {
        referralPath(referralId);
        return "no error";
      } catch (error) {
        return (error as Error).message;
      }
    });

    expect(new Set(messages).size).toBe(1);
    expect(messages[0]).toBe("Referral id is not a usable path segment");
  });
});
