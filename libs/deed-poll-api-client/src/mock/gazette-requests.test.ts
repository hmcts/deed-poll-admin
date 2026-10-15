import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { getGazetteMembers, getGazetteRequests, getGazetteStatus, previewGazetteNotice, submitGazetteNotice, updateGazetteSettings } from "../api/client.js";
import { GAZETTE_REFUSAL_CODE, GAZETTE_REQUEST_STATE } from "../api/wire.js";
import { type RunningMockApi, startMockApi } from "./server.js";

const DELIVERY_MANAGER = `x.${Buffer.from(JSON.stringify({ sub: "admin", roles: ["caseworker-deedpoll-delivery-manager"] })).toString("base64url")}.signature`;
let mock: RunningMockApi;
const config = () => ({ baseUrl: mock.url, accessToken: DELIVERY_MANAGER });
beforeAll(async () => {
  mock = await startMockApi();
});
afterAll(async () => {
  await mock.close();
});
beforeEach(() => {
  mock.reset();
  mock.setScenario("happy-path");
});

async function fixture(path: string, body: unknown) {
  const response = await fetch(`${mock.url}/__mock/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  expect(response.status).toBeLessThan(300);
}
async function selection() {
  await updateGazetteSettings({ recipientEmail: "gazette@example.com", revision: 0 }, config());
  const older = mock.seed({
    type: "Adult",
    state: "Enroled",
    publishToLondonGazette: true,
    dateNoticeSentToLondonGazette: null,
    dateEnroled: new Date("2026-01-01"),
    displayReference: "FROZEN-ADULT"
  });
  const newer = mock.seed({
    type: "Minor",
    state: "Enroled",
    publishToLondonGazette: true,
    dateNoticeSentToLondonGazette: null,
    dateEnroled: new Date("2026-02-01"),
    displayReference: "FROZEN-MINOR"
  });
  const caseIds = [newer.id, older.id];
  const result = await previewGazetteNotice({ caseIds }, config());
  expect(result).toMatchObject({
    ok: true,
    data: { adultCount: 1, minorCount: 1, caseCount: 2, recipientEmail: "gazette@example.com", cases: [{ caseId: older.id }, { caseId: newer.id }] }
  });
  if (!result.ok) throw new Error("Preview failed");
  return { older, newer, input: { caseIds, recipientRevision: result.data.recipientRevision, selectionFingerprint: result.data.selectionFingerprint } };
}

it.each(GAZETTE_REQUEST_STATE)("should return %s as an outcome, replay the same key, freeze membership and preserve request order", async (state) => {
  const { older, input } = await selection();
  await fixture("gazette-outcome", { state });
  const key = randomUUID();
  const sent = await submitGazetteNotice(input, key, config());
  expect(sent).toMatchObject({ ok: true, data: { state, caseCount: 2 } });
  if (!sent.ok) throw new Error("Expected status");
  older.displayReference = "edited";
  await updateGazetteSettings({ recipientEmail: "changed@example.com", revision: 1 }, config());
  expect(await submitGazetteNotice(input, key, config())).toEqual(sent);
  expect(await getGazetteStatus(sent.data.batchId, config())).toEqual(sent);
  expect(await getGazetteMembers(sent.data.batchId, { page: 1, size: 1 }, config())).toMatchObject({
    ok: true,
    data: { total: 2, totalPages: 2, cases: [{ caseId: older.id, referenceNumber: "FROZEN-ADULT" }] }
  });
  expect(await getGazetteRequests({ state, size: 1 }, config())).toMatchObject({ ok: true, data: { total: 1, requests: [sent.data] } });
  expect(await submitGazetteNotice({ ...input, recipientRevision: 99 }, key, config())).toMatchObject({
    ok: false,
    error: { kind: "gazette-refusal", code: "REQUEST_KEY_REUSED" }
  });
});

it("should preserve the admitted request after a lost response and resolve with the original key only", async () => {
  const { input } = await selection();
  await fixture("gazette-outcome", { state: "Uncertain", loseResponse: true });
  const key = randomUUID();
  expect(await submitGazetteNotice(input, key, config())).toMatchObject({ ok: false, error: { kind: "unavailable" } });
  const replay = await submitGazetteNotice(input, key, config());
  expect(replay).toMatchObject({ ok: true, data: { state: "Uncertain" } });
  expect(await getGazetteRequests({}, config())).toMatchObject({ ok: true, data: { total: 1 } });
  expect(await submitGazetteNotice(input, randomUUID(), config())).toMatchObject({ ok: false, error: { kind: "gazette-refusal", code: "CASE_RESERVED" } });
});

it("should refuse changed recipients and changed selections without silently dropping a case", async () => {
  const { older, input } = await selection();
  older.newSurname = "Changed";
  expect(await submitGazetteNotice(input, randomUUID(), config())).toMatchObject({ ok: false, error: { kind: "gazette-refusal", code: "SELECTION_CHANGED" } });
  await updateGazetteSettings({ recipientEmail: "changed@example.com", revision: 1 }, config());
  expect(await submitGazetteNotice(input, randomUUID(), config())).toMatchObject({ ok: false, error: { kind: "gazette-refusal", code: "RECIPIENT_CHANGED" } });
  expect(await getGazetteRequests({}, config())).toMatchObject({ ok: true, data: { total: 0 } });
});

it.each(["DeedOfRelinquishment", "Unknown", null] as const)("should refuse unsupported %s cases and not create a preview", async (type) => {
  await updateGazetteSettings({ recipientEmail: "gazette@example.com", revision: 0 }, config());
  const record = mock.seed({ type, state: "Enroled", publishToLondonGazette: true });
  expect(await previewGazetteNotice({ caseIds: [record.id] }, config())).toMatchObject({
    ok: false,
    error: { kind: "gazette-refusal", code: "CASE_TYPE_UNSUPPORTED" }
  });
});

it("should page all legacy members beyond the history preview and leave missing facts unknown", async () => {
  const id = randomUUID();
  await fixture("gazette-batches", {
    id,
    sentAt: "2026-01-01T00:00:00",
    sentBy: "Old sender",
    referenceNumbers: Array.from({ length: 101 }, (_, n) => `REF-${String(n).padStart(3, "0")}`)
  });
  expect(await getGazetteStatus(id, config())).toMatchObject({
    ok: true,
    data: { state: "Sent", caseCount: 101, recipientEmail: null, adultCount: null, submittedAt: null }
  });
  expect(await getGazetteMembers(id, { page: 5 }, config())).toMatchObject({
    ok: true,
    data: { cases: [{ referenceNumber: "REF-100" }], total: 101, totalPages: 5 }
  });
  expect(await getGazetteRequests({}, config())).toMatchObject({ ok: true, data: { requests: [], total: 0 } });
});

it("should gate every new read and write by the authenticated Delivery Manager role", async () => {
  for (const [method, path] of [
    ["POST", "gazette-notice-previews"],
    ["POST", "gazette-notices"],
    ["GET", "gazette-notice-requests"],
    ["GET", `gazette-notices/${randomUUID()}`],
    ["GET", `gazette-notices/${randomUUID()}/cases`]
  ]) {
    for (const [authorization, expected] of [
      ["", 401],
      [`Bearer x.${Buffer.from(JSON.stringify({ sub: "worker", roles: [] })).toString("base64url")}.signature`, 403]
    ] as const) {
      expect((await fetch(`${mock.url}/caseworker/${path}`, { method, headers: { authorization } })).status).toBe(expected);
    }
  }
});

it.each(GAZETTE_REFUSAL_CODE)("should classify only the published structured refusal %s without exposing server prose", async (code) => {
  await responding(code === "GAZETTE_UNAVAILABLE" ? 503 : 409, { code, error: "private provider diagnostic", conflicts: [] }, async (baseUrl) => {
    const result = await submitGazetteNotice({ caseIds: ["a"], recipientRevision: 1, selectionFingerprint: "opaque" }, randomUUID(), { baseUrl });
    expect(result).toEqual({ ok: false, error: { kind: "gazette-refusal", code, conflicts: [] } });
  });
});

it.each([
  [409, { code: "FUTURE_CODE", error: "unrecognised" }, "conflict"],
  [409, { code: "RECIPIENT_CHANGED" }, "conflict"],
  [500, { code: "RECIPIENT_CHANGED", error: "wrong status" }, "unavailable"],
  [200, { batchId: randomUUID(), state: "FutureState", caseCount: 1 }, "invalid-response"]
])("should keep an unproven outcome separate from admission refusals (%s)", async (status, body, kind) => {
  await responding(Number(status), body, async (baseUrl) => {
    expect(await submitGazetteNotice({ caseIds: ["a"], recipientRevision: 1, selectionFingerprint: "opaque" }, randomUUID(), { baseUrl })).toMatchObject({
      ok: false,
      error: { kind }
    });
  });
});

it("should never follow a redirect or automatically repeat a Gazette POST", async () => {
  let calls = 0;
  const server = createServer((_req, res) => {
    calls++;
    res.writeHead(307, { location: "/redirected" });
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    expect(
      await submitGazetteNotice({ caseIds: ["a"], recipientRevision: 1, selectionFingerprint: "opaque" }, randomUUID(), {
        baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`
      })
    ).toMatchObject({ ok: false, error: { kind: "unavailable" } });
    expect(calls).toBe(1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function responding(status: number, body: unknown, run: (url: string) => Promise<void>) {
  const server = createServer((_req, res) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

it("should refuse an expired confirmation and missing configuration before admission", async () => {
  const row = mock.seed({ type: "Adult", state: "Enroled", publishToLondonGazette: true });
  expect(await previewGazetteNotice({ caseIds: [row.id] }, config())).toMatchObject({
    ok: false,
    error: { kind: "gazette-refusal", code: "RECIPIENT_NOT_CONFIGURED" }
  });
  const { input } = await selection();
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31 * 60_000);
  try {
    expect(await submitGazetteNotice(input, randomUUID(), config())).toMatchObject({
      ok: false,
      error: { kind: "gazette-refusal", code: "CONFIRMATION_EXPIRED" }
    });
  } finally {
    clock.mockRestore();
  }
  expect(await getGazetteRequests({}, config())).toMatchObject({ ok: true, data: { total: 0 } });
});

it("should read full new-ledger membership beyond 100 without truncation and clear it on reset", async () => {
  const batchId = randomUUID();
  await fixture("gazette-requests", {
    status: { batchId, state: "Sent", caseCount: 101 },
    cases: Array.from({ length: 101 }, (_, n) => ({ caseId: `case-${n}`, referenceNumber: `REF-${String(n).padStart(3, "0")}` }))
  });
  expect(await getGazetteMembers(batchId, { page: 5 }, config())).toMatchObject({
    ok: true,
    data: { total: 101, cases: [{ caseId: "case-100", referenceNumber: "REF-100" }] }
  });
  mock.reset();
  expect(await getGazetteStatus(batchId, config())).toMatchObject({ ok: false, error: { kind: "not-found" } });
  expect(await getGazetteRequests({}, config())).toMatchObject({ ok: true, data: { total: 0 } });
});

it.each([
  { roles: [], allowed: false },
  { roles: ["unknown"], allowed: false },
  { roles: ["caseworker-deedpoll"], allowed: false },
  { roles: ["caseworker-deedpoll-admin"], allowed: false },
  { roles: ["caseworker-deedpoll-team-leader"], allowed: false },
  { roles: ["caseworker-deedpoll-judicial"], allowed: false },
  { roles: ["caseworker-deedpoll-team-leader", "caseworker-deedpoll-judicial"], allowed: false },
  { roles: ["caseworker-deedpoll-delivery-manager"], allowed: true },
  { roles: ["caseworker-deedpoll-delivery-manager", "caseworker-deedpoll-judicial"], allowed: true }
])("should enforce the complete Gazette HTTP boundary for $roles", async ({ roles, allowed }) => {
  const accessToken = `x.${Buffer.from(JSON.stringify({ sub: "staff", roles })).toString("base64url")}.signature`;
  for (const [method, path, admittedStatus] of [
    ["GET", "gazette-settings", 200],
    ["PUT", "gazette-settings", 400],
    ["GET", "gazette-notices", 200],
    ["POST", "gazette-notice-previews", 400],
    ["POST", "gazette-notices", 400],
    ["GET", "gazette-notice-requests", 200],
    ["GET", `gazette-notices/${randomUUID()}`, 404],
    ["GET", `gazette-notices/${randomUUID()}/cases`, 404],
    ["GET", "cases?filter=readyForPublication&size=1", 200]
  ] as const) {
    const response = await fetch(`${mock.url}/caseworker/${path}`, {
      method,
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      ...(method === "POST" || method === "PUT" ? { body: "{}" } : {})
    });
    expect(response.status, `${method} ${path}`).toBe(allowed ? admittedStatus : 403);
  }
});
