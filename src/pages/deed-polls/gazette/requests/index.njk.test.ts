import path from "node:path";
import { fileURLToPath } from "node:url";
import { ForbiddenError, findGazetteMembers, findGazetteRequests, findGazetteStatus, NotFoundError, UnauthorizedError } from "@hmcts/deed-poll";
import nunjucks from "nunjucks";
import { beforeEach, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../../express-doubles.js";
import { GET as detail } from "./[batchId].js";
import { GET as list } from "./index.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findGazetteRequests: vi.fn(),
  findGazetteStatus: vi.fn(),
  findGazetteMembers: vi.fn()
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

const ID = "00000000-0000-4000-8000-000000000001";
const STATUS = {
  batchId: ID,
  state: "Sent" as const,
  caseCount: 101,
  submittedAt: new Date("2026-10-01T10:00:00Z"),
  submittedBy: "Administrator",
  recipientEmail: "gazette@example.com",
  recipientRevision: 1,
  adultCount: 100,
  minorCount: 1,
  sentAt: new Date("2026-10-01T10:01:00Z")
};
const MEMBERS = { cases: [{ caseId: "case-1", referenceNumber: "FROZEN-001" }], page: 1, size: 25, total: 101, totalPages: 5 };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(findGazetteRequests).mockResolvedValue({ requests: [STATUS], page: 1, size: 25, total: 26, totalPages: 2 });
  vi.mocked(findGazetteStatus).mockResolvedValue(STATUS);
  vi.mocked(findGazetteMembers).mockResolvedValue(MEMBERS);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
async function render(handler: typeof list, query: Record<string, unknown> = {}, locale = "en") {
  const res = pageResponse();
  res.locals.locale = locale;
  await handler(pageRequest({ params: { batchId: ID }, query, accessToken: "admin-token", teamLeader: true }), res);
  const [view, model] = res.render.mock.calls[0];
  return { res, markup: environment.render(`${view}.njk`, { ...model[locale], ...model }) };
}

it("should preserve API list order, total and paging while forwarding only page and token", async () => {
  const { markup } = await render(list, { page: "2", size: "100", state: "Sent", sort: "submittedAt:asc" });
  expect(findGazetteRequests).toHaveBeenCalledExactlyOnceWith({ page: 2 }, { accessToken: "admin-token" });
  expect(markup).toContain("1 to 25 of 26 requests");
  expect(markup).toContain(`/deed-polls/gazette/requests/${ID}`);
  expect(markup).toContain("/deed-polls/gazette/requests?page=2");
  expect(markup).not.toMatch(/<form|type="submit"|state=|sort=/);
});

it.each([
  ["Preparing", "The request is being prepared", "Yn paratoi"],
  ["Sending", "The email is being sent", "Yn anfon"],
  ["Sent", "This does not confirm delivery or publication", "Anfonwyd"],
  ["NotSent", "A new review and confirmation are needed", "Heb ei anfon"],
  ["Uncertain", "Do not send these applications again", "Canlyniad ansicr"]
] as const)("should explain %s with no action that can send again in either language", async (state, explanation, welsh) => {
  vi.mocked(findGazetteStatus).mockResolvedValue({ ...STATUS, state });
  const { markup } = await render(detail);
  expect(markup).toContain(explanation);
  expect(markup).toContain("Refresh status");
  expect(markup).not.toMatch(/<form|type="submit"|idempotency|selectionFingerprint|failureCode|recipientRevision/);
  const translated = (await render(detail, {}, "cy")).markup;
  expect(translated).toContain(welsh);
  expect(translated).toContain("Adnewyddu’r statws");
  expect(translated).not.toContain(explanation);
});

it("should show all frozen references through API paging, including beyond the history preview", async () => {
  vi.mocked(findGazetteMembers).mockResolvedValue({ ...MEMBERS, cases: [{ caseId: "case-101", referenceNumber: "FINAL-101" }], page: 5 });
  const { markup } = await render(detail, { page: "5", size: "1", sort: "reference:desc" });
  expect(findGazetteStatus).toHaveBeenCalledExactlyOnceWith(ID, { accessToken: "admin-token" });
  expect(findGazetteMembers).toHaveBeenCalledExactlyOnceWith(ID, { page: 5 }, { accessToken: "admin-token" });
  expect(markup).toContain("101 to 101 of 101 applications");
  expect(markup).toContain("FINAL-101");
  expect(markup).toContain(`/deed-polls/gazette/requests/${ID}?page=4`);
});

it("should leave legacy recipient and adult/minor facts unknown rather than inferring them", async () => {
  vi.mocked(findGazetteStatus).mockResolvedValue({ batchId: ID, state: "Sent", caseCount: 101, sentAt: STATUS.sentAt });
  const { markup } = await render(detail);
  expect(markup.match(/Not recorded/g)).toHaveLength(5);
  expect(markup).toContain("Some details were not recorded for older sends");
  expect(markup).not.toContain("gazette@example.com");
});

it("should escape all recipient, sender and frozen reference text", async () => {
  vi.mocked(findGazetteStatus).mockResolvedValue({ ...STATUS, submittedBy: "<script>sender</script>", recipientEmail: "<b>recipient</b>" });
  vi.mocked(findGazetteMembers).mockResolvedValue({ ...MEMBERS, cases: [{ caseId: "case-1", referenceNumber: "<img src=x>" }] });
  const { markup } = await render(detail);
  expect(markup).toContain("&lt;script&gt;sender&lt;/script&gt;");
  expect(markup).toContain("&lt;b&gt;recipient&lt;/b&gt;");
  expect(markup).toContain("&lt;img src=x&gt;");
  expect(markup).not.toMatch(/<script>sender|<img src=x|<b>recipient/);
});

it("should preserve a known outcome when membership cannot be read", async () => {
  vi.mocked(findGazetteMembers).mockRejectedValue(new Error("private diagnostic"));
  const { markup } = await render(detail);
  expect(markup).toContain("The email has been accepted for sending");
  expect(markup).toContain("Application references could not be loaded");
  expect(markup).not.toMatch(/No application references|private diagnostic/);
});

it.each([list, detail])("should render an explicit unavailable state without a send control or server diagnostics", async (handler) => {
  vi.mocked(findGazetteRequests).mockRejectedValue(new Error("private diagnostic"));
  vi.mocked(findGazetteStatus).mockRejectedValue(new Error("private diagnostic"));
  const { res, markup } = await render(handler);
  expect(res.status).toHaveBeenCalledWith(503);
  expect(markup).toContain("could not be loaded");
  expect(markup).not.toMatch(/<form|private diagnostic|There are no Gazette requests/);
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("private diagnostic");
});

it.each([ForbiddenError, UnauthorizedError, NotFoundError])("should preserve shared status-page handling for %s", async (ErrorType) => {
  const error = new ErrorType("Refused");
  vi.mocked(findGazetteStatus).mockRejectedValue(error);
  await expect(render(detail)).rejects.toBe(error);
});

it("should distinguish empty and out-of-range pages", async () => {
  vi.mocked(findGazetteRequests).mockResolvedValue({ requests: [], page: 1, size: 25, total: 0, totalPages: 0 });
  expect((await render(list)).markup).toContain("There are no Gazette requests.");
  vi.mocked(findGazetteRequests).mockResolvedValue({ requests: [], page: 9, size: 25, total: 1, totalPages: 1 });
  expect((await render(list)).markup).toContain("There are no requests on this page.");
  vi.mocked(findGazetteMembers).mockResolvedValue({ ...MEMBERS, cases: [], page: 9 });
  const { markup } = await render(detail);
  expect(markup).toContain("There are no application references on this page.");
  expect(markup).toContain(`href="/deed-polls/gazette/requests/${ID}">Go to the first page`);
});
