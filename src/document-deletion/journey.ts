/**
 * The document deletion confirmation's state, carried in one signed hidden control rather than the session, as
 * application deletion's is (`src/application-deletion/journey.ts`), so two tabs on two documents (or on one) never
 * replace each other's.
 *
 * The key is minted **once, when the confirmation page renders**, and travels inside the signed state with the case's
 * id, the document's id and its `documentVersion` as reviewed. So a retry, a double submit and a back-navigated
 * resubmit all send the same key, and api answers them with the same request (or, for a changed reason, refuses the
 * reused key): nothing here can create a second request. Once a submission has been sent, its reason is sealed with
 * it and the recovery action replays exactly that body; no control posted beside it can change it. A forged, altered,
 * expired, other-session, other-case or other-document token opens as nothing, which the page answers with no write.
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { DOCUMENT_DELETION_REASON_LIMITS, type DocumentDeletionFormInput, type DocumentDeletionRequestBody } from "@hmcts/deed-poll";
import type { Request } from "express";
import { z } from "zod";

/**
 * How long a rendered confirmation stays usable: a working day, inside a session's own 10-hour absolute limit. The
 * signature is bound to the session, so a token can never outlive it, and this bounds a copied one further.
 */
export const DOCUMENT_DELETION_JOURNEY_TTL_MS = 8 * 60 * 60 * 1000;

// A sealed journey whose answer was a refusal that only a fresh review can get past: `DOCUMENT_CHANGED` means the
// document is not the version reviewed, and `KEY_REUSED` that this key already carries a different request.
const REVIEW_AGAIN_CODES: ReadonlySet<string> = new Set(["DOCUMENT_CHANGED", "KEY_REUSED"]);
const MAX_TOKEN_LENGTH = 8_192;
const INVALID: OpenedDocumentDeletionJourney = { state: "invalid" };
const journeySchema = z
  .object({
    key: z.uuid(),
    caseId: z.string().min(1).max(255),
    documentId: z.string().min(1).max(255),
    documentVersion: z.int().min(1),
    issuedAt: z.number().int().nonnegative(),
    confirmed: z
      .object({
        reason: z
          .string()
          .min(DOCUMENT_DELETION_REASON_LIMITS.minLength)
          .max(DOCUMENT_DELETION_REASON_LIMITS.maxLength * 2)
      })
      .strict()
      .optional()
  })
  .strict();

export function newDocumentDeletionJourney(caseId: string, documentId: string, documentVersion: number, now = Date.now()): DocumentDeletionJourney {
  return { key: randomUUID(), caseId, documentId, documentVersion, issuedAt: now };
}

export async function sealDocumentDeletionJourney(req: Request, journey: DocumentDeletionJourney): Promise<string> {
  const payload = Buffer.from(JSON.stringify(journeySchema.parse(journey))).toString("base64url");
  return `${payload}.${await signature(req, payload)}`;
}

/** Reads the posted `journey` control for the case and document in the path. Only `open` may lead to a write. */
export async function openDocumentDeletionJourney(req: Request, caseId: string, documentId: string, now = Date.now()): Promise<OpenedDocumentDeletionJourney> {
  const token: unknown = req.body?.journey;
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) return INVALID;
  const [payload, mac, extra] = token.split(".");
  if (!payload || !mac || extra !== undefined || !/^[a-f0-9]{64}$/.test(mac)) return INVALID;
  if (!timingSafeEqual(Buffer.from(mac), Buffer.from(await signature(req, payload)))) return INVALID;
  const journey = parsed(payload);
  if (journey === null || journey.caseId !== caseId || journey.documentId !== documentId) return INVALID;
  if (now - journey.issuedAt > DOCUMENT_DELETION_JOURNEY_TTL_MS || journey.issuedAt > now) return { state: "expired" };
  return { state: "open", journey };
}

/**
 * The journey with the staff member's reason sealed into it. A journey already confirmed keeps its reason, because its
 * key may already have been admitted with it: the recovery action cannot edit what it replays.
 */
export function confirmDocumentDeletionJourney(journey: DocumentDeletionJourney, input: DocumentDeletionFormInput): ConfirmedDocumentDeletionJourney {
  return { ...journey, confirmed: journey.confirmed ?? { reason: input.reason } };
}

export function isConfirmedDocumentDeletionJourney(journey: DocumentDeletionJourney): journey is ConfirmedDocumentDeletionJourney {
  return journey.confirmed !== undefined;
}

/** The exact admission body a confirmed journey sends, and replays on recovery. */
export function documentDeletionRequestBody(journey: ConfirmedDocumentDeletionJourney): DocumentDeletionRequestBody {
  return { reason: journey.confirmed.reason, expectedDocumentVersion: journey.documentVersion };
}

/**
 * What a definite refusal (a 400, or a 409 with api's `code`) leaves the page able to do. api admitted nothing, so
 * the same key may carry the same or a corrected reason: the journey is unsealed, not replaced, and the reason as sent
 * is kept to redraw. Only a fresh review can follow a changed document or a reused key, because the version or the
 * key this journey binds is no longer one api will admit, so nothing about this journey is offered again.
 */
export function afterDefiniteRefusal(journey: ConfirmedDocumentDeletionJourney, code: string | null = null): RefusalNext {
  if (code !== null && REVIEW_AGAIN_CODES.has(code)) return { next: "review" };
  const { confirmed, ...unsealed } = journey;
  return { next: "redraw", journey: unsealed, reason: confirmed.reason };
}

function parsed(payload: string): DocumentDeletionJourney | null {
  try {
    const result = journeySchema.safeParse(JSON.parse(Buffer.from(payload, "base64url").toString()));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

async function signature(req: Request, payload: string): Promise<string> {
  if (!req.sessionID) throw new Error("Document deletion journey requires a session");
  // Lazy import: server.ts loads vault secrets before createApp imports config.
  const { default: config } = await import("config");
  return createHmac("sha256", config.get<string>("session.secret")).update(`document-deletion-v1:${req.sessionID}:${payload}`).digest("hex");
}

export type DocumentDeletionJourney = z.infer<typeof journeySchema>;
export type ConfirmedDocumentDeletionJourney = DocumentDeletionJourney & { confirmed: NonNullable<DocumentDeletionJourney["confirmed"]> };
export type OpenedDocumentDeletionJourney = { state: "open"; journey: DocumentDeletionJourney } | { state: "expired" } | { state: "invalid" };
export type RefusalNext = { next: "redraw"; journey: DocumentDeletionJourney; reason: string } | { next: "review" };
