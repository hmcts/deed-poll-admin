/**
 * Waiting for an applicant to say whether they still want their deed enrolled, and recording what they said —
 * `docs/plans/notify-3b-admin-confirmation-tracking.md`.
 *
 * **Four tests, because there are four journeys.** The first is the whole story once: the count, the worklist it
 * links to, the case, the referral, the form, both validation refusals, the recording, and the case leaving the
 * worklist — with the axe, keyboard and Welsh checks made at the points it already passes through, per
 * `.claude/rules/e2e-testing.md`. The second is the other outcome plus the race, which is a different story: what
 * a caseworker sees when a colleague answered first. The third is a guessed URL, and the fourth is a caseworker
 * holding no roles, which is a different persona rather than a different step.
 *
 * **What only a browser can show here, and why this file earns its keep on top of the page and mock tests:**
 *
 * - **The number, the link and the rows are one query.** `index.test.ts` pins that the handler sends
 *   `filter=awaitingConfirmation`; only a browser shows that the banner's link lands on a list whose total is the
 *   number the banner had, and that clicking through from another tab does not narrow it.
 * - **The Waiting column is the awaiting-confirmation tab's alone.** A view-model test can assert a cell; the
 *   claim in decision 4 is about a *table on a tab*, so it needs the tab bar and two renders.
 * - **The order is api's and nothing re-sorts it.** The tab's default is `awaitingConfirmationSince:asc`, sent by
 *   nobody: this journey seeds two waits of known length and reads the rendered order, which is the only place
 *   the default and the absence of a client-side sort are asserted together. It also *enters the worklist from a
 *   sorted tab*, which is how a `sort` reached it at all — a tab link carries the previous tab's order, so that
 *   part of the claim is about two pages and cannot be made anywhere else.
 * - **The form's guard is a redirect**, and a redirect is only a redirect in a browser: the page tests pin
 *   `res.redirect`, and this pins that a caseworker returning to a recorded answer's form lands on the referral.
 * - **The race is two callers.** A colleague records the answer through api's own route between the form opening
 *   and its submit, which no single-process test arranges, and what must come back is the fresh referral's own
 *   sentence rather than a 500 or a replayed note.
 * - **The recording is api's write, so the case leaves the worklist because api recomputed** — nobody removed a
 *   row, and the same read that fed the banner is short by exactly this case afterwards.
 *
 * **The wait is arranged through `POST /__mock/referrals/{id}/confirmation-request`, and that is a fact about the
 * mock rather than a shortcut.** The write that sets `confirmationRequestedAt` at api's end is notify-3's *Request
 * confirmation to proceed* email, and the mock has no template for it, so there is no contract route out here that
 * can start a wait. Everything else is driven: the referral is raised, assigned and refused through the contract,
 * because a judge's refusal is what leads the office to ask the applicant at all.
 *
 * The caseworker signs in as `team-leader@example.com` for the first three, because nothing here is gated on a role —
 * which is what the fourth test, on the roleless fixture, is for.
 */
import { AxeBuilder } from "@axe-core/playwright";
import { type APIRequestContext, type Browser, expect, type Locator, type Page, test } from "@playwright/test";
import {
  CASEWORKER_EMAIL,
  CASEWORKER_STORAGE_STATE,
  DEPLOYED_STACK_SKIP_REASON,
  RUNS_AGAINST_DEPLOYED_STACK,
  signInAsTeamLeader,
  TEAM_LEADER_EMAIL,
  TEAM_LEADER_STORAGE_STATE
} from "./idam-session.js";
import { newMaster, sendToMaster } from "./masters.js";

/** The mock api, which `playwright.config.ts` starts on 3200 beside the app on 3000. */
const MOCK_API_URL = process.env.DEED_POLL_API_URL ?? "http://localhost:3200";

/** The worklist, as the banner's link and the tab both address it — api's published filter key. */
const WORKLIST_URL = "/deed-polls?filter=awaitingConfirmation";

/** The colleague who answers first in the race, as a subject rather than a session — see `bearer`. */
const OTHER_CASEWORKER = "e2e.colleague@example.com";

const JUDGES_REASON = "The application cannot be dealt with without notice being given.";

test.skip(RUNS_AGAINST_DEPLOYED_STACK, DEPLOYED_STACK_SKIP_REASON);
test.use({ storageState: TEAM_LEADER_STORAGE_STATE });

test("caseworker follows the awaiting-confirmation count to the longest wait and records that the applicant wants to proceed", async ({
  page,
  request,
  browser
}) => {
  // Three times the default timeout, for the reason `emails.spec.ts` gives: this is one journey rather than a slow
  // one. Two arrangements of four api calls each, eight axe scans, nine form and navigation round trips and a
  // second sign-in for the Welsh check run well past the 30-second default, and the default was reached mid-scan —
  // which reports as a protocol error inside `AxeBuilder` and reads as a fault in the page.
  test.slow();

  // Arrange: two cases waiting for an answer, twelve days and two days. Both are `Returned` with the date that
  // derives it, because that is the state a waiting case is ordinarily in — and it is what makes "recording the
  // answer changes no case state" an assertion rather than a tautology (decision 2).
  const waiting = await seedWaitingCases(request, [12, 2]);
  const [oldest, newest] = waiting.cases;

  await page.goto("/deed-polls");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Deed poll cases");

  // One notification banner for both worklists, which is GOV.UK's guidance — so this is the "Important" region the
  // returned-direction count also lives in, with its own paragraph and its own link.
  const banner = page.getByRole("region", { name: "Important" });
  await expect(banner).toContainText("waiting for the applicant to confirm they want to proceed");
  await expectAwaitingCountMatchesApi(page, request);
  await expectNoAccessibilityViolations(page);

  // The count is a fact about the service rather than about the tab on screen, so another tab does not narrow it —
  // `Enroled` holds none of these cases.
  await page.getByRole("link", { name: "Enrolled" }).click();
  await expect(banner).toContainText("waiting for the applicant to confirm they want to proceed");
  await expectAwaitingCountMatchesApi(page, request);
  // And the Waiting column belongs to one tab (decision 4): the value is on every row api publishes, and the
  // column is not on every table.
  await expect(columnHeader(page, "Waiting")).toHaveCount(0);

  // Into the worklist from a tab that IS ordered, which is the only place this can be shown: every other tab
  // carries its order across, and api's longest-wait default is only a default, so a `sort` surviving the click
  // would put the twelve-day wait somewhere down the queue with nothing on the page admitting it. Sorted from
  // "All applications" rather than from Enroled, because this run's rows are the only ones the store guarantees
  // and a tab holding none renders no table to sort.
  await page.getByRole("link", { name: "All applications" }).click();
  // Activated from the keyboard, for the reason `deed-polls.spec.ts` gives for "Sort by New surname": with this
  // run's two rows the column is narrow enough for the link to wrap, and a synthetic centre click then lands in
  // the gutter between its line boxes, where the `<th>` intercepts it. Waited for, because a key press does not
  // await the navigation it starts.
  const receivedHeader = page.getByRole("link", { name: "Sort by Received" });
  await receivedHeader.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/[?&]sort=dateReceived%3Aasc/);
  // The tab, exactly — the banner's link above it goes to the same place under longer words.
  await page.getByRole("link", { name: "Awaiting confirmation", exact: true }).click();
  await expect(page).toHaveURL(WORKLIST_URL);
  // And no heading on this tab is a control, because the order is not this app's to offer — the handler drops any
  // `sort` the worklist is asked for, so a header link would be a control that does nothing.
  await expect(page.locator("thead").getByRole("link")).toHaveCount(0);
  expect(await rowOrder(page, waiting.surname)).toEqual([oldest.reference, newest.reference]);

  await banner.getByRole("link", { name: "View applications awaiting confirmation" }).click();

  // The same key the count was read with, and no order, term or page: the worklist is not narrowed by the tab it
  // was clicked from, and it carries no `sort` precisely so api's own default for this tab stands.
  await expect(page).toHaveURL(WORKLIST_URL);
  await expectWorklistTotalMatchesApi(page, request);
  await expect(columnHeader(page, "Waiting")).toHaveCount(1);
  // Not a sortable heading, deliberately: ascending by the date the applicant was asked is descending by the days
  // in the cell, so a header link here would offer an order that reads backwards.
  await expect(columnHeader(page, "Waiting").getByRole("link")).toHaveCount(0);

  // api's own arithmetic in the cell, rendered and not recomputed — and the rows in api's order, longest wait
  // first. Matched on this run's surname as well as the reference, for the reason `deed-polls.spec.ts` records:
  // the mock's store outlives the run, so a reference alone is unique only by arithmetic.
  await expect(seededRow(page, waiting.surname, oldest.reference)).toContainText("12 days");
  await expect(seededRow(page, waiting.surname, newest.reference)).toContainText("2 days");
  expect(await rowOrder(page, waiting.surname)).toEqual([oldest.reference, newest.reference]);
  await expectNoAccessibilityViolations(page);

  // Into the case from the worklist row, which is the route the banner promises.
  await seededRow(page, waiting.surname, oldest.reference).getByRole("link", { name: oldest.reference }).click();
  await expect(page).toHaveURL(`/deed-polls/${oldest.id}`);

  // Decision 2, on the page: the waiting is said beside the state and never instead of it. There is no ninth case
  // state, so the header still reads `Returned` — and the sentence says nothing about what to do next, because
  // which date a caseworker should set is an open business question (decision 8).
  const notice = awaitingNotice(page);
  await expect(notice).toContainText("The applicant was asked on");
  await expect(notice).toContainText("has not replied yet");
  await expect(caseHeaderRow(page, "Status")).toContainText("Returned");
  // Read off the page rather than computed here: it is api's date formatted by the app, and a second formatting in
  // this file would be a third opinion about how one timestamp reads.
  // biome-ignore lint/performance/useDomNodeTextContent: Playwright Locator reads rendered text; textContent includes hidden text and preserves source whitespace.
  const askedOnCase = ((await notice.innerText()).match(/asked on (.+?) whether/) ?? ["", ""])[1];
  expect(askedOnCase).not.toBe("");
  await expectNoAccessibilityViolations(page);

  await page.getByRole("tab", { name: "Referrals", exact: true }).click();
  await page
    .locator("#referrals")
    .getByRole("link", { name: /view this referral/ })
    .click();

  // The referral, which is where the answer is recorded and read back (decision 1). The request date is the same
  // fact the case page showed, rendered the same way — one value formatted two ways on two pages is how the two
  // come apart.
  await expect(page).toHaveURL(`/deed-polls/${oldest.id}/referrals/${oldest.referralId}`);
  await expect(page.getByRole("heading", { name: "Applicant's confirmation" })).toBeVisible();
  await expect(summaryRow(page, "Confirmation requested")).toContainText(askedOnCase);
  // In words rather than by a tag's colour, and "Not yet recorded" rather than "None": the applicant may well have
  // replied, and what this page knows is that nobody has transcribed it.
  await expect(summaryRow(page, "Applicant's response")).toContainText("Not yet recorded");
  await expect(summaryRow(page, "Response recorded")).toHaveCount(0);
  await expectNoAccessibilityViolations(page);

  await page.getByRole("button", { name: "Record applicant response" }).click();

  // One question page and no check-answers step (decision 5): the answer, the note that evidences it, and a
  // warning above the submit saying what cannot be undone.
  await expect(page).toHaveURL(`/deed-polls/${oldest.id}/referrals/${oldest.referralId}/confirmation`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Record the applicant's response");
  await expect(page.locator(".govuk-caption-l")).toHaveText(oldest.reference);
  await expect(summaryRow(page, "Confirmation requested")).toContainText(askedOnCase);
  await expect(page.getByText("You cannot change or replace this response in this service once it is recorded.")).toBeVisible();
  // Both of api's published answers, labelled as sentences a caseworker can read out of context, and neither
  // pre-selected — an untouched form posts nothing and is asked the question again.
  await expect(proceeds(page)).not.toBeChecked();
  await expect(doesNotProceed(page)).not.toBeChecked();
  await expectNoAccessibilityViolations(page);

  // An answer nobody ticked, with a note already typed: the note is the expensive thing to lose, so the refusal
  // must keep it. The summary links to the control it is about, which is what makes it usable by keyboard.
  await note(page).fill("Applicant telephoned the office.");
  await page.getByRole("button", { name: "Record response" }).click();

  await expect(page.getByRole("alert")).toContainText("There is a problem");
  await expect(page.getByRole("alert").getByRole("link", { name: "Select what the applicant said about proceeding" })).toHaveAttribute("href", "#outcome");
  await expect(note(page)).toHaveValue("Applicant telephoned the office.");
  await expectNoAccessibilityViolations(page);

  // api's own cap, refused here rather than as a 400 a caseworker cannot act on — and the character count is why
  // 1,001 characters can be typed at all, since it counts rather than truncating.
  await proceeds(page).check();
  await note(page).fill("x".repeat(1001));
  await page.getByRole("button", { name: "Record response" }).click();

  await expect(page.getByRole("alert").getByRole("link", { name: "The note must be 1000 characters or fewer" })).toHaveAttribute("href", "#note");
  // What was ticked survives the refusal as well as what was typed.
  await expect(proceeds(page)).toBeChecked();
  await expectNoAccessibilityViolations(page);

  // The Welsh shape, on the *other* case's form: this one is about to stop existing as a form, and a check made
  // after the recording would be checking the redirect. In a session of its own, for the reason
  // `deed-polls.spec.ts` sets out at length — `?lng=cy` is a write to `req.session.locale`.
  await expectWelshKeysResolve(browser, `/deed-polls/${newest.id}/referrals/${newest.referralId}/confirmation`, newest.reference);

  // Recorded by keyboard alone: the radio is reached and ticked with the keyboard and the form submitted by
  // implicit submission, which is the whole of "keyboard accessible" for a single-question page.
  await note(page).fill("Applicant telephoned the office and confirmed they want to proceed.");
  await proceeds(page).focus();
  await page.keyboard.press("Space");
  await expect(proceeds(page)).toBeChecked();
  await page.keyboard.press("Enter");

  // Post/redirect/get onto the referral, freshly read (decision 7) — the write's response is the referral, and it
  // is deliberately not what is rendered, because the conflict path has no body to trust and both paths must end
  // on the same page.
  await expect(page).toHaveURL(`/deed-polls/${oldest.id}/referrals/${oldest.referralId}?confirmation=recorded`);
  await expect(page.getByRole("alert")).toContainText("The applicant's response has been recorded.");
  // The answer in the same words the radio offered, so a caseworker reads back the sentence they ticked.
  await expect(summaryRow(page, "Applicant's response")).toContainText("The applicant wants to proceed");
  // The recorder is api's, from the token this page forwarded — never a name this app sent.
  await expect(summaryRow(page, "Recorded by")).toContainText(TEAM_LEADER_EMAIL);
  await expect(summaryRow(page, "Response recorded")).toHaveCount(1);
  // Nothing here says what to do about the case next, and nothing offers to replace the answer (decision 8).
  await expect(page.getByRole("button", { name: "Record applicant response" })).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("ready for enrolment");
  // And the referral itself has not moved: recording an answer is not a transition (decision 8).
  await expect(summaryRow(page, "Referral status")).toContainText("Direction received");
  await expectNoAccessibilityViolations(page);

  // The note is on the case's notes, which is where api put it — this app wrote nothing.
  await page.getByRole("link", { name: "Back to case" }).click();
  await page.getByRole("tab", { name: "Notes" }).click();
  await expect(page.locator("#notes")).toContainText("Applicant's confirmation recorded");
  await expect(page.locator("#notes")).toContainText("Applicant telephoned the office and confirmed they want to proceed.");

  // The case is no longer waiting, and the sentence is gone rather than reworded — the state and the dates that
  // derive it are untouched.
  await page.goto(`/deed-polls/${oldest.id}`);
  await expect(awaitingNotice(page)).toHaveCount(0);
  await expect(caseHeaderRow(page, "Status")).toContainText("Returned");

  // The form refuses to present an action that no longer applies — a back button, a bookmark or a second tab —
  // and redirects to the referral, which shows the answer that explains why.
  await page.goto(`/deed-polls/${oldest.id}/referrals/${oldest.referralId}/confirmation`);
  await expect(page).toHaveURL(`/deed-polls/${oldest.id}/referrals/${oldest.referralId}`);

  // And the worklist. **Nobody removed a row and nobody decremented a number**: api recomputed
  // `awaitingConfirmationSince` inside the write, so the next read of the same query is short by exactly this
  // case. Asserted on this run's own two cases for the strict claim, and against api's total for the banner.
  await page.goto(WORKLIST_URL);
  await expect(seededRow(page, waiting.surname, oldest.reference)).toHaveCount(0);
  await expect(seededRow(page, waiting.surname, newest.reference)).toHaveCount(1);
  await expectWorklistTotalMatchesApi(page, request);
});

/**
 * The other outcome, and the race — `notify-3b` decisions 5 and 7.
 *
 * Two seeded cases, because these are two arrangements of the same form: one answered here, one answered by a
 * colleague first. The second is the half no single-process test can reach — api's 409 needs a second caller
 * between the GET and the POST — and what it must produce is the fresh referral's own sentence, the answer that
 * was in fact recorded, and no offer to overwrite it.
 */
test("caseworker records that the applicant does not want to proceed, and is told when a colleague answered first", async ({ page, request }) => {
  test.slow();

  const waiting = await seedWaitingCases(request, [5, 3]);
  const [mine, theirs] = waiting.cases;

  // The withdrawal, recorded here. Same form, other radio — and the wording never implies the case is closed: this
  // is a referral outcome beside a case still shown as `Returned` (flag 2).
  await page.goto(`/deed-polls/${mine.id}/referrals/${mine.referralId}/confirmation`);
  await doesNotProceed(page).check();
  await note(page).fill("Applicant replied by post and asked to withdraw.");
  await page.getByRole("button", { name: "Record response" }).click();

  await expect(page).toHaveURL(`/deed-polls/${mine.id}/referrals/${mine.referralId}?confirmation=recorded`);
  await expect(page.getByRole("alert")).toContainText("The applicant's response has been recorded.");
  await expect(summaryRow(page, "Applicant's response")).toContainText("The applicant does not want to proceed");
  await expect(caseHeaderLink(page)).toBeVisible();
  await expectNoAccessibilityViolations(page);

  // The race: the form is open, and a colleague answers through api's own route before it is submitted.
  await page.goto(`/deed-polls/${theirs.id}/referrals/${theirs.referralId}/confirmation`);
  await doesNotProceed(page).check();
  await note(page).fill("Applicant rang while I was on the other line.");

  const first = await request.post(`${MOCK_API_URL}/caseworker/cases/${theirs.id}/referrals/${theirs.referralId}/confirmation`, {
    headers: bearer(OTHER_CASEWORKER),
    data: { outcome: "Confirmed", note: "Applicant emailed to confirm." }
  });
  expect(first.status(), await first.text()).toBe(200);

  await page.getByRole("button", { name: "Record response" }).click();

  // A conflict marker rather than an error page, and the sentence is chosen from the fresh read rather than parsed
  // out of api's refusal — api's two 409s are distinguishable only by their prose, which this app never reads.
  await expect(page).toHaveURL(`/deed-polls/${theirs.id}/referrals/${theirs.referralId}?confirmation=conflict`);
  await expect(page.getByRole("alert")).toContainText("The applicant's response has already been recorded.");
  // The answer that was actually recorded, and the colleague credited for it — a fact on the referral rather than
  // a name in the refusal, which is the distinction api's own message keeps.
  await expect(summaryRow(page, "Applicant's response")).toContainText("The applicant wants to proceed");
  await expect(summaryRow(page, "Recorded by")).toContainText(OTHER_CASEWORKER);
  // No overwrite, and the note that was typed is not replayed through the redirect.
  await expect(page.getByRole("button", { name: "Record applicant response" })).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("Applicant rang while I was on the other line.");
  await expectNoAccessibilityViolations(page);
});

/**
 * A guessed URL, which is the direct test of what api's scoping discloses — Task 5.
 *
 * Both reads name the case and the referral, so a referral under another case is api's `not found` and this app
 * adds no check of its own. What matters on the page is that it says nothing: not the request date, not the
 * outcome, not that there is a referral there at all. Two URLs, because the form is a second door to the same
 * pair of ids.
 */
test("a referral id from another case discloses nothing about its confirmation, on the referral or on its form", async ({ page, request }) => {
  const waiting = await seedWaitingCases(request, [7, 1]);
  const [owning, other] = waiting.cases;

  for (const path of [`/deed-polls/${other.id}/referrals/${owning.referralId}`, `/deed-polls/${other.id}/referrals/${owning.referralId}/confirmation`]) {
    await page.goto(path);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
    const main = page.locator("main");
    await expect(main).not.toContainText("Applicant's confirmation");
    await expect(main).not.toContainText("Confirmation requested");
    await expect(main).not.toContainText(owning.reference);
    await expect(main).not.toContainText(owning.referralId);
  }

  await expectNoAccessibilityViolations(page);
});

/**
 * The same journey as a caseworker holding **no roles at all** — `notify-3b`'s "deliberately not in this plan":
 * there is no new role or presentational gate here, and this is where that is shown rather than asserted by the
 * absence of code.
 *
 * Privacy override is derived from staff capabilities, so this fixture is the negative case for every role rule in the app;
 * api gates neither the worklist nor the recording on one. A gate added later — here or at api's end — fails this
 * test rather than being discovered by a caseworker who cannot finish their work.
 */
test.describe("without the admin role", () => {
  test.use({ storageState: CASEWORKER_STORAGE_STATE });

  test("caseworker with no roles reaches the waiting worklist and records the applicant's response", async ({ page, request }) => {
    const waiting = await seedWaitingCases(request, [9]);
    const [only] = waiting.cases;

    await page.goto(WORKLIST_URL);
    await expect(seededRow(page, waiting.surname, only.reference)).toContainText("9 days");

    await page.goto(`/deed-polls/${only.id}/referrals/${only.referralId}`);
    await page.getByRole("button", { name: "Record applicant response" }).click();

    await proceeds(page).check();
    await page.getByRole("button", { name: "Record response" }).click();

    await expect(page).toHaveURL(`/deed-polls/${only.id}/referrals/${only.referralId}?confirmation=recorded`);
    await expect(summaryRow(page, "Applicant's response")).toContainText("The applicant wants to proceed");
    // api attributed it to this caseworker's own token, which is the only identity either end used.
    await expect(summaryRow(page, "Recorded by")).toContainText(CASEWORKER_EMAIL);
    await expectNoAccessibilityViolations(page);
  });
});

/**
 * Cases waiting for an answer, one per number of days given.
 *
 * **Seeded, then driven, then asked.** The case is seeded because a create is not what is being tested; the
 * referral is raised, assigned and refused through the contract, because a Master's refusal is what leads the
 * office to ask the applicant at all and a seeded `Decided` referral would be a state api's own machine never
 * produced; and only the ask itself goes through the mock's control route, because the write that starts a wait is
 * notify-3's email and this mock has no template for it.
 *
 * **One surname for the run, and every row assertion is narrowed by it.** The mock's store outlives the run —
 * `reuseExistingServer` — and every spec shares it, so a five-digit reference is unique only by arithmetic and
 * the surname carries milliseconds no earlier run shares. It is also why nothing here asserts an exact global
 * count: `expectAwaitingCountMatchesApi` compares the page against api at the same moment instead.
 *
 * `Returned` with the date that derives it, because that is the state a waiting case is ordinarily in.
 */
async function seedWaitingCases(
  request: APIRequestContext,
  waits: number[]
): Promise<{ surname: string; cases: { id: string; referralId: string; reference: string }[] }> {
  const surname = `Confirmby${Date.now().toString(36)}`;
  const serial = Math.floor(Math.random() * 10_000);
  const cases = [];

  for (const [index, days] of waits.entries()) {
    const reference = `KBDP2026-5${String((serial + index) % 10_000).padStart(4, "0")}`;
    const response = await request.post(`${MOCK_API_URL}/__mock/cases`, {
      data: {
        type: "Adult",
        state: "Returned",
        newForename: "Ada",
        newSurname: surname,
        displayReference: reference,
        dateReceived: "2026-06-01T00:00:00.000",
        dateReturned: "2026-06-20T00:00:00.000"
      }
    });
    // Asserted, because a rejected seed leaves the journey counting fewer cases than it means to and the failure
    // surfaces later as a banner one short, which reads as a bug in the count.
    expect(response.status(), await response.text()).toBe(201);
    const id = (await response.json()).id;

    cases.push({ id, referralId: await askApplicant(request, id, days), reference });
  }

  return { surname, cases };
}

/**
 * Raise a referral, have a judge refuse it, and ask the applicant whether they still want to proceed.
 *
 * Every step is checked: a refusal part-way leaves the referral in whatever state it reached, and the symptom is a
 * case that is simply absent from the worklist — which reads as the filter being broken rather than the
 * arrangement.
 *
 * `daysAgo` is a whole number of days before now, which is what the row's Waiting cell counts: api's
 * `daysAwaitingConfirmation` is a difference of UTC calendar days, `0` on the day the email went and never 1.
 */
async function askApplicant(request: APIRequestContext, caseId: string, daysAgo: number): Promise<string> {
  // Raised into the queue and sent to a Master of its own, as the Referrals screen would (plan Fa1).
  const master = await newMaster(request, "Confirmation");
  const raised = await request.post(`${MOCK_API_URL}/caseworker/cases/${caseId}/referrals`, {
    data: { reasons: ["Minor", "MinorCourtOrder"] }
  });
  expect(raised.status(), await raised.text()).toBe(201);
  const referralId = (await raised.json()).id;
  await sendToMaster(request, referralId, master.id);

  // The Master's linked judge, because api shows an assigned referral to nobody else.
  const judge = bearer(master.judge);

  const directed = await request.post(`${MOCK_API_URL}/judicial/referrals/${referralId}/direction`, {
    headers: judge,
    data: { decision: "Rejected", changesToStandardPublication: true, directionsText: JUDGES_REASON }
  });
  expect(directed.status(), await directed.text()).toBe(200);

  // The one step outside the contract, and the only one there is no route for out here — see the file's docblock.
  // Zoneless, as api publishes its date-times: read as local, a wait arranged at midnight would be a day out.
  const asked = new Date(Date.now() - daysAgo * 86_400_000).toISOString().replace("Z", "");
  const requested = await request.post(`${MOCK_API_URL}/__mock/referrals/${referralId}/confirmation-request`, {
    data: { confirmationRequestedAt: asked }
  });
  expect(requested.status(), await requested.text()).toBe(200);

  return referralId;
}

/**
 * A bearer token carrying a subject and nothing else.
 *
 * The mock reads the subject out of the middle segment and never verifies a signature — `auditName` — so this is
 * enough to attribute a direction to a judge and a recording to a colleague. It proves nothing about
 * authentication, which the real sign-in the `setup` project performs is what exercises.
 */
function bearer(subject: string): Record<string, string> {
  const claims = Buffer.from(JSON.stringify({ sub: subject }), "utf8").toString("base64url");

  return { authorization: `Bearer x.${claims}.signature` };
}

/** The radio for `Confirmed`, addressed by the sentence a caseworker reads rather than by api's member name. */
function proceeds(page: Page): Locator {
  return page.getByLabel("The applicant wants to proceed");
}

/** And for `Withdrawn`. `exact` is not needed: the two labels are not prefixes of one another. */
function doesNotProceed(page: Page): Locator {
  return page.getByLabel("The applicant does not want to proceed");
}

/** The evidence for the answer, optional at both ends. */
function note(page: Page): Locator {
  return page.getByLabel("Note (optional)");
}

/**
 * The case page's "awaiting confirmation" sentence.
 *
 * Located by class rather than by text or role: it is `govukInsetText`, which has neither an accessible name nor a
 * role, and it is the only inset text the case page renders — so its absence is assertable, which is what the end
 * of the journey needs. A text locator would also have to restate the sentence being read off it.
 */
function awaitingNotice(page: Page): Locator {
  return page.locator(".govuk-inset-text");
}

function caseHeaderLink(page: Page): Locator {
  return page.getByRole("link", { name: "Back to case" });
}

/**
 * A `govukSummaryList` row, addressed by its key for the reason `deed-polls.spec.ts` addresses its rows that way:
 * a summary-list row has no accessible name, and the values asserted here — a date, a state, an email — appear
 * elsewhere on the same page.
 */
function summaryRow(page: Page, key: string): Locator {
  // An anchored match on the key cell: `hasText` alone is a case-insensitive substring, so "Status" would also
  // answer to "Marital status" and to the application's own Status row.
  const keyCell = page.locator(".govuk-summary-list__key").filter({ hasText: exactText(key) });

  return page.locator(".govuk-summary-list__row").filter({ has: keyCell });
}

/** The whole of a cell's text, so a key never matches another key that merely contains it. */
function exactText(text: string): RegExp {
  return new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`);
}

/** The case header's own summary list, which is a separate list from any tab's. */
function caseHeaderRow(page: Page, key: string): Locator {
  return summaryRow(page, key).first();
}

/** A column of the list table, by its heading — which is how "this tab has a Waiting column" is asked. */
function columnHeader(page: Page, label: string): Locator {
  return page.getByRole("columnheader", { name: label, exact: true });
}

/** One row of the list table, identified by this run's surname and the case's reference. */
function seededRow(page: Page, surname: string, reference: string): Locator {
  return page.locator("tbody tr").filter({ hasText: surname }).filter({ hasText: reference });
}

/**
 * This run's references in the order the table renders them.
 *
 * Narrowed to the run's own rows, because the order being asserted is *relative*: the store holds other waiting
 * cases from other runs and from `yarn mock:seed`, and api's default order interleaves them by date. What the
 * journey claims is that the longer wait is above the shorter one, which survives anything else on the page.
 */
async function rowOrder(page: Page, surname: string): Promise<string[]> {
  const rows = page.locator("tbody tr").filter({ hasText: surname });
  const texts = await rows.allInnerTexts();

  return texts.map((text) => (text.match(/KBDP2026-\d{5}/) ?? [""])[0]);
}

/**
 * The banner's number, against api's total for the same filter read at the same moment.
 *
 * **Re-read on each attempt rather than compared once**, as `deed-polls.spec.ts` compares the returned-direction
 * count: this count is global by design, so another worker's recording can move api's side between a render and
 * an assertion about it, and reloading inside the poll makes the two sides the same moment. Compared by
 * backreference so a failure prints both numbers and so nothing here pins a total this suite does not control.
 *
 * **An absent paragraph is the number zero**, not a missing element to wait for: the page renders no
 * awaiting-confirmation sentence when nothing is waiting.
 */
async function expectAwaitingCountMatchesApi(page: Page, request: APIRequestContext): Promise<void> {
  await expect
    .poll(async () => {
      await page.reload();
      const sentence = page.getByText(/waiting for the applicant to confirm they want to proceed/);
      const shown = (await sentence.count()) === 0 ? "0" : ((await sentence.first().textContent()) ?? "").match(/^(\d+) /)?.[1];

      return `${shown} / api total ${await awaitingTotal(request)}`;
    })
    .toMatch(/^(\d+) \/ api total \1$/);
}

/** The worklist's range caption's total, against api's for the same filter — same reasoning, same shape. */
async function expectWorklistTotalMatchesApi(page: Page, request: APIRequestContext): Promise<void> {
  await expect
    .poll(async () => {
      await page.reload();
      const shown = ((await page.getByText(/of \d+ applications/).textContent()) ?? "").match(/of (\d+) applications/)?.[1];

      return `${shown} / api total ${await awaitingTotal(request)}`;
    })
    .toMatch(/^(\d+) \/ api total \1$/);
}

/**
 * How many cases api counts as waiting right now — the query the banner reads.
 *
 * `size=1` for the reason the banner uses it: the total is api's across every page and the rows are not wanted.
 * The published filter key and no condition, because a condition here would be a second opinion about which cases
 * are waiting — which is exactly what decision 3 keeps out of this app.
 */
async function awaitingTotal(request: APIRequestContext): Promise<number> {
  const response = await request.get(`${MOCK_API_URL}/caseworker/cases?filter=awaitingConfirmation&size=1`);
  expect(response.status(), await response.text()).toBe(200);

  return (await response.json()).total;
}

/**
 * The Welsh *shape*, not Welsh content: every page carries `en` and `cy` with matching keys, but `cy` deliberately
 * holds English until there is a translation to put in it. What this catches is a missing `cy` key, which renders
 * blank rather than erroring.
 *
 * **In a context and session of its own, and `storageState: undefined` is load-bearing** — for the reasons
 * `deed-polls.spec.ts` records at length: `?lng=cy` is a *write* to `req.session.locale`, so doing it on the
 * shared admin session switches another spec into Welsh mid-run, and a context created without that option
 * inherits this file's storage state and is therefore never anonymous.
 */
async function expectWelshKeysResolve(browser: Browser, path: string, reference: string): Promise<void> {
  const context = await browser.newContext({ storageState: undefined });

  try {
    const page = await context.newPage();
    await signInAsTeamLeader(page);
    await page.goto(`${path}?lng=cy`);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Record the applicant's response");
    await expect(page.locator(".govuk-caption-l")).toHaveText(reference);
    await expect(proceeds(page)).toBeVisible();
    await expect(note(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Record response" })).toBeVisible();
  } finally {
    await context.close();
  }
}

/**
 * Checked inline at each point of a journey rather than in a test of its own, per `.claude/rules/e2e-testing.md`.
 *
 * **No waiver parameter, because no page here needs one** — every page in these journeys passes clean, including
 * the question page with its character count and its warning. The same signature as `judicial.spec.ts`; the
 * waiver-taking variant lives in `deed-polls.spec.ts`, which needs one for a govuk-frontend radio reveal, and
 * carrying an always-empty exclusion list here would be a way of not failing that nothing asks for.
 *
 * Reported as `id: selector` strings rather than raw violation objects so a failure names the rule and the element
 * instead of printing an unreadable object graph.
 */
async function expectNoAccessibilityViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const findings = results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target).join(", ")}`);

  expect(findings).toEqual([]);
}
