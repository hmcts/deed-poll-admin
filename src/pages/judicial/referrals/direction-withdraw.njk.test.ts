/**
 * The withdraw confirmation's markup. `[referralId]/withdraw.test.ts` is the handler's subject; this file pins what
 * the judge sees before anything is written: decision 6's sentence, one button that posts, and a way back that
 * acts on nothing.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getReferral } from "@hmcts/deed-poll";
import type { JudicialReferralDetail } from "@hmcts/deed-poll-api-client";
import nunjucks from "nunjucks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../express-doubles.js";
import { addPathFilters } from "../../../path-filters.js";
import { GET } from "./[referralId]/withdraw.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  getReferral: vi.fn()
}));

// The three roots `configureGovuk` mounts, minus the assets — the same set as the other njk tests.
const STARTER_VIEWS = path.join(fileURLToPath(import.meta.url), "../../../../../libs/express-govuk-starter/src");
const environment = nunjucks.configure(
  [
    path.join(fileURLToPath(import.meta.resolve("govuk-frontend")), "..", ".."),
    path.join(STARTER_VIEWS, "govuk-frontend/views"),
    path.join(STARTER_VIEWS, "cookies/views"),
    path.join(fileURLToPath(import.meta.url), "../../../..", "pages")
  ],
  { autoescape: true }
);
addPathFilters(environment);

const decided = (): JudicialReferralDetail =>
  ({
    id: "ref-1",
    state: "Decided",
    reasons: ["Minor"],
    createdOn: new Date("2026-09-03T08:44:00Z"),
    decision: "Approved",
    publishToGazette: true,
    decisionDate: new Date("2026-09-05T16:05:00Z"),
    application: { displayReference: "KBDP2026-00001", type: "Adult", witnesses: [], documents: [] },
    caseNotes: []
  }) as JudicialReferralDetail;

const renderPage = async (): Promise<string> => {
  const res = pageResponse();
  await GET(pageRequest({ params: { referralId: "ref-1" }, judicial: true, accessToken: "judge-token" }), res);
  const model = res.render.mock.calls[0][1];

  return environment.render("judicial/referrals/direction-withdraw.njk", { ...model.en, ...model });
};

describe("withdraw direction template", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getReferral).mockResolvedValue(decided() as never);
  });

  it("should be headed for the withdrawal and captioned with the application", async () => {
    const html = await renderPage();

    expect(html).toMatch(/<h1[^>]*>Withdraw your direction<\/h1>/);
    expect(html).toContain("KBDP2026-00001");
  });

  it("should say what withdrawing leaves the judge with, naming no other judge", async () => {
    const html = await renderPage();

    expect(html).toContain("You&#39;ll need to give a new direction. Until you do, this referral stays claimed by you.");
    expect(html).toContain("If it isn&#39;t directed, it may return to the shared list like any other claim.");
    expect(html).not.toMatch(/another judge|claimed by (?!you)/i);
  });

  it("should post the one withdraw button to the withdraw route, debounced", async () => {
    const html = await renderPage();

    expect(html).toContain('<form method="post" action="/judicial/referrals/ref-1/withdraw" novalidate>');
    expect(html).toContain("Withdraw direction");
    expect(html).toContain('data-prevent-double-click="true"');
  });

  it("should offer cancel as a link back to the referral, so it acts on nothing", async () => {
    const html = await renderPage();

    expect(html).toMatch(/<a class="govuk-link" href="\/judicial\/referrals\/ref-1">Cancel<\/a>/);
  });
});
