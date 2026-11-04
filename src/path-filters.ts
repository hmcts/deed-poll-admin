/**
 * The Nunjucks side of `casePath`, `referralPath` and `pathSegment`: how a template puts an id into an `href`.
 *
 * admin#193 made every redirect and handler-built link name a case or referral through these helpers, so an id
 * is exactly one path segment and an empty, `.` or `..` id is refused. Templates still interpolated ids raw
 * (`/deed-polls/{{ case.id }}`), or through `urlencode`, which keeps `/`, `?` and `#` in the segment but leaves dot
 * segments alone. These filters give templates the same contract, so `src/template-hrefs.test.ts` can require it.
 *
 * Every environment that renders a page template registers them: `app.ts`, and each template test.
 */
import type nunjucks from "nunjucks";
import { casePath } from "./case-path.js";
import { referralPath } from "./judicial-referral-path.js";
import { pathSegment } from "./path-segment.js";

export function addPathFilters(env: nunjucks.Environment): nunjucks.Environment {
  env.addFilter("casePath", (id: unknown) => casePath(String(id)));
  env.addFilter("referralPath", (id: unknown) => referralPath(String(id)));
  env.addFilter("pathSegment", (id: unknown) => pathSegment(String(id), "Path id"));
  return env;
}
