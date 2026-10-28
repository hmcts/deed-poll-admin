import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type RunningMockApi, startMockApi } from "./server.js";

const DELIVERY_MANAGER = token({ sub: "manager", roles: ["caseworker-deedpoll-delivery-manager"] });
const JUDGE_SUBJECT = "judge-subject-7f3a";
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
afterEach(() => {
  vi.restoreAllMocks();
});

function token(claims: Record<string, unknown>) {
  return `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
}
function judge(email: string, sub = JUDGE_SUBJECT, roles = ["caseworker-deedpoll-judicial"]) {
  return token({ sub, email, roles });
}
async function call(method: string, path: string, body?: unknown, accessToken = DELIVERY_MANAGER) {
  const response = await fetch(`${mock.url}${path}`, {
    method,
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  return { status: response.status, text, json: text ? JSON.parse(text) : undefined };
}
async function create(name: string, email: string, available?: boolean) {
  const created = await call("POST", "/caseworker/masters", available === undefined ? { name, email } : { name, email, available });
  if (created.status !== 201) throw new Error(`Expected a Master, got ${created.status}`);
  return created.json as { id: string; revision: number };
}
async function listed() {
  return (await call("GET", "/caseworker/masters")).json as {
    id: string;
    name: string;
    email: string;
    available: boolean;
    linked: boolean;
    revision: number;
  }[];
}

describe("the mock's Masters list", () => {
  describe("create", () => {
    it("should refuse a duplicate email in any case with api's sentence on email, never the address", async () => {
      // Arrange
      await create("Master Wren", "wren@example.test");

      // Act
      const result = await call("POST", "/caseworker/masters", { name: "Another", email: "  WREN@Example.Test " });

      // Assert
      expect(result.status).toBe(409);
      expect(result.json).toEqual({
        error: "Another Master already has this email address.",
        errors: [{ field: "email", message: "Another Master already has this email address." }]
      });
      expect(result.text.toLowerCase()).not.toContain("wren@");
      expect(await listed()).toHaveLength(1);
    });

    it.each([
      { body: { name: " ", email: "a@example.test" }, field: "name", message: "Enter the Master's name, at most 200 characters." },
      { body: { name: "x".repeat(201), email: "a@example.test" }, field: "name", message: "Enter the Master's name, at most 200 characters." },
      { body: { name: "Master A", email: "a@@example.test" }, field: "email", message: "Enter the Master's email address, like name@example.com." },
      { body: { name: "Master A", email: "a @example.test" }, field: "email", message: "Enter the Master's email address, like name@example.com." },
      { body: { name: "Master A", email: "@example.test" }, field: "email", message: "Enter the Master's email address, like name@example.com." },
      {
        body: { name: "Master A", email: "a@example.test", available: "yes" },
        field: "available",
        message: "Say whether the Master is available, as true or false."
      },
      {
        body: { name: "Master A", email: "a@example.test", revision: 0 },
        field: "revision",
        message: "Only name, email, available and, on a change, revision may be supplied."
      }
    ])("should refuse $body with api's sentence on $field", async ({ body, field, message }) => {
      // Act
      const result = await call("POST", "/caseworker/masters", body);

      // Assert
      expect(result.status).toBe(400);
      expect(result.json).toMatchObject({ errors: [{ field, message }] });
      expect(await listed()).toEqual([]);
    });

    it("should accept a 320-character email and a 200-character name", async () => {
      // Act
      const result = await call("POST", "/caseworker/masters", { name: "n".repeat(200), email: `${"a".repeat(307)}@example.test` });

      // Assert
      expect(result.status).toBe(201);
    });
  });

  describe("update", () => {
    it("should refuse a stale revision with 409 even when the values already match", async () => {
      // Arrange
      const master = await create("Master Wren", "wren@example.test");
      await call("PATCH", `/caseworker/masters/${master.id}`, { available: false, revision: 0 });

      // Act
      const result = await call("PATCH", `/caseworker/masters/${master.id}`, { available: false, revision: 0 });

      // Assert
      expect(result.status).toBe(409);
      expect(result.json).toEqual({ error: "This Master has changed. Reload the Masters list before saving." });
    });

    it("should answer the current values at the current revision as a no-op", async () => {
      // Arrange
      const master = await create("Master Wren", "wren@example.test");

      // Act
      const result = await call("PATCH", `/caseworker/masters/${master.id}`, { name: "Master Wren", email: "WREN@example.test", revision: 0 });

      // Assert
      expect(result.status).toBe(200);
      expect(result.json).toMatchObject({ revision: 0 });
    });

    it("should refuse an email another Master holds, but not the Master's own", async () => {
      // Arrange
      await create("Master Adams", "adams@example.test");
      const wren = await create("Master Wren", "wren@example.test");

      // Act
      const taken = await call("PATCH", `/caseworker/masters/${wren.id}`, { email: "Adams@example.test", revision: 0 });

      // Assert
      expect(taken.status).toBe(409);
      expect(taken.json).toMatchObject({ errors: [{ field: "email" }] });
    });

    it("should refuse a patch naming none of name, email and available", async () => {
      // Arrange
      const master = await create("Master Wren", "wren@example.test");

      // Act
      const result = await call("PATCH", `/caseworker/masters/${master.id}`, { revision: 0 });

      // Assert
      expect(result.status).toBe(400);
      expect(result.json).toMatchObject({ errors: [{ field: "name", message: "Supply at least one of name, email and available." }] });
    });

    it.each(["not-a-uuid", "00000000-0000-4000-8000-000000000000"])("should answer 404 for the id %s", async (id) => {
      // Act
      const result = await call("PATCH", `/caseworker/masters/${id}`, { available: false, revision: 0 });

      // Assert
      expect(result.status).toBe(404);
    });

    it("should keep an unavailable Master on the list, there being no delete", async () => {
      // Arrange
      const master = await create("Master Wren", "wren@example.test");

      // Act
      await call("PATCH", `/caseworker/masters/${master.id}`, { available: false, revision: 0 });

      // Assert
      expect(await listed()).toMatchObject([{ name: "Master Wren", available: false, revision: 1 }]);
      expect((await call("DELETE", `/caseworker/masters/${master.id}`)).status).toBe(405);
    });
  });

  describe("linking", () => {
    it("should link a judge to the unlinked entry holding their email on their first judicial request", async () => {
      // Arrange
      await create("Master Sullivan", "sullivan@example.test");

      // Act
      await call("GET", "/judicial/referrals", undefined, judge(" Sullivan@Example.test "));

      // Assert
      expect(await listed()).toMatchObject([{ name: "Master Sullivan", linked: true, revision: 0 }]);
    });

    it("should link on any judicial path, a referral that does not exist included", async () => {
      // Arrange
      await create("Master Sullivan", "sullivan@example.test");

      // Act
      await call("GET", "/judicial/referrals/no-such-referral", undefined, judge("sullivan@example.test"));

      // Assert
      expect((await listed())[0].linked).toBe(true);
    });

    it("should change nothing on a second request from the same judge", async () => {
      // Arrange
      await create("Master Sullivan", "sullivan@example.test");
      await call("GET", "/judicial/referrals", undefined, judge("sullivan@example.test"));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      // Act
      await call("GET", "/judicial/referrals/mine", undefined, judge("sullivan@example.test"));

      // Assert
      expect(await listed()).toMatchObject([{ linked: true, revision: 0 }]);
      expect(warn).not.toHaveBeenCalled();
    });

    it("should leave an entry linked to another account alone and warn naming nobody", async () => {
      // Arrange
      await create("Master Sullivan", "sullivan@example.test");
      await call("GET", "/judicial/referrals", undefined, judge("sullivan@example.test", "first-subject"));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      // Act
      await call("GET", "/judicial/referrals", undefined, judge("sullivan@example.test", "second-subject"));

      // Assert
      expect(warn).toHaveBeenCalledExactlyOnceWith("A judicial caller's email matches a Master already linked to another account");
      expect(JSON.stringify(warn.mock.calls)).not.toMatch(/sullivan|subject/);
    });

    it("should not link a judge already linked to another entry", async () => {
      // Arrange
      const first = await create("Master Sullivan", "sullivan@example.test");
      await create("Master Wren", "wren@example.test");
      await call("GET", "/judicial/referrals", undefined, judge("sullivan@example.test"));
      await call("PATCH", `/caseworker/masters/${first.id}`, { name: "Master Sullivan KC", revision: 0 });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      // Act
      await call("GET", "/judicial/referrals", undefined, judge("wren@example.test"));

      // Assert
      expect((await listed()).map((master) => [master.name, master.linked])).toEqual([
        ["Master Sullivan KC", true],
        ["Master Wren", false]
      ]);
      expect(warn).toHaveBeenCalledExactlyOnceWith("A judicial caller already linked to one Master has the email of another");
    });

    it.each([
      { what: "a caseworker", accessToken: judge("sullivan@example.test", JUDGE_SUBJECT, ["caseworker-deedpoll"]) },
      { what: "a judge with no email", accessToken: token({ sub: JUDGE_SUBJECT, roles: ["caseworker-deedpoll-judicial"] }) },
      { what: "a judge with no subject", accessToken: token({ email: "sullivan@example.test", roles: ["caseworker-deedpoll-judicial"] }) }
    ])("should link nothing for $what", async ({ accessToken }) => {
      // Arrange
      await create("Master Sullivan", "sullivan@example.test");

      // Act
      await call("GET", "/judicial/referrals", undefined, accessToken);

      // Assert
      expect((await listed())[0].linked).toBe(false);
    });

    it("should link nothing on a caseworker path, even for a judge", async () => {
      // Arrange
      await create("Master Sullivan", "sullivan@example.test");

      // Act
      await call(
        "GET",
        "/caseworker/masters",
        undefined,
        judge("sullivan@example.test", JUDGE_SUBJECT, ["caseworker-deedpoll", "caseworker-deedpoll-judicial"])
      );

      // Assert
      expect((await listed())[0].linked).toBe(false);
    });

    it("should never create an entry for an unlisted judge", async () => {
      // Act
      await call("GET", "/judicial/referrals", undefined, judge("unlisted@example.test"));

      // Assert
      expect(await listed()).toEqual([]);
    });

    it("should unlink an entry whose email changes, so the new address must sign in again", async () => {
      // Arrange
      const master = await create("Master Sullivan", "sullivan@example.test");
      await call("GET", "/judicial/referrals", undefined, judge("sullivan@example.test"));

      // Act
      const changed = await call("PATCH", `/caseworker/masters/${master.id}`, { email: "m.sullivan@example.test", revision: 0 });
      const renamed = await call("PATCH", `/caseworker/masters/${master.id}`, { name: "Master S", revision: 1 });

      // Assert
      expect(changed.json).toMatchObject({ email: "m.sullivan@example.test", linked: false, revision: 1 });
      expect(renamed.json).toMatchObject({ linked: false });
    });

    it("should keep the link through a change that leaves the email alone", async () => {
      // Arrange
      const master = await create("Master Sullivan", "sullivan@example.test");
      await call("GET", "/judicial/referrals", undefined, judge("sullivan@example.test"));

      // Act
      const result = await call("PATCH", `/caseworker/masters/${master.id}`, { available: false, email: "SULLIVAN@example.test", revision: 0 });

      // Assert
      expect(result.json).toMatchObject({ available: false, linked: true, revision: 1 });
    });

    it("should never publish the linked subject in any response", async () => {
      // Arrange
      const master = await create("Master Sullivan", "sullivan@example.test");
      await call("GET", "/judicial/referrals", undefined, judge("sullivan@example.test"));

      // Act
      const responses = [
        await call("GET", "/caseworker/masters"),
        await call("PATCH", `/caseworker/masters/${master.id}`, { available: false, revision: 0 }),
        await call("POST", "/caseworker/masters", { name: "Master Wren", email: "wren@example.test" })
      ];

      // Assert
      for (const response of responses) expect(response.text).not.toContain(JUDGE_SUBJECT);
      expect(Object.keys((await listed())[0]).sort()).toEqual(["available", "email", "id", "linked", "name", "revision"]);
    });
  });

  it("should forget every Master on reset", async () => {
    // Arrange
    await create("Master Wren", "wren@example.test");

    // Act
    mock.reset();

    // Assert
    expect(await listed()).toEqual([]);
  });
});
