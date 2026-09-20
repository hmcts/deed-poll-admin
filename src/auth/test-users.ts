/**
 * Programmatic test user creation via idam-testing-support-api.
 *
 * Used in non-production environments to create IDAM test users on demand. Users are automatically
 * cleaned up after a period (3 hours in AAT, per the IDAM testing support docs).
 *
 * **Authentication**: Uses client credentials (the service's client ID and secret), not a user token.
 * See `client-credentials.ts`.
 *
 * **Not for production**. The testing-support-api is only available in lower environments (AAT, demo,
 * perftest). Production users are onboarded through ref-data or other mechanisms.
 */
import { getClientCredentialsToken } from "./client-credentials.js";
import type { IdamConfig } from "./idam.js";

/**
 * How long any one testing-support request waits, matching `DEFAULT_TIMEOUT_MS` in the api client.
 *
 * Bounded for the reason every api call is (`.claude/rules` and `libs/deed-poll-api-client/src/api/client.ts`):
 * `fetch` has no timeout of its own, so a host that accepts a connection and never answers — a hung pod, a
 * dropped conntrack entry — leaves the request pending for as long as the socket lives. The caller here is
 * `POST /switch-persona`, so that is a tester's browser waiting indefinitely on a page that would otherwise
 * have said what went wrong and offered a retry, and one held request per attempt while they reload.
 *
 * The abort surfaces as a `TimeoutError`, which `persona-users.ts` reports as a transient failure and
 * deliberately does not record against the persona: a slow environment must not disable one until the pod
 * cycles.
 */
const TESTING_SUPPORT_TIMEOUT_MS = 10_000;

/**
 * A refusal from `idam-testing-support-api`, carrying the status and body rather than only a sentence.
 *
 * The message keeps the same shape it always had, so it still reads on its own. The two fields are there
 * because the persona switcher has to tell one refusal from another: a 400 naming the persona's role means
 * that role does not exist in this environment, which is a permanent state to report and disable the persona
 * for, while a 500 is worth trying again. Classifying by matching the formatted message would have coupled
 * that decision to this string.
 */
export class TestUserError extends Error {
  status: number;
  body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "TestUserError";
    this.status = status;
    this.body = body;
  }
}

export interface TestUser {
  id?: string;
  email: string;
  forename: string;
  surname: string;
  roleNames: string[];
}

export interface CreateTestUserRequest {
  password: string;
  user: TestUser;
}

/**
 * The base URL of idam-testing-support-api per environment.
 *
 * AAT: `https://idam-testing-support-api.aat.platform.hmcts.net`
 * Demo: `https://idam-testing-support-api.demo.platform.hmcts.net`
 * Perftest: `https://idam-testing-support-api.perftest.platform.hmcts.net`
 *
 * Derived from the IDAM issuer URL by convention, but could be configured separately if needed.
 */
function testingSupportApiUrl(issuerUrl: string): string {
  // issuerUrl is https://hmcts-access.{env}.platform.hmcts.net
  // testing-support-api is https://idam-testing-support-api.{env}.platform.hmcts.net
  const url = new URL(issuerUrl);
  const env = url.hostname.split(".")[1]; // Extract 'aat' from 'hmcts-access.aat.platform.hmcts.net'
  return `https://idam-testing-support-api.${env}.platform.hmcts.net`;
}

/**
 * Create an IDAM test user.
 *
 * The user is created with their password already set (skipping the normal email activation flow) and
 * is automatically cleaned up after 3 hours in AAT. The bearer token is obtained using client
 * credentials — it represents the service, not a user.
 *
 * Returns the created user's ID. Throws if the user already exists (409 CONFLICT) or if required
 * values are missing/invalid (400 BAD REQUEST).
 *
 * **Scope**: Requires `profile` and `roles` scopes on the client credentials token. The
 * testing-support-api does not require `openid`.
 */
export async function createTestUser(config: IdamConfig, request: CreateTestUserRequest): Promise<string> {
  // Obtain a service token to authenticate with testing-support-api
  const { accessToken } = await getClientCredentialsToken(config, "profile roles");

  const apiUrl = testingSupportApiUrl(config.issuerUrl);
  const response = await fetch(`${apiUrl}/test/idam/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(TESTING_SUPPORT_TIMEOUT_MS)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new TestUserError(`Failed to create test user: ${response.status} ${response.statusText} - ${text}`, response.status, text);
  }

  const created = (await response.json()) as TestUser;
  if (!created.id) {
    throw new Error("Test user created but no ID returned");
  }

  return created.id;
}

/**
 * Get a test user by ID.
 *
 * Useful for verifying a user exists or checking their current state. Returns undefined if the user
 * does not exist (404).
 */
export async function getTestUser(config: IdamConfig, userId: string): Promise<TestUser | undefined> {
  const { accessToken } = await getClientCredentialsToken(config, "profile roles");

  const apiUrl = testingSupportApiUrl(config.issuerUrl);
  const response = await fetch(`${apiUrl}/test/idam/users/${userId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    signal: AbortSignal.timeout(TESTING_SUPPORT_TIMEOUT_MS)
  });

  if (response.status === 404) {
    return undefined;
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to get test user: ${response.status} ${response.statusText} - ${text}`);
  }

  return (await response.json()) as TestUser;
}

/**
 * Delete a test user.
 *
 * Note that deletion is queued and may not be instantaneous. If you need to recreate a user with the
 * same email immediately, the create may fail with 409 CONFLICT until the deletion completes.
 */
export async function deleteTestUser(config: IdamConfig, userId: string): Promise<void> {
  const { accessToken } = await getClientCredentialsToken(config, "profile roles");

  const apiUrl = testingSupportApiUrl(config.issuerUrl);
  const response = await fetch(`${apiUrl}/test/idam/users/${userId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    signal: AbortSignal.timeout(TESTING_SUPPORT_TIMEOUT_MS)
  });

  if (!response.ok && response.status !== 404) {
    const text = await response.text();
    throw new Error(`Failed to delete test user: ${response.status} ${response.statusText} - ${text}`);
  }
}
