/**
 * The drift test between api's published `openapi.json` and the schemas this adapter parses with.
 *
 * The document is api's own output, so unlike `deed-poll-web`'s equivalent this is not two hand-written
 * descriptions being compared — it is a check that the adapter still matches what api actually serves. It
 * fails on a property renamed or added at either end, an enum member added, an operation the adapter
 * has not explicitly accounted for, and a response property whose strictness was decided rather than derived.
 *
 * Refreshing the document is `SPEC-PROVENANCE.md`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import deferredContract from "./deferred-contract.json";
import { GAZETTE_RECIPIENT_EMAIL_PATTERN, STRICT_RESPONSE_PROPERTIES, UNSPECIFIED_SCHEMAS, WIRE_SCHEMAS } from "./wire.js";

const SPEC_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../openapi.json");
const spec = JSON.parse(readFileSync(SPEC_PATH, "utf8")) as OpenApiSpec;

/**
 * Operations the adapter implements, as `METHOD path`.
 *
 * Compared with the document in both directions alongside the pinned deferred CCD inventory, so an
 * unaccounted operation fails just as loudly as a call api does not serve.
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
  "GET /caseworker/gazette-notices",
  "POST /caseworker/gazette-notices",
  "POST /caseworker/gazette-notice-previews",
  "GET /caseworker/gazette-notice-requests",
  "GET /caseworker/gazette-notices/{batchId}",
  "GET /caseworker/gazette-notices/{batchId}/cases",
  "GET /caseworker/gazette-settings",
  "PUT /caseworker/gazette-settings",
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
  "GET /caseworker/cases/{id}/emails",
  "POST /caseworker/cases/{id}/emails/{template}",
  "POST /caseworker/cases/{id}/emails/{template}/preview",
  "POST /caseworker/cases/{id}/documents",
  "GET /caseworker/cases/{id}/documents/{documentId}/file",
  "GET /caseworker/cases/{id}/referrals",
  "POST /caseworker/cases/{id}/referrals",
  "GET /caseworker/cases/{id}/referrals/{referralId}",
  "POST /caseworker/cases/{id}/referrals/{referralId}/withdrawal",
  "POST /caseworker/cases/{id}/referrals/{referralId}/closure",
  "POST /caseworker/cases/{id}/referrals/{referralId}/confirmation",
  "GET /caseworker/document-types",
  "GET /caseworker/saved-queries",
  "POST /caseworker/saved-queries",
  "GET /caseworker/saved-queries/{id}",
  "PATCH /caseworker/saved-queries/{id}",
  "DELETE /caseworker/saved-queries/{id}",
  "PUT /caseworker/saved-queries/{id}/selection",
  "DELETE /caseworker/saved-queries/{id}/selection",
  "GET /judicial/referrals",
  // Before the template below in this list only as a matter of sorting; what matters is that api routes the
  // literal segment first, which `referrals-admin-6` decision 6 and the mock's own ordering test pin.
  "GET /judicial/referrals/mine",
  "GET /judicial/referrals/{referralId}",
  "POST /judicial/referrals/{referralId}/claim",
  "POST /judicial/referrals/{referralId}/direction"
];

describe("openapi.json and the wire schemas", () => {
  it("should use the published Gazette email constraint and preserve private attribution", () => {
    const request = spec.components.schemas.UpdateGazetteSettingsRequest;
    expect(request.properties?.recipientEmail?.pattern).toBe(GAZETTE_RECIPIENT_EMAIL_PATTERN);
    expect(request.properties?.recipientEmail?.maxLength).toBe(254);
    expect(request.required?.toSorted()).toEqual(["recipientEmail", "revision"]);
    expect(request.additionalProperties).toBe(false);
    expect(Object.keys(spec.components.schemas.GazetteSettingsResponse.properties ?? {}).sort()).toEqual([
      "recipientEmail",
      "revision",
      "updatedAt",
      "updatedBy"
    ]);
  });
  it("should retain strict bounded Gazette selections, opaque confirmation tokens and header-only request identity", () => {
    for (const name of ["PreviewGazetteRequest", "SubmitGazetteRequest"] as const) {
      expect(spec.components.schemas[name].additionalProperties).toBe(false);
      expect(spec.components.schemas[name].properties?.caseIds).toMatchObject({
        minItems: 1,
        maxItems: 100,
        uniqueItems: true,
        items: { minLength: 1, maxLength: 255 }
      });
    }
    const preview = WIRE_SCHEMAS.PreviewGazetteRequest;
    for (const caseIds of [[], ["same", "same"], [""], ["x".repeat(256)], Array.from({ length: 101 }, (_, n) => String(n))]) {
      expect(preview.safeParse({ caseIds }).success).toBe(false);
    }
    expect(preview.safeParse({ caseIds: Array.from({ length: 100 }, (_, n) => String(n)) }).success).toBe(true);
    const input = { caseIds: ["case-1"], recipientRevision: 0, selectionFingerprint: "opaque" };
    expect(WIRE_SCHEMAS.SubmitGazetteRequest.safeParse(input).success).toBe(true);
    for (const extra of [
      { recipientRevision: -1 },
      { selectionFingerprint: "" },
      { selectionFingerprint: "x".repeat(513) },
      { idempotencyKey: "key" },
      { submittedBy: "forged" }
    ]) {
      expect(WIRE_SCHEMAS.SubmitGazetteRequest.safeParse({ ...input, ...extra }).success).toBe(false);
    }
    const header = spec.paths["/caseworker/gazette-notices"].post.parameters?.find((parameter) => parameter.name === "Idempotency-Key");
    expect(header).toMatchObject({ in: "header", required: true, schema: { type: "string" } });
    for (const field of ["idempotencyKey", "submittedById", "selectionFingerprint", "notificationId", "documentId"]) {
      expect(Object.keys(spec.components.schemas.GazetteStatusResponse.properties ?? {})).not.toContain(field);
    }
  });

  it("should describe exactly the consumed and explicitly deferred schemas", () => {
    const inSpec = Object.keys(spec.components.schemas).sort();
    const inCode = [...Object.keys(WIRE_SCHEMAS), ...Object.keys(deferredContract.schemas)].sort();

    expect(inCode).toEqual(inSpec);
  });

  it("should not describe the schemas listed as unspecified", () => {
    // If api starts publishing one of these, it should be compared like everything else rather than
    // staying on an exemption list nobody revisits.
    for (const name of Object.keys(UNSPECIFIED_SCHEMAS)) {
      expect(Object.keys(spec.components.schemas), name).not.toContain(name);
    }
  });

  it("should describe exactly the registered and explicitly deferred operations", () => {
    const inSpec = Object.entries(spec.paths)
      .flatMap(([route, methods]) => Object.keys(methods).map((method) => `${method.toUpperCase()} ${route}`))
      .sort();

    const deferred = Object.entries(deferredContract.paths).flatMap(([route, methods]) =>
      Object.keys(methods).map((method) => `${method.toUpperCase()} ${route}`)
    );
    expect([...IMPLEMENTED_OPERATIONS, ...deferred].sort()).toEqual(inSpec);
  });

  it("should keep the complete deferred CCD definitions unchanged until deliberately reconciled", () => {
    // CCD recovery is outside this UI's scope. Pin complete operations and schemas separately from
    // implemented calls: no wildcard exclusions, and no deriving the expected value from openapi.json.
    for (const [route, definition] of Object.entries(deferredContract.paths)) {
      expect(spec.paths[route], route).toEqual(definition);
    }
    for (const [name, definition] of Object.entries(deferredContract.schemas)) {
      expect(spec.components.schemas[name], name).toEqual(definition);
    }
  });

  it("should publish the Gazette read, paging vocabulary, bounded preview and ready filter", () => {
    const operation = spec.paths["/caseworker/gazette-notices"].get;
    expect(Object.keys(spec.paths["/caseworker/gazette-notices"])).toEqual(["get", "post"]);
    expect(operation.parameters).toEqual([
      { name: "page", in: "query", required: false, schema: { type: "string" }, description: "Page number, starting at 1; defaults to 1." },
      { name: "size", in: "query", required: false, schema: { type: "string" }, description: "Rows per page; defaults to 25 and is capped at 100." }
    ]);
    expect(operation.responses).toEqual({
      "200": { description: "OK", content: { "*/*": { schema: { $ref: "#/components/schemas/GazetteNoticeHistoryResponse" } } } }
    });
    expect(operation.description).toContain("Requires caseworker-deedpoll-delivery-manager");
    expect(operation.description).toContain("At most 100 references per batch");
    expect(spec.components.schemas.GazetteNoticeHistoryResponse.properties?.batches?.items?.$ref).toBe("#/components/schemas/GazetteNoticeBatchResponse");
    const filter = spec.paths["/caseworker/cases"].get.parameters?.find((parameter) => parameter.name === "filter");
    expect(filter?.description).toContain("`readyForPublication` (Ready for publication)");
    expect(filter?.description).toContain("`dateEnroled:asc`");
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
      "UpdateGazetteSettingsRequest",
      "PreviewGazetteRequest",
      "SubmitGazetteRequest",
      "CreateCaseRequest",
      "UpdateCaseRequest",
      "CreateNoteRequest",
      "UpdateNoteRequest",
      "CreateWitnessRequest",
      "UpdateWitnessRequest",
      "CreateSavedQueryRequest",
      "UpdateSavedQueryRequest",
      "CreateReferralRequest",
      "RecordConfirmationRequest",
      "JudicialDirectionRequest",
      "PreviewEmailRequest",
      "SendEmailRequest"
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

  it("should keep the email slot keys in snake_case at both ends", () => {
    // The one mistake in this feature that nothing else catches. These are GOV.UK Notify placeholder names —
    // the personalisation keys and the body keys at once — so they are the documented exception to this
    // module's camelCase rule. Renamed, Notify substitutes nothing and sends the template with empty slots.
    for (const name of ["PreviewEmailRequest", "SendEmailRequest"] as const) {
      expect(Object.keys(spec.components.schemas[name].properties ?? {}).sort(), name).toEqual(["additional_notes", "documents_required", "judges_reason"]);
      expect(Object.keys(WIRE_SCHEMAS[name].shape).sort(), name).toEqual(["additional_notes", "documents_required", "judges_reason"]);
      for (const camelCased of ["judgesReason", "additionalNotes", "documentsRequired"]) {
        expect(Object.keys(WIRE_SCHEMAS[name].shape), `${name}.${camelCased}`).not.toContain(camelCased);
      }
    }
  });

  it("should agree with the spec on the email slot length limits", () => {
    // api's caps are the referral direction's and the referral notes': a direction a judge could record is
    // therefore always sendable unedited. Enforced here as well so a caseworker gets a message against the
    // field, and never truncated — a shortened quotation of a judge is worse than being asked to shorten one.
    for (const [field, maxLength] of [
      ["judges_reason", 4000],
      // ⑤'s slot, capped with the direction rather than with the notes: it is a caseworker's list of what is
      // still outstanding, so it is prose of the same order as a judge's reason and not a trailing remark.
      ["documents_required", 4000],
      ["additional_notes", 1000]
    ] as const) {
      expect(spec.components.schemas.SendEmailRequest.properties?.[field]?.maxLength, field).toBe(maxLength);
      expect(WIRE_SCHEMAS.SendEmailRequest.safeParse({ [field]: "x".repeat(maxLength) }).success, field).toBe(true);
      expect(WIRE_SCHEMAS.SendEmailRequest.safeParse({ [field]: "x".repeat(maxLength + 1) }).success, field).toBe(false);
    }
  });

  it("should refuse an unknown key on the email write bodies, unlike every other body here", () => {
    // These two are the only bodies in the contract with `additionalProperties: false`, and that is what makes
    // the compose journey's idempotency UUID a 400 rather than an ignored field if anyone ever puts it in the
    // body. It belongs in the `Idempotency-Key` HEADER, which the next test pins — an earlier version of this
    // comment said the UUID "stays admin-local" and was sent to api in neither the body nor a header, which was
    // true of a token nothing checked and stopped being true when api's notify-6 made the header required.
    for (const name of ["PreviewEmailRequest", "SendEmailRequest"] as const) {
      expect(spec.components.schemas[name].additionalProperties, name).toBe(false);
      expect(Object.keys(spec.components.schemas[name].properties ?? {}), name).not.toContain("Idempotency-Key");
      expect(Object.keys(spec.components.schemas[name].properties ?? {}), name).not.toContain("requestId");
    }
    // And an empty body is legitimate on both — `judges_reason` is pre-populated from the referral's direction.
    // Legitimate of the SCHEMA, not of every template: ⑤ pre-populates `documents_required` from nothing, so an
    // empty body for that one is api's 400. Conditional mandatoriness is not expressible in a `required` list
    // serving three templates, which is why api publishes none and this schema enforces none.
    expect(spec.components.schemas.SendEmailRequest.required).toBeUndefined();
    expect(WIRE_SCHEMAS.SendEmailRequest.safeParse({}).success).toBe(true);
  });

  it("should require an Idempotency-Key header on the send and on nothing else", () => {
    // api's notify-6 made this header REQUIRED on the send, for every template and not only the chase —
    // `@RequestHeader(IDEMPOTENCY_KEY) UUID requestId` with no `required = false` and no default, so Spring
    // answers 400 when it is absent. That is the whole of why this plan exists: until the adapter sends it,
    // every send from the Email tab is a 400, including `application-rejected`, which worked before.
    //
    // Asserted as a set over the whole document rather than only on the send, because the failure worth catching
    // is the inverse one: a header api adds to a second operation that this adapter then does not send.
    const required = Object.entries(spec.paths).flatMap(([route, methods]) =>
      Object.entries(methods).flatMap(([method, operation]) =>
        (operation.parameters ?? [])
          .filter((parameter) => parameter.in === "header")
          .map((parameter) => `${method.toUpperCase()} ${route} ${parameter.name}${parameter.required ? "" : " (optional)"}`)
      )
    );

    expect(required.toSorted()).toEqual(["POST /caseworker/cases/{id}/emails/{template} Idempotency-Key", "POST /caseworker/gazette-notices Idempotency-Key"]);

    // A UUID, so the adapter may not send an opaque token: api parses the value into a `UUID` and a 400 names
    // the header. The preview deliberately has none — it writes nothing, so there is nothing to make idempotent.
    const header = (spec.paths["/caseworker/cases/{id}/emails/{template}"].post.parameters ?? []).find((parameter) => parameter.name === "Idempotency-Key");

    expect(header?.schema).toEqual({ type: "string", format: "uuid" });
    // The two answers a repeat gets, which are prose here and nowhere else in the document: the same key with the
    // same content is a receipt, and the same key with DIFFERENT content is a 409 rather than a second email.
    expect(header?.description).toContain("enqueued=false");
    expect(header?.description).toContain("409");
  });

  it("should publish the confirmation body with its two keys rather than as an empty schema", () => {
    // The 2026-09-17 check, which is mandatory at every refresh: every api write body binds as a keyed map, so
    // springdoc reflects no fields and `OpenAPIWriteBodies` describes them by hand — and a body it was not
    // extended for publishes as `{}`, which matches an empty registration silently.
    const body = spec.components.schemas.RecordConfirmationRequest;

    expect(Object.keys(body.properties ?? {}).sort()).toEqual(["note", "outcome"]);
    expect(body.required).toEqual(["outcome"]);
    expect(body.properties?.note?.maxLength).toBe(1000);
    // `true`, where the two email bodies are the contract's only `false`: an unknown key here is IGNORED rather
    // than named, which is exactly why the absent recorder below has to be asserted.
    expect(body.additionalProperties).toBe(true);
    expect(WIRE_SCHEMAS.RecordConfirmationRequest.safeParse({ outcome: "Confirmed", note: "x".repeat(1000) }).success).toBe(true);
    expect(WIRE_SCHEMAS.RecordConfirmationRequest.safeParse({ outcome: "Confirmed", note: "x".repeat(1001) }).success).toBe(false);
    // The outcome is the fact and the note is the evidence for it, so an answer with no note is a whole answer.
    expect(WIRE_SCHEMAS.RecordConfirmationRequest.safeParse({ outcome: "Withdrawn" }).success).toBe(true);
    expect(WIRE_SCHEMAS.RecordConfirmationRequest.safeParse({ note: "They replied by post" }).success).toBe(false);
  });

  it("should send neither the recorder nor the received date on a confirmation", () => {
    // api takes both from the token and its own clock, and `additionalProperties: true` means it would ignore
    // them rather than refuse them — so nothing else in this repo can catch one being sent.
    for (const field of ["confirmationRecordedBy", "confirmationReceivedAt", "recordedBy", "author"]) {
      expect(Object.keys(WIRE_SCHEMAS.RecordConfirmationRequest.shape), field).not.toContain(field);
      expect(Object.keys(spec.components.schemas.RecordConfirmationRequest.properties ?? {}), field).not.toContain(field);
    }
  });

  it("should publish the awaiting-confirmation filter and its default order in the case-list descriptions", () => {
    // The tab's key and its order arrive only as prose — springdoc has no schema for either — so this is the
    // one place the vocabulary a page sends can be checked against what api says it accepts. The order is api's
    // DEFAULT and not a rule, which is why this app sends no `sort` on that tab: one it sent would override it.
    const parameters = spec.paths["/caseworker/cases"].get.parameters ?? [];
    const description = (name: string) => parameters.find((parameter) => parameter.name === name)?.description ?? "";

    expect(description("filter")).toContain("`awaitingConfirmation` (Awaiting confirmation)");
    expect(description("filter")).toContain("daysAwaitingConfirmation");
    expect(description("sort")).toContain("awaitingConfirmationSince");
    expect(description("sort")).toContain("awaitingConfirmationSince:asc");
  });

  it("should publish no owner identifier on any judicial schema", () => {
    // api keys judicial ownership on the token's IDAM subject — `claimedById` and `decidedById`, added by its
    // `V14__referral_owner_subjects` migration — and publishes neither column. That absence is what makes whose
    // list `/judicial/referrals/mine` returns unforgeable, so it is asserted against the document rather than
    // assumed: a subject appearing on a row would let a page key off it, and a caller ask for a colleague's work.
    const judicial = Object.entries(spec.components.schemas).filter(([name]) => name.startsWith("Judicial"));

    // Counted, so a judicial schema api adds is swept by the loop below rather than silently missed by it.
    expect(judicial.length).toBe(7);
    for (const [name, schema] of judicial) {
      for (const property of Object.keys(schema.properties ?? {})) {
        expect(property, `${name}.${property}`).not.toMatch(/^(claimedById|decidedById|ownerId|subject|userId)$/);
      }
    }
  });

  it("should give the personal list the pool's envelope and the pool's row", () => {
    // Two facts about api's `JudicialMyReferralsResponse`, both load-bearing for `referrals-admin-6`: the page
    // metadata is the pool's, so one paging convention serves both lists, and the ROW is literally
    // `JudicialReferralSummary` rather than a second shape — which is what stops the personal list growing a
    // field the pool does not have, and with it an applicant name the judicial boundary keeps off both.
    const mine = spec.components.schemas.JudicialMyReferralsResponse;

    expect(Object.keys(mine.properties ?? {}).sort()).toEqual(["page", "referrals", "size", "total", "totalPages"]);
    expect(mine.properties?.referrals?.items?.$ref).toBe("#/components/schemas/JudicialReferralSummary");
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
  paths: Record<string, Record<string, OpenApiOperation>>;
  components: {
    schemas: Record<string, OpenApiSchema>;
  };
}

/**
 * Only the parameters, because the query vocabulary is published as their prose and nowhere else.
 *
 * `in` and `required` are read as well as the name: the send's `Idempotency-Key` is the contract's only header
 * parameter, and it being *required* is the whole of what distinguishes api's notify-6 from a header the adapter
 * could omit.
 */
interface OpenApiOperation {
  description?: string;
  responses?: Record<string, unknown>;
  parameters?: { name: string; in?: string; required?: boolean; description?: string; schema?: Record<string, unknown> }[];
}

interface OpenApiSchema {
  required?: string[];
  /**
   * `false` on the two email write bodies — an unknown key is refused and named — `true` on
   * `RecordConfirmationRequest`, where one is ignored, and absent everywhere else.
   */
  additionalProperties?: boolean | Record<string, unknown>;
  properties?: Record<string, { enum?: (string | null)[]; pattern?: string; maxLength?: number; minLength?: number; items?: { $ref?: string } }>;
}
