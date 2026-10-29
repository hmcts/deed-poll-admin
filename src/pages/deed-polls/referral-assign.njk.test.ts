/**
 * The assign page's markup (plan Db1). The model is asserted in `[id]/referrals/[referralId]/assign.test.ts`; this
 * pins what it cannot show: that the form posts to its own route, that a full Master's radio is disabled while the
 * current one stays enabled, that the error is beside the radios and linked from the summary, and that with no list
 * there is no submit.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assignReferral, ConflictError, findDeedPoll, findMasterChoices, findReferral } from "@hmcts/deed-poll";
import nunjucks from "nunjucks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../express-doubles.js";
import { addPathFilters } from "../../path-filters.js";
import { GET, POST } from "./[id]/referrals/[referralId]/assign.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPoll: vi.fn(),
  findReferral: vi.fn(),
  findMasterChoices: vi.fn(),
  assignReferral: vi.fn()
}));

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

const SULLIVAN = "6c1f0d4e-2b3a-4c5d-8e9f-0a1b2c3d4e5f";
const JUDGE = "8e3b2f60-4d5c-4e7f-a01b-2c3d4e5f6071";
const WREN = "7d2a1e5f-3c4b-4d6e-9f0a-1b2c3d4e5f60";

const MASTERS = {
  masters: [
    { id: SULLIVAN, name: "Master Sullivan", email: "s@example.com", available: true, linked: true, revision: 0, assignedInWindow: 3 },
    { id: JUDGE, name: "Master Judge", email: "j@example.com", available: true, linked: false, revision: 0, assignedInWindow: 10 },
    { id: WREN, name: "Master Wren", email: "w@example.com", available: true, linked: false, revision: 0, assignedInWindow: 10 }
  ],
  window: { date: "2026-10-28", slot: "AM" },
  cap: 10
};

const found = { id: "case-1", displayReference: "KBDP2026-00001", notes: [], witnesses: [], documents: [] };
const OPEN = { id: "ref-1", state: "Open", reasons: ["Minor"], migrated: false };
const CLAIMED = {
  ...OPEN,
  state: "Claimed",
  assignedMaster: { id: JUDGE, name: "Master Judge" },
  assignedAt: new Date("2026-10-20T09:00:00Z"),
  directionDueBy: new Date("2026-10-27T09:00:00Z")
};

const html = (model: Record<string, unknown>): string => environment.render("deed-polls/referral-assign.njk", { ...(model.en as object), ...model });

const request = (body: Record<string, unknown> = {}) => pageRequest({ params: { id: "case-1", referralId: "ref-1" }, body, accessToken: "session-token" });

async function getPage(): Promise<string> {
  const res = pageResponse();
  await GET(request(), res);
  return html(res.render.mock.calls[0][1]);
}

describe("assign a referral template", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findDeedPoll).mockResolvedValue(found as never);
    vi.mocked(findReferral).mockResolvedValue(OPEN as never);
    vi.mocked(findMasterChoices).mockResolvedValue(MASTERS as never);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-28T09:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should post to its own route and offer each Master with their room for this window", async () => {
    const rendered = await getPage();

    expect(rendered).toContain('action="/deed-polls/case-1/referrals/ref-1/assign"');
    expect(rendered).toMatch(/<title>[^<]*Assign this referral to a Master/);
    expect(rendered).toContain("Assign this referral to a Master");
    expect(rendered).toContain("Which Master should this go to?");
    expect(rendered).toContain("3 of 10 referrals for this morning");
    expect(rendered).toMatch(new RegExp(`value="${JUDGE}"[^>]*disabled`));
    expect(rendered).toContain('href="/deed-polls/case-1/referrals/ref-1"');
    expect(rendered).toContain("Assign referral");
  });

  it("should say who has it and that the new Master's time starts again, and keep the current Master selectable", async () => {
    vi.mocked(findReferral).mockResolvedValue(CLAIMED as never);

    const rendered = await getPage();

    expect(rendered).toContain("Assign this referral to another Master");
    expect(rendered).toContain("This referral is with Master Judge.");
    expect(rendered).toMatch(/govuk-inset-text[\s\S]*7 days from today to give a direction/);
    expect(rendered).toMatch(new RegExp(`value="${JUDGE}"[^>]*checked`));
    expect(rendered).not.toMatch(new RegExp(`value="${JUDGE}"[^>]*disabled`));
    // Another full Master is still disabled.
    expect(rendered).toMatch(new RegExp(`value="${WREN}"[^>]*disabled`));
  });

  it("should place the cap's refusal beside the radios and link it from the summary", async () => {
    vi.mocked(assignReferral).mockRejectedValue(new ConflictError("full", [{ field: "masterId", message: "Master Sullivan is full for this morning" }]));
    const res = pageResponse();

    await POST(request({ masterId: SULLIVAN }), res);
    const rendered = html(res.render.mock.calls[0][1]);

    expect(rendered).toMatch(/govuk-error-summary[\s\S]*href="#masterId"[^>]*>Master Sullivan is full for this morning/);
    expect(rendered).toMatch(/govuk-error-message[\s\S]*Master Sullivan is full for this morning/);
  });

  it("should offer no submit when the Masters list cannot be read", async () => {
    vi.mocked(findMasterChoices).mockRejectedValue(new Error("unavailable"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const rendered = await getPage();

    expect(rendered).toContain("The list of Masters could not be loaded");
    expect(rendered).not.toContain("Assign referral</button>");
    expect(rendered).not.toContain('name="masterId"');
  });

  it("should offer no submit when there is nobody to assign to", async () => {
    vi.mocked(findMasterChoices).mockResolvedValue({ ...MASTERS, masters: [] } as never);

    const rendered = await getPage();

    expect(rendered).toContain("There are no Masters to assign to. Ask a Delivery Manager to add one.");
    expect(rendered).not.toMatch(/<button[^>]*govuk-button/);
  });

  it("should list the full Masters, say every one is full and offer no submit when nobody could be chosen", async () => {
    vi.mocked(findMasterChoices).mockResolvedValue({ ...MASTERS, masters: MASTERS.masters.map((master) => ({ ...master, assignedInWindow: 10 })) } as never);

    const rendered = await getPage();

    expect(rendered).toContain('name="masterId"');
    expect(rendered).toContain("Every Master is full for this window, so this referral cannot be assigned now.");
    expect(rendered).not.toMatch(/<button[^>]*govuk-button/);
  });
});
