/**
 * Telling the applicant their application was refused, end to end in a browser —
 * `docs/plans/notify-2-caseworker-email-tab.md`.
 *
 * **Two tests: the send that goes, and the send api refuses.** The first is one story — the tab explaining why
 * nothing can be sent yet, the button that appears once a Master has refused, the wording, the check page, the
 * send, the content page, and a second click that is a success rather than a failure — so the validation,
 * accessibility and Welsh checks are made at the points it already passes through, per
 * `.claude/rules/e2e-testing.md`. The second is a different journey: nothing typed is wrong and no wording can
 * fix it.
 *
 * **What only a browser can show here, and why this file earns its keep:**
 *
 * - **The preview is a sandboxed frame, and the attribute is the whole of decision 3.** `email-preview.njk.test.ts`
 *   asserts it on the rendered template; this asserts that the page the running app serves carries it, with
 *   Notify's own markup inside the `srcdoc` rather than interpolated into the admin page.
 * - **The journey keeps the caseworker's typing across three round trips.** Compose posts to the check page, the
 *   check page posts back to compose, and the send posts a third time. The page tests drive one handler with a
 *   stubbed domain; only a form and a browser show that what came back is what was typed — and that the check
 *   page's "Change the wording" is a submit rather than a link (Task 5's decision 3).
 * - **A redundant send is a success.** api's insert is `ON CONFLICT DO NOTHING` per referral, so a second send
 *   answers 200 with `enqueued: false` and the first row's id. What that must produce is one email in the history
 *   and a banner saying it had already gone — not a second row, and not an error.
 * - **Nothing on either surface may read as proof of receipt** (decision 10). Asserted on the whole rendered tab
 *   and the whole rendered content page, which is the half a view-model test cannot reach.
 *
 * **api's 409 is deliberately not driven from here, and that is a fact about the mock rather than a gap.** A 409
 * means the case is in no state to send this email, and `loadEmailJourney` 404s on exactly that condition when the
 * page loads — so reaching the 409 needs the case to stop being sendable *between* the compose read and the send,
 * which nothing in the contract can do to a Rejected referral. It is covered where it can be:
 * `emails/[template]/send.test.ts`.
 *
 * The caseworker signs in as `admin@example.com`, this file's storage state, because nothing here is gated on a
 * role: api gates neither preview nor send on `caseworker-deedpoll-admin`, and the Email tab is every
 * caseworker's.
 */
import { AxeBuilder } from "@axe-core/playwright";
import { type APIRequestContext, type Browser, expect, type Locator, type Page, test } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_STORAGE_STATE, DEPLOYED_STACK_SKIP_REASON, RUNS_AGAINST_DEPLOYED_STACK, signInAsAdmin } from "./idam-session.js";

/** The mock api, which `playwright.config.ts` starts on 3200 beside the app on 3000. */
const MOCK_API_URL = process.env.DEED_POLL_API_URL ?? "http://localhost:3200";

/** The one template api ships, as its URL token — `EmailTemplate.APPLICATION_REJECTED`'s key. */
const TEMPLATE = "application-rejected";

/**
 * The words the Master typed into their direction, which api pre-populates `judges_reason` from.
 *
 * Asserted in the form, so this is the evidence that the default travelled from the referral through
 * `slotDefaults` and into the control without the compose page spending one of Notify's rate-limited preview
 * calls to discover it — decisions 8 and 9.
 */
const MASTER_REASON = "The evidence supplied does not establish the applicant's identity.";

/** The judge whose direction refuses the application. Not a signed-in session — see `bearer`. */
const SEED_JUDGE = "e2e.emailjudge@example.com";

test.skip(RUNS_AGAINST_DEPLOYED_STACK, DEPLOYED_STACK_SKIP_REASON);
test.use({ storageState: ADMIN_STORAGE_STATE });

test("caseworker tells a refused applicant why, checks the wording first, and is told when it had already gone", async ({ page, request, browser }) => {
  // Three times the default timeout, because this is one journey rather than a slow one: four form round trips, six
  // axe scans and a second sign-in for the Welsh check run to about 40 seconds locally, and the 30-second default
  // was reached mid-scan — which reports as a protocol error inside `AxeBuilder` and reads as a fault in the page.
  // Splitting the journey to fit would cost exactly what this file is for: that the typing survives each step.
  test.slow();

  // Arrange: a case with an applicant to write to and no referral at all, so the tab's first state is the one a
  // caseworker meets most often — there is nothing to tell the applicant about yet.
  const seeded = await seedCase(request, { applicantEmail: "applicant@example.com" });

  await page.goto(`/deed-polls/${seeded.id}`);
  await page.getByRole("tab", { name: "Emails" }).click();
  const emails = page.locator("#emails");

  // Nothing sent and nothing sendable. The reason is api's own sentence rather than a missing button: an absent
  // control with no explanation is what a caseworker reads as a bug (decision 10 of Task 3's inheritance).
  await expect(emails).toContainText("None recorded.");
  await expect(emails).toContainText("This case has no referral that a Master has refused");
  await expect(sendButton(page)).toHaveCount(0);
  await expectNoAccessibilityViolations(page);

  // The refusal itself, driven through the contract routes rather than written onto the case: api derives
  // applicability from a referral a Master has refused, so a fixture that set it directly would teach the tab a
  // state api's own state machine cannot produce. Same reasoning as `deed-polls.spec.ts`'s `referTo`.
  await refuseApplication(request, seeded.id, MASTER_REASON);

  await page.reload();
  await page.getByRole("tab", { name: "Emails" }).click();
  await expect(emails).not.toContainText("This case has no referral that a Master has refused");

  await sendButton(page).click();

  // Step one: the wording, with the Master's own words already in it — and `snake_case` control names, which is
  // the mistake no other test catches: they are GOV.UK Notify placeholder names, so a camelCase one would send
  // the applicant a refusal with an empty quotation in it.
  await expect(page).toHaveURL(`/deed-polls/${seeded.id}/emails/${TEMPLATE}/compose`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Write the email");
  await expect(masterReason(page)).toHaveValue(MASTER_REASON);
  await expect(masterReason(page)).toHaveAttribute("name", "judges_reason");
  await expect(additionalNotes(page)).toHaveValue("");
  await expect(additionalNotes(page)).toHaveAttribute("name", "additional_notes");
  await expectNoAccessibilityViolations(page);

  // A refusal quoting a judge as having said nothing is the failure this required check exists for, and it has to
  // be reported without losing the notes typed beside it — the caseworker would otherwise pay for one mistake
  // twice.
  await additionalNotes(page).fill("Your fee will be refunded.");
  await masterReason(page).fill("   ");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("alert")).toContainText("There is a problem");
  await expect(page.getByRole("alert").getByRole("link", { name: /Enter the Master's reason/ })).toHaveAttribute("href", "#judges_reason");
  await expect(additionalNotes(page)).toHaveValue("Your fee will be refunded.");
  await expectNoAccessibilityViolations(page);

  await masterReason(page).fill(MASTER_REASON);
  await page.getByRole("button", { name: "Continue" }).click();

  // Step two: the real email as GOV.UK Notify renders it, which is mandatory because sending cannot be undone.
  await expect(page).toHaveURL(`/deed-polls/${seeded.id}/emails/${TEMPLATE}/preview`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Check the email before sending");
  await expect(subjectRow(page)).toContainText(seeded.reference);
  await expect(page.getByText("Once this email has been sent it cannot be recalled or edited.")).toBeVisible();

  // Decision 3, from outside the template: the rendering is inside a frame that can reach nothing, and it is in
  // `srcdoc` rather than in the page. `sandbox` is empty — no `allow-scripts`, no `allow-same-origin` — so a
  // later "simplification" to `| safe` fails here as well as in `email-preview.njk.test.ts`.
  const frame = page.locator("iframe.app-email-preview");
  await expect(frame).toHaveAttribute("sandbox", "");
  await expect(frame).toHaveAttribute("title", /Preview of the email/);
  // Notify's own markup, carried as an attribute value: the caseworker's words are in the email that will go, and
  // nothing in it is an element of this page. Read as an attribute rather than through the frame's document, which
  // is the point — an opaque origin with no scripts is not somewhere this page can look.
  expect(await frame.getAttribute("srcdoc")).toContain(`<p>${MASTER_REASON}</p>`);
  await expectNoAccessibilityViolations(page);

  // Back to the wording, which is a submit and not a link precisely so the typing survives it.
  await page.getByRole("button", { name: "Change the wording" }).click();

  await expect(page).toHaveURL(`/deed-polls/${seeded.id}/emails/${TEMPLATE}/compose`);
  await expect(masterReason(page)).toHaveValue(MASTER_REASON);
  await expect(additionalNotes(page)).toHaveValue("Your fee will be refunded.");

  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Send the email" }).click();

  // Step three: back to the tab with a banner, rather than a confirmation page of its own — decision 2 asked for
  // the tab, because what a caseworker does next is read the case.
  await expect(page).toHaveURL(new RegExp(`/deed-polls/${seeded.id}\\?email=sent&emailId=[0-9a-f-]{36}#emails`));
  // Located by class rather than by role: a success banner carries `role="alert"` rather than the `region` an
  // "Important" one has, and an error summary would answer to the same role.
  const banner = page.locator(".govuk-notification-banner--success");
  await expect(banner).toContainText("accepted by GOV.UK Notify");

  await page.getByRole("tab", { name: "Emails" }).click();
  await expect(emails).toContainText("1 email");
  await expect(emails).toContainText("Application rejected");
  // The state in the words the service can stand behind, and the sentence saying what they do not mean.
  await expect(emails.locator(".govuk-tag")).toHaveText("Accepted by Notify");
  await expect(emails).toContainText("It is not confirmation that the applicant received or read it");
  await expectNoReceiptClaim(emails);
  await expectNoAccessibilityViolations(page);

  await banner.getByRole("link", { name: "View the email" }).click();

  // The content page: the wording as text, labelled as the wording rather than as the email, because the applicant
  // read Notify's branded HTML around it (decisions 12 and 13).
  await expect(page).toHaveURL(new RegExp(`/deed-polls/${seeded.id}/emails/[0-9a-f-]{36}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Email to the applicant");
  await expect(page.getByRole("heading", { name: "The wording that was sent" })).toBeVisible();
  await expect(page.getByText(MASTER_REASON)).toBeVisible();
  await expect(page.getByText("Your fee will be refunded.")).toBeVisible();
  await expect(sentToRow(page)).toContainText("applicant@example.com");
  // Every email today carries nothing, and the row says so rather than leaving a cell empty beside the question.
  await expect(documentsRow(page)).toContainText("None");
  // The author is api's, derived from the token the page forwarded — the subject rather than "An Admin" because
  // the mock has no IDAM to resolve a display name from, as the case header's author is.
  await expect(createdRow(page)).toContainText(ADMIN_EMAIL);
  await expectNoReceiptClaim(page.locator("main"));
  await expectNoAccessibilityViolations(page);

  await expectWelshKeysResolve(browser, `/deed-polls/${seeded.id}/emails/${TEMPLATE}/compose`);

  // The second click, which is the case the journey's token exists to make rare rather than the case it handles:
  // api answers the first row's id with `enqueued: false`, so this is a success with its own wording and the
  // history still holds one email.
  await page.goto(`/deed-polls/${seeded.id}/emails/${TEMPLATE}/compose`);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Send the email" }).click();

  await expect(page).toHaveURL(new RegExp(`/deed-polls/${seeded.id}\\?email=already-sent&emailId=[0-9a-f-]{36}#emails`));
  await expect(page.locator(".govuk-notification-banner--success")).toContainText("had already been sent for this case, so it was not sent again");
  await page.getByRole("tab", { name: "Emails" }).click();
  await expect(emails).toContainText("1 email");
  // No axe check here, and that is not an oversight: this is the same tab as the render above with one sentence of
  // the banner different, so a second scan of it would cost the journey four seconds to re-check nothing.
  await expect(emails.locator("tbody tr")).toHaveCount(1);
});

/**
 * The send api refuses, on the check page rather than on an error page — Task 5's decision 4.
 *
 * An applicant with no email address is the live example and the common one: api answers 422 addressed to
 * `applicantEmail`, which this form has no control for, so nothing the caseworker typed is wrong and no wording
 * would fix it. What must happen is api's own sentence where it can be read in full, the Send button withheld, and
 * the typing kept for whoever fixes the case and comes back.
 *
 * **The button is offered for such a case, and that is api's shape rather than an oversight.** Availability
 * answers whether a Master has refused the application; the recipient is checked at the send. So this journey is
 * reachable from the tab exactly as a caseworker reaches it.
 */
test("caseworker is told why a send was refused, on the page they were checking, without losing their wording", async ({ page, request }) => {
  // Arrange: a refused application whose case carries no email address at all.
  const seeded = await seedCase(request, {});
  await refuseApplication(request, seeded.id, MASTER_REASON);

  await page.goto(`/deed-polls/${seeded.id}/emails/${TEMPLATE}/compose`);
  await additionalNotes(page).fill("Ring the applicant if this bounces.");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("button", { name: "Send the email" })).toBeVisible();
  await page.getByRole("button", { name: "Send the email" }).click();

  // Still the check page, with the refusal led by its own sentence and api's detail behind it — and no Send,
  // because there is nothing a second click could achieve.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Check the email before sending");
  await expect(page.getByRole("alert")).toContainText("This email cannot be sent for this case.");
  await expect(page.getByRole("alert")).toContainText("no email address");
  await expect(page.getByRole("button", { name: "Send the email" })).toHaveCount(0);
  await expectNoAccessibilityViolations(page);

  // And the way back keeps what was typed, which is what makes the refusal recoverable rather than a dead end.
  await page.getByRole("button", { name: "Change the wording" }).click();
  await expect(masterReason(page)).toHaveValue(MASTER_REASON);
  await expect(additionalNotes(page)).toHaveValue("Ring the applicant if this bounces.");

  // Nothing was sent, so the tab still says so — the refusal is not a half-send.
  await page.goto(`/deed-polls/${seeded.id}`);
  await page.getByRole("tab", { name: "Emails" }).click();
  await expect(page.locator("#emails")).toContainText("None recorded.");
});

/**
 * A case seeded through the mock's control route, because what a create does is not what is being tested here.
 *
 * **Unique per test, because the mock's store outlives the run** — `reuseExistingServer` — and every spec shares
 * it. A reference of its own keeps this case's rows out of any other journey's list assertions, and the five-digit
 * shape is the only one api allocates; the leading `4` is what the other seeders' leads leave free.
 *
 * The old name is seeded because the rendered email quotes it, so an email with nothing to quote would read as
 * plausible while saying nothing.
 */
async function seedCase(request: APIRequestContext, fields: Record<string, unknown>): Promise<{ id: string; reference: string }> {
  const reference = `KBDP2026-4${String(Math.floor(Date.now() / 1000)).slice(-4)}`;
  const response = await request.post(`${MOCK_API_URL}/__mock/cases`, {
    data: {
      type: "Adult",
      state: "Received",
      displayReference: reference,
      dateReceived: "2026-08-03T00:00:00.000",
      oldForename: "Sam",
      oldSurname: "Smith",
      newForename: "Sam",
      newSurname: `Emailby${Date.now().toString(36)}`,
      ...fields
    }
  });
  // Asserted, because a rejected seed leaves the journey looking at a case that was never created and the failure
  // surfaces several steps later as a 404 nobody asked for.
  expect(response.status(), await response.text()).toBe(201);

  return { id: (await response.json()).id, reference };
}

/**
 * Refer the case, claim it as a judge and refuse it — which is what entitles the case to this email.
 *
 * Every step is checked: a refusal part-way leaves the referral in whatever state it reached, and the symptom is a
 * tab that still says no Master has refused the application, which reads as the feature being broken rather than
 * the arrangement.
 *
 * `directionsText` is what `judges_reason` is pre-populated from, so it is not optional here even though it is on
 * api's direction — a Rejected referral carrying none is the case api answers 400 for and the mock answers with an
 * empty default (flag 7 on the plan).
 */
async function refuseApplication(request: APIRequestContext, caseId: string, reason: string): Promise<void> {
  const raised = await request.post(`${MOCK_API_URL}/caseworker/cases/${caseId}/referrals`, { data: { reasons: ["Minor"] } });
  expect(raised.status(), await raised.text()).toBe(201);
  const referralId = (await raised.json()).id;

  const judge = bearer(SEED_JUDGE);
  const claimed = await request.post(`${MOCK_API_URL}/judicial/referrals/${referralId}/claim`, { headers: judge });
  expect(claimed.status(), await claimed.text()).toBe(200);

  const directed = await request.post(`${MOCK_API_URL}/judicial/referrals/${referralId}/direction`, {
    headers: judge,
    data: { decision: "Rejected", publishToGazette: false, directionsText: reason }
  });
  expect(directed.status(), await directed.text()).toBe(200);
}

/**
 * A bearer token carrying a subject and nothing else.
 *
 * The mock reads the subject out of the middle segment and never verifies a signature — `auditName` — so this is
 * enough to attribute a direction to a judge. It proves nothing about authentication, which the real sign-in the
 * `setup` project performs is what exercises.
 */
function bearer(subject: string): Record<string, string> {
  const claims = Buffer.from(JSON.stringify({ sub: subject }), "utf8").toString("base64url");

  return { authorization: `Bearer x.${claims}.signature` };
}

/**
 * The tab's send control, whose label carries the template's name — one button per sendable template rather than a
 * picker in front of a list of one, and the name is in the button's own text so it reads out of context.
 *
 * A `govukButton` with an `href` is an anchor carrying `role="button"`, so it is addressed as a button here exactly
 * as the other tabs' Add controls are in `deed-polls.spec.ts`.
 */
function sendButton(page: Page): Locator {
  return page.getByRole("button", { name: "Send an email: Application refused" });
}

/** The judge's words, which the applicant will read as a quotation. `judges_reason` on the wire. */
function masterReason(page: Page): Locator {
  return page.getByLabel("The Master's reason for refusing the application");
}

/** The caseworker's own addition, optional here and optional at api. `additional_notes` on the wire. */
function additionalNotes(page: Page): Locator {
  return page.getByLabel("Additional notes for the applicant (optional)");
}

function subjectRow(page: Page): Locator {
  return summaryRow(page, "Subject");
}

function sentToRow(page: Page): Locator {
  return summaryRow(page, "Sent to");
}

function documentsRow(page: Page): Locator {
  return summaryRow(page, "Documents attached");
}

function createdRow(page: Page): Locator {
  return summaryRow(page, "Created");
}

/**
 * A `govukSummaryList` row, addressed by its key for the reason `deed-polls.spec.ts` addresses its rows that way:
 * a summary-list row has no accessible name, and the values asserted here — an address, a reference, a state —
 * appear elsewhere on the same page.
 */
function summaryRow(page: Page, key: string): Locator {
  return page.locator(".govuk-summary-list__row", { hasText: key });
}

/**
 * Decision 10, asserted on rendered markup: nothing here may be read as proof the applicant got the email.
 *
 * api knows GOV.UK Notify accepted the send and nothing more — there are no delivery callbacks in this estate and
 * no download concept at all — so a caseworker who concluded from either screen that an applicant has their deed
 * poll, when the email bounced, is the failure the tab exists to prevent. Scoped to the panel or the page under
 * test rather than to the whole document, because the Documents tab legitimately says "Downloaded".
 *
 * The view models pin the same rule at their own level (`emails-view.test.ts`); this is the half that would catch
 * a well-meaning wording change made in a template.
 */
async function expectNoReceiptClaim(within: Locator): Promise<void> {
  const text = (await within.innerText()).toLowerCase();

  expect(text.match(/delivered|viewed|opened|downloaded/g) ?? []).toEqual([]);
}

/**
 * The Welsh *shape*, not Welsh content: every page carries `en` and `cy` with matching keys, but `cy` deliberately
 * holds English until there is a translation to put in it. What this catches is a missing `cy` key, which renders
 * blank rather than erroring.
 *
 * **In a context and session of its own, and `storageState: undefined` is load-bearing** — for the reasons
 * `deed-polls.spec.ts` records at length: `?lng=cy` is a *write* to `req.session.locale`, so doing it on the shared
 * admin session switches another spec into Welsh mid-run, and a context created without that option inherits this
 * file's storage state and is therefore never anonymous.
 */
async function expectWelshKeysResolve(browser: Browser, path: string): Promise<void> {
  const context = await browser.newContext({ storageState: undefined });

  try {
    const page = await context.newPage();
    await signInAsAdmin(page);
    await page.goto(`${path}?lng=cy`);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Write the email");
    await expect(masterReason(page)).toHaveValue(MASTER_REASON);
    await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
  } finally {
    await context.close();
  }
}

/**
 * Checked inline at each point of a journey rather than in a test of its own, per `.claude/rules/e2e-testing.md`.
 *
 * **No exclusions, deliberately** — every page in this journey passes without one, including the check page with
 * its sandboxed frame. A waiver would name the rule *and* the element, so the same rule anywhere else on the page
 * still fails; see `deed-polls.spec.ts`, which needs one for a govuk-frontend radio reveal.
 *
 * Reported as `id: selector` strings rather than raw violation objects so a failure names the rule and the element
 * instead of printing an unreadable object graph.
 */
async function expectNoAccessibilityViolations(page: Page, allowed: string[] = []): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const findings = results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target).join(", ")}`);

  expect(findings.filter((finding) => !allowed.includes(finding))).toEqual([]);
}
