import { NotFoundError } from "@hmcts/deed-poll";
import { describe, expect, it } from "vitest";
import { queueReassignPath, queueReferralPath } from "./paths.js";

describe("referral queue paths", () => {
  it("should name the referral as a path segment and carry the case as a query value", () => {
    expect(queueReferralPath("referral/1", "case 1&x=2")).toBe("/deed-polls/referrals/referral%2F1?case=case%201%26x%3D2");
    expect(queueReassignPath("referral-1", "case-1")).toBe("/deed-polls/referrals/referral-1/reassign?case=case-1");
  });

  it.each(["", ".", ".."])("should refuse a referral id of %j", (id) => {
    expect(() => queueReferralPath(id, "case-1")).toThrow(NotFoundError);
    expect(() => queueReassignPath(id, "case-1")).toThrow(NotFoundError);
  });
});
