import path from "node:path";
import { fileURLToPath } from "node:url";
import { findDeedPoll, findReferral, getCaseFieldRules, NotFoundError } from "@hmcts/deed-poll";
import nunjucks from "nunjucks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../express-doubles.js";
import { addPathFilters } from "../../../path-filters.js";
import { GET } from "./[referralId].js";

// Only the three api reads are replaced, and the rules with the local matrix api's port answers from, so the
// General rows are the real view model's.
vi.mock("@hmcts/deed-poll", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hmcts/deed-poll")>();

  return {
    ...actual,
    findDeedPoll: vi.fn(),
    findReferral: vi.fn(),
    getCaseFieldRules: vi.fn(async (query: { type?: string | null; migrated?: boolean; publishToGazette?: boolean }) =>
      actual.getFieldRules(query.type as never, query.migrated, query.publishToGazette)
    )
  };
});

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

const CALLER = { accessToken: "team-leader-token" };
const FOUND = {
  id: "case-1",
  displayReference: "KBDP2026-00001",
  type: "Adult",
  privacy: "Normal",
  state: "Received",
  migratedRecord: false,
  publishToLondonGazette: true,
  dateReceived: new Date("2026-03-01T00:00:00.000Z"),
  newForename: "Ada",
  newSurname: "Lovelace",
  notes: [],
  witnesses: [{ id: "witness-1", witnessName: "Wendy Witness" }],
  documents: [
    {
      id: "document-1",
      name: "passport.pdf",
      documentType: { name: "Passport" },
      direction: "Incoming",
      hasFile: true,
      createdOn: "2026-03-02T09:00:00Z"
    }
  ]
};
const REFERRAL = {
  id: "referral-1",
  state: "Open",
  reasons: ["Minor", "MinorTransgender"],
  notes: "Please check the parental consent.",
  urgency: "Urgent",
  urgencyReason: "Hearing next week",
  migrated: false,
  createdBy: "Casey Worker",
  createdOn: new Date("2026-10-28T11:00:00Z")
};

function request(query: Record<string, unknown> = { case: "case-1" }, referralId = "referral-1") {
  return pageRequest({ teamLeader: true, accessToken: "team-leader-token", params: { referralId }, query });
}

async function render() {
  const res = pageResponse();
  await GET(request(), res);
  const model = res.render.mock.calls[0][1];
  return { model, markup: environment.render("deed-polls/referrals/check.njk", { ...model.en, ...model }) };
}

describe("referral queue check view", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findDeedPoll).mockResolvedValue(FOUND as never);
    vi.mocked(findReferral).mockResolvedValue(REFERRAL as never);
  });

  it("should read the referral under the case the queue row named, and the case with its rules", async () => {
    const res = pageResponse();

    await GET(request(), res);

    expect(findReferral).toHaveBeenCalledExactlyOnceWith("case-1", "referral-1", CALLER);
    expect(findDeedPoll).toHaveBeenCalledExactlyOnceWith("case-1", CALLER);
    expect(getCaseFieldRules).toHaveBeenCalledExactlyOnceWith({ type: "Adult", migrated: false, publishToGazette: true }, CALLER);
    expect(res.render.mock.calls[0][0]).toBe("deed-polls/referrals/check");
  });

  it.each([{}, { case: "" }, { case: ["case-1", "case-2"] }])("should be the 404 a mistyped URL is, reading nothing, for a query of %o", async (query) => {
    await expect(GET(request(query), pageResponse())).rejects.toBeInstanceOf(NotFoundError);

    expect(findReferral).not.toHaveBeenCalled();
    expect(findDeedPoll).not.toHaveBeenCalled();
  });

  it.each([".", ".."])("should refuse a referral id of %j before any read", async (referralId) => {
    await expect(GET(request({ case: "case-1" }, referralId), pageResponse())).rejects.toBeInstanceOf(NotFoundError);

    expect(findReferral).not.toHaveBeenCalled();
  });

  it("should pass on api's 404 for a referral not under the case", async () => {
    vi.mocked(findReferral).mockRejectedValue(new NotFoundError("Referral referral-1 not found"));

    await expect(GET(request(), pageResponse())).rejects.toBeInstanceOf(NotFoundError);
  });

  it("should show the referral's reasons, urgency and who raised it when", async () => {
    const { markup } = await render();

    expect(markup).toContain('<span class="govuk-caption-l">KBDP2026-00001</span>');
    expect(markup).toContain('<h1 class="govuk-heading-xl">Check referral</h1>');
    expect(markup).toContain("Waiting to be sent");
    expect(markup).toContain("<li>Applicant is a minor: Transgender</li>");
    expect(markup).toContain("Urgent");
    expect(markup).toContain("Hearing next week");
    expect(markup).toContain("Please check the parental consent.");
    expect(markup).toContain("Casey Worker");
    expect(markup).toContain("28 October 2026 at 11:00am");
  });

  it("should repeat the case page's General rows, and nothing from the other sections", async () => {
    const { model, markup } = await render();

    expect(model.generalRows.map((row: { key: string }) => row.key)).toContain("Display reference");
    expect(markup).toContain("Application");
    expect(markup).toContain("1 March 2026");
    expect(markup).not.toContain("Wendy Witness");
  });

  it("should link each supporting document to the shared viewer under its case", async () => {
    const { markup } = await render();

    expect(markup).toContain('<a class="govuk-link" href="/deed-polls/case-1/documents/document-1/view">passport.pdf</a>');
  });

  it("should link back to the queue and offer no form", async () => {
    const { markup } = await render();

    expect(markup).toContain('<a class="govuk-link" href="/deed-polls/referrals">Back to referrals</a>');
    expect(markup).not.toContain("<form");
  });

  it("should say a private case is private", async () => {
    vi.mocked(findDeedPoll).mockResolvedValue({ ...FOUND, privacy: "Private" } as never);

    const { markup } = await render();

    expect(markup).toContain("govuk-notification-banner");
  });
});
