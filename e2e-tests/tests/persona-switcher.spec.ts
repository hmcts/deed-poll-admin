/**
 * The persona switcher, end to end in a browser — `docs/plans/completed/dev-persona-switcher.md`, task 4.
 *
 * **One test, because it is one sitting.** The whole point of the feature is that a single tester works as a
 * caseworker, a judge, a Team leader and a Delivery Manager without signing out, so a spec that used four sessions would be
 * testing the thing the switcher exists to avoid.
 *
 * **What only a browser can show here, and why this file is the plan's proof rather than its coverage.** The
 * plan rests on one finding: *changing your role does not change your permissions*. api derives roles from
 * `/o/userinfo` using the session's access token, so the obvious implementation — rewriting the session's `CurrentUser`
 * — yields the judicial chrome and then a 403 on every judicial call, which looks exactly like a defect in the
 * screens the tester came to test. Nothing in a unit test can tell the two implementations apart: both put
 * `caseworker-deedpoll-judicial` on `CurrentUser`. What tells them apart is **api answering the switched
 * token**, and this is where that is asserted.
 *
 * The discriminating assertion is the referral **claimed by `judge@example.com` before the switch**. api makes
 * a `Claimed` referral visible to its holder alone, deriving the holder from the token — so the judge persona
 * reads it (200) and a caseworker wearing a forged role list would be answered 404, on the very page the
 * chrome had just invited them onto. The referral held by *another* judge is the other side of the same rule,
 * and it is refused here too: the identity in the token is doing the work, not anything this app holds.
 *
 * The two role-derived refusals are the app's own gate — `/judicial/**` is refused to both caseworker personas
 * — and the staff control appearing on a page where the same URL offered none minutes earlier is the third
 * switch taking effect. Both follow from api's `GET /me` answer for the switched token, which sign-in stores; the
 * app reads no role. Neither is provable from the outside any other way: the judicial pages never ask about
 * access, so a gated and an ungated build render identically under test.
 *
 * **This spec signs itself in and must keep doing so.** Do not give it `TEAM_LEADER_STORAGE_STATE` or
 * `CASEWORKER_STORAGE_STATE`: a switch calls `signIn`, which regenerates the session id and destroys the
 * server-side session behind the restored cookie — so every other spec sharing that state would be signed out
 * mid-run, and the symptom would be an unrelated file timing out on a locator. A login of its own costs one
 * OIDC round trip and keeps the damage inside this test.
 *
 * `PERSONA_SWITCHER_ENABLED=true` on `dev:nowatch:web` is what makes the strip render at all — the same
 * `yarn dev` opt-in a developer gets. Against a deployed environment the switcher is task 6's to verify.
 */
import { AxeBuilder } from "@axe-core/playwright";
import { type APIRequestContext, expect, type Locator, type Page, test } from "@playwright/test";
import { CASEWORKER_EMAIL, DEPLOYED_STACK_SKIP_REASON, JUDGE_EMAIL, RUNS_AGAINST_DEPLOYED_STACK, signInAsCaseworker } from "./idam-session.js";

/** The mock api, which `playwright.config.ts` starts on 3200 beside the app on 3000. */
const MOCK_API_URL = process.env.DEED_POLL_API_URL ?? "http://localhost:3200";

const CASE_LIST_PATH = "/deed-polls";
const POOL_PATH = "/judicial/referrals";

/** `PERSONA_SWITCH_PATH` in `src/auth/persona-switcher.ts`, where the strip's form posts. */
const SWITCH_PATH = "/switch-persona";

/**
 * A judge who is not the persona, so api's answer about the referral they hold is a 404.
 *
 * Deliberately not `judge@example.com`: the point of the second referral is a *different* holder, which is
 * what makes the refusal a matter of whose token arrived rather than of which roles it carries.
 */
const OTHER_JUDGE = "e2e.personaswitcher.otherjudge@example.com";

test.skip(RUNS_AGAINST_DEPLOYED_STACK, DEPLOYED_STACK_SKIP_REASON);

test("one tester works as a caseworker, a judge, a Team leader and a Delivery Manager without signing out", async ({ page, request }) => {
  // Arrange: a case to find on the list, a note on it to look for an staff control against, and two referrals
  // already claimed — one by the judge persona, one by somebody else.
  const seeded = await seedPersonaFixtures(request);

  // The ordinary caseworker holds the document-reader role without staff capabilities.
  // This is where the journey starts, so the strip must mark that persona as current.
  await signInAsCaseworker(page);

  await expect(personaStrip(page)).toContainText("Dev only");
  await expect(currentPersona(page)).toHaveText("Caseworker (current)");
  await expect(switchTo(page, "Master")).toBeVisible();
  await expect(switchTo(page, "Team leader")).toBeVisible();
  await expect(switchTo(page, "Delivery Manager")).toBeVisible();

  // **A crafted URL cannot change a persona** (decision 6). The route file exports `POST` and nothing else, so
  // `simple-router` registers no `GET` and this is a 404 from the not-found handler rather than a handler that
  // refuses — asserted at the running app because the shape of the refusal is the security property.
  expect((await page.request.get(SWITCH_PATH, { maxRedirects: 0 })).status()).toBe(404);

  // The caseworker's own api-backed page: the list, narrowed to the case seeded for this run.
  await page.getByLabel("Search cases").fill(seeded.surname);
  await page.getByRole("button", { name: "Search", exact: true }).click();

  await expect(page).toHaveURL(`${CASE_LIST_PATH}?filter=all&q=${seeded.surname}`);
  await expect(page.getByText("1 to 1 of 1 applications")).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  // The strip is on the list too, and the axe check covers it here: it is chrome on every page, so a violation
  // in it would otherwise be found by whichever unrelated journey ran next.
  await expect(currentPersona(page)).toBeVisible();
  await expectNoAccessibilityViolations(page);

  // A note this persona may amend but must not be offered a delete button for — the same URL is revisited as
  // the Team leader below, and the pair is what shows the third switch reached api's role derivation.
  await page.goto(seeded.noteEditUrl);
  await expect(page.getByLabel("Note")).toHaveValue(seeded.note);
  // Absent from the markup rather than hidden: `not.toBeVisible()` would also pass against a button styled
  // away, which is not what `canDeleteNote` does.
  await expect(deleteNote(page)).toHaveCount(0);

  await expectJudicialAreaRefused(page);

  // ── to the judge ──────────────────────────────────────────────────────────────────────────────────────────
  // **Back to a service page first, because the refusal itself carries no strip.** The 404 view is the
  // starter's `errors/404.njk` and nunjucks resolves the starter's view paths before `src/pages`, so it extends
  // the starter's layout rather than the app's — the one exception task 2 recorded and could not close without
  // editing the library. A tester who guesses a judicial URL therefore has to navigate away before switching,
  // which is worth knowing and is asserted here rather than left to be discovered.
  await expect(personaStrip(page)).toHaveCount(0);
  await page.goto(CASE_LIST_PATH);

  await switchTo(page, "Master").click();

  // `/` and not a list path (decision 8): the switch redirects there and `src/pages/index.ts` resolves the new
  // persona's home, so landing on the pool is the routing agreeing with the roles api has just derived.
  await expect(page).toHaveURL(POOL_PATH);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Referrals for a direction");
  // Decision 7: the strip is on the judicial chrome as well, or the switch would be a trap door.
  await expect(currentPersona(page)).toHaveText("Master (current)");

  // **The assertion the whole plan turns on.** This referral was claimed by `judge@example.com` before any
  // switch happened, and api shows a claimed referral to its holder alone — resolved from the token. A role
  // rewrite would have arrived with the caseworker's token and been answered 404 here, on the page its own
  // chrome had just offered.
  const own = await page.goto(`${POOL_PATH}/${seeded.ownReferralId}`);
  expect(own?.status()).toBe(200);
  await expect(referralRow(page, "Status")).toContainText("Claimed");
  await expect(page.getByRole("button", { name: "Record a direction" })).toBeVisible();
  await expectNoAccessibilityViolations(page);

  // And the other side of the same rule: the referral another judge holds is refused, so what the switched
  // token buys is one identity's work and not the judicial surface wholesale. 404 and not 403 — api answers
  // withdrawn, closed, somebody else's and never-there identically (decision 10), and the copy must stay true
  // of all four.
  const theirs = await page.goto(`${POOL_PATH}/${seeded.otherReferralId}`);
  expect(theirs?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This referral is no longer available");
  await expect(page.locator("body")).not.toContainText(OTHER_JUDGE);

  // ── to the Team leader ──────────────────────────────────────────────────────────────────────────────────
  // Switched from a judicial page, which is the return journey decision 7 is about.
  await switchTo(page, "Team leader").click();

  await expect(page).toHaveURL(CASE_LIST_PATH);
  await expect(currentPersona(page)).toHaveText("Team leader (current)");
  await expect(page.getByRole("link", { name: "View London Gazette applications" })).toHaveCount(0);

  // The same note page as before the switches, and the control `caseworker-deedpoll-team-leader` unlocks is now on
  // it. Nothing about the URL changed, so the only thing that can have is api's `GET /me` answer for the token
  // this persona arrived with, which the switch's sign-in stored.
  await page.goto(seeded.noteEditUrl);
  await expect(page.getByLabel("Note")).toHaveValue(seeded.note);
  await expect(deleteNote(page)).toBeVisible();
  await expectNoAccessibilityViolations(page);

  // Staff capabilities do not imply judicial access, so the Team leader
  // is refused the judicial area exactly as the ordinary caseworker was.
  await expectJudicialAreaRefused(page);

  // Away from the refusal again, for the reason above.
  await page.goto(CASE_LIST_PATH);

  await switchTo(page, "Delivery Manager").click();
  await expect(page).toHaveURL(CASE_LIST_PATH);
  await expect(currentPersona(page)).toHaveText("Delivery Manager (current)");
  await expect(page.getByRole("link", { name: "View London Gazette applications" })).toBeVisible();
  await page.goto(seeded.noteEditUrl);
  await expect(deleteNote(page)).toBeVisible();
  await expectNoAccessibilityViolations(page);
  await expectJudicialAreaRefused(page);
  await page.goto(CASE_LIST_PATH);

  // Back where the sitting started, which is what makes the strip a switcher rather than four one-way doors —
  // and the staff control goes with the new `/me` answer rather than sticking to the session that once held it.
  await switchTo(page, "Caseworker").click();
  await expect(page).toHaveURL(CASE_LIST_PATH);
  await expect(currentPersona(page)).toHaveText("Caseworker (current)");
  await page.goto(seeded.noteEditUrl);
  await expect(deleteNote(page)).toHaveCount(0);
});

/**
 * A second test, and the only reason for one: `requireSameOrigin` cannot be shown from the browser at all.
 *
 * A real page cannot set `Sec-Fetch-Site` — it is a forbidden header name — so the forged post has to come from
 * `APIRequestContext`, which is not a page and therefore cannot be part of the journey above. It signs in of its
 * own accord for the reason this file's docblock gives about shared storage state.
 *
 * Worth an end-to-end assertion rather than leaving it to `src/app.test.ts`, which doubles the middleware and so
 * proves only that *something* is mounted: what is asserted here is the running app answering a same-site write
 * the way `SameSite=Lax` alone would not. `/switch-persona` is the subject because it is the one route whose
 * effect is a change of identity — but the gate is global, so any write would do.
 */
test("a write from a sibling service in the same environment is refused, which SameSite=Lax alone would permit", async ({ page }) => {
  await signInAsCaseworker(page);
  await expect(currentPersona(page)).toHaveText("Caseworker (current)");

  // `page.request` carries the browser's cookies, so this is the session cookie a same-site post would arrive
  // with — the whole of what Lax gives an attacker under `*.platform.hmcts.net`.
  const forged = await page.request.post(SWITCH_PATH, {
    headers: { "sec-fetch-site": "same-site" },
    form: { persona: "judge" },
    maxRedirects: 0
  });

  expect(forged.status()).toBe(403);
  // And the session is untouched: the refusal happens before the switch, not after it.
  await page.goto(CASE_LIST_PATH);
  await expect(currentPersona(page)).toHaveText("Caseworker (current)");
});

/**
 * The judicial area refused to a persona without the role, on every URL under it.
 *
 * The gate is mounted on the prefix in `src/app.ts` and fires before anything is resolved, so a referral id
 * that exists nowhere is refused identically to the pool — which is what stops the status code reporting
 * whether there was something there. **403 rendered on the 404 view** is `src/errors.ts`'s deliberate choice.
 */
async function expectJudicialAreaRefused(page: Page): Promise<void> {
  for (const path of [POOL_PATH, `${POOL_PATH}/00000000-0000-0000-0000-000000000000`]) {
    const response = await page.goto(path);

    expect(response?.status(), `${path} should be refused`).toBe(403);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
    await expect(page.locator("body")).not.toContainText("Referrals for a direction");
  }
}

/**
 * Everything the journey needs in the store before it signs in.
 *
 * **The case bodies go through `POST /__mock/cases` and the referrals through the contract routes**, which is
 * the split `deed-polls.spec.ts` and `judicial.spec.ts` both use and for its reason: what a create does is not
 * what is being tested here, but a referral's state is api's state machine, and a fixture that wrote `Claimed`
 * directly would teach this journey a visibility rule api's own rules cannot produce — which is the one rule
 * the discriminating assertion rests on.
 *
 * **The surname carries this run's identity**, because the mock's store is shared with every other spec and
 * outlives the run (`reuseExistingServer`): the list assertion is "one row", which an earlier run's copy of a
 * fixed surname would falsify. The two referral cases take a surname of their own so they are not on that row
 * count — they are never looked at through the list.
 *
 * Each case carries a display reference, since the list's Reference cell is a link and one with no text is an
 * accessibility violation on every list page the rest of the run renders. Three consecutive serials off the
 * clock, prefixed `0`: the other seeders' leading digits are 1 to 9, and the `0000n` serials the mock allocates
 * on a real create are the only other `0`-led shape.
 *
 * Received in August, so the dates collide with no other seeder's.
 */
async function seedPersonaFixtures(request: APIRequestContext): Promise<PersonaFixtures> {
  const token = Date.now().toString(36);
  const surname = `Personaby${token}`;
  const serial = Math.floor(Date.now() / 1000) % 10_000;
  const reference = (offset: number) => `KBDP2026-0${String((serial + offset) % 10_000).padStart(4, "0")}`;

  const listed = await seedCase(request, { newSurname: surname, displayReference: reference(0), dateReceived: "2026-08-01T00:00:00.000" });

  // Attributed to the caseworker, because the timeline is the office's record — and it is the note the
  // administrator is offered a delete button for two switches later.
  const note = "Applicant asked when the Gazette entry appears.";
  const created = await request.post(`${MOCK_API_URL}/caseworker/cases/${listed}/notes`, { headers: bearer(CASEWORKER_EMAIL), data: { note } });
  expect(created.status(), await created.text()).toBe(201);
  const noteId = (await created.json()).id;

  // Two more cases, because api allows a case only one live referral at a time.
  const held = await seedCase(request, {
    newSurname: `Otherby${token}`,
    displayReference: reference(1),
    dateReceived: "2026-08-02T00:00:00.000"
  });
  const taken = await seedCase(request, {
    newSurname: `Otherby${token}`,
    displayReference: reference(2),
    dateReceived: "2026-08-03T00:00:00.000"
  });

  return {
    surname,
    note,
    noteEditUrl: `${CASE_LIST_PATH}/${listed}/notes/${noteId}/edit`,
    ownReferralId: await seedClaimedReferral(request, held, JUDGE_EMAIL),
    otherReferralId: await seedClaimedReferral(request, taken, OTHER_JUDGE)
  };
}

/** A case in whatever state the seed asks for, and the id the journey navigates by. */
async function seedCase(request: APIRequestContext, fields: Record<string, string>): Promise<string> {
  const response = await request.post(`${MOCK_API_URL}/__mock/cases`, {
    data: { type: "Adult", state: "Received", newForename: "Ines", ...fields }
  });
  // Asserted, because a rejected seed leaves the journey looking for a case that was never created and the
  // failure surfaces several steps later as an empty list or a 404 that reads as a defect in the switcher.
  expect(response.status(), await response.text()).toBe(201);

  return (await response.json()).id;
}

/**
 * A referral raised on a case and claimed by a named judge — which is what puts it out of the pool and into
 * exactly one judge's hands.
 *
 * Standard rather than urgent, deliberately: `judicial.spec.ts` orders its own journey by being the only spec
 * raising urgent referrals, and both of these leave the pool the moment they are claimed anyway.
 */
async function seedClaimedReferral(request: APIRequestContext, caseId: string, judge: string): Promise<string> {
  const raised = await request.post(`${MOCK_API_URL}/caseworker/cases/${caseId}/referrals`, {
    headers: bearer(CASEWORKER_EMAIL),
    data: { reasons: ["Minor"] }
  });
  expect(raised.status(), await raised.text()).toBe(201);
  const referralId = (await raised.json()).id;

  const claimed = await request.post(`${MOCK_API_URL}${POOL_PATH}/${referralId}/claim`, { headers: bearer(judge) });
  expect(claimed.status(), await claimed.text()).toBe(200);

  return referralId;
}

/**
 * A bearer token carrying a subject and nothing else.
 *
 * The mock decodes the middle segment for a name and verifies no signature — `auditName` — so this is enough
 * to attribute a write, and it proves nothing about authentication. The tokens the *journey* sends are real
 * ones from the simulator, which is the whole subject of this file.
 */
function bearer(subject: string): Record<string, string> {
  const claims = Buffer.from(JSON.stringify({ sub: subject }), "utf8").toString("base64url");

  return { authorization: `Bearer x.${claims}.signature` };
}

/** The strip itself. Located by class: it is chrome with no landmark or accessible name of its own. */
function personaStrip(page: Page): Locator {
  return page.locator(".app-persona-switcher");
}

/**
 * The persona the strip says the session is, as text — "Judge (current)".
 *
 * The current persona is deliberately not a button (there is nothing to switch to), so there is no role to
 * address it by. Read as text rather than checked for a class, because the parenthesised word is how the state
 * reaches someone who cannot see the underline.
 */
function currentPersona(page: Page): Locator {
  return page.locator(".app-persona-switcher__current");
}

/**
 * One persona's switch button, by its accessible name.
 *
 * `exact` matters: the visually hidden prefix makes the names "Switch to Caseworker" and "Switch to Caseworker
 * with admin", and Playwright's default substring match would find both.
 */
function switchTo(page: Page, persona: string): Locator {
  return page.getByRole("button", { name: `Switch to ${persona}`, exact: true });
}

/** `canDeleteNote`'s button — the one control a Team leader has on the note form and a caseworker does not. */
function deleteNote(page: Page): Locator {
  return page.getByRole("button", { name: "Delete note" });
}

/**
 * A row of the referral's own summary list, the one under the "Referral" heading. Since the case's state was
 * relabelled Status (2026-10-22), the judicial application section above it has a "Status" row of its own.
 */
function referralRow(page: Page, key: string): Locator {
  const referralList = page.locator("xpath=//h2[normalize-space()='Referral']/following-sibling::dl[contains(@class,'govuk-summary-list')][1]");
  const keyCell = page.locator(".govuk-summary-list__key").filter({ hasText: exactText(key) });

  return referralList.locator(".govuk-summary-list__row").filter({ has: keyCell });
}

/** The whole of a cell's text, so a key never matches another key that merely contains it. */
function exactText(text: string): RegExp {
  return new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`);
}

/**
 * Checked inline at the points the journey already passes through, per `.claude/rules/e2e-testing.md`.
 *
 * **No exclusions**, as in the other two specs: every page here passes without them, and the strip — black
 * background, `govuk-button--inverse`, the Design System's own supported pairing — is included in each of these
 * checks rather than waived. Adding a waiver is a change to this function, which is where the evidence for one
 * belongs.
 */
async function expectNoAccessibilityViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();

  expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target).join(", ")}`)).toEqual([]);
}

/** What the journey needs seeded: one case to find, a note on it, and two referrals in different hands. */
interface PersonaFixtures {
  /** Unique to this run, so the list assertion can be "one row". */
  surname: string;
  note: string;
  noteEditUrl: string;
  /** Claimed by `judge@example.com` before the switch, so only a genuine judge token can read it. */
  ownReferralId: string;
  /** Claimed by somebody else, so no token this switcher can obtain may read it. */
  otherReferralId: string;
}
