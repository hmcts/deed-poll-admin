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

const BASE = process.env.IDAM_SIMULATOR_URL ?? "http://localhost:5556";

/**
 * The role string is a placeholder. Real CFT IDAM's name for this role is an open question in
 * `.business_context/IDAM_REGISTRATION_REQUEST.md`, and it has to match `DEEDPOLL_ADMIN` in
 * `libs/deed-poll/src/auth/roles.ts` or the user resolves to no roles — which fails closed, so the
 * symptom is "cannot edit privacy" rather than an error.
 */
const USERS = [
  { email: "admin@example.com", forename: "An", surname: "Admin", roles: [{ code: "deedpoll-admin" }] },
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
