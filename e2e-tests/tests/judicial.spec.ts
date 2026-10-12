/**
 * The judicial persona, end to end in a browser — `docs/plans/completed/referrals-admin-3-judicial-screen.md`.
 *
 * **Two tests: the judge's whole day, and the caseworker who must not have it.** The journey is one story —
 * land on the pool, open a referral, read the application, claim it, direct it through check-your-answers — so
 * the validation, accessibility and Welsh checks are made at the points it already passes through, per
 * `.claude/rules/e2e-testing.md`.
 *
 * **What only a browser can show here, and why this file earns its keep:**
 *
 * - **The persona boundary is real.** The page tests never ask about the role — the gate is mounted on the area
 *   in `app.ts`, not written into any page — so an ungated judicial page and a gated one render identically
 *   under test. `src/app.test.ts` pins the mount from the filesystem; this pins that a signed-in administrator
 *   actually gets a refusal from the running app.
 * - **The three-step direction flow carries its state through the request and nothing else.** The check step is
 *   rendered from the values it was posted and "Change your answers" is a submit, not a link (decision 7). A
 *   `vi.fn()` cannot show that the second round trip arrives with what the first one held; a form and a browser
 *   can.
 * - **The claim race is a refusal a judge reads, not a fault.** api checks visibility before the hold, so a
 *   referral taken out from under this judge is a **404** — rendered as decision 10's "no longer available",
 *   never as "somebody else has it". The journey takes one out from under itself to prove the copy.
 * - **The disclosure boundary, asserted from outside.** The case is seeded carrying a fee reference; the judicial
 *   screen must not contain it. That is api's boundary rather than this app's (decision 4), and this is the check
 *   that the whole rendered page — not just the view model — honours it.
 *
 * The judge signs in as `judge@example.com`, the only fixture holding `caseworker-deedpoll-judicial` and
 * deliberately holding nothing else. `yarn idam:users` seeds it; `idam-access-config#995` is what makes the role
 * assignable in AAT and is not needed here, because nothing local reads that repo.
 */
import { AxeBuilder } from "@axe-core/playwright";
import { type APIRequestContext, type Browser, expect, type Locator, type Page, test } from "@playwright/test";
import {
  CASEWORKER_EMAIL,
  DEPLOYED_STACK_SKIP_REASON,
  JUDGE_EMAIL,
  JUDGE_STORAGE_STATE,
  RUNS_AGAINST_DEPLOYED_STACK,
  signInAsJudge,
  TEAM_LEADER_STORAGE_STATE
} from "./idam-session.js";

/** The mock api, which `playwright.config.ts` starts on 3200 beside the app on 3000. */
const MOCK_API_URL = process.env.DEED_POLL_API_URL ?? "http://localhost:3200";

const POOL_PATH = "/judicial/referrals";

/** The judge's own list — `referrals-admin-6`, and a literal segment rather than a referral id. */
const MINE_PATH = "/judicial/referrals/mine";

/** Where a caseworker's day starts, and where the office half of the lifecycle journey happens. */
const CASE_LIST_PATH = "/deed-polls";

/** api's `JudicialReferralService.POOL_PAGE_SIZE`, which the pool page renders and pages by. */
const POOL_PAGE_SIZE = 10;

/**
 * The other judge, who takes a referral out from under this one.
 *
 * Not a signed-in session and deliberately not the `judge@example.com` fixture: the point is a *different*
 * holder, which is what makes api's answer a 404 rather than a 409. The mock reads the subject out of the bearer
 * token and models no roles, so a hand-built token is all a claim needs — the same construction
 * `deed-polls.spec.ts` uses for its seed judge.
 */
const OTHER_JUDGE = "e2e.otherjudge@example.com";

test.skip(RUNS_AGAINST_DEPLOYED_STACK, DEPLOYED_STACK_SKIP_REASON);
test.use({ storageState: JUDGE_STORAGE_STATE });

test("judge works the pool: opens a referral, is beaten to one, claims another and directs it", async ({ page, browser, request }) => {
  // Arrange: two applications, each with an urgent referral waiting. Two cases rather than two referrals on one,
  // because api allows a case only one live referral at a time.
  //
  // **Urgent, and that is what keeps this journey's rows findable.** The pool is ordered urgent-first then
  // longest-waiting within the band, so a referral raised later sorts *after* one raised earlier and cannot move
  // it: nothing another worker raises — including the urgent referral the lifecycle journey below seeds — changes
  // the position of a row already in the urgent band while this test is reading it.
  const beaten = await seedReferral(request, { reason: "DomesticAbuse" });
  const mine = await seedReferral(request, { reason: "NonPublication", note: "Applicant asked for the hearing to be listed early." });

  // The pool is the judge's home, reached from `/` rather than by URL: the redirect is decision 2, and the
  // sign-in half of it is asserted in `signInAsJudge`.
  await page.goto("/");
  await expect(page).toHaveURL(POOL_PATH);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Referrals for a direction");
  // States the order instead of offering a control over it — there is no filter bar, search or sortable header
  // on this page, because the queue is api's (decision 3).
  await expect(page.getByText("The most urgent referrals are first, then those waiting longest.")).toBeVisible();
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  // api's count off the paging envelope, not a count of the ten rows on screen.
  //
  // Re-read on each attempt rather than compared once, because the pool is shared and global: `deed-polls.spec`
  // raises and withdraws referrals in a parallel worker, so api's total can move either way between a render and
  // an assertion about it. Reloading inside the poll makes the two sides of the comparison the same moment.
  // The two numbers are compared by backreference rather than by equality so a failure prints both of them, and
  // so the assertion does not pin a page size or a total this journey does not control.
  await expect
    .poll(async () => {
      await page.reload();
      const summary = (await page.getByText(/of \d+ referrals/).textContent())?.trim();

      return `${summary} / api total ${await poolTotal(request)}`;
    })
    .toMatch(/of (\d+) referrals \/ api total \1$/);
  await expectNoAccessibilityViolations(page);

  // Checked here rather than at the end of the journey, and the position is load-bearing twice over: the pool's
  // column headers only exist while something is waiting in it, and by the end this journey has taken both of its
  // own referrals out — leaving a page whose `cy` keys are the empty state's instead of the table's. The referral
  // it also visits has to still be `Open`, for the reason api narrows a claimed one to its holder.
  await expectWelshKeysResolve(browser, mine.referralId);

  // The row, and its cells: the urgency word (never the tag colour alone), the business's wording for the reason
  // the court picked, and the wait the queue is ordered by.
  const beatenRow = await poolRow(page, request, beaten.referralId);
  await expect(beatenRow).toContainText("Urgent");
  await expect(beatenRow).toContainText("Domestic abuse considerations");
  await expect(beatenRow).toContainText(beaten.waitingSince);
  // No applicant and no reference anywhere in the queue — api's pool row carries neither, so a judge cannot read
  // a list of applications they have not been asked to look at (api-3 decision 2).
  await expect(page.locator("tbody")).not.toContainText(beaten.reference);

  await beatenRow.getByRole("link").click();
  await expect(page).toHaveURL(`${POOL_PATH}/${beaten.referralId}`);
  await expect(claimButton(page)).toBeVisible();
  await expect(directButton(page)).toHaveCount(0);

  // The race, made deterministic: another judge claims it while this one is looking at the page. The claim
  // control is still on screen, which is the situation the refusal exists for.
  await claimAs(request, beaten.referralId, OTHER_JUDGE);

  await claimButton(page).click();

  // Back to the pool, because that is where the next piece of work is — and the sentence is decision 10's. It
  // must not say or imply who has it: api answers withdrawn, closed, somebody else's and never-there
  // identically, and a message that guessed would enumerate exactly what that hides.
  await expect(page).toHaveURL(`${POOL_PATH}?claim=unavailable`);
  const refusal = page.getByRole("alert");
  await expect(refusal).toContainText("This referral is no longer available. Choose another referral from the list.");
  await expect(refusal).not.toContainText(OTHER_JUDGE);
  await expect(refusal).not.toContainText("another judge");
  await expectNoAccessibilityViolations(page);

  // And the stale link the judge may still be holding — a bookmark, or the back button — is its own page rather
  // than the shared "Page not found", because following a pool that has moved on is not a mistyped URL. **404
  // and not 403**: the resource is genuinely gone, and a 200 would say the page rendered what was asked for.
  const stale = await page.goto(`${POOL_PATH}/${beaten.referralId}`);
  expect(stale?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This referral is no longer available");
  await expect(page.locator("body")).not.toContainText(OTHER_JUDGE);
  await expectNoAccessibilityViolations(page);
  await page.getByRole("link", { name: "Back to referrals for a direction" }).click();
  await expect(page).toHaveURL(POOL_PATH);

  // On to one nobody has taken.
  await (await poolRow(page, request, mine.referralId)).getByRole("link").click();
  await expect(page).toHaveURL(`${POOL_PATH}/${mine.referralId}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Referral to the judiciary");

  // The narrow application view — `JudicialCaseView`, and exactly that. Both names in full, because a deed poll
  // is about the whole name and showing the parts separately hides which one moved.
  await expect(summaryRow(page, "Reference")).toContainText(mine.reference);
  await expect(summaryRow(page, "Application type")).toContainText("Adult");
  await expect(summaryRow(page, "Current name")).toContainText("Ines Kowalski");
  await expect(summaryRow(page, "New name")).toContainText("Ines Nakamura");

  // **The disclosure check, from outside the view model.** The case carries a fee reference; the judicial screen
  // must not. api's DTO is what keeps it off — not a filter here (decision 4) — so this asserts the boundary
  // holds all the way to the rendered page, and it is the one assertion in this file whose failure is a
  // disclosure bug rather than a display one.
  await expect(page.locator("body")).not.toContainText(mine.feeReference);

  // The referral's own fields, and the application's timeline read-only beside them.
  await expect(summaryRow(page, "Status")).toContainText("Open");
  await expect(summaryRow(page, "Reasons for referral")).toContainText("Non-publication request");
  await expect(summaryRow(page, "Notes from the court")).toContainText("Please consider the applicant's circumstances.");
  await expect(summaryRow(page, "Reason for urgency")).toContainText("Hearing listed on Friday.");
  await expect(page.getByRole("heading", { name: "Case notes" })).toBeVisible();

  // **Two entries, newest first, and only one of them was typed by anybody.** api writes a case note at each
  // successful referral transition (`referrals-admin-5`), so the raise the office made is on the timeline above
  // the note they wrote by hand — and both are attributed to the caseworker, which is why each entry is addressed
  // by position rather than by its author: the same name now captions more than one.
  const notes = caseNotes(page);
  await expect(notes).toHaveCount(2);
  await expect(notes.nth(0)).toContainText("Referred to the judiciary. Reasons: NonPublication.");
  // The caseworker's own two sentences on their own lines, which is api's composer rather than this page's doing —
  // and the reason a judge reading the timeline learns why the office called it urgent.
  await expect(notes.nth(0)).toContainText("Marked urgent: Hearing listed on Friday.");
  await expect(notes.nth(0)).toContainText(CASEWORKER_EMAIL);
  await expect(notes.nth(1)).toContainText("Applicant asked for the hearing to be listed early.");
  await expect(notes.nth(1)).toContainText(CASEWORKER_EMAIL);
  // A judge's writes are exactly claim and direct, so there is no note control — and no link to the case,
  // because api's judicial surface takes no case id and there is nowhere to link to.
  await expect(page.getByRole("button", { name: "Add a note" })).toHaveCount(0);
  await expect(page.locator('a[href^="/deed-polls"]')).toHaveCount(0);
  await expectNoAccessibilityViolations(page);

  await claimButton(page).click();

  // The referral view re-reads it, so the state on screen is the one api has just published rather than one
  // assumed by the handler that did the claiming.
  await expect(page).toHaveURL(`${POOL_PATH}/${mine.referralId}`);
  await expect(summaryRow(page, "Status")).toContainText("Claimed");
  await expect(summaryRow(page, "Claimed")).toBeVisible();
  await expect(claimButton(page)).toHaveCount(0);
  await expect(directButton(page)).toBeVisible();

  // **Claiming twice — two tabs, or back-then-resubmit — and the one 409 a claim can produce.** api checks
  // visibility before state, so a referral another judge took is the 404 above; this judge can still see this one
  // and cannot claim it, which leaves only "it is already theirs". Posted through the app with the browser's
  // session rather than driven through the button, which is gone the moment the claim succeeds. It must land on
  // the referral and not the pool — the referral has left that list — and the sentence must name the state: an
  // "already been claimed" bounce to the pool would tell a judge somebody else has work that is in fact theirs.
  const reclaim = await page.request.post(`${POOL_PATH}/${mine.referralId}/claim`, { maxRedirects: 0 });
  expect(reclaim.status()).toBe(302);
  expect(reclaim.headers().location).toBe(`${POOL_PATH}/${mine.referralId}?claim=held`);

  await page.goto(`${POOL_PATH}/${mine.referralId}?claim=held`);
  const reclaimRefusal = page.getByRole("alert");
  await expect(reclaimRefusal).toContainText("This referral is not waiting to be claimed.");
  await expect(reclaimRefusal).not.toContainText("already been claimed");
  await expect(reclaimRefusal).not.toContainText("another judge");
  // Still theirs, and still directable: the refusal is a correction to the request, not to the state below it.
  await expect(summaryRow(page, "Status")).toContainText("Claimed");
  await expect(directButton(page)).toBeVisible();
  await expectNoAccessibilityViolations(page);

  await directButton(page).click();
  await expect(page).toHaveURL(`${POOL_PATH}/${mine.referralId}/direction`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Record a direction");
  // The reference captions the form, because a judge must see which application they are directing before they
  // attest to it — and it is on `JudicialCaseView`, so it is theirs to see.
  await expect(page.locator(".govuk-caption-l")).toHaveText(mine.reference);

  // **Neither pair of radios defaults.** A pre-selected Gazette answer would be this page deciding publication
  // on the judge's behalf, which is the one call api-2 decision 6 puts in their hands — and it is only visible
  // here, before anything has been submitted.
  await expect(page.getByRole("radio", { checked: true })).toHaveCount(0);
  await expectNoAccessibilityViolations(page);

  // Nothing answered: two questions, two messages, both linked from the summary to the control they belong to.
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert")).toContainText("There is a problem");
  const decisionError = page.getByRole("link", { name: "Select whether the application is approved or rejected" });
  await expect(decisionError).toHaveAttribute("href", "#decision");
  await expect(page.getByRole("link", { name: "Select whether this direction is published in the Gazette" })).toHaveAttribute("href", "#publishToGazette");
  // Still the form, not the check step: nothing can be attested to that has not been answered.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Record a direction");
  await expectNoAccessibilityViolations(page);

  await fillDirection(page, { decision: "Approved", directions: "Approved on the papers. Publish in the usual way.", gazette: "Yes" });
  await page.getByRole("button", { name: "Continue" }).click();

  // Check your direction — the attestation step, and the answers read back in the judge's own words.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Check your direction");
  await expect(summaryRow(page, "Decision")).toContainText("Approved");
  await expect(summaryRow(page, "Directions")).toContainText("Approved on the papers. Publish in the usual way.");
  await expect(summaryRow(page, "Published in the Gazette")).toContainText("Yes");
  // The declaration is above the submit and pressing the button is the attestation — the Design System's
  // check-answers pattern, not a tick box in front of a button that already confirms.
  await expect(page.getByText("By recording this direction you confirm it is your direction on this application.")).toBeVisible();
  await expect(page.getByText("You cannot change a direction once it is recorded.")).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expectNoAccessibilityViolations(page);

  // **Change is a submit, and this is the assertion that the state travels in the request.** Nothing is stored
  // between the two steps — no draft, client or server (decision 7) — so a link back to the form would arrive
  // empty. Re-posting the three fields is what brings them back, and the form must not be marked up with errors
  // for a direction the judge has already said they want to change.
  await page.getByRole("button", { name: "Change your answers" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Record a direction");
  await expect(page.getByRole("radio", { name: "Approved" })).toBeChecked();
  await expect(page.getByLabel("Directions (optional)")).toHaveValue("Approved on the papers. Publish in the usual way.");
  await expect(gazetteAnswer(page, "Yes")).toBeChecked();
  await expect(page.getByRole("alert")).toHaveCount(0);

  // Rejected instead, so what is recorded is the answer given last rather than the one the flow started with.
  await page.getByRole("radio", { name: "Rejected" }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(summaryRow(page, "Decision")).toContainText("Rejected");

  await page.getByRole("button", { name: "Confirm and record the direction" }).click();

  // One atomic call, and back to the referral it was recorded against — the banner explains why the state has
  // changed, and the direction below it is the change.
  await expect(page).toHaveURL(`${POOL_PATH}/${mine.referralId}?direction=recorded`);
  // `role="alert"` rather than the `region` a default notification banner carries: `govukNotificationBanner`
  // swaps the role for `type: "success"`, so the recorded direction is announced rather than merely present.
  await expect(page.getByRole("alert")).toContainText("Your direction has been recorded.");
  await expect(summaryRow(page, "Status")).toContainText("Decided");
  await expect(page.getByRole("heading", { name: "Direction recorded" })).toBeVisible();
  await expect(summaryRow(page, "Decision")).toContainText("Rejected");
  await expect(summaryRow(page, "Directions")).toContainText("Approved on the papers. Publish in the usual way.");
  await expect(summaryRow(page, "Published in the Gazette")).toContainText("Yes");
  // Neither control applies to a decided referral, and both are absent from the markup rather than disabled —
  // the shape every other refusal in this app takes.
  await expect(claimButton(page)).toHaveCount(0);
  await expect(directButton(page)).toHaveCount(0);
  await expectNoAccessibilityViolations(page);

  // And it has left the shared pool, which is what a claim and a direction are for.
  await page.goto(POOL_PATH);
  await expect(page.locator(`a[href="${POOL_PATH}/${mine.referralId}"]`)).toHaveCount(0);
});

/**
 * The journey business testing found broken, end to end — `docs/plans/referrals-admin-6-judicial-my-referrals.md`.
 *
 * **One test, because it is one referral's life.** A judge claims it, loses sight of it, finds it again on **My
 * referrals**, directs it, and the row goes when the office actions the direction. The journey above ends where the
 * feedback began: a successful claim takes a referral off the pool, which was the only judicial list, so a judge
 * who navigated away could reach it again only through browser history or a remembered UUID.
 *
 * **What only a browser can show here, and it is decision 1 rather than any single page's rendering:**
 *
 * - **"Mine" survives the session becoming somebody else and back.** api answers it from the token's IDAM
 *   subject, so the list is the same after a round trip through the caseworker persona — which is exactly what a
 *   list derived from session state, from browser history or from rows previously seen could not manage. A unit
 *   test cannot tell the two implementations apart: both return the same rows for a session that never changed.
 * - **The two lists agree about which one a referral is on.** The claim removes the row from the pool and the
 *   detail page's own link changes to name the other list in the same request. Rendering either half alone passes
 *   with the other half wrong, and a judge sent "back" to a list their referral has left is this plan's bug
 *   arriving from the other direction.
 * - **Terminal removal is cross-persona.** The row leaves only when a *caseworker* marks the direction actioned,
 *   so nothing the judge's own session does can be what removes it.
 *
 * **It signs itself in and must keep doing so.** Do not give it `JUDGE_STORAGE_STATE`: a persona switch calls
 * `signIn`, which regenerates the session id and destroys the server-side session behind the restored cookie — so
 * the journey above, which shares that state, would be signed out mid-run and the symptom would be a timeout on an
 * unrelated locator. `persona-switcher.spec.ts` records the same reasoning at length.
 *
 * The personas are the same IDAM users the fixtures are, so switching to **Judge** returns to
 * `judge@example.com` — the subject that claimed the referral. `PERSONA_SWITCHER_ENABLED=true` on
 * `dev:nowatch:web` is what makes the strip render at all.
 */
test.describe("across the two judicial lists and both personas", () => {
  test.use({ storageState: undefined });

  test("a judge claims a referral, finds it again on My referrals, directs it, and loses the row when the office actions it", async ({ page, request }) => {
    // **The storage-state opt-out, asserted rather than assumed.** A context that had restored the shared judge
    // session would still land on the pool from `/login` — `signInAsJudge` would pass — and the first persona
    // switch would then destroy a session the journey above is using. That failure appears in another file, so it
    // is pinned here, where the decision is.
    expect(await page.context().cookies()).toEqual([]);

    // One urgent referral waiting, and the case behind it: the office half of this journey needs the case id,
    // because api's judicial surface carries none (api-3 decision 2).
    const seeded = await seedReferral(request, { reason: "Minor" });

    await signInAsJudge(page);

    // Decision 4's navigation, on the page a judge lands on: both destinations named, and the one they are on
    // marked with `aria-current` rather than by weight alone — the state has to reach somebody who cannot see the
    // underline.
    const nav = page.getByRole("navigation", { name: "Referral lists" });
    await expect(navLink(page, "Referrals for a direction")).toHaveAttribute("aria-current", "page");
    await expect(navLink(page, "My referrals")).toHaveAttribute("href", MINE_PATH);
    await expect(navLink(page, "My referrals")).not.toHaveAttribute("aria-current", "page");

    await (await poolRow(page, request, seeded.referralId)).getByRole("link").click();
    await claimButton(page).click();

    await expect(page).toHaveURL(`${POOL_PATH}/${seeded.referralId}`);
    await expect(summaryRow(page, "Status")).toContainText("Claimed");
    // Decision 5, and the first half of the fix: the referral has left the pool, so the way back cannot be the
    // pool. The link is resolved from the state api published a moment ago, not from where the judge came from.
    await expect(page.getByRole("link", { name: "Back to My referrals" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to referrals for a direction" })).toHaveCount(0);

    // **Navigating away is the whole of the original defect.** The pool no longer has it, and before this plan
    // nothing else did.
    await page.goto(POOL_PATH);
    await expect(page.locator(`a[href="${POOL_PATH}/${seeded.referralId}"]`)).toHaveCount(0);

    // Recovered from the page the judge is standing on, by keyboard: the navigation is a list of links, so this is
    // also what shows there is no keyboard trap between the two lists.
    await navLink(page, "My referrals").focus();
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(MINE_PATH);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("My referrals");
    await expect(navLink(page, "My referrals")).toHaveAttribute("aria-current", "page");
    await expect(navLink(page, "Referrals for a direction")).not.toHaveAttribute("aria-current", "page");
    // Says what the two statuses mean and what takes a row off the list, because both are surprising otherwise.
    await expect(page.getByText("A referral stays here until the court has actioned your direction")).toBeVisible();
    // api's queue, so there is nothing to compose: no filter bar, no search and no sortable headers (decision 2).
    await expect(page.getByRole("searchbox")).toHaveCount(0);
    await expect(nav.getByRole("link")).toHaveCount(2);

    const claimed = await myReferralsRow(page, request, seeded.referralId);
    // The judge's own two words, not the caseworker's "With a judge": what they still owe, and what they have
    // answered. The urgency word is printed and not left to the tag colour.
    await expect(claimed).toContainText("Direction needed");
    await expect(claimed).toContainText("Urgent");
    await expect(claimed).toContainText("Applicant is a minor");
    await expect(claimed).toContainText(seeded.waitingSince);
    await expectNoApplicationData(page, seeded);
    await expectNoAccessibilityViolations(page);

    // **The other rendering this page has.** A judge holding nothing is the ordinary state at the start of a day,
    // but it cannot be arranged here — the mock's store is shared with every other spec and outlives the run, so
    // `judge@example.com` holds whatever earlier claims are still open. A page past the end reaches the same
    // branch, which is what the axe check needs: no table, and a sentence instead. The sentence itself is
    // `mine.njk.test.ts`'s, since on page 99 it is true of the page rather than of the judge.
    await page.goto(`${MINE_PATH}?page=99`);
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("My referrals");
    await expect(navLink(page, "My referrals")).toHaveAttribute("aria-current", "page");
    await expectNoAccessibilityViolations(page);

    // ── to the caseworker and back, which is decision 1 asserted from outside ──────────────────────────────────
    // A session that has been another identity and come back must get the same list, because the list is api's
    // answer about a token and not this app's memory of anything.
    await switchTo(page, "Caseworker").click();
    await expect(page).toHaveURL(CASE_LIST_PATH);
    // Decision 4 from the other side, on the one page it could have leaked onto: the navigation is local to the two
    // judicial lists, so a caseworker is offered no door the `/judicial/**` gate would then shut.
    await expect(page.locator(`a[href^="${POOL_PATH}"]`)).toHaveCount(0);
    await switchTo(page, "Judge").click();
    await expect(page).toHaveURL(POOL_PATH);

    const recovered = await myReferralsRow(page, request, seeded.referralId);
    await expect(recovered).toContainText("Direction needed");

    await recovered.getByRole("link").click();
    await expect(page).toHaveURL(`${POOL_PATH}/${seeded.referralId}`);
    await expect(summaryRow(page, "Status")).toContainText("Claimed");

    // The direction, in the fewest steps that reach it: the form, the check step and the attestation are the
    // journey above's subject, and repeating their assertions here would pin them twice.
    await directButton(page).click();
    await fillDirection(page, { decision: "Approved", directions: "Approved on the papers.", gazette: "Yes" });
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Confirm and record the direction" }).click();

    await expect(page).toHaveURL(`${POOL_PATH}/${seeded.referralId}?direction=recorded`);
    await expect(summaryRow(page, "Status")).toContainText("Decided");
    // Still the judge's own work until the office has acted on it, so the way back is still My referrals — the
    // state decides the destination, and `Decided` is on that list too.
    await page.getByRole("link", { name: "Back to My referrals" }).click();
    await expect(page).toHaveURL(MINE_PATH);

    const decided = await myReferralsRow(page, request, seeded.referralId);
    await expect(decided).toContainText("Direction recorded");
    await expectNoApplicationData(page, seeded);
    await expectNoAccessibilityViolations(page);
    // Which page it was on, read off the URL `myReferralsRow` navigated to: after the closure the row is gone, and
    // a removal can only pull the rows behind it earlier — so pages 1 to this one are where it could still appear.
    const wasOnPage = Number(new URL(page.url()).searchParams.get("page"));

    // ── the office actions the direction, which is the only thing that removes the row ─────────────────────────
    await switchTo(page, "Caseworker").click();
    await page.goto(`${CASE_LIST_PATH}/${seeded.caseId}/referrals/${seeded.referralId}`);

    // The same referral in the caseworker's vocabulary, which is the other half of `referrals-admin-4`: a judge
    // reads what they still owe, the office reads what it has been sent.
    await expect(summaryRow(page, "Referral status")).toContainText("Direction received");
    await page.getByRole("button", { name: "Mark direction as actioned" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Confirm the direction has been actioned");
    await page.getByRole("button", { name: "Mark direction as actioned" }).click();

    await expect(page).toHaveURL(`${CASE_LIST_PATH}/${seeded.caseId}/referrals/${seeded.referralId}?close=actioned`);
    await expect(page.getByRole("alert")).toContainText("The direction has been marked as actioned.");

    // ── back as the judge, and the row has gone ────────────────────────────────────────────────────────────────
    await switchTo(page, "Judge").click();

    for (let number = 1; number <= wasOnPage; number++) {
      await page.goto(`${MINE_PATH}?page=${number}`);
      await expect(page.locator(`a[href="${POOL_PATH}/${seeded.referralId}"]`), `My referrals page ${number}`).toHaveCount(0);
    }

    // Out of sight entirely rather than merely off a list, which is what makes the removal api's membership rule
    // and not a display choice: a closed referral is the same 404 as one that never existed, and the page says so
    // without saying who had it.
    const gone = await page.goto(`${POOL_PATH}/${seeded.referralId}`);
    expect(gone?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("This referral is no longer available");
    await expect(page.locator("body")).not.toContainText(CASEWORKER_EMAIL);
    // A refused read publishes no state, so there is no list to claim it is on and this page returns to the pool —
    // decision 5's last case, and the reason it is not a guess at My referrals.
    await page.getByRole("link", { name: "Back to referrals for a direction" }).click();
    await expect(page).toHaveURL(POOL_PATH);
  });
});

/**
 * The persona boundary, from the other side.
 *
 * **The administrator rather than the roleless caseworker, deliberately.** `caseworker-deedpoll-admin` is the
 * most privileged account this service has, and the mistake worth pinning is the assumption that it is a
 * superset — `currentUser` sets `isJudicial` as an alternative to `isAdmin`, not a level below it. The roleless
 * caseworker is refused a fortiori, and both directions of the middleware itself are unit-tested in
 * `src/auth/require-role.test.ts`; what needs a browser is that the gate is *mounted* on the running app.
 *
 * Its own `describe` because that is the only place Playwright honours a second `test.use` in one file.
 */
test.describe("without the judicial role", () => {
  test.use({ storageState: TEAM_LEADER_STORAGE_STATE });

  test("administrator is refused the judicial area and is not sent to it", async ({ page }) => {
    // `/` resolves the persona, and an administrator's is the case list — a judge's pool is not one link away
    // from it, because the judicial lists' navigation renders only on pages inside the judicial area and the
    // caseworker chrome has nothing to put such a link in (admin-3 decision 8, still true after admin-6).
    await page.goto("/");
    await expect(page).toHaveURL("/deed-polls");
    await expect(page.locator(`a[href^="${POOL_PATH}"]`)).toHaveCount(0);

    // Every judicial URL, including one naming a referral id that exists nowhere: the gate is the area's and
    // fires before anything is resolved, so the refusal is 403 rather than a 404 that would say whether there
    // was something there. The 404 *view* on a 403 status is `src/errors.ts`'s deliberate choice.
    for (const path of [
      POOL_PATH,
      `${POOL_PATH}?page=2`,
      // The judge's own list is gated by the area it lives in and not by anything in the page, so it is on this
      // list for the same reason the pool is: nothing in `mine.ts` asks about the role, and an ungated build would
      // render it to this administrator identically.
      MINE_PATH,
      `${MINE_PATH}?page=2`,
      `${POOL_PATH}/00000000-0000-0000-0000-000000000000`,
      `${POOL_PATH}/00000000-0000-0000-0000-000000000000/direction`
    ]) {
      const response = await page.goto(path);

      expect(response?.status(), `${path} should be refused`).toBe(403);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
      // Nothing from the judicial chrome reaches them, which is the whole of the persona split — neither list's
      // heading and neither of the navigation's two labels.
      await expect(page.locator("body")).not.toContainText("Referrals for a direction");
      await expect(page.locator("body")).not.toContainText("My referrals");
    }
  });
});

/**
 * An application with an urgent referral waiting on it, and the facts the journey needs back.
 *
 * **The case goes through `POST /__mock/cases` and the referral through the contract route**, which is the split
 * `deed-polls.spec.ts` uses and for its reason: what a create does is not what is being tested here, but a
 * referral's state is api's state machine and a fixture that wrote it directly would teach this screen a pool
 * api's own rules cannot produce.
 *
 * **The names, reference and fee reference are unique per call**, because the mock's store is shared with every
 * other spec in the run and outlives the run itself — `reuseExistingServer`. The fee reference in particular has
 * to be unique: the disclosure assertion is "this string is nowhere on the page", which an earlier run's copy of
 * a fixed value could not falsify but a *shared* value in some other case's row could.
 *
 * Received in July, so the dates collide with no other seeder's.
 */
async function seedReferral(request: APIRequestContext, options: { reason: string; note?: string }): Promise<SeededReferral> {
  const token = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const reference = `KBDP2026-${String(Math.floor(Math.random() * 10_000)).padStart(4, "0")}`;
  const feeReference = `FEE-${token}`;

  const created = await request.post(`${MOCK_API_URL}/__mock/cases`, {
    data: {
      type: "Adult",
      state: "Received",
      displayReference: reference,
      dateReceived: "2026-07-01T00:00:00.000",
      oldForename: "Ines",
      oldSurname: "Kowalski",
      newForename: "Ines",
      newSurname: "Nakamura",
      // The field the judicial screen must not show. Seeded rather than assumed absent, so the assertion has
      // something real to fail against.
      feeReference
    }
  });
  // Asserted, because a rejected seed leaves the journey looking for a row that was never created and the
  // failure surfaces several steps later as an empty pool.
  expect(created.status(), await created.text()).toBe(201);
  const caseId = (await created.json()).id;

  if (options.note) {
    // Attributed to the caseworker, because the timeline is the office's record and the judge reads the author.
    const noted = await request.post(`${MOCK_API_URL}/caseworker/cases/${caseId}/notes`, {
      headers: bearer(CASEWORKER_EMAIL),
      data: { note: options.note }
    });
    expect(noted.status(), await noted.text()).toBe(201);
  }

  const raised = await request.post(`${MOCK_API_URL}/caseworker/cases/${caseId}/referrals`, {
    headers: bearer(CASEWORKER_EMAIL),
    data: {
      reasons: [options.reason],
      notes: "Please consider the applicant's circumstances.",
      // Urgent so the pool's order cannot move this row underneath the test — see the arrangement comment in
      // the journey.
      urgency: "Urgent",
      urgencyReason: "Hearing listed on Friday."
    }
  });
  expect(raised.status(), await raised.text()).toBe(201);
  const referral = await raised.json();

  return { caseId, referralId: referral.id, reference, feeReference, waitingSince: formatTimestamp(referral.createdOn) };
}

/** How many referrals api has waiting for a direction — the number the pool's summary states. */
async function poolTotal(request: APIRequestContext): Promise<number> {
  const response = await request.get(`${MOCK_API_URL}${POOL_PATH}?size=1`);
  expect(response.status(), await response.text()).toBe(200);

  return (await response.json()).total;
}

/**
 * One referral's row in the pool, having navigated to the page it is on.
 *
 * **Located by the row's link `href`, which is the one thing that identifies it.** A pool row carries no
 * reference and no applicant by api's decision 2, and its other three cells — an urgency, a set of reasons and a
 * formatted minute — are shared with every other row this file seeds. There is nothing for `getByRole` to bind
 * to that is unique, so the href is not a fallback here but the actual key.
 *
 * **The page comes from api rather than from a walk of the pagination**, because the pool is shared and global:
 * `yarn mock:seed` and every earlier local run leave referrals in it, so page 1 is not where this journey's row
 * is. Asking api which page it is on is the same question the UI's own paging answers, and it keeps the journey
 * from clicking Next an unbounded number of times.
 */
async function poolRow(page: Page, request: APIRequestContext, referralId: string): Promise<Locator> {
  const wanted = await poolPageOf(request, referralId);
  if (new URL(page.url()).searchParams.get("page") !== String(wanted)) {
    await page.goto(`${POOL_PATH}?page=${wanted}`);
  }

  const row = page.locator("tbody tr").filter({ has: page.locator(`a[href="${POOL_PATH}/${referralId}"]`) });
  await expect(row, `referral ${referralId} should be on pool page ${wanted}`).toHaveCount(1);

  return row;
}

/**
 * One referral's row on **My referrals**, having navigated to the page it is on.
 *
 * `poolRow`'s reasoning — the row's link `href` is the only thing that identifies it, because api's summary carries
 * no reference and no applicant — and one more of its own: this list is keyed on the judge's own subject, so every
 * claim `judge@example.com` still holds is on it. The mock's store outlives the run (`reuseExistingServer`), so
 * after a few local runs page 1 is not where this journey's row is.
 *
 * Asking api which page holds it is the same question the UI's own paging answers, and it keeps the journey from
 * clicking Next an unbounded number of times.
 */
async function myReferralsRow(page: Page, request: APIRequestContext, referralId: string): Promise<Locator> {
  const wanted = await myReferralsPageOf(request, referralId);
  await page.goto(`${MINE_PATH}?page=${wanted}`);

  const row = page.locator("tbody tr").filter({ has: page.locator(`a[href="${POOL_PATH}/${referralId}"]`) });
  await expect(row, `referral ${referralId} should be on My referrals page ${wanted}`).toHaveCount(1);

  return row;
}

/**
 * Which page of the judge's own list holds a referral, read off api at the page size the UI renders.
 *
 * **Asked with a forged token rather than the browser's**, which is safe for the reason `bearer` gives and is the
 * one thing that makes this the same list: the mock keys ownership on the token's `sub`, and `JUDGE_EMAIL` is the
 * subject the simulator's real token carries. api takes no owner parameter, so there is no other way to ask about
 * a particular judge's list and deliberately so — see the mock's `myReferrals`.
 */
async function myReferralsPageOf(request: APIRequestContext, referralId: string): Promise<number> {
  for (let page = 1; ; page++) {
    const response = await request.get(`${MOCK_API_URL}${MINE_PATH}?page=${page}&size=${POOL_PAGE_SIZE}`, { headers: bearer(JUDGE_EMAIL) });
    expect(response.status(), await response.text()).toBe(200);
    const mine = await response.json();

    if (mine.referrals.some((referral: { id: string }) => referral.id === referralId)) return page;
    // `totalPages` rather than an empty page, so a list that grows under this loop cannot make it run on.
    if (page >= mine.totalPages) throw new Error(`referral ${referralId} is not on the judge's own list (${mine.total} held)`);
  }
}

/** Which page of the pool holds a referral, read off api at the page size the UI renders. */
async function poolPageOf(request: APIRequestContext, referralId: string): Promise<number> {
  for (let page = 1; ; page++) {
    const response = await request.get(`${MOCK_API_URL}${POOL_PATH}?page=${page}&size=${POOL_PAGE_SIZE}`);
    expect(response.status(), await response.text()).toBe(200);
    const pool = await response.json();

    if (pool.referrals.some((referral: { id: string }) => referral.id === referralId)) return page;
    // `totalPages` rather than an empty page, so a pool that grows under this loop cannot make it run on.
    if (page >= pool.totalPages) throw new Error(`referral ${referralId} is not in the pool (${pool.total} waiting)`);
  }
}

/** A referral claimed by somebody who is not the signed-in judge, so api's next answer about it is a 404. */
async function claimAs(request: APIRequestContext, referralId: string, judge: string): Promise<void> {
  const response = await request.post(`${MOCK_API_URL}${POOL_PATH}/${referralId}/claim`, { headers: bearer(judge) });
  expect(response.status(), await response.text()).toBe(200);
}

/**
 * A bearer token carrying a subject and nothing else.
 *
 * The mock reads the subject out of the middle segment and never verifies a signature — `auditName` — so this is
 * enough to attribute a write to a name. It proves nothing about authentication, which is the app's own concern
 * and is exercised by the real sign-in the `setup` project performs.
 */
function bearer(subject: string): Record<string, string> {
  const claims = Buffer.from(JSON.stringify({ sub: subject }), "utf8").toString("base64url");

  return { authorization: `Bearer x.${claims}.signature` };
}

/** The three controls on the direction form. The radios are checked by their labels, which is how a judge does it. */
async function fillDirection(page: Page, direction: { decision: string; directions: string; gazette: string }): Promise<void> {
  await page.getByRole("radio", { name: direction.decision }).check();
  await page.getByLabel("Directions (optional)").fill(direction.directions);
  await gazetteAnswer(page, direction.gazette).check();
}

/**
 * The Gazette question's Yes or No.
 *
 * Scoped to its own fieldset because "Yes" and "No" are the labels of nothing else on the form but would be
 * ambiguous the moment a second boolean question were added, and this is the answer that cannot be taken back.
 */
function gazetteAnswer(page: Page, answer: string): Locator {
  return page.getByRole("group", { name: "Should this deed poll be published in the Gazette?" }).getByRole("radio", { name: answer });
}

/**
 * A `govukSummaryList` row, addressed by its **key** rather than by its text.
 *
 * Located by class for the reason `deed-polls.spec.ts` does it: a summary-list row has no accessible name to
 * address it by, and the values this file asserts — "Approved", "Yes", a state — appear in several places on the
 * same page, so an unscoped text match would pass against any of them.
 *
 * **Scoped to the key cell and not to the row, which is not tidiness.** `hasText` is a case-insensitive
 * substring over the whole row, so a row whose *value* is the tag "Claimed" answers to a key of "Claimed" — and
 * the referral view has both. Matching on the key makes each name mean one row.
 */
function summaryRow(page: Page, key: string): Locator {
  return page.locator(".govuk-summary-list__row").filter({ has: page.locator(".govuk-summary-list__key", { hasText: key }) });
}

/**
 * The read-only timeline's entries — a `<ul>` of prose with an attribution rather than a grid, so there are no
 * rows to address.
 *
 * Filtered by the caption each entry carries, because `ul.govuk-list` also matches the reasons list inside the
 * summary above it and the page gives neither list a name or an id to reach for.
 */
function caseNotes(page: Page): Locator {
  return page
    .locator("ul.govuk-list")
    .filter({ has: page.locator("p.govuk-caption-m") })
    .locator("li");
}

function claimButton(page: Page): Locator {
  return page.getByRole("button", { name: "Claim this referral" });
}

/**
 * One destination in the judicial lists' navigation, scoped to the `<nav>` its label names.
 *
 * Scoped because both labels appear elsewhere on the pages that carry them — "Referrals for a direction" is also
 * the pool's `<h1>` and the unavailable page's back link, and "My referrals" is also this page's `<h1>` — so an
 * unscoped name match would assert about whichever the locator happened to find. The `aria-current` assertions in
 * particular are about the link and nothing else.
 */
function navLink(page: Page, label: string): Locator {
  return page.getByRole("navigation", { name: "Referral lists" }).getByRole("link", { name: label });
}

/**
 * One persona's switch button, by its accessible name — `persona-switcher.spec.ts`'s helper, restated here for the
 * reason `bearer` and `summaryRow` are.
 *
 * `exact` matters: the visually hidden prefix makes the names "Switch to Caseworker" and "Switch to Caseworker with
 * admin", and Playwright's default substring match would find both.
 */
function switchTo(page: Page, persona: string): Locator {
  return page.getByRole("button", { name: `Switch to ${persona}`, exact: true });
}

/**
 * Neither judicial list carries anything about the application — decision 3, and api's DTO rather than a filter
 * here.
 *
 * Asserted over the whole page and not just the table: a reference in a caption or a heading would be the same
 * disclosure, and there is nothing on either list that may legitimately name the application. The surname is the
 * seeder's fixed one, which is what a row would show if it had grown an applicant; the two references are unique
 * per call, so neither can be satisfied by an earlier run's copy of a fixed value.
 */
async function expectNoApplicationData(page: Page, seeded: SeededReferral): Promise<void> {
  await expect(page.locator("body")).not.toContainText(seeded.reference);
  await expect(page.locator("body")).not.toContainText(seeded.feeReference);
  await expect(page.locator("body")).not.toContainText("Nakamura");
}

/**
 * "Record a direction" — an anchor in the markup, because it opens a page rather than changing anything, but
 * `getByRole("button")` all the same: `govukButton` given an `href` renders `<a role="button">`, so a locator
 * reaching for `link` finds nothing and every absence assertion passes for the wrong reason.
 */
function directButton(page: Page): Locator {
  return page.getByRole("button", { name: "Record a direction" });
}

/**
 * `formatTimestamp` as `libs/deed-poll/src/deed-poll/case-header.ts` renders it, for the one cell this file reads
 * back off the pool.
 *
 * Restated rather than imported: `e2e-tests` is its own workspace and does not depend on `@hmcts/deed-poll`,
 * deliberately — a journey that imported the app's own formatter would agree with it by construction and could
 * not catch a change of format. Two implementations disagreeing is the failure worth having here.
 *
 * The zone handling is the one part that must *not* be restated independently. api's timestamps are
 * Jackson-serialised `LocalDateTime`, so they are zoneless, and `new Date("2026-07-01T14:23:45.123")` reads a
 * zoneless string as **local** time where the app's `toUtcDate` (`libs/deed-poll-api-client/src/api/wire.ts`)
 * pins it to UTC. Formatting both in Europe/London then agrees only when the runner's TZ happens to be UTC:
 * on a UK machine in BST this helper was an hour behind the page and the pool's "Waiting since" assertion
 * failed. Pinning `timezoneId` in the Playwright config would have hidden that rather than fixed it.
 */
function formatTimestamp(raw: string): string {
  const when = new Date(/^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(raw) ? `${raw}Z` : raw);
  const date = when.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });
  const time = when
    .toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Europe/London" })
    .replace(/\s?(am|pm)$/i, (_match, meridiem: string) => meridiem.toLowerCase());

  return `${date} at ${time}`;
}

/**
 * The Welsh *shape* of the judicial pages, not Welsh content: `cy` holds English here as it does on every
 * deed-poll page, by the migration plan's decision, so what this catches is a **missing** `cy` key — which
 * renders blank rather than erroring, and would empty a heading or a table header without failing anything.
 *
 * **In a context and session of its own**, for the reason `deed-polls.spec.ts` records at length:
 * `localeMiddleware` persists the chosen language to `req.session.locale`, so `?lng=cy` is a *write* to a
 * session that every test restoring `JUDGE_STORAGE_STATE` shares. Done on the shared one it switches another
 * spec into Welsh mid-run, and the symptom is a timeout on a locator in a different file.
 *
 * `storageState: undefined` is load-bearing: `browser.newContext()` otherwise inherits this file's `test.use`
 * and the "own session" would be the shared one — the exact bug that reasoning was earned by.
 *
 * **Both pages in the one signed-in context**, as `deed-polls.spec.ts` pairs the referral and its confirmation:
 * one login covers the pool and a referral still waiting in it, and the referral's own `cy` keys — the timeline's
 * heading among them — are otherwise checked by nothing.
 */
async function expectWelshKeysResolve(browser: Browser, openReferralId: string): Promise<void> {
  const context = await browser.newContext({ storageState: undefined });

  try {
    const page = await context.newPage();
    await signInAsJudge(page);
    await page.goto(`${POOL_PATH}?lng=cy`);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Referrals for a direction");
    await expect(page.getByRole("columnheader", { name: "Urgency" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Waiting since" })).toBeVisible();
    await expect(page.getByText("The most urgent referrals are first, then those waiting longest.")).toBeVisible();
    // The language toggle offers English, which is how the page says it rendered as Welsh at all — a `cy` that
    // failed to resolve would leave the headings blank rather than announcing itself.
    await expect(page.locator(".language")).toContainText("English");

    await page.goto(`${POOL_PATH}/${openReferralId}?lng=cy`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Referral to the judiciary");
    await expect(summaryRow(page, "Reasons for referral")).toBeVisible();
    // The timeline's heading, above entries whose prose is api's and needs no translation: the heading is the key
    // that would empty the section without failing anything.
    await expect(page.getByRole("heading", { name: "Case notes" })).toBeVisible();
    await expect(caseNotes(page).nth(0)).toContainText("Referred to the judiciary.");
    await expect(page.getByRole("button", { name: "Claim this referral" })).toBeVisible();
  } finally {
    await context.close();
  }
}

/** What `seedReferral` gives the journey: the id to navigate by, and the values to assert on the page. */
interface SeededReferral {
  /**
   * The case the referral is on, for the **caseworker** half of the lifecycle journey: closing a referral is
   * `/deed-polls/{id}/referrals/{referralId}/close`, and every caseworker path is keyed on the case.
   *
   * Not for anything judicial. api's judicial surface takes no case id and publishes none, so a judicial assertion
   * that used this would be reaching around the boundary decision 3 exists to keep.
   */
  caseId: string;
  /** The only key any judicial URL takes — there is no case id on this surface (api-3 decision 2). */
  referralId: string;
  reference: string;
  /** The admin-only field that must appear nowhere on a judicial screen. */
  feeReference: string;
  waitingSince: string;
}

/**
 * Checked inline at each point of the journey rather than in a test of its own, per
 * `.claude/rules/e2e-testing.md`.
 *
 * **No exclusions, deliberately** — every judicial page passes without them, and the `aria-allowed-attr` waiver
 * `deed-polls.spec.ts` carries is for a govuk-frontend conditional reveal that none of these pages uses. Adding
 * one here would suppress findings that do not exist and hide any that appear later. There is therefore no
 * `allowed` parameter: adding a waiver is a change to this function, which is where the evidence for it belongs.
 *
 * Reported as `id: selector` strings rather than raw violation objects so a failure names the rule and the
 * element instead of printing an unreadable object graph.
 */
async function expectNoAccessibilityViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();

  expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target).join(", ")}`)).toEqual([]);
}
