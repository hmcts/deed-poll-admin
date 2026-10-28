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
 *   yarn mock:seed               # reset, then seed
 *   yarn mock:seed --keep        # add to whatever is already there
 *
 * `POST /__mock/cases` is outside the contract and skips the refusals a real create applies, so these
 * cases may hold combinations api would reject. That is the point — it makes dozens of cases cheap — but it
 * means **this data is evidence about querying and paging, never about validation.** Drive the create form
 * for that.
 *
 * The referral phase is the exception and deliberately slower: `currentReferralState` is recomputed by the
 * mock from a case's referrals, so it is driven through the contract routes — raise, claim, direct, close —
 * rather than set on the seed body. A fixture that wrote the column directly would teach the dashboard a
 * number api's own state machine cannot produce, and the "returned — action needed" count is exactly the
 * thing that would then be wrong in one direction locally and another deployed.
 *
 * The confirmation phase is the one thing here that is **not** the contract, and for a reason the contract
 * cannot fix: the write that starts a wait for the applicant's answer is notify-3's *Request confirmation to
 * proceed* email, which the mock has no template for. So the wait is arranged through
 * `POST /__mock/referrals/{id}/confirmation-request` — see the route for why it is a control route rather than
 * an invented template. Everything the awaiting-confirmation worklist then shows is api's own: the case column
 * is recomputed, the days are api's arithmetic, and the order is its per-tab default.
 */

// Imported, not restated. `seed-idam-users.mjs` records what a copied constant cost last time: a role
// string drifted and every admin journey silently signed in unprivileged.
//
// **These are `{ Member: "Member" }` objects, not arrays** — `option-sets.ts` builds them with `members()`,
// so they are addressed by name (`DeedPollType.Adult`) and `DeedPollType[0]` is `undefined`. The first
// draft of this file indexed them numerically: `JSON.stringify` drops an `undefined` value, so the mock
// applied its own defaults, answered **201 for all 32 cases**, and the read-back check below passed
// because the count was right. Every case came out `state=Received, type=null, urgency=null` and four of
// the status tabs were empty. Hence `must()` — a renamed member now fails loudly rather than seeding
// a dataset that looks fine and tests nothing. Requires `libs/deed-poll` to have been built.
import { DEEDPOLL_DELIVERY_MANAGER, DeedPollState, DeedPollType, Urgency } from "@hmcts/deed-poll";

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
const READY_CASES = 26;
const GAZETTE_BATCHES = 26;
const DELIVERY_MANAGER_HEADERS = {
  authorization: `Bearer x.${Buffer.from(JSON.stringify({ sub: "seed.delivery-manager", roles: [DEEDPOLL_DELIVERY_MANAGER] })).toString("base64url")}.signature`
};

/**
 * The cases, grouped by the tab each group lands in.
 *
 * The groups exist because the mock's state-keyed filters — `open` is everything not Enroled or Returned —
 * mean a dataset that is all one state leaves four of the status tabs empty and makes the tab bar untestable.
 * The sixth tab, `awaitingConfirmation`, is not keyed on the state and is filled by the confirmation phase
 * below instead. Dates are spread a day apart within each group so ordering by a date column is assertable
 * rather than a stable-sort coincidence.
 */
const GROUPS = [
  {
    label: "Received (also fills Open)",
    count: RECEIVED_CASES,
    // Referrals are only raised on cases that are still open — an Enroled or Returned case has been finished,
    // and referring one would put the dashboard's worklist somewhere a caseworker cannot act. Declared here
    // rather than sniffed from the label below: a label is there to be printed, and reading which group gets
    // referrals out of one means renaming a log line changes the fixture.
    referrable: true,
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
    label: `Enroled (${READY_CASES} Gazette-ready)`,
    count: READY_CASES + 2,
    build: (n) => ({
      type: must(DeedPollType, "DeedPollType", n <= 3 ? "Minor" : "Adult"),
      state: must(DeedPollState, "DeedPollState", "Enroled"),
      newSurname: "Enroledcase",
      dateReceived: dayInMonth("02", n),
      dateEnroled: dayInMonth("03", 29 - n),
      publishToLondonGazette: n !== READY_CASES + 1,
      dateNoticeSentToLondonGazette: n === READY_CASES + 2 ? dayInMonth("04", 1) : null,
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

/**
 * The referral states some of the seeded cases are driven into, and how many of each.
 *
 * `Decided` is the one the dashboard counts — a referral the judge has directed and the caseworker has not
 * yet closed. The other three rows exist to make the count a count rather than a case total: `Open` and
 * `Claimed` are not yet the caseworker's to action, and a `Closed` one is back to null, so a fixture of
 * nothing but `Decided` would pass a query that ignored the value entirely.
 */
const REFERRAL_PLAN = [
  { label: "Returned - action needed (Decided)", count: 4, upTo: "Decided" },
  { label: "With a judge (Claimed)", count: 2, upTo: "Claimed" },
  { label: "Awaiting a judge (Open)", count: 2, upTo: "Open" },
  { label: "Actioned and closed (null again)", count: 1, upTo: "Closed" }
];

/** How many of the seeded cases the plan above expects to find `Decided` when it reads the count back. */
const EXPECTED_RETURNED_FOR_ACTION = REFERRAL_PLAN.find((phase) => phase.upTo === "Decided").count;

/**
 * How long each waiting applicant has been waiting, in whole days before now.
 *
 * Two, and two different lengths: one row cannot show that the worklist is ordered longest wait first, and a
 * single length cannot show that the Waiting column is api's arithmetic rather than a constant. Relative to
 * now rather than a fixed date in `dayInMonth`'s range, because the number in the cell is the point — a
 * January date would read as however many days it has been since January.
 *
 * Arranged on the `Decided` referrals, which is the state a waiting case is ordinarily in: the judge refused
 * the non-publication request, so the office asked the applicant whether to enrol anyway. It leaves them
 * `Decided`, so these cases stay on the returned-for-action count as well — which is api's behaviour, not an
 * interference between the two worklists.
 */
const CONFIRMATION_WAIT_DAYS = [14, 3];

/**
 * The Masters list a Delivery Manager would keep: one unavailable, and one holding the local judge persona's email
 * (`scripts/seed-idam-users.mjs`), so that judge links to it on their first judicial request. Assigning the seeded
 * referrals to them is plan Db1's.
 */
const MASTERS = [
  { name: "Master Judge", email: "judge@example.com" },
  { name: "Master Sullivan", email: "master.sullivan@example.com" },
  { name: "Master Wren", email: "master.wren@example.com", available: false }
];

/** The judge a claim and a direction are attributed to. The mock reads a subject out of the token, no roles. */
const SEED_JUDGE = "seed.judge@example.com";

/** A date in January-to-June 2026, one per case, as the wire's local-date-time string. */
function dayInMonth(month, n) {
  return `2026-${month}-${String(n).padStart(2, "0")}T00:00:00.000`;
}

/**
 * Whole days ago, as the wire's zoneless local-date-time string.
 *
 * The `Z` is stripped rather than the parts assembled by hand: api's timestamps are `LocalDateTime`s and the
 * mock reads them through the same wire schema, so a value carrying an offset is a different string from the
 * one api would have written. UTC for the reason the mock formats its notes in UTC — a locally-zoned midnight
 * dates to the previous day west of Greenwich, which is one day of arithmetic in the Waiting cell.
 */
function daysAgo(days) {
  return new Date(Date.now() - days * 86_400_000).toISOString().replace(/Z$/, "");
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
/** The ids the referral phase drives, in seeding order. Only the Received group is drawn from. */
const referrable = [];

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

    if (group.referrable) referrable.push((await response.json()).id);
    seeded++;
  }

  console.log(`${group.label.padEnd(28)} ${String(group.count).padStart(2)} case(s)`);
}

console.log("");

let referred = 0;
/** The referrals the plan drove as far as `Decided`, which are the ones the confirmation phase asks about. */
const decided = [];

for (const phase of REFERRAL_PLAN) {
  for (let n = 1; n <= phase.count; n++) {
    const caseId = referrable[referred];
    if (caseId === undefined) {
      console.error(`Ran out of open cases to refer: the plan wants ${REFERRAL_PLAN.reduce((sum, p) => sum + p.count, 0)}, ${referrable.length} were seeded.`);
      process.exit(1);
    }

    const referralId = await refer(caseId, phase.upTo, `${phase.label} #${n}`);
    if (phase.upTo === "Decided") decided.push(referralId);
    referred++;
  }

  console.log(`${phase.label.padEnd(36)} ${String(phase.count).padStart(2)} case(s)`);
}

// The wait for an applicant's answer, which is the one thing here no contract route can start — see the
// docblock. Checked per referral like every other step: a wait that was not arranged leaves the worklist, the
// banner and the Waiting column empty, which is the failure this whole script exists to prevent.
for (const [at, days] of CONFIRMATION_WAIT_DAYS.entries()) {
  const referralId = decided[at];
  if (referralId === undefined) {
    console.error(`Ran out of decided referrals to ask about: the plan wants ${CONFIRMATION_WAIT_DAYS.length}, ${decided.length} were decided.`);
    process.exit(1);
  }

  await step(
    "POST",
    `/__mock/referrals/${referralId}/confirmation-request`,
    { confirmationRequestedAt: daysAgo(days) },
    {},
    `ask the applicant ${days} day(s) ago`
  );
}

console.log(`${"Awaiting the applicant's reply".padEnd(36)} ${String(CONFIRMATION_WAIT_DAYS.length).padStart(2)} case(s)`);

/**
 * Raise a referral on `caseId`, transition it as far as `upTo` through the routes api publishes, and answer
 * the referral's id.
 *
 * Each step is checked, because a refusal part-way leaves the case in whatever state it reached and the
 * only symptom is a count that is quietly short.
 */
async function refer(caseId, upTo, what) {
  const referral = await step("POST", `/caseworker/cases/${caseId}/referrals`, { reasons: ["Minor"] }, {}, `raise ${what}`);
  if (upTo === "Open") return referral.id;

  const judge = { authorization: `Bearer x.${Buffer.from(JSON.stringify({ sub: SEED_JUDGE }), "utf8").toString("base64url")}.signature` };
  await step("POST", `/judicial/referrals/${referral.id}/claim`, undefined, judge, `claim ${what}`);
  if (upTo === "Claimed") return referral.id;

  await step("POST", `/judicial/referrals/${referral.id}/direction`, { decision: "Approved", changesToStandardPublication: false }, judge, `direct ${what}`);
  if (upTo === "Decided") return referral.id;

  await step("POST", `/caseworker/cases/${caseId}/referrals/${referral.id}/closure`, undefined, {}, `close ${what}`);

  return referral.id;
}

async function step(method, path, body, headers, what) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  if (!response.ok) {
    console.error(`Failed to ${what}: ${response.status} ${await response.text()}`);
    process.exit(1);
  }

  return response.json();
}

// Frozen audit fixtures: no Gazette send operation exists. More than a page, with one bounded preview.
for (let n = 1; n <= GAZETTE_BATCHES; n++) {
  await step(
    "POST",
    "/__mock/gazette-batches",
    {
      sentAt: dayInMonth("09", n),
      sentBy: "Seed Gazette administrator",
      referenceNumbers: Array.from(
        { length: n === GAZETTE_BATCHES ? 101 : 2 },
        (_, at) => `KBDP2026-B${String(n).padStart(2, "0")}-${String(101 - at).padStart(3, "0")}`
      )
    },
    {},
    `seed Gazette batch ${n}`
  );
}

// Through the contract's own create, as the Delivery Manager, so the list holds what api's rules allow. `--keep`
// skips an address already listed, because a second create of it is api's 409.
const listedEmails = new Set((await step("GET", "/caseworker/masters", undefined, DELIVERY_MANAGER_HEADERS, "read the Masters list")).map((m) => m.email));
for (const master of MASTERS) {
  if (listedEmails.has(master.email)) continue;
  await step("POST", "/caseworker/masters", master, DELIVERY_MANAGER_HEADERS, `add ${master.name}`);
}
const masters = await step("GET", "/caseworker/masters", undefined, DELIVERY_MANAGER_HEADERS, "read the Masters list back");
console.log(`Masters: ${masters.length}, of which ${masters.filter((m) => !m.available).length} unavailable.`);

const ready = await step("GET", "/caseworker/cases?filter=readyForPublication&size=100", undefined, DELIVERY_MANAGER_HEADERS, "read Gazette-ready cases");
const history = await step("GET", "/caseworker/gazette-notices", undefined, DELIVERY_MANAGER_HEADERS, "read Gazette history");
const historyTail = await step("GET", "/caseworker/gazette-notices?page=2", undefined, DELIVERY_MANAGER_HEADERS, "read Gazette history page 2");
const preview = history.batches[0];
console.log(
  `Gazette-ready: ${ready.total}; history: ${history.total} batches, newest preview: ${preview.referenceNumbers.length}/${preview.caseCount} references.`
);

// Read back rather than trusting the count above: the totals are what the page shows, and a seed that
// returned 201 for a body the list then filters out differently is exactly the sort of thing worth
// catching here instead of on screen.
const list = await fetch(`${BASE}/caseworker/cases`);
const { total, totalPages } = await list.json();

// The same query the dashboard's count runs, read back for the same reason: a `where` the mock did not
// recognise narrows nothing and answers the case total, and a condition dropped on the way to the wire
// answers zero. Both look like a working seed from here unless the number is asserted.
const worklist = await fetch(`${BASE}/caseworker/cases?where=currentReferralState:is:Decided&size=1`);
const returnedForAction = worklist.ok ? (await worklist.json()).total : undefined;

// The second worklist, read back through the **published filter key** rather than a `where`: that is how the
// banner, the tab and the count all address it, and the case column behind it is recomputed by the mock rather
// than written by the confirmation phase. So a request that landed on a referral without moving the case reads
// as zero here, which is precisely the state that is invisible on screen — an empty tab.
const awaiting = await fetch(`${BASE}/caseworker/cases?filter=awaitingConfirmation&size=1`);
const awaitingConfirmation = awaiting.ok ? (await awaiting.json()).total : undefined;

console.log(`\nSeeded ${seeded}. The list reports total=${total} across ${totalPages} page(s).`);
console.log(`Referred ${referred}, of which ${returnedForAction} are returned and need action.`);
console.log(`Awaiting the applicant's confirmation: ${awaitingConfirmation}, waiting ${CONFIRMATION_WAIT_DAYS.join(" and ")} day(s).`);

// Every mismatch **exits non-zero**, like every other check in this script: a seed whose numbers are wrong is
// a seed to fix, and a message among 30 lines of output that still exits 0 is one a developer scrolls past —
// then meets as a dashboard banner that never appears.
//
// `--keep` adds to whatever was already there, so an earlier run's cases are counted too and neither total is
// expected to match on a run that did not reset first.
const mismatches = [
  KEEP || (ready.total === READY_CASES && ready.cases[0]?.displayReference === reference("2", READY_CASES))
    ? null
    : "Gazette-ready membership or oldest-enrolled order differs from the seed.",
  KEEP || (history.total === GAZETTE_BATCHES && history.totalPages === 2 && historyTail.batches.length === 1)
    ? null
    : "Gazette history totals or pagination differ from the seed.",
  KEEP ||
  (preview.caseCount === 101 &&
    preview.referencesTruncated &&
    preview.referenceNumbers.length === 100 &&
    preview.referenceNumbers[0] === "KBDP2026-B26-001" &&
    preview.referenceNumbers[99] === "KBDP2026-B26-100")
    ? null
    : "Gazette history did not return the sorted, truncated frozen preview.",
  KEEP ||
  (masters.length === MASTERS.length &&
    MASTERS.every((seed) => masters.some((m) => m.email === seed.email && m.available === (seed.available ?? true) && !m.linked)))
    ? null
    : "the Masters list differs from the seed.",
  worklist.ok ? null : `the filtered read-back was refused with ${worklist.status} — has \`currentReferralState\` stopped being queryable?`,
  awaiting.ok ? null : `the awaiting-confirmation read-back was refused with ${awaiting.status} — is \`awaitingConfirmation\` still a published filter key?`,
  KEEP || total === seeded ? null : `seeded ${seeded} but the list reports ${total}.`,
  KEEP || returnedForAction === EXPECTED_RETURNED_FOR_ACTION
    ? null
    : `expected ${EXPECTED_RETURNED_FOR_ACTION} Decided case(s) but the filter reports ${returnedForAction}.`,
  KEEP || awaitingConfirmation === CONFIRMATION_WAIT_DAYS.length
    ? null
    : `expected ${CONFIRMATION_WAIT_DAYS.length} case(s) awaiting confirmation but the filter reports ${awaitingConfirmation}.`
].filter((mismatch) => mismatch !== null);

if (mismatches.length > 0) {
  for (const mismatch of mismatches) console.error(`Mismatch: ${mismatch}`);
  process.exit(1);
}

console.log(`Every case has the forename "Filterby". Open http://127.0.0.1:3000/deed-polls`);
