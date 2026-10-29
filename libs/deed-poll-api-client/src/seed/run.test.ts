import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getCase, listCases, patchCase } from "../api/client.js";
import { type RunningMockApi, startMockApi } from "../mock/server.js";
import { type SeedCredentials, type SeedJournal, seedCases } from "./run.js";

/** The judge's Masters-list entry: since api D2 the seeder assigns referrals to it, and the judicial preflight links it. */
const SEED_MASTER_EMAIL = "seed-judge@masters.test";
const CREDENTIALS = {
  caseworkerToken: "mock-caseworker",
  judgeToken: `x.${Buffer.from(JSON.stringify({ sub: "seed-judge", email: SEED_MASTER_EMAIL, roles: ["caseworker-deedpoll-judicial"] })).toString("base64url")}.signature`
};
const CREATE = "SEED-runner-test-01/create";
let mock: RunningMockApi;
let proxy: Server | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  if (proxy) await new Promise<void>((resolve, reject) => proxy?.close((error) => (error ? reject(error) : resolve())));
  proxy = undefined;
  await mock?.close();
});

describe("seed runner checkpoints", { timeout: 20_000 }, () => {
  it.each([
    [400, false],
    [401, false],
    [403, false],
    [404, false],
    [408, true],
    [409, false],
    [422, false],
    [429, false],
    [500, true],
    [503, true]
  ] as const)("should preserve the pending-write classification for HTTP %i", async (status, remainsPending) => {
    mock = await startMockApi();
    const credentials = await credentialsFor(mock);
    const events: string[] = [];
    const url = await intercept((req, res) => {
      if (req.method !== "POST") return false;
      events.push("write");
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Synthetic refusal" }));
      return true;
    });
    const journal = newJournal(url);
    const saved: SeedJournal[] = [];
    const persist = async () => {
      events.push(journal.pending ? "pending" : "cleared");
      saved.push(structuredClone(journal));
    };

    await expect(seedCases(journal, credentials, persist, () => {})).rejects.toThrow(`(${status})`);

    expect(events).toEqual(remainsPending ? ["pending", "write"] : ["pending", "write", "cleared"]);
    expect(journal.pending).toBe(remainsPending ? CREATE : undefined);
    expect(saved.at(-1)?.pending).toBe(journal.pending);
    expect(journal.steps).toEqual({});
    expect(journal.cases).toEqual({});
    if (remainsPending) {
      await expect(seedCases(journal, credentials, persist, () => {})).rejects.toThrow("Uncertain write");
      expect(events).toEqual(["pending", "write"]);
    }
  });

  it("should refuse judicial actions without the judge's Masters-list id before any request", async () => {
    mock = await startMockApi();
    const requests = vi.spyOn(globalThis, "fetch");

    await expect(
      seedCases(
        newJournal(mock.url),
        CREDENTIALS,
        async () => {},
        () => {}
      )
    ).rejects.toThrow("Masters-list id");

    expect(requests).not.toHaveBeenCalled();
  });

  it("should assign the claimed and directed referrals to the judge's Masters-list entry", async () => {
    mock = await startMockApi();
    const credentials = await credentialsFor(mock);
    const journal = newJournal(mock.url);

    await seedCases(
      journal,
      credentials,
      async () => {},
      () => {}
    );

    const assigned = Object.keys(journal.steps).filter((step) => step.endsWith("/assign"));
    expect(assigned).toHaveLength(5);
    expect(Object.keys(journal.steps).some((step) => step.endsWith("/claim"))).toBe(false);
  });

  it("should finish both preflights before the first write and stop on a judicial refusal", async () => {
    mock = await startMockApi();
    const credentials = await credentialsFor(mock);
    const requests: string[] = [];
    const url = await intercept((req, res) => {
      requests.push(`${req.method} ${req.url}`);
      if (!req.url?.startsWith("/judicial/")) return false;
      res.writeHead(403, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Synthetic judicial refusal" }));
      return true;
    });
    const journal = newJournal(url);
    const persist = vi.fn(async () => {});

    await expect(seedCases(journal, credentials, persist, () => {})).rejects.toThrow("judicial preflight");

    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatch(/^GET \/caseworker\/cases\?/);
    expect(requests[1]).toMatch(/^GET \/judicial\/referrals\/mine\?/);
    expect(persist).not.toHaveBeenCalled();
    expect(journal.steps).toEqual({});
  });

  it("should leave the durable checkpoint uncertain when saving a successful response fails", async () => {
    mock = await startMockApi();
    const credentials = await credentialsFor(mock);
    const journal = newJournal(mock.url);
    const saved: SeedJournal[] = [];
    const persist = async () => {
      if (saved.length) throw new Error("Checkpoint disk failure");
      saved.push(structuredClone(journal));
    };

    await expect(seedCases(journal, credentials, persist, () => {})).rejects.toThrow("Checkpoint disk failure");

    expect(saved[0].pending).toBe(CREATE);
    expect(saved[0].steps).toEqual({});
    expect(journal.steps).toHaveProperty(CREATE);
    const requests = vi.spyOn(globalThis, "fetch");
    await expect(seedCases(saved[0], credentials, persist, () => {})).rejects.toThrow("Uncertain write");
    expect(requests).not.toHaveBeenCalled();
    const result = await listCases({}, { baseUrl: mock.url });
    expect(result.ok && result.data.total).toBe(1);
  });

  it("should verify completed cases again and leave a manual edit untouched", async () => {
    mock = await startMockApi();
    const credentials = await credentialsFor(mock);
    const journal = newJournal(mock.url);
    const persist = async () => {};
    await seedCases(journal, credentials, persist, () => {});
    const id = journal.cases["SEED-runner-test-01"].id;
    const config = { baseUrl: mock.url, accessToken: CREDENTIALS.caseworkerToken };
    expect((await patchCase(id, { urgency: "Urgent", urgencyreason: "Manual test edit" }, config)).ok).toBe(true);
    const requests = vi.spyOn(globalThis, "fetch");

    await expect(seedCases(journal, credentials, persist, () => {})).rejects.toThrow("read-back differs");

    expect(requests.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
    const result = await getCase(id, config);
    expect(result.ok && result.data.urgency).toBe("Urgent");
  });
});

async function intercept(handle: (req: IncomingMessage, res: ServerResponse) => boolean): Promise<string> {
  proxy = createServer(async (req, res) => {
    if (handle(req, res)) {
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const response = await fetch(`${mock.url}${req.url}`, {
      method: req.method,
      headers: { "content-type": "application/json", authorization: req.headers.authorization ?? "" },
      body: chunks.length ? Buffer.concat(chunks) : undefined
    });
    res.writeHead(response.status, { "content-type": "application/json" });
    res.end(await response.text());
  });
  await new Promise<void>((resolve) => proxy?.listen(0, "127.0.0.1", resolve));
  const address = proxy.address();
  if (!address || typeof address === "string") throw new Error("No proxy port");
  return `http://127.0.0.1:${address.port}`;
}

function newJournal(baseUrl: string): SeedJournal {
  return { version: 1, environment: "test", baseUrl, batch: "runner-test", asOf: "2026-10-02", steps: {}, cases: {} };
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
  return { ...CREDENTIALS, masterId: id };
}
