/**
 * The AAT half: who a persona is when there are no fixed accounts, and what is said when it cannot be one.
 *
 * **Everything here is about a failure nobody can reproduce locally.** AAT IDAM is unreachable from the
 * devcontainer (probed 2026-09-19: 504 through the proxy), its test users are swept after about three hours,
 * and `platops/idam-access-config` registers this client for `authorization_code` and `refresh_token` only —
 * so the states this file pins are the ones a deploy will actually meet and a developer never will. The
 * classification is what task 5 is for: a refusal that names the role, the grant type or the command that
 * fixes it, rather than the 500 page task 3 deliberately left in place.
 *
 * `config` is mocked because the real package resolves the environment once when first loaded, so nothing in a
 * test can steer it — and which pair of resolved values means "seeded" is the thing worth pinning anyway.
 * `test-users.js` is mocked **partially**: `TestUserError` is what the classification does `instanceof` against,
 * so replacing the whole module would take the class with it and every refusal would fall through to the
 * generic one.
 */
import { currentUser, DEEDPOLL_JUDICIAL } from "@hmcts/deed-poll";
import * as client from "openid-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IdamConfig, LoginResult } from "./idam.js";
import { passwordGrantLogin } from "./password-grant.js";
import { PERSONAS } from "./persona-switcher.js";
import { loginAsPersona, personaState, resetPersonaUsers, SEEDED_PERSONA_ENVIRONMENTS, switcherUnavailableReason } from "./persona-users.js";
import { type CreateTestUserRequest, createTestUser, TestUserError } from "./test-users.js";

const settings = vi.hoisted(() => new Map<string, unknown>());

vi.mock("config", () => ({
  default: {
    get: (key: string) => {
      if (!settings.has(key)) throw new Error(`Configuration property "${key}" is not defined`);
      return settings.get(key);
    }
  }
}));

vi.mock("./password-grant.js", () => ({ passwordGrantLogin: vi.fn() }));

vi.mock("./test-users.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./test-users.js")>()),
  createTestUser: vi.fn()
}));

const IDAM: IdamConfig = {
  issuerUrl: "https://hmcts-access.aat.platform.hmcts.net",
  clientId: "deed-poll-admin",
  clientSecret: "a-secret",
  redirectUri: "https://deed-poll-admin-staging.aat.platform.hmcts.net/oauth2/callback",
  scope: "openid profile roles offline_access"
};

const CASEWORKER = personaById("caseworker");
const ADMIN = personaById("admin");
const JUDGE = personaById("judge");

describe("resolving a persona", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPersonaUsers();
    settings.clear();
    settings.set("personaSwitcher.password", "Pa55word11");
    settings.set("personaSwitcher.emailDomain", "example.com");
    // The reasons are reported on the page as well as logged, so the log lines are noise in a test run.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  // The split, and the allowlist that decides it. `test` is here because `vitest.config.ts` sets
  // `ENVIRONMENT_NAME=test`, so a unit test is never one mistake away from posting to a real
  // testing-support API.
  it("should take the seeded fixtures in development and test, and create users everywhere else", () => {
    expect([...SEEDED_PERSONA_ENVIRONMENTS].sort()).toEqual(["development", "test"]);
  });

  describe("in a seeded environment", () => {
    beforeEach(() => {
      settings.set("environmentName", "development");
    });

    it("should sign in as the fixture account with the seeder's own password, creating nothing", async () => {
      vi.mocked(passwordGrantLogin).mockResolvedValue(loginFor("judge@example.com"));

      const result = await loginAsPersona(IDAM, JUDGE);

      expect(result).toEqual({ ok: true, login: loginFor("judge@example.com") });
      // Creating a user against the simulator is `yarn idam:users`'s job, and the simulator has no
      // testing-support-api at the address `testingSupportApiUrl` would derive from a localhost issuer anyway.
      expect(createTestUser).not.toHaveBeenCalled();
      expect(passwordGrantLogin).toHaveBeenCalledWith(IDAM, "judge@example.com", "Pa55word11");
    });

    it("should say the fixture is missing when IDAM does not know it, and name the command that fixes it", async () => {
      // `yarn idam:users` not having been run is the local cause of an `invalid_grant`, and it was one of the
      // three causes task 3 could not tell apart on the 500 page.
      vi.mocked(passwordGrantLogin).mockRejectedValue(oauthError("invalid_grant"));

      const result = await loginAsPersona(IDAM, JUDGE);

      expect(result).toEqual({ ok: false, reason: expect.stringContaining("yarn idam:users") });
      expect(result).toMatchObject({ reason: expect.stringContaining("judge@example.com") });
    });

    it("should not disable the persona over a missing fixture, since seeding it needs no restart", async () => {
      vi.mocked(passwordGrantLogin).mockRejectedValueOnce(oauthError("invalid_grant")).mockResolvedValue(loginFor("judge@example.com"));

      await loginAsPersona(IDAM, JUDGE);

      expect(personaState(JUDGE).isAvailable).toBe(true);
      await expect(loginAsPersona(IDAM, JUDGE)).resolves.toMatchObject({ ok: true });
    });

    it("should mark the fixture account as the persona, so the strip can say which one you are", () => {
      expect(personaState(JUDGE)).toMatchObject({ username: "judge@example.com", isAvailable: true });
    });
  });

  describe("in an environment with no fixed accounts", () => {
    beforeEach(() => {
      settings.set("environmentName", "aat");
      vi.mocked(createTestUser).mockResolvedValue("created-user-id");
    });

    it("should create the persona's own user and obtain a token for it", async () => {
      vi.mocked(passwordGrantLogin).mockImplementation(async (_config, username) => loginFor(username));

      const result = await loginAsPersona(IDAM, JUDGE);

      const created = createRequest(0);
      expect(created.user.email).toMatch(/^deed-poll-admin-persona-judge-[0-9a-f]{8}@example\.com$/);
      // The roles are what the persona *is*, and a created account can hold nothing else: this is the same
      // list `PERSONAS` carries, not one assembled from a request.
      expect(created.user.roleNames).toEqual([DEEDPOLL_JUDICIAL]);
      expect(passwordGrantLogin).toHaveBeenCalledWith(IDAM, created.user.email, created.password);
      expect(result).toMatchObject({ ok: true, login: { subject: created.user.email } });
    });

    // The security posture's first prohibition, and the reason AAT needs no new key vault entry: the password
    // is generated per user, used twice and never written anywhere. The configured one is the local seeder's.
    it("should generate the created user's password rather than reading a configured or a real one", async () => {
      vi.mocked(passwordGrantLogin).mockImplementation(async (_config, username) => loginFor(username));

      await loginAsPersona(IDAM, JUDGE);

      const { password } = createRequest(0);
      expect(password).not.toBe("Pa55word11");
      expect(password.length).toBeGreaterThan(20);
      // IDAM enforces a character-class policy that random base64 does not reliably satisfy.
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[0-9]/);
    });

    it("should give a created user a name that reads as a persona, since api stamps it on the audit trail", async () => {
      vi.mocked(passwordGrantLogin).mockImplementation(async (_config, username) => loginFor(username));

      await loginAsPersona(IDAM, ADMIN);

      // api derives the audit author from the token, so whatever is here appears against anything this persona
      // does. A plausible human name would be a lie in a timeline.
      expect(createRequest(0).user).toMatchObject({ forename: "Persona", surname: "Caseworker with admin" });
    });

    it("should reuse the user it created rather than leaving an account behind on every switch", async () => {
      vi.mocked(passwordGrantLogin).mockImplementation(async (_config, username) => loginFor(username));

      await loginAsPersona(IDAM, JUDGE);
      await loginAsPersona(IDAM, JUDGE);

      expect(createTestUser).toHaveBeenCalledOnce();
    });

    // The same rule as the test above under concurrency, which is the case `resolved` alone cannot answer: a
    // create is awaited, so two first switches both read an empty cache. Two accounts is one wasted and — since
    // the later `resolved` entry wins — a strip that marks the persona current for only one of the two sessions,
    // which reads as the switch not having worked.
    it("should create one user when two switches to the same persona arrive together", async () => {
      vi.mocked(passwordGrantLogin).mockImplementation(async (_config, username) => loginFor(username));

      const [first, second] = await Promise.all([loginAsPersona(IDAM, JUDGE), loginAsPersona(IDAM, JUDGE)]);

      expect(createTestUser).toHaveBeenCalledOnce();
      const { email } = createRequest(0).user;
      expect(first).toMatchObject({ ok: true, login: { subject: email } });
      expect(second).toMatchObject({ ok: true, login: { subject: email } });
      expect(personaState(JUDGE).username).toBe(email);
    });

    it("should still create separate users for two personas switched to at once", async () => {
      vi.mocked(passwordGrantLogin).mockImplementation(async (_config, username) => loginFor(username));

      await Promise.all([loginAsPersona(IDAM, JUDGE), loginAsPersona(IDAM, ADMIN)]);

      expect(createTestUser).toHaveBeenCalledTimes(2);
      expect(personaState(JUDGE).username).not.toBe(personaState(ADMIN).username);
    });

    it("should not remember a failed creation, so the next switch tries again", async () => {
      // The shared promise is dropped when it settles: the classification in `createPersonaUser` decides what
      // is permanent, and a joined failure must not become a second, accidental record of it.
      vi.mocked(createTestUser)
        .mockRejectedValueOnce(new TestUserError("Failed to create test user: 500", 500, ""))
        .mockResolvedValue("created-user-id");
      vi.mocked(passwordGrantLogin).mockImplementation(async (_config, username) => loginFor(username));

      await expect(loginAsPersona(IDAM, JUDGE)).resolves.toMatchObject({ ok: false });

      await expect(loginAsPersona(IDAM, JUDGE)).resolves.toMatchObject({ ok: true });
      expect(createTestUser).toHaveBeenCalledTimes(2);
    });

    it("should mark no persona as current until this process has resolved one", async () => {
      // The ordinary state of a fresh AAT pod: the tester signed in as themselves and is none of the personas.
      expect(personaState(JUDGE).username).toBeUndefined();
      vi.mocked(passwordGrantLogin).mockImplementation(async (_config, username) => loginFor(username));

      await loginAsPersona(IDAM, JUDGE);

      expect(personaState(JUDGE).username).toBe(createRequest(0).user.email);
    });

    // The three-hour sweep, which is the whole reason AAT cannot have fixed persona accounts. An
    // `invalid_grant` for a user this process created means it is gone, and that is indistinguishable from a
    // password IDAM never knew — so the only honest answer is to stop believing in the account.
    it("should create another user and retry when the one it had has been swept", async () => {
      vi.mocked(passwordGrantLogin)
        .mockImplementationOnce(async (_config, username) => loginFor(username))
        .mockRejectedValueOnce(oauthError("invalid_grant"))
        .mockImplementation(async (_config, username) => loginFor(username));

      await loginAsPersona(IDAM, JUDGE);
      const afterSweep = await loginAsPersona(IDAM, JUDGE);

      expect(createTestUser).toHaveBeenCalledTimes(2);
      expect(createRequest(1).user.email).not.toBe(createRequest(0).user.email);
      expect(afterSweep).toMatchObject({ ok: true, login: { subject: createRequest(1).user.email } });
    });

    it("should retry once and no further, so a refusing IDAM does not mint accounts in a loop", async () => {
      vi.mocked(passwordGrantLogin).mockRejectedValue(oauthError("invalid_grant"));

      const result = await loginAsPersona(IDAM, JUDGE);

      expect(createTestUser).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ ok: false, reason: expect.stringContaining("invalid_grant") });
      // Not recorded: a refusing IDAM is not evidence that this environment cannot offer the persona.
      expect(personaState(JUDGE).isAvailable).toBe(true);
    });
  });

  describe("when a persona cannot exist here", () => {
    beforeEach(() => {
      settings.set("environmentName", "aat");
    });

    // The judicial role is in this state until `hmcts/idam-access-config#995` merges, which is the main reason
    // the feature exists and the persona it cannot yet offer.
    it("should disable the persona and name the role when IDAM has no such role", async () => {
      vi.mocked(createTestUser).mockRejectedValue(
        new TestUserError(`Failed to create test user: 400 Bad Request - role ${DEEDPOLL_JUDICIAL} not found`, 400, `role ${DEEDPOLL_JUDICIAL} not found`)
      );

      const result = await loginAsPersona(IDAM, JUDGE);

      expect(result).toEqual({ ok: false, reason: expect.stringContaining(`The ${DEEDPOLL_JUDICIAL} role does not exist in this environment`) });
      expect(personaState(JUDGE)).toMatchObject({ isAvailable: false, unavailableReason: expect.stringContaining("idam-access-config") });
    });

    it("should leave the other personas alone, since only one role is missing", async () => {
      vi.mocked(createTestUser).mockRejectedValue(new TestUserError("Failed to create test user: 400 Bad Request", 400, `role ${DEEDPOLL_JUDICIAL} not found`));

      await loginAsPersona(IDAM, JUDGE);

      expect(personaState(CASEWORKER).isAvailable).toBe(true);
      expect(personaState(ADMIN).isAvailable).toBe(true);
      expect(switcherUnavailableReason()).toBeUndefined();
    });

    it("should stop asking IDAM once it has been told the role is not there", async () => {
      vi.mocked(createTestUser).mockRejectedValue(new TestUserError("Failed to create test user: 400 Bad Request", 400, `role ${DEEDPOLL_JUDICIAL} not found`));

      await loginAsPersona(IDAM, JUDGE);
      await loginAsPersona(IDAM, JUDGE);

      expect(createTestUser).toHaveBeenCalledOnce();
      expect(passwordGrantLogin).not.toHaveBeenCalled();
    });

    // A 400 that names nothing recognisable is not evidence about the role — it gets the generic reason, which
    // says "try again" rather than asserting a cause the body did not support.
    it("should not claim a missing role over a refusal that does not name one", async () => {
      vi.mocked(createTestUser).mockRejectedValue(new TestUserError("Failed to create test user: 400 Bad Request", 400, "email domain not permitted"));

      const result = await loginAsPersona(IDAM, JUDGE);

      expect(result).toEqual({ ok: false, reason: expect.stringContaining("400 from idam-testing-support-api") });
      expect(personaState(JUDGE).isAvailable).toBe(true);
    });

    it("should report a testing-support outage as retryable rather than as a missing persona", async () => {
      vi.mocked(createTestUser).mockRejectedValue(new TestUserError("Failed to create test user: 500", 500, `role ${DEEDPOLL_JUDICIAL} not found`));

      const result = await loginAsPersona(IDAM, JUDGE);

      // Even though the body names the role: a 500 is not IDAM answering the question, it is IDAM failing to.
      expect(result).toEqual({ ok: false, reason: expect.stringContaining("try again") });
      expect(personaState(JUDGE).isAvailable).toBe(true);
    });
  });

  describe("when the IDAM client is not registered for the grant", () => {
    // Both grant types are missing as at 2026-09-19 — `idam-access-config` registers `authorization_code` and
    // `refresh_token` only — and they fail at different points, so each has to say which one is needed.
    beforeEach(() => {
      settings.set("environmentName", "aat");
    });

    it.each(["unsupported_grant_type", "unauthorized_client"])("should report %s at the token request as the password grant missing", async (error) => {
      vi.mocked(createTestUser).mockResolvedValue("created-user-id");
      vi.mocked(passwordGrantLogin).mockRejectedValue(oauthError(error));

      const result = await loginAsPersona(IDAM, JUDGE);

      expect(result).toEqual({ ok: false, reason: expect.stringContaining("username and password") });
      expect(result).toMatchObject({ reason: expect.stringContaining("idam-access-config") });
    });

    it("should report the same failure while creating a user as client_credentials missing", async () => {
      // `createTestUser` authenticates with the client-credentials grant, so a client registered for neither
      // fails here first — and the fix names a different grant type from the one above.
      vi.mocked(createTestUser).mockRejectedValue(oauthError("unauthorized_client"));

      const result = await loginAsPersona(IDAM, JUDGE);

      expect(result).toEqual({ ok: false, reason: expect.stringContaining("client_credentials") });
    });

    // One refusal, not three: a missing grant type refuses every persona identically, so the strip states it
    // once rather than against each name.
    it("should refuse every persona once one has proved the grant is unregistered", async () => {
      vi.mocked(createTestUser).mockResolvedValue("created-user-id");
      vi.mocked(passwordGrantLogin).mockRejectedValue(oauthError("unsupported_grant_type"));

      await loginAsPersona(IDAM, JUDGE);

      expect(switcherUnavailableReason()).toEqual(expect.stringContaining("no persona can be switched to"));
      expect(personaState(CASEWORKER).isAvailable).toBe(false);
      await expect(loginAsPersona(IDAM, ADMIN)).resolves.toMatchObject({ ok: false });
      // Nothing further is asked of IDAM: the answer is known and asking again would create accounts for
      // personas that cannot be signed in to.
      expect(createTestUser).toHaveBeenCalledOnce();
    });
  });

  describe("when IDAM cannot be reached at all", () => {
    it("should report it as retryable and quote no internal detail", async () => {
      settings.set("environmentName", "development");
      vi.mocked(passwordGrantLogin).mockRejectedValue(new TypeError("fetch failed"));

      const result = await loginAsPersona(IDAM, JUDGE);

      expect(result).toEqual({ ok: false, reason: expect.stringContaining("IDAM could not be reached") });
      expect(personaState(JUDGE).isAvailable).toBe(true);
    });
  });

  describe("resetPersonaUsers", () => {
    it("should forget recorded refusals, which is how a persona comes back after a redeploy", async () => {
      settings.set("environmentName", "aat");
      vi.mocked(createTestUser).mockRejectedValueOnce(oauthError("unauthorized_client")).mockResolvedValue("created-user-id");
      vi.mocked(passwordGrantLogin).mockImplementation(async (_config, username) => loginFor(username));
      await loginAsPersona(IDAM, JUDGE);

      resetPersonaUsers();

      expect(switcherUnavailableReason()).toBeUndefined();
      await expect(loginAsPersona(IDAM, JUDGE)).resolves.toMatchObject({ ok: true });
    });
  });
});

function personaById(id: string) {
  const persona = PERSONAS.find((candidate) => candidate.id === id);
  if (!persona) throw new Error(`No persona ${id}, so this test file is out of step with PERSONAS`);
  return persona;
}

/** The nth `createTestUser` call's request, which is where the created user's email and password are visible. */
function createRequest(call: number): CreateTestUserRequest {
  return vi.mocked(createTestUser).mock.calls[call][1];
}

/**
 * An OAuth error response as `openid-client` throws it.
 *
 * Constructed from the real class rather than a shaped object: the classification uses `instanceof`, and a
 * double would pass a test that the running code fails.
 */
function oauthError(error: string): client.ResponseBodyError {
  return new client.ResponseBodyError(error, {
    cause: { error, error_description: `${error} for client deed-poll-admin` },
    response: new Response(null, { status: 400 })
  });
}

function loginFor(subject: string): LoginResult {
  return {
    user: currentUser([], "A Persona"),
    subject,
    tokens: { idToken: "an-id-token", accessToken: "an-access-token", refreshToken: "a-refresh-token", expiresAt: 1_800_000_000 }
  };
}
