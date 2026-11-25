/**
 * The mock's deletion test controls and dispatch: what a journey can arrange, and what it cannot. The operations
 * themselves are driven through the adapter in `../api/client-application-deletion.test.ts`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type RunningMockApi, startMockApi } from "./server.js";

const KEY = "6f1c2a4e-8b3d-4f5a-9c7e-1d2b3a4c5d6e";
const DM = `x.${Buffer.from(JSON.stringify({ sub: "dm-1", roles: ["caseworker-deedpoll-delivery-manager"] })).toString("base64url")}.signature`;

let mock: RunningMockApi;

beforeAll(async () => {
  mock = await startMockApi();
});

afterAll(async () => {
  await mock.close();
});

beforeEach(() => {
  mock.reset();
});

describe("the mock's application deletion controls", () => {
  it("should refuse NeedsAttention without a failure, a failure without it, and an unknown key", async () => {
    // Arrange
    const requestId = await admit();

    // Act
    const noFailure = await post("/__mock/application-deletions", { requestId, status: "NeedsAttention" });
    const strayFailure = await post("/__mock/application-deletions", { requestId, status: "InProgress", failure: "CCD_CASE_MISSING" });
    const unknownKey = await post("/__mock/application-deletions", { requestId, status: "Completed", deleteRemotely: true });

    // Assert
    expect([noFailure.status, strayFailure.status, unknownKey.status]).toEqual([400, 400, 400]);
    expect((await status(requestId)).status).toBe("Pending");
  });

  it("should answer 404 for a request it does not hold", async () => {
    // Act
    const response = await post("/__mock/application-deletions", { requestId: KEY, status: "Completed" });

    // Assert
    expect(response.status).toBe(404);
  });

  it("should refuse an outcome that is not an admission refusal", async () => {
    // Act
    const restoreCode = await post("/__mock/application-deletion-outcome", { refuseAdmission: "CLEANUP_STARTED" });
    const unknown = await post("/__mock/application-deletion-outcome", { loseEveryResponse: true });

    // Assert
    expect([restoreCode.status, unknown.status]).toEqual([400, 400]);
  });

  it("should forget every request and every arranged outcome on reset", async () => {
    // Arrange
    const requestId = await admit();
    await post("/__mock/application-deletion-outcome", { loseAdmissionResponse: true, statusReads: "unavailable" });

    // Act
    await post("/__mock/reset");
    const outcome = await post("/__mock/application-deletion-outcome", {});

    // Assert
    expect(await outcome.json()).toEqual({ loseAdmissionResponse: false, refuseAdmission: null, statusReadsUnavailable: false });
    const read = await fetch(`${mock.url}/caseworker/application-deletions/${requestId}`, { headers: { authorization: `Bearer ${DM}` } });
    expect(read.status).toBe(404);
  });

  it("should answer 405 for a method a deletion route does not take, after the capability check", async () => {
    // Act
    const getAdmission = await fetch(`${mock.url}/caseworker/cases/case-1/deletion-requests`, { headers: { authorization: `Bearer ${DM}` } });
    const deleteStatus = await fetch(`${mock.url}/caseworker/application-deletions/${KEY}`, { method: "DELETE", headers: { authorization: `Bearer ${DM}` } });

    // Assert
    expect([getAdmission.status, deleteStatus.status]).toEqual([405, 405]);
  });
});

async function admit(): Promise<string> {
  const record = mock.seed({ newForename: "Alex" });
  const detail = (await (await fetch(`${mock.url}/caseworker/cases/${record.id}`)).json()) as { lastChangedOn: string };
  const response = await fetch(`${mock.url}/caseworker/cases/${record.id}/deletion-requests`, {
    method: "POST",
    headers: { authorization: `Bearer ${DM}`, "content-type": "application/json", "idempotency-key": KEY },
    body: JSON.stringify({ reason: "CREATED_IN_ERROR", note: "Created in error at the counter", expectedLastChangedOn: detail.lastChangedOn })
  });
  return ((await response.json()) as { requestId: string }).requestId;
}

async function status(requestId: string): Promise<{ status: string }> {
  const response = await fetch(`${mock.url}/caseworker/application-deletions/${requestId}`, { headers: { authorization: `Bearer ${DM}` } });
  return (await response.json()) as { status: string };
}

function post(path: string, body?: unknown): Promise<Response> {
  return fetch(`${mock.url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}
