/**
 * The amend-a-saved-query form's markup, rendered rather than asserted through the view model.
 *
 * The model is asserted in `[queryId]/edit.test.ts`. What this file exists for is the one property the model
 * cannot show: that both write controls are **absent** for a query api says the caller may not amend, rather
 * than present and disabled — `witness-edit.njk` holds the reasoning, and a disabled button has no value to
 * read.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findSavedQuery } from "@hmcts/deed-poll";
import type { SavedQuery } from "@hmcts/deed-poll-api-client";
import nunjucks from "nunjucks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../express-doubles.js";
import { GET } from "./[queryId]/edit.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findSavedQuery: vi.fn()
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

/** The amend form as a browser receives it, for the query api answers with. */
const render = async (query: SavedQuery): Promise<string> => {
  vi.mocked(findSavedQuery).mockResolvedValue(query as never);
  const res = pageResponse();
  await GET(pageRequest({ params: { queryId: "sq-1" }, accessToken: "session-token" }), res);
  const model = res.render.mock.calls[0][1];

  return environment.render("deed-polls/queries/edit.njk", { ...model.en, ...model });
};

describe("amend a saved query template", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render the stored query in its controls, with the share box ticked for a published one", async () => {
    const page = await render(savedQuery());

    expect(page).toContain('value="Awaiting enrolment"');
    expect(page).toContain("Received cases with a Gazette notice");
    expect(page).toContain("checked");
  });

  it("should offer save and delete when api says the query is editable, with delete styled as a warning", async () => {
    const page = await render(savedQuery({ editable: true }));

    expect(page).toContain("Save changes");
    expect(page).toContain("Delete query");
    expect(page).toContain("govuk-button--warning");
  });

  it("should leave save and delete out entirely when api says it is not editable, rather than disabling them", async () => {
    const page = await render(savedQuery({ editable: false }));

    expect(page).not.toContain("Save changes");
    expect(page).not.toContain("Delete query");
    expect(page).not.toContain("disabled");
    // A form with no way to submit it reads as broken, so the sentence in their place says why.
    expect(page).toContain("This query belongs to someone else");
  });

  it("should post back to its own query's amend URL", async () => {
    const page = await render(savedQuery());

    expect(page).toContain('action="/deed-polls/queries/sq-1/edit"');
  });
});
