import { describe, expect, it } from "vitest";
import { seedDataset } from "./dataset.js";

const BATCH = "dataset-test";
const DATE = "2026-10-02";

describe("seed dataset scenarios", () => {
  it.each([
    [0, {}],
    [6, { awaitingFurtherDocsInfo: "2026-09-21" }],
    [10, { dateReadyForMaster: "2026-09-22" }],
    [13, { dateReadyForMaster: "2026-09-18", dateReferred: "2026-09-23" }],
    [17, { signatureRequestedDate: "2026-09-22" }],
    [21, { signatureRequestedDate: "2026-09-16", signatureReceivedDate: "2026-09-24" }],
    [24, { signatureRequestedDate: "2026-08-28", signatureReceivedDate: "2026-09-15", dateEnroled: "2026-10-01" }],
    [28, { dateReturned: "2026-09-13", returnReason: "Applicant withdrew the application before enrolment." }],
    [29, { dateReturned: "2026-09-11", returnReason: "Required parental consent was not supplied; application returned with guidance." }]
  ] as const)("should retain the milestone fields for scenario %i", (index, expected) => {
    const row = seedDataset(BATCH, DATE)[index];
    const progress = Object.fromEntries(
      Object.entries(row.progress).map(([key, value]) => [key, value instanceof Date ? value.toISOString().slice(0, 10) : value])
    );
    expect(progress).toEqual(expected);
  });

  it("should retain witness counts, identities and minor declarants", () => {
    const rows = seedDataset(BATCH, DATE);
    expect(rows.map((row) => row.witnesses.length)).toEqual([0, 1, 2, 0, 1, 2, 1, 1, 1, 1, ...Array(20).fill(2)]);
    expect(rows[2].witnesses).toEqual([
      { witnessName: "Morgan Witness-03", witnessAddress: "1 Synthetic Witness Road, Leeds, LS1 3AD", witnessOccupation: "Teacher", declarant: true },
      { witnessName: "Casey Witness-03", witnessAddress: "2 Synthetic Witness Road, Leeds, LS1 3AD", witnessOccupation: "Engineer", declarant: false }
    ]);
    expect(rows[1].witnesses[0].declarant).toBe(false);
  });

  it("should retain referral states, urgency, privacy and the rejected scenario", () => {
    const rows = seedDataset(BATCH, DATE);
    const referrals = rows.flatMap((row, index) => (row.referral ? [{ index, ...row.referral }] : []));
    expect(referrals.map(({ index, state }) => [index, state])).toEqual([
      [9, "Withdrawn"],
      [13, "Open"],
      [14, "Claimed"],
      [15, "Decided"],
      [16, "Decided"],
      [25, "Closed"],
      [26, "Closed"]
    ]);
    expect(rows[14].referral).toEqual({
      state: "Claimed",
      create: {
        reasons: ["Minor"],
        notes: "[SEED-dataset-test-15] Synthetic minor application for judicial consideration.",
        urgency: "Urgent",
        urgencyReason: "Synthetic urgent travel scenario."
      },
      direction: {
        decision: "Approved",
        changesToStandardPublication: true,
        directionsText: "Synthetic direction: the application may proceed subject to the usual signed evidence."
      }
    });
    expect(rows[16].referral).toEqual({
      state: "Decided",
      create: {
        reasons: ["NonPublication"],
        notes: "[SEED-dataset-test-17] Synthetic request to consider non-publication.",
        urgency: "Normal"
      },
      direction: {
        decision: "Rejected",
        changesToStandardPublication: false,
        directionsText: "Non-publication request refused in this synthetic scenario; ask whether the applicant wishes to proceed."
      }
    });
    expect(rows[0]).not.toHaveProperty("referral");
  });

  it("should reproduce a batch independently of previous calls and mutations", () => {
    const original = seedDataset(BATCH, DATE);
    const changed = seedDataset(BATCH, DATE);
    changed[14].create.newForename = "Changed";
    changed[14].progress.dateReferred?.setUTCFullYear(2000);
    changed[14].witnesses[0].witnessName = "Changed";
    changed[14].referral?.create.reasons.push("NonPublication");
    seedDataset("another-batch", "2024-02-29");
    expect(seedDataset(BATCH, DATE)).toEqual(original);
  });
});
