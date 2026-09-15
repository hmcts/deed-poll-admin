/**
 * The mock's own behaviour: the `__mock` control routes, and the api rules it restates.
 *
 * `client.test.ts` covers the contract routes through the adapter, which is how they are actually reached.
 * What is left for here is everything the adapter has no function for — scenario switching, resetting,
 * seeding — plus the api rules the mock reproduces (listed in `server.ts`), tested directly so a wrong
 * restatement fails here rather than as a puzzling page assertion.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type MockCase, type RunningMockApi, startMockApi } from "./server.js";

let mock: RunningMockApi;

beforeAll(async () => {
  mock = await startMockApi();
});

afterAll(async () => {
  await mock.close();
});

beforeEach(async () => {
  mock.setScenario("happy-path");
  await post("/__mock/reset");
});

describe("GET /health", () => {
  // Both paths, because the adapter's readiness probe uses the liveness group and `yarn dev`/Playwright
  // wait on the aggregate — a mock serving only one of them breaks whichever it is not.
  it.each(["/health", "/health/liveness"])(
    "should answer %s even when the scenario says api is unavailable, so dev and Playwright can wait on it",
    async (path) => {
      mock.setScenario("api-unavailable");

      const response = await fetch(`${mock.url}${path}`);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ status: "UP" });
    }
  );
});

describe("POST /__mock/scenario", () => {
  it("should switch behaviour without a restart", async () => {
    const response = await post("/__mock/scenario", { scenario: "api-unavailable" });

    expect(response.status).toBe(200);
    expect(mock.scenario).toBe("api-unavailable");
  });

  it("should refuse an unknown scenario rather than silently leaving the current one", async () => {
    // A typo that answered 200 would look like a bug in the app under test rather than in the request.
    const response = await post("/__mock/scenario", { scenario: "no-such-scenario" });

    expect(response.status).toBe(400);
    expect(mock.scenario).toBe("happy-path");
  });

  it("should refuse a prototype property, which `in` would have accepted as a scenario", async () => {
    const response = await post("/__mock/scenario", { scenario: "constructor" });

    expect(response.status).toBe(400);
    expect(mock.scenario).toBe("happy-path");
  });
});

describe("POST /__mock/reset", () => {
  it("should forget every case", async () => {
    mock.seed({ newForename: "Jo" });

    await post("/__mock/reset");

    const listed = await get("/caseworker/cases");
    expect(listed.cases).toEqual([]);
  });

  it("should restart the reference serials, so a seeded run is reproducible", async () => {
    const first = await post("/caseworker/cases", { dateReceived: "2026-03-10" });
    await post("/__mock/reset");
    const afterReset = await post("/caseworker/cases", { dateReceived: "2026-03-10" });

    expect((await afterReset.json()).displayReference).toBe((await first.json()).displayReference);
  });
});

describe("POST /__mock/cases", () => {
  it("should seed a case in a given state without applying the create rules", async () => {
    // The point of the route: no Date Received, which a real create refuses.
    const response = await post("/__mock/cases", { newForename: "Jo", state: "Enroled" });

    expect(response.status).toBe(201);
    const seeded = await response.json();
    expect(seeded.newForename).toBe("Jo");
    expect(seeded.state).toBe("Enroled");
    expect(seeded.displayReference).toBe(null);
  });

  it("should seed a case with children, so a page can be tested against a populated one", async () => {
    const seeded = mock.seed({
      notes: [{ id: "note-1", note: "Seeded", createdOn: new Date(), modifiedOn: new Date(), createdBy: "Someone", modifiedBy: "Someone" }],
      witnesses: [
        {
          id: "witness-1",
          witnessName: "Ada Lovelace",
          witnessAddress: "1 Test Street",
          witnessOccupation: "Mathematician",
          declarant: true,
          createdOn: new Date(),
          modifiedOn: new Date()
        }
      ]
    });

    const read = await get(`/caseworker/cases/${seeded.id}`);

    expect(read.notes).toHaveLength(1);
    expect(read.witnesses[0].witnessName).toBe("Ada Lovelace");
    // Seeded rather than posted, which is the point of `seed`: a page that renders a witness gets one
    // without driving the create route first. The route exists now — see "the witness routes" below.
    expect(read.witnesses[0].declarant).toBe(true);
  });

  it("should read a seeded date sent as a string, since JSON has no Date", async () => {
    // Left as a string it reaches the response serialiser, which 500s AND leaves the unusable record in
    // the map — so the next read of the list fails too, long after the request that caused it.
    const response = await post("/__mock/cases", { dateReceived: "2026-01-01T00:00:00", dateEnroled: "2026-02-01T00:00:00" });

    expect(response.status).toBe(201);
    const seeded = await response.json();
    expect(seeded.dateReceived).toBe("2026-01-01T00:00:00.000");
    // Computed from the pair, which is only possible if both were read as dates.
    expect(seeded.daysReceivedToEnroled).toBe(31);
    expect((await get("/caseworker/cases")).cases).toHaveLength(1);
  });

  it("should refuse a seeded field it cannot read rather than storing it", async () => {
    const response = await post("/__mock/cases", { dateReceived: "not-a-date" });

    expect(response.status).toBe(400);
    expect((await get("/caseworker/cases")).cases).toEqual([]);
  });
});

describe("the audit author", () => {
  // api takes no author parameter — it derives one from the caller's token — so this is the only thing
  // that makes `Created By` right, and the e2e create journey asserts it.
  const token = (subject: string) => `x.${Buffer.from(JSON.stringify({ sub: subject }), "utf8").toString("base64url")}.signature`;

  it("should attribute a case to the subject the forwarded token names", async () => {
    const created = await (await post("/caseworker/cases", { dateReceived: "2026-03-10" }, { authorization: `Bearer ${token("admin@example.com")}` })).json();

    expect(created.createdBy).toBe("admin@example.com");
    expect(created.modifiedBy).toBe("admin@example.com");
  });

  it("should attribute a note to the token's subject too, not to the case's author", async () => {
    const seeded = mock.seed({ createdBy: "Someone Else" });

    const note = await (
      await post(`/caseworker/cases/${seeded.id}/notes`, { note: "Chased" }, { authorization: `Bearer ${token("caseworker@example.com")}` })
    ).json();

    expect(note.createdBy).toBe("caseworker@example.com");
  });

  it("should fall back to a name that is obviously not IDAM's when no token was forwarded", async () => {
    const created = await (await post("/caseworker/cases", { dateReceived: "2026-03-10" })).json();

    expect(created.createdBy).toBe("Mock Caseworker");
  });

  it("should fall back rather than fail when the token is not a decodable JWT", async () => {
    // A hand-rolled `curl` against the mock, which should still work.
    const response = await post("/caseworker/cases", { dateReceived: "2026-03-10" }, { authorization: "Bearer opaque-token" });

    expect(response.status).toBe(201);
    expect((await response.json()).createdBy).toBe("Mock Caseworker");
  });
});

describe("the reference number", () => {
  it("should take the year from date received, not from the clock", async () => {
    const created = await (await post("/caseworker/cases", { dateReceived: "2019-06-01" })).json();

    expect(created.displayReference).toMatch(/^KBDP2019-\d{5}$/);
  });

  it("should share one serial sequence across both prefixes within a year", async () => {
    const adult = await (await post("/caseworker/cases", { dateReceived: "2026-03-10", type: "Adult" })).json();
    const relinquishment = await (await post("/caseworker/cases", { dateReceived: "2026-03-10", type: "DeedOfRelinquishment" })).json();

    expect(adult.referencenumber).toBe(1);
    expect(relinquishment.referencenumber).toBe(2);
    expect(relinquishment.displayReference).toBe("KBDR2026-00002");
  });

  it("should count separately per year", async () => {
    await post("/caseworker/cases", { dateReceived: "2026-03-10" });
    const other = await (await post("/caseworker/cases", { dateReceived: "2027-01-04" })).json();

    expect(other.displayReference).toBe("KBDP2027-00001");
  });

  it("should consume no serial when the create is refused for having no date received", async () => {
    const refused = await post("/caseworker/cases", { type: "Adult" });
    const next = await (await post("/caseworker/cases", { dateReceived: "2026-03-10" })).json();

    expect(refused.status).toBe(400);
    expect(next.referencenumber).toBe(1);
  });
});

describe("the derived state", () => {
  // The cascade's order is the source workflow's, and the pairs matter: signature-received is evaluated
  // BEFORE the referral pair, so a signed case reads Awaiting Enrolment even with a referral date set.
  const CASES: [string, Record<string, string>][] = [
    ["Received", {}],
    ["AwaitingFurtherDocs", { awaitingFurtherDocsInfo: "2026-03-11" }],
    ["ReadyForMaster", { dateReadyForMaster: "2026-03-12" }],
    ["ReferredToMaster", { dateReadyForMaster: "2026-03-12", dateReferred: "2026-03-13" }],
    ["AwaitingSignature", { signatureRequestedDate: "2026-03-14" }],
    ["AwaitingEnrolment", { signatureRequestedDate: "2026-03-14", signatureReceivedDate: "2026-03-15" }],
    ["AwaitingEnrolment", { signatureReceivedDate: "2026-03-15", dateReadyForMaster: "2026-03-12", dateReferred: "2026-03-13" }],
    ["Enroled", { dateEnroled: "2026-03-16" }],
    ["Returned", { dateReturned: "2026-03-17" }]
  ];

  for (const [state, dates] of CASES) {
    it(`should be ${state} for ${Object.keys(dates).join(" + ") || "date received alone"}`, async () => {
      const created = await (await post("/caseworker/cases", { dateReceived: "2026-03-10", ...dates })).json();

      expect(created.state).toBe(state);
    });
  }
});

describe("the cross-field date rules", () => {
  it("should refuse a case that is both enroled and returned", async () => {
    const response = await post("/caseworker/cases", { dateReceived: "2026-03-10", dateEnroled: "2026-04-01", dateReturned: "2026-04-02" });

    expect(response.status).toBe(400);
    expect((await response.json()).errors[0].field).toBe("state");
  });

  it("should refuse a signature received before it was requested", async () => {
    const response = await post("/caseworker/cases", { dateReceived: "2026-03-10", signatureRequestedDate: "2026-03-20", signatureReceivedDate: "2026-03-01" });

    expect(response.status).toBe(400);
    expect((await response.json()).errors[0].field).toBe("signatureReceivedDate");
  });

  it("should accept a signature received with no requested date, which is a different and permitted gap", async () => {
    const response = await post("/caseworker/cases", { dateReceived: "2026-03-10", signatureReceivedDate: "2026-03-01" });

    expect(response.status).toBe(201);
  });
});

/**
 * api's `DeedPollService.requireWitnessesForEnrolment`. Restated in the mock so a page that explains the
 * refusal can be driven against something that issues one — see `docs/plans/07-witness-count-feedback.md`.
 */
describe("the two-witness enrolment gate", () => {
  it("should refuse a patch that sets Date Enroled while the case has one witness", async () => {
    const id = await caseWithWitnesses(1);

    const response = await patch(`/caseworker/cases/${id}`, { dateEnroled: "2026-04-01" });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.errors).toEqual([
      {
        field: "dateEnroled",
        message: "A Deed Poll cannot be sent for enrolment until two witnesses have been recorded. This case has one; please add one more witness."
      }
    ]);
  });

  it("should count the shortfall rather than only refusing, so a case with none is told to add two", async () => {
    const id = await caseWithWitnesses(0);

    const response = await patch(`/caseworker/cases/${id}`, { signatureReceivedDate: "2026-03-25" });

    expect((await response.json()).errors[0].message).toContain("This case has none; please add two witnesses.");
  });

  it("should address the refusal to the date this write sets, so it lands on the box just filled in", async () => {
    const id = await caseWithWitnesses(1);

    const response = await patch(`/caseworker/cases/${id}`, { signatureReceivedDate: "2026-03-25" });

    expect((await response.json()).errors[0].field).toBe("signatureReceivedDate");
  });

  it("should refuse an edit to an unrelated field on a case that already carries an enrolment date", async () => {
    // The merged-record behaviour, and the case everyone forgets: this write mentions no date at all, but it
    // still leaves the record enrolled. The refusal names the date the record carries, since the patch names
    // neither.
    const id = await caseWithWitnesses(1, { signatureReceivedDate: new Date("2026-03-25T00:00:00Z") });

    const response = await patch(`/caseworker/cases/${id}`, { newSurname: "Amended" });

    expect(response.status).toBe(400);
    expect((await response.json()).errors[0].field).toBe("signatureReceivedDate");
  });

  it("should accept the same patch once the second witness is recorded", async () => {
    const id = await caseWithWitnesses(2);

    const response = await patch(`/caseworker/cases/${id}`, { dateEnroled: "2026-04-01" });

    expect(response.status).toBe(200);
    expect((await response.json()).state).toBe("Enroled");
  });

  it("should report a contradictory pair of dates ahead of the shortfall, so one thing is said at a time", async () => {
    const id = await caseWithWitnesses(0, { dateEnroled: new Date("2026-04-01T00:00:00Z") });

    const response = await patch(`/caseworker/cases/${id}`, { dateReturned: "2026-04-02" });

    expect((await response.json()).errors[0].field).toBe("state");
  });

  it("should not gate a create, because witnesses are children of a row that has to exist first", async () => {
    // Gating the create would forbid the state outright rather than gate a transition into it — api does not,
    // and the seeded fixtures a page renders against depend on it not doing so here either.
    const response = await post("/caseworker/cases", { dateReceived: "2026-03-10", dateEnroled: "2026-04-01" });

    expect(response.status).toBe(201);
  });
});

describe("the witness routes", () => {
  const WITNESS = { witnessName: "Alex Witness", witnessAddress: "1 Test Road", witnessOccupation: "Baker", declarant: false };

  it("should refuse a declarant sent as a string rather than coercing it", async () => {
    // Here rather than in `client.test.ts` because the adapter's types make it unreachable through
    // `createWitness`: `"false"` is truthy in JavaScript, so a coerced declarant would silently be stored
    // as an ordinary witness, and api refuses the string for exactly that reason.
    const seeded = mock.seed(null);

    const response = await post(`/caseworker/cases/${seeded.id}/witnesses`, { ...WITNESS, declarant: "true" });

    expect(response.status).toBe(400);
    expect((await response.json()).errors[0].field).toBe("declarant");
  });

  it("should delete a witness with 204 and no body, as api's delete answers", async () => {
    const seeded = mock.seed(null);
    const created = await (await post(`/caseworker/cases/${seeded.id}/witnesses`, WITNESS)).json();

    const response = await fetch(`${mock.url}/caseworker/cases/${seeded.id}/witnesses/${created.id}`, { method: "DELETE" });

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect((await get(`/caseworker/cases/${seeded.id}/witnesses`)).length).toBe(0);
  });

  it("should delete without asking for a role, because a 403 is not a state this mock models", async () => {
    // api gates `removeWitness` on `caseworker-deedpoll-admin`; this mock reads no roles out of a token, so
    // an anonymous DELETE succeeds here. What that leaves untested locally is api's gate, which is api's own
    // test — and `canDeleteWitness` is what decides whether the control is offered at all.
    const seeded = mock.seed(null);
    const created = await (await post(`/caseworker/cases/${seeded.id}/witnesses`, WITNESS)).json();

    const response = await fetch(`${mock.url}/caseworker/cases/${seeded.id}/witnesses/${created.id}`, { method: "DELETE" });

    expect(response.status).toBe(204);
  });

  it("should still refuse a method it has no route for on a witness", async () => {
    const seeded = mock.seed(null);
    const created = await (await post(`/caseworker/cases/${seeded.id}/witnesses`, WITNESS)).json();

    const response = await fetch(`${mock.url}/caseworker/cases/${seeded.id}/witnesses/${created.id}`, { method: "PUT" });

    expect(response.status).toBe(405);
  });
});

describe("route ordering", () => {
  it("should resolve field-rules before the case-id route, not read it as an id", async () => {
    // The trap api relies on Spring's pattern ordering to avoid: matched the other way round, this
    // answers 404 for a route that exists.
    const response = await fetch(`${mock.url}/caseworker/cases/field-rules?type=Adult`);

    expect(response.status).toBe(200);
    expect((await response.json()).rules.maritalStatus).toEqual({ visible: true, required: true });
  });

  it("should answer 404 for a case id that is not there, naming the id", async () => {
    const response = await fetch(`${mock.url}/caseworker/cases/00000000-0000-0000-0000-000000000000`);

    expect(response.status).toBe(404);
    expect((await response.json()).error).toContain("00000000-0000-0000-0000-000000000000");
  });

  it("should answer 404 for a route neither api nor the mock serves", async () => {
    const response = await fetch(`${mock.url}/caseworker/cases/some-id/unknown-child`);

    expect(response.status).toBe(404);
  });
});

describe("the field-rules parameters", () => {
  it("should refuse a repeated parameter rather than picking one for the caller", async () => {
    const response = await fetch(`${mock.url}/caseworker/cases/field-rules?type=Adult&type=Minor`);

    expect(response.status).toBe(400);
    expect((await response.json()).errors[0].field).toBe("type");
  });

  it("should refuse a flag that is not a boolean rather than reading it as false", async () => {
    const response = await fetch(`${mock.url}/caseworker/cases/field-rules?migrated=maybe`);

    expect(response.status).toBe(400);
    expect((await response.json()).errors[0].field).toBe("migrated");
  });

  it("should answer the everything-optional rules for no type at all", async () => {
    const rules = (await get("/caseworker/cases/field-rules")).rules;

    expect(rules.maritalStatus).toEqual({ visible: true, required: false });
    expect(rules.ageOfMinor).toEqual({ visible: true, required: false });
  });

  it("should hide the old-name and marital fields for a deed of relinquishment", async () => {
    const rules = (await get("/caseworker/cases/field-rules?type=DeedOfRelinquishment")).rules;

    expect(rules.oldForename.visible).toBe(false);
    expect(rules.maritalStatus.visible).toBe(false);
    expect(rules.inPerson).toEqual({ visible: true, required: true });
  });
});

describe("the list query", () => {
  it("should AND the conditions rather than widening the result with each one", async () => {
    mock.seed({ type: "Adult", newForename: "Ada" });
    mock.seed({ type: "Minor", newForename: "Ada" });
    mock.seed({ type: "Adult", newForename: "Grace" });

    const list = await get("/caseworker/cases?where=type:is:Adult&where=newForename:is:Ada");

    expect(list.cases.map((summary: { newForename: string }) => summary.newForename)).toEqual(["Ada"]);
    expect(list.total).toBe(1);
  });

  it("should apply the tab and the query together, so a bookmarked filter keeps meaning what it means", async () => {
    mock.seed({ type: "Adult", state: "Enroled" });
    const open = mock.seed({ type: "Adult", state: "Received" });

    const list = await get("/caseworker/cases?filter=open&where=type:is:Adult");

    expect(list.filter).toBe("open");
    expect(list.cases.map((summary: { id: string }) => summary.id)).toEqual([open.id]);
  });

  it("should match text case-insensitively for contains and startsWith, as api's lower() comparison does", async () => {
    mock.seed({ newForename: "Ada" });

    expect((await get("/caseworker/cases?where=newForename:contains:DA")).cases).toHaveLength(1);
    expect((await get("/caseworker/cases?where=newForename:startsWith:ad")).cases).toHaveLength(1);
    expect((await get("/caseworker/cases?where=newForename:is:ada")).cases).toHaveLength(0);
  });

  it("should keep a colon and a comma inside a single-valued operator's value", async () => {
    mock.seed({ returnReason: "Returned at 10:30, unsigned" });

    expect((await get(`/caseworker/cases?where=${encodeURIComponent("returnReason:contains:at 10:30, unsigned")}`)).cases).toHaveLength(1);
  });

  it("should split a list-taking operator's values on commas and trim them", async () => {
    mock.seed({ type: "Adult" });
    mock.seed({ type: "Minor" });
    mock.seed({ type: "Unknown" });

    const list = await get(`/caseworker/cases?where=${encodeURIComponent("type:isOneOf:Adult, Minor")}`);

    expect(list.cases.map((summary: { type: string }) => summary.type).sort()).toEqual(["Adult", "Minor"]);
  });

  it("should compare a date between its bounds inclusively", async () => {
    mock.seed({ dateReceived: new Date("2026-06-01T00:00:00Z") });
    mock.seed({ dateReceived: new Date("2026-07-15T00:00:00Z") });

    const list = await get("/caseworker/cases?where=dateReceived:between:2026-06-01,2026-06-30");

    expect(list.total).toBe(1);
  });

  it("should match only a blank for isEmpty, and only a populated one for isNotEmpty", async () => {
    mock.seed({ newForename: "Ada" });
    mock.seed({ newForename: null });

    expect((await get("/caseworker/cases?where=newForename:isEmpty")).total).toBe(1);
    expect((await get("/caseworker/cases?where=newForename:isNotEmpty")).total).toBe(1);
  });

  it("should never match a blank field against a comparison, as SQL does not", async () => {
    mock.seed({ dateReceived: null });

    expect((await get("/caseworker/cases?where=dateReceived:before:2030-01-01")).total).toBe(0);
  });

  it("should ask a multiselect whether the option is chosen", async () => {
    mock.seed({ iShall: [1, 2] });
    mock.seed({ iShall: [] });

    expect((await get("/caseworker/cases?where=iShall:contains:2")).total).toBe(1);
    expect((await get("/caseworker/cases?where=iShall:contains:9")).total).toBe(0);
  });

  it("should refuse each unreadable condition at its own position, so three mistakes report three", async () => {
    const response = await fetch(`${mock.url}/caseworker/cases?where=nonsense:is:x&where=type:is:Adult&where=type:notAnOperator:x`);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.errors.map((error: { field: string }) => error.field)).toEqual(["where.0", "where.2"]);
  });

  it("should refuse a field that has no column, since a derived count cannot be queried", async () => {
    const response = await fetch(`${mock.url}/caseworker/cases?where=daysReceivedToEnroled:gt:10`);

    expect(response.status).toBe(400);
    expect((await response.json()).errors[0].field).toBe("where.0");
  });

  it("should refuse a value count the operator does not take", async () => {
    const response = await fetch(`${mock.url}/caseworker/cases?where=dateReceived:between:2026-06-01`);

    expect(response.status).toBe(400);
  });

  it("should refuse the whole request beyond the cap of twenty conditions rather than truncating to it", async () => {
    // Truncating would answer a narrower question invisibly, which is the one failure a caseworker cannot see.
    const where = Array.from({ length: 21 }, () => "where=type:is:Adult").join("&");

    const response = await fetch(`${mock.url}/caseworker/cases?${where}`);

    expect(response.status).toBe(400);
    expect((await response.json()).errors[0].field).toBe("where");
  });
});

describe("the list sort", () => {
  it("should default to newest first, which is what the endpoint answered before it took a sort", async () => {
    const older = mock.seed({ createdOn: new Date("2026-01-01T00:00:00Z") });
    const newer = mock.seed({ createdOn: new Date("2026-02-01T00:00:00Z") });

    const list = await get("/caseworker/cases");

    expect(list.cases.map((summary: { id: string }) => summary.id)).toEqual([newer.id, older.id]);
  });

  it("should read a bare field name as ascending", async () => {
    mock.seed({ newForename: "Bea" });
    mock.seed({ newForename: "Ada" });

    const list = await get("/caseworker/cases?sort=newForename");

    expect(list.cases.map((summary: { newForename: string }) => summary.newForename)).toEqual(["Ada", "Bea"]);
  });

  it("should sort a blank last ascending and first descending, as Postgres orders nulls", async () => {
    mock.seed({ newForename: "Ada" });
    mock.seed({ newForename: null });

    const ascending = await get("/caseworker/cases?sort=newForename:asc");
    const descending = await get("/caseworker/cases?sort=newForename:desc");

    expect(ascending.cases.map((summary: { newForename: string | null }) => summary.newForename)).toEqual(["Ada", null]);
    expect(descending.cases.map((summary: { newForename: string | null }) => summary.newForename)).toEqual([null, "Ada"]);
  });

  it("should refuse an unknown field and an unknown direction", async () => {
    expect((await fetch(`${mock.url}/caseworker/cases?sort=nonsense:asc`)).status).toBe(400);
    expect((await fetch(`${mock.url}/caseworker/cases?sort=newForename:sideways`)).status).toBe(400);
    // A colon with nothing after it is a control nobody filled in, not an undirected sort.
    expect((await fetch(`${mock.url}/caseworker/cases?sort=newForename:`)).status).toBe(400);
  });
});

describe("the list paging", () => {
  beforeEach(() => {
    for (const forename of ["Ada", "Bea", "Cyd"]) mock.seed({ newForename: forename });
  });

  it("should default to the first page of twenty-five", async () => {
    const list = await get("/caseworker/cases");

    expect(list).toMatchObject({ page: 1, size: 25, total: 3, totalPages: 1 });
  });

  it("should count the whole result set rather than the rows on the page", async () => {
    const list = await get("/caseworker/cases?sort=newForename:asc&page=2&size=2");

    expect(list.cases.map((summary: { newForename: string }) => summary.newForename)).toEqual(["Cyd"]);
    expect(list).toMatchObject({ page: 2, size: 2, total: 3, totalPages: 2 });
  });

  it("should answer an empty page past the end rather than refusing it", async () => {
    const list = await get("/caseworker/cases?page=9&size=2");

    expect(list.cases).toEqual([]);
    expect(list).toMatchObject({ total: 3, totalPages: 2 });
  });

  it("should report zero pages for an empty result set, not one page with nothing on it", async () => {
    const list = await get("/caseworker/cases?where=newForename:is:Nobody");

    expect(list).toMatchObject({ total: 0, totalPages: 0 });
  });

  it("should clamp a size above the cap rather than refusing it, and say which size it applied", async () => {
    const list = await get("/caseworker/cases?size=500");

    expect(list.size).toBe(100);
  });

  it("should refuse a page or a size that is not a whole number of one or more", async () => {
    for (const query of ["page=0", "page=nonsense", "size=0", "size=1.5"]) {
      const response = await fetch(`${mock.url}/caseworker/cases?${query}`);

      expect(response.status, query).toBe(400);
    }
  });
});

describe("when the scenario says api is unavailable", () => {
  it("should answer 503 on every contract route while leaving the control routes working", async () => {
    mock.setScenario("api-unavailable");

    expect((await fetch(`${mock.url}/caseworker/cases`)).status).toBe(503);
    expect((await fetch(`${mock.url}/caseworker/document-types`)).status).toBe(503);
    expect((await post("/__mock/reset")).status).toBe(200);
  });
});

async function post(path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${mock.url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

async function patch(path: string, body: unknown): Promise<Response> {
  return fetch(`${mock.url}${path}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

/** The mock's raw JSON. `any` because these tests assert against the wire body, not a parsed type. */
async function get(path: string): Promise<any> {
  return (await fetch(`${mock.url}${path}`)).json();
}

/**
 * A seeded case carrying `recorded` witnesses, for the enrolment gate.
 *
 * Seeded rather than created because the gate is on the update path: a create that already carries the
 * dates under test is not what a caseworker does, and seeding keeps the arrangement out of the assertion.
 */
async function caseWithWitnesses(recorded: number, fields: Partial<MockCase> = {}): Promise<string> {
  const seeded = mock.seed(fields);

  for (const index of Array.from({ length: recorded }, (_, at) => at)) {
    await post(`/caseworker/cases/${seeded.id}/witnesses`, {
      witnessName: `Witness ${index + 1}`,
      witnessAddress: "1 Test Road",
      witnessOccupation: "Baker",
      declarant: false
    });
  }

  return seeded.id;
}
