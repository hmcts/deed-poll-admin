import { describe, expect, it } from "vitest";
import { LEGACY_REFERRAL_TAB } from "../deed-poll/form-fields.js";
import { buildLegacyReferralView } from "./legacy-referral-view.js";

/** A migrated case whose whole referral record is in the retired fields. */
const MIGRATED = {
  referToMasterChoice: "Yes",
  dateReadyForMaster: "2024-03-01",
  dateReferred: "2024-03-04",
  referralNotes: "Applicant was 15 when the deed was signed.",
  masterName: "Master Smith",
  masterDirections: "Enrol once the declarant's consent is filed.",
  masterDecision: "Approved",
  masterDateOfDecision: "2024-03-18",
  dateDecisionDirectionsReceived: "2024-03-20",
  publishToLondonGazette: true
};

describe("referrals/legacy-referral-view", () => {
  it("should render every populated retired field, in the order the source form held them", () => {
    const view = buildLegacyReferralView(MIGRATED);

    expect(view?.rows.map((row) => row.key)).toEqual(LEGACY_REFERRAL_TAB.sections[0].fields.map((field) => field.label));
  });

  it("should take its labels from the field metadata rather than restating them", () => {
    // The point of building from `LEGACY_REFERRAL_TAB`: a label corrected on the case form is corrected here.
    const view = buildLegacyReferralView({ masterName: "Master Smith" });

    expect(view?.rows).toEqual([{ key: "Master name", value: "Master Smith" }]);
  });

  it("should format each value by its kind, exactly as the case detail page always did", () => {
    const view = buildLegacyReferralView(MIGRATED);
    const value = (key: string) => view?.rows.find((row) => row.key === key)?.value;

    expect(value("Date referred")).toBe("4 March 2024");
    expect(value("Master decision")).toBe("Approved");
    expect(value("Publish to London Gazette")).toBe("Yes");
    expect(value("Master directions")).toBe("Enrol once the declarant's consent is filed.");
  });

  it("should answer null when the case holds none of the retired fields, so no section is rendered", () => {
    // The absence of these values is the evidence there is no snapshot — not `migratedRecord`, which says
    // where a case came from rather than whether these fields hold anything.
    expect(buildLegacyReferralView({ type: "Adult", migratedRecord: true })).toBeNull();
    expect(buildLegacyReferralView({})).toBeNull();
  });

  it("should treat null, undefined and blank values as absent rather than rendering placeholders", () => {
    // Opposite of the detail card's rule, which keeps empty rows so a form's fields stay put. There is no form
    // here, and ten "Not provided" rows would claim a referral history the case does not have.
    const view = buildLegacyReferralView({
      referToMasterChoice: null,
      masterName: "   ",
      masterDirections: "",
      dateReferred: undefined,
      referralNotes: "Referred by post."
    });

    expect(view?.rows).toEqual([{ key: "Referral notes", value: "Referred by post." }]);
  });

  it("should keep an explicit No on the Gazette question, which is an answer somebody recorded", () => {
    // A falsiness test would drop it and turn a decided question back into an unasked one.
    const view = buildLegacyReferralView({ publishToLondonGazette: false });

    expect(view?.rows).toEqual([{ key: "Publish to London Gazette", value: "No" }]);
  });

  it("should render a partial record as the part that exists, since a migrated case may hold only some fields", () => {
    const view = buildLegacyReferralView({ masterName: "Master Smith", masterDecision: "Rejected" });

    expect(view?.rows).toEqual([
      { key: "Master name", value: "Master Smith" },
      { key: "Master decision", value: "Rejected" }
    ]);
  });

  it("should ignore case fields that are not part of the retired referral record", () => {
    expect(buildLegacyReferralView({ dateEnroled: "2024-04-01", returnReason: "Illegible" })).toBeNull();
  });
});
