/**
 * Pins what the per-handler unit tests structurally cannot see: how every route file under this
 * directory behaves once `createSimpleRouter` has discovered it and Express is matching real paths.
 * Two different traps, hence two describe blocks.
 *
 * **Route ordering**, for the case routes. `/deed-polls/field-rules` and `/deed-polls/:id` both
 * match the request `GET /deed-polls/field-rules`, and Express takes the first registered. It
 * happens to be correct because `sortRoutes` orders by parameter count — but nothing in
 * `field-rules.ts` states that dependency, and if the ordering rule ever changed, every unit test
 * in this directory would still pass while the live endpoint started answering 404 for the string
 * "field-rules" read as a case id.
 *
 * **Parameter binding**, for the nested notes and witnesses routes. Those paths carry two
 * parameters, and a handler that mixed them up — or read the parent's id for the child — would
 * still satisfy its own unit test, because the request double supplies whatever params the test
 * names. Only a real request proves which segment lands where.
 *
 * Both are regressions a unit test cannot reach. The router is built over this directory rather
 * than a fixture, so the file layout under test is the real one.
 */
import { fileURLToPath } from "node:url";
import { DEEDPOLL_ADMIN, DeedPollType, findDeedPoll, findDeedPolls, getCaseFieldRules, NotFoundError } from "@hmcts/deed-poll";
import { createSimpleRouter } from "@hmcts-cft/simple-router";
import express, { type Express } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../../errors.js";
import { attachUserDouble } from "../../express-doubles.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPolls: vi.fn(),
  findDeedPoll: vi.fn(),
  createDeedPoll: vi.fn(),
  updateDeedPoll: vi.fn(),
  validateCaseForSubmit: vi.fn(),
  getCaseFieldRules: vi.fn(),
  findNotes: vi.fn(),
  createNote: vi.fn(),
  findNote: vi.fn(),
  updateNote: vi.fn(),
  findWitnesses: vi.fn(),
  findWitness: vi.fn()
}));

const routesDir = fileURLToPath(new URL(".", import.meta.url));

async function appWithDeedPollRoutes(): Promise<Express> {
  const app = express();
  app.use(express.json());
  // Stands in for `authenticate()`, which needs a live issuer. Admin and named, because two of the
  // tests below are about the caller reaching the domain at all.
  app.use(attachUserDouble(DEEDPOLL_ADMIN, "A Caseworker"));
  app.use(await createSimpleRouter({ path: routesDir, prefix: "/deed-polls" }));
  app.use(errorHandler());
  return app;
}

describe("deed-poll routes wired through simple-router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "test";
  });

  it("should resolve /deed-polls/field-rules as the static route, not as an id", async () => {
    const rules = { visible: ["ageOfMinor"] };
    vi.mocked(getCaseFieldRules).mockResolvedValue(rules as never);
    vi.mocked(findDeedPoll).mockRejectedValue(new NotFoundError("DeedPoll field-rules not found"));

    const response = await request(await appWithDeedPollRoutes()).get("/deed-polls/field-rules");

    expect(response.status).toBe(200);
    expect(response.body).toEqual(rules);
    expect(findDeedPoll).not.toHaveBeenCalled();
  });

  it("should still route a real id to the dynamic route", async () => {
    vi.mocked(findDeedPoll).mockResolvedValue({ id: "case-1" } as never);

    const response = await request(await appWithDeedPollRoutes()).get("/deed-polls/case-1");

    expect(response.status).toBe(200);
    expect(findDeedPoll).toHaveBeenCalledWith("case-1", expect.anything());
  });

  it("should mount the nested validate route under the id parameter", async () => {
    const { validateCaseForSubmit } = await import("@hmcts/deed-poll");
    vi.mocked(validateCaseForSubmit).mockResolvedValue({ id: "case-1" } as never);

    const response = await request(await appWithDeedPollRoutes()).post("/deed-polls/case-1/validate");

    expect(response.status).toBe(200);
    expect(validateCaseForSubmit).toHaveBeenCalledWith("case-1", expect.anything());
  });

  it("should turn a rejected Zod parse into a 400 carrying per-field errors", async () => {
    const response = await request(await appWithDeedPollRoutes())
      .post("/deed-polls")
      .send({ type: "NotAType" });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Validation failed");
    expect(response.body.errors).toEqual([expect.objectContaining({ field: "type" })]);
  });

  it("should answer 400 for an unrecognised field-rules type", async () => {
    const response = await request(await appWithDeedPollRoutes()).get("/deed-polls/field-rules?type=NotAType");

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual([expect.objectContaining({ field: "type" })]);
    expect(getCaseFieldRules).not.toHaveBeenCalled();
  });

  it("should answer 200 for a valid field-rules type through the query string", async () => {
    vi.mocked(getCaseFieldRules).mockResolvedValue({} as never);

    const response = await request(await appWithDeedPollRoutes()).get(`/deed-polls/field-rules?type=${DeedPollType.Minor}`);

    expect(response.status).toBe(200);
    expect(getCaseFieldRules).toHaveBeenCalledWith({ type: DeedPollType.Minor }, expect.anything());
  });

  it("should answer 404 with the domain's message when a case is missing", async () => {
    vi.mocked(findDeedPoll).mockRejectedValue(new NotFoundError("DeedPoll missing not found"));

    const response = await request(await appWithDeedPollRoutes()).get("/deed-polls/missing");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "DeedPoll missing not found" });
  });

  it("should answer 404 for a case delete, which api has no endpoint for and this app no longer routes", async () => {
    // The route went with the data access layer in task 3 of docs/plans/02-dal-cutover-to-api.md, and
    // this is what says so: a 404 here rather than a 204 is the whole of the behaviour change, and it
    // would otherwise be provable only by the absence of a test.
    const response = await request(await appWithDeedPollRoutes()).delete("/deed-polls/case-1");

    expect(response.status).toBe(404);
  });

  it("should answer 201 on create and 200 on the collection, matching the prototype's status codes", async () => {
    const { createDeedPoll } = await import("@hmcts/deed-poll");
    vi.mocked(createDeedPoll).mockResolvedValue({ id: "case-1" } as never);
    vi.mocked(findDeedPolls).mockResolvedValue([] as never);
    const app = await appWithDeedPollRoutes();

    expect((await request(app).post("/deed-polls").send({})).status).toBe(201);
    expect((await request(app).get("/deed-polls")).status).toBe(200);
  });

  it("should answer 400, not 500, when a create cannot allocate a reference number", async () => {
    // Regression guard, and it still holds now that the allocation is api's: the failure arrives as an
    // InvalidInputError carrying the field either way. It used to be a bare Error from
    // reference-number.ts, which errorHandler cannot recognise, so the single most obvious request
    // against this API — a create with no Date Received — answered "Internal server error". Asserted
    // here rather than only in the domain because the defect was the pairing of the two, and only a
    // real request shows which the caller actually sees.
    const { createDeedPoll, InvalidInputError } = await import("@hmcts/deed-poll");
    vi.mocked(createDeedPoll).mockRejectedValue(
      new InvalidInputError("Cannot allocate a reference number without a Date Received to derive the year", [
        { field: "dateReceived", message: "Enter the date the application was received" }
      ])
    );

    const response = await request(await appWithDeedPollRoutes())
      .post("/deed-polls")
      .send({ type: "Adult" });

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual([{ field: "dateReceived", message: "Enter the date the application was received" }]);
  });

  it("should forward the caller's bearer token to the domain, and nothing it made up itself", async () => {
    // Previously this asserted the resolved caller's `isAdmin` and name reached the domain. Neither is
    // sent any more: api derives both from the token, so what is worth pinning is that the token this
    // request arrived with is what travels — a handler that dropped it would make every write a 401,
    // and one that substituted a service credential would attribute every case to this app.
    const { createDeedPoll } = await import("@hmcts/deed-poll");
    vi.mocked(createDeedPoll).mockResolvedValue({ id: "case-1" } as never);

    await request(await appWithDeedPollRoutes())
      .post("/deed-polls")
      .set("authorization", "Bearer caseworker-token")
      .send({});

    expect(createDeedPoll).toHaveBeenCalledWith({}, { accessToken: "caseworker-token" });
  });
});

// Nested children get their own block because the thing worth pinning is different: not "does the
// static route win" but "does each of the two path parameters land in the right place". A handler
// that read `req.params.id` for the child id, or passed the ids the wrong way round, would still
// satisfy its own unit test — the double supplies whatever params the test names — but would make
// every note reachable through any case's URL.
describe("nested notes and witnesses wired through simple-router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "test";
  });

  it("should pass the case id and the note id from their own path segments, in that order", async () => {
    const { findNote } = await import("@hmcts/deed-poll");
    vi.mocked(findNote).mockResolvedValue({ id: "note-9" } as never);

    const response = await request(await appWithDeedPollRoutes()).get("/deed-polls/case-1/notes/note-9");

    expect(response.status).toBe(200);
    expect(findNote).toHaveBeenCalledWith("case-1", "note-9", expect.anything());
  });

  it("should pass the case id and the witness id from their own path segments, in that order", async () => {
    const { findWitness } = await import("@hmcts/deed-poll");
    vi.mocked(findWitness).mockResolvedValue({ id: "witness-9" } as never);

    const response = await request(await appWithDeedPollRoutes()).get("/deed-polls/case-1/witnesses/witness-9");

    expect(response.status).toBe(200);
    expect(findWitness).toHaveBeenCalledWith("case-1", "witness-9", expect.anything());
  });

  it("should route the notes collection to the collection handler, not to the single-note route", async () => {
    const { findNotes, findNote } = await import("@hmcts/deed-poll");
    vi.mocked(findNotes).mockResolvedValue([] as never);

    const response = await request(await appWithDeedPollRoutes()).get("/deed-polls/case-1/notes");

    expect(response.status).toBe(200);
    expect(findNotes).toHaveBeenCalledWith("case-1", expect.anything());
    expect(findNote).not.toHaveBeenCalled();
  });

  it("should not let /deed-polls/:id/notes be swallowed by the single-case route", async () => {
    // /deed-polls/:id has fewer segments, so it registers first; Express matches on the full path
    // so it cannot claim this one, but that is worth a test rather than an assumption.
    const { findNotes, findDeedPoll } = await import("@hmcts/deed-poll");
    vi.mocked(findNotes).mockResolvedValue([] as never);

    await request(await appWithDeedPollRoutes()).get("/deed-polls/case-1/notes");

    expect(findDeedPoll).not.toHaveBeenCalled();
  });

  it("should answer 201 on a nested create", async () => {
    const { createNote } = await import("@hmcts/deed-poll");
    vi.mocked(createNote).mockResolvedValue({ id: "note-1" } as never);

    const created = await request(await appWithDeedPollRoutes())
      .post("/deed-polls/case-1/notes")
      .send({ note: "Called" });

    expect(created.status).toBe(201);
  });

  it("should answer 404, not an empty list, when listing children of a case that does not exist", async () => {
    // findNotes/findWitnesses/findDocuments used to filter by deedPollId without checking the
    // parent, so a mistyped case id answered 200 with [] — indistinguishable from a real case that
    // has no notes. api's nested routes 404 for it; this pins what the caller sees as a result.
    const { findNotes } = await import("@hmcts/deed-poll");
    vi.mocked(findNotes).mockRejectedValue(new NotFoundError("DeedPoll nope not found"));

    const response = await request(await appWithDeedPollRoutes()).get("/deed-polls/nope/notes");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "DeedPoll nope not found" });
  });

  it("should still answer 200 with an empty list for a real case with no children", async () => {
    const { findWitnesses } = await import("@hmcts/deed-poll");
    vi.mocked(findWitnesses).mockResolvedValue([] as never);

    const response = await request(await appWithDeedPollRoutes()).get("/deed-polls/case-1/witnesses");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it("should answer 404 when a child belongs to a different case", async () => {
    const { findNote } = await import("@hmcts/deed-poll");
    vi.mocked(findNote).mockRejectedValue(new NotFoundError("Note note-9 not found"));

    const response = await request(await appWithDeedPollRoutes()).get("/deed-polls/other-case/notes/note-9");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Note note-9 not found" });
  });

  it("should answer 400 with a field error for a blank note, using the same rule as the SSR forms", async () => {
    const { createNote } = await import("@hmcts/deed-poll");

    const response = await request(await appWithDeedPollRoutes())
      .post("/deed-polls/case-1/notes")
      .send({ note: "   " });

    expect(response.status).toBe(400);
    expect(response.body.errors).toEqual([expect.objectContaining({ field: "note" })]);
    expect(createNote).not.toHaveBeenCalled();
  });

  it("should forward the caller's token on a nested write and no author name of its own", async () => {
    // Previously this asserted the resolved caller's name reached the domain so the note could be
    // attributed. api stamps the author from the token now, so sending a name alongside would let this
    // app attribute a note to whoever it liked — and dropping the token would make every write a 401.
    const { createNote } = await import("@hmcts/deed-poll");
    vi.mocked(createNote).mockResolvedValue({ id: "note-1" } as never);

    await request(await appWithDeedPollRoutes())
      .post("/deed-polls/case-1/notes")
      .set("authorization", "Bearer caseworker-token")
      .send({ note: "Called the applicant" });

    expect(createNote).toHaveBeenCalledWith("case-1", { note: "Called the applicant" }, { accessToken: "caseworker-token" });
  });
});

/**
 * The child deletes are gone, and this is what says so.
 *
 * They were `[requireRoles(DEEDPOLL_ADMIN), handler]` — admin-only, on the reasoning that removing a note
 * or a witness is a records change rather than data entry. api has no witness delete at all, and its note
 * delete is wired through in task 6 of `docs/plans/02-dal-cutover-to-api.md`; either way authorisation is
 * api's decision from the caller's own token now, so a second role check in this app would be one rule
 * with two owners. A 404 here rather than a 204 or a 403 is the whole of the behaviour change.
 */
describe("the child deletes api has no endpoint for", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "test";
  });

  async function appAs(roles: string | undefined): Promise<Express> {
    const app = express();
    app.use(express.json());
    app.use(attachUserDouble(roles, "A Caseworker"));
    app.use(await createSimpleRouter({ path: routesDir, prefix: "/deed-polls" }));
    app.use(errorHandler());
    return app;
  }

  const paths = [
    { what: "a note", path: "/deed-polls/case-1/notes/note-1" },
    { what: "a witness", path: "/deed-polls/case-1/witnesses/witness-1" }
  ] as const;

  for (const { what, path } of paths) {
    it.each([DEEDPOLL_ADMIN, undefined])(`should answer 404 deleting ${what} whatever the caller's roles (%s)`, async (roles) => {
      const response = await request(await appAs(roles)).delete(path);

      expect(response.status).toBe(404);
    });
  }
});
