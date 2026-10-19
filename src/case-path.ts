/**
 * The path of one case's page, with its id as exactly one path segment — the one way a redirect names a case.
 *
 * Fortify findings `14866335BEE273FA5B5E940E5044A8BA` and `250FCCE3CA8D832C8F3F69CF2AE609E4` flagged ids
 * interpolated raw into redirects. The fixed prefix kept the browser on this origin, but a raw `/`, `?` or `#`
 * still moved it to another path, query or fragment. See `docs/plans/completed/20261019-case-id-redirect-encoding.md`.
 *
 * Pass the id as Express or api gave it: Express has already decoded route parameters, so encoding it once here
 * keeps a literal `%2F` literal. Domain calls keep the raw id; only the URL is encoded.
 *
 * Empty, `.` and `..` are refused because encoding leaves dots alone and a browser drops a dot segment, so they
 * would name the case list or the site root. Call this before any write, so a refusal cannot follow one.
 */
import { pathSegment } from "./path-segment.js";

const CASES_PATH = "/deed-polls";

export function casePath(caseId: string): string {
  return `${CASES_PATH}/${pathSegment(caseId, "Case id")}`;
}
