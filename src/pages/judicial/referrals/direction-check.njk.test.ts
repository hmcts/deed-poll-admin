/**
 * The check-your-answers step's markup — the attestation page, and the only one in this repo.
 *
 * What a view model cannot show, and this page's whole point: that the direction a judge is about to attest to is
 * on screen in the words they will be held to, that the three answers are also in the page as the fields the
 * confirm carries (there is no draft anywhere else — decision 7), and that the declaration sits above the submit
 * rather than behind a tick box.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getReferral } from "@hmcts/deed-poll";
import type { JudicialReferralDetail } from "@hmcts/deed-poll-api-client";
import nunjucks from "nunjucks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../express-doubles.js";
import { addPathFilters } from "../../../path-filters.js";
import { POST } from "./[referralId]/direction.js";

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

const detail = (): JudicialReferralDetail =>
  ({
    id: "ref-1",
    state: "Claimed",
    reasons: ["Minor"],
    notes: null,
    urgency: "Normal",
    urgencyReason: null,
    createdOn: new Date("2026-09-03T08:44:00Z"),
    claimedBy: "a-judge",
    claimedAt: new Date("2026-09-04T09:00:00Z"),
    decision: null,
    directionsText: null,
    changesToStandardPublication: null,
    decisionDate: null,
    decidedBy: null,
    application: {
      displayReference: "KBDP2026-00001",
      type: "Minor",
      oldForename: "John",
      oldMiddleName: null,
      oldSurname: "Smith",
      newForename: "John",
      newMiddleName: null,
      newSurname: "Smyth",
      witnesses: [],
      documents: []
    },
    caseNotes: []
  }) as JudicialReferralDetail;

/** The check step for a direction the judge has just filled in. */
const renderCheck = async (body: Record<string, unknown>, query: Record<string, unknown> = {}): Promise<string> => {
  const res = pageResponse();
  await POST(pageRequest({ params: { referralId: "ref-1" }, query, body, judicial: true, accessToken: "judge-token" }), res);
  const model = res.render.mock.calls[0][1];

  return environment.render("judicial/referrals/direction-check.njk", { ...model.en, ...model });
};

const DIRECTION = { decision: "Approved", directionsText: "Grant the application.", changesToStandardPublication: "false" };

describe("direction check-your-answers template", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getReferral).mockResolvedValue(detail() as never);
  });

  it("should read the direction back as the words the judge will be held to", async () => {
    const html = await renderCheck(DIRECTION);

    expect(html).toContain("Approved");
    expect(html).toContain("Grant the application.");
    expect(html).toContain("No");
  });

  // Master Sullivan's feedback (Steve, 2026-10-27): the Gazette answer before the directions or reasons, as the form
  // asks them, because a Yes is what the text then explains.
  it("should read the Gazette answer back before the directions or reasons", async () => {
    const html = await renderCheck(DIRECTION);

    expect(html.indexOf("Changes to the standard publications in the Gazette")).toBeLessThan(html.indexOf("Directions/Reasons"));
    expect(html.indexOf("Directions/Reasons")).toBeGreaterThan(-1);
  });

  it("should caption the page with the application being directed", async () => {
    const html = await renderCheck(DIRECTION);

    expect(html).toContain("KBDP2026-00001");
  });

  it("should say the Gazette answer in words rather than as a raw boolean", async () => {
    const html = await renderCheck({ ...DIRECTION, changesToStandardPublication: "true" });

    expect(html).toContain("Changes to the standard publications in the Gazette");
    expect(html).toContain("Yes");
  });

  // An approval that needs no comment is a real answer, so the row says so rather than sitting blank — a judge
  // must be able to tell an empty answer from a lost one before they confirm it.
  it("should say so when the judge gave no directions, rather than leaving the row empty", async () => {
    const html = await renderCheck({ ...DIRECTION, directionsText: "" });

    expect(html).toContain("None given");
  });

  // Decision 7: the request is the only place the direction exists until it is recorded, so the answers must be
  // in the page as fields. This is the assertion that the confirm posts a complete direction.
  it("should carry all three answers as hidden fields on the confirm form", async () => {
    const html = await renderCheck(DIRECTION);

    expect(html).toContain('<input type="hidden" name="decision" value="Approved">');
    expect(html).toContain('<input type="hidden" name="directionsText" value="Grant the application.">');
    expect(html).toContain('<input type="hidden" name="changesToStandardPublication" value="false">');
  });

  it("should post the confirm back to the direction route with the literal that records", async () => {
    const html = await renderCheck(DIRECTION);

    expect(html).toContain('action="/judicial/referrals/ref-1/direction"');
    expect(html).toContain('value="confirm" name="action"');
  });

  // A change link would be a GET, and a GET arrives with nothing in it: there is no stored answer to come back
  // to, so the way back to the form has to re-post the answers.
  it("should offer Change as a submit rather than a link, so the answers travel with it", async () => {
    const html = await renderCheck(DIRECTION);

    expect(html).toContain('value="change" name="action"');
    expect(html).not.toContain('href="/judicial/referrals/ref-1/direction"');
  });

  // Pressing the button is the attestation, which is the Design System's check-answers pattern; a tick box in
  // front of a button that already confirms is what it warns against.
  it("should put the declaration above the submit and use no confirmation checkbox", async () => {
    const html = await renderCheck(DIRECTION);

    expect(html).toContain("By recording this direction you confirm it is your direction on this application.");
    expect(html).toContain("You can change or withdraw your direction until the office closes the referral.");
    expect(html).not.toContain('type="checkbox"');
  });

  // A double click records the direction once and 409s the second request, so without this the judge is left on
  // "not waiting for a direction from you" — true, but shown as a refusal for a direction that went in. Change
  // re-renders and is safe to press twice, so it is deliberately not debounced.
  it("should debounce the confirm against a double click, but not the Change submit", async () => {
    const html = await renderCheck(DIRECTION);

    expect(html).toMatch(/data-prevent-double-click="true"[^>]*value="confirm"|value="confirm"[^>]*data-prevent-double-click="true"/);
    expect(html).not.toMatch(/data-prevent-double-click="true"[^>]*value="change"|value="change"[^>]*data-prevent-double-click="true"/);
  });

  it("should escape a value that would otherwise close its own hidden field", async () => {
    const html = await renderCheck({ ...DIRECTION, directionsText: '"><script>alert(1)</script>' });

    expect(html).not.toContain("<script>alert(1)</script>");
  });

  describe("when changing a direction", () => {
    beforeEach(() => {
      vi.mocked(getReferral).mockResolvedValue({ ...detail(), state: "Decided", decision: "Approved", changesToStandardPublication: true } as never);
    });

    it("should say change in the heading, the declaration and the confirm, and that the earlier direction is kept", async () => {
      const html = await renderCheck(DIRECTION, { change: "1" });

      expect(html).toMatch(/<h1[^>]*>Check your changed direction<\/h1>/);
      expect(html).toContain("By changing this direction you confirm it is your direction on this application.");
      expect(html).toContain("Your earlier direction stays on record, and the office is told you changed it.");
      expect(html).toContain("Confirm and change the direction");
      expect(html).not.toContain("Confirm and record the direction");
    });

    it("should post both the confirm and the way back to the change route", async () => {
      const html = await renderCheck(DIRECTION, { change: "1" });

      expect(html).toContain('action="/judicial/referrals/ref-1/direction?change=1"');
    });
  });
});
