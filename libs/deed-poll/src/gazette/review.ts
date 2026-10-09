import { createHash } from "node:crypto";
import type { CaseDetail } from "@hmcts/deed-poll-api-client";
import { z } from "zod";
import type { Caller } from "../api/deed-poll-api.js";
import { findDeedPoll } from "../deed-poll/service.js";

export const GAZETTE_CHECKS = ["enrolled", "queries", "names", "documents", "signOff"] as const;
const acknowledgement = z
  .array(z.enum(GAZETTE_CHECKS))
  .length(5)
  .refine((values) => new Set(values).size === 5);

export function gazetteChecklistComplete(input: unknown): boolean {
  return acknowledgement.safeParse(input).success;
}

/** A conservative review version, including nested notes, witnesses and documents. Never sent to API. */
export function gazetteReviewVersion(record: CaseDetail): string {
  return createHash("sha256").update(JSON.stringify(record)).digest("hex");
}

export async function gazetteReviewsCurrent(reviews: { id: string; version: string }[], caller: Caller): Promise<boolean> {
  for (let offset = 0; offset < reviews.length; offset += 10) {
    const group = reviews.slice(offset, offset + 10);
    const records = await Promise.all(group.map((review) => findDeedPoll(review.id, caller)));
    if (records.some((record, index) => gazetteReviewVersion(record) !== group[index].version)) return false;
  }
  return true;
}
