import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getGazetteNoticeHistory, listCases } from "../api/client.js";
import { DEED_POLL_STATE, DEED_POLL_TYPE } from "../api/wire.js";
import { type RunningMockApi, startMockApi } from "./server.js";

const ADMIN = token(["caseworker-deedpoll-admin"]);
const SENT_AT = "2026-09-01T10:00:00.000";
let mock: RunningMockApi;

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

function token(roles: string[]) {
  return `x.${Buffer.from(JSON.stringify({ sub: "tester", roles })).toString("base64url")}.signature`;
}

async function seedBatch(referenceNumbers: string[], fields: Record<string, unknown> = {}) {
  return fetch(`${mock.url}/__mock/gazette-batches`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sentAt: SENT_AT, sentBy: "Administrator", referenceNumbers, ...fields })
  });
}

function history(page?: number, size?: number, accessToken = ADMIN) {
  return getGazetteNoticeHistory({ page, size }, { baseUrl: mock.url, accessToken });
}

describe("readyForPublication", () => {
  it("should exclude relinquishment from rows and totals while preserving other types and the ordinary case list", async () => {
    const records = [...DEED_POLL_TYPE, null].map((type) =>
      mock.seed({ type, state: "Enroled", publishToLondonGazette: true, dateNoticeSentToLondonGazette: null })
    );
    const expected = records.filter((record) => record.type !== "DeedOfRelinquishment");

    const ready = await listCases({ filter: "readyForPublication", size: 100 }, { baseUrl: mock.url });
    const count = await listCases({ filter: "readyForPublication", size: 1 }, { baseUrl: mock.url });
    const all = await listCases({ filter: "all", size: 100 }, { baseUrl: mock.url });

    expect(ready).toMatchObject({ ok: true, data: { total: expected.length } });
    if (!ready.ok) throw new Error("Expected the ready list to succeed");
    expect(ready.data.cases.map((record) => record.id).sort()).toEqual(expected.map((record) => record.id).sort());
    expect(count).toMatchObject({ ok: true, data: { total: expected.length, totalPages: expected.length } });
    expect(all).toMatchObject({ ok: true, data: { total: records.length } });

    records[0].type = "DeedOfRelinquishment";
    const changed = await listCases({ filter: "readyForPublication", size: 100 }, { baseUrl: mock.url });
    expect(changed).toMatchObject({ ok: true, data: { total: expected.length - 1 } });
    if (!changed.ok) throw new Error("Expected the refreshed ready list to succeed");
    expect(changed.data.cases.map((record) => record.id)).not.toContain(records[0].id);
  });

  it.each(DEED_POLL_STATE)("should require Enroled, publication true and no sent date when state is %s", async (state) => {
    for (const publishToLondonGazette of [true, false, null]) {
      for (const dateNoticeSentToLondonGazette of [null, new Date("2026-08-01T00:00:00Z")]) {
        mock.seed({ state, publishToLondonGazette, dateNoticeSentToLondonGazette });
      }
    }

    const result = await listCases({ filter: "readyForPublication" }, { baseUrl: mock.url });

    expect(result).toMatchObject({ ok: true, data: { filter: "readyForPublication", total: state === "Enroled" ? 1 : 0 } });
  });

  it("should page oldest enrolments first, nulls last, with ascending IDs for ties", async () => {
    for (const [id, dateEnroled] of [
      ["z", null],
      ["c", new Date("2026-02-01T00:00:00Z")],
      ["b", new Date("2026-01-01T00:00:00Z")],
      ["a", new Date("2026-01-01T00:00:00Z")]
    ] as const) {
      mock.seed({ id, dateEnroled, state: "Enroled", publishToLondonGazette: true, dateNoticeSentToLondonGazette: null });
    }

    const first = await listCases({ filter: "readyForPublication", size: 2 }, { baseUrl: mock.url });
    const second = await listCases({ filter: "readyForPublication", page: 2, size: 2 }, { baseUrl: mock.url });
    const beyond = await listCases({ filter: "readyForPublication", page: 3, size: 2 }, { baseUrl: mock.url });

    expect(first).toMatchObject({ ok: true, data: { cases: [{ id: "a" }, { id: "b" }], total: 4, totalPages: 2 } });
    expect(second).toMatchObject({ ok: true, data: { cases: [{ id: "c" }, { id: "z" }], page: 2, total: 4 } });
    expect(beyond).toMatchObject({ ok: true, data: { cases: [], page: 3, total: 4 } });
  });
});

describe("frozen Gazette history", () => {
  it.each([0, 1, 100, 101, 130])("should cap %i frozen references at 100 while retaining the whole case count", async (count) => {
    const references = Array.from({ length: count }, (_, at) => `REF-${String(count - at).padStart(3, "0")}`);
    expect((await seedBatch(references)).status).toBe(201);

    const result = await history();

    expect(result).toMatchObject({
      ok: true,
      data: {
        page: 1,
        size: 25,
        total: 1,
        totalPages: 1,
        batches: [{ caseCount: count, referenceNumbers: references.toSorted().slice(0, 100), referencesTruncated: count > 100 }]
      }
    });
  });

  it("should sort references by UTF-8 bytes, preserve hostile text and ignore current case values", async () => {
    const record = mock.seed({ displayReference: "old reference" });
    await seedBatch(["é", "z", "a", "Z", "<script>reference</script>", "old reference"], { sentBy: "<b>sender</b>" });
    record.displayReference = "changed reference";

    const result = await history();

    expect(result).toMatchObject({
      ok: true,
      data: { batches: [{ sentBy: "<b>sender</b>", caseCount: 6, referenceNumbers: ["<script>reference</script>", "Z", "a", "old reference", "z", "é"] }] }
    });
  });

  it("should order batches newest first with descending identity ties, page them and expose only the public batch ID", async () => {
    await seedBatch(["old"], { sentAt: "2025-01-01T00:00:00", id: "ffffffff-ffff-4fff-8fff-ffffffffffff" });
    await seedBatch(["tie-low"], { id: "00000000-0000-4000-8000-000000000001" });
    await seedBatch(["tie-high"], { id: "00000000-0000-4000-8000-000000000002" });

    const first = await history(1, 2);
    const second = await history(2, 2);
    const beyond = await history(3, 2);

    expect(first).toMatchObject({
      ok: true,
      data: { total: 3, totalPages: 2, batches: [{ referenceNumbers: ["tie-high"] }, { referenceNumbers: ["tie-low"] }] }
    });
    expect(second).toMatchObject({ ok: true, data: { total: 3, page: 2, batches: [{ referenceNumbers: ["old"] }] } });
    expect(beyond).toMatchObject({ ok: true, data: { total: 3, page: 3, batches: [] } });
    const raw = await (await fetch(`${mock.url}/caseworker/gazette-notices`, { headers: { authorization: `Bearer ${ADMIN}` } })).json();
    expect(raw.batches[0].sentAt).toBe(SENT_AT);
    expect(Object.keys(raw.batches[0]).sort()).toEqual(["batchId", "caseCount", "referenceNumbers", "referencesTruncated", "sentAt", "sentBy"]);
  });

  it("should apply default and capped page sizes to populated history", async () => {
    for (let n = 1; n <= 26; n++) await seedBatch([String(n)]);

    const first = await history();
    const capped = await history(1, 1000);

    expect(first).toMatchObject({ ok: true, data: { size: 25, total: 26, totalPages: 2 } });
    if (first.ok) expect(first.data.batches).toHaveLength(25);
    expect(capped).toMatchObject({ ok: true, data: { size: 100, total: 26, totalPages: 1 } });
    if (capped.ok) expect(capped.data.batches).toHaveLength(26);
  });

  it.each([[], ["caseworker-deedpoll"], ["caseworker-deedpoll-judicial"], ["admin"]])(
    "should refuse non-admin roles %j even with populated history",
    async (...roles) => {
      await seedBatch(["secret"]);

      expect(await history(1, 25, token(roles))).toMatchObject({ ok: false, error: { kind: "forbidden", status: 403 } });
    }
  );

  it("should refuse unauthenticated reads and unsupported methods", async () => {
    expect(await history(1, 25, "")).toMatchObject({ ok: false, error: { kind: "unauthorized", status: 401 } });
    expect((await fetch(`${mock.url}/caseworker/gazette-notices`, { method: "DELETE", headers: { authorization: `Bearer ${ADMIN}` } })).status).toBe(405);
  });

  it("should reject invalid fixture dates and repeated identities without replacing history", async () => {
    expect((await seedBatch(["invalid"], { sentAt: "not a date" })).status).toBe(400);
    const id = "00000000-0000-4000-8000-000000000001";
    expect((await seedBatch(["first"], { id })).status).toBe(201);
    expect((await seedBatch(["replacement"], { id })).status).toBe(409);

    expect(await history()).toMatchObject({ ok: true, data: { total: 1, batches: [{ referenceNumbers: ["first"] }] } });
  });

  it("should clear audit fixtures on reset and keep outage behaviour", async () => {
    await seedBatch(["one"]);
    mock.setScenario("api-unavailable");
    expect(await history()).toMatchObject({ ok: false, error: { kind: "unavailable" } });
    await fetch(`${mock.url}/__mock/reset`, { method: "POST" });
    mock.setScenario("happy-path");

    expect(await history()).toMatchObject({ ok: true, data: { batches: [], total: 0, totalPages: 0 } });
  });
});

describe("Gazette roles from local IDAM userinfo", () => {
  it.each([
    { status: 200, body: { roles: ["caseworker-deedpoll-admin"] }, expected: 200 },
    { status: 200, body: { roles: [] }, expected: 403 },
    { status: 200, body: { roles: "caseworker-deedpoll-admin" }, expected: 403 },
    { status: 200, body: null, expected: 401 },
    { status: 401, body: {}, expected: 401 },
    { status: 503, body: {}, expected: 401 }
  ])("should answer $expected for userinfo $status / $body", async ({ status, body, expected }) => {
    let forwarded: string | undefined;
    const issuer = createServer((req, res) => {
      forwarded = req.headers.authorization;
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    });
    await new Promise<void>((resolve) => issuer.listen(0, "127.0.0.1", resolve));
    const api = await startMockApi({ userInfoUrl: `http://127.0.0.1:${(issuer.address() as AddressInfo).port}/userinfo` });
    const accessToken = `x.${Buffer.from(JSON.stringify({ sub: "admin" })).toString("base64url")}.signature`;
    try {
      const response = await fetch(`${api.url}/caseworker/gazette-notices`, { headers: { authorization: `Bearer ${accessToken}` } });
      expect(response.status).toBe(expected);
      expect(forwarded).toBe(`Bearer ${accessToken}`);
    } finally {
      await api.close();
      await new Promise<void>((resolve, reject) => issuer.close((error) => (error ? reject(error) : resolve())));
    }
  });
});
