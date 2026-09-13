/**
 * The adapter against the mock, over real HTTP.
 *
 * Not against `vi.fn()` stubs of `fetch`: the things worth testing here are the seams a stub would define
 * away — a multipart body a server can actually parse, a timeout that really fires, a connection that is
 * really refused, and a 2xx whose body does not match the contract.
 */
import { createServer, type Server } from "node:http";
import type { Readable } from "node:stream";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type RunningMockApi, startMockApi } from "../mock/server.js";
import {
  type ApiConfig,
  checkApiReachable,
  createCase,
  createNote,
  createWitness,
  deleteNote,
  deleteWitness,
  downloadDocument,
  getCase,
  getFieldRules,
  getNote,
  getWitness,
  listCases,
  listDocumentTypes,
  listNotes,
  listWitnesses,
  patchCase,
  patchNote,
  updateWitness,
  uploadDocument
} from "./client.js";

/** A create that succeeds: Date Received is the one field api cannot allocate a reference without. */
const DATE_RECEIVED = new Date("2026-03-10T00:00:00Z");

/** A document type the mock serves, so an upload can name one. */
const DOCUMENT_TYPE_ID = "11111111-1111-4111-8111-111111111111";

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
    const id = await caseId();

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

    const result = await listCases("nonsense", config);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.filter).toBe("all");
    expect(result.data.cases.length).toBeGreaterThan(0);
  });

  it("should exclude a finished case from the open filter", async () => {
    const id = await caseId();
    await patchCase(id, { dateEnroled: new Date("2026-04-01T00:00:00Z") }, config);

    const result = await listCases("open", config);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.cases.map((summary) => summary.id)).not.toContain(id);
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
    const result = await listCases(undefined, { baseUrl: "http://localhost:1", timeoutMs: 2000 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("unavailable");
    expect(result.error.status).toBeUndefined();
  });

  it("should report a timeout, distinctly from unavailable, when api never answers", async () => {
    const silent = await listen(createServer(() => {}));

    try {
      const result = await listCases(undefined, { baseUrl: silent.url, timeoutMs: 50 });

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
      const result = await listCases(undefined, { baseUrl: stalling.url, timeoutMs: 100 });

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
    await expect(listCases(undefined, { baseUrl: "http://localhost:1", timeoutMs: 500 })).resolves.toMatchObject({ ok: false });
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
        let sent = 0;
        const timer = setInterval(() => {
          sent += 1;
          if (sent < 8) return res.write("chunk");
          clearInterval(timer);
          res.end("chunk");
        }, 20);
      })
    );

    try {
      const result = await downloadDocument("case-1", "doc-1", { baseUrl: dripping.url, timeoutMs: 60 });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      await expect(collect(result.data.body)).resolves.toBe("chunk".repeat(8));
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
      const result = await downloadDocument("case-1", "doc-1", { baseUrl: stalling.url, timeoutMs: 60 });

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
        const result = await listCases(undefined, { baseUrl: answering.url, timeoutMs: 2000 });

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
      const result = await listCases(undefined, { baseUrl: proxy.url, timeoutMs: 2000 });

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
      const result = await listCases(undefined, { baseUrl: notJson.url, timeoutMs: 2000 });

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
        res.end(JSON.stringify({ filter: "all", cases: [{ id: "abc", state: "SomethingNew" }] }));
      })
    );

    try {
      const result = await listCases(undefined, { baseUrl: unknownState.url, timeoutMs: 2000 });

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
        res.end(JSON.stringify({ filter: "all", cases: [] }));
      })
    );

    try {
      await listCases(undefined, { baseUrl: recorder.url, timeoutMs: 2000, accessToken: "a-token" });

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
