/**
 * The save-a-query form's markup, rendered rather than asserted through the view model.
 *
 * The model is asserted in `new.test.ts`. What this file exists for is the property the model cannot show:
 * that the query being saved is in the form's **action** and in no hidden input, which is what stops the page
 * from holding a second copy of state the URL already carries.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSavedQuery, selectSavedQuery } from "@hmcts/deed-poll";
import nunjucks from "nunjucks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../express-doubles.js";
import { GET, POST } from "./new.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  createSavedQuery: vi.fn(),
  selectSavedQuery: vi.fn()
}));

// The three roots `configureGovuk` mounts, minus the assets — the same set as `../index.njk.test.ts`.
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

const QUERY = { filter: "received", where: ["newSurname:contains:Smith"], sort: "dateReceived:desc" };

const html = (model: Record<string, unknown>): string => environment.render("deed-polls/queries/new.njk", { ...model, ...(model.en as object) });

describe("save a query template", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createSavedQuery).mockResolvedValue({ id: "sq-1" } as never);
    vi.mocked(selectSavedQuery).mockResolvedValue(undefined);
  });

  it("should carry the query in the form's action and in no hidden input", async () => {
    const res = pageResponse();

    await GET(pageRequest({ query: QUERY, accessToken: "session-token" }), res);
    const page = html(res.render.mock.calls[0][1]);

    expect(page).toContain('action="/deed-polls/queries/new?filter=received&amp;where=newSurname%3Acontains%3ASmith&amp;sort=dateReceived%3Adesc"');
    expect(page).not.toContain('name="where"');
    expect(page).not.toContain('name="filter"');
  });

  it("should offer the three controls the form asks for, and a share box that is not ticked by default", async () => {
    const res = pageResponse();

    await GET(pageRequest({ query: QUERY, accessToken: "session-token" }), res);
    const page = html(res.render.mock.calls[0][1]);

    expect(page).toContain('id="name"');
    expect(page).toContain('id="description"');
    expect(page).toContain('name="shared"');
    expect(page).not.toContain("checked");
  });

  it("should show a rejected name in the summary and against the input, so it can be corrected in place", async () => {
    const res = pageResponse();

    await POST(pageRequest({ query: QUERY, body: { name: "  ", description: "Received cases" }, accessToken: "session-token" }), res);
    const page = html(res.render.mock.calls[0][1]);

    expect(page).toContain("There is a problem");
    expect(page).toContain('href="#name"');
    expect(page).toContain("Enter a name for this query");
    expect(page).toContain("Received cases");
  });
});
