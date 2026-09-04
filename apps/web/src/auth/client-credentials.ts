/**
 * Service-to-service authentication using the client_credentials grant.
 *
 * Used for authenticating with IDAM APIs where no user is involved — specifically
 * `idam-testing-support-api` for programmatic test user creation. The access token this returns
 * authenticates the **service** itself, not a user.
 *
 * **Separate from the user authorization flow.** `idam.ts` handles `authorization_code` for browser
 * sign-in; this handles `client_credentials` for service calls.
 */
import * as client from "openid-client";
import { expiresAtFrom, type IdamConfig, idamConfiguration } from "./idam.js";

export interface ClientCredentialsToken {
  accessToken: string;
  expiresAt: number;
}

/**
 * Obtain an access token using client credentials.
 *
 * Returns a token representing the service itself, not any user. The token is valid for the requested
 * scopes (typically `profile roles` for test user creation). Tokens are short-lived (usually 1 hour);
 * the caller should cache and reuse until expiry rather than requesting per call.
 *
 * **Scope should be minimal.** For test user creation via `idam-testing-support-api`, only `profile`
 * and `roles` are needed. Do not request `openid` (that's for user authentication) or broader scopes
 * unless specifically required.
 */
export async function getClientCredentialsToken(config: IdamConfig, scope: string): Promise<ClientCredentialsToken> {
  const configuration = await idamConfiguration(config);

  // The second argument is the token-request parameters, not a bare scope string — passing the scope
  // on its own sends no `scope` parameter at all, and the token comes back with whatever the client's
  // default scope is rather than the one asked for.
  const tokens = await client.clientCredentialsGrant(configuration, { scope });

  return {
    accessToken: tokens.access_token,
    expiresAt: expiresAtFrom(tokens)
  };
}
