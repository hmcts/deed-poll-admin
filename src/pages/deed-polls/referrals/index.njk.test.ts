import path from "node:path";
import { fileURLToPath } from "node:url";
import { findReferralQueue } from "@hmcts/deed-poll";
import nunjucks from "nunjucks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../express-doubles.js";
import { addPathFilters } from "../../../path-filters.js";
import { GET } from "./index.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findReferralQueue: vi.fn()
}));

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

const MASTERS = [
  { id: "master-1", name: "Master Sullivan", sentInWindow: 3 },
  { id: "master-2", name: "Master Judge", sentInWindow: 1 }
];
const OPEN_WINDOW = {
  current: { date: "2026-10-30", slot: "AM", closesAt: "2026-10-30T10:30:00Z" },
  next: { date: "2026-10-30", slot: "PM", opensAt: "2026-10-30T14:00:00Z" },
  cap: 10,
  sent: 4,
  masters: MASTERS
};
const CLOSED_WINDOW = { ...OPEN_WINDOW, current: null, sent: 0, masters: MASTERS.map((master) => ({ ...master, sentInWindow: 0 })) };
const QUEUED = [
  {
    id: "referral-1",
    caseId: "case-1",
    displayReference: "KBDP2026-00001",
    newForename: "Ada",
    newSurname: "Lovelace",
    reasons: ["Minor", "MinorTransgender"],
    urgency: "Urgent",
    createdBy: "Casey Worker",
    createdOn: "2026-10-28T11:00:00Z"
  },
  { id: "referral-3", caseId: "case-3", displayReference: "KBDP2026-00003", reasons: ["Other"], urgency: "Normal", createdOn: "2026-10-27T11:00:00Z" }
];
const SENT = [
  {
    id: "referral-2",
    caseId: "case-2",
    displayReference: "KBDP2026-00002",
    reasons: ["Other"],
    assignedMaster: { id: "master-1", name: "Master Sullivan" },
    assignedAt: "2026-10-29T08:00:00Z",
    directionDueBy: "2026-11-05T08:00:00Z"
  }
];
const page = (referrals: unknown[], window: unknown, extra: Record<string, unknown> = {}) => ({
  referrals,
  page: 1,
  size: 25,
  total: referrals.length,
  totalPages: referrals.length === 0 ? 0 : 1,
  window,
  ...extra
});

function arrange({ queued = QUEUED, sent = SENT, window = OPEN_WINDOW as unknown, claimedFails = false } = {}) {
  vi.mocked(findReferralQueue).mockImplementation(async (query) => {
    if (query.state === "Claimed") {
      if (claimedFails) throw new Error("unavailable");
      return page(sent, window) as never;
    }
    return page(queued, window) as never;
  });
}

async function render(query: Record<string, unknown> = {}) {
  const res = pageResponse();
  await GET(pageRequest({ teamLeader: true, query }), res);
  const model = res.render.mock.calls[0][1];
  return environment.render("deed-polls/referrals/index.njk", { ...model.en, ...model });
}

describe("referral queue template", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    arrange();
  });

  it("should draw two tabs, To send and With a Master, under the page heading", async () => {
    const markup = await render();

    expect(markup).toContain('<h1 class="govuk-heading-xl">Referrals</h1>');
    expect(markup).toContain('href="#to-send"');
    expect(markup).toContain('href="#with-a-master"');
    expect(markup).toContain('id="to-send"');
    expect(markup).toContain('id="with-a-master"');
    expect(markup.indexOf('id="to-send"')).toBeLessThan(markup.indexOf('id="with-a-master"'));
  });

  describe("the window panel", () => {
    it("should say when the open window closes, how many are sent, and each Master's count", async () => {
      const markup = await render();

      expect(markup).toContain("This morning’s window closes at 10:30.");
      expect(markup).toContain("4 of 10 referrals sent.");
      expect(markup).toContain("Sent to each Master in this window");
      expect(markup).toMatch(/Master Sullivan<\/td>\s*<td class="govuk-table__cell govuk-table__cell--numeric">3<\/td>/);
      expect(markup).toMatch(/Master Judge<\/td>\s*<td class="govuk-table__cell govuk-table__cell--numeric">1<\/td>/);
    });

    it("should say when sending opens outside a window, with no per-Master table", async () => {
      vi.useFakeTimers({ now: new Date("2026-10-30T11:00:00Z"), toFake: ["Date"] });
      arrange({ window: CLOSED_WINDOW });

      const markup = await render();
      vi.useRealTimers();

      expect(markup).toContain("Referrals can be sent from 14:00 today.");
      expect(markup).toContain("0 of 10 referrals sent.");
      expect(markup).not.toContain("Sent to each Master in this window");
      expect(markup).not.toContain("window closes at");
    });

    it("should warn, rather than show a count, when api sent no window", async () => {
      arrange({ window: null });

      const markup = await render();

      expect(markup).toContain("The referral window could not be read");
      expect(markup).not.toContain("referrals sent.");
    });
  });

  describe("To send", () => {
    it("should list the queue in api's order with each row's cells, urgent ones tagged", async () => {
      const markup = await render();

      expect(markup.indexOf("KBDP2026-00001")).toBeLessThan(markup.indexOf("KBDP2026-00003"));
      expect(markup).toContain('<a class="govuk-link" href="/deed-polls/referrals/referral-1?case=case-1">KBDP2026-00001</a>');
      expect(markup).toContain("Ada Lovelace");
      expect(markup).toContain("<li>Applicant is a minor: Transgender</li>");
      expect(markup).toContain("28-10-26");
      expect(markup).toContain("Casey Worker");
      expect(markup.match(/govuk-tag--red">\s*Urgent/g)).toHaveLength(1);
    });

    it("should post one form to the review with a checkbox and a Master select per row", async () => {
      const markup = await render();
      const form = markup.slice(markup.indexOf("<form"), markup.indexOf("</form>"));

      expect(form).toContain('method="post" action="/deed-polls/referrals/review" novalidate');
      expect(form).toContain('name="referrals" type="checkbox" value="referral-1"');
      expect(form).toContain('name="referrals" type="checkbox" value="referral-3"');
      expect(form).toContain('name="master-referral-1"');
      expect(form).toContain('name="master-referral-3"');
      expect(form).toContain("Select KBDP2026-00001");
      expect(form).toContain("Master for KBDP2026-00001");
      expect(form).toMatch(
        /<option value=""[^>]*>Choose a Master<\/option>\s*<option value="master-1">Master Sullivan<\/option>\s*<option value="master-2">Master Judge<\/option>/
      );
      expect(form).toContain("Continue");
      expect(form).not.toContain("Reassign");
    });

    it("should offer no Continue when there are no available Masters, and say so", async () => {
      arrange({ window: { ...OPEN_WINDOW, masters: [] } });

      const markup = await render();

      expect(markup).toContain("There are no available Masters to send referrals to.");
      expect(markup).not.toContain("Continue");
    });

    it("should say the queue is empty, with no form", async () => {
      arrange({ queued: [] });

      const markup = await render();

      expect(markup).toContain("There are no referrals waiting to be sent.");
      expect(markup).not.toContain("<form");
    });

    it("should tell a page past the end from an empty queue", async () => {
      vi.mocked(findReferralQueue).mockImplementation(
        async (query) => (query.state === "Claimed" ? page(SENT, OPEN_WINDOW) : page([], OPEN_WINDOW, { page: 9, total: 2, totalPages: 1 })) as never
      );

      const markup = await render({ page: "9" });

      expect(markup).toContain("There are no referrals on this page.");
      expect(markup).toContain('href="/deed-polls/referrals">Go to the first page</a>');
    });
  });

  describe("With a Master", () => {
    it("should list each sent referral with its Master, when it was sent, its due date and a Reassign link", async () => {
      const markup = await render();
      const panel = markup.slice(markup.indexOf('id="with-a-master"'));

      expect(panel).toContain('<a class="govuk-link" href="/deed-polls/referrals/referral-2?case=case-2">KBDP2026-00002</a>');
      expect(panel).toContain("Master Sullivan");
      expect(panel).toContain("29-10-26");
      expect(panel).toContain("05-11-26");
      expect(panel).toContain(
        '<a class="govuk-link" href="/deed-polls/referrals/referral-2/reassign?case=case-2">Reassign<span class="govuk-visually-hidden"> KBDP2026-00002</span></a>'
      );
    });

    it("should say none are with a Master", async () => {
      arrange({ sent: [] });

      const markup = await render();

      expect(markup).toContain("There are no referrals with a Master.");
    });

    it("should say the tab could not be loaded, and still draw the queue", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      arrange({ claimedFails: true });

      const markup = await render();

      expect(markup).toContain("The referrals with a Master could not be loaded.");
      expect(markup).not.toContain("There are no referrals with a Master.");
      expect(markup).toContain("KBDP2026-00001");
    });
  });
});
