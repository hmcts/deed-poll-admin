import { DELETION_NOTE_LIMITS } from "@hmcts/deed-poll";
import { describe, expect, it } from "vitest";
import { pageRequest } from "../express-doubles.js";
import {
  confirmDeletionJourney,
  DELETION_JOURNEY_TTL_MS,
  type DeletionJourney,
  deletionRequestBody,
  newDeletionJourney,
  openDeletionJourney,
  sealDeletionJourney
} from "./journey.js";

const NOW = Date.UTC(2026, 10, 25, 9, 0);
const LAST_CHANGED_ON = "2026-11-20T10:15:30.123";
const ANSWERS = { reason: "DUPLICATE" as const, note: "Duplicate of another application" };
const request = (sessionID = "session-a", body: unknown = {}) => Object.assign(pageRequest({ body }), { sessionID });

async function posted(journey: DeletionJourney, sessionID = "session-a") {
  return request(sessionID, { journey: await sealDeletionJourney(request(sessionID), journey) });
}

describe("application deletion journey", () => {
  it("should open its own token for its own application, session and time", async () => {
    // Arrange
    const journey = newDeletionJourney("case-1", LAST_CHANGED_ON, NOW);

    // Act
    const opened = await openDeletionJourney(await posted(journey), "case-1", NOW + 60_000);

    // Assert
    expect(opened).toEqual({ state: "open", journey });
    expect(journey.key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("should refuse a token replayed in another session or against another application", async () => {
    const journey = newDeletionJourney("case-1", LAST_CHANGED_ON, NOW);
    const token = await sealDeletionJourney(request(), journey);

    expect(await openDeletionJourney(request("session-b", { journey: token }), "case-1", NOW)).toEqual({ state: "invalid" });
    expect(await openDeletionJourney(request("session-a", { journey: token }), "case-2", NOW)).toEqual({ state: "invalid" });
  });

  it("should refuse an altered key, timestamp, application or confirmed body, and malformed tokens", async () => {
    const journey = confirmDeletionJourney(newDeletionJourney("case-1", LAST_CHANGED_ON, NOW), ANSWERS);
    const token = await sealDeletionJourney(request(), journey);
    const [payload, mac] = token.split(".");
    const forge = (change: Partial<DeletionJourney>) => `${Buffer.from(JSON.stringify({ ...journey, ...change })).toString("base64url")}.${mac}`;
    const forged = [
      forge({ key: "00000000-0000-4000-8000-000000000000" }),
      forge({ lastChangedOn: "2026-11-25T08:00:00" }),
      forge({ caseId: "case-2" }),
      forge({ confirmed: { reason: "CREATED_IN_ERROR", note: ANSWERS.note } })
    ];

    for (const invalid of [
      ...forged,
      undefined,
      ["a", "b"],
      { journey: token },
      "bad",
      `${payload}.x`,
      `${token}.extra`,
      `${payload}.${"0".repeat(64)}`,
      "x".repeat(8_193)
    ]) {
      expect(await openDeletionJourney(request("session-a", { journey: invalid }), "case-1", NOW)).toEqual({ state: "invalid" });
    }
  });

  it("should expire a token after the time limit and never accept one issued in the future", async () => {
    const journey = newDeletionJourney("case-1", LAST_CHANGED_ON, NOW);
    const req = await posted(journey);

    expect((await openDeletionJourney(req, "case-1", NOW + DELETION_JOURNEY_TTL_MS)).state).toBe("open");
    expect(await openDeletionJourney(req, "case-1", NOW + DELETION_JOURNEY_TTL_MS + 1)).toEqual({ state: "expired" });
    expect(await openDeletionJourney(req, "case-1", NOW - 1)).toEqual({ state: "expired" });
  });

  it("should give independent visits, including two tabs on one application, different keys", () => {
    const first = newDeletionJourney("case-1", LAST_CHANGED_ON, NOW);
    const second = newDeletionJourney("case-1", LAST_CHANGED_ON, NOW);

    expect(second.key).not.toBe(first.key);
  });

  it("should build the exact admission body from the confirmed journey, with the reviewed lastChangedOn unchanged", () => {
    const journey = newDeletionJourney("case-1", LAST_CHANGED_ON, NOW);

    expect(deletionRequestBody(confirmDeletionJourney(journey, ANSWERS))).toEqual({ ...ANSWERS, expectedLastChangedOn: LAST_CHANGED_ON });
  });

  it("should keep the key through a double submit or a back-navigated resubmit, so api sees one request", async () => {
    // Arrange: the form's token, posted twice, once with a changed reason.
    const journey = newDeletionJourney("case-1", LAST_CHANGED_ON, NOW);
    const req = await posted(journey);
    const opened = await openDeletionJourney(req, "case-1", NOW);
    const reopened = await openDeletionJourney(req, "case-1", NOW);
    if (opened.state !== "open" || reopened.state !== "open") throw new Error("expected open journeys");

    // Act
    const first = confirmDeletionJourney(opened.journey, ANSWERS);
    const second = confirmDeletionJourney(reopened.journey, { ...ANSWERS, reason: "CREATED_IN_ERROR" });

    // Assert: the same key either way, so a changed body is api's reused-key refusal, never a second request.
    expect(second.key).toBe(first.key);
  });

  it("should never let a recovery edit the confirmed body after an uncertain submission", async () => {
    // Arrange: the recovery page's token, carrying the confirmed body.
    const confirmed = confirmDeletionJourney(newDeletionJourney("case-1", LAST_CHANGED_ON, NOW), ANSWERS);
    const opened = await openDeletionJourney(await posted(confirmed), "case-1", NOW);
    if (opened.state !== "open") throw new Error("expected an open journey");

    // Act: a changed reason and note posted beside it.
    const replayed = confirmDeletionJourney(opened.journey, { reason: "CREATED_IN_ERROR", note: "Something else entirely" });

    // Assert
    expect(replayed).toEqual(confirmed);
    expect(deletionRequestBody(replayed)).toEqual({ ...ANSWERS, expectedLastChangedOn: LAST_CHANGED_ON });
  });

  it("should seal a confirmed note at api's longest within the token limit", async () => {
    const note = "😀".repeat(DELETION_NOTE_LIMITS.maxLength);
    const journey = confirmDeletionJourney(newDeletionJourney("c".repeat(255), LAST_CHANGED_ON, NOW), { reason: "DUPLICATE", note });

    const opened = await openDeletionJourney(await posted(journey), "c".repeat(255), NOW);

    expect(opened).toEqual({ state: "open", journey });
  });

  it("should refuse to seal without a session", async () => {
    const req = Object.assign(pageRequest(), { sessionID: undefined });

    await expect(sealDeletionJourney(req as never, newDeletionJourney("case-1", LAST_CHANGED_ON, NOW))).rejects.toThrow("requires a session");
  });
});
