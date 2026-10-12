import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { SeedCredentials } from "./run.js";
import { seedTarget } from "./target.js";

/** Stable fixture IDs keep a resumed judicial claim attached to the same subject after AAT cleanup. */
export async function seedTestAccounts(options: TestAccountOptions): Promise<SeedCredentials> {
  seedTarget(options.environment, new URL(options.issuerUrl).origin);
  seedTarget(options.environment, options.supportUrl);
  const identity = { environment: options.environment, clientId: options.clientId, issuerUrl: options.issuerUrl, supportUrl: options.supportUrl };
  let accounts: Accounts;
  try {
    accounts = JSON.parse(await readFile(options.filename, "utf8")) as Accounts;
    if (JSON.stringify(accounts.identity) !== JSON.stringify(identity)) throw new Error("Seed account file belongs to a different IDAM environment or client.");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    // Keep the journal key and subject IDs stable; this account now holds Team leader.
    accounts = { identity, admin: account("admin"), judge: account("judge") };
    await mkdir(dirname(options.filename), { recursive: true });
    // Persist before creating anything: a failed request can be retried using exactly the same fixture UUID.
    await writeFile(options.filename, `${JSON.stringify(accounts, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  }
  const discovery = await request(`${options.issuerUrl}/.well-known/openid-configuration`);
  if (typeof discovery.token_endpoint !== "string" || discovery.issuer !== options.issuerUrl)
    throw new Error("IDAM discovery returned an unexpected issuer or token endpoint.");
  if (new URL(discovery.token_endpoint).origin !== new URL(options.issuerUrl).origin)
    throw new Error("IDAM token endpoint is outside the selected issuer origin.");
  const clientToken = await token(discovery.token_endpoint, { grant_type: "client_credentials", scope: "profile roles" });
  const result: SeedCredentials = { caseworkerToken: "" };
  for (const persona of ["admin", "judge"] as const) {
    if (persona === "judge" && options.deferJudicial) continue;
    const user = accounts[persona];
    await request(`${options.supportUrl}/test/idam/users/${user.id}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${clientToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        password: user.password,
        user: {
          id: user.id,
          email: user.email,
          forename: "Synthetic",
          surname: `Seed ${persona}`,
          roleNames: [persona === "admin" ? "caseworker-deedpoll-team-leader" : "caseworker-deedpoll-judicial"]
        }
      })
    });
    const accessToken = await token(discovery.token_endpoint, {
      grant_type: "password",
      scope: "openid profile roles",
      username: user.email,
      password: user.password
    });
    result[persona === "admin" ? "caseworkerToken" : "judgeToken"] = accessToken;
  }
  return result;

  async function token(endpoint: string, fields: Record<string, string>): Promise<string> {
    const response = await request(endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...fields, client_id: options.clientId, client_secret: options.clientSecret })
    });
    if (typeof response.access_token !== "string") throw new Error("IDAM returned no access token.");
    return response.access_token;
  }
}

function account(persona: string): TestAccount {
  const id = randomUUID();
  return { id, email: `deedpoll-seed-${persona}-${id}@mailnesia.com`, password: `Dp9_${randomBytes(18).toString("hex")}` };
}

async function request(url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new Error(`Cannot reach IDAM at ${new URL(url).host}. Check the selected environment, DNS and VPN.`);
  }
  // Never print a token-endpoint or testing-support body: either may contain credentials.
  if (!response.ok) throw new Error(`IDAM ${init.method ?? "GET"} ${new URL(url).pathname} returned HTTP ${response.status}.`);
  const body = await response.text();
  return body ? (JSON.parse(body) as Record<string, unknown>) : {};
}

export interface TestAccountOptions {
  environment: string;
  clientId: string;
  clientSecret: string;
  issuerUrl: string;
  supportUrl: string;
  filename: string;
  deferJudicial?: boolean;
}
interface TestAccount {
  id: string;
  email: string;
  password: string;
}
interface Accounts {
  identity: { environment: string; clientId: string; issuerUrl: string; supportUrl: string };
  /** Historical journal key retained to preserve resumable subject IDs; now grants Team leader. */
  admin: TestAccount;
  judge: TestAccount;
}
