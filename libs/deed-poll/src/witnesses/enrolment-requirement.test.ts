import { describe, expect, it } from "vitest";
import { WITNESSES_REQUIRED_FOR_ENROLMENT, witnessCountText } from "./enrolment-requirement.js";

describe("witnesses/enrolment-requirement", () => {
  it("should require the same number of witnesses as api does", () => {
    expect(WITNESSES_REQUIRED_FOR_ENROLMENT).toBe(2);
  });

  describe("witnessCountText", () => {
    it("should state the shortfall when no witness is recorded", () => {
      expect(witnessCountText(0)).toBe("0 of 2 witnesses recorded");
    });

    it("should state the shortfall when one witness is recorded", () => {
      expect(witnessCountText(1)).toBe("1 of 2 witnesses recorded");
    });

    it("should still state the count when the requirement is exactly met, so a complete case reads as complete", () => {
      expect(witnessCountText(2)).toBe("2 of 2 witnesses recorded");
    });

    it("should state the two numbers apart above the requirement, because api sets no maximum and '3 of 2' reads as a defect", () => {
      expect(witnessCountText(3)).toBe("3 witnesses recorded, 2 required");
    });

    it("should name the threshold from the shared constant rather than a literal", () => {
      expect(witnessCountText(1)).toContain(`of ${WITNESSES_REQUIRED_FOR_ENROLMENT}`);
    });
  });
});
