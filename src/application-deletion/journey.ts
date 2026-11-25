/**
 * The deletion confirmation's state, carried in one signed hidden control rather than the session, as the Gazette
 * batch's is (`src/gazette/journey.ts`), so two tabs on two applications (or on one) never replace each other's.
 *
 * The key is minted **once, when the confirmation page renders**, and travels inside the signed state with the
 * application's id and its `lastChangedOn` as reviewed. So a retry, a double submit and a back-navigated resubmit all
 * send the same key, and api answers them with the same request (or, for a changed reason or note, refuses the reused
 * key with a 409): nothing here can create a second request. Once a submission has been confirmed, its body is sealed
 * with it, and the recovery action replays that body; no control posted beside it can change it. A forged, altered,
 * expired, other-session or other-application token opens as nothing, which the page answers with no write.
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { DELETION_NOTE_LIMITS, DELETION_REASON, type DeletionFormInput, type DeletionRequestBody } from "@hmcts/deed-poll";
import type { Request } from "express";
import { z } from "zod";

/**
 * How long a rendered confirmation stays usable. A working day, and inside a session's own 10-hour absolute limit:
 * the signature is bound to the session, so a token can never outlive it, and this bounds a copied one further.
 */
export const DELETION_JOURNEY_TTL_MS = 8 * 60 * 60 * 1000;

const MAX_TOKEN_LENGTH = 8_192;
const INVALID: OpenedJourney = { state: "invalid" };
const journeySchema = z
  .object({
    key: z.uuid(),
    caseId: z.string().min(1).max(255),
    lastChangedOn: z.string().min(1).max(64),
    issuedAt: z.number().int().nonnegative(),
    confirmed: z
      .object({
        reason: z.enum(DELETION_REASON),
        note: z
          .string()
          .min(1)
          .max(DELETION_NOTE_LIMITS.maxLength * 2)
      })
      .strict()
      .optional()
  })
  .strict();

export function newDeletionJourney(caseId: string, lastChangedOn: string, now = Date.now()): DeletionJourney {
  return { key: randomUUID(), caseId, lastChangedOn, issuedAt: now };
}

export async function sealDeletionJourney(req: Request, journey: DeletionJourney): Promise<string> {
  const payload = Buffer.from(JSON.stringify(journeySchema.parse(journey))).toString("base64url");
  return `${payload}.${await signature(req, payload)}`;
}

/** Reads the posted `journey` control for the application in the path. Only `open` may lead to a write. */
export async function openDeletionJourney(req: Request, caseId: string, now = Date.now()): Promise<OpenedJourney> {
  const token: unknown = req.body?.journey;
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) return INVALID;
  const [payload, mac, extra] = token.split(".");
  if (!payload || !mac || extra !== undefined || !/^[a-f0-9]{64}$/.test(mac)) return INVALID;
  if (!timingSafeEqual(Buffer.from(mac), Buffer.from(await signature(req, payload)))) return INVALID;
  const journey = parsed(payload);
  if (journey === null || journey.caseId !== caseId) return INVALID;
  if (now - journey.issuedAt > DELETION_JOURNEY_TTL_MS || journey.issuedAt > now) return { state: "expired" };
  return { state: "open", journey };
}

/**
 * The journey with the Delivery Manager's answers sealed into it. A journey already confirmed keeps its answers,
 * because its key may already have been admitted with them: the recovery action cannot edit what it replays.
 */
export function confirmDeletionJourney(journey: DeletionJourney, input: DeletionFormInput): ConfirmedDeletionJourney {
  const confirmed = journey.confirmed ?? { reason: input.reason, note: input.note };
  return { ...journey, confirmed };
}

/** The exact admission body a confirmed journey replays. */
export function deletionRequestBody(journey: ConfirmedDeletionJourney): DeletionRequestBody {
  return { reason: journey.confirmed.reason, note: journey.confirmed.note, expectedLastChangedOn: journey.lastChangedOn };
}

function parsed(payload: string): DeletionJourney | null {
  try {
    const result = journeySchema.safeParse(JSON.parse(Buffer.from(payload, "base64url").toString()));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

async function signature(req: Request, payload: string): Promise<string> {
  if (!req.sessionID) throw new Error("Application deletion journey requires a session");
  // Lazy import: server.ts loads vault secrets before createApp imports config.
  const { default: config } = await import("config");
  return createHmac("sha256", config.get<string>("session.secret")).update(`application-deletion-v1:${req.sessionID}:${payload}`).digest("hex");
}

export type DeletionJourney = z.infer<typeof journeySchema>;
export type ConfirmedDeletionJourney = DeletionJourney & { confirmed: NonNullable<DeletionJourney["confirmed"]> };
export type OpenedJourney = { state: "open"; journey: DeletionJourney } | { state: "expired" } | { state: "invalid" };
