/**
 * api's `GET /me` answer for a token, or undefined when api could not give one.
 *
 * Shared by sign-in, refresh and the backfill of older sessions, which each decide what a missing answer means:
 * no access, the previous answer, and asking again next request. Never throws, because none of the three may fail
 * the request over it. The WARN names the occasion and the failure, and never the token or the subject.
 */
import { type CallerAccess, findCallerAccess } from "@hmcts/deed-poll";

const CONSEQUENCE: Record<AccessOccasion, string> = {
  "sign-in": "the session has no access until its next refresh",
  refresh: "the session keeps its previous answer",
  backfill: "this request has no access and the next will ask again"
};

export async function fetchCallerAccess(accessToken: string, occasion: AccessOccasion): Promise<CallerAccess | undefined> {
  try {
    return await findCallerAccess({ accessToken });
  } catch (error) {
    console.warn(`GET /me failed at ${occasion}; ${CONSEQUENCE[occasion]}:`, describe(error));
    return undefined;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

export type AccessOccasion = "sign-in" | "refresh" | "backfill";
