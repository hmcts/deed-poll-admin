import { createServer, type Server } from "node:http";
import { describe, expect, it } from "vitest";
import { getCallerAccess } from "./client.js";
import { assertApiBaseUrl } from "./transport.js";

describe("API URL configuration", () => {
  it.each([
    "https://api.example.test",
    "http://deed-poll-api-aat.service.core-compute-aat.internal",
    "http://localhost:3200",
    "http://[::1]:3200",
    "https://api.example.test/prefix"
  ])("should retain support for %s", (address) => {
    expect(() => assertApiBaseUrl(address)).not.toThrow();
  });

  it.each([
    "not a url",
    "//api.example.test",
    "https:api.example.test",
    "ftp://localhost",
    "https://user:secret@api.example.test",
    "https://api.example.test/#secret",
    "https://api.example.test/?secret",
    "https://api.example.test/#",
    "https://api.example.test/?",
    " https://api.example.test",
    "https://api.example.test\\path"
  ])("should reject ambiguous configuration without exposing it: %s", (address) => {
    expect(() => assertApiBaseUrl(address)).toThrow("API base URL must be an absolute HTTP(S) URL without credentials, query or fragment");
    expect(() => assertApiBaseUrl(address)).not.toThrow(/secret/);
  });

  it("should reject an unsafe base URL before any request, while retaining direct HTTP calls", async () => {
    const received: string[] = [];
    const server = createServer((request, response) => {
      received.push(request.headers.authorization ?? "");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ staff: true, judicial: false, capabilities: [] }));
    });
    const baseUrl = await listen(server);
    try {
      for (const unsafe of [`${baseUrl}#fragment`, `${baseUrl}?query`, baseUrl.replace("http://", "http://user:secret@")]) {
        await expect(getCallerAccess({ baseUrl: unsafe, accessToken: "synthetic-token" })).rejects.toThrow("API base URL");
      }
      expect(received).toEqual([]);
      expect((await getCallerAccess({ baseUrl, accessToken: "synthetic-token" })).ok).toBe(true);
      expect(received).toEqual(["Bearer synthetic-token"]);
    } finally {
      await close(server);
    }
  });

  it.each([301, 302, 303, 307, 308])("should refuse a %s redirect without contacting its target", async (status) => {
    const paths: string[] = [];
    const server = createServer((request, response) => {
      paths.push(request.url ?? "");
      if (request.url === "/me") response.writeHead(status, { location: "/redirect-target" });
      response.end();
    });
    const baseUrl = await listen(server);
    try {
      const result = await getCallerAccess({ baseUrl, accessToken: "synthetic-token" });
      expect(result).toMatchObject({ ok: false, error: { kind: "unavailable" } });
      expect(paths).toEqual(["/me"]);
    } finally {
      await close(server);
    }
  });
});

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP listener");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
