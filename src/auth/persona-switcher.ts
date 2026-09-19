/**
 * The persona switcher — the non-production control that signs the user in as a different test persona so one
 * person can exercise the caseworker, caseworker-admin and judicial screens in a single sitting. See
 * `docs/plans/dev-persona-switcher.md`.
 *
 * Three things live here: whether this process may offer it at all, the personas it offers, and the strip the
 * layout renders. They are one file because the first is what makes the other two safe, and a list of
 * identities to mint tokens for should not be readable without the paragraphs below next to it.
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
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { sessionSubject, sessionUser } from "./session.js";

/** The only environments in which the persona switcher may be offered. */
export const PERSONA_SWITCHER_ENVIRONMENTS = new Set(["development", "test", "aat", "preview"]);

/**
 * Where the switcher posts.
 *
 * A `POST` and never a `GET` link (decision 6): a crafted URL — in an email, in an `<img>` on another page —
 * must not be able to change somebody's persona, and a switch is not a navigation. `src/pages/switch-persona.ts`
 * exports `POST` and nothing else, so `simple-router` registers no `GET` at all and one is a 404 rather than a
 * handler that refuses. This constant is here so the form's action and the route file cannot disagree about the
 * path — `switch-persona.test.ts` pins them against each other.
 */
export const PERSONA_SWITCH_PATH = "/switch-persona";

/**
 * The personas the switcher offers, and **the only identities it will ever obtain a token for.**
 *
 * That is the list the security posture turns on: "never mint a token for a user it was not explicitly
 * configured to offer". An id arriving in a form body is looked up here and nothing else — there is no path
 * from a request to an arbitrary username.
 *
 * The usernames are the local fixtures `scripts/seed-idam-users.mjs` creates. AAT cannot use fixed accounts
 * at all (its test users are cleaned up after three hours), so task 5 resolves the same three personas
 * differently there; what stays is the shape — three named personas, each with one identity behind it.
 *
 * **The names are personas, not roles, and that is deliberate.** A plain caseworker holds *no* IDAM role —
 * "caseworker" is the absence of `caseworker-deedpoll-admin`, not a role of its own — so a control offering
 * "roles" would be offering one that does not exist. Naming people avoids asserting anything about the role
 * list, which is api's to derive from the token anyway.
 */
export const PERSONAS: readonly Persona[] = [
  { id: "caseworker", name: "Caseworker", username: "caseworker@example.com" },
  { id: "admin", name: "Caseworker with admin", username: "admin@example.com" },
  { id: "judge", name: "Judge", username: "judge@example.com" }
];

/**
 * The strip's own copy, **English only and deliberately not in `src/locales`.**
 *
 * Every other piece of chrome takes its text from the locale files, and this does not, for two reasons that
 * point the same way. `scripts/extract-welsh-strings.mjs` scans `src/locales`, so putting it there would add
 * a development tool to `.business_context/welsh-translation-request.csv` — a bill for translating text no
 * citizen can ever reach, which is the same judgement that keeps the template's demo pages out of that scope.
 * And `yarn welsh:check` fails on a `cy` value identical to its `en` one, so the alternative to paying for it
 * is a red check with no defect behind it.
 *
 * Held here rather than inlined in the template so the markup carries no English of its own, per
 * `.claude/rules/frontend.md`.
 */
const COPY = {
  tag: "Dev only",
  label: "Switch persona",
  /** Prefixes each button's accessible name, so "Judge" and "Caseworker" are not three links called "Switch". */
  switchTo: "Switch to",
  current: "current"
};

export function personaSwitcherEnabled(): boolean {
  // Strictly `true`, not truthy: `custom-environment-variables.json` declares `__format: "json"` so that
  // `PERSONA_SWITCHER_ENABLED=true` arrives as a boolean. Without that, config hands back the *string*
  // `"false"`, which is truthy — a value meaning "off" that reads as "on" is how this ends up enabled in
  // production.
  return config.get<boolean>("personaSwitcher.enabled") === true && PERSONA_SWITCHER_ENVIRONMENTS.has(config.get<string>("environmentName"));
}

/**
 * The credentials to obtain a token with, for a persona id that arrived in a form body — or `undefined`.
 *
 * **This is where "never mint a token for a user it was not explicitly configured to offer" is enforced.**
 * The id is `unknown` because that is what a request body is, and the only thing done with it is a lookup in
 * `PERSONAS`: there is no path from a request to an arbitrary username, and an id that matches nothing gets
 * no credentials rather than a guess. The caller answers 404 to that, so the route discloses nothing about
 * which ids exist either.
 *
 * **The password is one value for the whole fixture set, and it is configuration rather than a secret.**
 * `scripts/seed-idam-users.mjs` creates all three local users with the same one, so a value here that drifted
 * from the seeder's would fail every switch at IDAM with a 400 and nothing to say why. It is read from
 * `config` — `config/default.json` carries the local fixture value and `PERSONA_SWITCHER_PASSWORD` overrides
 * it — because AAT's personas cannot be fixed accounts at all (its test users are cleaned up after three
 * hours), so task 5 creates them on demand and has to be able to say what it created them with. Nothing here
 * ever reads a *real* user's credentials, which is the security posture's first prohibition.
 */
export function personaCredentials(id: unknown): PersonaCredentials | undefined {
  const persona = PERSONAS.find((candidate) => candidate.id === id);
  if (!persona) return undefined;

  return { username: persona.username, password: config.get<string>("personaSwitcher.password") };
}

/**
 * Put the strip on `res.locals`, so `src/pages/layouts/app.njk` renders it on every page without any page
 * knowing it exists.
 *
 * Mounted once in `src/app.ts` rather than added to each page's view model, which is the only shape that can
 * satisfy "on every page and for every persona": a page-by-page opt-in would be missing from the next page
 * somebody writes, and the pages under `src/pages/judicial/` deliberately never ask about the role.
 *
 * Nothing is assigned when the switcher is off, so the template's `{% if personaSwitcher %}` is the whole of
 * the gate at render time and a page cannot show a control this process would refuse to honour.
 */
export function personaSwitcherLocals(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const view = personaSwitcherView(req);
    if (view) res.locals.personaSwitcher = view;
    next();
  };
}

/**
 * The strip as the template renders it, or `undefined` for no strip at all.
 *
 * **Absent for an anonymous visitor**, not merely empty. `/login` and the footer pages are on `requireAuth`'s
 * public allowlist, so they render for someone with no session — and a switcher there would offer to change a
 * persona that does not exist yet. Signing in is how you pick the first one.
 */
function personaSwitcherView(req: Request): PersonaSwitcherView | undefined {
  if (!personaSwitcherEnabled() || !sessionUser(req)) return undefined;

  // `sessionSubject` is the IDAM subject the session was established for, which is the persona's username
  // locally. Matching it marks the current persona; **failing to match marks none**, which is the right answer
  // for a real user who signed in through IDAM normally rather than a state to guard against. The switcher is
  // usable either way — nothing here decides what may be switched to.
  const subject = sessionSubject(req)?.toLowerCase();

  return {
    ...COPY,
    action: PERSONA_SWITCH_PATH,
    personas: PERSONAS.map(({ id, name, username }) => ({ id, name, isCurrent: subject === username.toLowerCase() }))
  };
}

export interface Persona {
  id: string;
  name: string;
  username: string;
}

interface PersonaCredentials {
  username: string;
  password: string;
}

interface PersonaSwitcherView {
  tag: string;
  label: string;
  switchTo: string;
  current: string;
  action: string;
  personas: { id: string; name: string; isCurrent: boolean }[];
}
