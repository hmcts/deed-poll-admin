import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ApiResult, DEED_POLL_STATE, getCase, listCases, listReferrals } from "../api/client.js";
import { type RunningMockApi, startMockApi } from "../mock/server.js";
import { seedDataset } from "./dataset.js";
import { type SeedCredentials, type SeedJournal, seedCases } from "./run.js";
import { seedJournalPath, seedTarget } from "./target.js";

const DATE = "2026-10-02";
const BATCH = "manual-test-01";
const CASEWORKER = `x.${Buffer.from(JSON.stringify({ sub: "seed-lead", roles: ["caseworker-deedpoll-team-leader"] })).toString("base64url")}.signature`;
/** The judge's Masters-list entry: the seeder sends referrals to it from the queue, and the judicial preflight links it. */
const SEED_MASTER_EMAIL = "seed-judge@masters.test";
const JUDGE = `x.${Buffer.from(JSON.stringify({ sub: "seed-judge", email: SEED_MASTER_EMAIL, roles: ["caseworker-deedpoll-judicial"] })).toString("base64url")}.signature`;
const CREDENTIALS = { caseworkerToken: CASEWORKER, judgeToken: JUDGE };
let mock: RunningMockApi | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  await mock?.close();
  mock = undefined;
});

describe("non-production seed target", () => {
  it.each(["aat", "demo", "ithc", "perftest", "preview", "sandbox", "sbox", "new-testing-env"])("should support explicit %s targets", (environment) => {
    expect(seedTarget(environment, `https://deed-poll-api.${environment}.platform.hmcts.net`).environment).toBe(environment);
  });
  it.each([
    ["prod", "http://localhost:4550"],
    ["PRODUCTION", "http://localhost:4550"],
    ["live", "http://localhost:4550"],
    ["aat", "https://deed-poll-api.prod.platform.hmcts.net"],
    ["aat", "https://deed-poll-api.production.platform.hmcts.net"],
    ["aat", "https://deed-poll-api.service.gov.uk"],
    ["aat", "https://deed-poll-api.demo.platform.hmcts.net"],
    ["aat", "http://deed-poll-api.aat.platform.hmcts.net"],
    ["aat", "https://user:secret@deed-poll-api.aat.platform.hmcts.net"],
    ["aat", "https://deed-poll-api.aat.platform.hmcts.net/?target=prod"],
    ["", "http://localhost:4550"]
  ])("should refuse environment %s at %s", (environment, url) => {
    expect(() => seedTarget(environment, url)).toThrow();
  });
  it("should allow local APIs and internal non-production services", () => {
    expect(seedTarget("local", "http://127.0.0.1:4550").baseUrl).toBe("http://127.0.0.1:4550");
    expect(seedTarget("aat", "http://deed-poll-api-aat.service.core-compute-aat.internal").environment).toBe("aat");
  });
});

describe("seedJournalPath", () => {
  const DATA = fileURLToPath(new URL("../../../../data/", import.meta.url));

  it("should default to the repository's data directory, named for the environment and batch", () => {
    expect(seedJournalPath("aat", "manual-testing-20261005")).toBe(join(DATA, "seed-aat-manual-testing-20261005.json"));
  });

  it("should accept an explicit journal inside data, absolute or relative", () => {
    expect(seedJournalPath("aat", BATCH, join(DATA, "seed-aat-manual-testing-20261002.json"))).toBe(join(DATA, "seed-aat-manual-testing-20261002.json"));
    expect(seedJournalPath("aat", BATCH, "nested/batch.json")).toBe(join(DATA, "nested", "batch.json"));
  });

  // Both arguments come off a command line an agent may be composing, and the journal is written, locked and kept
  // beside a credentials file — so neither may steer it out of data/.
  it.each(["../escape", "a/b", "UPPER", "-leading", ""])("should refuse the batch %j", (batch) => {
    expect(() => seedJournalPath("aat", batch)).toThrow("--batch");
  });

  it.each(["../outside.json", "/tmp/journal.json", "nested/../../outside.json", "journal.txt"])("should refuse the journal %j", (journal) => {
    expect(() => seedJournalPath("aat", BATCH, journal)).toThrow("--journal");
  });
});

describe("representative dataset", () => {
  it("should cover every published state and application type in exactly thirty plausible cases", () => {
    const cases = seedDataset(BATCH, DATE);
    const spec = JSON.parse(readFileSync(new URL("../../openapi.json", import.meta.url), "utf8"));
    expect(cases).toHaveLength(30);
    expect([...new Set(cases.map((row) => row.state))].sort()).toEqual([...DEED_POLL_STATE].sort());
    expect([...new Set(cases.map((row) => row.create.type))].sort()).toEqual(
      spec.components.schemas.CreateCaseRequest.properties.type.enum.filter(Boolean).sort()
    );
    expect(new Set(cases.map((row) => row.marker)).size).toBe(30);
    expect(new Set(cases.flatMap((row) => (row.referral ? [row.referral.state] : [])))).toEqual(new Set(["Open", "Claimed", "Decided", "Closed", "Withdrawn"]));
    for (const row of cases) {
      expect(row.create).not.toHaveProperty("state");
      expect(row.progress).not.toHaveProperty("state");
      expect(row.create.applicantEmail).toMatch(/@example\.invalid$/);
      const received = row.create.dateReceived as Date;
      expect(received.getTime()).toBeLessThan(new Date(DATE).getTime());
      if (["Enroled", "AwaitingEnrolment"].includes(row.state)) expect(row.witnesses.length).toBeGreaterThanOrEqual(2);
      for (const value of Object.values(row.progress)) if (value instanceof Date) expect(value.getTime()).toBeGreaterThanOrEqual(received.getTime());
      for (const field of [...Object.keys(row.create), ...Object.keys(row.progress)])
        expect(spec.components.schemas.CreateCaseRequest.properties).toHaveProperty(field);
    }
  });
  it("should refuse invalid dates and unsafe batch markers", () => {
    expect(() => seedDataset(BATCH, "2026-02-30")).toThrow();
    expect(() => seedDataset("../../oops", DATE)).toThrow();
  });
});

// These start a real HTTP mock and seed thirty cases through the adapter, so they take 3-4s normally and longer
// under coverage instrumentation. Vitest's 5s default failed PR-173's `test:coverage` stage at 5,051ms.
describe("seed through the real adapter over HTTP", { timeout: 20_000 }, () => {
  it("should seed and verify caseworker data without judicial requests, then resume those actions without duplicates", async () => {
    mock = await startMockApi();
    const credentials = await credentialsFor(mock);
    const journal = newJournal(mock.url);
    const config = { baseUrl: mock.url, accessToken: CASEWORKER };
    const requests = vi.spyOn(globalThis, "fetch");
    const caseworkerCredentials = { caseworkerToken: CASEWORKER };
    const persist = async () => {};
    const report = () => {};

    await seedCases(journal, caseworkerCredentials, persist, report, { deferJudicial: true });
    expect(journal.caseworkerComplete).toBe(true);
    expect(journal.complete).toBe(false);
    expect(journal.deferredJudicial).toHaveLength(5);
    expect(requests.mock.calls.some(([url]) => String(url).includes("/judicial/"))).toBe(false);
    const all = unwrap(await listCases({ size: 100 }, config));
    expect(all.total).toBe(30);
    expect([...new Set(all.cases.map((row) => row.state))].sort()).toEqual([...DEED_POLL_STATE].sort());
    const referralsBefore = (await Promise.all(Object.values(journal.cases).map(async ({ id }) => unwrap(await listReferrals(id, config))))).flat();
    expect(referralsBefore.filter((referral) => referral.state === "Open")).toHaveLength(6);
    expect(referralsBefore.filter((referral) => referral.state === "Withdrawn")).toHaveLength(1);
    const casesBefore = structuredClone(journal.cases);
    const stepsBefore = structuredClone(journal.steps);

    await seedCases(journal, caseworkerCredentials, persist, report, { deferJudicial: true });
    expect(journal.steps).toEqual(stepsBefore);
    expect(requests.mock.calls.some(([url]) => String(url).includes("/judicial/"))).toBe(false);
    await seedCases(journal, credentials, persist, report);
    expect(journal.complete).toBe(true);
    expect(journal.deferredJudicial).toEqual([]);
    expect(journal.cases).toEqual(casesBefore);
    expect(unwrap(await listCases({ size: 100 }, config)).total).toBe(30);
    const referralsAfter = (await Promise.all(Object.values(journal.cases).map(async ({ id }) => unwrap(await listReferrals(id, config))))).flat();
    expect(referralsAfter.map((referral) => referral.id)).toEqual(referralsBefore.map((referral) => referral.id));
    expect(referralsAfter.filter((referral) => referral.state === "Decided")).toHaveLength(2);
    expect(referralsAfter.filter((referral) => referral.state === "Closed")).toHaveLength(2);
    await seedCases(journal, caseworkerCredentials, persist, report, { deferJudicial: true });
    expect(journal.complete).toBe(true);
  });
  it("should resume a journal written before api D2, reading its claim steps as assignments already made", async () => {
    mock = await startMockApi();
    const credentials = await credentialsFor(mock);
    const journal = newJournal(mock.url);
    const persist = async () => {};
    const report = () => {};
    await seedCases(journal, credentials, persist, report);
    // The journal an older seeder left: the same referrals, advanced by a claim rather than an assignment.
    const assignSteps = Object.keys(journal.steps).filter((name) => name.endsWith("/assign"));
    expect(assignSteps.length).toBeGreaterThan(0);
    journal.steps = Object.fromEntries(Object.entries(journal.steps).map(([name, data]) => [name.replace(/\/assign$/, "/claim"), data]));
    const requests = vi.spyOn(globalThis, "fetch");

    await seedCases(journal, credentials, persist, report);
    await seedCases(journal, { caseworkerToken: CASEWORKER }, persist, report, { deferJudicial: true });

    expect(requests.mock.calls.some(([url]) => String(url).endsWith("/referral-queue/sends"))).toBe(false);
    expect(Object.keys(journal.steps).some((name) => name.endsWith("/assign"))).toBe(false);
    expect(journal.complete).toBe(true);
  });
  it("should still require a judicial token before any writes unless those actions are explicitly deferred", async () => {
    mock = await startMockApi();
    await expect(
      seedCases(
        newJournal(mock.url),
        { caseworkerToken: CASEWORKER },
        async () => {},
        () => {}
      )
    ).rejects.toThrow("judicial access token");
    expect(unwrap(await listCases({}, { baseUrl: mock.url })).total).toBe(0);
  });
  it("should create all states, preserve unrelated data and verify a repeat run without adding duplicates", async () => {
    mock = await startMockApi();
    const credentials = await credentialsFor(mock);
    const existing = mock.seed({ newForename: "Existing", newSurname: "User" });
    const journal = newJournal(mock.url);
    const saved: SeedJournal[] = [];
    await seedCases(
      journal,
      credentials,
      async () => {
        saved.push(structuredClone(journal));
      },
      () => {}
    );
    expect(journal.complete).toBe(true);
    expect(Object.keys(journal.cases)).toHaveLength(30);
    expect(saved.some((entry) => entry.pending)).toBe(true);
    const config = { baseUrl: mock.url, accessToken: CASEWORKER };
    const all = unwrap(await listCases({ size: 100 }, config));
    expect(all.total).toBe(31);
    expect(unwrap(await getCase(existing.id, config)).newForename).toBe("Existing");
    expect([...new Set(all.cases.map((row) => row.state))].sort()).toEqual([...DEED_POLL_STATE].sort());
    await seedCases(
      JSON.parse(JSON.stringify(journal)),
      credentials,
      async () => {},
      () => {}
    );
    expect(unwrap(await listCases({ size: 100 }, config)).total).toBe(31);
    await expect(
      seedCases(
        newJournal(mock.url),
        credentials,
        async () => {},
        () => {}
      )
    ).rejects.toThrow("already exists");
  });
  it("should leave a lost create response pending and refuse to repeat it", async () => {
    mock = await startMockApi();
    const credentials = await credentialsFor(mock);
    const destination = mock.url;
    const proxy = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const response = await fetch(`${destination}${req.url}`, {
        method: req.method,
        headers: { "content-type": "application/json", authorization: `Bearer ${CASEWORKER}` },
        body: chunks.length ? Buffer.concat(chunks) : undefined
      });
      if (req.method === "POST") {
        await response.text();
        res.destroy();
        return;
      }
      res.writeHead(response.status, { "content-type": "application/json" });
      res.end(await response.text());
    });
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    const address = proxy.address();
    if (!address || typeof address === "string") throw new Error("No proxy port");
    const journal = newJournal(`http://127.0.0.1:${address.port}`);
    try {
      await expect(
        seedCases(
          journal,
          credentials,
          async () => {},
          () => {}
        )
      ).rejects.toThrow("unavailable");
      expect(journal.pending).toMatch(/\/create$/);
      expect(unwrap(await listCases({}, { baseUrl: destination })).total).toBe(1);
      await expect(
        seedCases(
          journal,
          credentials,
          async () => {},
          () => {}
        )
      ).rejects.toThrow("Uncertain write");
      expect(unwrap(await listCases({}, { baseUrl: destination })).total).toBe(1);
    } finally {
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
    }
  });
  it("should refuse redirects rather than follow an explicitly selected API into another environment", async () => {
    mock = await startMockApi();
    const credentials = await credentialsFor(mock);
    const destination = mock.url;
    let requests = 0;
    const redirect = createServer((_req, res) => {
      requests++;
      res.writeHead(307, { location: `${destination}/caseworker/cases` });
      res.end();
    });
    await new Promise<void>((resolve) => redirect.listen(0, "127.0.0.1", resolve));
    const address = redirect.address();
    if (!address || typeof address === "string") throw new Error("No redirect port");
    try {
      await expect(
        seedCases(
          newJournal(`http://127.0.0.1:${address.port}`),
          credentials,
          async () => {},
          () => {}
        )
      ).rejects.toThrow("preflight");
      expect(requests).toBe(1);
      expect(unwrap(await listCases({}, { baseUrl: destination })).total).toBe(0);
    } finally {
      await new Promise<void>((resolve) => redirect.close(() => resolve()));
    }
  });
  it("should refuse an uncertain write before making further requests", async () => {
    const journal = { ...newJournal("http://127.0.0.1:1"), pending: "SEED-test/create" };
    await expect(
      seedCases(
        journal,
        { ...CREDENTIALS, masterId: "unused" },
        async () => {},
        () => {}
      )
    ).rejects.toThrow("Uncertain write");
  });
  it("should make no writes if credentials fail during preflight", async () => {
    mock = await startMockApi({ scenario: "unauthorized" });
    const journal = newJournal(mock.url);
    await expect(
      seedCases(
        journal,
        { ...CREDENTIALS, masterId: "unused" },
        async () => {},
        () => {}
      )
    ).rejects.toThrow("preflight");
    expect(journal.steps).toEqual({});
    expect(journal.cases).toEqual({});
  });
  it("should persist a pending operation before writing so a lost checkpoint cannot silently duplicate data", async () => {
    mock = await startMockApi();
    const credentials = await credentialsFor(mock);
    const journal = newJournal(mock.url);
    await expect(
      seedCases(
        journal,
        credentials,
        async () => {
          throw new Error("Disk full");
        },
        () => {}
      )
    ).rejects.toThrow("Disk full");
    expect(journal.pending).toMatch(/\/create$/);
    expect(unwrap(await listCases({}, { baseUrl: mock.url })).total).toBe(0);
  });
});

function newJournal(baseUrl: string): SeedJournal {
  return { version: 1, environment: "test", baseUrl, batch: BATCH, asOf: DATE, steps: {}, cases: {} };
}
function unwrap<T>(result: ApiResult<T>): T {
  if (!result.ok) throw new Error(result.error.kind);
  return result.data;
}

/** The fixture judge's Masters-list entry, added to this mock by a Delivery Manager, with credentials naming it. */
async function credentialsFor(api: RunningMockApi): Promise<SeedCredentials> {
  const manager = `x.${Buffer.from(JSON.stringify({ sub: "manager", roles: ["caseworker-deedpoll-delivery-manager"] })).toString("base64url")}.signature`;
  const response = await fetch(`${api.url}/caseworker/masters`, {
    method: "POST",
    headers: { authorization: `Bearer ${manager}`, "content-type": "application/json" },
    body: JSON.stringify({ name: "Seed Judge", email: SEED_MASTER_EMAIL })
  });
  const { id } = (await response.json()) as { id: string };
  // Since api F1 the Team leader sends referrals only inside a referral window.
  await fetch(`${api.url}/__mock/clock`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ window: "open" }) });
  return { ...CREDENTIALS, masterId: id };
}
