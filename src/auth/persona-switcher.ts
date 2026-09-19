/**
 * Whether this process may offer the persona switcher — the non-production control that signs the user in as
 * a different test persona so one person can exercise the caseworker, caseworker-admin and judicial screens
 * in a single sitting. See `docs/plans/dev-persona-switcher.md`.
 *
 * It is a **privilege-escalation mechanism by design**: it obtains a real IDAM token for another user, so
 * anyone who can reach it holds every persona it offers. Harmless locally, real in AAT, and unacceptable in
 * production — which is what the two independent conditions below are for.
 *
 * **`NODE_ENV` cannot gate this, and that is the whole reason this file is not shaped like
 * `plain-http.ts`.** `package.json`'s `start` is `NODE_ENV=production node dist/server.js`, so *every*
 * deployed pod runs as `NODE_ENV=production` — AAT and preview included. A `NODE_ENV` test therefore either
 * enables the switcher in production or disables it everywhere it is wanted; there is no third outcome. The
 * decision has to come from the chart, per environment, which is also the only shape
 * `src/deployment-chart.test.ts` can assert.
 *
 * So two conditions, each catching a different mistake:
 *
 *   - **The chart flag** (`PERSONA_SWITCHER_ENABLED`), default off in `config/default.json` and pinned off
 *     again in `config/production.json`. `charts/deed-poll-admin/values.yaml` — the base, which a future
 *     production deploy inherits — leaves it off; the aat and preview templates turn it on explicitly. This
 *     catches the switcher being deployed somewhere nobody asked for it.
 *   - **The environment allowlist** below, keyed on `ENVIRONMENT_NAME`, which `values.yaml` renders from
 *     `global.environment`. This catches the flag being set in the wrong values file: a `demo` or `prod`
 *     deploy that somehow carried `PERSONA_SWITCHER_ENABLED=true` still gets no switcher.
 *
 * **This is an allowlist, and it must not become a negation.**
 * `libs/deed-poll/src/auth/plain-http.ts` is the standing rule for this class of gate and gives the full
 * argument: `!== "production"` lets a relaxation through in `aat`, in preview, in any environment added
 * later, and under an unset variable — silently, because nothing fails. Naming the permitted environments
 * makes adding one a deliberate edit. **Do not "correct" this to `!== "production"`.**
 *
 * "test" is here because vitest sets `NODE_ENV=test` and nothing sets `ENVIRONMENT_NAME`, so the
 * `config/default.json` value applies — but note that the flag is still off by default there, so a test that
 * wants the switcher has to ask for it.
 */
import config from "config";

/** The only environments in which the persona switcher may be offered. */
export const PERSONA_SWITCHER_ENVIRONMENTS = new Set(["development", "test", "aat", "preview"]);

export function personaSwitcherEnabled(): boolean {
  // Strictly `true`, not truthy: `custom-environment-variables.json` declares `__format: "json"` so that
  // `PERSONA_SWITCHER_ENABLED=true` arrives as a boolean. Without that, config hands back the *string*
  // `"false"`, which is truthy — a value meaning "off" that reads as "on" is how this ends up enabled in
  // production.
  return config.get<boolean>("personaSwitcher.enabled") === true && PERSONA_SWITCHER_ENVIRONMENTS.has(config.get<string>("environmentName"));
}
