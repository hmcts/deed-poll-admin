/**
 * Who the personas are in *this* environment, and why one of them may not be available here.
 *
 * `./persona-switcher.ts` decides whether the control is offered at all and what the strip looks like; this
 * file answers the question that has a different answer in AAT than it does locally — **which IDAM user a
 * persona is**, and what to say when there cannot be one. See `docs/plans/completed/dev-persona-switcher.md`, task 5.
 *
 * **Two ways a persona resolves, and the split is an allowlist for the same reason the gate is.**
 * `SEEDED_PERSONA_ENVIRONMENTS` names the environments whose persona users are the fixtures
 * `scripts/seed-idam-users.mjs` creates. Everywhere else the user is **created on demand** through
 * `idam-testing-support-api`, because AAT cannot have fixed persona accounts at all: its test users are
 * deleted after about three hours, so an account named in a values file would work until the first cleanup
 * and then look exactly like a broken switcher. Naming the seeded environments rather than testing for
 * "not local" keeps a new environment a deliberate edit — the argument `libs/deed-poll/src/auth/plain-http.ts`
 * makes at length.
 *
 * **The three-hour cleanup is handled by retrying once, not by a timer.** A created user that has been swept
 * makes IDAM answer `invalid_grant`, which is indistinguishable from "never existed" — so the one honest
 * response is to forget it, create another and try again. A TTL here would have to guess IDAM's, and guessing
 * short throws away working users while guessing long reproduces the bug.
 *
 * **What it refuses, it refuses out loud.** Three things can make a persona impossible in AAT, and none of
 * them is the tester's fault or fixable by trying harder:
 *
 *   - the client is not registered for `password`, so no token can be obtained for anybody;
 *   - the client is not registered for `client_credentials`, so no test user can be created;
 *   - the persona's role does not exist in the environment yet (`caseworker-deedpoll-judicial` is in this
 *     state until `hmcts/idam-access-config#995` merges).
 *
 * **Both grant types are missing as at 2026-09-19**, read from the clone rather than assumed:
 * `platops/idam-access-config/apps/deed-poll/base/services.yaml` registers `authorization_code` and
 * `refresh_token` and nothing else. The plan's follow-up PR therefore needs **two** grant types added, not
 * the one it names — `client_credentials` is what `createTestUser` authenticates with, so without it the AAT
 * path cannot even get as far as being refused a user token.
 *
 * Each of those is recorded when it happens and reported thereafter, so the strip disables the persona with
 * the reason on it rather than offering a button that fails at IDAM. A failure that *might* be transient —
 * IDAM unreachable, testing-support 500 — is reported for the attempt that hit it and deliberately **not**
 * recorded: retrying is reasonable, and a blip that disabled a persona for the pod's lifetime would be a
 * worse lie than the 500 page this replaces.
 *
 * **It reads no real user's credentials, and in AAT it holds no configured password either.** A created
 * user's password is generated here, used once and never written down; only the seeded fixtures use the
 * configured one, which is `scripts/seed-idam-users.mjs`'s own. So the AAT half adds no secret to manage and
 * there is nothing in a values file to leak.
 */
import { randomBytes } from "node:crypto";
import type { Role } from "@hmcts/deed-poll";
import config from "config";
import * as client from "openid-client";
import { describeIdamError, type IdamConfig, type LoginResult } from "./idam.js";
import { passwordGrantLogin } from "./password-grant.js";
import { createTestUser, TestUserError } from "./test-users.js";

/**
 * The environments whose personas are the local fixtures, and the only ones that do not create users.
 *
 * `test` is here because `vitest.config.ts` sets `ENVIRONMENT_NAME=test` — and a unit test must never be one
 * network hiccup away from posting to a testing-support API. An environment that names itself neither way,
 * which is what an unset variable now produces, takes the create-on-demand path and is refused by the
 * switcher's allowlist before it can.
 *
 * **Do not convert this to a test for "aat or preview".** The deciding question is whether
 * `yarn idam:users` has seeded this IDAM, and only these two environments are ones where it can have.
 */
export const SEEDED_PERSONA_ENVIRONMENTS = new Set(["development", "test"]);

/**
 * What a refusal says. English, and in one place for the same reason `COPY` is in `./persona-switcher.ts`:
 * a development tool's text does not belong in `src/locales`, which is what the Welsh translation request is
 * built from.
 *
 * Each names the repository or command that fixes it, because the audience is whoever is trying to test the
 * service and the alternative is a tester reporting "the judge button does nothing".
 */
const REASONS = {
  passwordGrantUnregistered:
    "IDAM will not issue a token from a username and password for this client here, so no persona can be switched to. This is a registration change in hmcts/idam-access-config, not a fault in this service: `password` must be added to the client's grant types in the aat overlay, restating `authorization_code` and `refresh_token` alongside it.",
  clientCredentialsUnregistered:
    "IDAM will not issue this client a service token here, so no persona's test user can be created. `client_credentials` must be added to the client's grant types in hmcts/idam-access-config, alongside `password`.",
  roleMissing: (role: string) =>
    `The ${role} role does not exist in this environment, so this persona's test user cannot be created. It has to be published by hmcts/idam-access-config first.`,
  createFailed: (detail: string) => `This persona's IDAM test user could not be created (${detail}). Nothing is wrong with your session — try again.`,
  fixtureMissing: (username: string) =>
    `IDAM has no ${username}. Locally that means \`yarn idam:users\` has not been run against the simulator this app is pointed at.`,
  tokenFailed: (detail: string) => `IDAM refused to issue a token for this persona (${detail}). Nothing is wrong with your session — try again.`
};

/**
 * The identity each persona resolved to, and the refusals worth remembering, for the process's lifetime.
 *
 * Module state, like `idam.ts`'s cached discovery and for the same reason: creating a user is a network call
 * with a side effect, so doing it once per switch would leave a trail of accounts behind a tester who moved
 * between personas. Nothing here is persisted — a pod restart forgets both maps, which is also how a
 * persona that has *become* possible (`#995` merging, a registration landing) comes back: at the next deploy
 * or pod cycle, not never.
 *
 * In AAT with more than one replica each pod resolves its own users. The only visible effect is cosmetic —
 * the strip marks no persona as current until this pod has performed a switch — and the alternative, a
 * shared record, would be persona state in Redis for a development tool.
 */
const resolved = new Map<string, PersonaCredentials>();
const refusals = new Map<string, string>();
let switcherRefusal: string | undefined;

/**
 * The creation a switch is already waiting on, per persona — what makes "create it once" hold when two
 * switches arrive together.
 *
 * `resolved` alone cannot: creating a user is `await`ed, so two first switches to the same persona both read
 * an empty map, both create an account, and the second `resolved.set` wins. Neither tester is broken — each
 * holds a real token for a real user with the persona's roles — but the pod has minted an account it will
 * never use again, and the strip then marks the persona current for one of them and not the other, which
 * reads as the switch not having worked. That is exactly what the cache above exists to prevent, and
 * concurrency is the case it did not cover.
 *
 * A promise rather than a lock, because there is nothing to serialise: the second caller wants the first
 * call's answer, not a turn of its own. Removed when it settles, so a failure is retried rather than
 * remembered — the classification in `createPersonaUser` decides what is permanent, and this must not become
 * a second, accidental record of it.
 */
const inFlight = new Map<string, Promise<CredentialsResult>>();

/**
 * Obtain a real IDAM login for a persona, creating its user first where that is how this environment works.
 *
 * Never throws: every failure is a `reason` the caller renders, because the whole point of task 5 is that an
 * unavailable persona says why rather than reaching the 500 page. The caller decides nothing about which
 * failures are permanent — that is recorded here, where the classification is.
 */
export async function loginAsPersona(idam: IdamConfig, persona: Persona): Promise<PersonaLogin> {
  const recorded = personaState(persona).unavailableReason;
  if (recorded) return { ok: false, reason: recorded };

  const credentials = await resolveCredentials(idam, persona);
  if (!credentials.ok) return credentials;

  return tokenFor(idam, persona, credentials.credentials, true);
}

/**
 * What the strip needs to know about a persona: who it is here, and whether it can be had at all.
 *
 * Deliberately **synchronous and network-free**. It is read on every page render through
 * `personaSwitcherLocals`, so resolving a persona here would put a user creation in the path of a case list.
 * Before the first switch on this pod an AAT persona therefore has no known username, which is correct
 * rather than missing: the tester signed in as themselves and is none of the personas.
 *
 * Carries the username and never the password — the generated one exists only inside this module.
 */
export function personaState(persona: Persona): PersonaState {
  const reason = switcherRefusal ?? refusals.get(persona.id);

  return {
    username: resolved.get(persona.id)?.username ?? (seededEnvironment() ? persona.fixtureUsername : undefined),
    isAvailable: reason === undefined,
    unavailableReason: reason
  };
}

/**
 * The reason no persona at all can be switched to here, or `undefined`.
 *
 * A registration that covers neither grant type refuses every persona identically, so the strip states it
 * once instead of repeating it against three names.
 */
export function switcherUnavailableReason(): string | undefined {
  return switcherRefusal;
}

/**
 * Forget every resolved user and recorded refusal.
 *
 * For tests, and exported for the same reason `resetIdamDiscovery` is: the state is a process-lifetime cache,
 * so without this one test's recorded refusal is the next one's starting condition. Not called by the app.
 */
export function resetPersonaUsers(): void {
  resolved.clear();
  refusals.clear();
  inFlight.clear();
  switcherRefusal = undefined;
}

/**
 * The password grant, plus the one retry the three-hour cleanup needs.
 *
 * The retry is only for a *created* user: locally an `invalid_grant` means the fixture is not there, and
 * creating one against the simulator is not this app's job — `yarn idam:users` is.
 */
async function tokenFor(idam: IdamConfig, persona: Persona, credentials: PersonaCredentials, mayRetry: boolean): Promise<PersonaLogin> {
  try {
    return { ok: true, login: await passwordGrantLogin(idam, credentials.username, credentials.password) };
  } catch (error) {
    if (unregisteredGrant(error)) return { ok: false, reason: record(REASONS.passwordGrantUnregistered) };

    if (unknownUser(error)) {
      if (seededEnvironment()) return { ok: false, reason: REASONS.fixtureMissing(credentials.username) };
      // The user this pod created has been swept. Nothing distinguishes that from a password IDAM never
      // knew, so the response to both is to stop believing in the account and make another.
      if (mayRetry) return retryWithNewUser(idam, persona);
    }

    console.error(`Persona switch to ${persona.id} failed at the token request`, describeIdamError(error));
    return { ok: false, reason: REASONS.tokenFailed(detailOf(error)) };
  }
}

async function retryWithNewUser(idam: IdamConfig, persona: Persona): Promise<PersonaLogin> {
  resolved.delete(persona.id);

  const replacement = await resolveCredentials(idam, persona);
  if (!replacement.ok) return replacement;

  return tokenFor(idam, persona, replacement.credentials, false);
}

/**
 * The persona's username and password in this environment — the fixture's, or a user created for it.
 *
 * **This is where "never mint a token for a user it was not explicitly configured to offer" holds in AAT.**
 * The email is built from the persona's own id and nothing that arrived in a request, and the roles are the
 * persona's own, so a created account can hold nothing the configured persona does not.
 */
function resolveCredentials(idam: IdamConfig, persona: Persona): Promise<CredentialsResult> {
  const remembered = resolved.get(persona.id);
  if (remembered) return Promise.resolve({ ok: true, credentials: remembered });

  if (seededEnvironment()) {
    const fixture = { username: persona.fixtureUsername, password: config.get<string>("personaSwitcher.password") };
    resolved.set(persona.id, fixture);
    return Promise.resolve({ ok: true, credentials: fixture });
  }

  // Two switches to the same persona at once share one creation — see `inFlight`. Nothing to join in the
  // seeded case above: it settles without awaiting anything, so no second caller can observe it half-done.
  const existing = inFlight.get(persona.id);
  if (existing) return existing;

  const creation = createCredentials(idam, persona).finally(() => inFlight.delete(persona.id));
  inFlight.set(persona.id, creation);

  return creation;
}

async function createCredentials(idam: IdamConfig, persona: Persona): Promise<CredentialsResult> {
  const credentials = { username: personaEmail(persona), password: generatedPassword() };
  const created = await createPersonaUser(idam, persona, credentials);
  if (!created.ok) return created;

  resolved.set(persona.id, credentials);
  return { ok: true, credentials };
}

/**
 * Create the persona's IDAM test user, or say why it could not be.
 *
 * The name is what api stamps on anything this persona does — it derives the audit author from the token —
 * so it has to read as a test persona rather than as a person. "Persona Judge" in a timeline is a fact about
 * the environment; a plausible human name there would be a lie in the audit trail.
 */
async function createPersonaUser(idam: IdamConfig, persona: Persona, credentials: PersonaCredentials): Promise<CreateResult> {
  try {
    await createTestUser(idam, {
      password: credentials.password,
      user: { email: credentials.username, forename: "Persona", surname: persona.name, roleNames: [...persona.roleNames] }
    });
    return { ok: true };
  } catch (error) {
    // `createTestUser` authenticates with the client-credentials grant, so a client registered for neither
    // grant fails *here* rather than at the token request — and the fix names a different grant type.
    if (unregisteredGrant(error)) return { ok: false, reason: record(REASONS.clientCredentialsUnregistered) };

    const missing = missingRole(error, persona);
    if (missing) return { ok: false, reason: record(REASONS.roleMissing(missing), persona) };

    console.error(`Persona switch to ${persona.id} failed while creating its IDAM test user`, describeIdamError(error));
    return { ok: false, reason: REASONS.createFailed(detailOf(error)) };
  }
}

/**
 * Remember a refusal that cannot change without somebody else's merge or a redeploy.
 *
 * Only these are recorded. A transient failure is reported to whoever hit it and then forgotten, so the
 * persona is offered again — "IDAM was briefly down" must not read as "this persona does not exist here".
 */
function record(reason: string, persona?: Persona): string {
  if (persona) refusals.set(persona.id, reason);
  else switcherRefusal = reason;

  return reason;
}

/**
 * RFC 6749's two answers for "this client may not use that grant", which is exactly the AAT case: the client
 * is registered for `authorization_code` and `refresh_token` only. Both readings appear in the wild —
 * `unsupported_grant_type` when the server rejects the grant outright, `unauthorized_client` when it rejects
 * this client's use of it — so neither is worth guessing between.
 */
function unregisteredGrant(error: unknown): boolean {
  return error instanceof client.ResponseBodyError && (error.error === "unsupported_grant_type" || error.error === "unauthorized_client");
}

/** IDAM's answer for credentials it will not honour: the user is gone, or was never there. */
function unknownUser(error: unknown): boolean {
  return error instanceof client.ResponseBodyError && error.error === "invalid_grant";
}

/**
 * The persona's role, when that is what the create was refused for.
 *
 * Matched against the persona's own role names rather than parsed out of IDAM's message, so a body that
 * happens to mention something else is not read as a missing role. A refusal that does not name one of them
 * falls through to the generic reason, which says "try again" rather than asserting a cause.
 */
function missingRole(error: unknown, persona: Persona): string | undefined {
  if (!(error instanceof TestUserError) || error.status >= 500) return undefined;

  return persona.roleNames.find((role) => error.body.includes(role));
}

/** What a reason may quote: IDAM's own error text, or nothing at all. Never a token and never a password. */
function detailOf(error: unknown): string {
  if (error instanceof client.ResponseBodyError) {
    return error.error_description ? `${error.error}: ${error.error_description}` : error.error;
  }
  if (error instanceof TestUserError) return `${error.status} from idam-testing-support-api`;
  // `createTestUser`'s `AbortSignal.timeout` — a host that accepted the connection and did not answer, which
  // is a different thing to say than "could not be reached" and points at a slow environment rather than a
  // missing one. Transient either way: neither is recorded, so the persona is still offered.
  if (error instanceof DOMException && error.name === "TimeoutError") return "idam-testing-support-api did not respond in time";

  return "IDAM could not be reached";
}

function seededEnvironment(): boolean {
  return SEEDED_PERSONA_ENVIRONMENTS.has(config.get<string>("environmentName"));
}

/**
 * The email a created persona user gets: identifiable as this service's, and unique per creation.
 *
 * Unique because a deletion in IDAM is queued rather than immediate, so reusing an address 409s for as long
 * as the previous sweep takes — and the sweep is precisely what put us here. The domain is configurable
 * because **no request from this devcontainer reaches AAT's IDAM**, so which domains its testing-support API
 * accepts is unverified; if `example.com` is refused, `PERSONA_SWITCHER_EMAIL_DOMAIN` is a values-file edit
 * rather than a release.
 */
function personaEmail(persona: Persona): string {
  return `deed-poll-admin-persona-${persona.id}-${randomBytes(4).toString("hex")}@${config.get<string>("personaSwitcher.emailDomain")}`;
}

/**
 * A password for a created user, generated and never recorded anywhere.
 *
 * So the AAT half adds no secret to a key vault or a values file: this value exists in this process for as
 * long as the user does, and the account it belongs to is swept within three hours. The suffix is there
 * because IDAM enforces a character-class policy that random base64 does not reliably satisfy.
 */
function generatedPassword(): string {
  return `${randomBytes(18).toString("base64url")}Aa1!`;
}

/**
 * One of the personas the switcher offers — the list is `PERSONAS` in `./persona-switcher.ts`.
 *
 * `fixtureUsername` is only the account in a seeded environment; `roleNames` is what the persona *is*, and
 * is what a created user is given. The two are separate fields because the seeded fixtures already hold
 * their roles and a created user has to be told.
 */
export interface Persona {
  id: string;
  name: string;
  fixtureUsername: string;
  roleNames: readonly Role[];
}

export interface PersonaState {
  /** The persona's IDAM user here, when one is known. Absent in AAT until this pod has resolved it. */
  username?: string;
  isAvailable: boolean;
  unavailableReason?: string;
}

type PersonaLogin = { ok: true; login: LoginResult } | { ok: false; reason: string };

type CredentialsResult = { ok: true; credentials: PersonaCredentials } | { ok: false; reason: string };

type CreateResult = { ok: true } | { ok: false; reason: string };

interface PersonaCredentials {
  username: string;
  password: string;
}
