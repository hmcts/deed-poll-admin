/**
 * Pins what the per-handler unit tests structurally cannot see: how these four files behave once
 * `createSimpleRouter` has discovered them and Express is matching real paths.
 *
 * The trap being pinned is route ordering. `/deed-polls/field-rules` and `/deed-polls/:id` both
 * match the request `GET /deed-polls/field-rules`, and Express takes the first registered. It
 * happens to be correct here because `sortRoutes` orders by parameter count — but nothing in
 * `field-rules.ts` states that dependency, and if the ordering rule ever changed, every unit test
 * in this directory would still pass while the live endpoint started answering 404 for the string
 * "field-rules" read as a case id. That is the kind of regression a unit test cannot reach.
 *
 * The router is built over this directory rather than a fixture, so the file layout under test is
 * the real one.
 */
import { fileURLToPath } from "node:url";
import { findDeedPoll, findDeedPolls, getCaseFieldRules, NotFoundError } from "@hmcts/deed-poll";
import { DeedPollType } from "@hmcts/postgres-prisma";
import { createSimpleRouter } from "@hmcts-cft/simple-router";
import express, { type Express } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../../errors.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPolls: vi.fn(),
  findDeedPoll: vi.fn(),
  createDeedPoll: vi.fn(),
  updateDeedPoll: vi.fn(),
  removeDeedPoll: vi.fn(),
  validateCaseForSubmit: vi.fn(),
  getCaseFieldRules: vi.fn()
}));

const routesDir = fileURLToPath(new URL(".", import.meta.url));

async function appWithDeedPollRoutes(): Promise<Express> {
  const app = express();
  app.use(express.json());
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
    vi.mocked(getCaseFieldRules).mockReturnValue(rules as never);
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
    expect(findDeedPoll).toHaveBeenCalledWith("case-1");
  });

  it("should mount the nested validate route under the id parameter", async () => {
    const { validateCaseForSubmit } = await import("@hmcts/deed-poll");
    vi.mocked(validateCaseForSubmit).mockResolvedValue({ id: "case-1" } as never);

    const response = await request(await appWithDeedPollRoutes()).post("/deed-polls/case-1/validate");

    expect(response.status).toBe(200);
    expect(validateCaseForSubmit).toHaveBeenCalledWith("case-1");
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
    vi.mocked(getCaseFieldRules).mockReturnValue({} as never);

    const response = await request(await appWithDeedPollRoutes()).get(`/deed-polls/field-rules?type=${DeedPollType.Minor}`);

    expect(response.status).toBe(200);
    expect(getCaseFieldRules).toHaveBeenCalledWith(DeedPollType.Minor);
  });

  it("should answer 404 with the domain's message when a case is missing", async () => {
    vi.mocked(findDeedPoll).mockRejectedValue(new NotFoundError("DeedPoll missing not found"));

    const response = await request(await appWithDeedPollRoutes()).get("/deed-polls/missing");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "DeedPoll missing not found" });
  });

  it("should answer 204 with an empty body on delete", async () => {
    const { removeDeedPoll } = await import("@hmcts/deed-poll");
    vi.mocked(removeDeedPoll).mockResolvedValue(undefined);

    const response = await request(await appWithDeedPollRoutes()).delete("/deed-polls/case-1");

    expect(response.status).toBe(204);
    expect(response.text).toBe("");
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
    // Regression guard. reference-number.ts threw a bare Error for an absent Date Received, which
    // errorHandler cannot recognise, so the single most obvious request against this API — a
    // create with no Date Received — answered "Internal server error". Asserted here rather than
    // only in the domain because the defect was the pairing of the two, and only a real request
    // shows which the caller actually sees.
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

  it("should honour the x-user-roles header in test and dev, so an admin-only privacy write reaches the domain flagged", async () => {
    const { createDeedPoll } = await import("@hmcts/deed-poll");
    vi.mocked(createDeedPoll).mockResolvedValue({ id: "case-1" } as never);

    await request(await appWithDeedPollRoutes())
      .post("/deed-polls")
      .set("x-user-roles", "deedpoll-admin")
      .set("x-user-name", "A Caseworker")
      .send({});

    expect(createDeedPoll).toHaveBeenCalledWith({}, { isAdmin: true, userName: "A Caseworker" });
  });
});
