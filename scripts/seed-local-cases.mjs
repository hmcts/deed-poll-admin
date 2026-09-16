#!/usr/bin/env node
// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: DEED_POLL_API_MOCK_URL is this script's own knob,
// not something the app reads. The app resolves api through DEED_POLL_API_URL; this addresses the mock
// directly, and conflating the two would let a stray export point the seeder at a deployed environment.

/**
 * Seeds the local mock api with cases to develop the case list and query builder against.
 *
 * **The mock starts with an empty case store in every scenario** — `fixtures.ts` fixes document types and
 * nothing else. So a fresh `yarn mock:api` renders an empty list, and the query builder has nothing to
 * filter. That is correct behaviour and it reads exactly like a broken list, which is the reason this
 * script exists rather than a note in the README.
 *
 * The store is in memory, so **everything here is lost when the mock restarts** — including when the OS
 * kills it under memory pressure, which happens in this devcontainer. Re-run rather than reconstruct.
 *
 *   yarn seed:cases              # reset, then seed
 *   yarn seed:cases --keep       # add to whatever is already there
 *
 * `POST /__mock/cases` is outside the contract and skips the refusals a real create applies, so these
 * cases may hold combinations api would reject. That is the point — it makes 30-odd cases cheap — but it
 * means **this data is evidence about querying and paging, never about validation.** Drive the create form
 * for that.
 */

// Imported, not restated. `seed-idam-users.mjs` records what a copied constant cost last time: a role
// string drifted and every admin journey silently signed in unprivileged.
//
// **These are `{ Member: "Member" }` objects, not arrays** — `option-sets.ts` builds them with `members()`,
// so they are addressed by name (`DeedPollType.Adult`) and `DeedPollType[0]` is `undefined`. The first
// draft of this file indexed them numerically: `JSON.stringify` drops an `undefined` value, so the mock
// applied its own defaults, answered **201 for all 32 cases**, and the read-back check below passed
// because the count was right. Every case came out `state=Received, type=null, urgency=null` and four of
// the five filter tabs were empty. Hence `must()` — a renamed member now fails loudly rather than seeding
// a dataset that looks fine and tests nothing. Requires `libs/deed-poll` to have been built.
import { DeedPollState, DeedPollType, Urgency } from "@hmcts/deed-poll";

/** Fail on an option-set member that does not exist, rather than sending `undefined` and seeding a default. */
function must(set, name, member) {
  const value = set[member];
  if (value === undefined) {
    console.error(`${name}.${member} does not exist. Members: ${Object.keys(set).join(", ")}`);
    process.exit(1);
  }
  return value;
}

const BASE = process.env.DEED_POLL_API_MOCK_URL ?? "http://localhost:3200";
const KEEP = process.argv.includes("--keep");

/**
 * One more than a page of 25, so the "received" and "open" tabs both page. `size` defaults to 25 in the
 * mock's list response, and a paging bug is invisible in a list that fits on one page.
 */
const RECEIVED_CASES = 26;

/**
 * The cases, grouped by the tab each group lands in.
 *
 * The groups exist because `FILTERS` in the mock keys on `state` — `open` is everything not Enroled or
 * Returned — so a dataset that is all one state leaves four of the five tabs empty and makes the tab bar
 * untestable. Dates are spread a day apart within each group so ordering by a date column is assertable
 * rather than a stable-sort coincidence.
 */
const GROUPS = [
  {
    label: "Received (also fills Open)",
    count: RECEIVED_CASES,
    build: (n) => ({
      type: must(DeedPollType, "DeedPollType", "Adult"),
      state: must(DeedPollState, "DeedPollState", "Received"),
      newSurname: "Adultcase",
      dateReceived: dayInMonth("01", n),
      displayReference: reference("1", n),
      // Every fourth one Urgent, so an enum condition has a minority to find rather than all or nothing.
      urgency: must(Urgency, "Urgency", n % 4 === 0 ? "Urgent" : "Normal")
    })
  },
  {
    label: "Enroled",
    count: 3,
    build: (n) => ({
      type: must(DeedPollType, "DeedPollType", "Minor"),
      state: must(DeedPollState, "DeedPollState", "Enroled"),
      newSurname: "Minorcase",
      dateReceived: dayInMonth("02", n),
      dateEnroled: dayInMonth("03", n),
      displayReference: reference("2", n),
      urgency: must(Urgency, "Urgency", "Normal")
    })
  },
  {
    label: "Returned",
    count: 2,
    build: (n) => ({
      type: must(DeedPollType, "DeedPollType", "DeedOfRelinquishment"),
      state: must(DeedPollState, "DeedPollState", "Returned"),
      newSurname: "Returnedcase",
      dateReceived: dayInMonth("04", n),
      dateReturned: dayInMonth("05", n),
      displayReference: reference("3", n),
      urgency: must(Urgency, "Urgency", "Normal")
    })
  },
  {
    label: "Received, no surname",
    count: 1,
    // `isEmpty` and `isNotEmpty` are two of the operators every text field offers, and with a surname on
    // every case there is nothing for them to return. One blank row is the cheapest way to make them real.
    build: (n) => ({
      type: must(DeedPollType, "DeedPollType", "Adult"),
      state: must(DeedPollState, "DeedPollState", "Received"),
      newSurname: "",
      dateReceived: dayInMonth("06", n),
      displayReference: reference("4", n),
      urgency: must(Urgency, "Urgency", "Normal")
    })
  }
];

/** A date in January-to-June 2026, one per case, as the wire's local-date-time string. */
function dayInMonth(month, n) {
  return `2026-${month}-${String(n).padStart(2, "0")}T00:00:00.000`;
}

/**
 * A display reference per case, because the Reference cell is a link: one with no text is useless to a
 * caseworker and an accessibility failure on every list page rendered.
 */
function reference(group, n) {
  return `KBDP2026-${group}${String(n).padStart(2, "0")}0`;
}

if (!KEEP) {
  const reset = await fetch(`${BASE}/__mock/reset`, { method: "POST" });
  if (!reset.ok) {
    console.error(`Could not reset the mock at ${BASE}: ${reset.status}. Is \`yarn mock:api\` running?`);
    process.exit(1);
  }
}

let seeded = 0;

for (const group of GROUPS) {
  for (let n = 1; n <= group.count; n++) {
    // One forename across every group, so a single condition isolates this dataset from cases the create
    // form leaves behind — and so `is` on a shared value and `is` on a distinguishing one can be compared.
    const body = { newForename: "Filterby", ...group.build(n) };

    const response = await fetch(`${BASE}/__mock/cases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    // Asserted per case rather than counted at the end: a rejected seed leaves the list shorter than
    // intended, and that surfaces later as a wrong total, which reads as a paging or query bug.
    if (!response.ok) {
      console.error(`Failed to seed ${group.label} #${n}: ${response.status} ${await response.text()}`);
      process.exit(1);
    }

    seeded++;
  }

  console.log(`${group.label.padEnd(28)} ${String(group.count).padStart(2)} case(s)`);
}

// Read back rather than trusting the count above: the totals are what the page shows, and a seed that
// returned 201 for a body the list then filters out differently is exactly the sort of thing worth
// catching here instead of on screen.
const list = await fetch(`${BASE}/caseworker/cases`);
const { total, totalPages } = await list.json();

console.log(`\nSeeded ${seeded}. The list reports total=${total} across ${totalPages} page(s).`);
if (total !== seeded) console.error(`Mismatch: seeded ${seeded} but the list reports ${total}.`);
console.log(`Every case has the forename "Filterby". Open http://127.0.0.1:3000/deed-polls`);
