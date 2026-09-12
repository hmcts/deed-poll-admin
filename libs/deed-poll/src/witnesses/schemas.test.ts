import { describe, expect, it } from "vitest";
import { createWitnessSchema, updateWitnessSchema } from "./schemas.js";

const valid = {
  witnessName: "Sam Doe",
  witnessAddress: "1 High St",
  witnessOccupation: "Teacher",
  declarant: false
};

describe("createWitnessSchema", () => {
  it("accepts a complete witness", () => {
    expect(createWitnessSchema.parse(valid)).toEqual(valid);
  });

  it("requires every field, because the source does", () => {
    for (const field of Object.keys(valid)) {
      const partial = { ...valid };
      delete partial[field as keyof typeof valid];

      expect(createWitnessSchema.safeParse(partial).success, `${field} should be required`).toBe(false);
    }
  });

  // Each field at its limit and one over, so a cap cannot be off by one in either direction: a schema
  // rejecting the 100th character refuses a name api stores, and one accepting the 101st sends a body api
  // refuses. Only the pair pins the boundary — either assertion alone passes against an off-by-one.
  it("enforces the source column lengths", () => {
    expect(createWitnessSchema.safeParse({ ...valid, witnessName: "a".repeat(100) }).success).toBe(true);
    expect(createWitnessSchema.safeParse({ ...valid, witnessName: "a".repeat(101) }).success).toBe(false);
    expect(createWitnessSchema.safeParse({ ...valid, witnessAddress: "a".repeat(250) }).success).toBe(true);
    expect(createWitnessSchema.safeParse({ ...valid, witnessAddress: "a".repeat(251) }).success).toBe(false);
    expect(createWitnessSchema.safeParse({ ...valid, witnessOccupation: "a".repeat(100) }).success).toBe(true);
    expect(createWitnessSchema.safeParse({ ...valid, witnessOccupation: "a".repeat(101) }).success).toBe(false);
  });

  // No minimum anywhere, which is api's rule rather than an oversight here — `WitnessSchemas` caps and
  // does not require, and api stores `""`. Pinned so a well-meant `.min(1)` cannot be added without a
  // matching change at api's end.
  it("accepts a blank field, because the source has caps and no minimum", () => {
    expect(createWitnessSchema.safeParse({ ...valid, witnessName: "", witnessAddress: "", witnessOccupation: "" }).success).toBe(true);
  });

  it("requires declarant to be a boolean, not a truthy string", () => {
    expect(createWitnessSchema.safeParse({ ...valid, declarant: "true" }).success).toBe(false);
  });
});

describe("updateWitnessSchema", () => {
  it("accepts a partial patch", () => {
    expect(updateWitnessSchema.parse({ witnessOccupation: "Nurse" })).toEqual({ witnessOccupation: "Nurse" });
  });

  // `declarant` is the one field where required-on-create and optional-on-patch differ in consequence: api
  // leaves an omitted field as stored, so a patch that had to carry it would make every occupation change
  // restate the declarant answer — and a restated answer is one that can be restated wrongly.
  it("leaves declarant optional, unlike create, so a patch need not restate it", () => {
    expect(createWitnessSchema.safeParse({ witnessName: "Sam Doe", witnessAddress: "1 High St", witnessOccupation: "Teacher" }).success).toBe(false);
    expect(updateWitnessSchema.parse({ witnessName: "Sam Doe" })).toEqual({ witnessName: "Sam Doe" });
  });

  it("still refuses a truthy string for declarant when the patch does carry it", () => {
    expect(updateWitnessSchema.safeParse({ declarant: "true" }).success).toBe(false);
    expect(updateWitnessSchema.parse({ declarant: false })).toEqual({ declarant: false });
  });

  it("still enforces lengths on present fields", () => {
    expect(updateWitnessSchema.safeParse({ witnessName: "a".repeat(101) }).success).toBe(false);
  });
});
