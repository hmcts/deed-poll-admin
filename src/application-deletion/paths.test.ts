import { NotFoundError } from "@hmcts/deed-poll";
import { describe, expect, it } from "vitest";
import { deletionConfirmationPath, deletionRestorePath, deletionStatusPath } from "./paths.js";

describe("application deletion paths", () => {
  it("should encode each id once", () => {
    expect(deletionConfirmationPath("a/b")).toBe("/deed-polls/a%2Fb/delete");
    expect(deletionStatusPath("x%2Fy")).toBe("/deed-polls/deletions/x%252Fy");
    expect(deletionRestorePath("r-1", "case 1&x=2")).toBe("/deed-polls/deletions/r-1/restore?case=case+1%26x%3D2");
  });

  it("should refuse a dot-segment id", () => {
    expect(() => deletionStatusPath("..")).toThrow(NotFoundError);
    expect(() => deletionConfirmationPath(".")).toThrow(NotFoundError);
  });
});
