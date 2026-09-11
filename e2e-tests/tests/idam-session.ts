/**
 * Signing the browser in, for the journeys that need a caseworker.
 *
 * `requireAuth` is mounted globally in the app, so an anonymous GET of any deed-poll page is
 * redirected to `/login`. The journeys therefore need a real session, and they get one the way a
 * caseworker does: through `hmcts/rse-idam-simulator`, the local IDAM that `docker compose` starts.
 *
 * **Nothing here fabricates a session cookie or short-circuits the flow.** A test-only bypass would
 * be the very thing Phase 5 deleted from the application, and it would let the login flow break
 * without any test noticing — which is exactly what happened to the hand-written stub these tests
 * would otherwise have inherited.
 *
 * Two one-off prerequisites, both from the repo root:
 *
 *     yarn idam:build      # builds rse-idam-simulator:local, which docker-compose.yml expects
 *     yarn idam:users      # creates the accounts below; /o/authorize 401s for an unknown user
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";

/**
 * Exported because it is also the audit author a write is attributed to under the mock, which stamps the
 * token's `sub` — see `auditName` in `libs/deed-poll-api-client/src/mock/server.ts`.
 */
export const ADMIN_EMAIL = "admin@example.com";

/**
 * The other fixture `yarn idam:users` seeds, holding **no roles at all** — which is what makes it a
 * caseworker rather than an administrator: `currentUser` derives `isAdmin` from
 * `roles.includes(DEEDPOLL_ADMIN)`, so an account with none is the negative case.
 */
export const CASEWORKER_EMAIL = "caseworker@example.com";

/** Whatever `scripts/seed-idam-users.mjs` set. The simulator does not check it — see below. */
const PASSWORD = "Pa55word11";

/**
 * Where the signed-in session is parked between the setup project and the journeys.
 *
 * Absolute, derived from this file rather than left relative: a relative `storageState` resolves
 * against the working directory, which differs between `yarn test:e2e` at the repo root and
 * `playwright test` inside this workspace.
 *
 * **The file holds a live session cookie, so it is a credential** — `.auth/` is gitignored.
 *
 * **One cookie means one server-side session, shared by every test that restores this state.** That is
 * safe for a journey that only reads the signed-in user, which is all the deed-poll pages do. A journey
 * that stores anything in the session must not run in parallel with another that does, or it will
 * overwrite the other's data — the template's onboarding journey did exactly that, and had to be
 * sequential within its own file. That spec is gone, but the rule it earned is not: it applies to the
 * next journey that writes to the session, and `deed-polls.spec.ts` follows it for `?lng=cy`.
 *
 * **Prefer that to signing in per test.** Five concurrent logins were once enough to exhaust the shared
 * pg pool and hang the OIDC callback for 30 seconds — loose end 16 in PROGRESS.md. That pool went with
 * the data access layer, so the failure mode has too; what remains is the plainer argument that a login
 * is a full OIDC round trip and there is no reason to pay for it per test.
 */
export const ADMIN_STORAGE_STATE = path.join(path.dirname(fileURLToPath(import.meta.url)), "../.auth/admin.json");

/**
 * The same, for the roleless fixture. A second file rather than a second sign-in per test, for the
 * reasons above — and a *separate* file because the two sessions must not be the same one: restoring the
 * admin cookie would make the caseworker assertions pass or fail for the wrong reason.
 */
export const CASEWORKER_STORAGE_STATE = path.join(path.dirname(fileURLToPath(import.meta.url)), "../.auth/caseworker.json");

/**
 * True when the suite is pointed at a deployed environment instead of the local stack.
 *
 * The same variable `playwright.config.ts` reads to decide whether to start a `webServer`, and the one
 * `sectionDeployToAKS` sets before it runs `yarn test:smoke` — so the smoke spec is the only thing here
 * that is meant to run with it set. Against a deployed environment the issuer is real CFT IDAM rather
 * than the simulator, and there is no registered client or test account to sign in with yet. See
 * `.business_context/IDAM_REGISTRATION_REQUEST.md`.
 */
export const RUNS_AGAINST_DEPLOYED_STACK = Boolean(process.env.TEST_URL);

export const DEPLOYED_STACK_SKIP_REASON =
  "Needs a signed-in caseworker. Against a deployed environment that means real CFT IDAM, which has no registered client or test account for this service yet — see .business_context/IDAM_REGISTRATION_REQUEST.md. Runs against the local stack, where docker compose provides rse-idam-simulator.";

/** Sign in as the caseworker holding the privileged role, through the whole authorization-code flow. */
export async function signInAsAdmin(page: Page): Promise<void> {
  await signIn(page, ADMIN_EMAIL);
}

/**
 * The same, as the account holding no roles — which is how a role rule in the UI gets its negative case
 * in a browser rather than only in a unit test.
 */
export async function signInAsCaseworker(page: Page): Promise<void> {
  await signIn(page, CASEWORKER_EMAIL);
}

/**
 * `/login` builds the authorization URL and redirects to the simulator, which — given no
 * `login_hint` — redirects again to its own login form. Submitting that comes back to
 * `/oauth2/callback` with a code, which the app exchanges before landing on `/deed-polls`
 * (`safeReturnTo`'s default).
 *
 * One flow for both fixtures, because the account is the only thing that differs: the simulator asks for
 * a username on the same form either way, and it is the roles behind that username — not anything here —
 * that decide what the app then shows.
 */
async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/login");

  // The simulator's own form, so its markup is not ours to fix: its `<label>Username :</label>` has
  // no `for`, which is why this reaches for the id rather than `getByLabel`. Do not "correct" it to a
  // role- or label-based locator — there is nothing for one to bind to.
  await page.locator("#username").fill(email);
  // Sent for the sake of driving the real form. The simulator's `postLogin` takes the password and
  // never reads it, so this proves nothing about credentials — see the note on what local runs cannot
  // verify in .business_context/PROGRESS.md.
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Landing here means the code exchange, the ID-token signature check against the simulator's JWKS,
  // the `state` check and the `/o/userinfo` call all succeeded. A failure renders 403 instead.
  //
  // A longer timeout than the 5s default, deliberately. This is a cross-origin round trip — callback,
  // token exchange, JWKS fetch, userinfo — against a JVM that several workers hit at once, and it does
  // exceed 5s under load. The flake it caused looked like a broken login rather than a slow one.
  await expect(page).toHaveURL("/deed-polls", { timeout: 30_000 });
}
