/**
 * The judicial persona, end to end in a browser — `docs/plans/completed/referrals-admin-3-judicial-screen.md`, and
 * since plan Db1 a Master with no pool and no claim.
 *
 * **A referral reaches a Master by assignment.** A caseworker raises it with a Master chosen, and api D2 shows it to
 * that Master's linked judge and nobody else: an `Open` referral is no judge's. So every journey here starts by
 * putting a referral in the judge persona's hands through its Masters-list entry (`./masters.ts`), and the judge's
 * home is **My referrals**, in three sections read off api's order: Urgent, Awaiting your direction and Directed,
 * awaiting the office, the last two under one heading per day referred.
 *
 * **What only a browser can show here, and why this file earns its keep:**
 *
 * - **The persona boundary is real.** The page tests never ask about the role — the gate is mounted on the area
 *   in `app.ts`, not written into any page — so an ungated judicial page and a gated one render identically
 *   under test. `src/app.test.ts` pins the mount from the filesystem; this pins that a signed-in Team leader
 *   actually gets a refusal from the running app.
 * - **The three-step direction flow carries its state through the request and nothing else.** The check step is
 *   rendered from the values it was posted and "Change your answers" is a submit, not a link (decision 7). A
 *   `vi.fn()` cannot show that the second round trip arrives with what the first one held; a form and a browser
 *   can.
 * - **A referral assigned to another Master is a refusal a judge reads, not a fault.** api answers it 404, the same
 *   as withdrawn, closed and never-there, so the page must say it is no longer available without naming a holder.
 * - **The disclosure boundary, asserted from outside.** The case is seeded carrying a fee reference; the judicial
 *   screen must not contain it. That is api's boundary rather than this app's (decision 4), and this is the check
 *   that the whole rendered page — not just the view model — honours it.
 *
 * The judge signs in as `judge@example.com`, the only fixture holding `caseworker-deedpoll-judicial` and
 * deliberately holding nothing else. `yarn idam:users` seeds it.
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
  TEAM_LEADER_EMAIL,
  TEAM_LEADER_STORAGE_STATE
} from "./idam-session.js";
import { bearer, judgePersonaMaster, type Master, newMaster } from "./masters.js";

/** The mock api, which `playwright.config.ts` starts on 3200 beside the app on 3000. */
const MOCK_API_URL = process.env.DEED_POLL_API_URL ?? "http://localhost:3200";

/** The old pool's address. Every referral page still lives under it; the bare path redirects to My referrals. */
const POOL_PATH = "/judicial/referrals";

/** The Master's own list, and since plan Db1 their home. */
const MINE_PATH = "/judicial/referrals/mine";

/** Where a caseworker's day starts, and where the office half of the lifecycle journey happens. */
const CASE_LIST_PATH = "/deed-polls";

const URGENT_SECTION = "Urgent";
const AWAITING_SECTION = "Awaiting your direction";
const DIRECTED_SECTION = "Directed, awaiting the office";

test.skip(RUNS_AGAINST_DEPLOYED_STACK, DEPLOYED_STACK_SKIP_REASON);
test.use({ storageState: JUDGE_STORAGE_STATE });

test("a caseworker raises a referral to the judge's Master, who finds it under its day on My referrals and directs it", async ({ page, browser, request }) => {
  // Three times the default: a caseworker's context, a Welsh sign-in and seven axe scans make this one journey long.
  test.slow();

  // Arrange: the judge persona's Masters-list entry, an urgent referral already assigned to it, and a case for the
  // caseworker to refer. A Master of its own holds a third referral, which this judge must not be able to read.
  const master = await judgePersonaMaster(request);
  const urgent = await seedReferral(request, { reason: "DomesticAbuse", masterId: master.id, urgent: true });
  const raisedCase = await seedCase(request, { note: "Applicant asked for the hearing to be listed early." });
  const elsewhere = await newMaster(request, "Elsewhere");
  const theirs = await seedReferral(request, { reason: "Minor", masterId: elsewhere.id, urgent: false });

  // ── the caseworker raises it, choosing the judge persona's Master ──────────────────────────────────────────
  const referralId = await raiseThroughTheForm(browser, raisedCase.caseId, master);
  const raised = await judicialReferral(request, referralId);

  // ── the Master's home ───────────────────────────────────────────────────────────────────────────────────────
  // Reached from `/` rather than by URL, because `/` is where each persona's home is decided.
  await page.goto("/");
  await expect(page).toHaveURL(MINE_PATH);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("My referrals");
  await expect(page.getByText("These are the referrals assigned to you.")).toBeVisible();
  // api's order, so there is nothing to compose: no filter bar, no search and no sortable headers.
  await expect(page.getByRole("searchbox")).toHaveCount(0);

  // The pool is gone, and a bookmark of it lands here rather than on a page that no longer exists.
  await page.goto(POOL_PATH);
  await expect(page).toHaveURL(MINE_PATH);

  // The urgent one is in the Urgent section, saying when it was referred, since no day heading says it there.
  const urgentRow = myReferralsRow(page, urgent.referralId);
  await expect(urgentRow).toHaveCount(1);
  expect(await placeOf(urgentRow)).toEqual({ section: URGENT_SECTION, day: null });
  await expect(urgentRow).toContainText(`Referred ${shortDate(urgent.createdOn)}`);
  await expect(urgentRow).toContainText(`Direction due by ${shortDate(urgent.directionDueBy)}`);
  await expect(urgentRow).toContainText("Domestic abuse considerations");

  // The caseworker's one is undirected and standard, so it sits under the day it was referred.
  const raisedRow = myReferralsRow(page, referralId);
  expect(await placeOf(raisedRow)).toEqual({ section: AWAITING_SECTION, day: `${shortDate(raised.createdOn)} referrals` });
  await expect(raisedRow).toContainText("Non-publication request");
  await expect(raisedRow).toContainText(`Direction due by ${shortDate(raised.directionDueBy)}`);

  // Another Master's referral is not on this one's list.
  await expect(myReferralsRow(page, theirs.referralId)).toHaveCount(0);
  // No applicant and no reference anywhere in the list: api's row carries neither.
  await expectNoApplicationData(page, raisedCase);
  await expectNoAccessibilityViolations(page);

  // Checked while both referrals are undirected, because a section's `cy` keys only render while it has rows.
  await expectWelshKeysResolve(browser, referralId);

  // ── the referral ────────────────────────────────────────────────────────────────────────────────────────────
  await raisedRow.getByRole("link").click();
  await expect(page).toHaveURL(`${POOL_PATH}/${referralId}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Referral to a Master");

  // The application — `JudicialApplicationView`, the one General section a Master asked for. The reference is the
  // caption above the heading rather than a row in it.
  await expect(page.locator(".govuk-caption-l")).toContainText(raisedCase.reference);
  await expect(summaryRow(page, "Type")).toContainText("Adult");
  await expect(summaryRow(page, "Old surname")).toContainText("Kowalski");
  await expect(summaryRow(page, "New surname")).toContainText("Nakamura");

  // **The disclosure check, from outside the view model.** The case carries a fee reference; the judicial screen
  // must not. api's DTO is what keeps it off — not a filter here (decision 4).
  await expect(page.locator("body")).not.toContainText(raisedCase.feeReference);

  // The referral's own fields after the application: assigned to this Master, and when the direction is due.
  await expect(referralRow(page, "Status")).toContainText("Claimed");
  await expect(referralRow(page, "Assigned to you")).toBeVisible();
  await expect(referralRow(page, "Direction due by")).toContainText(shortDate(raised.directionDueBy));
  await expect(summaryRow(page, "Reasons for referral")).toContainText("Non-publication request");
  await expect(page.getByRole("heading", { name: "Supporting documents" })).toBeVisible();
  // Nothing to claim: it is already theirs.
  await expect(page.getByRole("button", { name: "Claim this referral" })).toHaveCount(0);

  // **No case notes, since the Master asked for them to go.** The case carries a note typed by the office, seeded so
  // this has something real to fail against: neither it, its heading nor the caseworker who wrote it reaches the page.
  await expect(page.getByRole("heading", { name: "Case notes" })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Applicant asked for the hearing to be listed early.");
  await expect(page.locator("body")).not.toContainText(CASEWORKER_EMAIL);
  await expect(page.locator("body")).not.toContainText(TEAM_LEADER_EMAIL);
  // No note control and no link to the case, because api's judicial surface takes no case id.
  await expect(page.getByRole("button", { name: "Add a note" })).toHaveCount(0);
  await expect(page.locator('a[href^="/deed-polls"]')).toHaveCount(0);
  await expectNoAccessibilityViolations(page);

  // ── the direction ───────────────────────────────────────────────────────────────────────────────────────────
  await directButton(page).click();
  await expect(page).toHaveURL(`${POOL_PATH}/${referralId}/direction`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Record a direction");
  // The reference captions the form, because a judge must see which application they are directing before they
  // attest to it.
  await expect(page.locator(".govuk-caption-l")).toHaveText(raisedCase.reference);

  // **Neither pair of radios defaults.** A pre-selected Gazette answer would be this page deciding publication
  // on the judge's behalf.
  await expect(page.getByRole("radio", { checked: true })).toHaveCount(0);
  await expectNoAccessibilityViolations(page);

  // Nothing answered: two questions, two messages, both linked from the summary to the control they belong to.
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert")).toContainText("There is a problem");
  await expect(page.getByRole("link", { name: "Select whether the application is approved or rejected" })).toHaveAttribute("href", "#decision");
  await expect(page.getByRole("link", { name: "Select whether there are any changes to the standard publications in the Gazette" })).toHaveAttribute(
    "href",
    "#changesToStandardPublication"
  );
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Record a direction");
  await expectNoAccessibilityViolations(page);

  // Changes to the standard publication with nothing to say what they are: refused beside the textarea, because
  // "Yes" alone does not tell the office whether to publish nothing or only the last name.
  await fillDirection(page, { decision: "Approved", directions: "", gazette: "Yes" });
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("link", { name: "Enter the directions or reasons, saying what changes about the Gazette publication" })).toHaveAttribute(
    "href",
    "#directionsText"
  );
  await expectNoAccessibilityViolations(page);

  await fillDirection(page, { decision: "Approved", directions: "Approved on the papers. Publish the last name only.", gazette: "Yes" });
  await page.getByRole("button", { name: "Continue" }).click();

  // Check your direction — the attestation step, and the answers read back in the judge's own words.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Check your direction");
  await expect(summaryRow(page, "Decision")).toContainText("Approved");
  await expect(summaryRow(page, "Directions/Reasons")).toContainText("Approved on the papers. Publish the last name only.");
  await expect(summaryRow(page, "Changes to the standard publications in the Gazette")).toContainText("Yes");
  await expect(page.getByText("By recording this direction you confirm it is your direction on this application.")).toBeVisible();
  await expect(page.getByText("You can change or withdraw your direction until the office closes the referral.")).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expectNoAccessibilityViolations(page);

  // **Change is a submit, and this is the assertion that the state travels in the request.** Nothing is stored
  // between the two steps, so a link back to the form would arrive empty.
  await page.getByRole("button", { name: "Change your answers" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Record a direction");
  await expect(page.getByRole("radio", { name: "Approved" })).toBeChecked();
  await expect(page.getByLabel("Directions/Reasons")).toHaveValue("Approved on the papers. Publish the last name only.");
  await expect(gazetteAnswer(page, "Yes")).toBeChecked();
  await expect(page.getByRole("alert")).toHaveCount(0);

  // Rejected instead, so what is recorded is the answer given last rather than the one the flow started with.
  await page.getByRole("radio", { name: "Rejected" }).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(summaryRow(page, "Decision")).toContainText("Rejected");

  await page.getByRole("button", { name: "Confirm and record the direction" }).click();

  await expect(page).toHaveURL(`${POOL_PATH}/${referralId}?direction=recorded`);
  await expect(page.getByRole("alert")).toContainText("Your direction has been recorded.");
  await expect(referralRow(page, "Status")).toContainText("Decided");
  await expect(page.getByRole("heading", { name: "Direction recorded" })).toBeVisible();
  await expect(summaryRow(page, "Decision")).toContainText("Rejected");
  await expect(summaryRow(page, "Directions/Reasons")).toContainText("Approved on the papers. Publish the last name only.");
  await expect(summaryRow(page, "Changes to the standard publications in the Gazette")).toContainText("Yes");
  // A directed referral has no due date and nothing more to record.
  await expect(referralRow(page, "Direction due by")).toHaveCount(0);
  await expect(directButton(page)).toHaveCount(0);
  await expectNoAccessibilityViolations(page);

  // Back on My referrals, it has moved to the directed section, under the same day.
  await page.getByRole("link", { name: "Back to My referrals" }).click();
  await expect(page).toHaveURL(MINE_PATH);
  expect(await placeOf(myReferralsRow(page, referralId))).toEqual({ section: DIRECTED_SECTION, day: `${shortDate(raised.createdOn)} referrals` });

  // ── another Master's referral ───────────────────────────────────────────────────────────────────────────────
  // **404 and not 403**: api answers another Master's referral as it answers a withdrawn or a never-there one, and
  // the page must say so without saying who has it.
  const refused = await page.goto(`${POOL_PATH}/${theirs.referralId}`);
  expect(refused?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This referral is no longer available");
  await expect(page.locator("body")).not.toContainText(elsewhere.name);
  await expect(page.locator("body")).not.toContainText("another Master");
  await expectNoAccessibilityViolations(page);
  await page.getByRole("link", { name: "Back to My referrals" }).click();
  await expect(page).toHaveURL(MINE_PATH);
});

/**
 * A judge revisits a direction they gave — `docs/plans/20261019-judicial-application-view.md`, decisions 3 to 6.
 *
 * **Happy path only, one referral's second thoughts.** The judge directs it (in the fewest steps), opens it decided
 * and reads the application and its supporting document, changes the direction through the same form and check
 * step, then withdraws it and directs again. The refusals are the page tests' subject.
 *
 * **What only a browser shows here:** that the change journey's flag survives every round trip — form, check step,
 * confirm — so the confirm reaches api's `PUT` rather than recording a second direction, and that a withdrawal
 * really leaves the referral with this judge with the direction form offered again.
 *
 * The document is uploaded through the caseworker contract route, as an office would attach it, and downloaded
 * through the judge's own session: the judicial route is the only door a judge has to it.
 */
test("judge changes a direction they gave, then withdraws it and directs again", async ({ page, request }) => {
  const master = await judgePersonaMaster(request);
  const seeded = await seedReferral(request, { reason: "Minor", masterId: master.id, urgent: false });
  const uploaded = await request.post(`${MOCK_API_URL}/caseworker/cases/${seeded.caseId}/documents`, {
    headers: bearer({ sub: CASEWORKER_EMAIL }),
    multipart: {
      file: { name: "birth-certificate.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 e2e") },
      documentTypeId: "11111111-1111-4111-8111-111111111111",
      name: "Birth certificate for the judge"
    }
  });
  expect(uploaded.status(), await uploaded.text()).toBe(201);

  // Directed through the UI rather than seeded, so the director is the signed-in judge's own IDAM subject.
  await page.goto(`${POOL_PATH}/${seeded.referralId}`);
  await directButton(page).click();
  await fillDirection(page, { decision: "Approved", directions: "Approved on the papers.", gazette: "No" });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Confirm and record the direction" }).click();
  await expect(page).toHaveURL(`${POOL_PATH}/${seeded.referralId}?direction=recorded`);

  // ── the decided referral: the application, its document, and the two controls ──────────────────────────────
  await page.goto(`${POOL_PATH}/${seeded.referralId}`);
  await expect(referralRow(page, "Status")).toContainText("Decided");
  await expect(summaryRow(page, "New surname")).toContainText("Nakamura");
  // The fee reference was seeded on the case; api's judicial view carries no payment data, so it is nowhere here.
  await expect(page.locator("body")).not.toContainText(seeded.feeReference);

  // The link opens the document viewer; the viewer's own journey is `document-viewer.spec.ts`, so this only follows
  // its **Download original** to the bytes.
  await page.getByRole("link", { name: "Birth certificate for the judge" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Birth certificate for the judge");
  const original = page.getByRole("link", { name: "Download original" });
  const file = await page.request.get((await original.getAttribute("href")) ?? "");
  expect(file.status()).toBe(200);
  expect(file.headers()["content-type"]).toContain("application/pdf");
  expect(file.headers()["content-disposition"]).toMatch(/^attachment/);
  expect(file.headers()["x-content-type-options"]).toBe("nosniff");
  await page.getByRole("link", { name: "Back to referral" }).click();

  await expect(directButton(page)).toHaveCount(0);
  await expectNoAccessibilityViolations(page);

  // ── change it: the same form, prefilled, and the same attestation in the words of a change ─────────────────
  await page.getByRole("link", { name: "Change your direction" }).click();
  await expect(page).toHaveURL(`${POOL_PATH}/${seeded.referralId}/direction?change=1`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Change your direction");
  await expect(page.getByRole("radio", { name: "Approved" })).toBeChecked();
  await expect(gazetteAnswer(page, "No")).toBeChecked();
  await expect(page.getByLabel("Directions/Reasons")).toHaveValue("Approved on the papers.");

  await fillDirection(page, { decision: "Rejected", directions: "Further evidence of the change is needed.", gazette: "No" });
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Check your changed direction");
  await expect(page.getByText("Your earlier direction stays on record, and the office is told you changed it.")).toBeVisible();
  await expectNoAccessibilityViolations(page);
  await page.getByRole("button", { name: "Confirm and change the direction" }).click();

  await expect(page).toHaveURL(`${POOL_PATH}/${seeded.referralId}?direction=changed`);
  await expect(page.getByRole("alert")).toContainText("Your direction has been changed.");
  await expect(referralRow(page, "Status")).toContainText("Decided");
  await expect(summaryRow(page, "Directions/Reasons")).toContainText("Further evidence of the change is needed.");

  // ── withdraw it: a confirmation, then the referral with this judge and waiting for a new direction ──────────
  await page.getByRole("link", { name: "Withdraw your direction" }).click();
  await expect(page).toHaveURL(`${POOL_PATH}/${seeded.referralId}/withdraw`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Withdraw your direction");
  await expect(page.getByText("Until you do, this referral stays with you.")).toBeVisible();
  await expectNoAccessibilityViolations(page);
  await page.getByRole("button", { name: "Withdraw direction" }).click();

  await expect(page).toHaveURL(`${POOL_PATH}/${seeded.referralId}?direction=withdrawn`);
  await expect(page.getByRole("alert")).toContainText("Your direction has been withdrawn. Record a new direction.");
  await expect(referralRow(page, "Status")).toContainText("Claimed");
  await expect(referralRow(page, "Direction due by")).toBeVisible();
  await expect(page.getByRole("link", { name: "Change your direction" })).toHaveCount(0);

  // ── and direct again, as for any referral waiting for a direction ───────────────────────────────────────────
  await directButton(page).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Record a direction");
  await fillDirection(page, { decision: "Approved", directions: "Approved after reconsideration.", gazette: "No" });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Confirm and record the direction" }).click();

  await expect(page).toHaveURL(`${POOL_PATH}/${seeded.referralId}?direction=recorded`);
  await expect(referralRow(page, "Status")).toContainText("Decided");
  await expect(summaryRow(page, "Directions/Reasons")).toContainText("Approved after reconsideration.");
});

/**
 * One referral's life across both personas — `docs/plans/referrals-admin-6-judicial-my-referrals.md`, rebuilt for
 * assignment.
 *
 * **What only a browser can show here:**
 *
 * - **"Mine" survives the session becoming somebody else and back.** api answers it from the token's IDAM
 *   subject, so the list is the same after a round trip through the caseworker persona — which a list derived from
 *   session state, browser history or rows previously seen could not manage.
 * - **Terminal removal is cross-persona.** The row leaves only when a *caseworker* marks the direction actioned,
 *   so nothing the judge's own session does can be what removes it.
 *
 * **It signs itself in and must keep doing so.** Do not give it `JUDGE_STORAGE_STATE`: a persona switch calls
 * `signIn`, which regenerates the session id and destroys the server-side session behind the restored cookie — so
 * the journeys above, which share that state, would be signed out mid-run. `persona-switcher.spec.ts` records the
 * same reasoning at length. `PERSONA_SWITCHER_ENABLED=true` on `dev:nowatch:web` is what makes the strip render.
 */
test.describe("across both personas", () => {
  test.use({ storageState: undefined });

  test("a Master finds an assigned referral on My referrals, directs it, and loses the row when the office actions it", async ({ page, request }) => {
    // **The storage-state opt-out, asserted rather than assumed.** A context that had restored the shared judge
    // session would still land on My referrals, and the first persona switch would then destroy a session the
    // journeys above are using.
    expect(await page.context().cookies()).toEqual([]);

    const master = await judgePersonaMaster(request);
    const seeded = await seedReferral(request, { reason: "Minor", masterId: master.id, urgent: true });

    await signInAsJudge(page);

    const assigned = myReferralsRow(page, seeded.referralId);
    expect(await placeOf(assigned)).toEqual({ section: URGENT_SECTION, day: null });
    await expect(assigned).toContainText("Applicant is a minor");
    await expect(assigned).toContainText(`Referred ${shortDate(seeded.createdOn)}`);
    await expectNoApplicationData(page, seeded);
    await expectNoAccessibilityViolations(page);
    // The judicial lists' navigation went with the pool: one list needs no navigation.
    await expect(page.getByRole("navigation", { name: "Referral lists" })).toHaveCount(0);

    // **The other rendering this page has.** A judge holding nothing cannot be arranged on a shared store, but a
    // page past the end reaches the same branch, which is what the axe check needs.
    await page.goto(`${MINE_PATH}?page=99`);
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("My referrals");
    await expectNoAccessibilityViolations(page);

    // ── to the caseworker and back ─────────────────────────────────────────────────────────────────────────────
    await switchTo(page, "Caseworker").click();
    await expect(page).toHaveURL(CASE_LIST_PATH);
    // A caseworker is offered no door the `/judicial/**` gate would then shut.
    await expect(page.locator(`a[href^="${POOL_PATH}"]`)).toHaveCount(0);
    await switchTo(page, "Master").click();
    await expect(page).toHaveURL(MINE_PATH);

    const recovered = myReferralsRow(page, seeded.referralId);
    await expect(recovered).toHaveCount(1);
    await recovered.getByRole("link").click();
    await expect(page).toHaveURL(`${POOL_PATH}/${seeded.referralId}`);
    await expect(referralRow(page, "Status")).toContainText("Claimed");

    // The direction, in the fewest steps that reach it: the form and the attestation are the first journey's.
    await directButton(page).click();
    await fillDirection(page, { decision: "Approved", directions: "Approved on the papers.", gazette: "No" });
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Confirm and record the direction" }).click();

    await expect(page).toHaveURL(`${POOL_PATH}/${seeded.referralId}?direction=recorded`);
    await expect(referralRow(page, "Status")).toContainText("Decided");
    // Still the judge's own work until the office has acted on it.
    await page.getByRole("link", { name: "Back to My referrals" }).click();
    await expect(page).toHaveURL(MINE_PATH);
    expect(await placeOf(myReferralsRow(page, seeded.referralId))).toEqual({ section: DIRECTED_SECTION, day: `${shortDate(seeded.createdOn)} referrals` });

    // ── the office actions the direction, which is the only thing that removes the row ─────────────────────────
    await switchTo(page, "Caseworker").click();
    await page.goto(`${CASE_LIST_PATH}/${seeded.caseId}/referrals/${seeded.referralId}`);

    // The same referral in the caseworker's vocabulary: the office reads what it has been sent.
    await expect(summaryRow(page, "Referral status")).toContainText("Direction received");
    await page.getByRole("button", { name: "Mark direction as actioned" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Confirm the direction has been actioned");
    await page.getByRole("button", { name: "Mark direction as actioned" }).click();

    await expect(page).toHaveURL(`${CASE_LIST_PATH}/${seeded.caseId}/referrals/${seeded.referralId}?close=actioned`);
    await expect(page.getByRole("alert")).toContainText("The direction has been marked as actioned.");

    // ── back as the judge, and the row has gone ────────────────────────────────────────────────────────────────
    await switchTo(page, "Master").click();
    await expect(page).toHaveURL(MINE_PATH);
    await expect(myReferralsRow(page, seeded.referralId)).toHaveCount(0);

    // Out of sight entirely rather than merely off a list: a closed referral is the same 404 as one that never
    // existed, and the page says so without saying who had it.
    const gone = await page.goto(`${POOL_PATH}/${seeded.referralId}`);
    expect(gone?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("This referral is no longer available");
    await expect(page.locator("body")).not.toContainText(CASEWORKER_EMAIL);
    await page.getByRole("link", { name: "Back to My referrals" }).click();
    await expect(page).toHaveURL(MINE_PATH);
  });
});

/**
 * The persona boundary, from the other side.
 *
 * **The Team leader rather than the roleless caseworker, deliberately.** `caseworker-deedpoll-team-leader` holds
 * the staff capabilities, and the mistake worth pinning is the assumption that it is a superset of the judicial
 * role. Both directions of the middleware itself are unit-tested in `src/auth/require-role.test.ts`; what needs a
 * browser is that the gate is *mounted* on the running app.
 *
 * Its own `describe` because that is the only place Playwright honours a second `test.use` in one file.
 */
test.describe("without the judicial role", () => {
  test.use({ storageState: TEAM_LEADER_STORAGE_STATE });

  test("Team leader is refused the judicial area and is not sent to it", async ({ page }) => {
    // `/` resolves the persona, and a Team leader's is the case list.
    await page.goto("/");
    await expect(page).toHaveURL("/deed-polls");
    await expect(page.locator(`a[href^="${POOL_PATH}"]`)).toHaveCount(0);

    // Every judicial URL, including the old pool's redirect and one naming a referral id that exists nowhere: the
    // gate is the area's and fires before anything is resolved, so the refusal is 403 rather than a 404 that would
    // say whether there was something there. The 404 *view* on a 403 status is `src/errors.ts`'s deliberate choice.
    for (const path of [
      POOL_PATH,
      MINE_PATH,
      `${MINE_PATH}?page=2`,
      `${POOL_PATH}/00000000-0000-0000-0000-000000000000`,
      `${POOL_PATH}/00000000-0000-0000-0000-000000000000/direction`
    ]) {
      const response = await page.goto(path);

      expect(response?.status(), `${path} should be refused`).toBe(403);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
      await expect(page.locator("body")).not.toContainText("My referrals");
    }
  });
});

/**
 * An application with a referral assigned to `masterId`, and the facts the journey needs back.
 *
 * **The case goes through `POST /__mock/cases` and the referral through the contract route**, with the Master
 * chosen as the raise form chooses one: a referral's state is api's state machine, and a fixture that wrote it
 * directly would teach this screen an assignment api's own rules cannot produce.
 */
async function seedReferral(request: APIRequestContext, options: { reason: string; masterId: string; urgent: boolean }): Promise<SeededReferral> {
  const seeded = await seedCase(request, {});

  const raised = await request.post(`${MOCK_API_URL}/caseworker/cases/${seeded.caseId}/referrals`, {
    headers: bearer({ sub: CASEWORKER_EMAIL }),
    data: {
      // A minor's referral names what kind it is, as api refuses `Minor` alone since api#156.
      reasons: options.reason === "Minor" ? ["Minor", "MinorCourtOrder"] : [options.reason],
      notes: "Please consider the applicant's circumstances.",
      masterId: options.masterId,
      ...(options.urgent ? { urgency: "Urgent", urgencyReason: "Hearing listed on Friday." } : { urgency: "Normal" })
    }
  });
  expect(raised.status(), await raised.text()).toBe(201);
  const referral = await raised.json();

  return { ...seeded, referralId: referral.id, createdOn: referral.createdOn, directionDueBy: referral.directionDueBy };
}

/**
 * A case with nothing referred yet.
 *
 * **The names, reference and fee reference are unique per call**, because the mock's store is shared with every
 * other spec in the run and outlives the run itself: the disclosure assertion is "this string is nowhere on the
 * page", which a *shared* value in some other case's row could falsify. Received in July, so the dates collide
 * with no other seeder's.
 */
async function seedCase(request: APIRequestContext, options: { note?: string }): Promise<SeededCase> {
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
  expect(created.status(), await created.text()).toBe(201);
  const caseId = (await created.json()).id;

  if (options.note) {
    // A note the office typed, so the judicial screen's absence check has something real to fail against.
    const noted = await request.post(`${MOCK_API_URL}/caseworker/cases/${caseId}/notes`, {
      headers: bearer({ sub: CASEWORKER_EMAIL }),
      data: { note: options.note }
    });
    expect(noted.status(), await noted.text()).toBe(201);
  }

  return { caseId, reference, feeReference };
}

/**
 * The caseworker's half: the raise form, as a Team leader in a context of their own, choosing `master` on the
 * Master question. Returns the referral's id, read off the row that links to it.
 *
 * A restored Team leader session rather than a sign-in, which is safe because this only reads the session.
 */
async function raiseThroughTheForm(browser: Browser, caseId: string, master: Master): Promise<string> {
  const context = await browser.newContext({ storageState: TEAM_LEADER_STORAGE_STATE });

  try {
    const page = await context.newPage();
    await page.goto(`${CASE_LIST_PATH}/${caseId}/referrals/new`);
    await page.getByLabel("Non-publication request").check();
    await page.getByLabel("Standard", { exact: true }).check();
    await page.getByRole("radio", { name: master.name, exact: true }).check();
    await page.getByRole("button", { name: "Raise referral" }).click();

    await expect(page).toHaveURL(`${CASE_LIST_PATH}/${caseId}#referrals`);
    const referrals = page.locator("#referrals");
    await expect(referrals.locator(".govuk-tag")).toHaveText(`With ${master.name}`);
    const href = await referrals.getByRole("link", { name: /view this referral/ }).getAttribute("href");

    return (href ?? "").split("/").pop() ?? "";
  } finally {
    await context.close();
  }
}

/** The referral as the judge persona's api sees it, for the two dates its rows print. */
async function judicialReferral(request: APIRequestContext, referralId: string): Promise<{ createdOn: string; directionDueBy: string }> {
  const response = await request.get(`${MOCK_API_URL}${POOL_PATH}/${referralId}`, { headers: bearer({ sub: JUDGE_EMAIL }) });
  expect(response.status(), await response.text()).toBe(200);

  return response.json();
}

/**
 * One referral's row on **My referrals**, having navigated there.
 *
 * Located by the row's link `href`, which is the one thing that identifies it: api's summary carries no reference
 * and no applicant. The page asks api for its maximum page size, so on a fresh mock every row is on page 1.
 */
function myReferralsRow(page: Page, referralId: string): Locator {
  return page.locator("tbody tr").filter({ has: page.locator(`a[href="${POOL_PATH}/${referralId}"]`) });
}

/**
 * Which section and day heading a row sits under: the nearest `h2` before its table, and the nearest `h3` after
 * that `h2`, if any. Read off the document because the grouping is the thing under test.
 */
async function placeOf(row: Locator): Promise<{ section: string | null; day: string | null }> {
  await expect(row).toHaveCount(1);
  if (new URL(row.page().url()).pathname !== MINE_PATH) throw new Error("placeOf reads My referrals");

  return row.evaluate((element) => {
    let day: string | null = null;
    for (let node = element.closest("table")?.previousElementSibling ?? null; node; node = node.previousElementSibling) {
      if (node.tagName === "H3" && day === null) day = node.textContent?.trim() ?? null;
      if (node.tagName === "H2") return { section: node.textContent?.trim() ?? null, day };
    }
    return { section: null, day };
  });
}

/** The three controls on the direction form, in the order it asks them. The radios are checked by their labels. */
async function fillDirection(page: Page, direction: { decision: string; directions: string; gazette: string }): Promise<void> {
  await page.getByRole("radio", { name: direction.decision }).check();
  await gazetteAnswer(page, direction.gazette).check();
  await page.getByLabel("Directions/Reasons").fill(direction.directions);
}

/** The Gazette question's Yes or No, scoped to its own fieldset because this is the answer that cannot be taken back. */
function gazetteAnswer(page: Page, answer: string): Locator {
  return page.getByRole("group", { name: "Are there any changes to the standard publications in the Gazette?" }).getByRole("radio", { name: answer });
}

/**
 * A `govukSummaryList` row, addressed by its **key** rather than by its text: a summary-list row has no accessible
 * name, and the values this file asserts appear in several places on the same page. Anchored on the key cell, so
 * "Status" does not also answer to "Marital status".
 */
function summaryRow(page: Page, key: string): Locator {
  const keyCell = page.locator(".govuk-summary-list__key").filter({ hasText: exactText(key) });

  return page.locator(".govuk-summary-list__row").filter({ has: keyCell });
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
 * One persona's switch button, by its accessible name — `persona-switcher.spec.ts`'s helper. `exact`, because the
 * visually hidden prefix makes one persona's name a substring of another's.
 */
function switchTo(page: Page, persona: string): Locator {
  return page.getByRole("button", { name: `Switch to ${persona}`, exact: true });
}

/**
 * My referrals carries nothing about the application — decision 3, and api's DTO rather than a filter here.
 * Asserted over the whole page: a reference in a caption or a heading would be the same disclosure.
 */
async function expectNoApplicationData(page: Page, seeded: SeededCase): Promise<void> {
  await expect(page.locator("body")).not.toContainText(seeded.reference);
  await expect(page.locator("body")).not.toContainText(seeded.feeReference);
  await expect(page.locator("body")).not.toContainText("Nakamura");
}

/**
 * "Record a direction" — an anchor in the markup, but `getByRole("button")` all the same: `govukButton` given an
 * `href` renders `<a role="button">`, so a locator reaching for `link` finds nothing and every absence assertion
 * passes for the wrong reason.
 */
function directButton(page: Page): Locator {
  return page.getByRole("button", { name: "Record a direction" });
}

/**
 * `formatShortDate` as `libs/deed-poll/src/deed-poll/case-header.ts` renders it: the instant's `dd-mm-yy` day in
 * Europe/London. Restated rather than imported, so a change of format is two implementations disagreeing. api's
 * timestamps are zoneless and the app reads them as UTC (`toUtcDate`), which is the one part restated exactly.
 */
function shortDate(raw: string): string {
  const when = new Date(/^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(raw) ? `${raw}Z` : raw);

  return when.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "Europe/London" }).replaceAll("/", "-");
}

/**
 * The Welsh *shape* of the judicial pages, not Welsh content: `cy` holds English here as it does on every
 * deed-poll page, so what this catches is a **missing** `cy` key, which renders blank rather than erroring.
 *
 * **In a context and session of its own**: `localeMiddleware` persists the chosen language to
 * `req.session.locale`, so `?lng=cy` is a *write* to a session every test restoring `JUDGE_STORAGE_STATE` shares.
 * `storageState: undefined` is load-bearing, or `browser.newContext()` inherits this file's `test.use`.
 */
async function expectWelshKeysResolve(browser: Browser, referralId: string): Promise<void> {
  const context = await browser.newContext({ storageState: undefined });

  try {
    const page = await context.newPage();
    await signInAsJudge(page);
    await page.goto(`${MINE_PATH}?lng=cy`);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("My referrals");
    await expect(page.getByRole("heading", { level: 2, name: URGENT_SECTION })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: AWAITING_SECTION })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Reasons for referral" }).first()).toBeVisible();
    // The language toggle offers English, which is how the page says it rendered as Welsh at all.
    await expect(page.locator(".language")).toContainText("English");

    await page.goto(`${POOL_PATH}/${referralId}?lng=cy`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Referral to a Master");
    await expect(summaryRow(page, "Reasons for referral")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Supporting documents" })).toBeVisible();
    await expect(directButton(page)).toBeVisible();
  } finally {
    await context.close();
  }
}

/**
 * Checked inline at each point of the journey rather than in a test of its own, per `.claude/rules/e2e-testing.md`.
 * **No exclusions, deliberately** — every judicial page passes without them.
 */
async function expectNoAccessibilityViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();

  expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target).join(", ")}`)).toEqual([]);
}

/** What `seedCase` gives the journey: the values to assert on the page, and the case for the office's half. */
interface SeededCase {
  /** For the caseworker half only: api's judicial surface takes no case id and publishes none. */
  caseId: string;
  reference: string;
  /** The admin-only field that must appear nowhere on a judicial screen. */
  feeReference: string;
}

/** A seeded case and the referral raised on it, with the two dates My referrals prints. */
interface SeededReferral extends SeededCase {
  referralId: string;
  createdOn: string;
  directionDueBy: string;
}
