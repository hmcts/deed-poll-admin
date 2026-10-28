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
import { BANK_HOLIDAY_LIMITS, DOCUMENT_PREVIEW_LIMITS, MASTER_LIMITS, PROCESS_SETTINGS_LIMITS, WINDOW_TIME_PATTERN } from "./client.js";
import deferredContract from "./deferred-contract.json";
import { CAPABILITY, DOCUMENT_PREVIEW_ERROR_CODE, GAZETTE_RECIPIENT_EMAIL_PATTERN, STRICT_RESPONSE_PROPERTIES, WIRE_SCHEMAS } from "./wire.js";

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
  "GET /caseworker/process-settings",
  "PUT /caseworker/process-settings",
  "GET /caseworker/process-settings/bank-holidays",
  "POST /caseworker/process-settings/bank-holidays",
  "DELETE /caseworker/process-settings/bank-holidays/{date}",
  "GET /caseworker/masters",
  "POST /caseworker/masters",
  "PATCH /caseworker/masters/{id}",
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
  "GET /caseworker/cases/{id}/documents/{documentId}/preview",
  "GET /caseworker/cases/{id}/referrals",
  "POST /caseworker/cases/{id}/referrals",
  "GET /caseworker/cases/{id}/referrals/{referralId}",
  "POST /caseworker/cases/{id}/referrals/{referralId}/withdrawal",
  "POST /caseworker/cases/{id}/referrals/{referralId}/closure",
  "POST /caseworker/cases/{id}/referrals/{referralId}/confirmation",
  "PUT /caseworker/cases/{id}/referrals/{referralId}/assignment",
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
  "POST /judicial/referrals/{referralId}/direction",
  "PUT /judicial/referrals/{referralId}/direction",
  "POST /judicial/referrals/{referralId}/direction/withdraw",
  "GET /judicial/referrals/{referralId}/documents/{documentId}/file",
  "GET /judicial/referrals/{referralId}/documents/{documentId}/preview",
  "GET /me"
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

  it("should agree with the spec on every process setting's bounds and the closed process settings write", () => {
    const request = spec.components.schemas.UpdateProcessSettingsRequest;
    expect(request.properties?.referralClaimExpiryMinutes).toMatchObject({
      type: "integer",
      minimum: PROCESS_SETTINGS_LIMITS.minProcessingMinutes,
      maximum: PROCESS_SETTINGS_LIMITS.maxProcessingMinutes
    });
    expect(request.properties?.reminderIntervalHours).toMatchObject({
      type: "integer",
      minimum: PROCESS_SETTINGS_LIMITS.minReminderHours,
      maximum: PROCESS_SETTINGS_LIMITS.maxReminderHours
    });
    expect(request.properties?.masterWindowCap).toMatchObject({
      type: "integer",
      minimum: PROCESS_SETTINGS_LIMITS.minMasterWindowCap,
      maximum: PROCESS_SETTINGS_LIMITS.maxMasterWindowCap
    });
    for (const name of ["morningWindowStart", "morningWindowEnd", "afternoonWindowStart", "afternoonWindowEnd"]) {
      expect(request.properties?.[name]?.pattern, name).toBe(WINDOW_TIME_PATTERN);
      expect(spec.components.schemas.ProcessSettingsResponse.properties?.[name]?.pattern, name).toBe(WINDOW_TIME_PATTERN);
    }
    expect(request.properties?.revision).toMatchObject({ type: "integer", minimum: 0 });
    // Only these two for one release: an absent setting keeps api's stored value.
    expect(request.required?.toSorted()).toEqual(["referralClaimExpiryMinutes", "revision"]);
    expect(request.additionalProperties).toBe(false);
    const write = WIRE_SCHEMAS.UpdateProcessSettingsRequest;
    const full = {
      referralClaimExpiryMinutes: 10080,
      reminderIntervalHours: 48,
      masterWindowCap: 10,
      morningWindowStart: "07:00",
      morningWindowEnd: "10:30",
      afternoonWindowStart: "14:00",
      afternoonWindowEnd: "14:30",
      revision: 0
    };
    expect(write.safeParse(full).success).toBe(true);
    expect(write.safeParse({ referralClaimExpiryMinutes: 1440, revision: 0 }).success).toBe(true);
    expect(write.safeParse({ referralClaimExpiryMinutes: 43200, revision: 3 }).success).toBe(true);
    expect(write.safeParse({ ...full, reminderIntervalHours: 1, masterWindowCap: 100, morningWindowStart: "00:00", afternoonWindowEnd: "23:45" }).success).toBe(
      true
    );
    for (const change of [
      { referralClaimExpiryMinutes: 1439 },
      { referralClaimExpiryMinutes: 43201 },
      { referralClaimExpiryMinutes: 1440.5 },
      { referralClaimExpiryMinutes: "1440" },
      { referralClaimExpiryMinutes: null },
      { reminderIntervalHours: 0 },
      { reminderIntervalHours: 169 },
      { reminderIntervalHours: null },
      { masterWindowCap: 0 },
      { masterWindowCap: 101 },
      { morningWindowStart: "07:10" },
      { morningWindowStart: "7:00" },
      { afternoonWindowEnd: "24:00" },
      { afternoonWindowStart: null },
      { revision: -1 },
      { updatedBy: "forged" }
    ]) {
      expect(write.safeParse({ ...full, ...change }).success, JSON.stringify(change)).toBe(false);
    }
    expect(write.safeParse({ referralClaimExpiryMinutes: 1440 }).success).toBe(false);
    for (const operation of [spec.paths["/caseworker/process-settings"].get, spec.paths["/caseworker/process-settings"].put]) {
      expect(operation.responses).toMatchObject({ "200": { content: { "*/*": { schema: { $ref: "#/components/schemas/ProcessSettingsResponse" } } } } });
    }
  });

  it("should agree with the spec on the Masters list's writes", () => {
    const create = spec.components.schemas.CreateMasterRequest;
    const update = spec.components.schemas.UpdateMasterRequest;
    for (const body of [create, update]) {
      expect(body.additionalProperties).toBe(false);
      expect(body.properties?.name).toMatchObject({ minLength: 1, maxLength: MASTER_LIMITS.maxNameLength });
      expect(body.properties?.email).toMatchObject({ maxLength: MASTER_LIMITS.maxEmailLength });
    }
    expect(create.required?.toSorted()).toEqual(["email", "name"]);
    expect(update.required).toEqual(["revision"]);
    expect(update.minProperties).toBe(2);
    expect(update.properties?.revision).toMatchObject({ type: "integer", minimum: 0 });
    // The linked IDAM account is api's alone: no response or write may carry it.
    for (const name of ["MasterResponse", "CreateMasterRequest", "UpdateMasterRequest"]) {
      for (const field of ["subject", "idamId", "userId", "linkedSubject"]) {
        expect(Object.keys(spec.components.schemas[name].properties ?? {}), name).not.toContain(field);
      }
    }
    expect(WIRE_SCHEMAS.CreateMasterRequest.safeParse({ name: "Master Sullivan", email: "sullivan@example.test" }).success).toBe(true);
    expect(WIRE_SCHEMAS.CreateMasterRequest.safeParse({ name: "  ", email: "sullivan@example.test" }).success).toBe(false);
    expect(WIRE_SCHEMAS.CreateMasterRequest.safeParse({ name: "x".repeat(201), email: "sullivan@example.test" }).success).toBe(false);
    expect(WIRE_SCHEMAS.CreateMasterRequest.safeParse({ name: "M", email: "x".repeat(321) }).success).toBe(false);
    expect(WIRE_SCHEMAS.CreateMasterRequest.safeParse({ name: "M", email: "m@example.test", linked: true }).success).toBe(false);
    expect(WIRE_SCHEMAS.UpdateMasterRequest.safeParse({ available: false, revision: 0 }).success).toBe(true);
    expect(WIRE_SCHEMAS.UpdateMasterRequest.safeParse({ revision: 0 }).success).toBe(false);
    expect(WIRE_SCHEMAS.UpdateMasterRequest.safeParse({ available: false }).success).toBe(false);
    expect(spec.paths["/caseworker/masters"].post.responses?.["201"]).toBeDefined();
  });

  it("should agree with the spec on the bank holidays' write and removal", () => {
    const create = spec.components.schemas.CreateBankHolidayRequest;
    expect(create.additionalProperties).toBe(false);
    expect(create.required?.toSorted()).toEqual(["date", "name"]);
    expect(create.properties?.date).toMatchObject({ type: "string", format: "date" });
    expect(create.properties?.name).toMatchObject({ minLength: 1, maxLength: BANK_HOLIDAY_LIMITS.maxNameLength });
    expect(spec.components.schemas.BankHolidayResponse.properties?.date).toMatchObject({ type: "string", format: "date" });
    expect(WIRE_SCHEMAS.CreateBankHolidayRequest.safeParse({ date: "2026-12-25", name: "Christmas Day" }).success).toBe(true);
    for (const body of [
      { date: "25-12-2026", name: "Christmas Day" },
      { date: "2026-02-30", name: "Not a day" },
      { date: "2026-12-25", name: " " },
      { date: "2026-12-25", name: "x".repeat(201) },
      { date: "2026-12-25" }
    ]) {
      expect(WIRE_SCHEMAS.CreateBankHolidayRequest.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
    expect(spec.paths["/caseworker/process-settings/bank-holidays"].post.responses?.["201"]).toBeDefined();
    expect(spec.paths["/caseworker/process-settings/bank-holidays/{date}"].delete.responses?.["204"]).toBeDefined();
  });

  it("should publish api D2's assignment: masterId on the raise, the assignment write and its refusals", () => {
    expect(spec.components.schemas.CreateReferralRequest.properties?.masterId).toMatchObject({ type: "string", format: "uuid" });
    expect(spec.components.schemas.CreateReferralRequest.required).toEqual(["reasons"]);
    expect(spec.components.schemas.AssignReferralRequest.required).toEqual(["masterId"]);
    expect(spec.components.schemas.AssignReferralRequest.additionalProperties).toBe(true);
    const assign = spec.paths["/caseworker/cases/{id}/referrals/{referralId}/assignment"].put;
    expect(Object.keys(assign.responses ?? {}).sort()).toEqual(["200", "400", "403", "409"]);
    expect(spec.paths["/caseworker/cases/{id}/referrals"].post.responses?.["409"]).toBeDefined();
    expect(spec.paths["/caseworker/masters"].get.responses?.["200"]).toMatchObject({
      content: { "*/*": { schema: { $ref: "#/components/schemas/MasterListResponse" } } }
    });
    expect(WIRE_SCHEMAS.CreateReferralRequest.safeParse({ reasons: ["Minor"], masterId: "sullivan" }).success).toBe(false);
    expect(WIRE_SCHEMAS.AssignReferralRequest.safeParse({}).success).toBe(false);
  });

  it("should mark the former pool and the claim deprecated, kept for api's one release", () => {
    expect(spec.paths["/judicial/referrals"].get.deprecated).toBe(true);
    expect(spec.paths["/judicial/referrals/{referralId}/claim"].post.deprecated).toBe(true);
  });

  it("should publish no Master's subject or email on a referral, only the entry's id and name", () => {
    expect(Object.keys(spec.components.schemas.AssignedMasterResponse.properties ?? {}).sort()).toEqual(["id", "name"]);
    for (const name of ["ReferralResponse", "JudicialReferralSummary", "JudicialReferralDetail"]) {
      for (const field of ["assignedMasterId", "assignedMasterEmail", "claimedById"]) {
        expect(Object.keys(spec.components.schemas[name].properties ?? {}), name).not.toContain(field);
      }
    }
  });

  it("should no longer declare api's retired publishToGazette alias on any referral schema", () => {
    for (const name of ["ReferralResponse", "JudicialReferralDetail", "JudicialDirectionRequest"]) {
      expect(Object.keys(spec.components.schemas[name].properties ?? {}), name).not.toContain("publishToGazette");
    }
  });

  it("should publish the capability members in api's declaration order", () => {
    // Array items, so the property enum comparison below does not reach them. Order is pinned as well as
    // membership because api promises declaration order and the mock reproduces it.
    expect(spec.components.schemas.CallerAccessResponse.properties?.capabilities?.items?.enum).toEqual([...CAPABILITY]);
    expect(spec.components.schemas.CallerAccessResponse.required?.toSorted()).toEqual(["capabilities", "judicial", "staff"]);
  });

  it("should describe exactly the consumed and explicitly deferred schemas", () => {
    const inSpec = Object.keys(spec.components.schemas).sort();
    const inCode = [...Object.keys(WIRE_SCHEMAS), ...Object.keys(deferredContract.schemas)].sort();

    expect(inCode).toEqual(inSpec);
  });

  /**
   * api's 403 contract (`OpenAPIForbiddenResponses`): every staff operation documents the refusal, through one shared
   * response whose body is the `ApiError` this adapter already parses. `GET /` is public and `GET /me` admits any
   * signed-in caller, so neither may gain one. Checked on the copy rather than trusted from api, because a refresh that
   * dropped the 403 from some operations would otherwise pass every other test here.
   */
  describe("the documented 403", () => {
    const FORBIDDEN = { $ref: "#/components/responses/Forbidden" };
    const UNREFUSABLE = ["GET /", "GET /me"];
    const operations = Object.entries(spec.paths).flatMap(([route, methods]) =>
      Object.entries(methods).map(([method, operation]) => ({ key: `${method.toUpperCase()} ${route}`, operation }))
    );

    it("should reference the shared Forbidden response on every operation but the two that cannot refuse", () => {
      const refusable = operations.filter(({ key }) => !UNREFUSABLE.includes(key));

      expect(refusable.length).toBeGreaterThan(0);
      for (const { key, operation } of refusable) {
        expect(operation.responses?.["403"], key).toEqual(FORBIDDEN);
      }
      for (const key of UNREFUSABLE) {
        const operation = operations.find((each) => each.key === key)?.operation;
        expect(operation, key).toBeDefined();
        expect(operation?.responses?.["403"], key).toBeUndefined();
      }
    });

    it("should describe the refusal as an application/json ApiError whose references all resolve", () => {
      const forbidden = spec.components.responses?.Forbidden;

      expect(forbidden?.description?.trim()).toBeTruthy();
      expect(Object.keys(forbidden?.content ?? {})).toEqual(["application/json"]);
      expect(forbidden?.content?.["application/json"]?.schema).toEqual({ $ref: "#/components/schemas/ApiError" });
      expect(spec.components.schemas.ApiError.properties?.errors?.items?.$ref).toBe("#/components/schemas/FieldError");
      expect(spec.components.schemas.FieldError).toBeDefined();
    });

    it("should keep GET / public and GET /me on the global bearer requirement", () => {
      // The global requirement itself, or "no override" would also pass a document that had stopped requiring auth.
      expect(spec.security).toEqual([{ bearerAuth: [] }]);
      expect(spec.components.securitySchemes?.bearerAuth).toMatchObject({ type: "http", scheme: "bearer" });
      expect(spec.paths["/"].get.security).toEqual([]);
      expect(spec.paths["/me"].get.security).toBeUndefined();
    });
  });

  /**
   * The two preview operations (api PR #129): what the adapter relies on and what the viewer will. Read from both
   * operations, because a refresh that changed one and not the other would make the judicial viewer different.
   */
  describe("the document previews", () => {
    const previews = [
      spec.paths["/caseworker/cases/{id}/documents/{documentId}/preview"]?.get,
      spec.paths["/judicial/referrals/{referralId}/documents/{documentId}/preview"]?.get
    ];

    it("should publish both, as complete PDFs with the download's containment headers and no ranges", () => {
      for (const operation of previews) {
        const ok = operation?.responses?.["200"] as { content?: Record<string, unknown>; headers?: Record<string, unknown> } | undefined;
        expect(Object.keys(ok?.content ?? {})).toEqual(["application/pdf"]);
        expect(Object.keys(ok?.headers ?? {}).sort()).toEqual([
          "Accept-Ranges",
          "Cache-Control",
          "Content-Disposition",
          "Content-Length",
          "Content-Security-Policy",
          "X-Content-Type-Options"
        ]);
        expect(operation?.["x-document-preview-limits"]?.rangeRequests).toBe("unsupported");
      }
    });

    it("should publish each refusal code on exactly the status the adapter accepts it from", () => {
      const codesByStatus = (operation: OpenApiOperation | undefined) =>
        Object.fromEntries(
          ["422", "429", "503"].map((status) => {
            const response = operation?.responses?.[status] as { description?: string; content?: Record<string, { schema?: { $ref?: string } }> };
            expect(response.content?.["application/json"]?.schema?.$ref).toBe("#/components/schemas/DocumentPreviewError");
            return [status, DOCUMENT_PREVIEW_ERROR_CODE.filter((code) => response.description?.includes(code))];
          })
        );

      for (const operation of previews) {
        expect(codesByStatus(operation)).toEqual({
          "422": ["PREVIEW_INVALID_DOCUMENT", "PREVIEW_LIMIT_EXCEEDED"],
          "429": ["PREVIEW_BUSY"],
          "503": ["PREVIEW_UNAVAILABLE"]
        });
        expect(Object.keys((operation?.responses?.["429"] as { headers?: object } | undefined)?.headers ?? {})).toContain("Retry-After");
      }
      expect(spec.components.schemas.DocumentPreviewError.properties?.code?.enum).toEqual([...DOCUMENT_PREVIEW_ERROR_CODE]);
    });

    it("should agree with the published limits the adapter and the viewer enforce", () => {
      for (const operation of previews) {
        const limits = operation?.["x-document-preview-limits"];
        expect(limits?.maxOutputBytes).toBe(DOCUMENT_PREVIEW_LIMITS.maxOutputBytes);
        expect(limits?.maxPages).toBe(DOCUMENT_PREVIEW_LIMITS.maxPages);
        // The adapter's 27 s wait is chosen against these two: above api's budget, below the gateways' 30 s.
        expect(limits?.requestBudgetSeconds).toBe(25);
        expect(limits?.maxPagesEnforcedByViewerFor).toEqual(["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);
      }
    });
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

  it("should publish api's 429 on exactly the six rate-limited operations", () => {
    // api#113's limits. Admin classifies a 429 as `rate-limited`; a refresh that drops one, or adds one elsewhere,
    // changes which actions can show the too-many-requests page. The two previews' 429 is `PREVIEW_BUSY`, a pod
    // with no permit free rather than the caller's limit, and is pinned with them above.
    const limited = Object.entries(spec.paths)
      .flatMap(([route, methods]) =>
        Object.entries(methods)
          .filter(([, operation]) => (operation as { responses?: Record<string, unknown> }).responses?.["429"] !== undefined)
          .filter(([, operation]) => (operation as OpenApiOperation)["x-document-preview-limits"] === undefined)
          .map(([method]) => `${method.toUpperCase()} ${route}`)
      )
      .sort();

    expect(limited).toEqual([
      "GET /caseworker/cases",
      "POST /caseworker/cases/{id}/documents",
      "POST /caseworker/cases/{id}/emails/{template}",
      "POST /caseworker/cases/{id}/emails/{template}/preview",
      "POST /caseworker/gazette-notice-previews",
      "POST /caseworker/gazette-notices"
    ]);
  });

  it("should publish the Gazette read, paging vocabulary, bounded preview and ready filter", () => {
    const operation = spec.paths["/caseworker/gazette-notices"].get;
    expect(Object.keys(spec.paths["/caseworker/gazette-notices"])).toEqual(["get", "post"]);
    expect(operation.parameters).toEqual([
      { name: "page", in: "query", required: false, schema: { type: "string" }, description: "Page number, starting at 1; defaults to 1." },
      { name: "size", in: "query", required: false, schema: { type: "string" }, description: "Rows per page; defaults to 25 and is capped at 100." }
    ]);
    expect(operation.responses).toEqual({
      "200": { description: "OK", content: { "*/*": { schema: { $ref: "#/components/schemas/GazetteNoticeHistoryResponse" } } } },
      "403": { $ref: "#/components/responses/Forbidden" }
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
      "UpdateProcessSettingsRequest",
      "CreateMasterRequest",
      "UpdateMasterRequest",
      "CreateBankHolidayRequest",
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
      "AssignReferralRequest",
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
    expect(judicial).toHaveLength(7);
    for (const [name, schema] of judicial) {
      for (const property of Object.keys(schema.properties ?? {})) {
        expect(property, `${name}.${property}`).not.toMatch(/^(claimedById|decidedById|ownerId|subject|userId)$/);
      }
    }
  });

  it("should publish the judicial application view with no payment, refund, fee, case id, contact or witness", () => {
    // Narrowed in api on 2026-10-27 (Master Sullivan's feedback): a Master sees the names, type, nationality, a
    // minor's parents and the documents. The set comparison above would pass a field api added at both ends, so the
    // exclusions are asserted by name against the document.
    const view = Object.keys(spec.components.schemas.JudicialApplicationView.properties ?? {});

    for (const property of view) {
      expect(property).not.toMatch(
        /^(id|caseId|referencenumber|witnesses|privacy|state)$|fee|payment|refund|onlineApplicationReference|applicant|representative/i
      );
    }
    expect(spec.components.schemas.JudicialApplicationView.properties?.documents?.items?.$ref).toBe("#/components/schemas/JudicialDocument");
    expect(spec.components.schemas.JudicialReferralDetail.properties).not.toHaveProperty("caseNotes");
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
  /** The requirement every operation inherits unless it overrides it. */
  security?: Record<string, string[]>[];
  components: {
    securitySchemes?: Record<string, { type?: string; scheme?: string }>;
    schemas: Record<string, OpenApiSchema>;
    /** Shared responses: today only `Forbidden`, api's documented 403. */
    responses?: Record<string, { description?: string; content?: Record<string, { schema?: { $ref?: string } }> }>;
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
  /** api D2's former pool and claim, kept for one release. */
  deprecated?: boolean;
  /** Only on the two document previews. */
  "x-document-preview-limits"?: {
    maxOutputBytes?: number;
    maxPages?: number;
    requestBudgetSeconds?: number;
    rangeRequests?: string;
    maxPagesEnforcedByViewerFor?: string[];
  };
  responses?: Record<string, unknown>;
  /** Present only where an operation overrides the global requirement, as `GET /` does with `[]`. */
  security?: Record<string, string[]>[];
  parameters?: { name: string; in?: string; required?: boolean; description?: string; schema?: Record<string, unknown> }[];
}

interface OpenApiSchema {
  required?: string[];
  /**
   * `false` on the two email write bodies — an unknown key is refused and named — `true` on
   * `RecordConfirmationRequest`, where one is ignored, and absent everywhere else.
   */
  additionalProperties?: boolean | Record<string, unknown>;
  minProperties?: number;
  properties?: Record<
    string,
    { enum?: (string | null)[]; pattern?: string; maxLength?: number; minLength?: number; items?: { $ref?: string; enum?: string[] } }
  >;
}
