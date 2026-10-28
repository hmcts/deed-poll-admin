import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getProcessSettings, updateProcessSettings } from "../api/client.js";
import { type RunningMockApi, startMockApi } from "./server.js";

const DELIVERY_MANAGER = token(["caseworker-deedpoll-delivery-manager"]);
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
  return `x.${Buffer.from(JSON.stringify({ sub: "manager", name: "Test manager", roles })).toString("base64url")}.signature`;
}
function config(accessToken: string | undefined = DELIVERY_MANAGER) {
  return { baseUrl: mock.url, accessToken };
}
function put(body: unknown, accessToken = DELIVERY_MANAGER) {
  return fetch(`${mock.url}/caseworker/process-settings`, {
    method: "PUT",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

describe("process settings adapter and mock", () => {
  it("should start at api's seeded seven days, 48 hours, ten per window and two windows, at revision 0 with no attribution", async () => {
    // Act
    const result = await getProcessSettings(config());

    // Assert
    expect(result).toEqual({
      ok: true,
      data: {
        referralClaimExpiryMinutes: 10080,
        reminderIntervalHours: 48,
        masterWindowCap: 10,
        morningWindowStart: "07:00",
        morningWindowEnd: "10:30",
        afternoonWindowStart: "14:00",
        afternoonWindowEnd: "14:30",
        revision: 0,
        updatedAt: null,
        updatedBy: null
      }
    });
  });

  it("should persist a change with a new revision and the caller's name", async () => {
    // Act
    const result = await updateProcessSettings({ referralClaimExpiryMinutes: 2880, revision: 0 }, config());

    // Assert
    expect(result).toMatchObject({ ok: true, data: { referralClaimExpiryMinutes: 2880, revision: 1, updatedBy: "Test manager" } });
    if (!result.ok) throw new Error("Expected success");
    expect(result.data.updatedAt).toBeInstanceOf(Date);
    expect(await getProcessSettings(config())).toEqual(result);
  });

  it("should send and persist every extended setting through the adapter", async () => {
    // Arrange
    const change = {
      referralClaimExpiryMinutes: 4320,
      reminderIntervalHours: 24,
      masterWindowCap: 5,
      morningWindowStart: "08:00",
      morningWindowEnd: "11:15",
      afternoonWindowStart: "13:30",
      afternoonWindowEnd: "15:45",
      revision: 0
    };

    // Act
    const result = await updateProcessSettings(change, config());

    // Assert
    expect(result).toMatchObject({ ok: true, data: { ...change, revision: 1 } });
    expect(await getProcessSettings(config())).toEqual(result);
  });

  it("should keep a setting the adapter leaves out at its stored value", async () => {
    // Act
    const result = await updateProcessSettings({ referralClaimExpiryMinutes: 2880, masterWindowCap: 3, revision: 0 }, config());

    // Assert
    expect(result).toMatchObject({
      ok: true,
      data: { referralClaimExpiryMinutes: 2880, masterWindowCap: 3, reminderIntervalHours: 48, morningWindowStart: "07:00", afternoonWindowEnd: "14:30" }
    });
  });

  it("should treat the current value at the current revision as a no-op", async () => {
    // Act
    const result = await updateProcessSettings({ referralClaimExpiryMinutes: 10080, revision: 0 }, config());

    // Assert
    expect(result).toEqual({
      ok: true,
      data: {
        referralClaimExpiryMinutes: 10080,
        reminderIntervalHours: 48,
        masterWindowCap: 10,
        morningWindowStart: "07:00",
        morningWindowEnd: "10:30",
        afternoonWindowStart: "14:00",
        afternoonWindowEnd: "14:30",
        revision: 0,
        updatedAt: null,
        updatedBy: null
      }
    });
  });

  it("should refuse a stale revision with 409 even when the value already matches", async () => {
    // Arrange
    await updateProcessSettings({ referralClaimExpiryMinutes: 4320, revision: 0 }, config());

    // Act
    const result = await updateProcessSettings({ referralClaimExpiryMinutes: 4320, revision: 0 }, config());

    // Assert
    expect(result).toMatchObject({ ok: false, error: { kind: "conflict", status: 409 } });
    expect(await getProcessSettings(config())).toMatchObject({ ok: true, data: { referralClaimExpiryMinutes: 4320, revision: 1 } });
  });

  it.each([1440, 43200])("should accept the boundary %i minutes", async (minutes) => {
    expect(await updateProcessSettings({ referralClaimExpiryMinutes: minutes, revision: 0 }, config())).toMatchObject({
      ok: true,
      data: { referralClaimExpiryMinutes: minutes, revision: 1 }
    });
  });

  it.each([
    { body: { referralClaimExpiryMinutes: 1439, revision: 0 }, field: "referralClaimExpiryMinutes" },
    { body: { referralClaimExpiryMinutes: 43201, revision: 0 }, field: "referralClaimExpiryMinutes" },
    { body: { referralClaimExpiryMinutes: 1440.5, revision: 0 }, field: "referralClaimExpiryMinutes" },
    { body: { referralClaimExpiryMinutes: "1440", revision: 0 }, field: "referralClaimExpiryMinutes" },
    { body: { referralClaimExpiryMinutes: null, revision: 0 }, field: "referralClaimExpiryMinutes" },
    { body: { revision: 0 }, field: "referralClaimExpiryMinutes" },
    { body: { referralClaimExpiryMinutes: 2880, revision: -1 }, field: "revision" },
    { body: { referralClaimExpiryMinutes: 2880, revision: "0" }, field: "revision" },
    { body: { referralClaimExpiryMinutes: 2880 }, field: "revision" },
    { body: { referralClaimExpiryMinutes: 2880, revision: 0, updatedBy: "forged" }, field: "updatedBy" }
  ])("should refuse $body with a 400 naming $field and change nothing", async ({ body, field }) => {
    // Act
    const response = await put(body);

    // Assert
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ errors: [{ field }] });
    expect(await getProcessSettings(config())).toMatchObject({ ok: true, data: { referralClaimExpiryMinutes: 10080, revision: 0 } });
  });

  it("should check the processing window before the revision, as api does", async () => {
    // Act
    const response = await put({ referralClaimExpiryMinutes: 10, revision: 7 });

    // Assert
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ errors: [{ field: "referralClaimExpiryMinutes" }] });
  });

  it.each([
    { roles: [], allowed: false },
    { roles: ["caseworker-deedpoll"], allowed: false },
    { roles: ["caseworker-deedpoll-team-leader"], allowed: false },
    { roles: ["caseworker-deedpoll-admin"], allowed: false },
    { roles: ["caseworker-deedpoll-judicial"], allowed: false },
    { roles: ["caseworker-deedpoll-delivery-manager"], allowed: true }
  ])("should admit $roles only with MANAGE_PROCESS_CONFIG", async ({ roles, allowed }) => {
    // Arrange
    const caller = config(token(roles));

    // Act
    const read = await getProcessSettings(caller);
    const write = await updateProcessSettings({ referralClaimExpiryMinutes: 4320, revision: 0 }, caller);

    // Assert
    expect(read.ok).toBe(allowed);
    expect(write.ok).toBe(allowed);
    if (!allowed) expect(write).toMatchObject({ ok: false, error: { kind: "forbidden" } });
  });

  it("should attribute a change to a Delivery Manager when the token carries no name", async () => {
    // Arrange
    const nameless = `x.${Buffer.from(JSON.stringify({ sub: "manager", roles: ["caseworker-deedpoll-delivery-manager"] })).toString("base64url")}.signature`;

    // Act
    const response = await put({ referralClaimExpiryMinutes: 2880, revision: 0 }, nameless);

    // Assert
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ revision: 1, updatedBy: "Delivery Manager" });
  });

  it("should answer 405 to a method other than GET or PUT, changing nothing", async () => {
    // Act
    const response = await fetch(`${mock.url}/caseworker/process-settings`, {
      method: "POST",
      headers: { authorization: `Bearer ${DELIVERY_MANAGER}`, "content-type": "application/json" },
      body: JSON.stringify({ referralClaimExpiryMinutes: 2880, revision: 0 })
    });

    // Assert
    expect(response.status).toBe(405);
    expect(await getProcessSettings(config())).toMatchObject({ ok: true, data: { referralClaimExpiryMinutes: 10080, revision: 0 } });
  });

  it("should reset to the seeded values with the mock's other fixtures", async () => {
    // Arrange
    await updateProcessSettings({ referralClaimExpiryMinutes: 20160, revision: 0 }, config());

    // Act
    mock.reset();

    // Assert
    expect(await getProcessSettings(config())).toMatchObject({ ok: true, data: { referralClaimExpiryMinutes: 10080, revision: 0, updatedBy: null } });
  });

  it("should classify missing authentication and api outages", async () => {
    expect(await getProcessSettings({ baseUrl: mock.url })).toMatchObject({ ok: false, error: { kind: "unauthorized" } });
    mock.setScenario("api-unavailable");
    expect(await getProcessSettings(config())).toMatchObject({ ok: false, error: { kind: "unavailable" } });
    expect(await updateProcessSettings({ referralClaimExpiryMinutes: 4320, revision: 0 }, config())).toMatchObject({
      ok: false,
      error: { kind: "unavailable" }
    });
  });
});
