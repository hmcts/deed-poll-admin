import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getCallerAccess } from "./client.js";
import { apiTransportPermitted } from "./transport.js";

afterEach(() => vi.unstubAllEnvs());

describe("API transport policy", () => {
  it.each(["production", "development", "test", "aat", "", undefined])("should allow HTTPS in %s", (environment) => {
    expect(apiTransportPermitted("https://api.example.test/me", environment)).toBe(true);
  });

  it.each(["production", "aat", "preview", "", undefined])("should refuse even loopback HTTP in %s", (environment) => {
    expect(apiTransportPermitted("http://127.0.0.1:3200/me", environment)).toBe(false);
  });

  it.each(["development", "test"])("should allow only loopback HTTP in %s", (environment) => {
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      expect(apiTransportPermitted(`http://${host}:3200/me`, environment)).toBe(true);
    }
    for (const host of ["api.example.test", "10.0.0.1", "localhost.example.test"]) {
      expect(apiTransportPermitted(`http://${host}/me`, environment)).toBe(false);
    }
  });

  it.each(["not a url", "//api.example.test", "ftp://localhost/me", "https://user:password@api.example.test/me", "https://api.example.test/#fragment"])(
    "should refuse malformed or ambiguous target %s",
    (address) => {
      expect(apiTransportPermitted(address, "test")).toBe(false);
    }
  );

  it("should withhold the token and make no HTTP request in production, while allowing the local test mock", async () => {
    const received: string[] = [];
    const server = createServer((request, response) => {
      received.push(request.headers.authorization ?? "");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ staff: true, judicial: false, capabilities: [] }));
    });
    const baseUrl = await listen(server);
    const config = { baseUrl, accessToken: "synthetic-transport-test-token" };
    try {
      vi.stubEnv("NODE_ENV", "production");
      const refused = await getCallerAccess(config);
      expect(refused).toMatchObject({ ok: false, error: { kind: "unavailable" } });
      expect(received).toEqual([]);

      vi.stubEnv("NODE_ENV", "test");
      expect((await getCallerAccess(config)).ok).toBe(true);
      expect(received).toEqual(["Bearer synthetic-transport-test-token"]);
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
      // Even a legacy caller explicitly setting false cannot weaken the transport policy.
      const result = await getCallerAccess({ baseUrl, accessToken: "synthetic-token", refuseRedirects: false });
      expect(result).toMatchObject({ ok: false, error: { kind: "unavailable" } });
      expect(paths).toEqual(["/me"]);
    } finally {
      await close(server);
    }
  });
});

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP listener");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}
