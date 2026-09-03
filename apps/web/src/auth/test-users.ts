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
    body: JSON.stringify(request)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to create test user: ${response.status} ${response.statusText} - ${text}`);
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
    }
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
    }
  });

  if (!response.ok && response.status !== 404) {
    const text = await response.text();
    throw new Error(`Failed to delete test user: ${response.status} ${response.statusText} - ${text}`);
  }
}
