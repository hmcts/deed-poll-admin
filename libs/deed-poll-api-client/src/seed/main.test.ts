import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { seedJournalPath } from "./target.js";

const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  mkdir: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
  unlink: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn(),
  readSecret: vi.fn(),
  reachable: vi.fn(),
  accounts: vi.fn(),
  seed: vi.fn()
}));
vi.mock("node:fs/promises", () => ({
  readFile: mocks.readFile,
  mkdir: mocks.mkdir,
  open: mocks.open,
  unlink: mocks.unlink,
  writeFile: mocks.writeFile,
  rename: mocks.rename
}));
vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  return { execFile: Object.assign(vi.fn(), { [promisify.custom]: mocks.readSecret }) };
});
vi.mock("../api/client.js", () => ({ checkApiReachable: mocks.reachable }));
vi.mock("./accounts.js", () => ({ seedTestAccounts: mocks.accounts }));
vi.mock("./run.js", () => ({ seedCases: mocks.seed }));

const ARGV = process.argv;
const EXIT_CODE = process.exitCode;
const FILENAME = seedJournalPath("aat", "cli-test");
const CREDENTIALS = { caseworkerToken: "fixture-caseworker-token", judgeToken: "fixture-judge-token" };
const MASTER_ID = "fixture-master-id";

const JOURNAL = {
  version: 1,
  environment: "aat",
  baseUrl: "http://localhost:3200",
  batch: "cli-test",
  asOf: "2026-10-02",
  steps: { completed: { id: "existing" } },
  cases: {}
};

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "table").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("SEED_CASEWORKER_TOKEN", "");
  vi.stubEnv("SEED_JUDGE_TOKEN", "");
  vi.stubEnv("SEED_MASTER_ID", MASTER_ID);
  process.exitCode = 0;
  mocks.readFile.mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }));
  mocks.open.mockResolvedValue({ close: mocks.close });
  mocks.reachable.mockResolvedValue({ ok: true, data: undefined });
  mocks.readSecret.mockResolvedValue({ stdout: " fixture-secret \n" });
  mocks.accounts.mockResolvedValue(CREDENTIALS);
});

afterEach(() => {
  process.argv = ARGV;
  process.exitCode = EXIT_CODE;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function run(...args: string[]) {
  process.argv = ["node", "seed", "--environment", "aat", "--api-url", "http://localhost:3200", "--batch", "cli-test", "--as-of", "2026-10-02", ...args];
  await import("./main.js");
}

it("should keep a dry run free of provisioning, locks and writes even when test accounts are requested", async () => {
  await run("--create-test-users");

  expect(process.exitCode).toBe(0);
  expect(console.table).toHaveBeenCalledWith(expect.any(Array));
  expect(mocks.reachable).not.toHaveBeenCalled();
  expect(mocks.readSecret).not.toHaveBeenCalled();
  expect(mocks.accounts).not.toHaveBeenCalled();
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.mkdir).not.toHaveBeenCalled();
  expect(mocks.seed).not.toHaveBeenCalled();
  expect(mocks.writeFile).not.toHaveBeenCalled();
});

it.each([false, true])("should provision under the lock, forward options and persist privately (deferJudicial=%s)", async (deferJudicial) => {
  mocks.seed.mockImplementation(async (_journal, _credentials, persist) => persist());

  await run("--apply", "--create-test-users", "--client-id", "fixture-client", "--secret-name", "fixture-name", ...(deferJudicial ? ["--defer-judicial"] : []));

  expect(process.exitCode).toBe(0);
  expect(mocks.open).toHaveBeenCalledWith(`${FILENAME}.lock`, "wx", 0o600);
  expect(mocks.reachable).toHaveBeenCalledWith({ baseUrl: "http://localhost:3200" });
  expect(mocks.readSecret).toHaveBeenCalledWith(
    "az",
    ["keyvault", "secret", "show", "--vault-name", "deed-poll-aat", "--name", "fixture-name", "--query", "value", "--output", "tsv"],
    { timeout: 30_000 }
  );
  expect(mocks.accounts).toHaveBeenCalledWith({
    environment: "aat",
    clientId: "fixture-client",
    clientSecret: "fixture-secret",
    issuerUrl: "https://hmcts-access.aat.platform.hmcts.net/o",
    supportUrl: "https://idam-testing-support-api.aat.platform.hmcts.net",
    filename: `${FILENAME}.accounts.json`,
    deferJudicial
  });
  expect(mocks.seed).toHaveBeenCalledWith(
    expect.objectContaining({ batch: "cli-test", asOf: "2026-10-02" }),
    { ...CREDENTIALS, masterId: MASTER_ID },
    expect.any(Function),
    console.log,
    {
      deferJudicial
    }
  );
  const operations = [mocks.open, mocks.reachable, mocks.readSecret, mocks.accounts, mocks.seed, mocks.writeFile, mocks.rename, mocks.close, mocks.unlink];
  const order = operations.map((operation) => operation.mock.invocationCallOrder[0]);
  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(mocks.writeFile).toHaveBeenCalledWith(`${FILENAME}.tmp`, expect.stringContaining('"batch": "cli-test"'), { mode: 0o600 });
  expect(mocks.rename).toHaveBeenCalledWith(`${FILENAME}.tmp`, FILENAME);
  expect(mocks.unlink).toHaveBeenCalledWith(`${FILENAME}.lock`);
});

it.each([
  ["unreachable", "API is unreachable (unavailable); no IDAM users were created. Check DNS and VPN."],
  ["wrong-vault", "Vault must belong to the selected non-production environment."],
  ["production-vault", "Vault must belong to the selected non-production environment."],
  ["secret-error", "Could not read the IDAM client secret using Azure CLI. Check az login and vault access."],
  ["empty-secret", "Could not read the IDAM client secret using Azure CLI. Check az login and vault access."]
])("should stop on %s and release the lock without provisioning or seeding", async (failure, message) => {
  if (failure === "unreachable") mocks.reachable.mockResolvedValue({ ok: false, error: { kind: "unavailable" } });
  if (failure === "secret-error") mocks.readSecret.mockRejectedValue(new Error("private diagnostic"));
  if (failure === "empty-secret") mocks.readSecret.mockResolvedValue({ stdout: " \n" });
  const args = failure === "wrong-vault" ? ["--vault", "deed-poll-demo"] : failure === "production-vault" ? ["--vault", "prod-aat"] : [];

  await run("--apply", "--create-test-users", ...args);

  expect(process.exitCode).toBe(1);
  expect(console.error).toHaveBeenCalledExactlyOnceWith(message);
  expect(mocks.accounts).not.toHaveBeenCalled();
  expect(mocks.seed).not.toHaveBeenCalled();
  expect(mocks.close).toHaveBeenCalledOnce();
  expect(mocks.unlink).toHaveBeenCalledWith(`${FILENAME}.lock`);
  if (failure === "unreachable" || failure.endsWith("vault")) expect(mocks.readSecret).not.toHaveBeenCalled();
});

it.each(["accounts", "seed"] as const)("should propagate a %s failure and release the acquired lock", async (operation) => {
  mocks[operation].mockRejectedValue(new Error("operation failed"));

  await run("--apply", "--create-test-users");

  expect(process.exitCode).toBe(1);
  expect(console.error).toHaveBeenCalledExactlyOnceWith("operation failed");
  expect(mocks.close).toHaveBeenCalledOnce();
  expect(mocks.unlink).toHaveBeenCalledWith(`${FILENAME}.lock`);
  if (operation === "accounts") expect(mocks.seed).not.toHaveBeenCalled();
});

it("should use supplied credentials without provisioning", async () => {
  vi.stubEnv("SEED_CASEWORKER_TOKEN", CREDENTIALS.caseworkerToken);

  await run("--apply", "--defer-judicial");

  expect(process.exitCode).toBe(0);
  expect(mocks.seed).toHaveBeenCalledWith(expect.anything(), { ...CREDENTIALS, judgeToken: "", masterId: MASTER_ID }, expect.any(Function), console.log, {
    deferJudicial: true
  });
  expect(mocks.reachable).not.toHaveBeenCalled();
  expect(mocks.readSecret).not.toHaveBeenCalled();
  expect(mocks.accounts).not.toHaveBeenCalled();
});

it("should refuse judicial actions without the judge's Masters-list id before taking the lock", async () => {
  vi.stubEnv("SEED_MASTER_ID", "");

  await run("--apply", "--create-test-users");

  expect(process.exitCode).toBe(1);
  expect(console.error).toHaveBeenCalledExactlyOnceWith(
    "Set SEED_MASTER_ID to the judge's Masters-list id (api D2 assigns referrals to it), or select --defer-judicial before --apply."
  );
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.seed).not.toHaveBeenCalled();
});

it("should retain an existing journal's completed operations when resuming", async () => {
  mocks.readFile.mockResolvedValue(JSON.stringify(JOURNAL));

  await run("--apply", "--create-test-users");

  expect(process.exitCode).toBe(0);
  expect(mocks.seed.mock.calls[0][0]).toEqual(JOURNAL);
});

it.each([
  { version: 2 },
  { environment: "demo" },
  { baseUrl: "http://localhost:3201" },
  { batch: "another-batch" },
  { asOf: "2026-10-01" },
  { steps: null },
  { cases: null }
])("should refuse a mismatched or incomplete journal before provisioning (%j)", async (override) => {
  mocks.readFile.mockResolvedValue(JSON.stringify({ ...JOURNAL, ...override }));

  await run("--apply", "--create-test-users");

  expect(process.exitCode).toBe(1);
  expect(console.error).toHaveBeenCalledExactlyOnceWith("Journal does not match this target, dataset version, batch or date.");
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.reachable).not.toHaveBeenCalled();
  expect(mocks.accounts).not.toHaveBeenCalled();
  expect(mocks.seed).not.toHaveBeenCalled();
});

it.each(["invalid-json", "permission-denied"])("should not replace an unreadable journal (%s)", async (failure) => {
  if (failure === "invalid-json") mocks.readFile.mockResolvedValue("{");
  else mocks.readFile.mockRejectedValue(Object.assign(new Error("permission denied"), { code: "EACCES" }));

  await run("--apply", "--create-test-users");

  expect(process.exitCode).toBe(1);
  expect(console.error).toHaveBeenCalledOnce();
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.seed).not.toHaveBeenCalled();
  expect(mocks.writeFile).not.toHaveBeenCalled();
});
