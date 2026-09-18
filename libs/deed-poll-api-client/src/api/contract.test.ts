/**
 * The drift test between api's published `openapi.json` and the schemas this adapter parses with.
 *
 * The document is api's own output, so unlike `deed-poll-web`'s equivalent this is not two hand-written
 * descriptions being compared — it is a check that the adapter still matches what api actually serves. It
 * fails on a property renamed or added at either end, an enum member added, an operation the adapter does
 * not call, and a response property whose strictness was decided rather than derived.
 *
 * Refreshing the document is `SPEC-PROVENANCE.md`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { STRICT_RESPONSE_PROPERTIES, UNSPECIFIED_SCHEMAS, WIRE_SCHEMAS } from "./wire.js";

const SPEC_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../openapi.json");
const spec = JSON.parse(readFileSync(SPEC_PATH, "utf8")) as OpenApiSpec;

/**
 * Operations the adapter implements, as `METHOD path`.
 *
 * Compared with the document in both directions, so an operation api adds with no adapter function fails
 * just as loudly as a call the adapter makes that api does not serve.
 *
 * `GET /` is Spring Boot's welcome route — api's template ships it and it returns a string. Listed because
 * the comparison is exhaustive, not because anything calls it.
 *
 * **`GET /health/liveness` is the one call this cannot cover.** springdoc does not document management
 * endpoints, so the actuator path `checkApiReachable` probes is absent from the document and listing it
 * here would fail the comparison rather than pin it. It is recorded in `SPEC-PROVENANCE.md` with the api
 * config that is its authority — check that when refreshing the document.
 */
const IMPLEMENTED_OPERATIONS = [
  "GET /",
  "GET /caseworker/cases",
  "POST /caseworker/cases",
  "GET /caseworker/cases/field-rules",
  "GET /caseworker/cases/{id}",
  "PATCH /caseworker/cases/{id}",
  "GET /caseworker/cases/{id}/notes",
  "POST /caseworker/cases/{id}/notes",
  "GET /caseworker/cases/{id}/notes/{noteId}",
  "PATCH /caseworker/cases/{id}/notes/{noteId}",
  "DELETE /caseworker/cases/{id}/notes/{noteId}",
  "GET /caseworker/cases/{id}/witnesses",
  "POST /caseworker/cases/{id}/witnesses",
  "GET /caseworker/cases/{id}/witnesses/{witnessId}",
  "PATCH /caseworker/cases/{id}/witnesses/{witnessId}",
  "DELETE /caseworker/cases/{id}/witnesses/{witnessId}",
  "POST /caseworker/cases/{id}/documents",
  "GET /caseworker/cases/{id}/documents/{documentId}/file",
  "GET /caseworker/cases/{id}/referrals",
  "POST /caseworker/cases/{id}/referrals",
  "GET /caseworker/cases/{id}/referrals/{referralId}",
  "POST /caseworker/cases/{id}/referrals/{referralId}/withdrawal",
  "POST /caseworker/cases/{id}/referrals/{referralId}/closure",
  "GET /caseworker/document-types",
  "GET /caseworker/saved-queries",
  "POST /caseworker/saved-queries",
  "GET /caseworker/saved-queries/{id}",
  "PATCH /caseworker/saved-queries/{id}",
  "DELETE /caseworker/saved-queries/{id}",
  "PUT /caseworker/saved-queries/{id}/selection",
  "DELETE /caseworker/saved-queries/{id}/selection",
  "GET /judicial/referrals",
  "GET /judicial/referrals/{referralId}",
  "POST /judicial/referrals/{referralId}/claim",
  "POST /judicial/referrals/{referralId}/direction"
];

describe("openapi.json and the wire schemas", () => {
  it("should describe exactly the schemas the adapter parses with", () => {
    const inSpec = Object.keys(spec.components.schemas).sort();
    const inCode = Object.keys(WIRE_SCHEMAS).sort();

    expect(inCode).toEqual(inSpec);
  });

  it("should not describe the schemas listed as unspecified", () => {
    // If api starts publishing one of these, it should be compared like everything else rather than
    // staying on an exemption list nobody revisits.
    for (const name of Object.keys(UNSPECIFIED_SCHEMAS)) {
      expect(Object.keys(spec.components.schemas), name).not.toContain(name);
    }
  });

  it("should describe exactly the operations the adapter calls", () => {
    const inSpec = Object.entries(spec.paths)
      .flatMap(([route, methods]) => Object.keys(methods).map((method) => `${method.toUpperCase()} ${route}`))
      .sort();

    expect([...IMPLEMENTED_OPERATIONS].sort()).toEqual(inSpec);
  });

  for (const [name, schema] of Object.entries(WIRE_SCHEMAS)) {
    describe(name, () => {
      const specSchema = spec.components.schemas[name];

      it("should have the same properties as the spec", () => {
        expect(Object.keys(schema.shape).sort()).toEqual(Object.keys(specSchema.properties ?? {}).sort());
      });

      it("should offer the same enum members as the spec", () => {
        for (const [property, definition] of Object.entries(specSchema.properties ?? {})) {
          if (!definition.enum) continue;

          // A nullable spec enum carries `null` as a member. The schema expresses that with `.nullish()`
          // rather than as a member, so it is dropped before comparing.
          const expected = definition.enum.filter((member): member is string => member !== null);
          expect(enumMembers(schema.shape[property] as z.ZodType), `${name}.${property}`).toEqual([...expected].sort());
        }
      });
    });
  }

  /**
   * The strictness the document cannot express.
   *
   * springdoc emits no nullability for a response, so which properties reject null is a decision this
   * repo makes. Pinned rather than derived, because the alternative — inferring it — is what would let a
   * schema quietly start rejecting an ordinary half-logged case.
   */
  for (const [name, strict] of Object.entries(STRICT_RESPONSE_PROPERTIES)) {
    it(`should reject null for exactly the pinned properties of ${name}`, () => {
      const schema = WIRE_SCHEMAS[name as keyof typeof WIRE_SCHEMAS];
      const rejectsNull = Object.entries(schema.shape)
        .filter(([, property]) => !(property as z.ZodType).safeParse(null).success)
        .map(([key]) => key);

      expect(rejectsNull.sort()).toEqual([...strict].sort());
    });
  }

  it("should pin strictness for every response schema", () => {
    // A schema added to the registry with no strictness decision would otherwise inherit whatever its
    // author happened to write, which is the drift this list exists to stop.
    const requests = [
      "CreateCaseRequest",
      "UpdateCaseRequest",
      "CreateNoteRequest",
      "UpdateNoteRequest",
      "CreateWitnessRequest",
      "UpdateWitnessRequest",
      "CreateSavedQueryRequest",
      "UpdateSavedQueryRequest",
      "CreateReferralRequest",
      "JudicialDirectionRequest"
    ];
    const responses = Object.keys(WIRE_SCHEMAS).filter((name) => !requests.includes(name));

    expect(responses.sort()).toEqual(Object.keys(STRICT_RESPONSE_PROPERTIES).sort());
  });

  it("should agree with the spec on the note length limits", () => {
    // The one length api publishes and this app also enforces. Both ends check it on purpose: a client
    // that rejects early gives a better error than a 400.
    const note = spec.components.schemas.CreateNoteRequest.properties?.note;

    expect(note?.maxLength).toBe(2000);
    expect(note?.minLength).toBe(1);
    expect(WIRE_SCHEMAS.CreateNoteRequest.safeParse({ note: "x".repeat(2001) }).success).toBe(false);
    expect(WIRE_SCHEMAS.CreateNoteRequest.safeParse({ note: "" }).success).toBe(false);
  });

  it("should agree with the spec on the witness length limits", () => {
    // The three caps are the source columns' widths, published by api and enforced here so a caseworker
    // gets a message against the field rather than a 400.
    const witness = { witnessName: "A Witness", witnessAddress: "1 Road", witnessOccupation: "Baker", declarant: false };

    for (const [field, maxLength] of [
      ["witnessName", 100],
      ["witnessAddress", 250],
      ["witnessOccupation", 100]
    ] as const) {
      expect(spec.components.schemas.CreateWitnessRequest.properties?.[field]?.maxLength, field).toBe(maxLength);
      expect(WIRE_SCHEMAS.CreateWitnessRequest.safeParse({ ...witness, [field]: "x".repeat(maxLength) }).success, field).toBe(true);
      expect(WIRE_SCHEMAS.CreateWitnessRequest.safeParse({ ...witness, [field]: "x".repeat(maxLength + 1) }).success, field).toBe(false);
    }
  });

  it("should require every witness field on a create and none on a patch", () => {
    // `createWitnessSchema.partial()` at both ends: all four NOT NULL columns are required to add a
    // witness, and an empty patch is a body api accepts.
    expect([...(spec.components.schemas.CreateWitnessRequest.required ?? [])].sort()).toEqual([
      "declarant",
      "witnessAddress",
      "witnessName",
      "witnessOccupation"
    ]);
    expect(spec.components.schemas.UpdateWitnessRequest.required).toBeUndefined();
    expect(WIRE_SCHEMAS.CreateWitnessRequest.safeParse({ witnessName: "A", witnessAddress: "1 Road", witnessOccupation: "Baker" }).success).toBe(false);
    expect(WIRE_SCHEMAS.UpdateWitnessRequest.safeParse({}).success).toBe(true);
    // A truthy string, refused rather than coerced: `"false"` is truthy, and a declarant recorded as an
    // ordinary witness changes what the case means.
    expect(WIRE_SCHEMAS.UpdateWitnessRequest.safeParse({ declarant: "false" }).success).toBe(false);
  });

  it("should not accept a reference number or an audit column on a write", () => {
    // api does not accept them, and this app must not try: reference allocation is api's, per task 3.
    for (const field of ["referencenumber", "displayReference", "createdBy", "modifiedBy", "createdOn", "modifiedOn"]) {
      expect(Object.keys(WIRE_SCHEMAS.CreateCaseRequest.shape), field).not.toContain(field);
      expect(Object.keys(spec.components.schemas.CreateCaseRequest.properties ?? {}), field).not.toContain(field);
    }
  });
});

/** The members of a zod enum, however it is wrapped by `.nullish()`. */
function enumMembers(schema: z.ZodType): string[] {
  let unwrapped = schema;
  while ("unwrap" in unwrapped && typeof unwrapped.unwrap === "function") {
    unwrapped = unwrapped.unwrap() as z.ZodType;
  }

  return [...((unwrapped as unknown as { options?: string[] }).options ?? [])].sort();
}

interface OpenApiSpec {
  paths: Record<string, Record<string, unknown>>;
  components: {
    schemas: Record<string, OpenApiSchema>;
  };
}

interface OpenApiSchema {
  required?: string[];
  properties?: Record<string, { enum?: (string | null)[]; maxLength?: number; minLength?: number }>;
}
