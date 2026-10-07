import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { seedTestAccounts } from "./accounts.js";

let server: Server | undefined;
let directory: string | undefined;
afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
  if (directory) await rm(directory, { recursive: true, force: true });
  server = undefined;
  directory = undefined;
});

describe("temporary IDAM fixture accounts", () => {
  it.each([false, true])("should reuse fixture identities and credentials when judicial creation is initially deferred: %s", async (deferJudicial) => {
    directory = await mkdtemp(join(tmpdir(), "seed-accounts-test-"));
    const users = new Map<string, { email: string; roleNames: string[] }>();
    const fixtureIds: string[] = [];
    let origin = "";
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks).toString();
      res.setHeader("content-type", "application/json");
      if (req.url === "/o/.well-known/openid-configuration") {
        res.end(JSON.stringify({ issuer: `${origin}/o`, token_endpoint: `${origin}/o/token` }));
      } else if (req.url === "/o/token") {
        const form = new URLSearchParams(body);
        if (form.get("client_secret") !== "secret-for-test") {
          res.writeHead(401);
          res.end("{}");
          return;
        }
        const user = [...users.values()].find((candidate) => candidate.email === form.get("username"));
        const accessToken =
          form.get("grant_type") === "client_credentials"
            ? "service-token"
            : user?.roleNames[0] === "caseworker-deedpoll-admin"
              ? "admin-token"
              : "judge-token";
        res.end(JSON.stringify({ access_token: accessToken }));
      } else if (req.url?.startsWith("/test/idam/users/") && req.method === "PUT" && req.headers.authorization === "Bearer service-token") {
        const payload = JSON.parse(body);
        expect(payload.user.id).toBe(req.url.split("/").at(-1));
        fixtureIds.push(payload.user.id);
        users.set(payload.user.id, payload.user);
        res.end(JSON.stringify(payload.user));
      } else {
        res.writeHead(404);
        res.end("{}");
      }
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test port");
    origin = `http://127.0.0.1:${address.port}`;
    const options = {
      environment: "test",
      clientId: "deed-poll-admin",
      clientSecret: "secret-for-test",
      issuerUrl: `${origin}/o`,
      supportUrl: origin,
      filename: join(directory, "accounts.json")
    };
    expect(await seedTestAccounts({ ...options, deferJudicial })).toEqual(
      deferJudicial ? { caseworkerToken: "admin-token" } : { caseworkerToken: "admin-token", judgeToken: "judge-token" }
    );
    expect(users.size).toBe(deferJudicial ? 1 : 2);
    expect([...users.values()].map((user) => user.roleNames)).toEqual(
      deferJudicial ? [["caseworker-deedpoll-admin"]] : [["caseworker-deedpoll-admin"], ["caseworker-deedpoll-judicial"]]
    );
    const initial = JSON.parse(await readFile(options.filename, "utf8"));
    expect(await seedTestAccounts(options)).toEqual({ caseworkerToken: "admin-token", judgeToken: "judge-token" });
    expect(users.size).toBe(2);
    expect(fixtureIds).toEqual(
      deferJudicial ? [initial.admin.id, initial.admin.id, initial.judge.id] : [initial.admin.id, initial.judge.id, initial.admin.id, initial.judge.id]
    );
    expect([...users.values()].map((user) => user.roleNames)).toEqual([["caseworker-deedpoll-admin"], ["caseworker-deedpoll-judicial"]]);
    const persisted = await readFile(options.filename, "utf8");
    expect(persisted).not.toContain("secret-for-test");
    expect(persisted).not.toContain("admin-token");
    expect((await stat(options.filename)).mode & 0o777).toBe(0o600);
    await expect(seedTestAccounts({ ...options, clientId: "different-client" })).rejects.toThrow("different IDAM");
  });
  it("should refuse production before creating a credential file or contacting IDAM", async () => {
    await expect(
      seedTestAccounts({
        environment: "prod",
        clientId: "deed-poll-admin",
        clientSecret: "unused",
        issuerUrl: "https://hmcts-access.prod.platform.hmcts.net/o",
        supportUrl: "https://idam-testing-support-api.prod.platform.hmcts.net",
        filename: "/unused"
      })
    ).rejects.toThrow("production");
  });
});
