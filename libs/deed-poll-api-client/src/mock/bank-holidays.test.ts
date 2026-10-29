import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type RunningMockApi, startMockApi } from "./server.js";

const DELIVERY_MANAGER = token(["caseworker-deedpoll-delivery-manager"]);
const PATH = "/caseworker/process-settings/bank-holidays";
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
  return `x.${Buffer.from(JSON.stringify({ sub: "manager", roles })).toString("base64url")}.signature`;
}
async function call(method: string, path: string, body?: unknown, accessToken = DELIVERY_MANAGER) {
  const response = await fetch(`${mock.url}${path}`, {
    method,
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : undefined };
}
async function listed() {
  return (await call("GET", PATH)).json as { date: string; name: string }[];
}

describe("the mock's bank holidays", () => {
  it("should start at api's 24 seeded England and Wales dates for 2026 to 2028, earliest first", async () => {
    // Act
    const holidays = await listed();

    // Assert
    expect(holidays).toHaveLength(24);
    expect(holidays[0]).toEqual({ date: "2026-01-01", name: "New Year's Day" });
    expect(holidays.at(-1)).toEqual({ date: "2028-12-26", name: "Boxing Day" });
    expect(holidays).toContainEqual({ date: "2027-12-27", name: "Christmas Day (substitute day)" });
    expect(holidays.map((holiday) => holiday.date)).toEqual(holidays.map((holiday) => holiday.date).toSorted());
  });

  it("should add a date in its place in the order", async () => {
    // Act
    const added = await call("POST", PATH, { date: "2027-06-07", name: " Extra day " });

    // Assert
    expect(added).toEqual({ status: 201, json: { date: "2027-06-07", name: "Extra day" } });
    const dates = (await listed()).map((holiday) => holiday.date);
    expect(dates.indexOf("2027-06-07")).toBe(dates.indexOf("2027-05-31") + 1);
  });

  it("should refuse a date already listed with api's sentence on date", async () => {
    // Act
    const result = await call("POST", PATH, { date: "2026-12-25", name: "Christmas" });

    // Assert
    expect(result).toEqual({
      status: 409,
      json: { error: "This date is already a bank holiday.", errors: [{ field: "date", message: "This date is already a bank holiday." }] }
    });
    expect(await listed()).toContainEqual({ date: "2026-12-25", name: "Christmas Day" });
  });

  it.each([
    { body: { date: "2029-02-30", name: "Nope" }, field: "date", message: "Enter the date as yyyy-MM-dd, like 2029-01-01." },
    { body: { date: "01-01-2029", name: "Nope" }, field: "date", message: "Enter the date as yyyy-MM-dd, like 2029-01-01." },
    { body: { date: "2029-01-01", name: " " }, field: "name", message: "Enter the bank holiday's name, at most 200 characters." },
    { body: { date: "2029-01-01", name: "x".repeat(201) }, field: "name", message: "Enter the bank holiday's name, at most 200 characters." },
    { body: { date: "2029-01-01", name: "New Year", revision: 0 }, field: "revision", message: "Only date and name may be supplied." }
  ])("should refuse $body with api's sentence on $field", async ({ body, field, message }) => {
    // Act
    const result = await call("POST", PATH, body);

    // Assert
    expect(result.status).toBe(400);
    expect(result.json).toMatchObject({ errors: [{ field, message }] });
    expect(await listed()).toHaveLength(24);
  });

  it("should remove a seeded date, then answer 404 for it", async () => {
    // Act
    const removed = await call("DELETE", `${PATH}/2026-12-28`);
    const again = await call("DELETE", `${PATH}/2026-12-28`);

    // Assert
    expect(removed.status).toBe(204);
    expect(again).toEqual({ status: 404, json: { error: "No such bank holiday" } });
    expect((await listed()).map((holiday) => holiday.date)).not.toContain("2026-12-28");
  });

  it("should answer 404 for a malformed date", async () => {
    expect((await call("DELETE", `${PATH}/not-a-date`)).status).toBe(404);
  });

  it.each([
    { roles: ["caseworker-deedpoll"], read: 200, write: 403 },
    { roles: ["caseworker-deedpoll-team-leader"], read: 200, write: 403 },
    { roles: ["caseworker-deedpoll-judicial"], read: 403, write: 403 },
    { roles: ["caseworker-deedpoll-delivery-manager"], read: 200, write: 201 }
  ])("should let $roles read with $read and add with $write", async ({ roles, read, write }) => {
    // Act
    const listing = await call("GET", PATH, undefined, token(roles));
    const adding = await call("POST", PATH, { date: "2029-01-01", name: "New Year's Day" }, token(roles));

    // Assert
    expect(listing.status).toBe(read);
    expect(adding.status).toBe(write);
  });

  it("should restore the seed on reset", async () => {
    // Arrange
    await call("DELETE", `${PATH}/2026-01-01`);
    await call("POST", PATH, { date: "2029-01-01", name: "New Year's Day" });

    // Act
    mock.reset();

    // Assert
    const dates = (await listed()).map((holiday) => holiday.date);
    expect(dates).toHaveLength(24);
    expect(dates[0]).toBe("2026-01-01");
  });
});
