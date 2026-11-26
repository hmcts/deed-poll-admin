import { DOCUMENT_DELETION_REASON_LIMITS } from "@hmcts/deed-poll";
import { describe, expect, it } from "vitest";
import { pageRequest } from "../express-doubles.js";
import {
  afterDefiniteRefusal,
  confirmDocumentDeletionJourney,
  DOCUMENT_DELETION_JOURNEY_TTL_MS,
  type DocumentDeletionJourney,
  documentDeletionRequestBody,
  isConfirmedDocumentDeletionJourney,
  newDocumentDeletionJourney,
  openDocumentDeletionJourney,
  sealDocumentDeletionJourney
} from "./journey.js";

const NOW = Date.UTC(2026, 10, 26, 9, 0);
const REASON = "Uploaded in error";
const request = (sessionID = "session-a", body: unknown = {}) => Object.assign(pageRequest({ body }), { sessionID });

async function posted(journey: DocumentDeletionJourney, sessionID = "session-a", extra: Record<string, unknown> = {}) {
  return request(sessionID, { ...extra, journey: await sealDocumentDeletionJourney(request(sessionID), journey) });
}

async function openOrFail(req: ReturnType<typeof request>, caseId = "case-1", documentId = "doc-9", now = NOW) {
  const opened = await openDocumentDeletionJourney(req, caseId, documentId, now);
  if (opened.state !== "open") throw new Error(`expected an open journey, got ${opened.state}`);
  return opened.journey;
}

describe("document deletion journey", () => {
  it("should open its own token for its own case, document, session and time", async () => {
    // Arrange
    const journey = newDocumentDeletionJourney("case-1", "doc-9", 3, NOW);

    // Act
    const opened = await openDocumentDeletionJourney(await posted(journey), "case-1", "doc-9", NOW + 60_000);

    // Assert
    expect(opened).toEqual({ state: "open", journey });
    expect(journey).toMatchObject({ caseId: "case-1", documentId: "doc-9", documentVersion: 3, issuedAt: NOW });
    expect(journey.key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("should refuse a token replayed in another session, on another case or for another document", async () => {
    const token = await sealDocumentDeletionJourney(request(), newDocumentDeletionJourney("case-1", "doc-9", 3, NOW));

    expect(await openDocumentDeletionJourney(request("session-b", { journey: token }), "case-1", "doc-9", NOW)).toEqual({ state: "invalid" });
    expect(await openDocumentDeletionJourney(request("session-a", { journey: token }), "case-2", "doc-9", NOW)).toEqual({ state: "invalid" });
    expect(await openDocumentDeletionJourney(request("session-a", { journey: token }), "case-1", "doc-8", NOW)).toEqual({ state: "invalid" });
  });

  it("should not accept an application deletion token, whose signature is in another domain", async () => {
    const { newDeletionJourney, sealDeletionJourney } = await import("../application-deletion/journey.js");
    const token = await sealDeletionJourney(request(), newDeletionJourney("case-1", "2026-11-20T10:15:30", NOW));

    expect(await openDocumentDeletionJourney(request("session-a", { journey: token }), "case-1", "doc-9", NOW)).toEqual({ state: "invalid" });
  });

  it("should refuse an altered key, version, timestamp, case, document or sealed reason, and malformed tokens", async () => {
    const journey = confirmDocumentDeletionJourney(newDocumentDeletionJourney("case-1", "doc-9", 3, NOW), { reason: REASON });
    const token = await sealDocumentDeletionJourney(request(), journey);
    const [payload, mac] = token.split(".");
    const forge = (change: Record<string, unknown>) => `${Buffer.from(JSON.stringify({ ...journey, ...change })).toString("base64url")}.${mac}`;

    for (const invalid of [
      forge({ key: "00000000-0000-4000-8000-000000000000" }),
      forge({ documentVersion: 4 }),
      forge({ issuedAt: NOW + 1 }),
      forge({ caseId: "case-2" }),
      forge({ documentId: "doc-8" }),
      forge({ confirmed: { reason: "Something else" } }),
      undefined,
      ["a", "b"],
      { journey: token },
      "bad",
      `${payload}.x`,
      `${token}.extra`,
      `${payload}.${"0".repeat(64)}`,
      "x".repeat(8_193)
    ]) {
      expect(await openDocumentDeletionJourney(request("session-a", { journey: invalid }), "case-1", "doc-9", NOW)).toEqual({ state: "invalid" });
    }
  });

  it("should refuse a correctly signed payload that is not a journey", async () => {
    const shapes = [
      { key: "not-a-uuid", caseId: "case-1", documentId: "doc-9", documentVersion: 3, issuedAt: NOW },
      { key: "6f1c2c1e-0d7a-4b8e-9a43-0c1a3b5d7e9f", caseId: "case-1", documentId: "doc-9", documentVersion: 0, issuedAt: NOW },
      { key: "6f1c2c1e-0d7a-4b8e-9a43-0c1a3b5d7e9f", caseId: "case-1", documentId: "doc-9", documentVersion: 3.5, issuedAt: NOW },
      { key: "6f1c2c1e-0d7a-4b8e-9a43-0c1a3b5d7e9f", caseId: "case-1", documentId: "doc-9", documentVersion: 3, issuedAt: NOW, isAdmin: true }
    ];

    for (const shape of shapes) {
      await expect(sealDocumentDeletionJourney(request(), shape as never)).rejects.toThrow();
    }
  });

  it("should expire a token after the time limit and never accept one issued in the future", async () => {
    const req = await posted(newDocumentDeletionJourney("case-1", "doc-9", 3, NOW));

    expect((await openDocumentDeletionJourney(req, "case-1", "doc-9", NOW + DOCUMENT_DELETION_JOURNEY_TTL_MS)).state).toBe("open");
    expect(await openDocumentDeletionJourney(req, "case-1", "doc-9", NOW + DOCUMENT_DELETION_JOURNEY_TTL_MS + 1)).toEqual({ state: "expired" });
    expect(await openDocumentDeletionJourney(req, "case-1", "doc-9", NOW - 1)).toEqual({ state: "expired" });
  });

  it("should give independent visits, including two tabs on one document, their own keys and tokens", async () => {
    // Arrange: two tabs open the same document's confirmation.
    const first = newDocumentDeletionJourney("case-1", "doc-9", 3, NOW);
    const second = newDocumentDeletionJourney("case-1", "doc-9", 3, NOW);

    // Act: each tab posts its own token.
    const openedFirst = await openOrFail(await posted(first));
    const openedSecond = await openOrFail(await posted(second));

    // Assert: neither overwrote the other.
    expect(second.key).not.toBe(first.key);
    expect(openedFirst.key).toBe(first.key);
    expect(openedSecond.key).toBe(second.key);
  });

  it("should build the exact admission body from the confirmed journey, with the reviewed version unchanged", () => {
    const journey = confirmDocumentDeletionJourney(newDocumentDeletionJourney("case-1", "doc-9", 3, NOW), { reason: REASON });

    expect(isConfirmedDocumentDeletionJourney(journey)).toBe(true);
    expect(documentDeletionRequestBody(journey)).toEqual({ reason: REASON, expectedDocumentVersion: 3 });
    expect(isConfirmedDocumentDeletionJourney(newDocumentDeletionJourney("case-1", "doc-9", 3, NOW))).toBe(false);
  });

  it("should keep the key through a double submit or a back-navigated resubmit, so api sees one request", async () => {
    // Arrange: the form's token, posted twice, once with a changed reason.
    const req = await posted(newDocumentDeletionJourney("case-1", "doc-9", 3, NOW));

    // Act
    const first = confirmDocumentDeletionJourney(await openOrFail(req), { reason: REASON });
    const second = confirmDocumentDeletionJourney(await openOrFail(req), { reason: "Duplicate of another document" });

    // Assert: the same key and version either way, so a changed reason is api's reused-key refusal, never a second request.
    expect(second.key).toBe(first.key);
    expect(second.documentVersion).toBe(first.documentVersion);
  });

  it("should replay exactly the sealed body on recovery, whatever reason is posted beside it", async () => {
    // Arrange: the recovery page's token, carrying the body that may already have been admitted.
    const sealed = confirmDocumentDeletionJourney(newDocumentDeletionJourney("case-1", "doc-9", 3, NOW), { reason: REASON });
    const reopened = await openOrFail(await posted(sealed, "session-a", { reason: "Something else entirely" }));

    // Act
    const replayed = confirmDocumentDeletionJourney(reopened, { reason: "Something else entirely" });

    // Assert: no new key after an uncertain result, and the original body.
    expect(replayed).toEqual(sealed);
    expect(documentDeletionRequestBody(replayed)).toEqual({ reason: REASON, expectedDocumentVersion: 3 });
  });

  it("should stop a recovery token in another session, so a lost access or a new sign-in cannot replay it", async () => {
    const sealed = confirmDocumentDeletionJourney(newDocumentDeletionJourney("case-1", "doc-9", 3, NOW), { reason: REASON });
    const token = await sealDocumentDeletionJourney(request("session-a"), sealed);

    expect(await openDocumentDeletionJourney(request("session-b", { journey: token }), "case-1", "doc-9", NOW)).toEqual({ state: "invalid" });
  });

  it("should unseal on a definite refusal, keeping the key, the version and the reason as sent", () => {
    const sealed = confirmDocumentDeletionJourney(newDocumentDeletionJourney("case-1", "doc-9", 3, NOW), { reason: REASON });

    for (const code of [null, "DOCUMENT_IN_USE", "DOCUMENT_STORAGE_UNRESOLVED", "DOCUMENT_SHARED", "APPLICATION_DELETION_PENDING"]) {
      const next = afterDefiniteRefusal(sealed, code);

      expect(next).toEqual({
        next: "redraw",
        reason: REASON,
        journey: { key: sealed.key, caseId: "case-1", documentId: "doc-9", documentVersion: 3, issuedAt: NOW }
      });
      if (next.next === "redraw") expect(isConfirmedDocumentDeletionJourney(next.journey)).toBe(false);
    }
  });

  it("should let a deliberate resubmit after a definite refusal carry a corrected reason under the same key", () => {
    const sealed = confirmDocumentDeletionJourney(newDocumentDeletionJourney("case-1", "doc-9", 3, NOW), { reason: REASON });
    const next = afterDefiniteRefusal(sealed, "DOCUMENT_IN_USE");
    if (next.next !== "redraw") throw new Error("expected a redraw");

    const resubmitted = confirmDocumentDeletionJourney(next.journey, { reason: "Uploaded to the wrong application" });

    expect(resubmitted.key).toBe(sealed.key);
    expect(documentDeletionRequestBody(resubmitted)).toEqual({ reason: "Uploaded to the wrong application", expectedDocumentVersion: 3 });
  });

  it("should require a fresh review after a changed document or a reused key, offering nothing of this journey", () => {
    const sealed = confirmDocumentDeletionJourney(newDocumentDeletionJourney("case-1", "doc-9", 3, NOW), { reason: REASON });

    expect(afterDefiniteRefusal(sealed, "DOCUMENT_CHANGED")).toEqual({ next: "review" });
    expect(afterDefiniteRefusal(sealed, "KEY_REUSED")).toEqual({ next: "review" });
  });

  it("should seal a reason at api's longest, with the longest ids, within the token limit", async () => {
    const reason = "😀".repeat(DOCUMENT_DELETION_REASON_LIMITS.maxLength);
    const journey = confirmDocumentDeletionJourney(newDocumentDeletionJourney("c".repeat(255), "d".repeat(255), Number.MAX_SAFE_INTEGER, NOW), { reason });

    const opened = await openDocumentDeletionJourney(await posted(journey), "c".repeat(255), "d".repeat(255), NOW);

    expect(opened).toEqual({ state: "open", journey });
  });

  it("should refuse to seal or open without a session", async () => {
    const req = Object.assign(pageRequest(), { sessionID: undefined });

    await expect(sealDocumentDeletionJourney(req as never, newDocumentDeletionJourney("case-1", "doc-9", 3, NOW))).rejects.toThrow("requires a session");
  });
});
