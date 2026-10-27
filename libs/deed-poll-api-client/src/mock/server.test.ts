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
import { WIRE_SCHEMAS } from "../api/wire.js";
import { MOCK_DOCUMENT_TYPES, MOCK_EMAIL_HISTORY } from "./fixtures.js";
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

/** When a waiting case was returned, so its state and its dates can be asserted as unchanged by a recording. */
const RETURNED_ON = new Date("2026-03-20T00:00:00Z");

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
    expect(seeded.displayReference).toBeNull();
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

/**
 * The fourth control route: the wait a browser cannot otherwise arrange.
 *
 * Every other state the e2e suite needs is reachable through the contract, which is why the other journeys seed a
 * case and then drive it. This one is not: the write that sets `confirmationRequestedAt` at api's end is notify-3's
 * *Request confirmation to proceed* email, and `MOCK_EMAIL_TEMPLATES` carries only `application-rejected`. So the
 * referral is raised through the contract and **only the ask** is arranged here — see the route for why this is not
 * a second mock template.
 */
describe("POST /__mock/referrals/{id}/confirmation-request", () => {
  it("should start a wait on a referral raised through the contract, which no contract route here can do", async () => {
    const { caseId, referralId } = await referredCase();

    const response = await post(`/__mock/referrals/${referralId}/confirmation-request`, { confirmationRequestedAt: "2026-03-21T09:00:00" });

    expect(response.status).toBe(200);
    expect((await response.json()).confirmationRequestedAt).toBe("2026-03-21T09:00:00.000");
    // The case's own column, recomputed rather than written by this route — which is what puts the case on the
    // worklist the journey starts from.
    expect((await get(`/caseworker/cases/${caseId}`)).awaitingConfirmationSince).toBe("2026-03-21T09:00:00.000");
    expect((await get("/caseworker/cases?filter=awaitingConfirmation")).total).toBe(1);
  });

  it("should treat an absent date as now, which is the day-zero row api publishes as 0 and never 1", async () => {
    const { referralId } = await referredCase();

    await post(`/__mock/referrals/${referralId}/confirmation-request`);

    const list = await get("/caseworker/cases?filter=awaitingConfirmation");
    expect(list.cases.map((summary: { daysAwaitingConfirmation: number | null }) => summary.daysAwaitingConfirmation)).toEqual([0]);
  });

  it("should leave the answer to the contract, so the recording that ends the wait is api's own route", async () => {
    const { caseId, referralId } = await referredCase();
    await post(`/__mock/referrals/${referralId}/confirmation-request`, { confirmationRequestedAt: "2026-03-21T09:00:00" });

    const recorded = await post(`/caseworker/cases/${caseId}/referrals/${referralId}/confirmation`, { outcome: "Confirmed" });

    expect(recorded.status).toBe(200);
    expect((await get("/caseworker/cases?filter=awaitingConfirmation")).total).toBe(0);
  });

  it("should answer api's own 404 sentence for a referral it cannot find", async () => {
    const response = await post("/__mock/referrals/no-such-referral/confirmation-request");

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Referral no-such-referral not found");
  });

  it("should refuse a date it cannot read rather than storing a string the next read would fail on", async () => {
    const { caseId, referralId } = await referredCase();

    const response = await post(`/__mock/referrals/${referralId}/confirmation-request`, { confirmationRequestedAt: "whenever" });

    expect(response.status).toBe(400);
    expect((await get(`/caseworker/cases/${caseId}`)).awaitingConfirmationSince).toBeNull();
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

describe("the update's write-path gates", () => {
  it("should clear the minor-only fields when an update leaves the case a type that hides them", async () => {
    const created = await (
      await post("/caseworker/cases", { dateReceived: "2026-03-10", type: "Minor", parents: "Synthetic Parents", ageOfMinor: 9, ageOfMinorMonths: 4 })
    ).json();

    const updated = await (await patch(`/caseworker/cases/${created.id}`, { type: "Adult" })).json();

    expect(updated).toMatchObject({ parents: null, ageOfMinor: null, ageOfMinorMonths: null, minorDateOfBirth: null });
  });

  it("should keep the minor-only fields on a Minor case", async () => {
    const created = await (await post("/caseworker/cases", { dateReceived: "2026-03-10", type: "Minor", parents: "Synthetic Parents" })).json();

    const updated = await (await patch(`/caseworker/cases/${created.id}`, { newSurname: "Amended" })).json();

    expect(updated.parents).toBe("Synthetic Parents");
  });

  it("should clear the Gazette notice date when the case is not published", async () => {
    const created = await (await post("/caseworker/cases", { dateReceived: "2026-03-10", dateNoticeSentToLondonGazette: "2026-03-12" })).json();

    const updated = await (await patch(`/caseworker/cases/${created.id}`, { publishToLondonGazette: false })).json();

    expect(updated.dateNoticeSentToLondonGazette).toBeNull();
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
    expect(await get(`/caseworker/cases/${seeded.id}/witnesses`)).toHaveLength(0);
  });

  it("should delete without asking for a role, because a 403 is not a state this mock models", async () => {
    // API gates `removeWitness` on DELETE_WITNESS; this mock does not enforce witness permissions, so
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

  it("should refuse a filter that is not one of api's published tabs", async () => {
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
    expect(await response.json()).toMatchObject({ state: "Closed", decision: "Approved", decidedBy: "judge@example.com", changesToStandardPublication: false });
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

    await post(`/judicial/referrals/${referralId}/direction`, { decision: "Approved", changesToStandardPublication: false }, as(judge));
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

describe("the case's awaitingConfirmationSince, and the worklist it feeds", () => {
  it("should put a case with an unanswered request on the awaiting-confirmation tab and count it", async () => {
    const waiting = awaitingConfirmation(new Date("2026-03-21T09:00:00Z"));
    mock.seed(null);

    // `size=1`, as a count asks for it: the number is `total` across every page and never the rows returned.
    const counted = await get("/caseworker/cases?filter=awaitingConfirmation&size=1");

    expect(counted.total).toBe(1);
    expect(counted.cases.map((summary: { id: string }) => summary.id)).toEqual([waiting.caseId]);
  });

  it("should leave the tab's criterion off state, since a waiting case is ordinarily Returned", async () => {
    // The tab is the one filter that is not about `state`, so a Returned case waiting for nothing must not be on
    // it and a waiting one must be on it whatever its state.
    mock.seed({ state: "Returned", dateReturned: RETURNED_ON });
    const waiting = awaitingConfirmation(new Date("2026-03-21T09:00:00Z"));

    const list = await get("/caseworker/cases?filter=awaitingConfirmation");

    expect(list.cases.map((summary: { id: string }) => summary.id)).toEqual([waiting.caseId]);
  });

  it("should order the tab longest wait first without being asked, and still let a named sort win", async () => {
    const older = awaitingConfirmation(new Date("2026-02-01T09:00:00Z"));
    const newer = awaitingConfirmation(new Date("2026-03-01T09:00:00Z"));

    const byDefault = await get("/caseworker/cases?filter=awaitingConfirmation");
    const named = await get("/caseworker/cases?filter=awaitingConfirmation&sort=awaitingConfirmationSince:desc");

    expect(byDefault.cases.map((summary: { id: string }) => summary.id)).toEqual([older.caseId, newer.caseId]);
    expect(named.cases.map((summary: { id: string }) => summary.id)).toEqual([newer.caseId, older.caseId]);
  });

  it("should leave every other tab newest first, so the waiting order is the waiting tab's alone", async () => {
    const older = mock.seed({ createdOn: new Date("2026-01-01T00:00:00Z") });
    const newer = mock.seed({ createdOn: new Date("2026-02-01T00:00:00Z") });

    const list = await get("/caseworker/cases?filter=all");

    expect(list.cases.map((summary: { id: string }) => summary.id)).toEqual([newer.id, older.id]);
  });

  it("should publish the days waited on every row: whole days, zero on the day it was asked, null otherwise", async () => {
    awaitingConfirmation(new Date());
    mock.seed(null);

    const list = await get("/caseworker/cases?sort=awaitingConfirmationSince:asc");

    // Zero and never one on the day the email went out, which is api's arithmetic and its own words.
    expect(list.cases.map((summary: { daysAwaitingConfirmation: number | null }) => summary.daysAwaitingConfirmation)).toEqual([0, null]);
  });

  it("should take the case off the tab when the answer is recorded, without touching its state or its dates", async () => {
    const { caseId, referralId } = awaitingConfirmation(new Date("2026-03-21T09:00:00Z"));

    const response = await post(`/caseworker/cases/${caseId}/referrals/${referralId}/confirmation`, { outcome: "Confirmed" });

    expect(response.status).toBe(200);
    expect((await get("/caseworker/cases?filter=awaitingConfirmation")).total).toBe(0);
    const after = await get(`/caseworker/cases/${caseId}`);
    // The whole of decision 8: recording the answer is not a decision about the case's dates or its state, and
    // the referral it was recorded against has not moved either.
    expect(after).toMatchObject({
      state: "Returned",
      dateReturned: "2026-03-20T00:00:00.000",
      awaitingConfirmationSince: null,
      currentReferralState: "Decided"
    });
  });

  it("should keep the case waiting on an older unanswered request when a newer one is answered", async () => {
    // api's `ConfirmationWait`: closing a referral clears neither confirmation column, so a case really can hold
    // two outstanding requests — which is why the column is recomputed rather than set to null by the recording.
    const older = referral({ id: "older", state: "Closed", confirmationRequestedAt: new Date("2026-02-01T09:00:00Z") });
    const newer = referral({ id: "newer", state: "Decided", confirmationRequestedAt: new Date("2026-03-01T09:00:00Z") });
    const seeded = mock.seed({ referrals: [older, newer] });

    await post(`/caseworker/cases/${seeded.id}/referrals/newer/confirmation`, { outcome: "Withdrawn" });

    // On the list still, and on the older ask's date rather than the answered one's.
    expect((await get(`/caseworker/cases/${seeded.id}`)).awaitingConfirmationSince).toBe("2026-02-01T09:00:00.000");
    expect((await get("/caseworker/cases?filter=awaitingConfirmation")).total).toBe(1);
  });

  it("should record the answer with the recorder from the token and the date from its own clock", async () => {
    const { caseId, referralId } = awaitingConfirmation(new Date("2026-03-21T09:00:00Z"));

    // A body naming the recorder and the received date, which api's schema publishes `additionalProperties: true`
    // and therefore IGNORES rather than refuses. Copied deliberately: a mock that answered 400 would let this app
    // ship a body api silently drops.
    const recorded = await (
      await post(
        `/caseworker/cases/${caseId}/referrals/${referralId}/confirmation`,
        { outcome: "Withdrawn", note: "  Replied by post  ", confirmationRecordedBy: "Somebody Else", confirmationReceivedAt: "2020-01-01T00:00:00" },
        as("Ada Caseworker")
      )
    ).json();

    expect(recorded.confirmationOutcome).toBe("Withdrawn");
    expect(recorded.confirmationRecordedBy).toBe("Ada Caseworker");
    expect(recorded.confirmationReceivedAt).not.toBe("2020-01-01T00:00:00");
    // The request date is the email's and is not restamped by the answer.
    expect(recorded.confirmationRequestedAt).toBe("2026-03-21T09:00:00.000");
  });

  it("should write the answer onto the case's timeline, naming what it means and the caseworker's own words", async () => {
    const { caseId, referralId } = awaitingConfirmation(new Date("2026-03-21T09:00:00Z"));

    await post(`/caseworker/cases/${caseId}/referrals/${referralId}/confirmation`, { outcome: "Confirmed", note: "Replied by email" }, as("Ada Caseworker"));

    const [latest] = await notesOn(caseId);
    expect(latest.note).toContain("Applicant's confirmation recorded for referral raised on 1 March 2026, reasons: Applicant is a minor");
    expect(latest.note).toContain("Asked on 21 March 2026");
    // The member alone does not say whether they wanted the deed enrolled or the fee back, so api spells it out.
    expect(latest.note).toContain("Answer: Confirmed -- the applicant wants the deed enrolled, knowing it will be published in the London Gazette");
    expect(latest.note).toContain("\nNotes: Replied by email");
    expect(latest.createdBy).toBe("Ada Caseworker");
  });

  it("should write no note and change nothing when the recording is refused", async () => {
    const { caseId, referralId } = awaitingConfirmation(new Date("2026-03-21T09:00:00Z"));
    await post(`/caseworker/cases/${caseId}/referrals/${referralId}/confirmation`, { outcome: "Confirmed" });
    const afterFirst = await notesOn(caseId);

    await post(`/caseworker/cases/${caseId}/referrals/${referralId}/confirmation`, { outcome: "Withdrawn" });

    expect(await notesOn(caseId)).toHaveLength(afterFirst.length);
    expect((await get(`/caseworker/cases/${caseId}/referrals/${referralId}`)).confirmationOutcome).toBe("Confirmed");
  });

  it("should refuse a second answer, naming the outcome and the date but never the colleague who recorded it", async () => {
    const { caseId, referralId } = awaitingConfirmation(new Date("2026-03-21T09:00:00Z"));
    await post(`/caseworker/cases/${caseId}/referrals/${referralId}/confirmation`, { outcome: "Confirmed" }, as("Ada Caseworker"));

    const response = await post(`/caseworker/cases/${caseId}/referrals/${referralId}/confirmation`, { outcome: "Withdrawn" });

    expect(response.status).toBe(409);
    const { error } = await response.json();
    expect(error).toContain(`Referral ${referralId} already has a confirmation outcome of Confirmed, recorded on`);
    expect(error).toContain("Recording a second answer would overwrite it, so it is refused");
    // Naming a colleague in a refusal turns a correction into an accusation — api's reasoning, so its words.
    expect(error).not.toContain("Ada Caseworker");
  });

  it("should refuse an answer on a referral nobody asked to confirm", async () => {
    const { caseId, referralId } = await referredCase();

    const response = await post(`/caseworker/cases/${caseId}/referrals/${referralId}/confirmation`, { outcome: "Confirmed" });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe(
      `Referral ${referralId} has not been asked to confirm whether the applicant wants to proceed, so there is no answer to record`
    );
  });

  it("should check the body before either state, as Spring validates a payload before the service runs", async () => {
    const { caseId, referralId } = await referredCase();

    // An unasked referral AND an outcome api never published: the 400 is the answer, because the body is refused
    // before the guard that would have answered 409.
    const response = await post(`/caseworker/cases/${caseId}/referrals/${referralId}/confirmation`, { outcome: "Maybe" });

    expect(response.status).toBe(400);
    expect((await response.json()).errors.map((error: { field: string }) => error.field)).toEqual(["outcome"]);
  });

  it("should refuse a body with no outcome, which is the only required property", async () => {
    const { caseId, referralId } = awaitingConfirmation(new Date("2026-03-21T09:00:00Z"));

    const response = await post(`/caseworker/cases/${caseId}/referrals/${referralId}/confirmation`, { note: "They replied by post" });

    expect(response.status).toBe(400);
    expect((await response.json()).errors.map((error: { field: string }) => error.field)).toEqual(["outcome"]);
  });

  it("should refuse a note past api's cap rather than storing a truncated one", async () => {
    const { caseId, referralId } = awaitingConfirmation(new Date("2026-03-21T09:00:00Z"));

    const response = await post(`/caseworker/cases/${caseId}/referrals/${referralId}/confirmation`, { outcome: "Confirmed", note: "x".repeat(1001) });

    expect(response.status).toBe(400);
    expect((await get(`/caseworker/cases/${caseId}/referrals/${referralId}`)).confirmationOutcome).toBeNull();
  });

  it("should answer 404 for a referral recorded through the wrong case, and record nothing", async () => {
    const owning = awaitingConfirmation(new Date("2026-03-21T09:00:00Z"));
    const other = mock.seed(null);

    const response = await post(`/caseworker/cases/${other.id}/referrals/${owning.referralId}/confirmation`, { outcome: "Confirmed" });

    expect(response.status).toBe(404);
    // Discloses nothing about the referral, and the wait it belongs to is untouched.
    expect((await response.json()).error).toBe(`Referral ${owning.referralId} not found`);
    expect((await get(`/caseworker/cases/${owning.caseId}`)).awaitingConfirmationSince).toBe("2026-03-21T09:00:00.000");
  });

  it("should keep a column seeded with no referrals to recompute it from", async () => {
    // The same rule `currentReferralState` follows: a case seeded with the column and nothing to derive it from
    // is how a test arranges a wait that began before the process started.
    const seeded = mock.seed({ awaitingConfirmationSince: new Date("2026-01-05T09:00:00Z") });

    expect((await get(`/caseworker/cases/${seeded.id}`)).awaitingConfirmationSince).toBe("2026-01-05T09:00:00.000");
  });

  it("should publish the column as null on a case that has never been asked, rather than omitting it", async () => {
    const seeded = mock.seed(null);

    expect(await get(`/caseworker/cases/${seeded.id}`)).toHaveProperty("awaitingConfirmationSince", null);
  });
});

describe("a minor's details on a raised referral", () => {
  it("should accept the details beside Minor, and Minor alone, as api#155 does for its one release", async () => {
    const withDetails = await post(`/caseworker/cases/${mock.seed({}).id}/referrals`, { reasons: ["Minor", "MinorTransgender", "MinorCourtOrder"] });
    const alone = await post(`/caseworker/cases/${mock.seed({}).id}/referrals`, { reasons: ["Minor"] });

    expect(withDetails.status).toBe(201);
    expect((await withDetails.json()).reasons).toEqual(["Minor", "MinorTransgender", "MinorCourtOrder"]);
    expect(alone.status).toBe(201);
  });

  it("should write the raise note in the screens' words, a minor's details folded into Applicant is a minor", async () => {
    const caseId = mock.seed({}).id;

    await post(`/caseworker/cases/${caseId}/referrals`, { reasons: ["Minor", "MinorTransgender", "Other", "MinorParentalConsent"], notes: "See file" });

    expect((await notesOn(caseId))[0].note).toBe(
      "Referred to a Master. Reasons: Applicant is a minor: Transgender, Have parental consent; Other.\nNotes: See file"
    );
  });

  it("should refuse a detail without Minor, in api's words", async () => {
    const response = await post(`/caseworker/cases/${mock.seed({}).id}/referrals`, { reasons: ["DomesticAbuse", "MinorCourtOrder"] });

    expect(response.status).toBe(400);
    expect((await response.json()).errors).toEqual([{ field: "reasons", message: "reasons names a minor's detail (MinorCourtOrder) without Minor" }]);
  });

  it("should refuse both halves of a consent pair", async () => {
    const response = await post(`/caseworker/cases/${mock.seed({}).id}/referrals`, {
      reasons: ["Minor", "MinorStepparentConsent", "MinorNoStepparentConsent"]
    });

    expect(response.status).toBe(400);
    expect((await response.json()).errors).toEqual([
      { field: "reasons", message: "reasons cannot name both MinorStepparentConsent and MinorNoStepparentConsent" }
    ]);
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

  it("should answer a referral with the narrow application view, and no notes, contact, payment, refund or fee field", async () => {
    const seeded = mock.seed({
      displayReference: "KBDP2026-00001",
      type: "Adult",
      newForename: "Jo",
      newSurname: "Bloggs",
      privacy: "Private",
      applicantEmail: "jo@example.com",
      feeReference: "FEE-1",
      refundAmount: 42,
      refundReference: "REF-1",
      onlineApplicationReference: "ONLINE-1"
    });
    await post(`/caseworker/cases/${seeded.id}/notes`, { note: "Chased the declarant" });
    const created = await (await post(`/caseworker/cases/${seeded.id}/referrals`, { reasons: ["Minor"] })).json();

    const detail = await (await fetch(`${mock.url}/judicial/referrals/${created.id}`, { headers: as("judge@example.com") })).json();

    // Exactly api's `JudicialApplicationView`, so the wire schema parses it and nothing else rides along.
    expect(Object.keys(detail.application).sort()).toEqual(Object.keys(WIRE_SCHEMAS.JudicialApplicationView.shape).sort());
    expect(detail.application).toMatchObject({ displayReference: "KBDP2026-00001", newForename: "Jo" });
    expect(WIRE_SCHEMAS.JudicialReferralDetail.safeParse(detail).success).toBe(true);
    for (const leaked of ["FEE-1", "REF-1", "ONLINE-1", "jo@example.com", "Private", "Chased the declarant"]) {
      expect(JSON.stringify(detail)).not.toContain(leaked);
    }
    expect(detail).not.toHaveProperty("caseNotes");
    // No case id anywhere on the response: a judge must not be able to name an application.
    expect(JSON.stringify(detail)).not.toContain(seeded.id);
  });

  it.each([
    ["Minor", "Jane and Paul Bloggs"],
    ["MinorTransgender", "Jane and Paul Bloggs"],
    ["Adult", null],
    ["AdultTransgender", null],
    ["DeedOfRelinquishment", null]
  ] as const)("should send a %s application's parents as %s, as api's minor rule does", async (type, parents) => {
    const seeded = mock.seed({ type, parents: "Jane and Paul Bloggs" });
    const created = await (await post(`/caseworker/cases/${seeded.id}/referrals`, { reasons: ["Minor"] })).json();

    const detail = await (await fetch(`${mock.url}/judicial/referrals/${created.id}`, { headers: as("judge@example.com") })).json();

    expect(detail.application.parents).toBe(parents);
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
      { decision: "Rejected", changesToStandardPublication: true, directionsText: "  Not satisfied  ", decidedBy: "somebody else" },
      as("judge@example.com")
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      state: "Decided",
      decision: "Rejected",
      changesToStandardPublication: true,
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

    const response = await post(
      `/judicial/referrals/${referralId}/direction`,
      { decision: "Approved", changesToStandardPublication: false },
      as("judge@example.com")
    );

    expect(response.status).toBe(409);
  });

  it("should answer 404 rather than 409 for a direction on another judge's claim, so neither learns of the other", async () => {
    const { referralId } = await claimedReferral("another@example.com");

    const response = await post(
      `/judicial/referrals/${referralId}/direction`,
      { decision: "Approved", changesToStandardPublication: false },
      as("judge@example.com")
    );

    expect(response.status).toBe(404);
  });

  it("should refuse a direction the wire schema rejects, because publication has no default", async () => {
    const { referralId } = await claimedReferral("judge@example.com");

    const response = await post(`/judicial/referrals/${referralId}/direction`, { decision: "Approved" }, as("judge@example.com"));

    expect(response.status).toBe(400);
    expect((await response.json()).errors[0].field).toBe("changesToStandardPublication");
  });

  it.each([
    ["absent", undefined],
    ["blank", "   "]
  ])("should refuse changes to the standard publication with %s directions, as api's rule does, and record nothing", async (_, directionsText) => {
    const { caseId, referralId } = await claimedReferral(JUDGE);

    const response = await post(
      `/judicial/referrals/${referralId}/direction`,
      { decision: "Approved", changesToStandardPublication: true, directionsText },
      as(JUDGE)
    );

    expect(response.status).toBe(400);
    expect((await response.json()).errors).toEqual([{ field: "directionsText", message: expect.stringContaining("changes to the standard publication") }]);
    expect((await get(`/caseworker/cases/${caseId}/referrals/${referralId}`)).state).toBe("Claimed");
  });

  it("should refuse a change to the standard publication with no directions on a revision too", async () => {
    const { referralId } = await decidedReferral(JUDGE);

    const response = await change("PUT", `/judicial/referrals/${referralId}/direction`, JUDGE, { decision: "Approved", changesToStandardPublication: true });

    expect(response.status).toBe(400);
    expect((await response.json()).errors[0].field).toBe("directionsText");
  });

  it("should publish api's deprecated publishToGazette as the answer inverted, on both surfaces", async () => {
    const { caseId, referralId } = await claimedReferral(JUDGE);

    const response = await post(
      `/judicial/referrals/${referralId}/direction`,
      { decision: "Approved", changesToStandardPublication: true, directionsText: "Publish the last name only" },
      as(JUDGE)
    );

    expect(await response.json()).toMatchObject({ changesToStandardPublication: true, publishToGazette: false });
    expect(await get(`/caseworker/cases/${caseId}/referrals/${referralId}`)).toMatchObject({ changesToStandardPublication: true, publishToGazette: false });
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
describe("changing and withdrawing a direction", () => {
  it.each([
    ["changing", "PUT", "direction"],
    ["withdrawing", "POST", "direction/withdraw"]
  ])("should refuse %s a direction on a referral the judge can see but did not direct with 409", async (_, method, action) => {
    const open = await referredCase();
    const claimed = await claimedReferral(JUDGE);

    for (const { referralId } of [open, claimed]) {
      const response = await change(method, `/judicial/referrals/${referralId}/${action}`, JUDGE);

      expect(response.status, referralId).toBe(409);
    }
  });

  it.each([
    ["changing", "PUT", "direction"],
    ["withdrawing", "POST", "direction/withdraw"]
  ])("should answer 404 for %s another judge's direction, or one the office has closed", async (_, method, action) => {
    const theirs = await decidedReferral("another@example.com");
    const closed = await decidedReferral(JUDGE);
    await post(`/caseworker/cases/${closed.caseId}/referrals/${closed.referralId}/closure`);

    for (const { referralId } of [theirs, closed]) {
      const response = await change(method, `/judicial/referrals/${referralId}/${action}`, JUDGE);

      expect(response.status, referralId).toBe(404);
    }
  });

  it("should replace the direction, keep the first signer and set directionChangedAt on both surfaces", async () => {
    const { caseId, referralId } = await decidedReferral(JUDGE);

    const response = await change("PUT", `/judicial/referrals/${referralId}/direction`, JUDGE, {
      decision: "Rejected",
      changesToStandardPublication: true,
      directionsText: "  On reflection, no  "
    });

    expect(response.status).toBe(200);
    const detail = await response.json();
    expect(detail).toMatchObject({
      state: "Decided",
      decision: "Rejected",
      changesToStandardPublication: true,
      directionsText: "On reflection, no",
      decidedBy: JUDGE
    });
    expect(detail.directionChangedAt).toEqual(expect.any(String));
    expect((await get(`/caseworker/cases/${caseId}/referrals/${referralId}`)).directionChangedAt).toBe(detail.directionChangedAt);
    expect((await notesOn(caseId))[0].note).toMatch(
      /^Master’s direction revised for referral .*\. Decision: Rejected\. Changes to standard publication in the Gazette: Yes\./
    );
  });

  it("should refuse a change the wire schema rejects, as the first direction is refused", async () => {
    const { referralId } = await decidedReferral(JUDGE);

    const response = await change("PUT", `/judicial/referrals/${referralId}/direction`, JUDGE, { decision: "Approved" });

    expect(response.status).toBe(400);
    expect((await response.json()).errors[0].field).toBe("changesToStandardPublication");
  });

  it("should withdraw a direction back to the same judge's claim, cleared, so they can direct again", async () => {
    const { caseId, referralId } = await decidedReferral(JUDGE);

    const withdrawn = await change("POST", `/judicial/referrals/${referralId}/direction/withdraw`, JUDGE);

    expect(withdrawn.status).toBe(200);
    const detail = await withdrawn.json();
    expect(detail).toMatchObject({
      state: "Claimed",
      claimedBy: JUDGE,
      decision: null,
      directionsText: null,
      changesToStandardPublication: null,
      decisionDate: null,
      decidedBy: null
    });
    expect(detail.directionChangedAt).toEqual(expect.any(String));
    // Composed before the clear, so it names the direction that stopped being the answer.
    expect((await notesOn(caseId))[0].note).toMatch(/^Master’s direction withdrawn for referral .*\. The withdrawn decision was: Approved\./);
    expect(await currentReferralState(caseId)).toBe("Claimed");

    const again = await post(
      `/judicial/referrals/${referralId}/direction`,
      { decision: "Rejected", changesToStandardPublication: true, directionsText: "Do not publish" },
      as(JUDGE)
    );

    expect(again.status).toBe(200);
    // Never cleared by directing again: it is a fact about the referral's history.
    expect((await again.json()).directionChangedAt).toBe(detail.directionChangedAt);
  });

  it("should leave directionChangedAt null on a direction that stands as first given", async () => {
    const { caseId, referralId } = await decidedReferral(JUDGE);

    expect((await get(`/judicial/referrals/${referralId}`, as(JUDGE))).directionChangedAt).toBeNull();
    expect((await get(`/caseworker/cases/${caseId}/referrals/${referralId}`)).directionChangedAt).toBeNull();
  });
});

describe("a Master's view of the application's documents", () => {
  it("should list only the documents that have a file, and none of the witnesses", async () => {
    const { referralId, readable } = judicialCaseWithDocuments();

    const application = (await get(`/judicial/referrals/${referralId}`, as(JUDGE))).application;

    // The case has a witness; a Master is sent none (Master Sullivan's feedback, 2026-10-27).
    expect(application).not.toHaveProperty("witnesses");
    expect(application.documents).toEqual([
      {
        id: readable,
        name: "Birth certificate",
        documentType: MOCK_DOCUMENT_TYPES[0].name,
        direction: "Incoming",
        mimeType: "application/pdf",
        sizeBytes: 4,
        uploadedOn: expect.any(String)
      }
    ]);
  });

  it("should serve a document's bytes with the caseworker download's headers", async () => {
    const { referralId, readable } = judicialCaseWithDocuments();

    const response = await fetch(`${mock.url}/judicial/referrals/${referralId}/documents/${readable}/file`, { headers: as(JUDGE) });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe('inline; filename="birth.pdf"');
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(Buffer.from(await response.arrayBuffer()).toString("utf8")).toBe("%PDF");
  });

  it("should answer 404 for a document with no file, one on another case, and one behind an invisible referral", async () => {
    const { referralId, unreadable } = judicialCaseWithDocuments();
    const other = judicialCaseWithDocuments();
    const theirs = judicialCaseWithDocuments({ state: "Claimed", claimedBy: "another@example.com", claimedById: "another@example.com" });

    for (const path of [
      `/judicial/referrals/${referralId}/documents/${unreadable}/file`,
      `/judicial/referrals/${referralId}/documents/${other.readable}/file`,
      `/judicial/referrals/${theirs.referralId}/documents/${theirs.readable}/file`
    ]) {
      expect((await fetch(`${mock.url}${path}`, { headers: as(JUDGE) })).status, path).toBe(404);
    }
  });

  it.each([
    ["Open", {}, 200],
    ["Claimed by this judge", { state: "Claimed", claimedById: JUDGE }, 200],
    ["Decided by this judge", { state: "Decided", decidedById: JUDGE }, 200],
    ["Closed", { state: "Closed", decidedById: JUDGE }, 404],
    ["Withdrawn", { state: "Withdrawn", claimedById: JUDGE }, 404]
  ] as const)("should let a judge open the documents of a referral that is %s only as api's visibility allows", async (_, overrides, status) => {
    const { referralId, readable } = judicialCaseWithDocuments(overrides);

    const read = await fetch(`${mock.url}/judicial/referrals/${referralId}`, { headers: as(JUDGE) });
    const file = await fetch(`${mock.url}/judicial/referrals/${referralId}/documents/${readable}/file`, { headers: as(JUDGE) });

    expect(read.status).toBe(status);
    expect(file.status).toBe(status);
  });
});

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

  it("should drop a lapsed claim and hand it back to the pool, because the state decides and not the holder columns", async () => {
    // **The one referral transition this mock does not model, covered by its result rather than by a timer.** api's
    // inactivity sweep is a two-hour window on its own clock (see the file's docblock), and what it leaves behind is
    // an `Open` row still carrying the attribution of the judge who let it lapse. That row is seeded here directly,
    // because no request can produce it.
    //
    // Both halves matter: it is off the list of the judge who held it, and it is every judge's again. Keyed on
    // `claimedBy`/`claimedById` instead of on the state, a lapsed claim would sit on its old holder's list for good
    // — the same row on two lists, one of which cannot act on it.
    const lapsed = referral({ id: "lapsed-claim", state: "Open", claimedBy: JUDGE, claimedById: JUDGE, claimedAt: new Date("2026-03-01T09:05:00") });
    mock.seed({ referrals: [lapsed] });

    const mine = await get("/judicial/referrals/mine", as(JUDGE));
    const pool = await get("/judicial/referrals");

    expect(mine.referrals).toEqual([]);
    expect(pool.referrals.map((row: { id: string }) => row.id)).toEqual(["lapsed-claim"]);
    expect((await fetch(`${mock.url}/judicial/referrals/lapsed-claim`, { headers: as("another@example.com") })).status).toBe(200);
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
    await post(`/judicial/referrals/${referralId}/direction`, { decision: "Approved", changesToStandardPublication: false }, holder);

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
    await post(`/judicial/referrals/${referralId}/direction`, { decision: "Approved", changesToStandardPublication: false }, as(JUDGE));
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
    await post(`/judicial/referrals/${referralId}/direction`, { decision: "Approved", changesToStandardPublication: false }, as(JUDGE));
    await post(`/caseworker/cases/${caseId}/referrals/${referralId}/closure`);

    const notes = await notesOn(caseId);

    const raised = await raisedOn(caseId, referralId);
    expect(notes.map((note) => note.note)).toEqual([
      `Master’s direction for referral raised on ${raised}, reasons: Applicant is a minor, marked as actioned.`,
      `Master’s direction recorded for referral raised on ${raised}, reasons: Applicant is a minor.` +
        " Decision: Approved. Changes to standard publication in the Gazette: No. See the referral for the full direction.",
      `Referral raised on ${raised}, reasons: Applicant is a minor, claimed by a Master.`,
      "Referred to a Master. Reasons: Applicant is a minor."
    ]);
  });

  it("should record a withdrawal beside the raise, naming which referral it was", async () => {
    // The pre-direction branch, where a case's timeline has to say the referral left and came back with nothing
    // in between — and name the referral, because a case may carry several over its life.
    const { caseId, referralId } = await referredCase({ reasons: ["Minor", "DomesticAbuse"] });

    await post(`/caseworker/cases/${caseId}/referrals/${referralId}/withdrawal`);

    const raised = await raisedOn(caseId, referralId);
    expect((await notesOn(caseId)).map((note) => note.note)).toEqual([
      `Referral to a Master withdrawn. It was raised on ${raised}, reasons: Applicant is a minor; Domestic abuse considerations.`,
      "Referred to a Master. Reasons: Applicant is a minor; Domestic abuse considerations."
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
    expect(raised.note).toBe("Referred to a Master. Reasons: Other.\nMarked urgent: Hearing on Friday.\nNotes: Unusual circumstances");
  });

  it("should point at the referral for the full direction rather than copying it into the note", async () => {
    // api allows a direction to be twice what a note may hold, so copying it would compose a note api's own
    // validator refuses — and a truncated copy would read as the whole of a judicial direction.
    const { caseId, referralId } = await claimedReferral(JUDGE);
    const directions = "The applicant must file the missing evidence. ".repeat(80);

    await post(
      `/judicial/referrals/${referralId}/direction`,
      { decision: "Rejected", changesToStandardPublication: true, directionsText: directions },
      as(JUDGE)
    );

    const [directed] = await notesOn(caseId);
    expect(directed.note).toContain("Decision: Rejected.");
    // Spelled out, never abbreviated to the presence of a word: publication names the applicant in a public
    // notice, so "not published" and "nothing recorded" must not read alike.
    expect(directed.note).toContain("Changes to standard publication in the Gazette: Yes.");
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
    expect((await post(`/judicial/referrals/${referralId}/direction`, { decision: "Approved", changesToStandardPublication: false }, as(JUDGE))).status).toBe(
      409
    );

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

  it("should write the generated events to the caseworker's timeline only, and leave the stored order alone", async () => {
    const { caseId, referralId } = await referredCase();
    await post(`/judicial/referrals/${referralId}/claim`, undefined, as(JUDGE));

    const judicial = await (await fetch(`${mock.url}/judicial/referrals/${referralId}`, { headers: as(JUDGE) })).json();
    const listed = await notesOn(caseId);
    const detail = await get(`/caseworker/cases/${caseId}`);

    // The raise and the claim each wrote a note, and a Master is sent neither: no timeline on the judicial
    // projection since 2026-10-27.
    expect(listed).toHaveLength(2);
    expect(judicial).not.toHaveProperty("caseNotes");
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
      expect.stringContaining("Referral to a Master withdrawn"),
      "Declarant called back",
      "Referred to a Master. Reasons: Applicant is a minor."
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
    // is the concrete case: it travels in the `Idempotency-Key` HEADER and never in a body, so a page that put it
    // in one would be a 400 naming the property — see "the send's Idempotency-Key" below. An earlier version of
    // this comment called the UUID admin-local, which stopped being true at api's notify-6.
    const { caseId } = refusedCase();

    const response = await post(`/caseworker/cases/${caseId}/emails/application-rejected/preview`, { judges_reason: "Because", idempotencyKey: randomUUID() });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.errors).toEqual([{ field: "idempotencyKey", message: expect.stringContaining("is not a slot of application-rejected") }]);
  });

  it("should require the judge's reason when no direction was recorded to pre-populate it from", async () => {
    // A judge may refuse an application without typing a comment, so this is reachable rather than theoretical.
    const { caseId } = refusedCase({ directionsText: null });

    // Through `send`, so it carries the key api requires: without one the 400 is the header's, which would leave
    // this test green while proving nothing about the slot.
    const response = await send(caseId);

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

  describe("the send's Idempotency-Key", () => {
    it("should refuse a send carrying no key, naming the header rather than a field of the form", async () => {
      // api binds `@RequestHeader(IDEMPOTENCY_KEY) UUID requestId` with no default, so Spring answers 400 before
      // the handler runs. Posted directly rather than through `send`, which mints one.
      const { caseId } = refusedCase();

      const response = await post(`/caseworker/cases/${caseId}/emails/application-rejected`, {});

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        error: "Invalid request parameter",
        errors: [{ field: "Idempotency-Key", message: "is a required header for this operation" }]
      });
      expect((await get(`/caseworker/cases/${caseId}/emails`)).history).toEqual([]);
    });

    it("should refuse a key that is not a UUID, because api parses one rather than storing the text", async () => {
      // The second of api's two 400s — `MethodArgumentTypeMismatchException` — and a different sentence, because a
      // client that sent "retry-1" has a different thing to fix from one that sent nothing.
      const { caseId } = refusedCase();

      const response = await send(caseId, { "idempotency-key": "retry-1" });

      expect(response.status).toBe(400);
      expect((await response.json()).errors).toEqual([{ field: "Idempotency-Key", message: "is not a valid value for this parameter" }]);
    });

    it("should refuse a send with no key before it refuses the template, as api's binding order does", async () => {
      // Spring resolves every argument before the handler body, so `requireTemplate` is never reached. Restated
      // because a mock that answered the 404 first would let a client conclude the header is optional on the paths
      // it happened to test.
      const { caseId } = refusedCase();

      const response = await post(`/caseworker/cases/${caseId}/emails/no-such-template`, {});

      expect(response.status).toBe(400);
    });

    it("should require no key for a preview, which writes nothing there is anything to make idempotent", async () => {
      const { caseId } = refusedCase();

      const response = await post(`/caseworker/cases/${caseId}/emails/application-rejected/preview`, {});

      expect(response.status).toBe(200);
      expect((await response.json()).subject).toMatch(/./);
    });

    it("should answer a retry of one journey's key with the original receipt and no second row", async () => {
      const { caseId } = refusedCase();
      const key = randomUUID();
      const first = await (await send(caseId, { "idempotency-key": key })).json();

      const retry = await send(caseId, { "idempotency-key": key });

      expect(retry.status).toBe(200);
      expect(await retry.json()).toEqual({ id: first.id, recipient: "applicant@example.com", enqueued: false });
      expect((await get(`/caseworker/cases/${caseId}/emails`)).history).toHaveLength(1);
    });

    it("should treat a re-cased key as the same key, because api holds a UUID and not the text it arrived as", async () => {
      const { caseId } = refusedCase();
      const key = randomUUID();
      const first = await (await send(caseId, { "idempotency-key": key })).json();

      const retry = await send(caseId, { "idempotency-key": key.toUpperCase() });

      expect((await retry.json()).id).toBe(first.id);
      expect((await get(`/caseworker/cases/${caseId}/emails`)).history).toHaveLength(1);
    });

    it("should refuse a key already used on this case for a different email, rather than answering with that one", async () => {
      // Also the proof that the key is asked about BEFORE the per-referral rule: that rule would answer this 200
      // with the first row, so a 409 can only come from the key-keyed lookup running first. 409 and not 400 —
      // nothing in the payload is wrong, and the sentence says to start again rather than naming a field.
      const { caseId } = refusedCase();
      const key = randomUUID();
      await send(caseId, { "idempotency-key": key });

      const different = await send(caseId, { "idempotency-key": key }, { judges_reason: "A different reason entirely" });

      expect(different.status).toBe(409);
      expect((await different.json()).error).toContain("start composing the email again");
      expect((await get(`/caseworker/cases/${caseId}/emails`)).history).toHaveLength(1);
    });

    it("should scope a key to its case, so one key can send an email on each of two cases", async () => {
      // V19's index is ("deedPollId", "requestId"), so a caller cannot make one case's chosen key collide with
      // another case's row — and this is the one place a *different* send under the same key is reachable here.
      const first = refusedCase();
      const second = refusedCase();
      const key = randomUUID();

      const one = await send(first.caseId, { "idempotency-key": key });
      const two = await send(second.caseId, { "idempotency-key": key });

      expect([(await one.json()).enqueued, (await two.json()).enqueued]).toEqual([true, true]);
      expect((await get(`/caseworker/cases/${second.caseId}/emails`)).history).toHaveLength(1);
    });
  });

  describe("the case notes an email writes", () => {
    it("should write one note naming the email and the tab when a send is accepted", async () => {
      const { caseId } = refusedCase();

      await send(caseId);

      // The Notes grid is the only timeline a case has, so this note is the whole of an email's presence on it.
      expect(await noteTexts(caseId)).toEqual(["Application rejected email sent. See the Emails tab for its delivery status."]);
    });

    it("should attribute the note to the caseworker who sent it, not to the service", async () => {
      const { caseId } = refusedCase();

      await send(caseId, asPerson("Jo Caseworker", "jo-subject"));

      expect((await notes(caseId))[0].createdBy).toBe("Jo Caseworker");
    });

    it("should write no second note when an idempotent repeat send returns the original row", async () => {
      // The applicant is owed one email, so the timeline says it once. A caseworker double-clicking would
      // otherwise leave a case reading as though they had been written to twice. Two journeys here — `send` mints
      // a key per call — so this is the per-referral rule answering; the same key's retry is the test below.
      const { caseId } = refusedCase();

      await send(caseId);
      const repeat = await send(caseId);

      expect((await repeat.json()).enqueued).toBe(false);
      expect(await noteTexts(caseId)).toHaveLength(1);
    });

    it("should write no second note when one journey's key arrives twice", async () => {
      // The other of the two rules that answer `enqueued: false`, and the one a double-click actually takes. A
      // change that appended the note before the request-id lookup would leave this case reading as two emails
      // while the test above stayed green, because that one is answered further down.
      const { caseId } = refusedCase();
      const key = randomUUID();

      await send(caseId, { "idempotency-key": key });
      const retry = await send(caseId, { "idempotency-key": key });

      expect((await retry.json()).enqueued).toBe(false);
      expect(await noteTexts(caseId)).toHaveLength(1);
    });

    it("should write both notes when the send is enqueued and then fails terminally", async () => {
      // The pair is the point: the sent note belongs to the enqueue and the failure note to the drain, and api
      // writes them from different transactions for a reason a single note would hide.
      const { caseId } = refusedCase();
      mock.setScenario("email-send-failure");

      await send(caseId);

      expect(await noteTexts(caseId)).toEqual([
        "Application rejected email sent. See the Emails tab for its delivery status.",
        "Application rejected email could not be sent. See the Emails tab for the reason."
      ]);
    });

    it("should keep the provider's reason out of the note and on the row, because a note's length must stay provable", async () => {
      const { caseId } = refusedCase();
      mock.setScenario("email-send-failure");

      await send(caseId);

      const history = (await get(`/caseworker/cases/${caseId}/emails`)).history;
      expect(history[0].failureReason).toContain("PERMANENT");
      // api excludes it from the note precisely because it is unbounded external text; a note that quoted it
      // would be the divergence this mock exists to catch.
      expect((await noteTexts(caseId)).join(" ")).not.toContain("PERMANENT");
    });
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
  await post(`/judicial/referrals/${claimed.referralId}/direction`, { decision: "Approved", changesToStandardPublication: false }, as(judge));

  return claimed;
}

/** A judicial write by `judge`, with a JSON body only when there is one — withdraw takes none. */
function change(
  method: string,
  path: string,
  judge: string,
  body: unknown = { decision: "Rejected", changesToStandardPublication: true, directionsText: "Do not publish" }
): Promise<Response> {
  return fetch(`${mock.url}${path}`, {
    method,
    headers: { "content-type": "application/json", ...as(judge) },
    body: method === "PUT" ? JSON.stringify(body) : undefined
  });
}

/**
 * A seeded case with one referral, one witness, a document with a file and one without — the last being a row api
 * keeps but never lists to a judge.
 */
function judicialCaseWithDocuments(overrides: Partial<MockCase["referrals"][number]> = {}): { referralId: string; readable: string; unreadable: string } {
  const held = referral(overrides);
  const document = (id: string, bytes: string) => ({
    id,
    name: "Birth certificate",
    originalName: "birth.pdf",
    mimeType: "application/pdf",
    sizeBytes: bytes.length,
    documentType: MOCK_DOCUMENT_TYPES[0],
    direction: "Incoming" as const,
    bytes: Buffer.from(bytes, "utf8"),
    createdOn: new Date("2026-03-01T09:00:00"),
    modifiedOn: new Date("2026-03-01T09:00:00")
  });
  const readable = randomUUID();
  const unreadable = randomUUID();
  mock.seed({
    referrals: [held],
    witnesses: [{ id: randomUUID(), witnessName: "A Witness", witnessAddress: "1 Road", witnessOccupation: "Baker", declarant: true }],
    documents: [document(readable, "%PDF"), document(unreadable, "")]
  });

  return { referralId: held.id, readable, unreadable };
}

async function currentReferralState(caseId: string): Promise<string | null> {
  return (await get(`/caseworker/cases/${caseId}`)).currentReferralState;
}

/**
 * A seeded case whose referral has been asked whether the applicant still wants to proceed, and has not answered.
 *
 * **Seeded and not driven, because the write that starts the wait is the email** — notify-3's *Request
 * confirmation to proceed*, which the mock has no template for and this plan does not send. Everything after the
 * ask is the contract: the recording, both refusals, and the case leaving the worklist.
 *
 * `Decided` with a refusal on it, because that is the only way a case reaches this state: the judge refused the
 * non-publication request, so the office asked the applicant whether to enrol anyway.
 */
function awaitingConfirmation(asked: Date, overrides: Partial<MockCase["referrals"][number]> = {}): { caseId: string; referralId: string } {
  const waiting = referral({
    state: "Decided",
    decision: "Rejected",
    directionsText: JUDGES_REASON,
    decidedBy: JUDGE,
    confirmationRequestedAt: asked,
    ...overrides
  });
  // `Returned` with the date that derives it, because that is the state a waiting case is ordinarily in — and
  // what makes "recording the answer changes no case state or date" an assertion rather than a tautology.
  const seeded = mock.seed({ state: "Returned", dateReturned: RETURNED_ON, referrals: [waiting] });

  return { caseId: seeded.id, referralId: waiting.id };
}

/**
 * A seeded case whose referral a Master has refused, with an applicant to write to.
 *
 * Seeded rather than driven through the judicial surface, which is what `client.test.ts` does: these tests are
 * about the email rules, and arranging a claim and a direction per test would put three round trips in front of
 * every assertion. The refusal itself is what makes the email applicable, so the state is the arrangement.
 */
/**
 * Sends the one email the mock serves, with the direction already recorded so no slot has to be supplied.
 *
 * **A fresh `Idempotency-Key` per call**, because api requires one and each call here is its own compose journey.
 * Minted rather than shared so a test about something else cannot accidentally be testing the idempotent answer;
 * the tests that are about the key pass their own, and the two that send none post directly.
 */
function send(caseId: string, headers: Record<string, string> = {}, body: unknown = {}): Promise<Response> {
  return post(`/caseworker/cases/${caseId}/emails/application-rejected`, body, { "idempotency-key": randomUUID(), ...headers });
}

/** A case's notes, oldest first — the chronology, so a pair written by one send reads in the order it happened. */
async function notes(caseId: string): Promise<{ note: string; createdBy: string }[]> {
  return (await get(`/caseworker/cases/${caseId}`)).notes;
}

async function noteTexts(caseId: string): Promise<string[]> {
  return (await notes(caseId)).map((entry) => entry.note);
}

function refusedCase(overrides: Partial<MockCase["referrals"][number]> = {}): { caseId: string; referralId: string } {
  const refused = referral({ state: "Decided", decision: "Rejected", directionsText: JUDGES_REASON, decidedBy: "judge@example.com", ...overrides });
  const seeded = mock.seed({ applicantEmail: "applicant@example.com", referrals: [refused] });

  return { caseId: seeded.id, referralId: refused.id };
}

/**
 * One referral as the mock stores it, for a case seeded mid-lifecycle.
 *
 * `Date` values rather than the ISO strings the wire carries, because `mock.seed` holds a `MockCase` — which is
 * also why a case with children is seeded in process rather than over `POST /__mock/cases`.
 */
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
    changesToStandardPublication: null,
    decisionDate: null,
    decidedBy: null,
    decidedById: null,
    directionChangedAt: null,
    confirmationRequestedAt: null,
    confirmationOutcome: null,
    confirmationReceivedAt: null,
    confirmationRecordedBy: null,
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
