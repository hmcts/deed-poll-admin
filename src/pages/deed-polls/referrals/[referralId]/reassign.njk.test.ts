import path from "node:path";
import { fileURLToPath } from "node:url";
import { findReferral, findReferralQueue } from "@hmcts/deed-poll";
import nunjucks from "nunjucks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../../express-doubles.js";
import { addPathFilters } from "../../../../path-filters.js";
import { GET } from "./reassign.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findReferral: vi.fn(),
  findReferralQueue: vi.fn()
}));

const STARTER_VIEWS = path.join(fileURLToPath(import.meta.url), "../../../../../../libs/express-govuk-starter/src");
const environment = nunjucks.configure(
  [
    path.join(fileURLToPath(import.meta.resolve("govuk-frontend")), "..", ".."),
    path.join(STARTER_VIEWS, "govuk-frontend/views"),
    path.join(STARTER_VIEWS, "cookies/views"),
    path.join(fileURLToPath(import.meta.url), "../../../../..", "pages")
  ],
  { autoescape: true }
);
addPathFilters(environment);

const CLAIMED = {
  id: "referral-2",
  state: "Claimed",
  reasons: ["Other"],
  assignedMaster: { id: "master-1", name: "Master Sullivan" },
  assignedAt: new Date("2026-10-29T08:00:00Z"),
  directionDueBy: new Date("2026-11-05T08:00:00Z")
};

function arrange(masters: unknown[]) {
  vi.mocked(findReferral).mockResolvedValue(CLAIMED as never);
  vi.mocked(findReferralQueue).mockResolvedValue({ referrals: [], page: 1, size: 25, total: 0, totalPages: 0, window: { cap: 10, sent: 0, masters } } as never);
}

async function render() {
  const res = pageResponse();
  await GET(pageRequest({ teamLeader: true, params: { referralId: "referral-2" }, query: { case: "case-2" } }), res);
  const model = res.render.mock.calls[0][1];
  return environment.render("deed-polls/referrals/[referralId]/reassign.njk", { ...model.en, ...model });
}

describe("reassign a referral template", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    arrange([
      { id: "master-1", name: "Master Sullivan", sentInWindow: 0 },
      { id: "master-2", name: "Master Judge", sentInWindow: 0 }
    ]);
  });

  it("should say who has it, that the days restart, that the Master is emailed, and post back to itself", async () => {
    const markup = await render();

    expect(markup).toContain('<h1 class="govuk-heading-xl">Reassign this referral</h1>');
    expect(markup).toContain("This referral is with Master Sullivan.");
    expect(markup).toContain("they will have 7 days from today to give a direction.");
    expect(markup).toContain("The Master you choose will be sent an email to tell them.");
    expect(markup).toContain("Reassigning does not use a place in a referral window.");
    expect(markup).toContain('action="/deed-polls/referrals/referral-2/reassign?case=case-2"');
    expect(markup).toContain('href="/deed-polls/referrals/referral-2?case=case-2">Check the referral</a>');
    expect(markup).toContain('href="/deed-polls/referrals#with-a-master">Back to referrals</a>');
  });

  it("should offer the available Masters as radios with the current one checked", async () => {
    const markup = await render();

    expect(markup).toContain("Which Master should this go to?");
    expect(markup).toMatch(/name="masterId" type="radio" value="master-1" checked/);
    expect(markup).toMatch(/name="masterId" type="radio" value="master-2">/);
    expect(markup).toContain("Reassign referral");
  });

  it("should say there is nobody to reassign to, with no form", async () => {
    arrange([]);

    const markup = await render();

    expect(markup).toContain("There are no available Masters to reassign this referral to.");
    expect(markup).not.toContain("<form");
  });
});
