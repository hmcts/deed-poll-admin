/**
 * The library's own markup, rendered rather than asserted through the view model.
 *
 * The model is asserted in `index.test.ts`; what this file exists for is the one thing a model cannot show —
 * that a control api says the caller may not use is **absent** rather than disabled, and that the add/remove
 * button is one control in two states rather than two controls. `witness-edit.njk` holds the reasoning for
 * hidden-not-disabled: a disabled button has no value to read.
 *
 * The model comes from the page handler rather than being hand-built here, so a name the handler stops
 * passing fails this test too.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findSavedQueries } from "@hmcts/deed-poll";
import type { SavedQuery } from "@hmcts/deed-poll-api-client";
import nunjucks from "nunjucks";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../express-doubles.js";
import { GET } from "./index.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findSavedQueries: vi.fn()
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
    selected: false,
    editable: false,
    createdBy: "A Caseworker",
    modifiedBy: "A Caseworker",
    createdOn: null,
    modifiedOn: null,
    ...overrides
  }) as SavedQuery;

/** The library as a browser receives it, for the queries api answers with. */
const render = async (queries: SavedQuery[]): Promise<string> => {
  vi.mocked(findSavedQueries).mockResolvedValue(queries as never);
  const res = pageResponse();
  await GET(pageRequest({ accessToken: "session-token" }), res);
  const model = res.render.mock.calls[0][1];

  return environment.render("deed-polls/queries/index.njk", { ...model.en, ...model });
};

describe("saved query library template", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render each query as a link to the list it describes", async () => {
    const html = await render([savedQuery()]);

    expect(html).toContain('href="/deed-polls?filter=received"');
    expect(html).toContain("Awaiting enrolment");
    expect(html).toContain("Received cases with a Gazette notice");
    expect(html).toContain("A Caseworker");
  });

  it("should offer add for a query the caller has not got, and remove for one they have", async () => {
    const notMine = await render([savedQuery({ selected: false })]);
    const mine = await render([savedQuery({ selected: true })]);

    expect(notMine).toContain("Add to my filter bar");
    expect(notMine).not.toContain("Remove from my filter bar");
    expect(mine).toContain("Remove from my filter bar");
    expect(mine).not.toContain("Add to my filter bar");
  });

  it("should post the query's id with the action, so one form serves one row", async () => {
    const html = await render([savedQuery()]);

    expect(html).toContain('<input type="hidden" name="queryId" value="sq-1">');
    expect(html).toContain('name="action"');
    expect(html).toContain('value="add"');
  });

  it("should offer the amend link only when api says the query is editable", async () => {
    const html = await render([savedQuery({ editable: true })]);

    expect(html).toContain('href="/deed-polls/queries/sq-1/edit"');
  });

  it("should leave the amend link out entirely for a query api says is not editable, rather than disabling it", async () => {
    const html = await render([savedQuery({ editable: false })]);

    expect(html).not.toContain("/deed-polls/queries/sq-1/edit");
    expect(html).not.toContain("disabled");
  });

  it("should say which queries are published and which are in the caller's filter bar", async () => {
    const html = await render([savedQuery({ shared: true, selected: true })]);

    expect(html).toContain("Published");
    expect(html).toContain("In your filter bar");
  });

  it("should tell a caseworker how to get their first saved query rather than rendering an empty list", async () => {
    const html = await render([]);

    expect(html).toContain("No queries have been saved yet");
    expect(html).not.toContain("Add to my filter bar");
  });

  it("should head both groups when the caller has queries of each kind", async () => {
    const html = await render([
      savedQuery({ id: "mine", name: "Mine only", shared: false }),
      savedQuery({ id: "theirs", name: "Published one", shared: true })
    ]);

    expect(html).toContain("Your queries");
    expect(html).toContain("Query library");
    expect(html).toContain("Mine only");
    expect(html).toContain("Published one");
  });

  it("should render no library heading when nothing is published, rather than a heading over nothing", async () => {
    // To a screen-reader user a heading is a promise of content — the rule `deed-polls/index.ts`'s
    // `filterGroups` states for the filter bar, which now has to hold twice over here.
    const html = await render([savedQuery({ shared: false })]);

    expect(html).toContain("Your queries");
    expect(html).not.toContain("Query library");
  });

  it("should render no 'Your queries' heading when everything visible is published", async () => {
    const html = await render([savedQuery({ shared: true })]);

    expect(html).toContain("Query library");
    expect(html).not.toContain("Your queries");
  });

  it("should render neither heading for a caller with nothing, only the empty message", async () => {
    const html = await render([]);

    expect(html).not.toContain("Your queries");
    expect(html).not.toContain("Query library");
  });

  it("should put the live-reference note under the library, where it is the only thing true", async () => {
    // It warns that an added query stays its owner's and changes under you. A caller with nothing published
    // has nothing to be warned about, so the note goes with the group rather than under the page title.
    const published = await render([savedQuery({ shared: true })]);
    const privateOnly = await render([savedQuery({ shared: false })]);

    expect(published).toContain("stays its owner");
    expect(privateOnly).not.toContain("stays its owner");
  });
});
