import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConflictError, findReferralQueue, sendReferrals } from "@hmcts/deed-poll";
import nunjucks from "nunjucks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../express-doubles.js";
import { addPathFilters } from "../../../path-filters.js";
import { POST } from "./review.js";
import { POST as SEND } from "./send.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findReferralQueue: vi.fn(),
  sendReferrals: vi.fn()
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

const REFERRAL_1 = "11111111-1111-4111-8111-111111111111";
const REFERRAL_2 = "22222222-2222-4222-8222-222222222222";
const MASTER_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MASTER_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OPEN_WINDOW = {
  current: { date: "2026-10-30", slot: "AM", closesAt: "2026-10-30T10:30:00Z" },
  next: { date: "2026-10-30", slot: "PM", opensAt: "2026-10-30T14:00:00Z" },
  cap: 10,
  sent: 4,
  masters: [
    { id: MASTER_1, name: "Master Sullivan", sentInWindow: 3 },
    { id: MASTER_2, name: "Master Judge", sentInWindow: 1 }
  ]
};
const QUEUED = [
  { id: REFERRAL_1, caseId: "case-1", displayReference: "KBDP2026-00001", reasons: ["Minor", "MinorTransgender"], urgency: "Urgent" },
  { id: REFERRAL_2, caseId: "case-2", displayReference: "KBDP2026-00002", reasons: ["Other"], urgency: "Normal" }
];
const SELECTION = { page: "1", referrals: [REFERRAL_1, REFERRAL_2], [`master-${REFERRAL_1}`]: MASTER_1, [`master-${REFERRAL_2}`]: MASTER_2 };

function arrange(window: unknown = OPEN_WINDOW) {
  vi.mocked(findReferralQueue).mockResolvedValue({ referrals: QUEUED, page: 1, size: 25, total: 2, totalPages: 1, window } as never);
}

async function render(handler: typeof POST, body: Record<string, unknown>) {
  const res = pageResponse();
  await handler(pageRequest({ teamLeader: true, body }), res);
  const [view, model] = res.render.mock.calls[0];
  return environment.render(`${view}.njk`, { ...model.en, ...model });
}

describe("referral queue review template", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    arrange();
  });

  it("should list each referral with its reasons, urgency and Master, and the totals", async () => {
    const markup = await render(POST, SELECTION);

    expect(markup).toContain('<h1 class="govuk-heading-xl">Check the referrals before sending</h1>');
    expect(markup.indexOf("KBDP2026-00001")).toBeLessThan(markup.indexOf("KBDP2026-00002"));
    expect(markup).toContain("<li>Applicant is a minor: Transgender</li>");
    expect(markup.match(/govuk-tag--red">\s*Urgent/g)).toHaveLength(1);
    expect(markup).toContain("Master Sullivan");
    expect(markup).toContain("Master Judge");
    expect(markup).toContain("This sends 2 referrals.");
    expect(markup).toContain("6 of 10 will have been sent this morning.");
    expect(markup).toContain('href="/deed-polls/referrals">Back to referrals</a>');
  });

  it("should carry every pair to the send in hidden inputs, in the queue form's shape", async () => {
    const markup = await render(POST, SELECTION);
    const form = markup.slice(markup.indexOf("<form"), markup.indexOf("</form>"));

    expect(form).toContain('method="post" action="/deed-polls/referrals/send" novalidate');
    expect(form).toContain('<input type="hidden" name="page" value="1">');
    expect(form).toContain(`<input type="hidden" name="referrals" value="${REFERRAL_1}">`);
    expect(form).toContain(`<input type="hidden" name="master-${REFERRAL_1}" value="${MASTER_1}">`);
    expect(form).toContain(`<input type="hidden" name="master-${REFERRAL_2}" value="${MASTER_2}">`);
    expect(form).toContain("Send referrals");
  });

  it("should draw no Send outside a window", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-30T11:00:00Z"), toFake: ["Date"] });
    arrange({ ...OPEN_WINDOW, current: null, sent: 0 });

    const markup = await render(POST, SELECTION);
    vi.useRealTimers();

    expect(markup).toContain("Referrals can be sent from 14:00 today.");
    expect(markup).not.toContain("<form");
    expect(markup).not.toContain("Send referrals");
  });

  it("should draw no Send over the room left", async () => {
    arrange({ ...OPEN_WINDOW, sent: 9 });

    const markup = await render(POST, SELECTION);

    expect(markup).toContain("Only 1 more referral can be sent this morning.");
    expect(markup).not.toContain("<form");
  });

  it("should put api's refusal in the error summary", async () => {
    vi.mocked(sendReferrals).mockRejectedValue(new ConflictError("Referrals can only be sent during a referral window. The next one opens at 14:00 today."));

    const markup = await render(SEND, SELECTION);

    expect(markup).toContain("There is a problem");
    expect(markup).toContain("Referrals can only be sent during a referral window. The next one opens at 14:00 today.");
  });

  it("should redraw the queue with the selection kept and the error beside its row", async () => {
    const markup = await render(POST, { page: "1", referrals: [REFERRAL_1, REFERRAL_2], [`master-${REFERRAL_1}`]: MASTER_1 });

    expect(markup).toContain("There is a problem");
    expect(markup).toContain('href="#master-2">Choose a Master for this referral</a>');
    expect(markup).toMatch(new RegExp(`id="select-1" name="referrals" type="checkbox" value="${REFERRAL_1}" checked`));
    expect(markup).toMatch(new RegExp(`<option value="${MASTER_1}" selected>Master Sullivan</option>`));
    expect(markup).toContain('id="master-2-error"');
  });

  it("should draw the selection's own error above the table", async () => {
    const markup = await render(POST, { page: "1" });

    expect(markup).toContain('href="#select-1">Select at least one referral to send</a>');
    expect(markup).toContain('id="referrals-error"');
    expect(markup).toMatch(/id="select-1" name="referrals" type="checkbox" value="[^"]+"\s+aria-describedby="referrals-error"/);
  });
});
