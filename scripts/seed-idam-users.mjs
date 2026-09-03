#!/usr/bin/env node
// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: IDAM_SIMULATOR_URL is this script's own knob,
// not something either app reads. Declaring it in turbo.json would imply it affects a build task.

/**
 * Creates the local IDAM test users the login flow needs.
 *
 * The simulator starts empty and answers 401 to `/o/authorize` for an unknown `login_hint`, so
 * signing in locally needs accounts to exist first. Two, matching the only authorization distinction
 * this service makes: one holding the privileged role and one holding none.
 *
 * Idempotent — the simulator derives its uuid from the email, so re-running returns the same user
 * rather than creating duplicates.
 *
 *   yarn idam:users
 */

// The privileged role is imported rather than restated, because a copy of the string here had already
// drifted once: the rename to `caseworker-deedpoll-admin` updated `roles.ts` and left this script
// granting the old `deedpoll-admin`. That fails closed, so the symptom was not an error but an admin
// who resolved to no roles — every e2e admin journey would have signed in unprivileged. Requires
// `libs/deed-poll` to have been built; a missing build fails loudly here rather than silently.
// The name real CFT IDAM uses is still unconfirmed — see `.business_context/IDAM_REGISTRATION_REQUEST.md`.
import { DEEDPOLL_ADMIN } from "@hmcts/deed-poll";

const BASE = process.env.IDAM_SIMULATOR_URL ?? "http://localhost:5556";

const USERS = [
  { email: "admin@example.com", forename: "An", surname: "Admin", roles: [{ code: DEEDPOLL_ADMIN }] },
  { email: "caseworker@example.com", forename: "A", surname: "Caseworker", roles: [] }
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
