import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getCallerAccess } from "../api/client.js";
import { ROLE_ACCESS } from "./caller-access.js";
import { type RunningMockApi, startMockApi } from "./server.js";

const CASEWORK = ["OVERRIDE_PRIVACY", "DELETE_NOTE", "DELETE_WITNESS", "MANAGE_SHARED_QUERIES", "REPAIR_CCD"];
const NO_ACCESS = { staff: false, judicial: false, capabilities: [] };

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

function token(claims: Record<string, unknown>) {
  return `x.${Buffer.from(JSON.stringify({ sub: "tester", ...claims })).toString("base64url")}.signature`;
}

describe("the mock's role table", () => {
  it("should grant exactly the capabilities api publishes, so a new one fails until the mock knows it", () => {
    // Arrange
    const spec = JSON.parse(readFileSync(new URL("../../openapi.json", import.meta.url), "utf8"));
    const published: string[] = spec.components.schemas.CallerAccessResponse.properties.capabilities.items.enum;

    // Act
    const granted = new Set(Object.values(ROLE_ACCESS).flatMap((access) => access.capabilities));

    // Assert
    expect([...granted].toSorted()).toEqual(published.toSorted());
  });
});

describe("GET /me on the mock", () => {
  it.each([
    { persona: "caseworker", roles: ["caseworker-deedpoll"], expected: { staff: true, judicial: false, capabilities: [] } },
    { persona: "Team leader", roles: ["caseworker-deedpoll-team-leader"], expected: { staff: true, judicial: false, capabilities: CASEWORK } },
    {
      persona: "Delivery Manager",
      roles: ["caseworker-deedpoll-delivery-manager"],
      expected: { staff: true, judicial: false, capabilities: [...CASEWORK, "ACCESS_GAZETTE", "MANAGE_PROCESS_CONFIG"] }
    },
    { persona: "legacy admin", roles: ["caseworker-deedpoll-admin"], expected: { staff: true, judicial: false, capabilities: CASEWORK } },
    { persona: "judge", roles: ["caseworker-deedpoll-judicial"], expected: { staff: false, judicial: true, capabilities: [] } },
    {
      persona: "Delivery Manager who is also a judge",
      roles: ["caseworker-deedpoll-judicial", "caseworker-deedpoll-delivery-manager", "caseworker-deedpoll-admin"],
      expected: { staff: true, judicial: true, capabilities: [...CASEWORK, "ACCESS_GAZETTE", "MANAGE_PROCESS_CONFIG"] }
    },
    { persona: "no deed-poll role", roles: ["citizen"], expected: NO_ACCESS },
    { persona: "malformed roles", roles: "caseworker-deedpoll-delivery-manager", expected: NO_ACCESS }
  ])("should answer the $persona's access in declaration order", async ({ roles, expected }) => {
    // Act
    const result = await getCallerAccess({ baseUrl: mock.url, accessToken: token({ roles }) });

    // Assert
    expect(result).toEqual({ ok: true, data: expected });
  });

  it("should refuse a request with no readable token", async () => {
    // Act
    const result = await getCallerAccess({ baseUrl: mock.url, accessToken: undefined });

    // Assert
    expect(result).toMatchObject({ ok: false, error: { kind: "unauthorized", status: 401 } });
  });

  it("should refuse a method other than GET on /me", async () => {
    // Act
    const response = await fetch(`${mock.url}/me`, { method: "POST", headers: { authorization: `Bearer ${token({ roles: ["caseworker-deedpoll"] })}` } });

    // Assert
    expect(response.status).toBe(405);
  });

  it("should be unreachable when the scenario says api is down", async () => {
    // Arrange
    mock.setScenario("api-unavailable");

    // Act
    const result = await getCallerAccess({ baseUrl: mock.url, accessToken: token({ roles: ["caseworker-deedpoll"] }) });

    // Assert
    expect(result).toMatchObject({ ok: false, error: { kind: "unavailable" } });
  });

  it("should gate the Gazette on the same answer it publishes", async () => {
    // Arrange
    const teamLeader = token({ roles: ["caseworker-deedpoll-team-leader"] });
    const deliveryManager = token({ roles: ["caseworker-deedpoll-delivery-manager"] });

    // Act
    const refused = await fetch(`${mock.url}/caseworker/gazette-settings`, { headers: { authorization: `Bearer ${teamLeader}` } });
    const admitted = await fetch(`${mock.url}/caseworker/gazette-settings`, { headers: { authorization: `Bearer ${deliveryManager}` } });

    // Assert
    expect(refused.status).toBe(403);
    expect(admitted.status).toBe(200);
  });

  it("should drop a capability it does not list rather than refuse the whole answer", async () => {
    // Arrange
    const api = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ staff: true, judicial: false, capabilities: ["ACCESS_GAZETTE", "SOMETHING_NEW", "DELETE_NOTE"] }));
    });
    await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));

    try {
      // Act
      const result = await getCallerAccess({ baseUrl: `http://127.0.0.1:${(api.address() as AddressInfo).port}`, accessToken: token({}) });

      // Assert
      expect(result).toEqual({ ok: true, data: { staff: true, judicial: false, capabilities: ["DELETE_NOTE", "ACCESS_GAZETTE"] } });
    } finally {
      await new Promise<void>((resolve, reject) => api.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it("should resolve roles from local IDAM userinfo when the token carries none", async () => {
    // Arrange
    const issuer = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ roles: ["caseworker-deedpoll-judicial"] }));
    });
    await new Promise<void>((resolve) => issuer.listen(0, "127.0.0.1", resolve));
    const api = await startMockApi({ userInfoUrl: `http://127.0.0.1:${(issuer.address() as AddressInfo).port}/userinfo` });

    try {
      // Act
      const result = await getCallerAccess({ baseUrl: api.url, accessToken: token({}) });

      // Assert
      expect(result).toEqual({ ok: true, data: { staff: false, judicial: true, capabilities: [] } });
    } finally {
      await api.close();
      await new Promise<void>((resolve, reject) => issuer.close((error) => (error ? reject(error) : resolve())));
    }
  });
});
