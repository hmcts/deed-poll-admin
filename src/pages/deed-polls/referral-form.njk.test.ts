/**
 * The raise-a-referral form's markup, rendered rather than asserted through the view model.
 *
 * The model is asserted in `[id]/referrals/new.test.ts`. What this file exists for is the three properties a
 * model cannot show: that the notes textarea is inside `Other`'s conditional reveal and the urgency reason
 * inside `Urgent`'s — GOV.UK's reveal is markup, not state — that the form posts to its own route so a
 * re-render cannot send the second attempt somewhere else, and that the already-open conflict renders as a
 * summary message carrying a link rather than as an unattributed field error.
 *
 * The model comes from the page handler rather than being hand-built, so a name the handler stops passing
 * fails here too. `en` is spread over it because `renderInterceptorMiddleware` is what does that in a real
 * request, and the double does not run middleware.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConflictError, createReferral, findDeedPoll, findMasterChoices, findReferrals } from "@hmcts/deed-poll";
import nunjucks from "nunjucks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../express-doubles.js";
import { addPathFilters } from "../../path-filters.js";
import { GET, POST } from "./[id]/referrals/new.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPoll: vi.fn(),
  findReferrals: vi.fn(),
  findMasterChoices: vi.fn(),
  createReferral: vi.fn()
}));

// The three roots `configureGovuk` mounts, minus the assets — the same set as `index.njk.test.ts`.
const STARTER_VIEWS = path.join(fileURLToPath(import.meta.url), "../../../../libs/express-govuk-starter/src");
const environment = nunjucks.configure(
  [
    path.join(fileURLToPath(import.meta.resolve("govuk-frontend")), "..", ".."),
    path.join(STARTER_VIEWS, "govuk-frontend/views"),
    path.join(STARTER_VIEWS, "cookies/views"),
    path.join(fileURLToPath(import.meta.url), "../../..", "pages")
  ],
  { autoescape: true }
);
addPathFilters(environment);

const found = { id: "case-1", displayReference: "KBDP2026-00001", notes: [], witnesses: [], documents: [] };

/** api's Masters list at 09:00 on 28-10-26 (the clock is set to it): one with room, one full, one who has left. */
const MASTERS = {
  masters: [
    {
      id: "6c1f0d4e-2b3a-4c5d-8e9f-0a1b2c3d4e5f",
      name: "Master Sullivan",
      email: "sullivan@example.com",
      available: true,
      linked: true,
      revision: 0,
      assignedInWindow: 3
    },
    {
      id: "7d2a1e5f-3c4b-4d6e-9f0a-1b2c3d4e5f60",
      name: "Master Wren",
      email: "wren@example.com",
      available: false,
      linked: false,
      revision: 0,
      assignedInWindow: 0
    },
    {
      id: "8e3b2f60-4d5c-4e7f-a01b-2c3d4e5f6071",
      name: "Master Judge",
      email: "judge@example.com",
      available: true,
      linked: false,
      revision: 0,
      assignedInWindow: 10
    }
  ],
  window: { date: "2026-10-28", slot: "AM" },
  cap: 10
};
const SULLIVAN = MASTERS.masters[0].id;

const OPEN_REFERRAL = {
  id: "ref-9",
  state: "Open",
  reasons: ["Minor"],
  notes: null,
  urgency: "Normal",
  urgencyReason: null,
  migrated: false,
  createdBy: "A Caseworker",
  createdOn: new Date("2026-05-13T08:44:00Z"),
  modifiedBy: "A Caseworker",
  modifiedOn: new Date("2026-05-13T08:44:00Z")
};

/** Content pair first, the handler's own values over it — `renderInterceptorMiddleware`'s order. See `referral-detail.njk.test.ts`. */
const html = (model: Record<string, unknown>): string => environment.render("deed-polls/referral-form.njk", { ...(model.en as object), ...model });

function request(body: Record<string, unknown> = {}) {
  return pageRequest({ params: { id: "case-1" }, body, accessToken: "session-token" });
}

describe("raise a referral template", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findDeedPoll).mockResolvedValue(found as never);
    vi.mocked(createReferral).mockResolvedValue({ id: "ref-1" } as never);
    vi.mocked(findReferrals).mockResolvedValue([OPEN_REFERRAL] as never);
    vi.mocked(findMasterChoices).mockResolvedValue(MASTERS as never);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-28T09:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should post to its own route, so a re-render submits to the same place", async () => {
    const res = pageResponse();

    await GET(request(), res);
    const page = html(res.render.mock.calls[0][1]);

    expect(page).toContain('action="/deed-polls/case-1/referrals/new"');
    expect(page).toContain("novalidate");
  });

  it("should offer the six reasons as checkboxes labelled in the business's words", async () => {
    const res = pageResponse();

    await GET(request(), res);
    const page = html(res.render.mock.calls[0][1]);

    expect(page).toContain('value="Minor"');
    expect(page).toContain("Applicant is a minor");
    expect(page).toContain("Declarant requirements not met");
    expect(page).toContain('name="reasons"');
  });

  it("should reveal the notes only from the Other checkbox", async () => {
    const res = pageResponse();

    await GET(request(), res);
    const page = html(res.render.mock.calls[0][1]);

    // GOV.UK wires a reveal by pointing the checkbox at the id of the div holding the revealed content, so
    // the pairing is exactly what this asserts.
    const other = /<input[^>]*value="Other"[^>]*data-aria-controls="(?<target>[^"]+)"/.exec(page);
    expect(other?.groups?.target).toBeTruthy();
    const revealed = new RegExp(`id="${other?.groups?.target}"[\\s\\S]*?name="notes"`);
    expect(page).toMatch(revealed);
  });

  it("should reveal the reason for urgency only from the Urgent radio", async () => {
    const res = pageResponse();

    await GET(request(), res);
    const page = html(res.render.mock.calls[0][1]);

    const urgent = /<input[^>]*value="Urgent"[^>]*data-aria-controls="(?<target>[^"]+)"/.exec(page);
    expect(urgent?.groups?.target).toBeTruthy();
    const revealed = new RegExp(`id="${urgent?.groups?.target}"[\\s\\S]*?name="urgencyReason"`);
    expect(page).toMatch(revealed);
    // The standard option reveals nothing — there is nothing to ask about a referral in the ordinary queue.
    expect(page).toMatch(/<input[^>]*value="Normal"(?![^>]*data-aria-controls)/);
  });

  it("should put the ticked boxes and the typed text back when validation fails", async () => {
    const res = pageResponse();

    await POST(request({ masterId: SULLIVAN, reasons: ["Minor", "Other"], urgency: "Urgent" }), res);
    const page = html(res.render.mock.calls[0][1]);

    expect(page).toMatch(/<input[^>]*value="Minor"[^>]*checked/);
    expect(page).toMatch(/<input[^>]*value="Other"[^>]*checked/);
    expect(page).toMatch(/<input[^>]*value="Urgent"[^>]*checked/);
    // Both conditional rules failed, so both messages are on their controls and in the summary.
    expect(page).toContain("Enter the other reason for referring this case");
    expect(page).toContain("Enter why this referral is urgent");
    expect(page).toContain('href="#notes"');
    expect(page).toContain('href="#urgencyReason"');
  });

  // Master Sullivan's feedback (Steve, 2026-10-27): the minor's details are revealed beneath "Applicant is a minor",
  // posting api's one `reasons` field, with their own id for the error summary to link to.
  it("should reveal a minor's details beneath Applicant is a minor, posting as reasons", async () => {
    const res = pageResponse();

    await GET(request(), res);
    const page = html(res.render.mock.calls[0][1]);

    expect(page).toContain("What applies to the minor&#39;s application?");
    expect(page).toMatch(/<input[^>]*id="minorDetails"[^>]*name="reasons"[^>]*value="MinorTransgender"/);
    expect(page).toContain("16/17 year old applicant has not consented");
    expect(page.indexOf('value="Minor"')).toBeLessThan(page.indexOf('value="MinorTransgender"'));
    expect(page.indexOf('value="MinorTransgender"')).toBeLessThan(page.indexOf('value="DomesticAbuse"'));
  });

  it("should put the minor's-details error beside the revealed boxes and keep what was ticked", async () => {
    const res = pageResponse();

    await POST(request({ masterId: SULLIVAN, reasons: ["Minor", "MinorParentalConsent", "MinorNoParentalConsent"], urgency: "Normal" }), res);
    const page = html(res.render.mock.calls[0][1]);

    expect(page).toContain('href="#minorDetails"');
    expect(page).toContain("Select either Have parental consent or Do not have parental consent, not both");
    expect(page).toMatch(/<input[^>]*value="MinorParentalConsent"[^>]*checked/);
    expect(createReferral).not.toHaveBeenCalled();
  });

  it("should render the already-open conflict as a summary message carrying a link to that referral", async () => {
    vi.mocked(createReferral).mockRejectedValue(new ConflictError("Case case-1 already has an open referral"));
    const res = pageResponse();

    await POST(request({ masterId: SULLIVAN, reasons: ["DomesticAbuse"], urgency: "Normal" }), res);
    const page = html(res.render.mock.calls[0][1]);

    expect(page).toContain("This case already has an open referral.");
    expect(page).toContain('href="/deed-polls/case-1/referrals/ref-9"');
    expect(page).toContain("View the open referral");
    // Not a field error: nothing that was typed is wrong, so it addresses no control.
    expect(page).not.toContain('href="#reasons"');
  });

  it("should ask which Master last, after urgency, with each Master's room as the radio's hint", async () => {
    const res = pageResponse();

    await GET(request(), res);
    const page = html(res.render.mock.calls[0][1]);

    expect(page).toContain("Which Master should this go to?");
    expect(page.indexOf('name="urgency"')).toBeLessThan(page.indexOf('name="masterId"'));
    expect(page).toMatch(new RegExp(`<input[^>]*name="masterId"[^>]*value="${SULLIVAN}"`));
    expect(page).toContain("3 of 10 referrals for this morning");
    expect(page).toContain("Raise referral");
  });

  it("should show a full Master disabled, and not offer one who is unavailable", async () => {
    const res = pageResponse();

    await GET(request(), res);
    const page = html(res.render.mock.calls[0][1]);

    expect(page).toMatch(new RegExp(`<input[^>]*value="${MASTERS.masters[2].id}"[^>]*disabled`));
    expect(page).toContain("Full for this morning");
    expect(page).not.toContain("Master Wren");
  });

  it("should say there are no Masters and offer no submit when none is available", async () => {
    vi.mocked(findMasterChoices).mockResolvedValue({ ...MASTERS, masters: [] } as never);
    const res = pageResponse();

    await GET(request(), res);
    const page = html(res.render.mock.calls[0][1]);

    expect(page).toContain("There are no Masters to assign to. Ask a Delivery Manager to add one.");
    expect(page).not.toContain('name="masterId"');
    expect(page).not.toContain("Raise referral");
  });

  it("should list the full Masters, say every one is full and offer no submit when nobody could be chosen", async () => {
    vi.mocked(findMasterChoices).mockResolvedValue({ ...MASTERS, masters: MASTERS.masters.map((master) => ({ ...master, assignedInWindow: 10 })) } as never);
    const res = pageResponse();

    await GET(request(), res);
    const page = html(res.render.mock.calls[0][1]);

    expect(page).toContain('name="masterId"');
    expect(page).toContain("Every Master is full for this window, so this referral cannot be raised now.");
    expect(page).not.toContain("Raise referral");
  });

  it("should say the Masters could not be loaded, and offer no submit, when the list read fails", async () => {
    vi.mocked(findMasterChoices).mockRejectedValue(new Error("deed-poll-api call failed (unavailable)"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = pageResponse();

    await GET(request(), res);
    const page = html(res.render.mock.calls[0][1]);

    expect(page).toContain("The list of Masters could not be loaded");
    expect(page).not.toContain("There are no Masters to assign to");
    expect(page).not.toContain("Raise referral");
    vi.mocked(console.error).mockRestore();
  });

  it("should put api's cap sentence beside the radios and in the summary, with the chosen Master still checked", async () => {
    const sentence = "This Master already has 10 referrals for the morning of 28-10-26. Choose another Master.";
    vi.mocked(createReferral).mockRejectedValue(new ConflictError(sentence, [{ field: "masterId", message: sentence }]));
    const res = pageResponse();

    await POST(request({ masterId: SULLIVAN, reasons: ["DomesticAbuse"], urgency: "Normal" }), res);
    const page = html(res.render.mock.calls[0][1]);

    expect(page).toContain('href="#masterId"');
    expect(page).toMatch(/id="masterId-error"[\s\S]*?This Master already has 10 referrals/);
    expect(page).toMatch(new RegExp(`<input[^>]*value="${SULLIVAN}"[^>]*checked`));
    expect(page).not.toContain("This case already has an open referral.");
  });

  it("should put the error summary before the heading, where a screen reader reaches it first", async () => {
    const res = pageResponse();

    await POST(request({ masterId: SULLIVAN, urgency: "Normal" }), res);
    const page = html(res.render.mock.calls[0][1]);

    expect(page.indexOf("govuk-error-summary")).toBeLessThan(page.indexOf("<h1"));
  });
});
