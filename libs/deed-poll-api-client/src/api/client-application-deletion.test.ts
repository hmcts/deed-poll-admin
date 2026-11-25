/**
 * Application deletion (api#175): the three operations against the in-memory mock, which restates api's admission,
 * replay, fence, status and restore, and against a server of its own for a 409 the mock never sends.
 */
import { createServer } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type RunningMockApi, startMockApi } from "../mock/server.js";
import {
  type ApiConfig,
  createNote,
  type DeletionCreate,
  getApplicationDeletion,
  getCase,
  listCases,
  requestApplicationDeletion,
  restoreApplicationDeletion
} from "./client.js";

const KEY = "6f1c2a4e-8b3d-4f5a-9c7e-1d2b3a4c5d6e";
const OTHER_KEY = "0b7c3f9e-2d4a-4c1b-8e5f-6a7b8c9d0e1f";
const NOTE = "Created twice by mistake on the same day";
const APPLICANT = "Wilhelmina Zephyrine";
const DAY_MS = 86_400_000;
const STAFF_WITHOUT_DELETION = [
  ["caseworker", ["caseworker-deedpoll"]],
  ["Team leader", ["caseworker-deedpoll-team-leader"]],
  ["legacy admin", ["caseworker-deedpoll-admin"]],
  ["judge", ["caseworker-deedpoll-judicial"]]
] as const;

let mock: RunningMockApi;
let config: ApiConfig;

beforeAll(async () => {
  mock = await startMockApi();
  config = { baseUrl: mock.url, timeoutMs: 2000, accessToken: roleToken("dm-1", ["caseworker-deedpoll-delivery-manager"]) };
});

afterAll(async () => {
  await mock.close();
});

beforeEach(() => {
  mock.setScenario("happy-path");
  mock.reset();
});

describe("the case detail's lastChangedOn", () => {
  it("should publish a zoneless millisecond timestamp that moves with a child write, not only the case's own", async () => {
    // Arrange
    const id = seedCase();
    const before = await reviewed(id);

    // Act
    await new Promise((resolve) => setTimeout(resolve, 5));
    await createNote(id, "A note written after the review", config);
    const after = await reviewed(id);

    // Assert
    expect(before).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/);
    expect(after > before).toBe(true);
  });
});

describe("requestApplicationDeletion against the mock", () => {
  it("should admit a Delivery Manager's request as Pending until the grace period ends, and hide the case at once", async () => {
    // Arrange
    const id = seedCase();
    const keep = seedCase();
    const started = Date.now();

    // Act
    const result = await requestApplicationDeletion(id, await body(id), KEY, config);

    // Assert
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe("Pending");
    expect(result.data.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.data.restorableUntil.getTime() - started).toBeGreaterThanOrEqual(14 * DAY_MS - 1000);
    expect(result.data.restorableUntil.getTime() - started).toBeLessThanOrEqual(14 * DAY_MS + 1000);
    expect((await getCase(id, config)).ok).toBe(false);
    const list = await listCases({}, config);
    expect(list.ok && list.data.cases.map((row) => row.id)).toEqual([keep]);
    expect((await getCase(keep, config)).ok).toBe(true);
  });

  it("should answer 202 with the status resource's Location and no-store", async () => {
    // Arrange
    const id = seedCase();

    // Act
    const response = await rawAdmission(id, JSON.stringify(await body(id)));

    // Assert
    const answer = (await response.json()) as { requestId: string };
    expect(response.status).toBe(202);
    expect(response.headers.get("location")).toBe(`/caseworker/application-deletions/${answer.requestId}`);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(Object.keys(answer).sort()).toEqual(["requestId", "restorableUntil", "status"]);
  });

  it("should freeze the grace period the process settings held when the request was admitted", async () => {
    // Arrange
    const id = seedCase();
    await putProcessSettings({ referralClaimExpiryMinutes: 10080, deletionGraceDays: 3, revision: 0 });
    const started = Date.now();

    // Act
    const result = await requestApplicationDeletion(id, await body(id), KEY, config);
    await putProcessSettings({ referralClaimExpiryMinutes: 10080, deletionGraceDays: 90, revision: 1 });
    const status = result.ok ? await getApplicationDeletion(result.data.requestId, config) : null;

    // Assert
    expect(result.ok && Math.round((result.data.restorableUntil.getTime() - started) / DAY_MS)).toBe(3);
    expect(status?.ok && status.data.restorableUntil.getTime()).toBe(result.ok && result.data.restorableUntil.getTime());
  });

  it.each(STAFF_WITHOUT_DELETION)("should refuse a %s on all three routes before reading anything, however malformed", async (_persona, roles) => {
    // Arrange
    const id = seedCase();
    const other = { ...config, accessToken: roleToken("other-1", [...roles]) };

    // Act
    const admitted = await requestApplicationDeletion(id, { reason: "DUPLICATE", note: "", expectedLastChangedOn: "nonsense" }, "not-a-key", other);
    const status = await getApplicationDeletion("not-a-uuid", other);
    const restored = await restoreApplicationDeletion(KEY, other);

    // Assert
    for (const result of [admitted, status, restored]) expect(result.ok === false && result.error.kind).toBe("forbidden");
    expect((await getCase(id, config)).ok).toBe(true);
  });

  it("should refuse an anonymous caller with 401", async () => {
    // Act
    const result = await getApplicationDeletion(KEY, { baseUrl: mock.url });

    // Assert
    expect(result.ok === false && result.error.kind).toBe("unauthorized");
  });

  it("should refuse a missing or malformed key on the header, a bad reason, a short note and an unparseable timestamp together", async () => {
    // Arrange
    const id = seedCase();
    const refused = { reason: "VOID" as never, note: "   too short  ", expectedLastChangedOn: "2026-11-25T10:00:00Z" };

    // Act
    const malformed = await requestApplicationDeletion(id, refused, "6f1c2a4e8b3d4f5a9c7e1d2b3a4c5d6e", config);
    const missing = await rawAdmission(id, JSON.stringify(await body(id)), { key: null });

    // Assert
    expect(malformed.ok === false && malformed.error.kind).toBe("validation");
    expect(malformed.ok === false && malformed.error.fieldErrors?.map((error) => error.field)).toEqual([
      "Idempotency-Key",
      "reason",
      "note",
      "expectedLastChangedOn"
    ]);
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { errors: { field: string }[] }).errors.map((error) => error.field)).toEqual(["Idempotency-Key"]);
    expect((await getCase(id, config)).ok).toBe(true);
  });

  it("should refuse a control character in the note, and count the note after trimming spaces", async () => {
    // Arrange
    const id = seedCase();
    const reviewedAt = await reviewed(id);

    // Act
    const withTab = await requestApplicationDeletion(
      id,
      { reason: "DUPLICATE", note: "Duplicate\tof another", expectedLastChangedOn: reviewedAt },
      KEY,
      config
    );
    const padded = await requestApplicationDeletion(
      id,
      { reason: "DUPLICATE", note: `   ${"x".repeat(9)}   `, expectedLastChangedOn: reviewedAt },
      KEY,
      config
    );

    // Assert
    expect(withTab.ok === false && withTab.error.fieldErrors).toEqual([
      { field: "note", message: "The reason for deletion must not contain tabs, line breaks or control characters" }
    ]);
    expect(padded.ok === false && padded.error.fieldErrors?.map((error) => error.field)).toEqual(["note"]);
  });

  it("should refuse an unknown key without echoing it, no body as three field errors, a form as 415 and an oversized body as 413", async () => {
    // Arrange
    const id = seedCase();
    const valid = await body(id);

    // Act
    const extra = await rawAdmission(id, JSON.stringify({ ...valid, requestedBy: "forged-admin" }));
    const empty = await rawAdmission(id, "");
    const form = await rawAdmission(id, "reason=DUPLICATE", { contentType: "application/x-www-form-urlencoded" });
    const huge = await rawAdmission(id, JSON.stringify({ ...valid, note: "x".repeat(17 * 1024) }));

    // Assert
    const extraText = await extra.text();
    expect(extra.status).toBe(400);
    expect(extraText).not.toContain("requestedBy");
    expect(extraText).not.toContain("forged-admin");
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as { errors: { field: string }[] }).errors.map((error) => error.field)).toEqual(["reason", "note", "expectedLastChangedOn"]);
    expect(form.status).toBe(415);
    expect(huge.status).toBe(413);
    expect((await getCase(id, config)).ok).toBe(true);
  });

  it("should answer 404 for a case that does not exist and has no request", async () => {
    // Act
    const result = await requestApplicationDeletion(
      "no-such-case",
      { reason: "DUPLICATE", note: NOTE, expectedLastChangedOn: "2026-11-25T10:00:00" },
      KEY,
      config
    );

    // Assert
    expect(result.ok === false && result.error.kind).toBe("not-found");
  });

  it("should refuse a review older than the case's last change with STALE_CONFIRMATION and write nothing", async () => {
    // Arrange
    const id = seedCase();
    const stale = await body(id);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await createNote(id, "Somebody else wrote this meanwhile", config);

    // Act
    const result = await requestApplicationDeletion(id, stale, KEY, config);

    // Assert
    expect(result.ok === false && result.error).toMatchObject({ kind: "conflict", status: 409, code: "STALE_CONFIRMATION" });
    expect((await getCase(id, config)).ok).toBe(true);
  });

  it("should compare the review to the millisecond, so extra fraction digits are the same review", async () => {
    // Arrange
    const id = seedCase();
    const reviewedAt = await reviewed(id);

    // Act
    const result = await requestApplicationDeletion(id, { reason: "DUPLICATE", note: NOTE, expectedLastChangedOn: `${reviewedAt}987` }, KEY, config);

    // Assert
    expect(result.ok).toBe(true);
  });

  it("should refuse a case kept permanently, and one that is Gazette evidence, by code", async () => {
    // Arrange
    const kept = mock.seed({ retainPermanently: true }).id;
    const published = mock.seed({ displayReference: "DP/2026/00042" }).id;
    await fetch(`${mock.url}/__mock/gazette-batches`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sentAt: "2026-01-01T09:00:00", sentBy: "A Delivery Manager", referenceNumbers: ["DP/2026/00042"] })
    });

    // Act
    const keptResult = await requestApplicationDeletion(kept, await body(kept), KEY, config);
    const publishedResult = await requestApplicationDeletion(published, await body(published), OTHER_KEY, config);

    // Assert
    expect(keptResult.ok === false && keptResult.error.code).toBe("RETAINED_PERMANENTLY");
    expect(publishedResult.ok === false && publishedResult.error.code).toBe("GAZETTE_EVIDENCE");
  });

  it("should replay the same key and body as the same request, also once the application has been removed", async () => {
    // Arrange
    const id = seedCase();
    const confirmed = await body(id);
    const first = await requestApplicationDeletion(id, confirmed, KEY, config);
    const requestId = first.ok ? first.data.requestId : "";
    await control({ requestId, status: "Completed" });

    // Act
    const replayed = await requestApplicationDeletion(id, confirmed, KEY, config);

    // Assert
    expect(replayed).toEqual({ ok: true, data: { requestId, status: "Completed", restorableUntil: first.ok ? first.data.restorableUntil : null } });
    expect((await getCase(id, config)).ok).toBe(false);
  });

  it("should refuse the same key with a different body as KEY_REUSED, a changed reason included", async () => {
    // Arrange
    const id = seedCase();
    const confirmed = await body(id);
    await requestApplicationDeletion(id, confirmed, KEY, config);

    // Act
    const otherNote = await requestApplicationDeletion(id, { ...confirmed, note: `${NOTE}, again` }, KEY, config);
    const otherReason = await requestApplicationDeletion(id, { ...confirmed, reason: "CREATED_IN_ERROR" }, KEY, config);

    // Assert
    expect(otherNote.ok === false && otherNote.error.code).toBe("KEY_REUSED");
    expect(otherReason.ok === false && otherReason.error.code).toBe("KEY_REUSED");
  });

  it("should answer a second key for the same reason with the first request, and refuse the other reason as CONFLICTING_REASON", async () => {
    // Arrange
    const id = seedCase();
    const confirmed = await body(id);
    const first = await requestApplicationDeletion(id, confirmed, KEY, config);

    // Act
    const sameReason = await requestApplicationDeletion(id, { ...confirmed, note: "Another Delivery Manager's words" }, OTHER_KEY, config);
    const otherReason = await requestApplicationDeletion(id, { ...confirmed, reason: "CREATED_IN_ERROR" }, OTHER_KEY, config);

    // Assert
    expect(sameReason.ok && sameReason.data.requestId).toBe(first.ok && first.data.requestId);
    expect(otherReason.ok === false && otherReason.error.code).toBe("CONFLICTING_REASON");
  });

  it("should lose an admitted request's response, and recover the same request by sending it again with the same key", async () => {
    // Arrange
    const id = seedCase();
    const confirmed = await body(id);
    await outcome({ loseAdmissionResponse: true });

    // Act
    const lost = await requestApplicationDeletion(id, confirmed, KEY, config);
    const recovered = await requestApplicationDeletion(id, confirmed, KEY, config);

    // Assert
    expect(lost.ok === false && lost.error.kind).toBe("unavailable");
    expect((await getCase(id, config)).ok).toBe(false);
    expect(recovered.ok && recovered.data.status).toBe("Pending");
  });

  it("should refuse the next admission with a configured code and write nothing", async () => {
    // Arrange
    const id = seedCase();
    await outcome({ refuseAdmission: "EMAIL_SEND_UNRESOLVED" });

    // Act
    const refused = await requestApplicationDeletion(id, await body(id), KEY, config);
    const next = await requestApplicationDeletion(id, await body(id), KEY, config);

    // Assert
    expect(refused.ok === false && refused.error.code).toBe("EMAIL_SEND_UNRESOLVED");
    expect(next.ok).toBe(true);
  });
});

describe("getApplicationDeletion against the mock", () => {
  it("should read a request after its application is gone, with no note, requester, key or applicant data", async () => {
    // Arrange
    const id = mock.seed({ newForename: APPLICANT, newSurname: APPLICANT }).id;
    const admitted = await requestApplicationDeletion(id, await body(id), KEY, config);
    const requestId = admitted.ok ? admitted.data.requestId : "";
    await control({ requestId, status: "Completed" });

    // Act
    const result = await getApplicationDeletion(requestId, config);
    const raw = await fetch(`${mock.url}/caseworker/application-deletions/${requestId}`, { headers: { authorization: `Bearer ${config.accessToken}` } });

    // Assert
    expect(result.ok && result.data).toMatchObject({ requestId, caseId: id, reason: "DUPLICATE", status: "Completed", failure: null });
    expect(result.ok && result.data.completedAt instanceof Date).toBe(true);
    const text = await raw.text();
    expect(Object.keys(JSON.parse(text) as object).sort()).toEqual([
      "caseId",
      "completedAt",
      "failure",
      "reason",
      "requestId",
      "requestedAt",
      "restorableUntil",
      "status"
    ]);
    for (const secret of [NOTE, APPLICANT, KEY, "dm-1"]) expect(text).not.toContain(secret);
    expect(raw.headers.get("cache-control")).toBe("no-store");
  });

  it("should publish a failure only while the request needs attention", async () => {
    // Arrange
    const id = seedCase();
    const admitted = await requestApplicationDeletion(id, await body(id), KEY, config);
    const requestId = admitted.ok ? admitted.data.requestId : "";

    // Act
    await control({ requestId, status: "NeedsAttention", failure: "CDAM_REMOVED_DOCUMENT_UNPURGED" });
    const attention = await getApplicationDeletion(requestId, config);
    await control({ requestId, status: "AwaitingDisposal" });
    const awaiting = await getApplicationDeletion(requestId, config);

    // Assert
    expect(attention.ok && [attention.data.status, attention.data.failure]).toEqual(["NeedsAttention", "CDAM_REMOVED_DOCUMENT_UNPURGED"]);
    expect(awaiting.ok && [awaiting.data.status, awaiting.data.failure]).toEqual(["AwaitingDisposal", null]);
  });

  it("should answer not-found for an unknown or non-UUID request, and unavailable while status reads are down", async () => {
    // Arrange
    const id = seedCase();
    const admitted = await requestApplicationDeletion(id, await body(id), KEY, config);

    // Act
    const unknown = await getApplicationDeletion(OTHER_KEY, config);
    const notUuid = await getApplicationDeletion("request-1", config);
    await outcome({ statusReads: "unavailable" });
    const down = await getApplicationDeletion(admitted.ok ? admitted.data.requestId : "", config);

    // Assert
    expect(unknown.ok === false && unknown.error.kind).toBe("not-found");
    expect(notUuid.ok === false && notUuid.error.kind).toBe("not-found");
    expect(down.ok === false && down.error.kind).toBe("unavailable");
  });
});

describe("restoreApplicationDeletion against the mock", () => {
  it("should restore a Pending request inside its grace period, after which its status is gone and the case is back", async () => {
    // Arrange
    const id = seedCase();
    const admitted = await requestApplicationDeletion(id, await body(id), KEY, config);
    const requestId = admitted.ok ? admitted.data.requestId : "";

    // Act
    const restored = await restoreApplicationDeletion(requestId, config);
    const again = await restoreApplicationDeletion(requestId, config);

    // Assert
    expect(restored).toEqual({ ok: true, data: { caseId: id, status: "Restored" } });
    expect(again.ok === false && again.error.kind).toBe("not-found");
    expect((await getApplicationDeletion(requestId, config)).ok).toBe(false);
    expect((await getCase(id, config)).ok).toBe(true);
  });

  it("should answer a retry of the original admission after a restore with STALE_CONFIRMATION, never a replay", async () => {
    // Arrange
    const id = seedCase();
    const confirmed = await body(id);
    const admitted = await requestApplicationDeletion(id, confirmed, KEY, config);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await restoreApplicationDeletion(admitted.ok ? admitted.data.requestId : "", config);

    // Act
    const retried = await requestApplicationDeletion(id, confirmed, KEY, config);

    // Assert
    expect(retried.ok === false && retried.error.code).toBe("STALE_CONFIRMATION");
    expect((await getCase(id, config)).ok).toBe(true);
  });

  it("should refuse a restore once the window has closed, and once cleanup has started, by code", async () => {
    // Arrange
    const closed = seedCase();
    const started = seedCase();
    const first = await requestApplicationDeletion(closed, await body(closed), KEY, config);
    const second = await requestApplicationDeletion(started, await body(started), OTHER_KEY, config);
    const closedId = first.ok ? first.data.requestId : "";
    const startedId = second.ok ? second.data.requestId : "";
    await control({ requestId: closedId, restoreWindow: "closed" });
    await control({ requestId: startedId, status: "InProgress" });

    // Act
    const windowClosed = await restoreApplicationDeletion(closedId, config);
    const cleanupStarted = await restoreApplicationDeletion(startedId, config);

    // Assert
    expect(windowClosed.ok === false && windowClosed.error).toMatchObject({ kind: "conflict", code: "RESTORE_WINDOW_CLOSED" });
    expect(cleanupStarted.ok === false && cleanupStarted.error).toMatchObject({ kind: "conflict", code: "CLEANUP_STARTED" });
    expect((await getCase(closed, config)).ok).toBe(false);
  });
});

describe("a deletion 409 without a published code", () => {
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const server = createServer((req, res) => {
      req.resume();
      res.writeHead(409, { "content-type": "application/json" });
      res.end(JSON.stringify(req.url?.endsWith("/restore") ? { error: "Refused", code: "SOMETHING_NEW" } : { error: "Refused" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${address && typeof address === "object" ? address.port : 0}`;
    close = () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  afterAll(() => close());

  it("should stay a plain conflict with no code, so a page answers it with its own generic refusal", async () => {
    // Act
    const admission = await requestApplicationDeletion("case-1", { reason: "DUPLICATE", note: NOTE, expectedLastChangedOn: "2026-11-25T10:00:00" }, KEY, {
      baseUrl
    });
    const restore = await restoreApplicationDeletion(KEY, { baseUrl });

    // Assert
    expect(admission).toEqual({ ok: false, error: { kind: "conflict", status: 409, message: "Refused" } });
    expect(restore).toEqual({ ok: false, error: { kind: "conflict", status: 409, message: "Refused" } });
  });
});

function seedCase(): string {
  return mock.seed({ newForename: "Alex", newSurname: "Example" }).id;
}

async function reviewed(id: string): Promise<string> {
  const detail = await getCase(id, config);
  if (!detail.ok || typeof detail.data.lastChangedOn !== "string") throw new Error("the case detail carried no lastChangedOn");
  return detail.data.lastChangedOn;
}

async function body(id: string): Promise<DeletionCreate> {
  return { reason: "DUPLICATE", note: NOTE, expectedLastChangedOn: await reviewed(id) };
}

function rawAdmission(id: string, text: string, options: { key?: string | null; contentType?: string } = {}): Promise<Response> {
  const key = options.key === undefined ? KEY : options.key;
  return fetch(`${mock.url}/caseworker/cases/${encodeURIComponent(id)}/deletion-requests`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.accessToken}`,
      "content-type": options.contentType ?? "application/json",
      ...(key === null ? {} : { "idempotency-key": key })
    },
    body: text
  });
}

async function control(body: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${mock.url}/__mock/application-deletions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (response.status !== 200) throw new Error(`control refused: ${await response.text()}`);
}

async function outcome(body: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${mock.url}/__mock/application-deletion-outcome`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (response.status !== 200) throw new Error(`outcome refused: ${await response.text()}`);
}

async function putProcessSettings(body: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${mock.url}/caseworker/process-settings`, {
    method: "PUT",
    headers: { authorization: `Bearer ${config.accessToken}`, "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (response.status !== 200) throw new Error(`settings refused: ${await response.text()}`);
}

/** A token the mock reads roles from, as the Gazette and process settings tests build one. */
function roleToken(sub: string, roles: string[]): string {
  return `x.${Buffer.from(JSON.stringify({ sub, roles })).toString("base64url")}.signature`;
}
