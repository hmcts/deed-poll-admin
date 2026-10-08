/**
 * The persona switcher — the non-production control that signs the user in as a different test persona so one
 * person can exercise the caseworker, caseworker-admin and judicial screens in a single sitting. See
 * `docs/plans/completed/dev-persona-switcher.md`.
 *
 * Three things live here: whether this process may offer it at all, the personas it offers, and the strip the
 * layout renders. They are one file because the first is what makes the other two safe, and a list of
 * identities to mint tokens for should not be readable without the paragraphs below next to it.
 *
 * **Which IDAM user a persona actually is belongs to `./persona-users.ts`**, because that answer differs per
 * environment: locally the seeded fixtures, in AAT a user created on demand because its test users are swept
 * after three hours. That file also decides when a persona cannot be offered at all and what to say about it,
 * and the strip below renders whatever it reports.
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
 *   - **The chart flag** (`PERSONA_SWITCHER_ENABLED`), default off in `config/default.json`.
 *     `charts/deed-poll-admin/values.yaml` — the base, which a future production deploy inherits — leaves it
 *     off; the aat and preview templates turn it on explicitly. This catches the switcher being deployed
 *     somewhere nobody asked for it. **`config/production.json` restates the `false` and cannot enforce it**:
 *     node-config applies `custom-environment-variables.json` *after* `{NODE_ENV}.json`, so the environment
 *     variable always wins — as it must, since every deployed pod including AAT's runs `NODE_ENV=production`.
 *     The values files are the only thing holding the flag; the allowlist below is the second control.
 *   - **The environment allowlist** below, keyed on `ENVIRONMENT_NAME`, which `values.yaml` renders from
 *     `global.environment`. This catches the flag being set in the wrong values file: a `demo` or `prod`
 *     deploy that somehow carried `PERSONA_SWITCHER_ENABLED=true` still gets no switcher.
 *
 * **`config/default.json` leaves `environmentName` empty, and that is the allowlist's half of failing
 * closed.** It used to default to `development` — itself a permitted environment — so any deploy path that
 * did not render `ENVIRONMENT_NAME` (a Flux `HelmRelease`, a hand-rolled ConfigMap, a `--set` that dropped
 * the key) reduced two independent conditions to one. An unset variable now matches nothing here, so the
 * two environments that legitimately have no chart behind them say which they are: `dev:app` exports
 * `ENVIRONMENT_NAME=development` and `vitest.config.ts` sets `test`.
 *
 * **This is an allowlist, and it must not become a negation.**
 * `libs/deed-poll/src/auth/plain-http.ts` is the standing rule for this class of gate and gives the full
 * argument: `!== "production"` lets a relaxation through in `aat`, in preview, in any environment added
 * later, and under an unset variable — silently, because nothing fails. Naming the permitted environments
 * makes adding one a deliberate edit. **Do not "correct" this to `!== "production"`.**
 *
 * "test" is here because `vitest.config.ts` sets `ENVIRONMENT_NAME=test` — but note that the flag is still
 * off by default there, so a test that wants the switcher has to ask for it.
 */
import { DEEDPOLL_ADMIN, DEEDPOLL_CASEWORKER, DEEDPOLL_JUDICIAL } from "@hmcts/deed-poll";
import config from "config";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { type Persona, personaState, switcherUnavailableReason } from "./persona-users.js";
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
 * `fixtureUsername` is the local account `scripts/seed-idam-users.mjs` creates, and it is only the identity in
 * the environments `SEEDED_PERSONA_ENVIRONMENTS` names. AAT cannot use fixed accounts at all — its test users
 * are swept after about three hours — so there the same three personas are **created on demand** from
 * `roleNames`; `./persona-users.ts` owns that half. What stays either way is the shape: three named personas,
 * each with one identity behind it.
 *
 * **`roleNames` is what a persona *is*, and the roles are imported rather than spelled out.** A copy of one of
 * these strings has already drifted once in this repo (`scripts/seed-idam-users.mjs` granted the pre-rename
 * `deedpoll-admin` after `roles.ts` moved on), and it fails closed: the persona resolves to no roles, so it
 * presents as a permissions bug rather than a typo. Ordinary caseworkers now receive their own product role
 * so CCD can grant document READ access without granting the system account's write permissions.
 */
export const PERSONAS: readonly Persona[] = [
  { id: "caseworker", name: "Caseworker", fixtureUsername: "caseworker@example.com", roleNames: [DEEDPOLL_CASEWORKER] },
  { id: "admin", name: "Caseworker with admin", fixtureUsername: "admin@example.com", roleNames: [DEEDPOLL_ADMIN] },
  { id: "judge", name: "Judge", fixtureUsername: "judge@example.com", roleNames: [DEEDPOLL_JUDICIAL] }
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
  current: "current",
  /**
   * The short state on the item itself, with the reason on its own line below it.
   *
   * Two parts because a reason is a sentence naming another team's repository: inline it would push the strip
   * to three lines and bury which persona it was about. The word is in the item so the state is not carried by
   * the absence of a button alone.
   */
  unavailable: "unavailable"
};

export function personaSwitcherEnabled(): boolean {
  // Strictly `true`, not truthy: `custom-environment-variables.json` declares `__format: "json"` so that
  // `PERSONA_SWITCHER_ENABLED=true` arrives as a boolean. Without that, config hands back the *string*
  // `"false"`, which is truthy — a value meaning "off" that reads as "on" is how this ends up enabled in
  // production.
  return config.get<boolean>("personaSwitcher.enabled") === true && PERSONA_SWITCHER_ENVIRONMENTS.has(config.get<string>("environmentName"));
}

/**
 * The persona a form body named, or `undefined`.
 *
 * **This is where "never mint a token for a user it was not explicitly configured to offer" is enforced.**
 * The id is `unknown` because that is what a request body is, and the only thing done with it is a lookup in
 * `PERSONAS`: there is no path from a request to an identity this file does not name, and an id that matches
 * nothing gets no persona rather than a guess. The caller answers 404 to that, so the route discloses nothing
 * about which ids exist either.
 *
 * Nothing about the *credentials* is decided here — `./persona-users.ts` resolves those, because which account
 * a persona is depends on the environment and, in AAT, on a user this process creates. What matters for the
 * security posture is that the set of personas it can be asked about is this constant and no request can widen
 * it.
 */
export function personaFor(id: unknown): Persona | undefined {
  return PERSONAS.find((candidate) => candidate.id === id);
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
 *
 * Exported for one caller and one reason: `src/pages/switch-persona.ts` renders its refusal *after* an attempt
 * that may have recorded a new refusal, and the locals were built before the router ran. See the call site.
 */
export function personaSwitcherView(req: Request): PersonaSwitcherView | undefined {
  if (!personaSwitcherEnabled() || !sessionUser(req)) return undefined;

  // One refusal and not three. When no persona at all can be obtained here — the client is registered for
  // neither grant type — every persona carries the same sentence, so the strip states it once and offers no
  // buttons. `personas` is empty rather than a list of three identical refusals: the tester needs the fact,
  // not it repeated against each name.
  const notice = switcherUnavailableReason();
  if (notice) return { ...COPY, action: PERSONA_SWITCH_PATH, notice, personas: [] };

  // `sessionSubject` is the IDAM subject the session was established for, and `personaState` knows which user
  // each persona is *here* — the fixture locally, the account this pod created in AAT. Matching marks the
  // current persona; **failing to match marks none**, which is the right answer both for a real user who
  // signed in through IDAM normally and for an AAT persona nobody has switched to yet. The switcher is usable
  // either way — nothing here decides what may be switched to.
  const subject = sessionSubject(req)?.toLowerCase();

  return {
    ...COPY,
    action: PERSONA_SWITCH_PATH,
    personas: PERSONAS.map((persona) => {
      const { username, isAvailable, unavailableReason } = personaState(persona);

      return {
        id: persona.id,
        name: persona.name,
        isCurrent: subject !== undefined && subject === username?.toLowerCase(),
        isAvailable,
        reason: unavailableReason
      };
    })
  };
}

interface PersonaSwitcherView {
  tag: string;
  label: string;
  switchTo: string;
  current: string;
  unavailable: string;
  action: string;
  /** Present only when no persona can be switched to at all, in which case `personas` is empty. */
  notice?: string;
  personas: { id: string; name: string; isCurrent: boolean; isAvailable: boolean; reason?: string }[];
}
