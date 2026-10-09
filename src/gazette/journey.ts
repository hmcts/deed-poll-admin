import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { z } from "zod";

const review = z.object({ id: z.string().min(1).max(255), version: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const confirmation = z
  .object({
    key: z.uuid(),
    caseIds: z.array(z.string().min(1).max(255)).min(1).max(100),
    recipientRevision: z.number().int().nonnegative(),
    selectionFingerprint: z.string().min(1).max(512),
    recipientEmail: z.string().max(254),
    expiresAt: z.string(),
    adultCount: z.number().int().nonnegative(),
    minorCount: z.number().int().nonnegative(),
    references: z.array(z.string().max(255)).min(1).max(100)
  })
  .strict();
const journeySchema = z
  .object({
    id: z.uuid(),
    createdAt: z.number().int(),
    reviews: z.array(review).max(100),
    selected: z.array(z.string().min(1).max(255)).max(100),
    page: z.number().int().min(1),
    phase: z.enum(["select", "review", "confirm", "recover", "refused"]),
    reviewing: review.optional(),
    confirmation: confirmation.optional()
  })
  .strict();

export function newGazetteJourney(): GazetteJourney {
  return { id: randomUUID(), createdAt: Date.now(), reviews: [], selected: [], page: 1, phase: "select" };
}

/** Signed, session-bound hidden state: tabs cannot replace each other's batch or forge a review. */
export async function sealGazetteJourney(req: Request, journey: GazetteJourney): Promise<string> {
  const payload = Buffer.from(JSON.stringify(journeySchema.parse(journey))).toString("base64url");
  return `${payload}.${await signature(req, payload)}`;
}

export async function openGazetteJourney(req: Request): Promise<GazetteJourney | null> {
  const token: unknown = req.body?.journey;
  if (typeof token !== "string" || token.length > 500_000) return null;
  const [payload, mac, extra] = token.split(".");
  if (!payload || !mac || extra || !/^[a-f0-9]{64}$/.test(mac)) return null;
  const expected = await signature(req, payload);
  if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const result = journeySchema.safeParse(JSON.parse(Buffer.from(payload, "base64url").toString()));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** Deterministic per visit: returning to an old selection form cannot mint a replacement request key. */
export async function gazetteRequestKey(req: Request, journey: GazetteJourney): Promise<string> {
  const hex = await signature(req, `request:${journey.id}`);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function selectedGazetteCases(journey: GazetteJourney, input: unknown): string[] | null {
  const ids = input === undefined ? [] : typeof input === "string" ? [input] : input;
  if (!Array.isArray(ids) || ids.length > 100 || new Set(ids).size !== ids.length) return null;
  return ids.every((id) => typeof id === "string" && journey.reviews.some((r) => r.id === id)) ? ids : null;
}

async function signature(req: Request, payload: string): Promise<string> {
  if (!req.sessionID) throw new Error("Gazette journey requires a session");
  // Lazy import: server.ts loads vault secrets before createApp imports config.
  const { default: config } = await import("config");
  return createHmac("sha256", config.get<string>("session.secret")).update(`gazette-v1:${req.sessionID}:${payload}`).digest("hex");
}

export type GazetteJourney = z.infer<typeof journeySchema>;
