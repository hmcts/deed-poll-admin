/**
 * Refuses a state-changing request that another site's page sent — the CSRF gap `SameSite=Lax` does not
 * close in this estate.
 *
 * **Why Lax is not enough here.** `SameSite` is decided on the registrable domain, not the host: every CFT
 * service in an environment is a subdomain of `platform.hmcts.net`, so a form on
 * `some-other-service.aat.platform.hmcts.net` posting here is *same-site* and the browser attaches the
 * session cookie in full. Lax stops `evil.example` and nothing inside the estate — so an XSS in any sibling
 * service is otherwise a way to make a signed-in caseworker's browser write through this app: raise a
 * referral, delete a witness, switch persona.
 *
 * **`Sec-Fetch-Site` and not `Origin`, and that is a measurement rather than a preference.** The obvious
 * check — `Origin` must name this host — cannot work in this app, because `configureHelmet()` sends
 * `Referrer-Policy: no-referrer` and Chromium answers that by sending `Origin: null` on form navigations.
 * Measured against a probe server sending the same header (2026-09-20, the bundled Chromium):
 *
 *   | request                                        | `Origin`                | `Sec-Fetch-Site` |
 *   |------------------------------------------------|-------------------------|------------------|
 *   | this app's own form, same origin               | `null`                  | `same-origin`    |
 *   | a form on another port, i.e. a sibling service | `null`                  | `same-site`      |
 *   | `fetch()` from that sibling's page             | `http://localhost:4102` | `same-site`      |
 *
 * The first two are the ones that matter: `Origin` is *identical* for a legitimate post and a forged one, so
 * an `Origin` gate either refuses every form in the service or admits every sibling. `Sec-Fetch-Site` tells
 * them apart, and no referrer policy or page-level opt-out changes it — it is a forbidden header name, so
 * nothing a compromised page can run may set or remove it.
 *
 * **Not a synchronizer token.** A token is the stronger control, and it has to be threaded through every
 * form template and every multipart post, where a form that omits one fails at submit time — on one page,
 * once it is deployed. One middleware mounted globally covers every route that exists and every route added
 * later, which is the argument `requireAuth`'s global mount makes. If a token is added later this stays:
 * they fail differently.
 *
 * **A request carrying neither header is allowed, deliberately.** Browsers old enough to send no
 * `Sec-Fetch-Site` (Safari before 16.4, Firefox before 90) are covered only by the `Origin` fallback below,
 * and `Origin: null` cannot be read as evidence of forgery *because of the measurement above* — the same
 * value arrives from this app's own forms. What sends neither is a non-browser client, which this app has:
 * `e2e-tests/tests/judicial.spec.ts` posts to a claim route through Playwright's `APIRequestContext` to
 * prove a second claim is refused. Refusing that would answer a question about provenance with a lie, and a
 * client with no cookies is not the threat. Compare `requireAuth`, which does fail closed: an absent session
 * is unambiguous, and an absent `Sec-Fetch-Site` is not.
 *
 * Refuses with `next(new ForbiddenError(...))` and renders nothing, so the status and how much it discloses
 * both stay in the one mapping in `src/errors.ts` — the shape `./require-role.ts` uses.
 */
import { type ForbiddenDetails, ForbiddenError } from "@hmcts/deed-poll";
import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * The methods a cross-site page could use to change something here.
 *
 * `GET` and `HEAD` are absent because a `GET` must not change anything in the first place. A router that
 * grew a state-changing `GET` would be the bug, and this gate must not be what hides it.
 */
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * The two `Sec-Fetch-Site` values a write may carry.
 *
 * `same-origin` is one of this app's own pages. `none` is a user-initiated request with no initiating
 * document at all — a bookmark, a typed URL, a session restore; rare for a post, and permitted because it is
 * *by definition* not another site's page. `same-site` is refused, and that is the whole point: it is the
 * sibling CFT service `SameSite=Lax` lets through.
 */
const PERMITTED_FETCH_SITES = new Set(["same-origin", "none"]);

/**
 * The refused `Sec-Fetch-Site` values the specification defines, which are all the security event records verbatim.
 * A page cannot set the header but a script can, so anything else is recorded as `unrecognised` rather than as text
 * the sender chose.
 */
const REFUSED_FETCH_SITES = new Set(["same-site", "cross-site"]);

export function requireSameOrigin(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!UNSAFE_METHODS.has(req.method)) return next();

    const refusal = crossSiteRefusal(req);
    if (!refusal) return next();

    // For the log, never for the user: `errors.ts` renders the shared "Page not found" view. It names what
    // the headers said, because that is the only thing identifying which sibling service — or which
    // compromised page in one — sent the request, and nobody could reconstruct it afterwards. The event gets
    // only the bounded detail, never this text.
    next(new ForbiddenError(`${req.method} ${req.originalUrl} ${refusal.text}`, { reason: "same-origin", ...refusal.details }));
  };
}

/** Why this write is not one of this app's own pages, or `undefined` if there is no reason to think it is not. */
function crossSiteRefusal(req: Request): Refusal | undefined {
  const site = req.get("sec-fetch-site");
  if (site !== undefined) {
    if (PERMITTED_FETCH_SITES.has(site)) return undefined;
    return { text: `from a ${site} initiator`, details: { fetchSite: REFUSED_FETCH_SITES.has(site) ? site : "unrecognised" } };
  }

  // Only a browser too old to send fetch metadata reaches here. `null` is not evidence either way — this
  // app's own forms produce it under `Referrer-Policy: no-referrer` — so the only thing left to check is a
  // named origin that belongs to somebody else.
  const origin = req.get("origin");
  if (origin === undefined || origin === "null") return undefined;

  return isSameHost(origin, req) ? undefined : { text: `from cross-origin ${origin}`, details: { originHost: hostOf(origin) } };
}

/**
 * Whether a named origin is this app.
 *
 * Compared on host and not on the whole origin, because the scheme is not ours to assert: `trust proxy` is
 * on and TLS terminates at the ingress, so a same-host `http` origin is a transport problem HSTS answers
 * rather than a forgery. `req.get("host")` is the forwarded host under `trust proxy`, so it is the name the
 * browser used and the one it built the `Origin` from.
 */
function isSameHost(origin: string, req: Request): boolean {
  const host = req.get("host");
  if (!host) return false;

  return hostOf(origin) === host.toLowerCase();
}

/** The host alone, because a full origin is not a value the security event's `originHost` admits. */
function hostOf(origin: string): string | undefined {
  try {
    return new URL(origin).host.toLowerCase() || undefined;
  } catch {
    return undefined;
  }
}

interface Refusal {
  text: string;
  details: Pick<ForbiddenDetails, "fetchSite" | "originHost">;
}
