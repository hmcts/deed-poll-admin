import { expect, it } from "vitest";
import { pageRequest } from "../express-doubles.js";
import { gazetteRequestKey, newGazetteJourney, openGazetteJourney, sealGazetteJourney, selectedGazetteCases } from "./journey.js";

const request = (sessionID = "session-a", body: unknown = {}) => Object.assign(pageRequest({ body }), { sessionID });

it("should bind each form to its session and refuse a tampered review, key or phase", async () => {
  const req = request();
  const journey = newGazetteJourney();
  const token = await sealGazetteJourney(req, journey);
  expect(await openGazetteJourney(request("session-a", { journey: token }))).toEqual(journey);
  expect(await openGazetteJourney(request("session-b", { journey: token }))).toBeNull();
  const [payload, signature] = token.split(".");
  const altered = { ...JSON.parse(Buffer.from(payload, "base64url").toString()), reviews: [{ id: "forged", version: "a".repeat(64) }] };
  expect(await openGazetteJourney(request("session-a", { journey: `${Buffer.from(JSON.stringify(altered)).toString("base64url")}.${signature}` }))).toBeNull();
  for (const invalid of [undefined, [], "bad", `${payload}.x`, `${token}.extra`, "x".repeat(500_001)]) {
    expect(await openGazetteJourney(request("session-a", { journey: invalid }))).toBeNull();
  }
});

it("should keep the key stable through back navigation and give independent visits different keys", async () => {
  const req = request();
  const journey = newGazetteJourney();
  const key = await gazetteRequestKey(req, journey);
  expect(key).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/);
  expect(await gazetteRequestKey(req, { ...journey, selected: ["different"] })).toBe(key);
  expect(await gazetteRequestKey(req, newGazetteJourney())).not.toBe(key);
  expect(await gazetteRequestKey(request("other"), journey)).not.toBe(key);
});

it("should refuse unreviewed selections, duplicates, nested inputs and more than 100 cases", () => {
  const journey = { ...newGazetteJourney(), reviews: [{ id: "reviewed", version: "a".repeat(64) }] };
  expect(selectedGazetteCases(journey, "reviewed")).toEqual(["reviewed"]);
  expect(selectedGazetteCases(journey, undefined)).toEqual([]);
  for (const invalid of ["unreviewed", ["reviewed", "reviewed"], { reviewed: true }, [["reviewed"]], Array(101).fill("reviewed")]) {
    expect(selectedGazetteCases(journey, invalid)).toBeNull();
  }
});

it("should carry 100 reviewed applications at the contract field limits within the bounded form size", async () => {
  const ids = Array.from({ length: 100 }, (_, index) => `${String(index).padStart(3, "0")}${"界".repeat(252)}`);
  const req = request();
  const journey = {
    ...newGazetteJourney(),
    phase: "confirm" as const,
    reviews: ids.map((id) => ({ id, version: "f".repeat(64) })),
    selected: ids,
    confirmation: {
      key: "00000000-0000-4000-8000-000000000001",
      caseIds: ids,
      recipientRevision: 1,
      selectionFingerprint: "f".repeat(512),
      recipientEmail: "gazette@example.com",
      expiresAt: "2030-01-01T00:00:00Z",
      adultCount: 100,
      minorCount: 0,
      references: ids
    }
  };
  const token = await sealGazetteJourney(req, journey);
  expect(Buffer.byteLength(new URLSearchParams({ journey: token, action: "send", confirmed: "yes" }).toString())).toBeLessThan(512 * 1024);
  expect(await openGazetteJourney(request("session-a", { journey: token }))).toEqual(journey);
});
