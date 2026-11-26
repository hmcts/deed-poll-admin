/**
 * Permanent document deletion (api#179): the two operations against the in-memory mock, which restates api's staff
 * gate, admission order, replay, fence, completion note and status, and against a server of its own for the answers
 * the mock's contract cannot produce.
 */
import { createServer } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type RunningMockApi, startMockApi } from "../mock/server.js";
import {
  type ApiConfig,
  type DocumentDeletionCreate,
  downloadDocument,
  getCase,
  getDocumentDeletion,
  requestApplicationDeletion,
  requestDocumentDeletion,
  uploadDocument
} from "./client.js";

const KEY = "6f1c2a4e-8b3d-4f5a-9c7e-1d2b3a4c5d6e";
const OTHER_KEY = "0b7c3f9e-2d4a-4c1b-8e5f-6a7b8c9d0e1f";
const REASON = "Uploaded in error";
const DOCUMENT_TYPE_ID = "11111111-1111-4111-8111-111111111111";
const STAFF = [
  ["caseworker", ["caseworker-deedpoll"]],
  ["Team leader", ["caseworker-deedpoll-team-leader"]],
  ["Delivery Manager", ["caseworker-deedpoll-delivery-manager"]],
  ["legacy admin", ["caseworker-deedpoll-admin"]]
] as const;

let mock: RunningMockApi;
let config: ApiConfig;

beforeAll(async () => {
  mock = await startMockApi();
  config = { baseUrl: mock.url, timeoutMs: 2000, accessToken: roleToken("cw-1", ["caseworker-deedpoll"], "Casey Worker") };
});

afterAll(async () => {
  await mock.close();
});

beforeEach(() => {
  mock.setScenario("happy-path");
  mock.reset();
});

describe("the case detail's documentVersion", () => {
  it("should publish version 1 on a freshly uploaded document", async () => {
    // Arrange
    const id = seedCase();

    // Act
    const documentId = await upload(id, "birth-certificate.pdf");
    const detail = await getCase(id, config);

    // Assert
    expect(detail.ok && detail.data.documents.find((document) => document.id === documentId)?.documentVersion).toBe(1);
  });
});

describe("requestDocumentDeletion against the mock", () => {
  it.each(STAFF)("should let a %s delete a document at once, leave its siblings, and write api's note under them", async (_persona, roles) => {
    // Arrange
    const id = seedCase();
    const doomed = await upload(id, "wrong-file.pdf");
    const kept = await upload(id, "passport.pdf");
    const staff = { ...config, accessToken: roleToken("staff-1", [...roles], "Sam Staff") };

    // Act
    const result = await requestDocumentDeletion(id, doomed, await body(id, doomed), KEY, staff);

    // Assert
    expect(result.ok && result.data.status).toBe("Completed");
    const detail = await getCase(id, config);
    if (!detail.ok) throw new Error("the case should still be readable");
    expect(detail.data.documents.map((document) => document.id)).toEqual([kept]);
    const note = detail.data.notes.at(-1);
    expect(note?.note).toBe(`Document wrong-file.pdf (${doomed}) permanently deleted. Reason: ${REASON}`);
    expect(note?.createdBy).toBe("Sam Staff");
    expect((await downloadDocument(id, doomed, config)).ok).toBe(false);
  });

  it("should answer 200 Completed with no Location, and no-store", async () => {
    // Arrange
    const id = seedCase();
    const documentId = await upload(id, "wrong-file.pdf");

    // Act
    const response = await rawAdmission(id, documentId, JSON.stringify(await body(id, documentId)));

    // Assert
    const answer = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(Object.keys(answer).sort()).toEqual(["requestId", "status"]);
  });

  it("should refuse a judge on both routes before reading anything, however malformed, and leave the document", async () => {
    // Arrange
    const id = seedCase();
    const documentId = await upload(id, "wrong-file.pdf");
    const judge = { ...config, accessToken: roleToken("judge-1", ["caseworker-deedpoll-judicial"]) };

    // Act
    const admitted = await requestDocumentDeletion(id, documentId, { reason: "", expectedDocumentVersion: 0 }, "not-a-key", judge);
    const status = await getDocumentDeletion(id, "not-a-uuid", judge);

    // Assert
    for (const result of [admitted, status]) expect(result.ok === false && result.error.kind).toBe("forbidden");
    const detail = await getCase(id, config);
    expect(detail.ok && detail.data.documents.map((document) => document.id)).toEqual([documentId]);
  });

  it("should refuse an anonymous caller with 401", async () => {
    // Act
    const result = await getDocumentDeletion("case-1", KEY, { baseUrl: mock.url });

    // Assert
    expect(result.ok === false && result.error.kind).toBe("unauthorized");
  });

  it("should refuse a malformed key, a blank reason and a missing version together, naming each, and write nothing", async () => {
    // Arrange
    const id = seedCase();
    const documentId = await upload(id, "wrong-file.pdf");

    // Act
    const malformed = await requestDocumentDeletion(id, documentId, { reason: "   ", expectedDocumentVersion: 0 }, "6f1c2a4e8b3d4f5a9c7e1d2b3a4c5d6e", config);
    const missing = await rawAdmission(id, documentId, JSON.stringify(await body(id, documentId)), { key: null });

    // Assert
    expect(malformed.ok === false && malformed.error.kind).toBe("validation");
    expect(malformed.ok === false && malformed.error.fieldErrors).toEqual([
      { field: "Idempotency-Key", message: "Send a UUID Idempotency-Key with a document deletion request" },
      { field: "reason", message: "Enter why this document is being deleted" },
      { field: "expectedDocumentVersion", message: "Send the document's documentVersion, as you reviewed it" }
    ]);
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { errors: { field: string }[] }).errors.map((error) => error.field)).toEqual(["Idempotency-Key"]);
    expect(await documentIds(id)).toEqual([documentId]);
  });

  it.each([
    ["a line break", "Uploaded\nin error"],
    ["a tab", "Uploaded\tin error"],
    ["a bidirectional control", "Uploaded \u202ein error"],
    ["a line separator", "Uploaded\u2028in error"],
    ["a lone surrogate", "Uploaded \ud800 in error"]
  ])("should refuse a reason containing %s, without repeating it", async (_what, reason) => {
    // Arrange
    const id = seedCase();
    const documentId = await upload(id, "wrong-file.pdf");

    // Act
    const result = await requestDocumentDeletion(id, documentId, { reason, expectedDocumentVersion: 1 }, KEY, config);

    // Assert
    expect(result.ok === false && result.error.fieldErrors).toEqual([
      { field: "reason", message: "The reason for deletion must not contain line breaks, tabs or control characters" }
    ]);
  });

  it("should count the reason in code points after stripping its ends, so 500 emoji pass and 501 do not", async () => {
    // Arrange
    const id = seedCase();
    const first = await upload(id, "first.pdf");
    const second = await upload(id, "second.pdf");

    // Act
    const tooLong = await requestDocumentDeletion(id, first, { reason: "😀".repeat(501), expectedDocumentVersion: 1 }, KEY, config);
    const atLimit = await requestDocumentDeletion(id, second, { reason: `  ${"😀".repeat(500)}  `, expectedDocumentVersion: 1 }, OTHER_KEY, config);

    // Assert
    expect(tooLong.ok === false && tooLong.error.fieldErrors).toEqual([
      { field: "reason", message: "The reason for deletion must be 500 characters or fewer" }
    ]);
    expect(atLimit.ok && atLimit.data.status).toBe("Completed");
  });

  it("should read a version that is not a JSON integer as no version, and refuse an unknown key without echoing it", async () => {
    // Arrange
    const id = seedCase();
    const documentId = await upload(id, "wrong-file.pdf");

    // Act
    const asText = await rawAdmission(id, documentId, JSON.stringify({ reason: REASON, expectedDocumentVersion: "1" }));
    const asFraction = await rawAdmission(id, documentId, `{"reason":"${REASON}","expectedDocumentVersion":1.0}`);
    const extra = await rawAdmission(id, documentId, JSON.stringify({ reason: REASON, expectedDocumentVersion: 1, requestedBy: "forged-admin" }));
    const empty = await rawAdmission(id, documentId, "");
    const form = await rawAdmission(id, documentId, "reason=x", { contentType: "application/x-www-form-urlencoded" });
    const huge = await rawAdmission(id, documentId, JSON.stringify({ reason: "x".repeat(17 * 1024), expectedDocumentVersion: 1 }));

    // Assert
    for (const response of [asText, asFraction]) {
      expect(response.status).toBe(400);
      expect(((await response.json()) as { errors: { field: string }[] }).errors.map((error) => error.field)).toEqual(["expectedDocumentVersion"]);
    }
    const extraText = await extra.text();
    expect(extra.status).toBe(400);
    expect(extraText).not.toContain("forged-admin");
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as { errors: { field: string }[] }).errors.map((error) => error.field)).toEqual(["reason", "expectedDocumentVersion"]);
    expect(form.status).toBe(415);
    expect(huge.status).toBe(413);
    expect(await documentIds(id)).toEqual([documentId]);
  });

  it("should answer 404 for an unknown case, an unknown document, and another case's document", async () => {
    // Arrange
    const id = seedCase();
    const other = seedCase();
    const othersDocument = await upload(other, "theirs.pdf");

    // Act
    const noCase = await requestDocumentDeletion("no-such-case", othersDocument, { reason: REASON, expectedDocumentVersion: 1 }, KEY, config);
    const noDocument = await requestDocumentDeletion(id, "no-such-document", { reason: REASON, expectedDocumentVersion: 1 }, KEY, config);
    const wrongParent = await requestDocumentDeletion(id, othersDocument, { reason: REASON, expectedDocumentVersion: 1 }, KEY, config);

    // Assert
    for (const result of [noCase, noDocument, wrongParent]) expect(result.ok === false && result.error.kind).toBe("not-found");
    expect(await documentIds(other)).toEqual([othersDocument]);
  });

  it("should address ids with reserved characters as one encoded segment each, and refuse dot segments without sending", async () => {
    // Arrange
    const id = seedCase();
    const documentId = await upload(id, "wrong-file.pdf");

    // Act
    const slashed = await requestDocumentDeletion(id, `${documentId}/file`, { reason: REASON, expectedDocumentVersion: 1 }, KEY, config);
    const dotted = await requestDocumentDeletion(id, "..", { reason: REASON, expectedDocumentVersion: 1 }, KEY, config);
    const status = await getDocumentDeletion("..", KEY, config);

    // Assert
    expect(slashed.ok === false && slashed.error.kind).toBe("not-found");
    expect(dotted.ok === false && dotted.error.kind).toBe("not-found");
    expect(status.ok === false && status.error.kind).toBe("not-found");
    expect(await documentIds(id)).toEqual([documentId]);
  });

  it("should refuse a version other than the one reviewed with DOCUMENT_CHANGED and write nothing", async () => {
    // Arrange
    const id = seedCase();
    const documentId = await upload(id, "wrong-file.pdf");

    // Act
    const result = await requestDocumentDeletion(id, documentId, { reason: REASON, expectedDocumentVersion: 2 }, KEY, config);

    // Assert
    expect(result.ok === false && result.error).toMatchObject({ kind: "conflict", status: 409, code: "DOCUMENT_CHANGED" });
    expect(await documentIds(id)).toEqual([documentId]);
  });

  it.each(["DOCUMENT_IN_USE", "DOCUMENT_STORAGE_UNRESOLVED", "DOCUMENT_SHARED", "APPLICATION_DELETION_PENDING"] as const)(
    "should carry a forced %s refusal's code and api's words, and leave the document usable",
    async (code) => {
      // Arrange
      const id = seedCase();
      const documentId = await upload(id, "wrong-file.pdf");
      await outcome({ refuseAdmission: code });

      // Act
      const refused = await requestDocumentDeletion(id, documentId, await body(id, documentId), KEY, config);
      const retried = await requestDocumentDeletion(id, documentId, await body(id, documentId), KEY, config);

      // Assert
      expect(refused.ok === false && refused.error).toMatchObject({ kind: "conflict", status: 409, code });
      expect(retried.ok && retried.data.status).toBe("Completed");
    }
  );

  it("should give the in-use refusal the sentence the confirmation page shows", async () => {
    // Arrange
    const id = seedCase();
    const documentId = await upload(id, "wrong-file.pdf");
    await outcome({ refuseAdmission: "DOCUMENT_IN_USE" });

    // Act
    const response = await rawAdmission(id, documentId, JSON.stringify(await body(id, documentId)));

    // Assert
    expect(await response.json()).toEqual({
      code: "DOCUMENT_IN_USE",
      error: "This document is currently being used and cannot be deleted. Try again once the operation has finished."
    });
  });

  it("should answer an exact replay with the same request after the document is gone, and refuse the key with a different body", async () => {
    // Arrange
    const id = seedCase();
    const documentId = await upload(id, "wrong-file.pdf");
    const reviewed = await body(id, documentId);
    const first = await requestDocumentDeletion(id, documentId, reviewed, KEY, config);

    // Act
    const replay = await requestDocumentDeletion(id, documentId, reviewed, KEY, config);
    const changedReason = await requestDocumentDeletion(id, documentId, { ...reviewed, reason: "A duplicate" }, KEY, config);
    const changedVersion = await requestDocumentDeletion(id, documentId, { ...reviewed, expectedDocumentVersion: 2 }, KEY, config);

    // Assert
    expect(first.ok && replay.ok && replay.data).toEqual(first.ok && first.data);
    for (const result of [changedReason, changedVersion]) {
      expect(result.ok === false && result.error).toMatchObject({ kind: "conflict", code: "KEY_REUSED" });
    }
    const detail = await getCase(id, config);
    expect(detail.ok && detail.data.notes.filter((note) => note.note.includes(documentId))).toHaveLength(1);
  });

  it("should answer another key's identical request with the first, and another body for that document as 404", async () => {
    // Arrange
    const id = seedCase();
    const documentId = await upload(id, "wrong-file.pdf");
    const reviewed = await body(id, documentId);
    const first = await requestDocumentDeletion(id, documentId, reviewed, KEY, config);

    // Act
    const sameBody = await requestDocumentDeletion(id, documentId, reviewed, OTHER_KEY, config);
    const otherBody = await requestDocumentDeletion(id, documentId, { ...reviewed, reason: "A duplicate" }, OTHER_KEY, config);

    // Assert
    expect(sameBody.ok && sameBody.data.requestId).toBe(first.ok && first.data.requestId);
    expect(otherBody.ok === false && otherBody.error.kind).toBe("not-found");
  });

  it("should answer 202 with the status resource for an unconfirmed outcome, hide the document at once, and note only on completion", async () => {
    // Arrange
    const id = seedCase();
    const documentId = await upload(id, "wrong-file.pdf");
    await outcome({ admissionOutcome: "InProgress" });

    // Act
    const response = await rawAdmission(id, documentId, JSON.stringify(await body(id, documentId)));
    const answer = (await response.json()) as { requestId: string; status: string };
    const pending = await getDocumentDeletion(id, answer.requestId, config);
    const hidden = await getCase(id, config);
    await control({ requestId: answer.requestId, status: "Completed" });
    const done = await getDocumentDeletion(id, answer.requestId, config);

    // Assert
    expect(response.status).toBe(202);
    expect(answer.status).toBe("InProgress");
    expect(response.headers.get("location")).toBe(`/caseworker/cases/${id}/document-deletions/${answer.requestId}`);
    expect(pending.ok && pending.data).toMatchObject({ requestId: answer.requestId, documentId, status: "InProgress", completedAt: null, failure: null });
    expect(hidden.ok && hidden.data.documents).toEqual([]);
    expect(hidden.ok && hidden.data.notes.some((note) => note.note.includes(documentId))).toBe(false);
    expect(done.ok && done.data.status).toBe("Completed");
    expect(done.ok && done.data.completedAt).toBeInstanceOf(Date);
    const after = await getCase(id, config);
    expect(after.ok && after.data.notes.filter((note) => note.note.includes(documentId))).toHaveLength(1);
  });

  it("should publish a NeedsAttention request's failure, and only then", async () => {
    // Arrange
    const id = seedCase();
    const documentId = await upload(id, "wrong-file.pdf");
    await outcome({ admissionOutcome: "NeedsAttention", failure: "CDAM_PERMISSION" });

    // Act
    const admitted = await requestDocumentDeletion(id, documentId, await body(id, documentId), KEY, config);
    const status = admitted.ok ? await getDocumentDeletion(id, admitted.data.requestId, config) : null;

    // Assert
    expect(admitted.ok && admitted.data.status).toBe("NeedsAttention");
    expect(status?.ok && status.data).toMatchObject({ status: "NeedsAttention", failure: "CDAM_PERMISSION" });
  });

  it("should drop the connection after admitting when told to, so a replay of the same request is how its outcome is learned", async () => {
    // Arrange
    const id = seedCase();
    const documentId = await upload(id, "wrong-file.pdf");
    const reviewed = await body(id, documentId);
    await outcome({ loseAdmissionResponse: true });

    // Act
    const lost = await requestDocumentDeletion(id, documentId, reviewed, KEY, config);
    const replay = await requestDocumentDeletion(id, documentId, reviewed, KEY, config);

    // Assert
    expect(lost.ok).toBe(false);
    expect(replay.ok && replay.data.status).toBe("Completed");
  });

  it("should refuse an application deletion while one of its documents' deletions is unconfirmed", async () => {
    // Arrange
    const id = seedCase();
    const documentId = await upload(id, "wrong-file.pdf");
    await outcome({ admissionOutcome: "InProgress" });
    await requestDocumentDeletion(id, documentId, await body(id, documentId), KEY, config);
    const manager = { ...config, accessToken: roleToken("dm-1", ["caseworker-deedpoll-delivery-manager"]) };
    const detail = await getCase(id, config);
    const lastChangedOn = detail.ok ? String(detail.data.lastChangedOn) : "";

    // Act
    const result = await requestApplicationDeletion(
      id,
      { reason: "DUPLICATE", note: "A duplicate of another", expectedLastChangedOn: lastChangedOn },
      OTHER_KEY,
      manager
    );

    // Assert
    expect(result.ok === false && result.error).toMatchObject({ kind: "conflict", code: "DOCUMENT_DELETION_UNRESOLVED" });
  });
});

describe("getDocumentDeletion against the mock", () => {
  it("should answer 404 for a request read under another case, a non-UUID id, or an unknown case", async () => {
    // Arrange
    const id = seedCase();
    const other = seedCase();
    const documentId = await upload(id, "wrong-file.pdf");
    const admitted = await requestDocumentDeletion(id, documentId, await body(id, documentId), KEY, config);
    const requestId = admitted.ok ? admitted.data.requestId : "";

    // Act
    const results = [
      await getDocumentDeletion(other, requestId, config),
      await getDocumentDeletion(id, "not-a-uuid", config),
      await getDocumentDeletion("no-such-case", requestId, config)
    ];

    // Assert
    for (const result of results) expect(result.ok === false && result.error.kind).toBe("not-found");
    expect((await getDocumentDeletion(id, requestId.toUpperCase(), config)).ok).toBe(true);
  });

  it("should carry no reason, name or requester on the status", async () => {
    // Arrange
    const id = seedCase();
    const documentId = await upload(id, "wrong-file.pdf");
    const admitted = await requestDocumentDeletion(id, documentId, await body(id, documentId), KEY, config);

    // Act
    const response = await fetch(`${mock.url}/caseworker/cases/${id}/document-deletions/${admitted.ok ? admitted.data.requestId : ""}`, {
      headers: { authorization: `Bearer ${config.accessToken}` }
    });

    // Assert
    const text = await response.text();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(text).not.toContain(REASON);
    expect(text).not.toContain("wrong-file.pdf");
    expect(text).not.toContain("Casey Worker");
  });

  it("should answer 404 once the whole application is deleted, which is not evidence about the document", async () => {
    // Arrange
    const id = seedCase();
    const documentId = await upload(id, "wrong-file.pdf");
    const admitted = await requestDocumentDeletion(id, documentId, await body(id, documentId), KEY, config);
    const manager = { ...config, accessToken: roleToken("dm-1", ["caseworker-deedpoll-delivery-manager"]) };
    const detail = await getCase(id, config);
    await requestApplicationDeletion(
      id,
      { reason: "DUPLICATE", note: "A duplicate of another", expectedLastChangedOn: detail.ok ? String(detail.data.lastChangedOn) : "" },
      OTHER_KEY,
      manager
    );

    // Act
    const status = await getDocumentDeletion(id, admitted.ok ? admitted.data.requestId : "", config);

    // Assert
    expect(status.ok === false && status.error.kind).toBe("not-found");
  });

  it("should fail as unavailable during a forced status-read outage", async () => {
    // Arrange
    await outcome({ statusReads: "unavailable" });

    // Act
    const result = await getDocumentDeletion("case-1", KEY, config);

    // Assert
    expect(result.ok === false && result.error.kind).toBe("unavailable");
  });
});

describe("the mock's document deletion controls", () => {
  it("should refuse a NeedsAttention outcome without its failure, a failure without it, and moving a Completed request", async () => {
    // Arrange
    const id = seedCase();
    const documentId = await upload(id, "wrong-file.pdf");
    const admitted = await requestDocumentDeletion(id, documentId, await body(id, documentId), KEY, config);

    // Act
    const statuses = [
      (await post("/__mock/document-deletion-outcome", { admissionOutcome: "NeedsAttention" })).status,
      (await post("/__mock/document-deletion-outcome", { admissionOutcome: "InProgress", failure: "CDAM_PERMISSION" })).status,
      (await post("/__mock/document-deletion-outcome", { refuseAdmission: "KEY_REUSED" })).status,
      (await post("/__mock/document-deletions", { requestId: admitted.ok ? admitted.data.requestId : "", status: "InProgress" })).status,
      (await post("/__mock/document-deletions", { requestId: KEY, status: "Completed" })).status
    ];

    // Assert
    expect(statuses).toEqual([400, 400, 400, 409, 404]);
  });
});

describe("a document deletion 409 without a published code", () => {
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const server = createServer((req, res) => {
      req.resume();
      res.writeHead(409, { "content-type": "application/json" });
      // An application deletion's code is not a document deletion's, so it is not carried either.
      res.end(JSON.stringify(req.url?.includes("other") ? { error: "Refused", code: "STALE_CONFIRMATION" } : { error: "Refused" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address && typeof address === "object" ? address.port : 0}`;
    close = () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  afterAll(() => close());

  it("should stay a plain conflict with no code, so a page answers it with its own generic refusal", async () => {
    // Act
    const plain = await requestDocumentDeletion("case-1", "document-1", { reason: REASON, expectedDocumentVersion: 1 }, KEY, { baseUrl });
    const foreign = await requestDocumentDeletion("case-1", "other", { reason: REASON, expectedDocumentVersion: 1 }, KEY, { baseUrl });

    // Assert
    expect(plain).toEqual({ ok: false, error: { kind: "conflict", status: 409, message: "Refused" } });
    expect(foreign).toEqual({ ok: false, error: { kind: "conflict", status: 409, message: "Refused" } });
  });
});

function seedCase(): string {
  return mock.seed({ newForename: "Alex", newSurname: "Example" }).id;
}

async function upload(caseId: string, name: string): Promise<string> {
  const result = await uploadDocument(caseId, { documentTypeId: DOCUMENT_TYPE_ID, name, mimeType: "application/pdf", bytes: Buffer.from("%PDF-1.4") }, config);
  if (!result.ok) throw new Error(`upload refused: ${result.error.message}`);
  return result.data.id;
}

async function documentIds(caseId: string): Promise<string[]> {
  const detail = await getCase(caseId, config);
  return detail.ok ? detail.data.documents.map((document) => document.id) : [];
}

async function body(caseId: string, documentId: string): Promise<DocumentDeletionCreate> {
  const detail = await getCase(caseId, config);
  const document = detail.ok ? detail.data.documents.find((candidate) => candidate.id === documentId) : undefined;
  if (!document) throw new Error("the case detail did not list the document");
  return { reason: REASON, expectedDocumentVersion: document.documentVersion };
}

function rawAdmission(caseId: string, documentId: string, text: string, options: { key?: string | null; contentType?: string } = {}): Promise<Response> {
  const key = options.key === undefined ? KEY : options.key;
  return fetch(`${mock.url}/caseworker/cases/${encodeURIComponent(caseId)}/documents/${encodeURIComponent(documentId)}/deletion-requests`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.accessToken}`,
      "content-type": options.contentType ?? "application/json",
      ...(key === null ? {} : { "idempotency-key": key })
    },
    body: text
  });
}

function post(path: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${mock.url}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

async function control(body: Record<string, unknown>): Promise<void> {
  const response = await post("/__mock/document-deletions", body);
  if (response.status !== 200) throw new Error(`control refused: ${await response.text()}`);
}

async function outcome(body: Record<string, unknown>): Promise<void> {
  const response = await post("/__mock/document-deletion-outcome", body);
  if (response.status !== 200) throw new Error(`outcome refused: ${await response.text()}`);
}

/** A token the mock reads roles and a display name from, as the application deletion tests build one. */
function roleToken(sub: string, roles: string[], name?: string): string {
  return `x.${Buffer.from(JSON.stringify({ sub, roles, ...(name ? { name } : {}) })).toString("base64url")}.signature`;
}

/**
 * api deletes while the caller waits, so the admission has a longer wait than the JSON default, capped below both
 * Application Gateways' 30 s. The recorded figures pin the constant; the abort itself runs on a clock divided by
 * `CLOCK_SCALE` so a silent server is not twenty real seconds.
 */
const CLOCK_SCALE = 1_000;
const DOCUMENT_DELETION_TIMEOUT_MS = 20_000;

describe("the document deletion admission's timeout, which is longer than the JSON default", () => {
  let armed: number[];

  beforeEach(() => {
    armed = [];
    const realTimeout = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      armed.push(ms);
      return realTimeout(ms / CLOCK_SCALE);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ["no configured timeout", undefined, DOCUMENT_DELETION_TIMEOUT_MS],
    ["a configured timeout longer than its own, because it may only shorten the wait", 60_000, DOCUMENT_DELETION_TIMEOUT_MS],
    ["a configured timeout shorter than its own", 5_000, 5_000]
  ])("should wait the admission's own ceiling or less given %s", async (_label, timeoutMs, expected) => {
    const silent = createServer(() => {});
    await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
    const address = silent.address();
    const baseUrl = typeof address === "object" && address !== null ? `http://127.0.0.1:${address.port}` : "";

    try {
      const result = await requestDocumentDeletion("case-1", "doc-1", { reason: REASON, expectedDocumentVersion: 1 }, KEY, { baseUrl, timeoutMs });

      expect(result).toMatchObject({ ok: false, error: { kind: "timeout" } });
      expect(armed).toEqual([expected]);
    } finally {
      silent.closeAllConnections();
      await new Promise<void>((resolve) => silent.close(() => resolve()));
    }
  });

  it("should leave the status read on the JSON default, because it deletes nothing", async () => {
    await getDocumentDeletion("case-1", "00000000-0000-4000-8000-000000000001", { ...config, timeoutMs: undefined });

    expect(armed).toEqual([10_000]);
  });
});
