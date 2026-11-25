/**
 * The status and restore pages' markup, from the real handlers' models. The states' wording is pinned in
 * `src/application-deletion/status-page.test.ts`; this pins what is drawn: Restore as a link to its own confirmation
 * (never a write from the status page), no delete or resend control in any state, Refresh everywhere but Completed,
 * and restore's one submit for the literal `restore` action.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConflictError, findDeletion, NotFoundError, restoreDeletion } from "@hmcts/deed-poll";
import axe from "axe-core";
import { JSDOM } from "jsdom";
import nunjucks from "nunjucks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse, withoutSignOutForm } from "../../../express-doubles.js";
import { addPathFilters } from "../../../path-filters.js";
import { GET as restoreGet, POST as restorePost } from "./[requestId]/restore.js";
import { GET as statusGet } from "./[requestId].js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeletion: vi.fn(),
  restoreDeletion: vi.fn()
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

const REQUEST_ID = "6f1c1f4e-2b1a-4d8e-9f3a-1c2b3d4e5f60";
const request = () => pageRequest({ params: { requestId: REQUEST_ID }, query: { case: "case-1" }, accessToken: "t" });

async function statusPage(overrides: Record<string, unknown> = {}, locale: "en" | "cy" = "en") {
  vi.mocked(findDeletion).mockResolvedValue({
    requestId: REQUEST_ID,
    caseId: "case-1",
    reason: "DUPLICATE",
    status: "Pending",
    requestedAt: new Date("2026-11-20T10:00:00Z"),
    restorableUntil: new Date(Date.now() + 86_400_000),
    completedAt: null,
    failure: null,
    ...overrides
  } as never);
  const res = pageResponse();
  res.locals.locale = locale;
  await statusGet(request(), res);
  const [view, model] = res.render.mock.calls[0];
  return withoutSignOutForm(environment.render(`${view}.njk`, { ...model[locale], ...model }));
}

describe("deletions/status.njk", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should link Restore to its confirmation page and draw no form inside the grace period", async () => {
    const page = await statusPage();

    expect(page).toContain(`href="/deed-polls/deletions/${REQUEST_ID}/restore?case=case-1"`);
    expect(page).toContain("Restore application");
    expect(page).not.toContain("<form");
    expect(page).toContain(`href="/deed-polls/deletions/${REQUEST_ID}"`);
    expect(page).toContain('href="/deed-polls"');
  });

  it.each(["InProgress", "AwaitingDisposal", "NeedsAttention"])("should offer Refresh and Back but no restore, delete or resend for %s", async (status) => {
    const page = await statusPage({ status });

    expect(page).not.toContain("Restore application");
    expect(page).not.toMatch(/<button|<form/);
    expect(page).toContain("Refresh");
    expect(page).toContain("Back to applications");
  });

  it("should head only Completed as deleted, with no Refresh", async () => {
    const page = await statusPage({ status: "Completed", completedAt: new Date("2026-12-05T02:00:00Z") });

    expect(page).toContain("Application deleted</h1>");
    expect(page).not.toContain("Refresh");
    expect(page).toContain("5 December 2026 at 2:00am");
  });

  it("should say progress could not be checked when the read fails", async () => {
    vi.mocked(findDeletion).mockRejectedValue(new Error("unavailable"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = pageResponse();

    await statusGet(request(), res);
    const page = environment.render("deed-polls/deletions/status.njk", { ...res.render.mock.calls[0][1].en, ...res.render.mock.calls[0][1] });

    expect(page).toContain("could not be checked");
    expect(page).toContain("Refresh");
  });

  it("should draw a refused restore's sentence as a banner above the fresh status", async () => {
    vi.mocked(restoreDeletion).mockRejectedValue(new ConflictError("api's words", [], "CLEANUP_STARTED"));
    vi.mocked(findDeletion).mockResolvedValue({
      requestId: REQUEST_ID,
      caseId: "case-1",
      reason: "DUPLICATE",
      status: "InProgress",
      requestedAt: new Date("2026-11-20T10:00:00Z"),
      restorableUntil: new Date(Date.now() - 1000),
      completedAt: null,
      failure: null
    } as never);
    const res = pageResponse();

    await restorePost(Object.assign(request(), { body: { action: "restore" } }), res);

    const [view, model] = res.render.mock.calls[0];
    const page = environment.render(`${view}.njk`, { ...model.en, ...model });
    expect(page).toContain("govuk-notification-banner");
    expect(page).toContain("its permanent removal has started");
    expect(page).not.toContain("api's words");
  });

  it("should render the Welsh content when the locale is cy", async () => {
    expect(await statusPage({}, "cy")).toContain("Application deleted from view");
  });

  it("should have no axe violations", { timeout: 30_000 }, async () => {
    expect(await axeViolations(await statusPage())).toEqual([]);
  });
});

describe("deletions/restore.njk", () => {
  it("should offer one submit for the literal restore action and Cancel as a link to the status page", async () => {
    const res = pageResponse();
    restoreGet(request(), res);
    const model = res.render.mock.calls[0][1];
    const page = withoutSignOutForm(environment.render("deed-polls/deletions/restore.njk", { ...model.en, ...model }));

    expect(page.match(/<button/g)).toHaveLength(1);
    expect(page).toContain('value="restore"');
    expect(page).toContain(`action="/deed-polls/deletions/${REQUEST_ID}/restore?case=case-1"`);
    expect(page).toMatch(new RegExp(`<a class="govuk-link" href="/deed-polls/deletions/${REQUEST_ID}">\\s*Cancel`));
    expect(page).toContain("with nothing lost");
    expect(await axeViolations(page)).toEqual([]);
  }, 30_000);
});

describe("deletions/restore.njk, once the request has gone", () => {
  it("should say so and link back to the application, offering no restore", async () => {
    vi.mocked(restoreDeletion).mockRejectedValue(new NotFoundError("Deletion request not found"));
    const res = pageResponse();

    await restorePost(Object.assign(request(), { body: { action: "restore" } }), res);

    const model = res.render.mock.calls[0][1];
    const page = withoutSignOutForm(environment.render("deed-polls/deletions/restore.njk", { ...model.en, ...model }));
    expect(page).toContain("This deletion request no longer exists");
    expect(page).toContain('href="/deed-polls/case-1"');
    expect(page).toContain("View the application");
    expect(page).not.toContain("<button");
  });
});

async function axeViolations(markup: string): Promise<{ id: string; nodes: string[] }[]> {
  const dom = new JSDOM(markup, { runScripts: "outside-only" });
  dom.window.eval(axe.source);
  const main = dom.window.document.getElementById("main-content");
  if (!main) throw new Error("no main-content");
  const results = await (dom.window as unknown as { axe: typeof axe }).axe.run(main, { rules: { "color-contrast": { enabled: false } } });
  dom.window.close();
  return results.violations.map((each) => ({ id: each.id, nodes: each.nodes.map((node) => node.html) }));
}
