/**
 * Mapping an IDAM identity onto the domain's `CurrentUser`.
 *
 * The workspace standard is explicit that these are separate concerns: *"OpenID Connect establishes
 * the user identity. Services are responsible for their own authorization decisions."*
 * (`docs/reference/standards/authentication-and-authorization.md`). IDAM is sign-in only, so this file reads
 * nothing from the claims but a display name. **No role an IDAM token asserts is read here**: what a caller may
 * do is api's `GET /me` answer, passed in beside the claims.
 *
 * It takes a plain claims object, so the domain needs no OIDC library.
 */
import { type CurrentUser, currentUser } from "./current-user.js";

/**
 * The subset of an IDAM ID token this service reads.
 *
 * Deliberately loose: an ID token carries far more than this, the exact shape varies by IDAM
 * configuration, and asserting a tight type over a document controlled elsewhere would fail at
 * runtime the first time a claim moved. Everything is narrowed defensively below.
 */
export interface IdamClaims {
  name?: unknown;
  given_name?: unknown;
  family_name?: unknown;
  sub?: unknown;
  [claim: string]: unknown;
}

/** IDAM's name for the caller, with api's `GET /me` answer as their access. No answer is no access. */
export function userFromClaims(claims: IdamClaims, access?: unknown): CurrentUser {
  return currentUser(access, displayNameFrom(claims));
}

/**
 * A display name for the audit columns, in descending order of preference.
 *
 * Falls through to `sub` before giving up, because `createdBy` reading as an opaque identifier is
 * still traceable, whereas the service-account fallback would attribute a real person's write to an
 * automated one. `currentUser` supplies that fallback if everything here is absent.
 */
function displayNameFrom(claims: IdamClaims): string | undefined {
  const name = str(claims.name);
  if (name) return name;

  const given = str(claims.given_name);
  const family = str(claims.family_name);
  if (given || family) return [given, family].filter(Boolean).join(" ");

  return str(claims.sub);
}

function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
