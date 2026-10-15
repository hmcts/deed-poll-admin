#!/usr/bin/env node
// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: IDAM_SIMULATOR_URL is this script's own knob,
// not something either app reads. Declaring it in turbo.json would imply it affects a build task.

/**
 * Creates the local IDAM test users the login flow needs.
 *
 * The simulator starts empty and answers 401 to `/o/authorize` for an unknown `login_hint`, so
 * signing in locally needs accounts to exist first. Four active personas plus a legacy-admin negative fixture.
 *
 * **The judge is seeded here because nothing local reads `idam-access-config`.** That repo's PR #995 is
 * what makes `caseworker-deedpoll-judicial` assignable in AAT, and it is still open — but the simulator
 * accepts whatever roles an account is created with, so the judicial e2e journey does not wait on it. Only
 * a judge signing in to a deployed environment does.
 *
 * Idempotent — the simulator derives its uuid from the email, so re-running returns the same user
 * rather than creating duplicates.
 *
 *   yarn idam:users
 */

// The roles are imported rather than restated, because a copy of the string here had already
// drifted once: the rename to `caseworker-deedpoll-admin` updated `roles.ts` and left this script
// granting the old `deedpoll-admin`. That fails closed, so the symptom was not an error but an admin
// who resolved to no roles — every e2e admin journey would have signed in unprivileged. Requires
// `libs/deed-poll` to have been built; a missing build fails loudly here rather than silently.
// The name real CFT IDAM uses is still unconfirmed — see `.business_context/IDAM_REGISTRATION_REQUEST.md`.
import { DEEDPOLL_ADMIN, DEEDPOLL_CASEWORKER, DEEDPOLL_DELIVERY_MANAGER, DEEDPOLL_JUDICIAL, DEEDPOLL_TEAM_LEADER } from "@hmcts/deed-poll";

const BASE = process.env.IDAM_SIMULATOR_URL ?? "http://localhost:5556";

const USERS = [
  { email: "team-leader@example.com", forename: "Team", surname: "Leader", roles: [{ code: DEEDPOLL_TEAM_LEADER }] },
  { email: "delivery-manager@example.com", forename: "Delivery", surname: "Manager", roles: [{ code: DEEDPOLL_DELIVERY_MANAGER }] },
  // Legacy negative fixture: retains casework privileges, must be refused Gazette.

  { email: "admin@example.com", forename: "An", surname: "Admin", roles: [{ code: DEEDPOLL_ADMIN }] },
  { email: "caseworker@example.com", forename: "A", surname: "Caseworker", roles: [{ code: DEEDPOLL_CASEWORKER }] },
  // Judicial only, and not the admin role as well: a judge who also held it would pass `/judicial/**`'s
  // gate for the wrong reason, and the e2e assertion that a caseworker is refused there needs the two
  // personas to be genuinely separate accounts.
  { email: "judge@example.com", forename: "A", surname: "Judge", roles: [{ code: DEEDPOLL_JUDICIAL }] }
];

for (const user of USERS) {
  const response = await fetch(`${BASE}/testing-support/accounts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...user, password: "Pa55word11" })
  });

  if (!response.ok) {
    console.error(`Failed to create ${user.email}: ${response.status} ${await response.text()}`);
    process.exitCode = 1;
    continue;
  }

  const { uuid } = await response.json();
  const roles = user.roles.map((r) => r.code).join(", ") || "none";
  console.log(`${user.email.padEnd(26)} uuid=${uuid} roles=[${roles}]`);
}

console.log(`\nSign in at http://localhost:3000/login — the simulator will ask which user.`);
