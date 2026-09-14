import { describe, expect, it } from "vitest";
import { FORM_TABS } from "../deed-poll/form-fields.js";
import { enrolmentWitnessWarning, WITNESSES_REQUIRED_FOR_ENROLMENT, witnessCountText } from "./enrolment-requirement.js";

const tab = (id: string) => FORM_TABS.find((candidate) => candidate.id === id) ?? FORM_TABS[0];

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

  describe("enrolmentWitnessWarning", () => {
    it("should warn on the signature tab when the case is short, because that is where a date api refuses lives", () => {
      expect(enrolmentWitnessWarning(tab("signature"), 1)).toBe(
        "1 of 2 witnesses recorded. A Deed Poll cannot be sent for enrolment until 2 witnesses have been recorded, " +
          "so a case carrying an enrolment date cannot be saved while it is short. Add 1 more witness."
      );
    });

    it("should ask for both witnesses when the case has none", () => {
      expect(enrolmentWitnessWarning(tab("enrolment"), 0)).toContain("Add 2 more witnesses.");
    });

    it("should say nothing once the requirement is met, since a banner that always shows is never read", () => {
      expect(enrolmentWitnessWarning(tab("enrolment"), WITNESSES_REQUIRED_FOR_ENROLMENT)).toBeNull();
    });

    it("should say nothing above the requirement", () => {
      expect(enrolmentWitnessWarning(tab("signature"), 3)).toBeNull();
    });

    it("should say nothing on a tab that carries no enrolment date, however short the case is", () => {
      expect(enrolmentWitnessWarning(tab("application"), 0)).toBeNull();
      expect(enrolmentWitnessWarning(tab("return"), 0)).toBeNull();
    });

    it("should warn on any tab once a refusal names an enrolment date, which is the merged-record case", () => {
      // An edit to a surname on a case already carrying a date is refused, and api addresses the refusal to
      // the date — which has no control on the Application tab, so the summary link is dead. The banner is
      // then the only way to the witnesses.
      expect(enrolmentWitnessWarning(tab("application"), 1, ["dateEnroled"])).toContain("1 of 2 witnesses recorded");
      expect(enrolmentWitnessWarning(tab("refund"), 1, ["signatureReceivedDate"])).toContain("Add 1 more witness.");
    });

    it("should stay silent for a refusal about something other than the enrolment dates", () => {
      expect(enrolmentWitnessWarning(tab("application"), 1, ["newSurname", "state"])).toBeNull();
    });

    it("should stay silent for a refusal on a met requirement, since the refusal was then not about witnesses", () => {
      expect(enrolmentWitnessWarning(tab("application"), 2, ["dateEnroled"])).toBeNull();
    });

    it("should not accuse the caseworker of attempting an enrolment, since the refusal reaches any edit", () => {
      // The rule is checked against the merged record, so a case already carrying a date is refused an
      // edit to an unrelated field. Wording addressed to an enrolment nobody attempted would misdescribe
      // that — see docs/plans/07-witness-count-feedback.md.
      expect(enrolmentWitnessWarning(tab("enrolment"), 1)).not.toContain("you cannot");
    });
  });
});
