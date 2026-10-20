// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: CLI-only credentials, never passed to the application or Turbo.
import { execFile } from "node:child_process";
import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseArgs, promisify } from "node:util";
import { checkApiReachable } from "../api/client.js";
import { seedTestAccounts } from "./accounts.js";
import { seedDataset } from "./dataset.js";
import { type SeedCredentials, type SeedJournal, seedCases } from "./run.js";
import { seedJournalPath, seedTarget } from "./target.js";

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Seeding failed.");
  process.exitCode = 1;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      environment: { type: "string" },
      "api-url": { type: "string" },
      batch: { type: "string" },
      "as-of": { type: "string" },
      journal: { type: "string" },
      "create-test-users": { type: "boolean", default: false },
      "defer-judicial": { type: "boolean", default: false },
      "client-id": { type: "string", default: "deed-poll-admin" },
      vault: { type: "string" },
      "secret-name": { type: "string", default: "admin-idam-client-secret" },
      apply: { type: "boolean", default: false },
      help: { type: "boolean" }
    }
  });
  if (values.help) {
    console.log(
      "seed:cases --environment <non-prod> --api-url <origin> --batch <unique-name> [--as-of YYYY-MM-DD] [--journal path] [--defer-judicial] [--apply]\nWithout --apply, prints the 30-case plan without network calls. Apply requires SEED_CASEWORKER_TOKEN and SEED_JUDGE_TOKEN, or --create-test-users (Azure CLI + IDAM testing support). --defer-judicial needs only the caseworker/admin token and provisions only the admin fixture. Resume without this flag later to complete judicial actions. Optional: --client-id, --vault, --secret-name. Keep the journal to resume; production is refused."
    );
    return;
  }
  if (!values.environment || !values["api-url"] || !values.batch) throw new Error("Supply --environment, --api-url and --batch. Use --help for usage.");
  const target = seedTarget(values.environment, values["api-url"]);
  const filename = seedJournalPath(target.environment, values.batch, values.journal);
  const journal = await loadJournal(filename, target, values.batch, values["as-of"]);
  const dataset = seedDataset(journal.batch, journal.asOf);
  const options = { deferJudicial: values["defer-judicial"] };
  // The host alone: `seedTarget` has already refused credentials, but nothing on a command line belongs in a log whole.
  console.log(`${target.environment}: ${new URL(target.baseUrl).host}; batch ${journal.batch}; scenario date ${journal.asOf}`);
  if (options.deferJudicial)
    console.log("Judicial claims, directions and their subsequent referral closures are deferred. Existing completed operations are preserved.");
  console.table(
    dataset.map((item) => ({
      marker: item.marker,
      name: `${item.create.newForename} ${item.create.newSurname}`,
      type: item.create.type,
      state: item.state,
      witnesses: item.witnesses.length,
      referral:
        options.deferJudicial && item.referral && ["Claimed", "Decided", "Closed"].includes(item.referral.state)
          ? "Open (judicial actions deferred)"
          : (item.referral?.state ?? "—")
    }))
  );
  if (!values.apply) return;
  let credentials: SeedCredentials = { caseworkerToken: process.env.SEED_CASEWORKER_TOKEN ?? "", judgeToken: process.env.SEED_JUDGE_TOKEN ?? "" };
  if (!values["create-test-users"] && (!credentials.caseworkerToken || (!options.deferJudicial && !credentials.judgeToken)))
    throw new Error("Set SEED_CASEWORKER_TOKEN and, unless --defer-judicial, SEED_JUDGE_TOKEN; or select --create-test-users before --apply.");
  await mkdir(dirname(filename), { recursive: true });
  const lock = await open(`${filename}.lock`, "wx", 0o600);
  try {
    if (values["create-test-users"]) {
      credentials = await createTestCredentials(target, filename, {
        vault: values.vault,
        secretName: values["secret-name"],
        clientId: values["client-id"],
        ...options
      });
    }
    await seedCases(
      journal,
      credentials,
      async () => {
        await writeFile(`${filename}.tmp`, `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600 });
        await rename(`${filename}.tmp`, filename);
      },
      console.log,
      options
    );
    console.log(`Case IDs and completed operations recorded in ${filename}`);
  } finally {
    await lock.close();
    await unlink(`${filename}.lock`);
  }
}

async function loadJournal(filename: string, target: ReturnType<typeof seedTarget>, batch: string, asOf?: string): Promise<SeedJournal> {
  try {
    const journal = JSON.parse(await readFile(filename, "utf8")) as SeedJournal;
    if (
      journal.version !== 1 ||
      journal.baseUrl !== target.baseUrl ||
      journal.environment !== target.environment ||
      journal.batch !== batch ||
      (asOf && journal.asOf !== asOf) ||
      !journal.steps ||
      !journal.cases
    ) {
      throw new Error("Journal does not match this target, dataset version, batch or date.");
    }
    return journal;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    return { version: 1, ...target, batch, asOf: asOf ?? new Date().toISOString().slice(0, 10), steps: {}, cases: {} };
  }
}

async function createTestCredentials(target: ReturnType<typeof seedTarget>, filename: string, options: TestAccountOptions): Promise<SeedCredentials> {
  const reachable = await checkApiReachable({ baseUrl: target.baseUrl });
  if (!reachable.ok) throw new Error(`API is unreachable (${reachable.error.kind}); no IDAM users were created. Check DNS and VPN.`);
  const vault = options.vault ?? `deed-poll-${target.environment}`;
  if (!vault.endsWith(`-${target.environment}`) || /(^|-)(prod|production|live)(-|$)/i.test(vault))
    throw new Error("Vault must belong to the selected non-production environment.");
  let clientSecret: string;
  try {
    const result = await promisify(execFile)(
      "az",
      ["keyvault", "secret", "show", "--vault-name", vault, "--name", options.secretName, "--query", "value", "--output", "tsv"],
      { timeout: 30_000 }
    );
    clientSecret = result.stdout.trim();
    if (!clientSecret) throw new Error("Empty client secret");
  } catch {
    throw new Error("Could not read the IDAM client secret using Azure CLI. Check az login and vault access.");
  }
  const credentials = await seedTestAccounts({
    environment: target.environment,
    clientId: options.clientId,
    clientSecret,
    issuerUrl: `https://hmcts-access.${target.environment}.platform.hmcts.net/o`,
    supportUrl: `https://idam-testing-support-api.${target.environment}.platform.hmcts.net`,
    filename: `${filename}.accounts.json`,
    deferJudicial: options.deferJudicial
  });
  console.log(
    options.deferJudicial ? "Temporary admin test account authenticated; judge account untouched." : "Temporary admin and judicial test accounts authenticated."
  );
  console.log("Credentials are retained privately beside the journal for resuming.");
  return credentials;
}

interface TestAccountOptions {
  vault?: string;
  secretName: string;
  clientId: string;
  deferJudicial: boolean;
}
