/**
 * The mock's own behaviour: the `__mock` control routes, and the api rules it restates.
 *
 * `client.test.ts` covers the contract routes through the adapter, which is how they are actually reached.
 * What is left for here is everything the adapter has no function for — scenario switching, resetting,
 * seeding — plus the four api rules the mock reproduces, tested directly so a wrong restatement fails here
 * rather than as a puzzling page assertion.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type RunningMockApi, startMockApi } from "./server.js";

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
    // Witnesses are read-only through the contract — api has no witness writes — so seeding is the only
    // way a page under test gets one.
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

  it("should not delete a witness, because api has no delete until the Administrator gate lands", async () => {
    const seeded = mock.seed(null);
    const created = await (await post(`/caseworker/cases/${seeded.id}/witnesses`, WITNESS)).json();

    const response = await fetch(`${mock.url}/caseworker/cases/${seeded.id}/witnesses/${created.id}`, { method: "DELETE" });

    expect(response.status).toBe(405);
    expect((await get(`/caseworker/cases/${seeded.id}/witnesses`)).length).toBe(1);
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

/** The mock's raw JSON. `any` because these tests assert against the wire body, not a parsed type. */
async function get(path: string): Promise<any> {
  return (await fetch(`${mock.url}${path}`)).json();
}
