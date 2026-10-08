import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getGazetteSettings, updateGazetteSettings } from "../api/client.js";
import { type RunningMockApi, startMockApi } from "./server.js";

const ADMIN = token(["caseworker-deedpoll-admin"]);
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
  return `x.${Buffer.from(JSON.stringify({ sub: "tester", name: "Test administrator", roles })).toString("base64url")}.signature`;
}
function config(accessToken: string | undefined = ADMIN) {
  return { baseUrl: mock.url, accessToken };
}

describe("Gazette recipient settings adapter and mock", () => {
  it("should start unconfigured, persist an update and preserve attribution", async () => {
    expect(await getGazetteSettings(config())).toMatchObject({ ok: true, data: { recipientEmail: null, revision: 0 } });
    const result = await updateGazetteSettings({ recipientEmail: "  lg@example.com  ", revision: 0 }, config());
    expect(result).toMatchObject({ ok: true, data: { recipientEmail: "lg@example.com", revision: 1, updatedBy: "Test administrator" } });
    if (!result.ok) throw new Error("Expected success");
    expect(result.data.updatedAt).toBeInstanceOf(Date);
    expect(await getGazetteSettings(config())).toEqual(result);
  });

  it("should reject stale edits and avoid a new revision for an unchanged address", async () => {
    await updateGazetteSettings({ recipientEmail: "lg@example.com", revision: 0 }, config());
    expect(await updateGazetteSettings({ recipientEmail: "wrong@example.com", revision: 0 }, config())).toMatchObject({
      ok: false,
      error: { kind: "conflict", status: 409 }
    });
    expect(await updateGazetteSettings({ recipientEmail: "lg@example.com", revision: 1 }, config())).toMatchObject({ ok: true, data: { revision: 1 } });
    expect(await getGazetteSettings(config())).toMatchObject({ ok: true, data: { recipientEmail: "lg@example.com" } });
  });

  it.each(["", "bad", "a@example.com,b@example.com", "Name <a@example.com>", "a..b@example.com", "a@-example.com"])(
    "should reject invalid address %s without changing settings",
    async (recipientEmail) => {
      expect(await updateGazetteSettings({ recipientEmail, revision: 0 }, config())).toMatchObject({ ok: false, error: { kind: "validation", status: 400 } });
      expect(await getGazetteSettings(config())).toMatchObject({ ok: true, data: { revision: 0 } });
    }
  );

  it("should identify invalid revisions separately from recipient errors", async () => {
    expect(await updateGazetteSettings({ recipientEmail: "lg@example.com", revision: -1 }, config())).toMatchObject({
      ok: false,
      error: { kind: "validation", fieldErrors: [{ field: "revision" }] }
    });
    expect(await getGazetteSettings(config())).toMatchObject({ ok: true, data: { revision: 0 } });
  });

  it.each([[], ["caseworker-deedpoll"], ["caseworker-deedpoll-judicial"]])("should refuse non-admin roles %j", async (...roles) => {
    const caller = config(token(roles.flat()));
    expect(await getGazetteSettings(caller)).toMatchObject({ ok: false, error: { kind: "forbidden" } });
    expect(await updateGazetteSettings({ recipientEmail: "lg@example.com", revision: 0 }, caller)).toMatchObject({ ok: false, error: { kind: "forbidden" } });
  });

  it("should classify missing authentication and API outages", async () => {
    expect(await getGazetteSettings({ baseUrl: mock.url })).toMatchObject({ ok: false, error: { kind: "unauthorized" } });
    mock.setScenario("api-unavailable");
    expect(await getGazetteSettings(config())).toMatchObject({ ok: false, error: { kind: "unavailable" } });
    expect(await updateGazetteSettings({ recipientEmail: "lg@example.com", revision: 0 }, config())).toMatchObject({
      ok: false,
      error: { kind: "unavailable" }
    });
  });
});
