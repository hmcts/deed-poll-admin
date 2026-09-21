/**
 * The adapter against the mock, over real HTTP.
 *
 * Not against `vi.fn()` stubs of `fetch`: the things worth testing here are the seams a stub would define
 * away — a multipart body a server can actually parse, a timeout that really fires, a connection that is
 * really refused, and a 2xx whose body does not match the contract.
 */
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { Readable } from "node:stream";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type RunningMockApi, startMockApi } from "../mock/server.js";
import {
  type ApiConfig,
  checkApiReachable,
  claimJudicialReferral,
  closeReferral,
  createCase,
  createNote,
  createReferral,
  createSavedQuery,
  createWitness,
  deleteNote,
  deleteSavedQuery,
  deleteWitness,
  deselectSavedQuery,
  directJudicialReferral,
  downloadDocument,
  getCase,
  getCaseEmails,
  getFieldRules,
  getJudicialPool,
  getJudicialReferral,
  getNote,
  getReferral,
  getSavedQuery,
  getWitness,
  listCases,
  listDocumentTypes,
  listNotes,
  listReferrals,
  listSavedQueries,
  listWitnesses,
  patchCase,
  patchNote,
  patchSavedQuery,
  previewEmail,
  type ReferralCreate,
  selectSavedQuery,
  sendEmail,
  updateWitness,
  uploadDocument,
  withdrawReferral
} from "./client.js";

/** A create that succeeds: Date Received is the one field api cannot allocate a reference without. */
const DATE_RECEIVED = new Date("2026-03-10T00:00:00Z");

/** A document type the mock serves, so an upload can name one. */
const DOCUMENT_TYPE_ID = "11111111-1111-4111-8111-111111111111";

/**
 * The direction a judge recorded, which is what `judges_reason` arrives pre-populated with.
 *
 * A constant because three tests need to tell the pre-populated value from a typed one, and "the judge's words
 * reached the email" is the assertion rather than the words themselves.
 */
const JUDGES_REASON = "The evidence supplied does not establish the applicant's identity.";

/** All four witness fields, because api requires all four on a create. */
const WITNESS = { witnessName: "Alex Witness", witnessAddress: "1 Test Road, Testville", witnessOccupation: "Baker", declarant: false };

let mock: RunningMockApi;
let config: ApiConfig;

beforeAll(async () => {
  mock = await startMockApi();
  config = { baseUrl: mock.url, timeoutMs: 2000, accessToken: "a-caseworker-token" };
});

afterAll(async () => {
  await mock.close();
});

beforeEach(() => {
  mock.setScenario("happy-path");
  // Reset as well as re-scenario: one mock is shared across the file, so without this the cases and the
  // per-year reference serials accumulate and every assertion about a serial or a list length depends on
  // what ran before it.
  mock.reset();
});

describe("createCase", () => {
  it("should return the case with the reference number api allocated", async () => {
    const result = await createCase({ dateReceived: DATE_RECEIVED, type: "Adult", newForename: "Jo" }, config);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // KBDP for every type but a relinquishment, then the year from Date Received and a five-digit serial.
    expect(result.data.displayReference).toMatch(/^KBDP2026-\d{5}$/);
    expect(result.data.referencenumber).toBeTypeOf("number");
    expect(result.data.id).toMatch(/./);
  });

  it("should prefix a deed of relinquishment KBDR", async () => {
    const result = await createCase({ dateReceived: DATE_RECEIVED, type: "DeedOfRelinquishment" }, config);

    expect(result.ok && result.data.displayReference).toMatch(/^KBDR2026-\d{5}$/);
  });

  it("should report the missing date received against its own field rather than as a fault", async () => {
    // The most obvious request anyone makes of the new-case form. The reference's year comes from this
    // field, so api refuses — and the form renders the refusal against the input.
    const result = await createCase({ type: "Adult" }, config);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("validation");
    expect(result.error.fieldErrors?.map((error) => error.field)).toContain("dateReceived");
  });

  it("should return dates as Date objects, not the strings they arrived as", async () => {
    const result = await createCase({ dateReceived: DATE_RECEIVED }, config);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.dateReceived).toBeInstanceOf(Date);
    expect(result.data.dateReceived?.toISOString()).toBe(DATE_RECEIVED.toISOString());
  });

  it("should report api's field errors when the scenario refuses the write", async () => {
    mock.setScenario("write-rejection");

    const result = await createCase({ dateReceived: DATE_RECEIVED }, config);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("validation");
    expect(result.error.fieldErrors).toEqual([{ field: "newForename", message: "Enter the new forename" }]);
  });
});

describe("getCase", () => {
  it("should return the case with its three child collections", async () => {
    const id = await caseId();

    const result = await getCase(id, config);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.notes).toEqual([]);
    expect(result.data.witnesses).toEqual([]);
    expect(result.data.documents).toEqual([]);
  });

  it("should report not-found for an unknown id", async () => {
    const result = await getCase("00000000-0000-0000-0000-000000000000", config);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("not-found");
    expect(result.error.status).toBe(404);
  });
});

describe("patchCase", () => {
  it("should leave a field the patch does not mention alone", async () => {
    const id = await caseId({ newForename: "Jo", newSurname: "Bloggs" });

    const result = await patchCase(id, { newForename: "Joanne" }, config);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.newForename).toBe("Joanne");
    expect(result.data.newSurname).toBe("Bloggs");
  });

  it("should re-derive the state from the dates the patch sets", async () => {
    const id = await enrollableCaseId();

    const result = await patchCase(id, { dateEnroled: new Date("2026-04-01T00:00:00Z") }, config);

    expect(result.ok && result.data.state).toBe("Enroled");
  });

  it("should report a contradictory pair of dates as a validation failure, not a saved case", async () => {
    const id = await caseId({ dateEnroled: new Date("2026-04-01T00:00:00Z") });

    const result = await patchCase(id, { dateReturned: new Date("2026-04-02T00:00:00Z") }, config);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("validation");
    expect(result.error.fieldErrors?.map((error) => error.field)).toContain("state");
  });

  it("should re-prefix but never re-allocate the reference when the type changes", async () => {
    const created = await createCase({ dateReceived: DATE_RECEIVED, type: "Adult" }, config);
    if (!created.ok) throw new Error("case was not created");

    const result = await patchCase(created.data.id, { type: "DeedOfRelinquishment" }, config);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.displayReference).toBe(created.data.displayReference?.replace("KBDP", "KBDR"));
    expect(result.data.referencenumber).toBe(created.data.referencenumber);
  });
});

describe("getFieldRules", () => {
  it("should hide the minor fields for an adult case and mandate the adult ones", async () => {
    const result = await getFieldRules({ type: "Adult" }, config);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.ageOfMinor).toEqual({ visible: false, required: false });
    expect(result.data.maritalStatus).toEqual({ visible: true, required: true });
  });

  it("should relax the required set for a migrated record without changing what is visible", async () => {
    const result = await getFieldRules({ type: "Adult", migrated: true }, config);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.maritalStatus).toEqual({ visible: true, required: false });
    expect(result.data.ageOfMinor.visible).toBe(false);
  });

  it("should hide the gazette notice date when publishing to the gazette is off", async () => {
    const result = await getFieldRules({ type: "Adult", publishToGazette: false }, config);

    // Guarded rather than `result.ok && …`, which short-circuits to false and so passes for a call that
    // never reached the rules at all.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.dateNoticeSentToLondonGazette.visible).toBe(false);
  });

  it("should refuse an unrecognised type rather than answering the no-type rules", async () => {
    const result = await getFieldRules({ type: "NotAType" as never }, config);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("validation");
    expect(result.error.fieldErrors?.map((error) => error.field)).toContain("type");
  });
});

describe("listCases", () => {
  it("should report which filter api resolved, so an unrecognised one is visible", async () => {
    await caseId();

    const result = await listCases({ filter: "nonsense" }, config);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.filter).toBe("all");
    expect(result.data.cases.length).toBeGreaterThan(0);
  });

  it("should exclude a finished case from the open filter", async () => {
    const id = await enrollableCaseId();
    await patchCase(id, { dateEnroled: new Date("2026-04-01T00:00:00Z") }, config);

    const result = await listCases({ filter: "open" }, config);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.cases.map((summary) => summary.id)).not.toContain(id);
  });

  it("should send each condition as its own where parameter, ANDed", async () => {
    const wanted = await caseId({ type: "Adult", newForename: "Ada" });
    await caseId({ type: "Minor", newForename: "Ada" });
    await caseId({ type: "Adult", newForename: "Grace" });

    const result = await listCases({ where: ["type:is:Adult", "newForename:is:Ada"] }, config);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.cases.map((summary) => summary.id)).toEqual([wanted]);
  });

  it("should encode a value containing a colon rather than letting it re-split the condition", async () => {
    // The reason api splits on the first two colons only: `contains:10:30` is one value, not two parts.
    const id = await caseId({ returnReason: "Returned at 10:30, unsigned" });

    const result = await listCases({ where: ["returnReason:contains:at 10:30"] }, config);

    expect(result.ok && result.data.cases.map((summary) => summary.id)).toEqual([id]);
  });

  it("should sort by the field and direction asked for", async () => {
    const first = await caseId({ dateReceived: new Date("2026-01-05T00:00:00Z"), newForename: "Ada" });
    const second = await caseId({ dateReceived: new Date("2026-02-05T00:00:00Z"), newForename: "Bea" });

    const ascending = await listCases({ sort: "dateReceived:asc" }, config);
    const descending = await listCases({ sort: "dateReceived:desc" }, config);

    expect(ascending.ok && ascending.data.cases.map((summary) => summary.id)).toEqual([first, second]);
    expect(descending.ok && descending.data.cases.map((summary) => summary.id)).toEqual([second, first]);
  });

  it("should carry the counts of the whole result set, not of the page it returned", async () => {
    for (const forename of ["Ada", "Bea", "Cyd"]) await caseId({ newForename: forename, dateReceived: DATE_RECEIVED });

    const result = await listCases({ sort: "newForename:asc", page: 2, size: 2 }, config);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.cases.map((summary) => summary.newForename)).toEqual(["Cyd"]);
    expect(result.data).toMatchObject({ page: 2, size: 2, total: 3, totalPages: 2 });
  });

  it("should report a condition api cannot read as a validation failure against its position", async () => {
    const result = await listCases({ where: ["type:is:Adult", "nonsense:is:x"] }, config);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("validation");
    // Addressed to the position, because the parameter is repeated and only a position says which row.
    expect(result.error.fieldErrors?.map((error) => error.field)).toEqual(["where.1"]);
  });

  it("should put a search term on the wire as one q parameter beside the filter, and omit it when there is none", async () => {
    // Recorded off a server of its own rather than asserted through the mock's results: what this pins is the
    // URL, and an absent `q` must be absent rather than empty so api applies its own no-search behaviour.
    const urls: (string | undefined)[] = [];
    const recorder = await listen(
      createServer((req, res) => {
        urls.push(req.url);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ filter: "all", cases: [], page: 1, size: 25, total: 0, totalPages: 0 }));
      })
    );
    const recorderConfig = { baseUrl: recorder.url, timeoutMs: 2000 };

    try {
      await listCases({ filter: "open", q: "Smith" }, recorderConfig);
      await listCases({ filter: "open" }, recorderConfig);

      expect(urls).toEqual(["/caseworker/cases?filter=open&q=Smith", "/caseworker/cases?filter=open"]);
    } finally {
      await recorder.close();
    }
  });
});

describe("notes", () => {
  it("should create, read back and patch a note", async () => {
    const id = await caseId();

    const created = await createNote(id, "  A note about the case  ", config);
    if (!created.ok) throw new Error("note was not created");
    // api trims before storing, so the stored value is the trimmed one.
    expect(created.data.note).toBe("A note about the case");

    const read = await getNote(id, created.data.id, config);
    expect(read.ok && read.data.note).toBe("A note about the case");

    const patched = await patchNote(id, created.data.id, "Amended", config);
    expect(patched.ok && patched.data.note).toBe("Amended");
  });

  it("should refuse an empty note", async () => {
    const id = await caseId();

    const result = await createNote(id, "", config);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("validation");
  });

  it("should delete a note and report it gone afterwards", async () => {
    const id = await caseId();
    const created = await createNote(id, "To be deleted", config);
    if (!created.ok) throw new Error("note was not created");

    const deleted = await deleteNote(id, created.data.id, config);

    expect(deleted).toEqual({ ok: true, data: undefined });
    const remaining = await listNotes(id, config);
    expect(remaining.ok && remaining.data).toEqual([]);
  });

  it("should report not-found when deleting a note that is not there", async () => {
    const id = await caseId();

    const result = await deleteNote(id, "00000000-0000-0000-0000-000000000000", config);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("not-found");
  });
});

describe("witnesses", () => {
  it("should create, read back and patch a witness", async () => {
    const id = await caseId();

    const created = await createWitness(id, WITNESS, config);
    if (!created.ok) throw new Error("witness was not created");
    expect(created.data).toMatchObject(WITNESS);

    const read = await getWitness(id, created.data.id, config);
    expect(read.ok && read.data.witnessName).toBe("Alex Witness");

    const patched = await updateWitness(id, created.data.id, { witnessOccupation: "Retired baker" }, config);
    expect(patched.ok && patched.data).toMatchObject({ witnessName: "Alex Witness", witnessOccupation: "Retired baker" });
  });

  it("should store a witness untrimmed, unlike a note, because api does not trim one", async () => {
    const id = await caseId();

    const created = await createWitness(id, { ...WITNESS, witnessName: "  Alex Witness  " }, config);

    expect(created.ok && created.data.witnessName).toBe("  Alex Witness  ");
  });

  it("should leave a field the patch does not mention alone", async () => {
    const id = await caseId();
    const created = await createWitness(id, { ...WITNESS, declarant: true }, config);
    if (!created.ok) throw new Error("witness was not created");

    const patched = await updateWitness(id, created.data.id, {}, config);

    expect(patched.ok && patched.data).toMatchObject({ witnessName: "Alex Witness", declarant: true });
  });

  it("should list a case's witnesses, and carry them on the case as well", async () => {
    const id = await caseId();
    await createWitness(id, WITNESS, config);
    await createWitness(id, { ...WITNESS, witnessName: "Sam Declarant", declarant: true }, config);

    const listed = await listWitnesses(id, config);

    // Oldest first, which is the order the detail page's subgrid renders them in.
    expect(listed.ok && listed.data.map((witness) => witness.witnessName)).toEqual(["Alex Witness", "Sam Declarant"]);
    const found = await getCase(id, config);
    expect(found.ok && found.data.witnesses.map((witness) => witness.witnessName)).toEqual(["Alex Witness", "Sam Declarant"]);
  });

  it("should refuse a name over its cap as a validation failure attributed to the field", async () => {
    const id = await caseId();

    const result = await createWitness(id, { ...WITNESS, witnessName: "x".repeat(101) }, config);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("validation");
    expect(result.error.fieldErrors?.map((error) => error.field)).toEqual(["witnessName"]);
  });

  it("should report not-found for a witness id belonging to another case", async () => {
    const owning = await caseId();
    const other = await caseId();
    const created = await createWitness(owning, WITNESS, config);
    if (!created.ok) throw new Error("witness was not created");

    const read = await getWitness(other, created.data.id, config);
    const patched = await updateWitness(other, created.data.id, { witnessOccupation: "Baker" }, config);

    expect(read.ok).toBe(false);
    expect(!read.ok && read.error.kind).toBe("not-found");
    expect(!patched.ok && patched.error.kind).toBe("not-found");
  });

  it("should delete a witness and leave the case's other witnesses in place", async () => {
    const id = await caseId();
    const doomed = await createWitness(id, WITNESS, config);
    await createWitness(id, { ...WITNESS, witnessName: "Sam Declarant", declarant: true }, config);
    if (!doomed.ok) throw new Error("witness was not created");

    const deleted = await deleteWitness(id, doomed.data.id, config);

    expect(deleted).toEqual({ ok: true, data: undefined });
    const remaining = await listWitnesses(id, config);
    expect(remaining.ok && remaining.data.map((witness) => witness.witnessName)).toEqual(["Sam Declarant"]);
  });

  it("should report not-found when deleting a witness twice, because absence is api's 404 rather than a no-op", async () => {
    const id = await caseId();
    const created = await createWitness(id, WITNESS, config);
    if (!created.ok) throw new Error("witness was not created");
    await deleteWitness(id, created.data.id, config);

    const again = await deleteWitness(id, created.data.id, config);

    expect(again.ok).toBe(false);
    expect(!again.ok && again.error.kind).toBe("not-found");
  });

  it("should report not-found when deleting through the wrong case, leaving the witness where it is", async () => {
    const owning = await caseId();
    const other = await caseId();
    const created = await createWitness(owning, WITNESS, config);
    if (!created.ok) throw new Error("witness was not created");

    const deleted = await deleteWitness(other, created.data.id, config);

    expect(deleted.ok).toBe(false);
    expect(!deleted.ok && deleted.error.kind).toBe("not-found");
    const remaining = await listWitnesses(owning, config);
    expect(remaining.ok && remaining.data).toHaveLength(1);
  });
});

describe("documents", () => {
  it("should forward a file's name, type and exact byte count", async () => {
    const id = await caseId();
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0d, 0x0a, 0x00, 0xff]);

    const result = await uploadDocument(id, { documentTypeId: DOCUMENT_TYPE_ID, name: "birth-certificate.pdf", mimeType: "application/pdf", bytes }, config);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.originalName).toBe("birth-certificate.pdf");
    expect(result.data.mimeType).toBe("application/pdf");
    // The whole point of a byte count: a body mangled in transit reports a different one.
    expect(result.data.sizeBytes).toBe(bytes.length);
    expect(result.data.hasFile).toBe(true);
    expect(result.data.documentType?.name).toBe("Birth certificate");
  });

  it("should default the direction to Incoming and the row name to the file's", async () => {
    const id = await caseId();

    const result = await uploadDocument(
      id,
      { documentTypeId: DOCUMENT_TYPE_ID, name: "scan.png", mimeType: "image/png", bytes: new Uint8Array([1, 2, 3]) },
      config
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.direction).toBe("Incoming");
    expect(result.data.name).toBe("scan.png");
  });

  it("should report not-found for a document type that does not exist", async () => {
    const id = await caseId();

    const result = await uploadDocument(
      id,
      { documentTypeId: "00000000-0000-0000-0000-000000000000", name: "x.pdf", mimeType: "application/pdf", bytes: new Uint8Array([1]) },
      config
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("not-found");
  });

  it("should stream a document's bytes back unchanged, with the headers api set", async () => {
    const id = await caseId();
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x0d, 0x0a]);
    const uploaded = await uploadDocument(id, { documentTypeId: DOCUMENT_TYPE_ID, name: "scan.png", mimeType: "image/png", bytes }, config);
    if (!uploaded.ok) throw new Error("document was not uploaded");

    const result = await downloadDocument(id, uploaded.data.id, config);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.contentType).toBe("image/png");
    expect(result.data.contentDisposition).toContain("scan.png");
    expect(new Uint8Array(await new Response(result.data.body).arrayBuffer())).toEqual(bytes);
  });

  it("should carry api's inline disposition together with the policy that makes it safe to honour", async () => {
    // A PNG is on api's inline allowlist, and a caller that forwarded the disposition without the policy
    // would render a member of the public's upload in its own origin. Both headers or neither.
    const id = await caseId();
    const uploaded = await uploadDocument(
      id,
      { documentTypeId: DOCUMENT_TYPE_ID, name: "scan.png", mimeType: "image/png", bytes: new Uint8Array([1]) },
      config
    );
    if (!uploaded.ok) throw new Error("document was not uploaded");

    const result = await downloadDocument(id, uploaded.data.id, config);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.contentDisposition).toMatch(/^inline;/);
    expect(result.data.contentSecurityPolicy).toBe("default-src 'none'; sandbox");
    expect(result.data.contentTypeOptions).toBe("nosniff");
  });

  it("should carry an attachment disposition for a type nothing renders, which is api's narrower list", async () => {
    const id = await caseId();
    const uploaded = await uploadDocument(
      id,
      { documentTypeId: DOCUMENT_TYPE_ID, name: "scan.tif", mimeType: "image/tiff", bytes: new Uint8Array([1]) },
      config
    );
    if (!uploaded.ok) throw new Error("document was not uploaded");

    const result = await downloadDocument(id, uploaded.data.id, config);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.contentDisposition).toMatch(/^attachment;/);
  });

  it("should list the document types api serves", async () => {
    const result = await listDocumentTypes(config);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.map((type) => type.name)).toContain("Birth certificate");
  });
});

describe("referrals", () => {
  it("should raise a referral Open and unclaimed, with its dates as Date objects", async () => {
    const id = await caseId();

    const result = await createReferral(id, { reasons: ["Minor"], notes: "For the Master" }, config);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Neither the state nor a holder is the caseworker's to choose, and api defaults an absent urgency to
    // Normal rather than storing none.
    expect(result.data).toMatchObject({ state: "Open", reasons: ["Minor"], notes: "For the Master", urgency: "Normal", migrated: false, claimedBy: null });
    expect(result.data.createdOn).toBeInstanceOf(Date);
  });

  it("should list every referral a case has had, not only the live one, and read one back by id", async () => {
    const id = await caseId();
    const withdrawn = await referralOn(id);
    await withdrawReferral(id, withdrawn, config);
    const live = await referralOn(id, { reasons: ["Other"], notes: "Unusual circumstances" });

    const listed = await listReferrals(id, config);

    // The set rather than the order: newest-first is the mock's, pinned in `server.test.ts` against referrals
    // whose `createdOn` is arranged, where two creates a round trip apart can share a millisecond.
    expect(listed.ok && [...listed.data].map((referral) => referral.id).sort()).toEqual([withdrawn, live].sort());
    const read = await getReferral(id, live, config);
    expect(read.ok && read.data.notes).toBe("Unusual circumstances");
  });

  it("should report conflict when the case already has a referral in play, because a second one is a state", async () => {
    const id = await caseId();
    await referralOn(id);

    const result = await createReferral(id, { reasons: ["DomesticAbuse"] }, config);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("conflict");
    expect(result.error.status).toBe(409);
  });

  it("should report api's conditional requirement against the field the create form renders it on", async () => {
    const id = await caseId();

    const result = await createReferral(id, { reasons: ["Other"] }, config);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("validation");
    expect(result.error.fieldErrors?.map((error) => error.field)).toEqual(["notes"]);
  });

  it("should report an empty reasons array as a validation failure, since a referral states why", async () => {
    const id = await caseId();

    const result = await createReferral(id, { reasons: [] }, config);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("validation");
    expect(result.error.fieldErrors?.map((error) => error.field)).toContain("reasons");
  });

  it("should report not-found for a referral read through the wrong case", async () => {
    const owning = await caseId();
    const other = await caseId();
    const referralId = await referralOn(owning);

    const result = await getReferral(other, referralId, config);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("not-found");
  });

  it("should withdraw a referral and leave the case with no current referral state", async () => {
    const id = await caseId();
    const referralId = await referralOn(id);
    const referred = await getCase(id, config);
    expect(referred.ok && referred.data.currentReferralState).toBe("Open");

    const result = await withdrawReferral(id, referralId, config);

    expect(result.ok && result.data.state).toBe("Withdrawn");
    // Recomputed from the referrals rather than pushed: withdrawal is terminal, so the case holds none.
    const after = await getCase(id, config);
    expect(after.ok && after.data.currentReferralState).toBe(null);
  });

  it("should carry the live referral's state onto the case list row as well as the case", async () => {
    const id = await caseId();
    await referralOn(id);

    const result = await listCases({}, config);

    expect(result.ok && result.data.cases.map((summary) => summary.currentReferralState)).toEqual(["Open"]);
  });

  it("should report conflict when withdrawing a referral that is already terminal", async () => {
    const id = await caseId();
    const referralId = await referralOn(id);
    await withdrawReferral(id, referralId, config);

    const result = await withdrawReferral(id, referralId, config);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("conflict");
  });

  it("should report conflict when withdrawing a referral a judge has already directed", async () => {
    // api's `canBeWithdrawn()` and not the negation of `isTerminal()`: a Decided referral is still the case's
    // live one, so it stays non-terminal, and withdrawal is refused because the direction on it has to be
    // actioned and the referral closed instead.
    const { caseId: id, referralId } = await decidedReferral();

    const result = await withdrawReferral(id, referralId, config);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("conflict");
    // Still Decided afterwards, so the refusal left the direction where the judge put it.
    const after = await getReferral(id, referralId, config);
    expect(after.ok && after.data.state).toBe("Decided");
  });

  it("should close a referral once a judge has directed it, and clear the case's state with it", async () => {
    const { caseId: id, referralId } = await decidedReferral();

    const result = await closeReferral(id, referralId, config);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The direction survives the close: closing records that the office actioned it, not that it is undone.
    expect(result.data).toMatchObject({ state: "Closed", decision: "Approved", publishToGazette: true });
    const after = await getCase(id, config);
    expect(after.ok && after.data.currentReferralState).toBe(null);
  });

  it("should report conflict when closing a referral no judge has directed", async () => {
    const id = await caseId();
    const referralId = await referralOn(id);

    const result = await closeReferral(id, referralId, config);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("conflict");
  });
});

describe("emails", () => {
  it("should answer the whole tab in one call: availability, history and slot defaults", async () => {
    const { caseId: id } = await refusedCase();

    const result = await getCaseEmails(id, config);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // One request for three things, which is why no page here needs a second call — and the slot metadata is
    // what a compose form is built from, so it arrives with the availability rather than on demand.
    expect(result.data.availability).toEqual([
      {
        template: "application-rejected",
        applicable: true,
        // Null when it applies: `reason` answers only "why can I not send this".
        reason: null,
        provisioned: true,
        slots: [
          { name: "judges_reason", required: true, maxLength: 4000 },
          { name: "additional_notes", required: false, maxLength: 1000 }
        ]
      }
    ]);
    // The judge's own words, so the compose page opens populated without spending a Notify call on a preview.
    expect(result.data.slotDefaults).toEqual([{ template: "application-rejected", fields: { judges_reason: JUDGES_REASON, additional_notes: "" } }]);
    expect(result.data.history).toEqual([]);
  });

  it("should say why an email does not apply rather than leaving it off the list", async () => {
    // A case nobody has refused. Answering with an empty list would leave a caseworker asking a person why the
    // refusal letter is not there.
    const id = await caseId({ applicantEmail: "applicant@example.com" });

    const result = await getCaseEmails(id, config);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.availability[0]).toMatchObject({ applicable: false, reason: expect.stringContaining("no referral that a Master has refused") });
    // No defaults for an email that cannot be sent: they would be values resolved from a referral there is none of.
    expect(result.data.slotDefaults).toEqual([]);
  });

  it("should report not-found for a case that does not exist, rather than an empty tab", async () => {
    const result = await getCaseEmails(randomUUID(), config);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("not-found");
  });

  it("should render a preview carrying the caseworker's own text, as HTML", async () => {
    const { caseId: id } = await refusedCase();

    const result = await previewEmail(id, "application-rejected", { judges_reason: "Identity not established", additional_notes: "Ring first" }, config);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.html).toContain("Identity not established");
    expect(result.data.html).toContain("Ring first");
    expect(result.data.subject).toMatch(/./);
    expect(result.data.templateVersion).toBeTypeOf("number");
  });

  it("should pre-populate the judge's reason from the referral when the body omits it", async () => {
    const { caseId: id } = await refusedCase();

    // An empty body is legitimate on both write bodies precisely because of this.
    const result = await previewEmail(id, "application-rejected", {}, config);

    expect(result.ok && result.data.html).toContain(JUDGES_REASON);
  });

  it("should report conflict when the case is in no state to send, rather than throwing", async () => {
    const id = await caseId({ applicantEmail: "applicant@example.com" });

    const result = await previewEmail(id, "application-rejected", { judges_reason: "Because" }, config);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // A state and not a malformed body: the same request succeeds unchanged once a Master has refused.
    expect(result.error.kind).toBe("conflict");
    expect(result.error.status).toBe(409);
  });

  it("should report not-found for a template key api does not serve", async () => {
    const { caseId: id } = await refusedCase();

    const result = await previewEmail(id, "application-approved", { judges_reason: "Because" }, config);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // 404 rather than 400: the key is a path segment, so an unknown one is a path nothing is served at. The
    // template reaches these functions from a URL, which is why it is not narrowed to a union in TypeScript.
    expect(result.error.kind).toBe("not-found");
    expect(result.error.message).toContain("application-rejected");
  });

  it("should send the email and leave it in the history with what was sent", async () => {
    const { caseId: id } = await refusedCase();

    const result = await sendEmail(id, "application-rejected", { judges_reason: "Identity not established" }, config);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({ recipient: "applicant@example.com", enqueued: true });
    const after = await getCaseEmails(id, config);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.data.history).toHaveLength(1);
    expect(after.data.history[0]).toMatchObject({
      id: result.data.id,
      template: "application-rejected",
      templateName: "Application rejected",
      notifyState: "Sent",
      failureReason: null,
      // The stored rendering is PLAIN TEXT where the preview is HTML — two renderings of one template, which is
      // why the history must never reach the preview's iframe.
      body: expect.stringContaining("Identity not established"),
      documents: []
    });
    expect(after.data.history[0].body).not.toContain("<p>");
    expect(after.data.history[0].createdOn).toBeInstanceOf(Date);
  });

  it("should answer a redundant second send with the first email's id and enqueued false, not a conflict", async () => {
    // The whole of api's double-send protection, and it is a SUCCESS: a caseworker told their email failed
    // would try a third time. There is no idempotency key on the wire — the unique index is the mechanism.
    const { caseId: id } = await refusedCase();
    const first = await sendEmail(id, "application-rejected", { judges_reason: "Identity not established" }, config);

    const second = await sendEmail(id, "application-rejected", { judges_reason: "Changed my mind" }, config);

    expect(second.ok).toBe(true);
    if (!second.ok || !first.ok) return;
    expect(second.data).toEqual({ id: first.data.id, recipient: "applicant@example.com", enqueued: false });
    const after = await getCaseEmails(id, config);
    expect(after.ok && after.data.history).toHaveLength(1);
  });

  it("should report a case with no email address as a validation failure against applicantEmail", async () => {
    const { caseId: id } = await refusedCase({ applicantEmail: "   " });

    const result = await sendEmail(id, "application-rejected", { judges_reason: "Identity not established" }, config);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // 422, classified with the 400s: the case is missing a value, which is not a service failure — and the
    // column is named so the tab can say whose address is missing rather than showing the 500 page.
    expect(result.error.kind).toBe("validation");
    expect(result.error.status).toBe(422);
    expect(result.error.fieldErrors?.map((error) => error.field)).toEqual(["applicantEmail"]);
  });

  it("should report every offending slot at once, addressed to the slot", async () => {
    const { caseId: id } = await refusedCase();

    const result = await sendEmail(
      id,
      "application-rejected",
      // Over-long, and a key api resolves from the case rather than accepting. Cast because the wire type has
      // no way to express the second: the point is what api answers if one ever reaches it.
      { judges_reason: "x".repeat(4001), reference_number: "KBDP2026-99999" } as never,
      config
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("validation");
    // Both, in one answer: a refusal per round trip is what this saves the caseworker.
    expect(result.error.fieldErrors?.map((error) => error.field).sort()).toEqual(["judges_reason", "reference_number"]);
    expect(result.error.fieldErrors?.find((error) => error.field === "reference_number")?.message).toContain("resolved from the case");
  });

  it("should report invalid-response when a send answers a body that breaks the contract", async () => {
    // `enqueued` absent from a 200 would make a redundant send indistinguishable from a real one, which is the
    // only thing that response is for.
    const liar = await listen(
      createServer((_req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: randomUUID(), recipient: "applicant@example.com" }));
      })
    );

    try {
      const result = await sendEmail("abc", "application-rejected", {}, { baseUrl: liar.url, timeoutMs: 2000 });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("invalid-response");
      expect(result.error.message).toContain("enqueued");
    } finally {
      await liar.close();
    }
  });
});

describe("saved queries", () => {
  const A_QUERY = { name: "Enroled this month", conditions: ["state:is:Enroled"], filter: "enroled", sortDirection: "desc" } as const;

  it("should create, list, read back and patch a saved query", async () => {
    const created = await createSavedQuery({ ...A_QUERY, description: "For the monthly count" }, config);
    if (!created.ok) throw new Error("saved query was not created");
    expect(created.data).toMatchObject({ name: "Enroled this month", conditions: ["state:is:Enroled"], filter: "enroled" });

    const listed = await listSavedQueries(config);
    expect(listed.ok && listed.data.map((query) => query.name)).toEqual(["Enroled this month"]);

    const read = await getSavedQuery(created.data.id, config);
    expect(read.ok && read.data.description).toBe("For the monthly count");

    const patched = await patchSavedQuery(created.data.id, { name: "Enroled recently" }, config);
    expect(patched.ok && patched.data.name).toBe("Enroled recently");
    // The patch named one field, so the rest is left as stored rather than cleared.
    expect(patched.ok && patched.data.conditions).toEqual(["state:is:Enroled"]);
  });

  it("should clear a column on an explicit null, which is what distinguishes this patch from a note's", async () => {
    const created = await createSavedQuery({ name: "With a description", description: "To be cleared" }, config);
    if (!created.ok) throw new Error("saved query was not created");

    const patched = await patchSavedQuery(created.data.id, { description: null }, config);

    expect(patched.ok && patched.data.description).toBe(null);
  });

  it("should return an unnarrowed query's conditions as an empty array rather than null", async () => {
    // "Everything, newest first" is a view somebody wants a tab for, and a page that maps over `conditions`
    // must not have to guard for null.
    const created = await createSavedQuery({ name: "Everything" }, config);

    expect(created.ok && created.data.conditions).toEqual([]);
  });

  it("should refuse a name over api's hundred characters", async () => {
    const result = await createSavedQuery({ name: "x".repeat(101) }, config);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("validation");
  });

  it("should select and deselect a query, reporting the flag api derives", async () => {
    const created = await createSavedQuery(A_QUERY, config);
    if (!created.ok) throw new Error("saved query was not created");
    // Not selected by its creation: a page that wants it in the caller's list says so.
    expect(created.data.selected).toBe(false);

    expect(await selectSavedQuery(created.data.id, config)).toEqual({ ok: true, data: undefined });
    const afterSelect = await getSavedQuery(created.data.id, config);
    expect(afterSelect.ok && afterSelect.data.selected).toBe(true);

    expect(await deselectSavedQuery(created.data.id, config)).toEqual({ ok: true, data: undefined });
    const afterDeselect = await getSavedQuery(created.data.id, config);
    expect(afterDeselect.ok && afterDeselect.data.selected).toBe(false);
  });

  it("should select idempotently, so a retried request is never told it has a duplicate", async () => {
    const created = await createSavedQuery(A_QUERY, config);
    if (!created.ok) throw new Error("saved query was not created");

    await selectSavedQuery(created.data.id, config);
    const again = await selectSavedQuery(created.data.id, config);

    expect(again).toEqual({ ok: true, data: undefined });
  });

  it("should deselect a query it cannot see, so a stale selection is always clearable", async () => {
    // api's deliberate asymmetry with the `PUT`: the selection row is keyed by the caller, so requiring
    // visibility would trap a subscriber holding a selection for a query its owner has since unshared.
    const result = await deselectSavedQuery("00000000-0000-0000-0000-000000000000", config);

    expect(result).toEqual({ ok: true, data: undefined });
  });

  it("should report not-found when selecting a query that is not there, so no id is discoverable", async () => {
    const result = await selectSavedQuery("00000000-0000-0000-0000-000000000000", config);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("not-found");
  });

  it("should delete a query and report it gone afterwards", async () => {
    const created = await createSavedQuery(A_QUERY, config);
    if (!created.ok) throw new Error("saved query was not created");

    const deleted = await deleteSavedQuery(created.data.id, config);

    expect(deleted).toEqual({ ok: true, data: undefined });
    const listed = await listSavedQueries(config);
    expect(listed.ok && listed.data).toEqual([]);
    const read = await getSavedQuery(created.data.id, config);
    expect(read.ok).toBe(false);
  });

  it("should report not-found when reading a query that is not there", async () => {
    const result = await getSavedQuery("00000000-0000-0000-0000-000000000000", config);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("not-found");
  });
});

/**
 * The four judicial operations, which have no caller in this app until the judicial screen is built.
 *
 * A judge is the token's subject here, because that is what the mock reads and what api's `claimedBy` holds.
 * The `caseworker-deedpoll-judicial` role gate is api's and is not arranged: nothing in this adapter differs
 * with a role, so there is nothing here it could pin.
 */
describe("the judicial surface", () => {
  const JUDGE = "judge.a@example.com";
  const ANOTHER_JUDGE = "judge.b@example.com";

  it("should offer the Open referrals of every case in one shared pool, urgent first", async () => {
    await referralOn(await caseId(), { reasons: ["Minor"] });
    const urgent = await referralOn(await caseId(), { reasons: ["DomesticAbuse"], urgency: "Urgent", urgencyReason: "Risk to the applicant" });

    const result = await getJudicialPool({}, judge(JUDGE));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.referrals[0]?.id).toBe(urgent);
    // Ten rather than the case list's twenty-five, and a page size rather than a cap — `total` says how much
    // work is waiting behind the page.
    expect(result.data).toMatchObject({ page: 1, size: 10, total: 2, totalPages: 1 });
  });

  it("should page the pool, reporting the whole pool's total rather than the page's", async () => {
    await referralOn(await caseId());
    await referralOn(await caseId());

    const result = await getJudicialPool({ page: 2, size: 1 }, judge(JUDGE));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.referrals).toHaveLength(1);
    expect(result.data).toMatchObject({ page: 2, size: 1, total: 2, totalPages: 2 });
  });

  it("should answer one referral with the narrow application view and the application's timeline", async () => {
    const id = await caseId({ newForename: "Jo", newSurname: "Bloggs" });
    await createNote(id, "Signature received", config);
    const referralId = await referralOn(id);

    const result = await getJudicialReferral(referralId, judge(JUDGE));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.application).toMatchObject({ newForename: "Jo", newSurname: "Bloggs" });
    // Newest first, and the raise's own note leads it: a referral writes onto the same timeline, which reaches a
    // judge unfiltered. The wording is api's `ReferralNotes` and is pinned in `mock/server.test.ts`.
    expect(result.data.caseNotes.map((note) => note.note)).toEqual([expect.stringContaining("Referred to the judiciary"), "Signature received"]);
    expect(result.data.caseNotes[0]?.createdOn).toBeInstanceOf(Date);
  });

  it("should report not-found for a referral another judge holds, so no referral is discoverable", async () => {
    const referralId = await referralOn(await caseId());
    await claimJudicialReferral(referralId, judge(JUDGE));

    const result = await getJudicialReferral(referralId, judge(ANOTHER_JUDGE));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("not-found");
  });

  it("should claim a referral out of the pool, recording the holder from the token", async () => {
    const referralId = await referralOn(await caseId());

    const result = await claimJudicialReferral(referralId, judge(JUDGE));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({ state: "Claimed", claimedBy: JUDGE });
    expect(result.data.claimedAt).toBeInstanceOf(Date);
    // Out of the pool as well as claimed: the pool is what the other judges are shown.
    const pool = await getJudicialPool({}, judge(ANOTHER_JUDGE));
    expect(pool.ok && pool.data.referrals).toEqual([]);
  });

  it("should report conflict when claiming a referral that is not Open, which is what a second judge gets", async () => {
    const referralId = await referralOn(await caseId());
    await claimJudicialReferral(referralId, judge(JUDGE));

    const result = await claimJudicialReferral(referralId, judge(JUDGE));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("conflict");
  });

  it("should record a direction on a referral this judge holds, stamping the decision date and the decider", async () => {
    const referralId = await referralOn(await caseId());
    await claimJudicialReferral(referralId, judge(JUDGE));

    const result = await directJudicialReferral(
      referralId,
      { decision: "Rejected", publishToGazette: false, directionsText: "Insufficient evidence" },
      judge(JUDGE)
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      state: "Decided",
      decision: "Rejected",
      publishToGazette: false,
      directionsText: "Insufficient evidence",
      decidedBy: JUDGE
    });
    expect(result.data.decisionDate).toBeInstanceOf(Date);
  });

  it("should report conflict for a direction on a referral this judge can see but does not hold", async () => {
    // An Open referral is in the pool, so it is visible — and directing one nobody has claimed is the
    // conflict, not a 404.
    const referralId = await referralOn(await caseId());

    const result = await directJudicialReferral(referralId, { decision: "Approved", publishToGazette: true }, judge(JUDGE));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("conflict");
  });

  it("should report not-found for a direction on a referral claimed by another judge, not conflict", async () => {
    // The visibility check runs first, so a referral this judge may not see is absent rather than contested —
    // otherwise a 409 would tell them somebody else holds it.
    const referralId = await referralOn(await caseId());
    await claimJudicialReferral(referralId, judge(JUDGE));

    const result = await directJudicialReferral(referralId, { decision: "Approved", publishToGazette: true }, judge(ANOTHER_JUDGE));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("not-found");
  });

  it("should report a decision api does not publish as a validation failure against the field", async () => {
    const referralId = await referralOn(await caseId());
    await claimJudicialReferral(referralId, judge(JUDGE));

    const result = await directJudicialReferral(referralId, { decision: "Maybe" as never, publishToGazette: true }, judge(JUDGE));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("validation");
    expect(result.error.fieldErrors?.map((error) => error.field)).toContain("decision");
  });
});

describe("checkApiReachable", () => {
  it("should succeed while api answers", async () => {
    expect(await checkApiReachable(config)).toEqual({ ok: true, data: undefined });
  });

  it("should fail when nothing is listening, which is what makes it worth probing", async () => {
    const result = await checkApiReachable({ baseUrl: "http://localhost:1", timeoutMs: 500 });

    expect(result.ok).toBe(false);
  });
});

describe("when api is unavailable", () => {
  it("should report unavailable for a 503, not a validation failure", async () => {
    mock.setScenario("api-unavailable");

    const result = await createCase({ dateReceived: DATE_RECEIVED }, config);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("unavailable");
    expect(result.error.status).toBe(503);
  });

  it("should make reads unavailable too, so the scenario is a realistic outage", async () => {
    const id = await caseId();
    mock.setScenario("api-unavailable");

    const result = await getCase(id, config);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("unavailable");
  });

  it("should report unavailable when the connection is refused", async () => {
    // Port 1 is privileged and nothing is listening: a refused connection rather than a status code.
    const result = await listCases({}, { baseUrl: "http://localhost:1", timeoutMs: 2000 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("unavailable");
    expect(result.error.status).toBeUndefined();
  });

  it("should report a timeout, distinctly from unavailable, when api never answers", async () => {
    const silent = await listen(createServer(() => {}));

    try {
      const result = await listCases({}, { baseUrl: silent.url, timeoutMs: 50 });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("timeout");
    } finally {
      await silent.close();
    }
  });

  it("should time out a JSON call that gets headers and then stalls, because its body is read here", async () => {
    const stalling = await listen(
      createServer((_req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.write('{"filter":"all","cases":');
        // Never finished, so the body read is what has to be bounded rather than the connect.
      })
    );

    try {
      const result = await listCases({}, { baseUrl: stalling.url, timeoutMs: 100 });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("timeout");
    } finally {
      await stalling.close();
    }
  });

  it("should never throw, whatever the failure", async () => {
    // The property the whole `ApiResult` shape exists for: a caseworker's half-filled form must not be
    // lost to an exception from the data layer.
    await expect(listCases({}, { baseUrl: "http://localhost:1", timeoutMs: 500 })).resolves.toMatchObject({ ok: false });
  });
});

describe("the upload's timeout, which is longer than the JSON default", () => {
  it("should still be bounded by a configured timeout, rather than by its own longer default", async () => {
    // The regression this guards: giving the upload more patience must not make it ignore the environment's
    // figure. `DEED_POLL_API_TIMEOUT_MS` is one number an operator sets, and an upload that outlived it
    // would hold a pod's worker on a request nobody bounded.
    const silent = await listen(createServer(() => {}));

    try {
      const result = await uploadDocument(
        "case-1",
        { documentTypeId: DOCUMENT_TYPE_ID, name: "scan.pdf", mimeType: "application/pdf", bytes: new Uint8Array([1]) },
        { baseUrl: silent.url, timeoutMs: 50 }
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("timeout");
    } finally {
      await silent.close();
    }
  });

  it("should not apply the ten-second JSON default to an upload that no config bounds", async () => {
    // Sent with no `timeoutMs` at all, so `UPLOAD_TIMEOUT_MS` is what governs. A server that answers after
    // longer than a full-size upload plausibly needs cannot be waited on in a unit test, so what is pinned
    // is the observable half: the call is not cut short at the JSON default. The reasoning for the figure
    // itself is at the constant.
    const answering = await listen(
      createServer((_req, res) => {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "answered late but well inside the upload's patience" }));
      })
    );

    try {
      const result = await uploadDocument(
        "case-1",
        { documentTypeId: DOCUMENT_TYPE_ID, name: "scan.pdf", mimeType: "application/pdf", bytes: new Uint8Array([1]) },
        { baseUrl: answering.url }
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      // A classified 400 rather than a timeout: the request completed on the upload's clock.
      expect(result.error.kind).toBe("validation");
    } finally {
      await answering.close();
    }
  });
});

/**
 * The figures the two streaming tests below share, sized for headroom rather than for speed.
 *
 * They were `timeoutMs: 60` against a server dripping every 20ms, which fails for a reason that has nothing
 * to do with the code under test: the FIRST connection to a fresh `localhost` port costs ~75ms here for DNS
 * and pool warm-up, so the answer missed a 60ms budget whenever an earlier test had not already paid that
 * cost. Run as a whole file it passed on a warm resolver; run alone — or on a loaded machine — it failed on
 * the `result.ok` assertion, which reads as a download bug and is not one.
 *
 * So the timeout has to clear cold-connect latency by a wide margin, while the two properties being pinned
 * still hold: one inter-chunk gap must sit well UNDER it (or a slow trickle would be mistaken for a stall),
 * and the whole transfer must run well OVER it (or the test would pass even if the timeout did bound the
 * body, which is the regression it exists to catch). 200ms against 20ms gaps and a ~400ms transfer gives
 * every one of those a factor of at least two.
 */
const STREAM_TIMEOUT_MS = 200;
const DRIP_INTERVAL_MS = 20;
const DRIP_CHUNKS = 20;

describe("the download's timeout, which covers the answer and not the body", () => {
  it("should still time out when api never answers the download at all", async () => {
    const silent = await listen(createServer(() => {}));

    try {
      const result = await downloadDocument("case-1", "doc-1", { baseUrl: silent.url, timeoutMs: 50 });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("timeout");
    } finally {
      await silent.close();
    }
  });

  it("should deliver a body that takes longer than the timeout to arrive, rather than truncating it", async () => {
    // The regression this guards: an `AbortSignal` is not scoped to the headers, so a single whole-exchange
    // timeout fires mid-body on a large download. The response has already gone out as a 200, so nothing
    // can be rendered about it — the caseworker just saves a corrupt file. 25 MB is an ordinary scan, and a
    // slow link delivers it as a trickle that outlasts any answer timeout.
    const dripping = await listen(
      createServer((_req, res) => {
        res.writeHead(200, { "content-type": "application/pdf" });
        // Flushed rather than left to the first `write`: `writeHead` queues the headers, so without this the
        // answer does not reach the client until the first chunk does, and the timeout under test would be
        // measuring the drip it is supposed to be indifferent to.
        res.flushHeaders();
        let sent = 0;
        const timer = setInterval(() => {
          sent += 1;
          if (sent < DRIP_CHUNKS) return res.write("chunk");
          clearInterval(timer);
          res.end("chunk");
        }, DRIP_INTERVAL_MS);
      })
    );

    try {
      const result = await downloadDocument("case-1", "doc-1", { baseUrl: dripping.url, timeoutMs: STREAM_TIMEOUT_MS });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      await expect(collect(result.data.body)).resolves.toBe("chunk".repeat(DRIP_CHUNKS));
    } finally {
      await dripping.close();
    }
  });

  it("should fail a body api stops sending, rather than holding the connection open or ending it short", async () => {
    // The other half of the same rule. Without a per-read bound the transfer is unbounded — api's socket and
    // the caseworker's response both stay open on Node's five-minute default — and cancelling the read
    // instead of erroring would end the stream cleanly, which serves a truncated document under the 200
    // that has already gone out.
    const stalling = await listen(
      createServer((_req, res) => {
        res.writeHead(200, { "content-type": "application/pdf" });
        res.write("first");
        // Never finished, so the read is what has to be bounded.
      })
    );

    try {
      const result = await downloadDocument("case-1", "doc-1", { baseUrl: stalling.url, timeoutMs: STREAM_TIMEOUT_MS });

      // The headers arrived, so the call itself succeeded — the failure belongs to the stream.
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      await expect(collect(result.data.body)).rejects.toMatchObject({ name: "TimeoutError" });
    } finally {
      await stalling.close();
    }
  });
});

describe("when api answers a status the contract does not describe", () => {
  it("should map 401 and 403 apart, so an expired token is not read as a missing role", async () => {
    for (const [status, kind] of [
      [401, "unauthorized"],
      [403, "forbidden"],
      [409, "conflict"],
      // A refused upload is the caseworker's input, so it must reach a form rather than the 500 page.
      [413, "validation"],
      [415, "validation"],
      [418, "unknown"]
    ] as const) {
      const answering = await listen(
        createServer((_req, res) => {
          res.writeHead(status, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: `answered ${status}` }));
        })
      );

      try {
        const result = await listCases({}, { baseUrl: answering.url, timeoutMs: 2000 });

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.kind, `status ${status}`).toBe(kind);
        expect(result.error.message).toBe(`answered ${status}`);
      } finally {
        await answering.close();
      }
    }
  });

  it("should still classify a failure whose body is not api's JSON", async () => {
    // An unavailable api often answers with a proxy's HTML, which must not turn a 503 into a crash.
    const proxy = await listen(
      createServer((_req, res) => {
        res.writeHead(503, { "content-type": "text/html" });
        res.end("<html><body>502 Bad Gateway</body></html>");
      })
    );

    try {
      const result = await listCases({}, { baseUrl: proxy.url, timeoutMs: 2000 });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("unavailable");
      expect(result.error.message).toBe("deed-poll-api answered 503");
    } finally {
      await proxy.close();
    }
  });
});

describe("when api answers 2xx with a body that breaks the contract", () => {
  it("should report invalid-response rather than passing the body on", async () => {
    // The failure this prevents: `id` absent from a 200, reaching a case link as the string "undefined".
    const liar = await listen(
      createServer((_req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ displayReference: "KBDP2026-00001" }));
      })
    );

    try {
      const result = await getCase("abc", { baseUrl: liar.url, timeoutMs: 2000 });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("invalid-response");
      expect(result.error.message).toContain("id");
    } finally {
      await liar.close();
    }
  });

  it("should report invalid-response for a body that is not JSON at all", async () => {
    const notJson = await listen(
      createServer((_req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end("not json");
      })
    );

    try {
      const result = await listCases({}, { baseUrl: notJson.url, timeoutMs: 2000 });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("invalid-response");
    } finally {
      await notJson.close();
    }
  });

  it("should report invalid-response for an enum member api does not publish", async () => {
    // A state added to api and not here would otherwise reach a label map and render as its raw name.
    const unknownState = await listen(
      createServer((_req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ filter: "all", cases: [{ id: "abc", state: "SomethingNew" }], page: 1, size: 25, total: 1, totalPages: 1 }));
      })
    );

    try {
      const result = await listCases({}, { baseUrl: unknownState.url, timeoutMs: 2000 });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe("invalid-response");
      expect(result.error.message).toContain("state");
    } finally {
      await unknownState.close();
    }
  });
});

describe("the bearer token", () => {
  it("should be presented on every call, because api authenticates all of them", async () => {
    const headers: (string | undefined)[] = [];
    const recorder = await listen(
      createServer((req, res) => {
        headers.push(req.headers.authorization);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ filter: "all", cases: [], page: 1, size: 25, total: 0, totalPages: 0 }));
      })
    );

    try {
      await listCases({}, { baseUrl: recorder.url, timeoutMs: 2000, accessToken: "a-token" });

      expect(headers).toEqual(["Bearer a-token"]);
    } finally {
      await recorder.close();
    }
  });
});

/** A saved case's id, created through the contract so it has a real reference number. */
async function caseId(patch: Parameters<typeof createCase>[0] = {}): Promise<string> {
  const created = await createCase({ dateReceived: DATE_RECEIVED, ...patch }, config);
  if (!created.ok) throw new Error(`case was not created: ${created.error.message}`);

  return created.data.id;
}

/**
 * A saved case with the two witnesses api's enrolment gate requires, so a patch that sets an enrolment date
 * is answered on its merits rather than refused for the shortfall — see `enrolmentWitnessError` in the mock.
 */
async function enrollableCaseId(): Promise<string> {
  const id = await caseId();

  for (const witness of [WITNESS, WITNESS]) {
    const created = await createWitness(id, witness, config);
    if (!created.ok) throw new Error(`witness was not created: ${created.error.message}`);
  }

  return id;
}

/** A referral raised over the contract, which is where every referral journey starts. */
async function referralOn(id: string, body: ReferralCreate = { reasons: ["Minor"] }): Promise<string> {
  const created = await createReferral(id, body, config);
  if (!created.ok) throw new Error(`referral was not created: ${created.error.message}`);

  return created.data.id;
}

/**
 * A referral a judge has directed, which is the only state a caseworker may close.
 *
 * Driven through the judicial surface rather than seeded, because the two halves are how a case reaches
 * `Decided` at all — a seeded state would let a close test pass over a transition api does not allow.
 */
async function decidedReferral(): Promise<{ caseId: string; referralId: string }> {
  const id = await caseId();
  const referralId = await referralOn(id);
  const judgeConfig = judge("judge.a@example.com");

  const claimed = await claimJudicialReferral(referralId, judgeConfig);
  if (!claimed.ok) throw new Error(`referral was not claimed: ${claimed.error.message}`);
  const directed = await directJudicialReferral(referralId, { decision: "Approved", publishToGazette: true }, judgeConfig);
  if (!directed.ok) throw new Error(`referral was not directed: ${directed.error.message}`);

  return { caseId: id, referralId };
}

/**
 * A case whose latest referral a Master has REFUSED, with an applicant to write to.
 *
 * Driven through the judicial surface rather than seeded, for the reason `decidedReferral` is: the refusal is
 * what makes the email applicable at all, so seeding one would let every email test pass over a transition api
 * does not allow.
 */
async function refusedCase(patch: Parameters<typeof createCase>[0] = {}): Promise<{ caseId: string; referralId: string }> {
  const id = await caseId({ applicantEmail: "applicant@example.com", oldForename: "Sam", oldSurname: "Smith", ...patch });
  const referralId = await referralOn(id);
  const judgeConfig = judge("judge.a@example.com");

  const claimed = await claimJudicialReferral(referralId, judgeConfig);
  if (!claimed.ok) throw new Error(`referral was not claimed: ${claimed.error.message}`);
  const directed = await directJudicialReferral(referralId, { decision: "Rejected", publishToGazette: false, directionsText: JUDGES_REASON }, judgeConfig);
  if (!directed.ok) throw new Error(`referral was not directed: ${directed.error.message}`);

  return { caseId: id, referralId };
}

/**
 * The same config with a named caller's token.
 *
 * The mock takes a name out of the token's subject and no roles, exactly as api takes the audit author from
 * it, so this is what tells one judge's claim from another's.
 */
function judge(subject: string): ApiConfig {
  return { ...config, accessToken: `x.${Buffer.from(JSON.stringify({ sub: subject }), "utf8").toString("base64url")}.signature` };
}

/**
 * A download body as text.
 *
 * Read chunk by chunk rather than through `new Response(...)`, so a stream that ERRORS mid-transfer rejects
 * here as itself: the point of the stall test is which failure arrives, and wrapping the body in a
 * `Response` classifies it as undici's own.
 */
async function collect(body: Readable): Promise<string> {
  let text = "";
  for await (const chunk of body) text += String(chunk);

  return text;
}

async function listen(server: Server): Promise<{ url: string; close: () => Promise<void> }> {
  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve());
  });
  const address = server.address();

  return {
    url: `http://localhost:${address && typeof address === "object" ? address.port : 0}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}
