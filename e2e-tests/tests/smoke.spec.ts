/**
 * The smoke suite: what `yarn test:smoke` runs after every Jenkins deploy.
 *
 * `sectionDeployToAKS` calls `builder.smokeTest()` unconditionally, with `TEST_URL` set to the environment
 * it has just deployed — so this file is the only thing in this repo that runs against a real deployment.
 * One test and one request, deliberately: the journey specs need a signed-in caseworker through the local
 * `rse-idam-simulator` and the in-memory `deed-poll-api` mock on :3200, and a deployed environment has
 * neither. See `docs/PIPELINES.md`.
 *
 * `/health/readiness` is the right single request because it is not a liveness ping. `src/app.ts` puts both
 * `deed-poll-api` and Redis on readiness and leaves liveness empty on purpose, so UP here means the pod can
 * actually serve a case page — which is the question a deploy gate should ask. It also means **this gate
 * stays red until `deed-poll-api` is deployed**, blocker 6 in `docs/PIPELINES.md`. That is the intended
 * reading rather than a defect to route around by asserting liveness instead: a pod that 500s every case
 * page has not deployed successfully, whatever its process is doing.
 */
import { expect, test } from "@playwright/test";

test("should report readiness UP, with both of the dependencies every page needs named", { tag: "@smoke" }, async ({ request }) => {
  const response = await request.get("/health/readiness");

  // The status code and the body, because they answer different questions. Kubernetes reads only the code
  // (`healthcheck-middleware` sets 503 for DOWN — see the note on `respond`), and the body is where the
  // per-dependency verdict is, so asserting it makes a failed deploy gate say *which* dependency is down
  // instead of only that the pod is not ready.
  expect(response.status(), "readiness should answer 200").toBe(200);
  expect(await response.json()).toEqual({ status: "UP", services: { deedPollApi: "UP", redis: "UP" } });
});
