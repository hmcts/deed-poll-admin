/**
 * The delete-confirmation markup, rendered rather than asserted through the view model.
 *
 * The model is asserted in `[queryId]/delete.test.ts`. What this file exists for is what the model cannot
 * show: that the only thing on the page that can act is the one warning-styled submit, that cancel is a link
 * and therefore posts nothing, and that the confirm control is **absent** for a query api says the caller may
 * not delete rather than present and disabled.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findSavedQuery } from "@hmcts/deed-poll";
import type { SavedQuery } from "@hmcts/deed-poll-api-client";
import nunjucks from "nunjucks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../express-doubles.js";
import { GET } from "./[queryId]/delete.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findSavedQuery: vi.fn()
}));

// The three roots `configureGovuk` mounts, minus the assets — the same set as `./edit.njk.test.ts`.
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

const savedQuery = (overrides: Partial<SavedQuery> = {}): SavedQuery =>
  ({
    id: "sq-1",
    name: "Awaiting enrolment",
    description: "Received cases with a Gazette notice",
    shared: true,
    ownerId: "owner-1",
    ownerName: "A Caseworker",
    filter: "received",
    conditions: [],
    sortField: null,
    sortDirection: null,
    searchTerm: null,
    selected: true,
    editable: true,
    createdBy: "A Caseworker",
    modifiedBy: "A Caseworker",
    createdOn: null,
    modifiedOn: null,
    ...overrides
  }) as SavedQuery;

/** The confirmation as a browser receives it, for the query api answers with. */
const render = async (query: SavedQuery): Promise<string> => {
  vi.mocked(findSavedQuery).mockResolvedValue(query as never);
  const res = pageResponse();
  await GET(pageRequest({ params: { queryId: "sq-1" }, accessToken: "session-token" }), res);
  const model = res.render.mock.calls[0][1];

  return environment.render("deed-polls/queries/delete.njk", { ...model, ...model.en });
};

describe("delete a saved query template", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should name the query and warn about colleagues without quoting a number", async () => {
    const page = await render(savedQuery());

    expect(page).toContain("Awaiting enrolment");
    expect(page).toContain("Other people may have this query in their filter bar");
    expect(page).toContain("govuk-warning-text");
  });

  it("should offer exactly one submit, styled as a warning, so nothing else on the page can act", async () => {
    const page = await render(savedQuery());

    expect(page.match(/<button/g)).toHaveLength(1);
    expect(page).toContain("govuk-button--warning");
    expect(page).toContain('value="delete"');
  });

  it("should make cancel a link out of the form rather than a second submit", async () => {
    const page = await render(savedQuery());

    expect(page).toContain('<a class="govuk-link" href="/deed-polls/queries/sq-1/edit">Cancel</a>');
  });

  it("should leave the confirm out entirely when api says the query is not the caller's to delete", async () => {
    const page = await render(savedQuery({ editable: false }));

    expect(page).not.toContain("<button");
    expect(page).not.toContain("disabled");
    expect(page).toContain("This query belongs to someone else");
  });

  it("should post back to its own query's delete URL", async () => {
    const page = await render(savedQuery());

    expect(page).toContain('action="/deed-polls/queries/sq-1/delete"');
  });
});
