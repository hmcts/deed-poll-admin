/**
 * One id as exactly one URL path segment: refused if it is empty, `.` or `..`, otherwise encoded once.
 *
 * The one contract `casePath`, `referralPath` and every other id-bearing path in this app share. Encoding keeps `/`,
 * `?` and `#` inside the segment, but it leaves dots alone and a browser drops a `.` or `..` segment, so those would
 * name a parent path instead; no record can be there, so they are the 404 a missing one is. See
 * `docs/plans/completed/20261019-case-id-redirect-encoding.md`.
 *
 * Pass the id as Express or api gave it: route parameters are already decoded, so a literal `%2F` stays literal
 * (`%252F`). `label` is a fixed description from the caller, never request data, so the refusal's message repeats
 * nothing the request supplied. Build the path before any write, so a refusal cannot follow one.
 */
import { NotFoundError } from "@hmcts/deed-poll";

const UNUSABLE_SEGMENTS = new Set(["", ".", ".."]);

export function pathSegment(value: string, label: string): string {
  if (UNUSABLE_SEGMENTS.has(value)) {
    throw new NotFoundError(`${label} is not a usable path segment`);
  }
  return encodeURIComponent(value);
}
