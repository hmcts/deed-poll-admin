/**
 * Run the mock api as a process: `yarn mock:api`, and part of `yarn dev`.
 *
 *   yarn mock:api --port 3200
 *   DEED_POLL_API_MOCK_SCENARIO=api-unavailable yarn mock:api
 *
 * 3200 by default, clear of the web app (3000) and the API this repo is deleting in task 5 (3001).
 */
import { DEFAULT_SCENARIO, isMockScenario } from "./fixtures.js";
import { startMockApi } from "./server.js";

const DEFAULT_PORT = 3200;

const flag = process.argv.indexOf("--port");
const port = Number(flag === -1 ? (process.env.DEED_POLL_API_MOCK_PORT ?? DEFAULT_PORT) : process.argv[flag + 1]);
const requested = process.env.DEED_POLL_API_MOCK_SCENARIO;

if (requested !== undefined && !isMockScenario(requested)) {
  // Failing loudly beats starting in the default scenario: a typo would otherwise look like a bug in the
  // app under test rather than in the command that started the mock.
  console.error(`Unknown DEED_POLL_API_MOCK_SCENARIO: ${requested}`);
  process.exit(1);
}

const mock = await startMockApi({ port, scenario: isMockScenario(requested) ? requested : DEFAULT_SCENARIO });

console.log(`mock deed-poll-api listening on ${mock.url} (scenario: ${mock.scenario})`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void mock.close().then(() => process.exit(0));
  });
}
