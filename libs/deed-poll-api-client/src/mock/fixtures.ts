/**
 * The three behaviours the mock can be put into, as data.
 *
 * `deed-poll-api` is not deployed, so every local run and every test of this app talks to the mock. What
 * matters is that the awkward paths are as easy to reach as the happy one: a build that has only ever
 * been driven through a working api has never rendered its "try again shortly" page.
 *
 * Scenarios are switched over HTTP (`POST /__mock/scenario`) rather than by restarting with a different
 * environment variable, so one Playwright run can walk the happy path and then a failure path without a
 * second server.
 *
 * Three, not five: this app has no payment and no submit, so the only axes that matter are "is api
 * there" and "does api refuse a write". `deed-poll-web`'s client has five for the journey it serves.
 */
import type { WireDocumentType } from "../api/wire.js";

export const MOCK_SCENARIOS = {
  "happy-path": { caseWrite: "accept", reachable: true },
  /**
   * Every case write comes back 400 with a field error, whatever it contains.
   *
   * The point is not to model a rule — the mock enforces api's real refusals anyway — but to prove the
   * pages put api's complaint onto the right input's error summary rather than showing a banner.
   */
  "write-rejection": { caseWrite: "reject", reachable: true },
  /** Every contract route answers 503, leaving only the `__mock` control routes and the health paths. */
  "api-unavailable": { caseWrite: "accept", reachable: false }
} as const satisfies Record<string, MockFixture>;

export const DEFAULT_SCENARIO: MockScenario = "happy-path";

/** What `write-rejection` answers a case create or patch with. */
export const MOCK_WRITE_REJECTION = {
  error: "Case could not be saved",
  errors: [{ field: "newForename", message: "Enter the new forename" }]
} as const;

/**
 * The document types the mock serves.
 *
 * Fixed ids, because a page under test has to be able to select one, and fixed applicability lists so the
 * upload form has something to filter by. The integers are Dynamics option-set values — 1-4 for marital
 * status, 1-6 for case type — matching what api publishes.
 */
export const MOCK_DOCUMENT_TYPES: readonly WireDocumentType[] = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Birth certificate", applicableMaritalStatuses: [1, 2, 3, 4], applicableTypes: [1, 2, 3, 4, 5, 6] },
  { id: "22222222-2222-4222-8222-222222222222", name: "Marriage certificate", applicableMaritalStatuses: [2, 3, 4], applicableTypes: [1, 2] },
  { id: "33333333-3333-4333-8333-333333333333", name: "Passport", applicableMaritalStatuses: [1, 2, 3, 4], applicableTypes: [1, 2, 3, 4, 5, 6] }
];

// `Object.hasOwn`, not `in`: `in` walks the prototype chain, so "toString" and "constructor" would pass
// as scenarios. The lookups that follow then yield `undefined`, whose falsy `reachable` makes the mock
// answer 503 to every contract route for the rest of the process instead of rejecting the typo.
export function isMockScenario(value: unknown): value is MockScenario {
  return typeof value === "string" && Object.hasOwn(MOCK_SCENARIOS, value);
}

interface MockFixture {
  /** Whether a case create or patch is applied, or refused with `MOCK_WRITE_REJECTION`. */
  caseWrite: "accept" | "reject";
  /** When false every contract route answers 503. */
  reachable: boolean;
}

export type MockScenario = keyof typeof MOCK_SCENARIOS;
