/**
 * The mock's own behaviour: the `__mock` control routes, and the api rules it restates.
 *
 * `client.test.ts` covers the contract routes through the adapter, which is how they are actually reached.
 * What is left for here is everything the adapter has no function for — scenario switching, resetting,
 * seeding — plus the api rules the mock reproduces (listed in `server.ts`), tested directly so a wrong
 * restatement fails here rather than as a puzzling page assertion.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MOCK_EMAIL_HISTORY } from "./fixtures.js";
import { type MockCase, type RunningMockApi, startMockApi } from "./server.js";

/** `server.ts`'s `MOCK_USER_NAME` — who a write with no token forwarded is attributed to. */
const MOCK_CASEWORKER = "Mock Caseworker";

/** The direction a judge recorded, which is what `judges_reason` arrives pre-populated with. */
const JUDGES_REASON = "The evidence supplied does not establish the applicant's identity.";

/**
 * One judge, as a token carrying nothing but a `sub` names them — so their display name and their subject are the
 * same string, which is the ordinary case here and at `rse-idam-simulator`.
 *
 * Where the two must differ, `asPerson` gives a token carrying both: see the same-display-name test, which is the
 * only thing that can show ownership is keyed on the subject rather than on the attribution beside it.
 */
const JUDGE = "judge@example.com";

/** The same judge as a person whose display name and IDAM subject are different values — see `asPerson`. */
const JUDGE_NAME = "HHJ Solomon";
const JUDGE_SUBJECT = "solomon-subject";

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

describe("the saved-query routes", () => {
  it("should order the library by name, as api v1 orders it", async () => {
    // Insertion order here would make a page's rendering order accidental: it would look right locally and
    // be something else deployed.
    await post("/caseworker/saved-queries", { name: "Zebra" });
    await post("/caseworker/saved-queries", { name: "Aardvark" });

    const listed = await get("/caseworker/saved-queries");

    expect(listed.map((query: { name: string }) => query.name)).toEqual(["Aardvark", "Zebra"]);
  });

  it("should flag every query editable, because permissions are not a thing this mock models", async () => {
    // api computes `editable` from `SavedQueryPermissions` — the owner, or an Administrator for a shared
    // query. This mock reads no roles out of a token, so it cannot produce a false and does not pretend to:
    // what the UI does with the flag is tested by giving it both values in the page tests, not here.
    const created = await (await post("/caseworker/saved-queries", { name: "Somebody else's, for all this mock knows" })).json();

    expect(created.editable).toBe(true);
    expect((await get(`/caseworker/saved-queries/${created.id}`)).editable).toBe(true);
  });

  it("should attribute a query to the caller the token names, as it attributes a case's audit author", async () => {
    const token = `header.${Buffer.from(JSON.stringify({ sub: "caseworker@example.com" })).toString("base64url")}.signature`;

    const created = await (await post("/caseworker/saved-queries", { name: "Mine" }, { authorization: `Bearer ${token}` })).json();

    expect(created.ownerId).toBe("caseworker@example.com");
    expect(created.ownerName).toBe("caseworker@example.com");
    expect(created.createdBy).toBe("caseworker@example.com");
  });

  it("should refuse a body the wire schema rejects, addressing the failure to its field", async () => {
    const response = await post("/caseworker/saved-queries", { name: "Too many", conditions: Array.from({ length: 21 }, () => "state:is:Enroled") });

    expect(response.status).toBe(400);
    expect((await response.json()).errors[0].field).toBe("conditions");
  });

  it("should refuse a filter that is not one of api's five tabs", async () => {
    const response = await post("/caseworker/saved-queries", { name: "Bad tab", filter: "in-progress" });

    expect(response.status).toBe(400);
    expect((await response.json()).errors[0].field).toBe("filter");
  });

  it("should forget a deleted query's selections, as api's foreign key cascades them", async () => {
    const created = await (await post("/caseworker/saved-queries", { name: "Selected then deleted" })).json();
    await fetch(`${mock.url}/caseworker/saved-queries/${created.id}/selection`, { method: "PUT" });
    await fetch(`${mock.url}/caseworker/saved-queries/${created.id}`, { method: "DELETE" });

    // Re-created under a new id, so a leaked selection could only come from the id that went.
    const replacement = await (await post("/caseworker/saved-queries", { name: "Selected then deleted" })).json();

    expect(replacement.selected).toBe(false);
  });

  it("should forget every saved query on a reset", async () => {
    await post("/caseworker/saved-queries", { name: "Before the reset" });

    await post("/__mock/reset");

    expect(await get("/caseworker/saved-queries")).toEqual([]);
  });

  it("should refuse a method it has no route for on the collection", async () => {
    const response = await fetch(`${mock.url}/caseworker/saved-queries`, { method: "PUT" });

    expect(response.status).toBe(405);
  });

  it("should refuse a method it has no route for on one query", async () => {
    const created = await (await post("/caseworker/saved-queries", { name: "No PUT here" })).json();

    const response = await fetch(`${mock.url}/caseworker/saved-queries/${created.id}`, { method: "PUT" });

    expect(response.status).toBe(405);
  });

  it("should refuse a method it has no route for on the selection sub-resource", async () => {
    const created = await (await post("/caseworker/saved-queries", { name: "No PATCH here" })).json();

    const response = await patch(`/caseworker/saved-queries/${created.id}/selection`, {});

    expect(response.status).toBe(405);
  });

  it("should answer 404 for a path below a query that neither api nor the mock serves", async () => {
    const created = await (await post("/caseworker/saved-queries", { name: "No children" })).json();

    const response = await fetch(`${mock.url}/caseworker/saved-queries/${created.id}/subscribers`);

    expect(response.status).toBe(404);
  });
});

describe("route ordering", () => {
  it("should resolve the saved-query collection before the id pattern, not read the bare path as an id", async () => {
    // The same trap as field-rules, the other way round: read as an id, the collection would 404 and only
    // the sub-paths would work.
    const response = await fetch(`${mock.url}/caseworker/saved-queries`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

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

describe("the list search term", () => {
  it("should match a name as a case-insensitive substring, as the published q rule states", async () => {
    mock.seed({ newSurname: "Smithson" });
    mock.seed({ newSurname: "Jones" });

    const list = await get("/caseworker/cases?q=smith");

    expect(list.cases.map((summary: { newSurname: string }) => summary.newSurname)).toEqual(["Smithson"]);
    expect(list.total).toBe(1);
  });

  it.each(["newForename", "newSurname", "oldForename", "oldSurname", "parents", "representativeName"] as const)(
    "should search %s, one of the six fields the term is matched against",
    async (field) => {
      mock.seed({ [field]: "Wollstonecraft" } as Partial<MockCase>);

      expect((await get("/caseworker/cases?q=stonecraft")).total).toBe(1);
    }
  );

  it("should not search an address or a narrative field, which api deliberately excludes", async () => {
    mock.seed({ applicantAddress1: "Wollstonecraft Road", returnReason: "Returned to Wollstonecraft" });

    expect((await get("/caseworker/cases?q=Wollstonecraft")).total).toBe(0);
  });

  it("should not match a misspelling, because the term is substring and not fuzzy", async () => {
    mock.seed({ newSurname: "Smith" });

    expect((await get("/caseworker/cases?q=Smyth")).total).toBe(0);
  });

  it("should treat a blank term as no search rather than as a term nothing matches", async () => {
    mock.seed({ newSurname: "Smith" });

    expect((await get("/caseworker/cases?q=")).total).toBe(1);
    expect((await get(`/caseworker/cases?q=${encodeURIComponent("   ")}`)).total).toBe(1);
  });

  it("should AND the term with the filter and the conditions rather than widening either", async () => {
    mock.seed({ newSurname: "Smith", type: "Adult", state: "Received" });
    mock.seed({ newSurname: "Smith", type: "Minor", state: "Received" });
    mock.seed({ newSurname: "Smith", type: "Adult", state: "Enroled" });

    const list = await get("/caseworker/cases?q=Smith&filter=open&where=type:is:Adult");

    expect(list.total).toBe(1);
  });

  it("should page the matches rather than paging the whole list and then matching it", async () => {
    for (const surname of ["Smith", "Smithers", "Jones"]) mock.seed({ newSurname: surname });

    const list = await get("/caseworker/cases?q=Smith&page=1&size=25");

    expect(list.total).toBe(2);
    expect(list.cases).toHaveLength(2);
  });

  it("should carry the exactly-matched case's id as referenceMatch", async () => {
    const seeded = mock.seed({ displayReference: "KBDP2026-00042", newSurname: "Smith" });

    expect((await get("/caseworker/cases?q=KBDP2026-00042")).referenceMatch).toBe(seeded.id);
  });

  it.each(["kbdp2026-00042", "KBDP202600042", " KBDP2026-00042 "])("should match the reference tolerantly of case, hyphens and spaces for %s", async (term) => {
    const seeded = mock.seed({ displayReference: "KBDP2026-00042" });

    expect((await get(`/caseworker/cases?q=${encodeURIComponent(term)}`)).referenceMatch).toBe(seeded.id);
  });

  it("should leave referenceMatch null for a name term, so a name search is never redirected past", async () => {
    mock.seed({ displayReference: "KBDP2026-00042", newSurname: "Smith" });

    const list = await get("/caseworker/cases?q=Smith");

    expect(list.total).toBe(1);
    expect(list.referenceMatch).toBeNull();
  });

  it("should leave referenceMatch null when there is no term at all, whatever a case's reference is", async () => {
    mock.seed({ displayReference: "KBDP2026-00042" });

    expect((await get("/caseworker/cases")).referenceMatch).toBeNull();
  });

  it("should leave referenceMatch null when the filter excludes the case whose reference matched", async () => {
    // Otherwise a page would redirect to a case the caseworker's own filter had just excluded.
    mock.seed({ displayReference: "KBDP2026-00042", state: "Enroled" });

    const list = await get("/caseworker/cases?q=KBDP2026-00042&filter=open");

    expect(list.total).toBe(0);
    expect(list.referenceMatch).toBeNull();
  });

  it("should include the surname in a row, since a surname match has to be able to show what it matched", async () => {
    mock.seed({ newForename: "Ada", newSurname: "Smith" });

    expect((await get("/caseworker/cases")).cases[0]).toMatchObject({ newForename: "Ada", newSurname: "Smith" });
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

describe("the referral routes", () => {
  it("should raise a referral Open and unclaimed, attributing it to the token's subject", async () => {
    const seeded = mock.seed(null);

    const response = await post(`/caseworker/cases/${seeded.id}/referrals`, { reasons: ["Minor", "Other"], notes: "  Why  " }, as("caseworker@example.com"));

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      state: "Open",
      reasons: ["Minor", "Other"],
      notes: "Why",
      // Defaulted rather than stored as none, so the pool's first sort key is never blank.
      urgency: "Normal",
      migrated: false,
      claimedBy: null,
      decision: null,
      createdBy: "caseworker@example.com"
    });
  });

  it("should list a case's referrals newest first, as api's own query orders them", async () => {
    const { caseId, referralId } = await referredCase();
    await post(`/caseworker/cases/${caseId}/referrals/${referralId}/withdrawal`);
    const second = await (await post(`/caseworker/cases/${caseId}/referrals`, { reasons: ["DomesticAbuse"] })).json();

    const listed = await get(`/caseworker/cases/${caseId}/referrals`);

    expect(listed.map((referral: { id: string }) => referral.id)).toEqual([second.id, referralId]);
  });

  it("should refuse a second referral with 409 while the first is still in play", async () => {
    const { caseId } = await referredCase();

    const response = await post(`/caseworker/cases/${caseId}/referrals`, { reasons: ["Minor"] });

    // 409 and not 400: nothing about the body is wrong, and the same request succeeds unchanged once the
    // live referral is closed or withdrawn.
    expect(response.status).toBe(409);
  });

  it("should allow another referral once the previous one is terminal", async () => {
    const { caseId, referralId } = await referredCase();
    await post(`/caseworker/cases/${caseId}/referrals/${referralId}/withdrawal`);

    const response = await post(`/caseworker/cases/${caseId}/referrals`, { reasons: ["Minor"] });

    expect(response.status).toBe(201);
  });

  it("should withdraw a claimed referral, because the judiciary holding it does not make it final", async () => {
    const { caseId, referralId } = await claimedReferral("judge@example.com");

    const response = await post(`/caseworker/cases/${caseId}/referrals/${referralId}/withdrawal`);

    expect(response.status).toBe(200);
    expect((await response.json()).state).toBe("Withdrawn");
  });

  it("should refuse to withdraw a referral a judge has directed, since the direction has to be actioned instead", async () => {
    // api's `canBeWithdrawn()`, added by referrals-api-4: Decided is non-terminal — the case still has a live
    // referral and still sits in the returned-for-action queue — and withdrawal is refused all the same.
    const { caseId, referralId } = await decidedReferral("judge@example.com");

    const response = await post(`/caseworker/cases/${caseId}/referrals/${referralId}/withdrawal`);

    expect(response.status).toBe(409);
    // The refused withdrawal changed nothing: the direction is still readable and the case still counted.
    expect((await get(`/caseworker/cases/${caseId}/referrals/${referralId}`)).state).toBe("Decided");
    expect(await currentReferralState(caseId)).toBe("Decided");
  });

  it("should tell a caseworker looking at a direction to action it, not that it was already withdrawn", async () => {
    // Two messages rather than one "already X", which is api's choice and the reason this is asserted: the
    // same words for both would tell someone reading a returned direction that they had withdrawn it.
    const decided = await decidedReferral("judge@example.com");
    const withdrawn = await referredCase();
    await post(`/caseworker/cases/${withdrawn.caseId}/referrals/${withdrawn.referralId}/withdrawal`);

    const onDecided = await post(`/caseworker/cases/${decided.caseId}/referrals/${decided.referralId}/withdrawal`);
    const onWithdrawn = await post(`/caseworker/cases/${withdrawn.caseId}/referrals/${withdrawn.referralId}/withdrawal`);

    expect((await onDecided.json()).error).toContain("must be actioned and the referral closed");
    expect((await onWithdrawn.json()).error).toContain("already Withdrawn");
  });

  it("should still hold a Decided referral as the case's live one, so a second cannot be raised beside it", async () => {
    // The reason `isTerminal` was left alone. Narrowing it so Decided counted as terminal would have made the
    // withdrawal guard read correctly and quietly allowed a second referral on a case awaiting action.
    const { caseId } = await decidedReferral("judge@example.com");

    const response = await post(`/caseworker/cases/${caseId}/referrals`, { reasons: ["Minor"] });

    expect(response.status).toBe(409);
  });

  it("should allow another referral once the direction has been actioned and the referral closed", async () => {
    const { caseId, referralId } = await decidedReferral("judge@example.com");
    await post(`/caseworker/cases/${caseId}/referrals/${referralId}/closure`);

    const response = await post(`/caseworker/cases/${caseId}/referrals`, { reasons: ["Minor"] });

    expect(response.status).toBe(201);
    expect(await currentReferralState(caseId)).toBe("Open");
  });

  it("should refuse a second withdrawal with 409 rather than answering as though the click did something", async () => {
    const { caseId, referralId } = await referredCase();
    await post(`/caseworker/cases/${caseId}/referrals/${referralId}/withdrawal`);

    const response = await post(`/caseworker/cases/${caseId}/referrals/${referralId}/withdrawal`);

    expect(response.status).toBe(409);
  });

  it.each(["Open", "Withdrawn"])("should refuse a closure with 409 while the referral is %s", async (state) => {
    // Closing an Open referral would take it out of the pool with no direction on it, and closing a
    // Withdrawn one would relabel a referral that was abandoned as one that was actioned.
    const { caseId, referralId } = await referredCase();
    if (state === "Withdrawn") await post(`/caseworker/cases/${caseId}/referrals/${referralId}/withdrawal`);

    const response = await post(`/caseworker/cases/${caseId}/referrals/${referralId}/closure`);

    expect(response.status).toBe(409);
  });

  it("should close a Decided referral, leaving the direction exactly as the judge recorded it", async () => {
    const { caseId, referralId } = await decidedReferral("judge@example.com");

    const response = await post(`/caseworker/cases/${caseId}/referrals/${referralId}/closure`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ state: "Closed", decision: "Approved", decidedBy: "judge@example.com", publishToGazette: true });
  });

  it("should demand notes when Other is among the reasons, addressing the refusal to the field", async () => {
    const seeded = mock.seed(null);

    const response = await post(`/caseworker/cases/${seeded.id}/referrals`, { reasons: ["Other"] });

    expect(response.status).toBe(400);
    expect((await response.json()).errors).toEqual([{ field: "notes", message: expect.any(String) }]);
  });

  it("should demand an urgencyReason when the urgency is Urgent", async () => {
    const seeded = mock.seed(null);

    const response = await post(`/caseworker/cases/${seeded.id}/referrals`, { reasons: ["Minor"], urgency: "Urgent" });

    expect(response.status).toBe(400);
    expect((await response.json()).errors[0].field).toBe("urgencyReason");
  });

  it("should refuse a body naming no reason, which is what the wire schema is for", async () => {
    const seeded = mock.seed(null);

    const response = await post(`/caseworker/cases/${seeded.id}/referrals`, { reasons: [] });

    expect(response.status).toBe(400);
    expect((await response.json()).errors[0].field).toBe("reasons");
  });

  it("should answer 404 for a referral of another case, as api's scoping does", async () => {
    const { referralId } = await referredCase();
    const other = mock.seed(null);

    const response = await fetch(`${mock.url}/caseworker/cases/${other.id}/referrals/${referralId}`);

    expect(response.status).toBe(404);
  });

  it("should refuse a method it has no route for on a referral", async () => {
    const { caseId, referralId } = await referredCase();

    const response = await fetch(`${mock.url}/caseworker/cases/${caseId}/referrals/${referralId}`, { method: "DELETE" });

    // There is no delete and no patch: amending a referral is withdrawing it and raising another.
    expect(response.status).toBe(405);
  });
});

describe("the case's currentReferralState", () => {
  it("should be null on a case that has never been referred", async () => {
    const seeded = mock.seed(null);

    expect((await get(`/caseworker/cases/${seeded.id}`)).currentReferralState).toBeNull();
  });

  it("should follow the live referral through every transition, and go null when it becomes terminal", async () => {
    // The whole rule in one test, because what matters is the sequence: api's column is "the state of the
    // case's one referral that is not terminal, or null", so Closed must leave the case null rather than
    // Closed — the drift that would leave every actioned case in the "returned — action needed" queue.
    const { caseId, referralId } = await referredCase();
    const judge = "judge@example.com";
    const seen: (string | null)[] = [await currentReferralState(caseId)];

    await post(`/judicial/referrals/${referralId}/claim`, undefined, as(judge));
    seen.push(await currentReferralState(caseId));

    await post(`/judicial/referrals/${referralId}/direction`, { decision: "Approved", publishToGazette: true }, as(judge));
    seen.push(await currentReferralState(caseId));

    await post(`/caseworker/cases/${caseId}/referrals/${referralId}/closure`);
    seen.push(await currentReferralState(caseId));

    expect(seen).toEqual(["Open", "Claimed", "Decided", null]);
  });

  it("should go null on a withdrawal, which is terminal too", async () => {
    const { caseId, referralId } = await referredCase();

    await post(`/caseworker/cases/${caseId}/referrals/${referralId}/withdrawal`);

    expect(await currentReferralState(caseId)).toBeNull();
  });

  it("should reach the list row as well as the case, so a worklist needs no read per row", async () => {
    const { caseId } = await referredCase();

    const listed = await get("/caseworker/cases");

    expect(listed.cases.find((summary: { id: string }) => summary.id === caseId).currentReferralState).toBe("Open");
  });

  it("should be filterable, which is what a count over the field needs", async () => {
    const { caseId } = await referredCase();
    mock.seed(null);

    const listed = await get("/caseworker/cases?where=currentReferralState:is:Open");

    expect(listed.cases.map((summary: { id: string }) => summary.id)).toEqual([caseId]);
  });

  it("should count only the Decided cases, which is the total a returned-for-action count reads", async () => {
    // The fixture the dashboard's count is asserted against, driven through the mock's own transitions
    // rather than written behind them: three cases returned for action, and four that must not be counted —
    // one still Open, one Claimed, one Closed (terminal, so null again) and one never referred. A count
    // that cannot tell the seven apart is indistinguishable from a condition silently dropped on the way to
    // the wire.
    await decidedReferral("judge@example.com");
    await decidedReferral("judge@example.com");
    await decidedReferral("other.judge@example.com");
    await referredCase();
    await claimedReferral("judge@example.com");
    const actioned = await decidedReferral("judge@example.com");
    await post(`/caseworker/cases/${actioned.caseId}/referrals/${actioned.referralId}/closure`);
    mock.seed(null);

    // `size=1`, as the count asks for it: the number is api's `total` across every page, never the rows.
    const counted = await get("/caseworker/cases?where=currentReferralState:is:Decided&size=1");

    expect(counted.total).toBe(3);
    expect(counted.cases).toHaveLength(1);
  });

  it("should list exactly the counted cases when the same filter is followed as a worklist", async () => {
    // The count and the worklist are one query run twice, so the ids behind the number are asserted too: a
    // total of three over a list of something else would make the banner lie about where it leads.
    const returned = [await decidedReferral("judge@example.com"), await decidedReferral("other.judge@example.com")];
    await claimedReferral("judge@example.com");
    mock.seed(null);

    const worklist = await get("/caseworker/cases?where=currentReferralState:is:Decided");

    expect(worklist.cases.map((summary: { id: string }) => summary.id).sort()).toEqual(returned.map(({ caseId }) => caseId).sort());
  });

  it("should be derived from the referrals a case is seeded with, rather than left to disagree with them", async () => {
    // The arrangement a page test starts from: a case already with the judiciary, without driving the
    // transitions that got it there.
    const seeded = mock.seed({ referrals: [referral({ state: "Claimed", claimedBy: "judge@example.com" })] });

    expect((await get(`/caseworker/cases/${seeded.id}`)).currentReferralState).toBe("Claimed");
  });

  it("should keep a column seeded with no referrals to recompute it from", async () => {
    const seeded = mock.seed({ currentReferralState: "Decided" });

    expect((await get(`/caseworker/cases/${seeded.id}`)).currentReferralState).toBe("Decided");
  });

  it("should not publish the referrals themselves on a case, which api serves under their own path", async () => {
    const { caseId } = await referredCase();

    expect(await get(`/caseworker/cases/${caseId}`)).not.toHaveProperty("referrals");
  });
});

describe("the judicial referral routes", () => {
  it("should offer only Open referrals in the pool, since a claimed one is its holder's", async () => {
    const { referralId } = await referredCase();
    await claimedReferral("judge@example.com");

    const pool = await get("/judicial/referrals");

    expect(pool.referrals.map((referral: { id: string }) => referral.id)).toEqual([referralId]);
    expect(pool).toMatchObject({ page: 1, size: 10, total: 1, totalPages: 1 });
  });

  it("should order the pool urgent first, then longest-waiting within each band", async () => {
    // Seeded with chosen dates rather than created over HTTP: three creates in the same millisecond would
    // leave the order to `sort`'s stability, and a test that passes on insertion order pins nothing.
    mock.seed({ referrals: [referral({ id: "old-normal", createdOn: new Date("2026-03-01T09:00:00") })] });
    mock.seed({ referrals: [referral({ id: "new-normal", createdOn: new Date("2026-03-05T09:00:00") })] });
    mock.seed({ referrals: [referral({ id: "urgent", urgency: "Urgent", createdOn: new Date("2026-03-06T09:00:00") })] });

    const pool = await get("/judicial/referrals");

    // Insertion order, or newest-first, would teach a page the wrong thing: the point of the pool is that the
    // longest-waiting urgent referral is the next one to read.
    expect(pool.referrals.map((row: { id: string }) => row.id)).toEqual(["urgent", "old-normal", "new-normal"]);
  });

  it("should page the pool ten at a time, and answer an empty page past the end rather than refusing it", async () => {
    for (const _ of Array.from({ length: 11 })) await referredCase();

    const first = await get("/judicial/referrals");
    const past = await get("/judicial/referrals?page=9");

    expect(first.referrals).toHaveLength(10);
    expect(first).toMatchObject({ total: 11, totalPages: 2 });
    expect(past.referrals).toEqual([]);
  });

  it("should refuse a page or a size that is not a whole number of one or more", async () => {
    for (const query of ["page=0", "size=nonsense"]) {
      const response = await fetch(`${mock.url}/judicial/referrals?${query}`);

      expect(response.status, query).toBe(400);
    }
  });

  it("should answer a referral with the narrow application view and the timeline, and no other case field", async () => {
    const seeded = mock.seed({ displayReference: "KBDP2026-00001", type: "Adult", newForename: "Jo", newSurname: "Bloggs", privacy: "Sensitive" });
    await post(`/caseworker/cases/${seeded.id}/notes`, { note: "Chased the declarant" });
    const created = await (await post(`/caseworker/cases/${seeded.id}/referrals`, { reasons: ["Minor"] })).json();

    const detail = await (await fetch(`${mock.url}/judicial/referrals/${created.id}`, { headers: as("judge@example.com") })).json();

    expect(Object.keys(detail.application).sort()).toEqual(
      ["displayReference", "newForename", "newMiddleName", "newSurname", "oldForename", "oldMiddleName", "oldSurname", "type"].sort()
    );
    expect(detail.application).toMatchObject({ displayReference: "KBDP2026-00001", newForename: "Jo" });
    // Newest first, so the note the raise wrote leads and the caseworker's own follows — the timeline reaches a
    // judge unfiltered, which is asserted properly in "the case notes a referral writes as it moves".
    expect(detail.caseNotes).toEqual([
      { note: expect.stringContaining("Referred to the judiciary"), createdBy: MOCK_CASEWORKER, createdOn: expect.any(String) },
      { note: "Chased the declarant", createdBy: MOCK_CASEWORKER, createdOn: expect.any(String) }
    ]);
    // No case id anywhere on the response: a judge must not be able to name an application.
    expect(JSON.stringify(detail)).not.toContain(seeded.id);
  });

  it("should claim a referral out of the pool, recording the holder from the token", async () => {
    const { referralId } = await referredCase();

    const response = await post(`/judicial/referrals/${referralId}/claim`, undefined, as("judge@example.com"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ state: "Claimed", claimedBy: "judge@example.com", claimedAt: expect.any(String) });
  });

  it("should refuse a second claim with 409, even by the judge already holding it", async () => {
    const { referralId } = await claimedReferral("judge@example.com");

    const response = await post(`/judicial/referrals/${referralId}/claim`, undefined, as("judge@example.com"));

    expect(response.status).toBe(409);
  });

  it("should record a direction from the holder, stamping the decider and the date itself", async () => {
    const { referralId } = await claimedReferral("judge@example.com");

    const response = await post(
      `/judicial/referrals/${referralId}/direction`,
      { decision: "Rejected", publishToGazette: false, directionsText: "  Not satisfied  ", decidedBy: "somebody else" },
      as("judge@example.com")
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      state: "Decided",
      decision: "Rejected",
      publishToGazette: false,
      directionsText: "Not satisfied",
      // From the token and the clock, never from the payload — which is why the body above could not claim it.
      decidedBy: "judge@example.com",
      decisionDate: expect.any(String)
    });
  });

  it("should refuse a direction on a referral nobody holds with 409, because the judge can see it", async () => {
    // Open, so visible to every judge: the refusal is one they are looking at and can act on, which is why it
    // is a conflict rather than the 404 an invisible referral gets.
    const { referralId } = await referredCase();

    const response = await post(`/judicial/referrals/${referralId}/direction`, { decision: "Approved", publishToGazette: true }, as("judge@example.com"));

    expect(response.status).toBe(409);
  });

  it("should answer 404 rather than 409 for a direction on another judge's claim, so neither learns of the other", async () => {
    const { referralId } = await claimedReferral("another@example.com");

    const response = await post(`/judicial/referrals/${referralId}/direction`, { decision: "Approved", publishToGazette: true }, as("judge@example.com"));

    expect(response.status).toBe(404);
  });

  it("should refuse a direction the wire schema rejects, because publication has no default", async () => {
    const { referralId } = await claimedReferral("judge@example.com");

    const response = await post(`/judicial/referrals/${referralId}/direction`, { decision: "Approved" }, as("judge@example.com"));

    expect(response.status).toBe(400);
    expect((await response.json()).errors[0].field).toBe("publishToGazette");
  });

  it.each([
    ["claimed by another judge", "claim"],
    ["withdrawn", "withdraw"],
    ["closed", "close"]
  ])("should answer 404 for a referral that is %s, indistinguishably from one that never existed", async (_, how) => {
    const { caseId, referralId } = how === "claim" ? await claimedReferral("another@example.com") : await referredCase();
    if (how === "withdraw") await post(`/caseworker/cases/${caseId}/referrals/${referralId}/withdrawal`);
    if (how === "close") {
      const decided = await decidedReferral("another@example.com");
      await post(`/caseworker/cases/${decided.caseId}/referrals/${decided.referralId}/closure`);

      expect((await fetch(`${mock.url}/judicial/referrals/${decided.referralId}`, { headers: as("judge@example.com") })).status).toBe(404);

      return;
    }

    const response = await fetch(`${mock.url}/judicial/referrals/${referralId}`, { headers: as("judge@example.com") });

    expect(response.status).toBe(404);
  });

  it("should still show a judge their own Decided referral, so they can re-read their direction", async () => {
    const { referralId } = await decidedReferral("judge@example.com");

    const response = await fetch(`${mock.url}/judicial/referrals/${referralId}`, { headers: as("judge@example.com") });

    expect(response.status).toBe(200);
  });

  it("should answer 404 for an id nothing was stored under, in the shape every other refusal takes", async () => {
    const response = await fetch(`${mock.url}/judicial/referrals/not-an-id`, { headers: as("judge@example.com") });

    expect(response.status).toBe(404);
  });

  it("should refuse a method the pool has no route for", async () => {
    expect((await fetch(`${mock.url}/judicial/referrals`, { method: "PUT" })).status).toBe(405);
  });

  it("should serve nothing under a judicial path api does not publish", async () => {
    const { referralId } = await referredCase();

    expect((await fetch(`${mock.url}/judicial/referrals/${referralId}/notes`)).status).toBe(404);
  });
});

/**
 * `GET /judicial/referrals/mine` — the list `referrals-admin-6` exists for.
 *
 * Its own block rather than more cases in the one above, because what is under test is a **collection's
 * membership** rather than one referral's answer: every assertion here is about which rows are on the list and in
 * what order, and both are things a page is forbidden to compensate for.
 */
describe("a judge's own referrals", () => {
  it("should list the referrals this judge holds and has directed, and nothing else", async () => {
    const claimed = await claimedReferral(JUDGE);
    const decided = await decidedReferral(JUDGE);
    // The three exclusions, one per reason: the pool's, another judge's, and one the office has finished with.
    const open = await referredCase();
    const another = await claimedReferral("another@example.com");
    const closed = await decidedReferral(JUDGE);
    await post(`/caseworker/cases/${closed.caseId}/referrals/${closed.referralId}/closure`);

    const mine = await get("/judicial/referrals/mine", as(JUDGE));

    expect(mine.referrals.map((row: { id: string }) => row.id).sort()).toEqual([claimed.referralId, decided.referralId].sort());
    expect(mine).toMatchObject({ page: 1, size: 10, total: 2, totalPages: 1 });
    // Asserted as absences too: a membership rule that admitted any of these would be a disclosure rather than a
    // presentational slip, and `total: 2` alone would not say which two.
    for (const excluded of [open.referralId, another.referralId, closed.referralId]) {
      expect(
        mine.referrals.map((row: { id: string }) => row.id),
        excluded
      ).not.toContain(excluded);
    }
  });

  it("should list a judge nothing when they hold nothing, rather than refusing them", async () => {
    await referredCase();
    await claimedReferral("another@example.com");

    const mine = await get("/judicial/referrals/mine", as(JUDGE));

    // The collection always exists — api has no 404 here — so an empty page is the answer and the page says so.
    expect(mine).toEqual({ referrals: [], page: 1, size: 10, total: 0, totalPages: 0 });
  });

  it("should carry the pool's narrow row and no application field, since it is the same summary", async () => {
    const seeded = mock.seed({ displayReference: "KBDP2026-00002", newForename: "Jo", newSurname: "Bloggs" });
    const created = await (await post(`/caseworker/cases/${seeded.id}/referrals`, { reasons: ["Minor"] })).json();
    await post(`/judicial/referrals/${created.id}/claim`, undefined, as(JUDGE));

    const [row] = (await get("/judicial/referrals/mine", as(JUDGE))).referrals;

    // Exactly `JudicialReferralSummary`: no application, no direction, and no holder — a list that grew any of
    // them would be showing a judge the answer, or another judge's identity, before they opened the papers.
    expect(Object.keys(row).sort()).toEqual(["createdOn", "id", "notes", "reasons", "state", "urgency", "urgencyReason"].sort());
    expect(row).toMatchObject({ id: created.id, state: "Claimed" });
    expect(JSON.stringify(row)).not.toContain(seeded.id);
    expect(JSON.stringify(row)).not.toContain("Bloggs");
  });

  it("should order unfinished work first, then urgent, then longest-waiting, then by id", async () => {
    // Seeded rather than claimed over HTTP: five claims in the same millisecond would leave every key but the
    // state to `sort`'s stability, and a test that passes on insertion order pins nothing.
    // `claimedById` is the same string as `claimedBy` because `as(JUDGE)` forwards a token with only a `sub`; the
    // two being one value here is the ordinary case, and the test below is what pins that they are separate fields.
    const mineOwned = { claimedBy: JUDGE, claimedById: JUDGE };
    const decided = { ...mineOwned, state: "Decided" as const, decision: "Approved" as const, decidedBy: JUDGE, decidedById: JUDGE };
    mock.seed({ referrals: [referral({ id: "d-decided", ...decided, createdOn: new Date("2026-03-01T09:00:00") })] });
    mock.seed({ referrals: [referral({ id: "c-new-normal", ...mineOwned, state: "Claimed", createdOn: new Date("2026-03-05T09:00:00") })] });
    mock.seed({ referrals: [referral({ id: "b-old-normal", ...mineOwned, state: "Claimed", createdOn: new Date("2026-03-01T09:00:00") })] });
    mock.seed({ referrals: [referral({ id: "a-old-normal", ...mineOwned, state: "Claimed", createdOn: new Date("2026-03-01T09:00:00") })] });
    mock.seed({ referrals: [referral({ id: "e-urgent", ...mineOwned, state: "Claimed", urgency: "Urgent", createdOn: new Date("2026-03-06T09:00:00") })] });

    const mine = await get("/judicial/referrals/mine", as(JUDGE));

    // Claimed above Decided, because the point of the list is resuming work rather than re-reading finished
    // directions; and the two March 1st claims tie on every other key, so the id is what separates them — without
    // it their order between one page and the next is arbitrary, which is how a row appears twice or not at all.
    expect(mine.referrals.map((row: { id: string }) => row.id)).toEqual(["e-urgent", "a-old-normal", "b-old-normal", "c-new-normal", "d-decided"]);
  });

  it("should page ten at a time, and answer an empty page past the end rather than refusing it", async () => {
    for (const _ of Array.from({ length: 11 })) await claimedReferral(JUDGE);

    const first = await get("/judicial/referrals/mine", as(JUDGE));
    const second = await get("/judicial/referrals/mine?page=2", as(JUDGE));
    const past = await get("/judicial/referrals/mine?page=9", as(JUDGE));

    expect(first.referrals).toHaveLength(10);
    expect(first).toMatchObject({ total: 11, totalPages: 2 });
    expect(second.referrals).toHaveLength(1);
    expect(past.referrals).toEqual([]);
  });

  it("should refuse a page or a size that is not a whole number of one or more", async () => {
    for (const query of ["page=0", "size=nonsense"]) {
      const response = await fetch(`${mock.url}/judicial/referrals/mine?${query}`, { headers: as(JUDGE) });

      expect(response.status, query).toBe(400);
    }
  });

  it("should keep two judges apart who share a display name, because ownership is the subject", async () => {
    // The defect api's `V14__referral_owner_subjects.sql` fixed, and the reason this mock holds a subject beside
    // the attribution: keyed on the name, this judge's list would ENUMERATE their namesake's work — worse than the
    // individual read, which at least needed an id.
    const theirs = await referredCase();
    await post(`/judicial/referrals/${theirs.referralId}/claim`, undefined, asPerson("HHJ Smith", "smith.two@example.com"));
    const ours = await referredCase();
    await post(`/judicial/referrals/${ours.referralId}/claim`, undefined, asPerson("HHJ Smith", "smith.one@example.com"));

    const mine = await get("/judicial/referrals/mine", asPerson("HHJ Smith", "smith.one@example.com"));

    expect(mine.referrals.map((row: { id: string }) => row.id)).toEqual([ours.referralId]);
    // And the attribution is still the shared name, which is what makes the isolation a fact about the subject
    // rather than about the mock having stopped using names at all.
    expect(await get(`/caseworker/cases/${ours.caseId}/referrals/${ours.referralId}`)).toMatchObject({ claimedBy: "HHJ Smith" });
  });

  it("should leave a pre-migration claim on nobody's list, rather than falling back to the name", async () => {
    // A row with a holder's name and no subject is what api's migration could not backfill, and it fails closed
    // there: comparing names on exactly the rows where identity is least certain would keep the collision where it
    // does most harm.
    mock.seed({ referrals: [referral({ id: "pre-migration", state: "Claimed", claimedBy: JUDGE, claimedById: null })] });

    expect((await get("/judicial/referrals/mine", as(JUDGE))).referrals).toEqual([]);
  });

  it.each([
    ["a claim adds the referral", async () => (await claimedReferral(JUDGE)).referralId, true],
    [
      "a direction keeps it, in its new state",
      async () => {
        const decided = await decidedReferral(JUDGE);

        return decided.referralId;
      },
      true
    ],
    [
      "a withdrawal removes it",
      async () => {
        const claimed = await claimedReferral(JUDGE);
        await post(`/caseworker/cases/${claimed.caseId}/referrals/${claimed.referralId}/withdrawal`);

        return claimed.referralId;
      },
      false
    ],
    [
      "a closure removes it",
      async () => {
        const decided = await decidedReferral(JUDGE);
        await post(`/caseworker/cases/${decided.caseId}/referrals/${decided.referralId}/closure`);

        return decided.referralId;
      },
      false
    ],
    [
      "a refused write changes nothing",
      async () => {
        const claimed = await claimedReferral(JUDGE);
        // 409 both times: the referral is already claimed, and a withdrawal of a claimed one is permitted so the
        // second call has to be one that is not — a closure before a direction.
        expect((await post(`/judicial/referrals/${claimed.referralId}/claim`, undefined, as(JUDGE))).status).toBe(409);
        expect((await post(`/caseworker/cases/${claimed.caseId}/referrals/${claimed.referralId}/closure`, undefined)).status).toBe(409);

        return claimed.referralId;
      },
      true
    ]
  ])("should change membership only through a real transition: %s", async (_, arrange, isMine) => {
    const referralId = await arrange();

    const ids = (await get("/judicial/referrals/mine", as(JUDGE))).referrals.map((row: { id: string }) => row.id);

    expect(ids.includes(referralId)).toBe(isMine);
  });

  it("should report the state the referral reached, so a direction relabels the row rather than removing it", async () => {
    const { referralId } = await decidedReferral(JUDGE);

    const [row] = (await get("/judicial/referrals/mine", as(JUDGE))).referrals;

    expect(row).toMatchObject({ id: referralId, state: "Decided" });
  });

  it("should route the literal path to the list and never read `mine` as a referral id", async () => {
    // api gets this from Spring's specificity rule; here the patterns are tried in order, so this is the one
    // assertion that the literal branch is written before the dynamic one. Matched the other way round the
    // response would be the 404 an unknown referral gets, for a page that exists.
    await claimedReferral(JUDGE);

    const response = await fetch(`${mock.url}/judicial/referrals/mine`, { headers: as(JUDGE) });

    expect(response.status).toBe(200);
    expect(await response.json()).toHaveProperty("totalPages");
    // And the word is not a referral either: a claim on it is the 404 an unknown id gets, not a 405 from the list.
    expect((await post("/judicial/referrals/mine/claim", undefined, as(JUDGE))).status).toBe(404);
  });

  it("should refuse a method the personal list has no route for", async () => {
    expect((await fetch(`${mock.url}/judicial/referrals/mine`, { method: "PUT", headers: as(JUDGE) })).status).toBe(405);
  });

  it("should publish no owner subject on any referral response", async () => {
    // The mock stores `claimedById`/`decidedById` and api publishes neither: `toWireReferral` spreads the record,
    // so this is what fails if a later field is added without being named out of it.
    //
    // Driven as a person whose subject is not their name, because that is the only arrangement in which the
    // subject's absence is observable: with the two equal, a body carrying the attribution carries the subject too.
    const holder = asPerson(JUDGE_NAME, JUDGE_SUBJECT);
    const { caseId, referralId } = await referredCase();
    await post(`/judicial/referrals/${referralId}/claim`, undefined, holder);
    await post(`/judicial/referrals/${referralId}/direction`, { decision: "Approved", publishToGazette: true }, holder);

    const caseworkerView = await get(`/caseworker/cases/${caseId}/referrals/${referralId}`);
    const judicialView = await get(`/judicial/referrals/${referralId}`, holder);

    for (const [name, body] of [
      ["caseworker", caseworkerView],
      ["judicial", judicialView]
    ] as const) {
      expect(body, name).not.toHaveProperty("claimedById");
      expect(body, name).not.toHaveProperty("decidedById");
      expect(JSON.stringify(body), name).not.toContain(JUDGE_SUBJECT);
    }
    // The attribution is still there, which is what makes the absence above about the subject rather than about
    // the holder having been dropped from the response.
    expect(caseworkerView).toMatchObject({ claimedBy: JUDGE_NAME, decidedBy: JUDGE_NAME });
  });
});

/**
 * api's `ReferralNotes`, reproduced by the mock and asserted here rather than through the adapter: the wording is
 * observable behaviour no part of `openapi.json` describes, so nothing else can fail when it drifts.
 *
 * The prose is asserted in full where it is short enough to read, not by `toContain` alone — a note that
 * silently lost its Gazette sentence would still contain every fragment a looser test looked for.
 */
describe("the case notes a referral writes as it moves", () => {
  const CASEWORKER = "caseworker@example.com";
  const OFFICE = "office@example.com";

  it("should write one note per successful transition, attributed to whoever made it", async () => {
    const { caseId, referralId } = await referredCase({ reasons: ["Minor"] }, CASEWORKER);

    await post(`/judicial/referrals/${referralId}/claim`, undefined, as(JUDGE));
    await post(`/judicial/referrals/${referralId}/direction`, { decision: "Approved", publishToGazette: true }, as(JUDGE));
    await post(`/caseworker/cases/${caseId}/referrals/${referralId}/closure`, undefined, as(OFFICE));

    const notes = await notesOn(caseId);
    // Four transitions, four notes — and the closure's author is the caseworker who actioned the direction
    // rather than the judge who gave it, which is the one attribution easy to get wrong.
    expect(notes.map((note) => note.createdBy)).toEqual([OFFICE, JUDGE, JUDGE, CASEWORKER]);
    // Both audit columns stamped on create, with the same instant: that is what makes the grid's "Not edited"
    // true of a note nobody has touched.
    expect(notes.every((note) => note.createdOn === note.modifiedOn && note.modifiedBy === note.createdBy)).toBe(true);
    // Each note is stamped when its transition happened, not when the referral was raised — so none of them can
    // predate the referral they describe. Zoneless ISO strings, which compare lexicographically.
    const referral = await get(`/caseworker/cases/${caseId}/referrals/${referralId}`);
    expect(notes.every((note) => note.createdOn >= referral.createdOn)).toBe(true);
  });

  it("should expose the raise, claim, direction and closure as one timeline, newest first", async () => {
    // The whole sequence in one test, because the order is the point: a caseworker opening the Notes tab on a
    // case that has been to the judiciary and back reads what happened, latest first.
    const { caseId, referralId } = await referredCase({ reasons: ["Minor"] });
    await post(`/judicial/referrals/${referralId}/claim`, undefined, as(JUDGE));
    await post(`/judicial/referrals/${referralId}/direction`, { decision: "Approved", publishToGazette: true }, as(JUDGE));
    await post(`/caseworker/cases/${caseId}/referrals/${referralId}/closure`);

    const notes = await notesOn(caseId);

    const raised = await raisedOn(caseId, referralId);
    expect(notes.map((note) => note.note)).toEqual([
      `Judicial direction for referral raised on ${raised}, reasons: Minor, marked as actioned.`,
      `Judicial direction recorded for referral raised on ${raised}, reasons: Minor.` +
        " Decision: Approved. Publish to the London Gazette: Yes. See the referral for the full direction.",
      `Referral raised on ${raised}, reasons: Minor, claimed by the judiciary.`,
      "Referred to the judiciary. Reasons: Minor."
    ]);
  });

  it("should record a withdrawal beside the raise, naming which referral it was", async () => {
    // The pre-direction branch, where a case's timeline has to say the referral left and came back with nothing
    // in between — and name the referral, because a case may carry several over its life.
    const { caseId, referralId } = await referredCase({ reasons: ["Minor", "DomesticAbuse"] });

    await post(`/caseworker/cases/${caseId}/referrals/${referralId}/withdrawal`);

    const raised = await raisedOn(caseId, referralId);
    expect((await notesOn(caseId)).map((note) => note.note)).toEqual([
      `Referral to the judiciary withdrawn. It was raised on ${raised}, reasons: Minor, DomesticAbuse.`,
      "Referred to the judiciary. Reasons: Minor, DomesticAbuse."
    ]);
  });

  it("should put the caseworker's urgency reason and their notes on their own lines, trimmed", async () => {
    const seeded = mock.seed(null);

    await post(`/caseworker/cases/${seeded.id}/referrals`, {
      reasons: ["Other"],
      notes: "  Unusual circumstances  ",
      urgency: "Urgent",
      urgencyReason: "  Hearing on Friday.  "
    });

    // A line each rather than run into the sentence before with a full stop the composer would have to add:
    // theirs is prose they wrote, and one already ending in a stop would read as "Friday..".
    const [raised] = await notesOn(seeded.id);
    expect(raised.note).toBe("Referred to the judiciary. Reasons: Other.\nMarked urgent: Hearing on Friday.\nNotes: Unusual circumstances");
  });

  it("should point at the referral for the full direction rather than copying it into the note", async () => {
    // api allows a direction to be twice what a note may hold, so copying it would compose a note api's own
    // validator refuses — and a truncated copy would read as the whole of a judicial direction.
    const { caseId, referralId } = await claimedReferral(JUDGE);
    const directions = "The applicant must file the missing evidence. ".repeat(80);

    await post(`/judicial/referrals/${referralId}/direction`, { decision: "Rejected", publishToGazette: false, directionsText: directions }, as(JUDGE));

    const [directed] = await notesOn(caseId);
    expect(directed.note).toContain("Decision: Rejected.");
    // Spelled out, never abbreviated to the presence of a word: publication names the applicant in a public
    // notice, so "not published" and "nothing recorded" must not read alike.
    expect(directed.note).toContain("Publish to the London Gazette: No.");
    expect(directed.note).toContain("See the referral for the full direction.");
    expect(directed.note).not.toContain("must file the missing evidence");
    expect(directed.note.length).toBeLessThanOrEqual(2000);
    // The full text is still on the referral, which is where the note sends the reader.
    expect((await get(`/caseworker/cases/${caseId}/referrals/${referralId}`)).directionsText).toBe(directions.trim());
  });

  it("should write nothing for a refused withdrawal, claim or direction, so the timeline claims only what happened", async () => {
    const { caseId, referralId } = await decidedReferral(JUDGE);
    const before = await notesOn(caseId);

    expect((await post(`/caseworker/cases/${caseId}/referrals/${referralId}/withdrawal`)).status).toBe(409);
    expect((await post(`/judicial/referrals/${referralId}/claim`, undefined, as(JUDGE))).status).toBe(409);
    expect((await post(`/judicial/referrals/${referralId}/direction`, { decision: "Approved", publishToGazette: true }, as(JUDGE))).status).toBe(409);

    expect(await notesOn(caseId)).toEqual(before);
  });

  it("should write nothing for a refused closure or a refused raise", async () => {
    const { caseId, referralId } = await referredCase();
    const before = await notesOn(caseId);

    // Open, so there is no direction to have actioned; and a second referral while the first is in play.
    expect((await post(`/caseworker/cases/${caseId}/referrals/${referralId}/closure`)).status).toBe(409);
    expect((await post(`/caseworker/cases/${caseId}/referrals`, { reasons: ["Minor"] })).status).toBe(409);
    // A body the schema refuses, on a case with no live referral at all: the note must not be written before
    // the referral it describes.
    const other = mock.seed(null);
    expect((await post(`/caseworker/cases/${other.id}/referrals`, { reasons: [] })).status).toBe(400);

    expect(await notesOn(caseId)).toEqual(before);
    expect(await notesOn(other.id)).toEqual([]);
  });

  it("should show a judge the same generated events as the caseworker, and leave the stored order alone", async () => {
    const { caseId, referralId } = await referredCase();
    await post(`/judicial/referrals/${referralId}/claim`, undefined, as(JUDGE));

    const judicial = await (await fetch(`${mock.url}/judicial/referrals/${referralId}`, { headers: as(JUDGE) })).json();
    const listed = await notesOn(caseId);
    const detail = await get(`/caseworker/cases/${caseId}`);

    // No filter by origin, author or anything else on the judicial projection: a note a referral wrote reaches
    // a judge by construction, which is what makes the two timelines one.
    expect(judicial.caseNotes).toEqual(listed.map((note) => ({ note: note.note, createdBy: note.createdBy, createdOn: note.createdOn })));
    // The case detail publishes the stored array, which api orders ascending — the same notes the other way
    // round rather than a second timeline. Sorting in place would have made this the same order as above.
    expect(detail.notes.map((note: { note: string }) => note.note)).toEqual([...listed].reverse().map((note) => note.note));
    // And a second read answers what the first did, which a sort in place would not.
    expect(await notesOn(caseId)).toEqual(listed);
  });

  it("should leave a hand-written note in the same timeline as the generated ones, amendable as ever", async () => {
    // Lifecycle entries are ordinary case notes: nothing here marks them, and the caseworker's own note is
    // ordered among them by when it was written.
    const { caseId, referralId } = await referredCase();
    const written = await (await post(`/caseworker/cases/${caseId}/notes`, { note: "Chased the declarant" })).json();
    await post(`/caseworker/cases/${caseId}/referrals/${referralId}/withdrawal`);

    const patched = await patch(`/caseworker/cases/${caseId}/notes/${written.id}`, { note: "Declarant called back" });

    expect(patched.status).toBe(200);
    expect((await notesOn(caseId)).map((note) => note.note)).toEqual([
      expect.stringContaining("Referral to the judiciary withdrawn"),
      "Declarant called back",
      "Referred to the judiciary. Reasons: Minor."
    ]);
  });

  it("should write no lapse note, because the inactivity sweep is not modelled here", async () => {
    // The sixth of api's lifecycle notes, and the one no page can drive: the sweep is a window on api's clock.
    // Asserted so the gap is a recorded limitation rather than something a reader has to infer from its absence.
    const { caseId, referralId } = await claimedReferral(JUDGE);

    expect((await notesOn(caseId)).some((note) => note.note.includes("lapsed"))).toBe(false);
    expect((await get(`/caseworker/cases/${caseId}/referrals/${referralId}`)).state).toBe("Claimed");
  });
});

describe("the email routes", () => {
  it("should list a case's history newest first, whatever order the rows were stored in", async () => {
    // The array's own order is deliberately not the answer: a page rendering the rows as given would otherwise
    // see insertion order here and `createdOn` order deployed.
    const seeded = mock.seed({ notifications: MOCK_EMAIL_HISTORY.map((row) => ({ ...row })) });

    const history = (await get(`/caseworker/cases/${seeded.id}/emails`)).history;

    expect(history.map((row: { createdOn: string }) => row.createdOn)).toEqual([
      "2026-03-20T16:45:00.000",
      "2026-03-18T11:05:00.000",
      "2026-02-27T14:20:00.000",
      "2026-01-09T09:30:00.000"
    ]);
  });

  it("should keep the four no-content states distinguishable, because each needs its own sentence", async () => {
    const seeded = mock.seed({ notifications: MOCK_EMAIL_HISTORY.map((row) => ({ ...row })) });

    const history: { notifyState: string; subject: string | null; body: string | null; failureReason: string | null }[] = (
      await get(`/caseworker/cases/${seeded.id}/emails`)
    ).history;

    // `notifyState` alone does not separate the two `Sent` rows — one carries its wording and the other never
    // will, which is a different thing to tell a caseworker from "this has not gone yet".
    expect(history.map((row) => [row.notifyState, row.body === null])).toEqual([
      ["Pending", true],
      ["Sent", false],
      ["Failed", true],
      ["Sent", true]
    ]);
    expect(history[2].failureReason).toContain("PERMANENT");
    expect(history[1].subject).toMatch(/./);
  });

  it("should publish the template key rather than the member name the row stores", async () => {
    // Two spellings of one template, and both are on the wire. Conflating them makes the history unreadable.
    const seeded = mock.seed({ notifications: [{ ...MOCK_EMAIL_HISTORY[0] }] });

    const history = (await get(`/caseworker/cases/${seeded.id}/emails`)).history;

    expect(history[0]).toMatchObject({ template: "application-rejected", templateName: "Application rejected" });
  });

  it("should refuse a body key that is not a slot, naming it rather than ignoring it", async () => {
    // Stripping it would honour the request while silently dropping the part that mattered. The idempotency UUID
    // is the concrete case: it is admin-local, and a mock that accepted it would let a page ship sending it.
    const { caseId } = refusedCase();

    const response = await post(`/caseworker/cases/${caseId}/emails/application-rejected/preview`, { judges_reason: "Because", idempotencyKey: randomUUID() });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.errors).toEqual([{ field: "idempotencyKey", message: expect.stringContaining("is not a slot of application-rejected") }]);
  });

  it("should require the judge's reason when no direction was recorded to pre-populate it from", async () => {
    // A judge may refuse an application without typing a comment, so this is reachable rather than theoretical.
    const { caseId } = refusedCase({ directionsText: null });

    const response = await post(`/caseworker/cases/${caseId}/emails/application-rejected`, {});

    expect(response.status).toBe(400);
    expect((await response.json()).errors).toEqual([{ field: "judges_reason", message: expect.stringContaining("is required") }]);
  });

  it("should still answer the tab for a refusal with no direction recorded, which api itself does not", async () => {
    // The one place this mock is deliberately NARROWER than api: `CaseEmailService.slotDefaults` resolves the
    // defaults through the send path, so a required slot with nothing to default from makes the whole
    // `GET …/emails` answer 400 — the tab's one load-bearing read, refused for a case that legitimately exists.
    // Mirroring that would mean building the tab to handle its own read failing. Raised as a flag on the plan.
    const { caseId } = refusedCase({ directionsText: null });

    const response = await fetch(`${mock.url}/caseworker/cases/${caseId}/emails`);

    expect(response.status).toBe(200);
    expect((await response.json()).slotDefaults).toEqual([{ template: "application-rejected", fields: { judges_reason: "", additional_notes: "" } }]);
  });

  it("should quote the most recent refusal, because an older one has been superseded", async () => {
    const seeded = mock.seed({
      applicantEmail: "applicant@example.com",
      referrals: [
        referral({ id: "older", state: "Closed", decision: "Rejected", directionsText: "The old reason", createdOn: new Date("2026-01-04T09:00:00") }),
        referral({ id: "newer", state: "Decided", decision: "Rejected", directionsText: "The current reason", createdOn: new Date("2026-03-04T09:00:00") })
      ]
    });

    const emails = await get(`/caseworker/cases/${seeded.id}/emails`);

    expect(emails.slotDefaults[0].fields.judges_reason).toBe("The current reason");
  });

  it("should refuse a method neither the collection nor a template has a route for", async () => {
    const { caseId } = refusedCase();

    expect((await fetch(`${mock.url}/caseworker/cases/${caseId}/emails`, { method: "DELETE" })).status).toBe(405);
    expect((await fetch(`${mock.url}/caseworker/cases/${caseId}/emails/application-rejected`)).status).toBe(405);
  });
});

describe("when the scenario says api is unavailable", () => {
  it("should answer 503 on every contract route while leaving the control routes working", async () => {
    mock.setScenario("api-unavailable");

    expect((await fetch(`${mock.url}/caseworker/cases`)).status).toBe(503);
    expect((await fetch(`${mock.url}/caseworker/document-types`)).status).toBe(503);
    expect((await fetch(`${mock.url}/caseworker/saved-queries`)).status).toBe(503);
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
async function get(path: string, headers: Record<string, string> = {}): Promise<any> {
  return (await fetch(`${mock.url}${path}`, { headers })).json();
}

/**
 * A seeded case carrying `recorded` witnesses, for the enrolment gate.
 *
 * Seeded rather than created because the gate is on the update path: a create that already carries the
 * dates under test is not what a caseworker does, and seeding keeps the arrangement out of the assertion.
 */
/**
 * The headers that make a request one person's.
 *
 * The mock reads a name out of the token and no roles, so this is what tells a judge's claim from another
 * judge's — and the `caseworker-deedpoll-judicial` role gate is api's rather than something to arrange here.
 */
function as(subject: string): Record<string, string> {
  return { authorization: `Bearer x.${Buffer.from(JSON.stringify({ sub: subject }), "utf8").toString("base64url")}.signature` };
}

/**
 * The same, for a person whose display name is not their subject.
 *
 * The one arrangement `as` cannot make, and the only way to show that judicial ownership is keyed on the subject:
 * two callers can share a name here while owning separate work, which is the collision api's
 * `V14__referral_owner_subjects.sql` was written to end.
 */
function asPerson(name: string, subject: string): Record<string, string> {
  return { authorization: `Bearer x.${Buffer.from(JSON.stringify({ sub: subject, name }), "utf8").toString("base64url")}.signature` };
}

/** A seeded case carrying one referral raised over HTTP, which is where every referral journey starts. */
async function referredCase(body: Record<string, unknown> = { reasons: ["Minor"] }, raisedBy?: string): Promise<{ caseId: string; referralId: string }> {
  const seeded = mock.seed(null);
  const created = await (await post(`/caseworker/cases/${seeded.id}/referrals`, body, raisedBy === undefined ? {} : as(raisedBy))).json();

  return { caseId: seeded.id, referralId: created.id };
}

/** A case's timeline as `GET …/notes` answers it — newest first, which is what the note assertions are about. */
async function notesOn(caseId: string): Promise<{ note: string; createdBy: string; modifiedBy: string; createdOn: string; modifiedOn: string }[]> {
  return get(`/caseworker/cases/${caseId}/notes`);
}

/**
 * The day a referral was raised, as its lifecycle notes date it.
 *
 * Read back off the referral and formatted the way the mock formats it, rather than assumed to be today: a suite
 * running either side of midnight UTC would otherwise fail on the date and say nothing about the prose. The `Z`
 * is added because api's date-times are zoneless, so the string would otherwise be read as local time.
 */
async function raisedOn(caseId: string, referralId: string): Promise<string> {
  const referral = await get(`/caseworker/cases/${caseId}/referrals/${referralId}`);

  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${referral.createdOn}Z`));
}

/** The same, claimed by one judge — the state every judicial write but the claim starts from. */
async function claimedReferral(judge: string): Promise<{ caseId: string; referralId: string }> {
  const referred = await referredCase();
  await post(`/judicial/referrals/${referred.referralId}/claim`, undefined, as(judge));

  return referred;
}

/** The same again, directed — the only state a caseworker may close from. */
async function decidedReferral(judge: string): Promise<{ caseId: string; referralId: string }> {
  const claimed = await claimedReferral(judge);
  await post(`/judicial/referrals/${claimed.referralId}/direction`, { decision: "Approved", publishToGazette: true }, as(judge));

  return claimed;
}

async function currentReferralState(caseId: string): Promise<string | null> {
  return (await get(`/caseworker/cases/${caseId}`)).currentReferralState;
}

/**
 * One referral as the mock stores it, for a case seeded mid-lifecycle.
 *
 * `Date` values rather than the ISO strings the wire carries, because `mock.seed` holds a `MockCase` — which is
 * also why a case with children is seeded in process rather than over `POST /__mock/cases`.
 */
/**
 * A seeded case whose referral a Master has refused, with an applicant to write to.
 *
 * Seeded rather than driven through the judicial surface, which is what `client.test.ts` does: these tests are
 * about the email rules, and arranging a claim and a direction per test would put three round trips in front of
 * every assertion. The refusal itself is what makes the email applicable, so the state is the arrangement.
 */
function refusedCase(overrides: Partial<MockCase["referrals"][number]> = {}): { caseId: string; referralId: string } {
  const refused = referral({ state: "Decided", decision: "Rejected", directionsText: JUDGES_REASON, decidedBy: "judge@example.com", ...overrides });
  const seeded = mock.seed({ applicantEmail: "applicant@example.com", referrals: [refused] });

  return { caseId: seeded.id, referralId: refused.id };
}

function referral(overrides: Partial<MockCase["referrals"][number]> = {}): MockCase["referrals"][number] {
  const raised = new Date("2026-03-01T09:00:00");

  return {
    id: randomUUID(),
    state: "Open",
    reasons: ["Minor"],
    notes: null,
    urgency: "Normal",
    urgencyReason: null,
    migrated: false,
    claimedBy: null,
    claimedById: null,
    claimedAt: null,
    decision: null,
    directionsText: null,
    publishToGazette: null,
    decisionDate: null,
    decidedBy: null,
    decidedById: null,
    createdBy: MOCK_CASEWORKER,
    modifiedBy: MOCK_CASEWORKER,
    createdOn: raised,
    modifiedOn: raised,
    ...overrides
  };
}

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
