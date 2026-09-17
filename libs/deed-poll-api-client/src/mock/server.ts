/**
 * A mock `deed-poll-api`, implementing its published caseworker surface in memory.
 *
 * It exists because api is not deployed, so without it neither `yarn dev` nor the e2e suite can reach a
 * case page. It is a stand-in for the CONTRACT, not a second implementation of api: there is no database,
 * no IDAM, no S2S and no document storage, and it forgets everything when it stops.
 *
 * Three routes are OUTSIDE the contract and exist only here, all under `/__mock` so no route in this file
 * could be mistaken for one api serves:
 *
 *   POST /__mock/scenario   switch behaviour (see fixtures.ts)
 *   POST /__mock/reset      forget every case
 *   POST /__mock/cases      seed a case without going through a create
 *
 * `GET /health` and `GET /health/liveness` are outside the contract too, so `yarn dev` and Playwright's
 * `webServer` have something to wait for — and so the readiness check task 5 adds has something to probe.
 * Both, because api's actuator serves both and `checkApiReachable` deliberately probes the liveness group.
 *
 * **Seven of api's rules are restated here, and only seven.** A mock that applied none of them would let a
 * page ship having never seen a real reference number or a derived state:
 *
 *   1. Reference-number allocation — the year from Date Received, the prefix from Type, a per-year serial.
 *   2. State derivation from the populated dates.
 *   3. The two cross-field date refusals.
 *   4. The per-type field-rule matrix.
 *   5. The audit author taken from the caller's token — see `auditName`.
 *   6. The two-witness gate on enrolment — see `enrolmentWitnessError`.
 *   7. The list query — the `where` conditions, the sort and the paging — see `list`. Without it a query
 *      builder could ship having narrowed nothing: every page and every e2e journey would see the same
 *      list whatever it asked for, which is the one thing about a query worth testing.
 *
 * They are restatements, and the authority is api's `DeedPollService`, `CaseStates`, `DeedPollValidation`,
 * `ReferenceNumbers`, `CaseQuery` and `IdamAuthenticationConverter` — not this file. Everything else api does (the
 * privacy lock, the minor and Gazette write gates, create-time defaults, the saved-query permission rules —
 * see `savedQuery`) is deliberately NOT modelled: no
 * page's behaviour depends on it, and a half-copy would be a second opinion to keep in step. If a page
 * ever does depend on one, model it here and say so in this list.
 */
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { WireCaseDetail, WireCaseWrite, WireDocument, WireDocumentType, WireNote, WireSavedCase, WireSavedQuery, WireWitness } from "../api/wire.js";
import { WIRE_SCHEMAS } from "../api/wire.js";
import { DEFAULT_SCENARIO, isMockScenario, MOCK_DOCUMENT_TYPES, MOCK_SCENARIOS, MOCK_WRITE_REJECTION, type MockScenario } from "./fixtures.js";

/** Five digits, zero-padded, as api's `ReferenceNumbers` formats it. */
const REFERENCE_SERIAL_DIGITS = 5;

/**
 * The types api serves `inline` rather than as an attachment, from its `INLINE_MIME_TYPES`.
 *
 * Narrower than the upload policy's list on purpose at api's end and therefore here: TIFF and the two
 * Word types are download-only because nothing renders them, and the renderable-and-dangerous types —
 * SVG, HTML — are on neither list.
 */
const INLINE_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);

/** The fields whose visibility or mandatoriness varies by type, per api's field-rule matrix. */
const RULED_FIELDS = [
  "inPerson",
  "maritalStatus",
  "ageOfMinor",
  "ageOfMinorMonths",
  "parents",
  "minorDateOfBirth",
  "urgency",
  "nationality",
  "nationalitySection",
  "nationalitySectionOther",
  "oldForename",
  "oldMiddleName",
  "oldSurname",
  "dateNoticeSentToLondonGazette"
] as const;

const MINOR_ONLY_FIELDS = ["minorDateOfBirth", "ageOfMinor", "ageOfMinorMonths", "parents"] as const;

/** Relaxed to optional when Migrated Record = Yes, whatever the type. Visibility is untouched. */
const MIGRATED_RELAXED_FIELDS = [
  "inPerson",
  "maritalStatus",
  "ageOfMinor",
  "ageOfMinorMonths",
  "parents",
  "urgency",
  "nationality",
  "nationalitySection"
] as const;

/**
 * A seeded case, with every field optional and its dates coerced from strings.
 *
 * The saved-case schema rather than a list of date fields kept here, so the one place that decides how an
 * api date is read stays `wire.ts`.
 */
const SEEDABLE_CASE = WIRE_SCHEMAS.SavedCaseResponse.partial();

/** api's `DeedPollService.WITNESSES_REQUIRED_FOR_ENROLMENT`. Restated because this file plays api. */
const WITNESSES_REQUIRED_FOR_ENROLMENT = 2;

/** api's `DeedPollService.ENROLMENT_WITNESSES_MESSAGE`, verbatim — the opening sentence of the refusal. */
const ENROLMENT_WITNESSES_MESSAGE = "A Deed Poll cannot be sent for enrolment until two witnesses have been recorded.";

/** The columns whose presence decides the state, and the audit columns a write stamps. */
const CASE_DEFAULTS = {
  privacy: "Normal",
  urgency: "Normal",
  migratedRecord: false,
  retainPermanently: false,
  publishToLondonGazette: true
} as const;

/**
 * Build the mock. Nothing is listening until `listen` is called — `startMockApi` does that.
 *
 * State is closed over rather than module-level so two instances in one test process cannot see each
 * other's cases.
 */
export function createMockApi(options: MockApiOptions = {}): MockApi {
  const cases = new Map<string, MockCase>();
  const savedQueries = new Map<string, MockSavedQuery>();
  /**
   * The ids in "my list", for the one notional caller this mock has.
   *
   * api keys the selection by the caller's subject, so two people can select the same shared query and one
   * unselecting it leaves the other's alone. **Not modelled**, for the same reason the permission rules are
   * not (see `savedQuery`): a set is enough for every journey a page can drive here, and a per-subject map
   * would look like it modelled two users while still reading no roles out of a token.
   */
  const selectedQueryIds = new Set<string>();
  let scenario: MockScenario = options.scenario ?? DEFAULT_SCENARIO;
  const serials = new Map<number, number>();

  const server = createServer((req, res) => {
    handle(req, res).catch((error) => {
      // A throw here is a bug in the mock, not a scenario. Answering 500 keeps a failing test's message
      // about its assertion rather than about a hung socket.
      send(res, 500, { error: `mock failed: ${error instanceof Error ? error.message : String(error)}` });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? "GET";
    const { pathname, searchParams } = new URL(req.url ?? "/", "http://localhost");

    // Both, because api serves both and they answer different questions — see `checkApiReachable`, which
    // probes the liveness group precisely so api's database cannot take this app's readiness down.
    if (method === "GET" && (pathname === "/health" || pathname === "/health/liveness")) {
      return send(res, 200, { status: "UP" });
    }

    if (method === "POST" && pathname === "/__mock/scenario") {
      const requested = ((await readJsonBody(req)) as { scenario?: unknown } | null)?.scenario;
      if (!isMockScenario(requested)) return send(res, 400, { error: `unknown scenario: ${String(requested)}` });
      scenario = requested;
      return send(res, 200, { scenario });
    }

    if (method === "POST" && pathname === "/__mock/reset") {
      reset();
      return send(res, 200, { scenario });
    }

    // Seeding, so a test can start from a case in a given state without driving the create form. Outside
    // the contract deliberately: it skips the refusals a real create applies.
    if (method === "POST" && pathname === "/__mock/cases") {
      const body = await readJsonBody(req);
      // `seed` holds a `MockCase`, whose dates are `Date` — which is what an in-process caller passes.
      // Over HTTP they arrive as the ISO strings `JSON.parse` leaves behind, and a string reaching
      // `isoDates` or `daysBetween` is a 500 that ALSO leaves the unusable record in the map, so every
      // later read of the list fails for the rest of the process. Coerced through the saved-case schema so
      // the formats accepted are the wire's, and merged back over the body so the children this route also
      // seeds survive the parse that would otherwise strip them.
      //
      // The case's own fields, not its children's: a document's bytes are a `Buffer` and no JSON body can
      // carry one, so a case WITH children is seeded in process through `mock.seed` instead.
      const coerced = SEEDABLE_CASE.safeParse(body ?? {});
      if (!coerced.success) return send(res, 400, fieldErrorsFrom(coerced.error.issues));

      const seeded = seed(body === null ? null : { ...(body as Partial<MockCase>), ...(coerced.data as Partial<MockCase>) });
      return send(res, 201, toDetail(seeded));
    }

    // Everything below is the contract, so everything below is unreachable when the scenario says api is
    // down — including reads, which is what makes `api-unavailable` a realistic outage.
    if (!MOCK_SCENARIOS[scenario].reachable) return send(res, 503, { error: "deed-poll-api is unavailable" });

    if (method === "GET" && pathname === "/caseworker/document-types") return send(res, 200, MOCK_DOCUMENT_TYPES);

    // The collection before the `{id}` pattern, for the reason recorded above the field-rules route: matched
    // the other way round, a `PUT /caseworker/saved-queries/…` would be reached but the bare collection would
    // not, and the literal path is the one Spring resolves first.
    if (pathname === "/caseworker/saved-queries") {
      // Ordered by name, as api v1 orders them — its own open question, and a page that renders them in the
      // order it is given would otherwise be seeing insertion order here and something else deployed.
      if (method === "GET") return send(res, 200, [...savedQueries.values()].sort((left, right) => rank(left.name, right.name)).map(toWireSavedQuery));
      if (method === "POST") return createSavedQuery(req, res);
      return send(res, 405, { error: `no such route: ${method} ${pathname}` });
    }

    const query = /^\/caseworker\/saved-queries\/([^/]+)(\/selection)?$/.exec(pathname);
    if (query) return savedQuery(req, res, method, decodeURIComponent(query[1]), query[2] !== undefined);

    // Before the `{id}` route, exactly as api relies on Spring ordering a literal pattern first: matched
    // the other way round, "field-rules" would be read as a case id and answer 404 for a route that exists.
    if (method === "GET" && pathname === "/caseworker/cases/field-rules") return fieldRules(res, searchParams);

    if (pathname === "/caseworker/cases") {
      if (method === "GET") return list(res, searchParams);
      if (method === "POST") return createCase(req, res);
      return send(res, 405, { error: `no such route: ${method} ${pathname}` });
    }

    const scoped = /^\/caseworker\/cases\/([^/]+)(?:\/(notes|witnesses|documents)(?:\/([^/]+))?)?(?:\/file)?$/.exec(pathname);
    if (!scoped) return send(res, 404, { error: `no such route: ${method} ${pathname}` });

    const [, rawId, collection, childId] = scoped;
    const found = cases.get(decodeURIComponent(rawId));
    if (!found) return send(res, 404, { error: `DeedPoll ${decodeURIComponent(rawId)} not found` });

    if (collection === undefined) {
      if (method === "GET") return send(res, 200, toDetail(found));
      if (method === "PATCH") return patchCase(req, res, found);
      return send(res, 405, { error: `no such route: ${method} ${pathname}` });
    }

    if (collection === "notes") return notes(req, res, method, found, childId);
    if (collection === "witnesses") return witnesses(req, res, method, found, childId);
    if (collection === "documents") return documents(req, res, method, found, childId, pathname.endsWith("/file"));

    return send(res, 404, { error: `no such route: ${method} ${pathname}` });
  }

  /**
   * One page of the list: the saved-query filter, the field-level conditions, the order and the page.
   *
   * Refusals are sent in api's order — the conditions, then the sort, then the paging — each as its own
   * 400, because that is the order `CaseworkerReadController` parses them in and a page rendering the
   * first refusal it is given should see the same one either way. The condition errors are addressed to
   * `where.0`, `where.1` … since the parameter is repeated and a position is the only thing that says
   * which of three conditions was the wrong one.
   */
  function list(res: ServerResponse, parameters: URLSearchParams): void {
    const where = parameters.getAll("where");
    // The cap alone, before the conditions are read: a request over it is refused whole, as api refuses it.
    if (where.length > MAX_CONDITIONS) {
      const message = `takes at most ${MAX_CONDITIONS} conditions, and was given ${where.length}`;
      send(res, 400, { error: "Case query is not valid", errors: [{ field: "where", message }] });
      return;
    }

    const conditions: MockCondition[] = [];
    const conditionErrors: MockFieldError[] = [];
    where.forEach((entry, index) => {
      const parsed = parseCondition(entry);
      if (typeof parsed === "string") conditionErrors.push({ field: `where.${index}`, message: parsed });
      else conditions.push(parsed);
    });
    if (conditionErrors.length > 0) {
      send(res, 400, { error: "Case query is not valid", errors: conditionErrors });
      return;
    }

    const order = parseSort(parameters.get("sort"));
    if (typeof order === "string") {
      send(res, 400, { error: "Case list sort is not valid", errors: [{ field: "sort", message: order }] });
      return;
    }

    const paging = parsePaging(parameters.get("page"), parameters.get("size"));
    if ("errors" in paging) {
      send(res, 400, { error: "Case list paging is not valid", errors: paging.errors });
      return;
    }

    const resolved = FILTERS.find((candidate) => candidate.key === parameters.get("filter")) ?? FILTERS[0];
    const matching = [...cases.values()]
      .filter((record) => resolved.matches(record.state))
      .filter((record) => conditions.every((condition) => matchesCondition(record, condition)))
      .sort(comparing(order));

    const from = (paging.page - 1) * paging.size;

    send(res, 200, {
      filter: resolved.key,
      cases: matching.slice(from, from + paging.size).map(toSummary),
      page: paging.page,
      size: paging.size,
      total: matching.length,
      // Zero pages for an empty result set, as `CaseResults` derives it: "page 1 of 0" tells the truth
      // about a list with nothing in it where "page 1 of 1" claims a page that has no rows on it.
      totalPages: Math.ceil(matching.length / paging.size)
    });
  }

  async function createCase(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const parsed = WIRE_SCHEMAS.CreateCaseRequest.safeParse(await readJsonBody(req));
    if (!parsed.success) return send(res, 400, fieldErrorsFrom(parsed.error.issues));
    if (MOCK_SCENARIOS[scenario].caseWrite === "reject") return send(res, 400, MOCK_WRITE_REJECTION);

    const patch = parsed.data as Partial<MockCase>;
    const dateErrors = dateRuleErrors(patch);
    if (dateErrors.length > 0) return send(res, 400, { error: "Case dates are inconsistent", errors: dateErrors });

    // api derives the year before it touches the counter, so a create with no Date Received consumes no
    // serial. The refusal is attributed to the field, which is what the new-case form renders it against.
    const year = patch.dateReceived?.getUTCFullYear();
    if (year === undefined) {
      return send(res, 400, {
        error: "Cannot allocate a reference number without a Date Received to derive the year",
        errors: [{ field: "dateReceived", message: "Enter the date the application was received" }]
      });
    }

    const serial = (serials.get(year) ?? 0) + 1;
    serials.set(year, serial);

    const now = new Date();
    const author = auditName(req);
    const record: MockCase = {
      ...CASE_DEFAULTS,
      ...patch,
      id: randomUUID(),
      referencenumber: serial,
      displayReference: `${prefixFor(patch.type)}${year}-${String(serial).padStart(REFERENCE_SERIAL_DIGITS, "0")}`,
      state: deriveState(patch),
      iShall: patch.iShall ?? [],
      iHaveSubscribed: patch.iHaveSubscribed ?? [],
      andAlsoMyOld: patch.andAlsoMyOld ?? [],
      createdOn: now,
      modifiedOn: now,
      createdBy: author,
      modifiedBy: author,
      notes: [],
      witnesses: [],
      documents: []
    };
    cases.set(record.id, record);

    return send(res, 201, toSaved(record));
  }

  async function patchCase(req: IncomingMessage, res: ServerResponse, record: MockCase): Promise<void> {
    const parsed = WIRE_SCHEMAS.UpdateCaseRequest.safeParse(await readJsonBody(req));
    if (!parsed.success) return send(res, 400, fieldErrorsFrom(parsed.error.issues));
    if (MOCK_SCENARIOS[scenario].caseWrite === "reject") return send(res, 400, MOCK_WRITE_REJECTION);

    // Merged before the rules run, for the reason api's own update does: a patch setting one date of a
    // pair is valid or not depending on the other, which it may never mention.
    const merged = { ...record, ...(parsed.data as Partial<MockCase>) };
    const dateErrors = dateRuleErrors(merged);
    if (dateErrors.length > 0) return send(res, 400, { error: "Case dates are inconsistent", errors: dateErrors });

    // After the date rules, as api orders them: a patch that contradicts a pair is refused for that before
    // the witness count is looked at, so the caseworker is told about one thing at a time.
    const witnessError = enrolmentWitnessError(record, parsed.data as Partial<MockCase>, merged);
    if (witnessError) return send(res, 400, { error: "Case cannot be sent for enrolment", errors: [witnessError] });

    Object.assign(record, merged, {
      state: deriveState(merged),
      // The prefix is recomputed from the new type; the year and serial are never re-allocated.
      displayReference: reprefix(record.displayReference, merged.type),
      modifiedOn: new Date(),
      modifiedBy: auditName(req)
    });

    return send(res, 200, toSaved(record));
  }

  async function notes(req: IncomingMessage, res: ServerResponse, method: string, record: MockCase, noteId: string | undefined): Promise<void> {
    if (noteId === undefined) {
      if (method === "GET") return send(res, 200, record.notes.map(toWireNote));
      if (method === "POST") {
        const parsed = WIRE_SCHEMAS.CreateNoteRequest.safeParse(await readJsonBody(req));
        if (!parsed.success) return send(res, 400, fieldErrorsFrom(parsed.error.issues));

        const now = new Date();
        const author = auditName(req);
        const created: MockNote = {
          id: randomUUID(),
          note: parsed.data.note.trim(),
          createdOn: now,
          modifiedOn: now,
          createdBy: author,
          modifiedBy: author
        };
        record.notes.push(created);
        return send(res, 201, toWireNote(created));
      }
      return send(res, 405, { error: `no such route: ${method} on notes` });
    }

    const id = decodeURIComponent(noteId);
    const index = record.notes.findIndex((note) => note.id === id);
    if (index === -1) return send(res, 404, { error: `Note ${id} not found` });
    const note = record.notes[index];

    if (method === "GET") return send(res, 200, toWireNote(note));

    if (method === "PATCH") {
      const parsed = WIRE_SCHEMAS.UpdateNoteRequest.safeParse(await readJsonBody(req));
      if (!parsed.success) return send(res, 400, fieldErrorsFrom(parsed.error.issues));

      // An empty patch re-stamps the author and nothing else, which is api's documented behaviour.
      if (parsed.data.note !== undefined) note.note = parsed.data.note.trim();
      note.modifiedOn = new Date();
      note.modifiedBy = auditName(req);
      return send(res, 200, toWireNote(note));
    }

    if (method === "DELETE") {
      record.notes.splice(index, 1);
      return sendNoContent(res);
    }

    return send(res, 405, { error: `no such route: ${method} on a note` });
  }

  /**
   * A case's witnesses: list, add, read, amend and delete.
   *
   * No author is stamped and none is accepted — `deedpoll_witness` holds the two timestamps and no author
   * columns, so `auditName` has nothing to attribute here. Values go in untrimmed, unlike a note's text:
   * api's `WitnessSchemas` stores what it was given and says so.
   *
   * **The delete's Administrator gate is not modelled**, exactly as the note delete's is not: this mock
   * takes a token to name an audit author and reads no roles out of one, so a 403 is not a state it can
   * produce. What decides who is offered the control is `canDeleteWitness`, tested against the user rather
   * than against api, and api's own gate is tested in api's repo.
   */
  async function witnesses(req: IncomingMessage, res: ServerResponse, method: string, record: MockCase, witnessId: string | undefined): Promise<void> {
    if (witnessId === undefined) {
      if (method === "GET") return send(res, 200, record.witnesses.map(toWireWitness));
      if (method === "POST") {
        const parsed = WIRE_SCHEMAS.CreateWitnessRequest.safeParse(await readJsonBody(req));
        if (!parsed.success) return send(res, 400, fieldErrorsFrom(parsed.error.issues));

        const now = new Date();
        const created: WireWitness = { id: randomUUID(), ...parsed.data, createdOn: now, modifiedOn: now };
        record.witnesses.push(created);
        return send(res, 201, toWireWitness(created));
      }
      return send(res, 405, { error: `no such route: ${method} on witnesses` });
    }

    const id = decodeURIComponent(witnessId);
    const index = record.witnesses.findIndex((candidate) => candidate.id === id);
    // Only this case's list is searched, which is api's scoping rule: a witness of another case is a 404
    // here rather than a row read through the wrong parent.
    if (index === -1) return send(res, 404, { error: `Witness ${id} not found` });
    const witness = record.witnesses[index];

    if (method === "GET") return send(res, 200, toWireWitness(witness));

    if (method === "PATCH") {
      const parsed = WIRE_SCHEMAS.UpdateWitnessRequest.safeParse(await readJsonBody(req));
      if (!parsed.success) return send(res, 400, fieldErrorsFrom(parsed.error.issues));

      // An omitted field is absent from the parsed patch rather than present as undefined, so an empty
      // patch re-stamps `modifiedOn` and changes nothing else — api's documented behaviour.
      Object.assign(witness, parsed.data, { modifiedOn: new Date() });
      return send(res, 200, toWireWitness(witness));
    }

    if (method === "DELETE") {
      record.witnesses.splice(index, 1);
      return sendNoContent(res);
    }

    return send(res, 405, { error: `no such route: ${method} on a witness` });
  }

  async function documents(
    req: IncomingMessage,
    res: ServerResponse,
    method: string,
    record: MockCase,
    documentId: string | undefined,
    wantsFile: boolean
  ): Promise<void> {
    if (documentId === undefined && method === "POST") {
      const upload = parseMultipart(await readRawBody(req), req.headers["content-type"] ?? "");
      if (!upload?.file) return send(res, 400, { error: "Select a file to upload", errors: [{ field: "file", message: "Select a file to upload" }] });

      const documentTypeId = upload.fields.documentTypeId;
      const documentType = MOCK_DOCUMENT_TYPES.find((candidate) => candidate.id === documentTypeId);
      if (!documentType) return send(res, 404, { error: `Document type ${documentTypeId} not found` });

      const now = new Date();
      const created: MockDocument = {
        id: randomUUID(),
        name: (upload.fields.name || upload.file.name).slice(0, 100),
        documentType,
        direction: upload.fields.direction === "Outgoing" ? "Outgoing" : "Incoming",
        originalName: upload.file.name,
        mimeType: upload.file.mimeType,
        sizeBytes: upload.file.bytes.length,
        bytes: upload.file.bytes,
        createdOn: now,
        modifiedOn: now
      };
      record.documents.push(created);
      return send(res, 201, toWireDocument(created));
    }

    if (documentId !== undefined && method === "GET" && wantsFile) {
      const id = decodeURIComponent(documentId);
      const document = record.documents.find((candidate) => candidate.id === id);
      if (!document) return send(res, 404, { error: `Document ${id} not found` });

      res.writeHead(200, {
        "content-type": document.mimeType,
        // `inline` for the three types a browser renders natively, `attachment` otherwise — api's
        // allowlist, mirrored so a caller cannot be written against a disposition the real service
        // never sends. The two headers below travel with it: an inline PDF's viewer runs embedded
        // script, and the policy is what makes rendering one in the caller's origin defensible.
        "content-disposition": `${INLINE_MIME_TYPES.has(document.mimeType) ? "inline" : "attachment"}; filename="${document.originalName.replace(/[^A-Za-z0-9._ -]/g, "")}"`,
        "content-security-policy": "default-src 'none'; sandbox",
        "x-content-type-options": "nosniff",
        "cache-control": "no-store"
      });
      res.end(document.bytes);
      return;
    }

    return send(res, 404, { error: `no such route: ${method} on documents` });
  }

  async function createSavedQuery(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const parsed = WIRE_SCHEMAS.CreateSavedQueryRequest.safeParse(await readJsonBody(req));
    if (!parsed.success) return send(res, 400, fieldErrorsFrom(parsed.error.issues));

    const now = new Date();
    // The owner from the token, which is the one thing about identity this mock does model — api takes the
    // owner from the subject exactly as it takes the audit author, so a caller sending no token owns
    // everything it creates under the fallback name.
    const owner = auditName(req);
    const record: MockSavedQuery = {
      id: randomUUID(),
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      shared: parsed.data.shared ?? false,
      filter: parsed.data.filter ?? null,
      // Never null, as api's `List.of()` never is: a query that narrows nothing has no conditions, not
      // absent ones.
      conditions: parsed.data.conditions ?? [],
      sortField: parsed.data.sortField ?? null,
      sortDirection: parsed.data.sortDirection ?? null,
      searchTerm: parsed.data.searchTerm ?? null,
      ownerId: owner,
      ownerName: owner,
      createdBy: owner,
      modifiedBy: owner,
      createdOn: now,
      modifiedOn: now
    };
    savedQueries.set(record.id, record);

    // Deliberately NOT selected for its creator: the spec does not say api selects one, and a mock that
    // did would let a page ship relying on it. A page that wants the query in the caller's list says so
    // with the `PUT`, which is idempotent either way.
    return send(res, 201, toWireSavedQuery(record));
  }

  /**
   * One saved query: read, amend, delete, and the selection sub-resource.
   *
   * **The permission rules are not modelled, and this mock must not be read as evidence that the UI's
   * handling of them is tested.** api decides who may amend or delete from `SavedQueryPermissions` — the
   * owner, or an Administrator for a shared query — and computes `editable` from that same predicate. This
   * mock has no roles: `auditName` decodes an unverified token for a subject and nothing else, so a 403 is
   * not a state it can produce, exactly as the witness delete's Administrator gate is unmodelled. So it
   * sets **`editable: true` on everything and answers every write**. What that leaves untested locally is
   * api's gate, which is api's own test; what the UI does with the flag is tested by giving the flag both
   * values in the page tests, not by driving this.
   *
   * The one asymmetry that IS modelled, because a page depends on it: `PUT …/selection` answers 404 for a
   * query that is not there, and `DELETE …/selection` answers 204 regardless — the selection row is keyed
   * by the caller, so a subscriber can always clear a stale selection for a query since unshared.
   */
  async function savedQuery(req: IncomingMessage, res: ServerResponse, method: string, id: string, isSelection: boolean): Promise<void> {
    if (isSelection) {
      if (method === "DELETE") {
        selectedQueryIds.delete(id);
        return sendNoContent(res);
      }
      if (method === "PUT") {
        if (!savedQueries.has(id)) return send(res, 404, { error: `Saved query ${id} not found` });
        selectedQueryIds.add(id);
        return sendNoContent(res);
      }
      return send(res, 405, { error: `no such route: ${method} on a saved query's selection` });
    }

    const found = savedQueries.get(id);
    // 404 for a query the caller cannot see as well as for one that never existed, which is api's rule —
    // indistinguishable on purpose, so no id is discoverable by watching status codes. Here the two collapse
    // into one branch because everything this mock holds is visible to it.
    if (!found) return send(res, 404, { error: `Saved query ${id} not found` });

    if (method === "GET") return send(res, 200, toWireSavedQuery(found));

    if (method === "PATCH") {
      const parsed = WIRE_SCHEMAS.UpdateSavedQueryRequest.safeParse(await readJsonBody(req));
      if (!parsed.success) return send(res, 400, fieldErrorsFrom(parsed.error.issues));

      // An omitted field is absent from the parsed patch rather than present as undefined, so an empty patch
      // re-stamps the author and changes nothing — and an explicit null CLEARS the column, which is api's
      // behaviour here and not the note or witness patches', whose columns are all NOT NULL.
      Object.assign(found, parsed.data, { modifiedOn: new Date(), modifiedBy: auditName(req) });
      return send(res, 200, toWireSavedQuery(found));
    }

    if (method === "DELETE") {
      savedQueries.delete(id);
      // Every selection of it goes too, through api's foreign-key cascade: a subscriber's list cannot hold a
      // query that no longer exists.
      selectedQueryIds.delete(id);
      return sendNoContent(res);
    }

    return send(res, 405, { error: `no such route: ${method} on a saved query` });
  }

  /** A saved query on the wire: the stored fields, plus the two flags api derives per caller. */
  function toWireSavedQuery(record: MockSavedQuery): unknown {
    return { ...isoDates(record), selected: selectedQueryIds.has(record.id), editable: true };
  }

  function fieldRules(res: ServerResponse, query: URLSearchParams): void {
    // Taken as lists and refused when repeated, for api's reason: each parameter changes the answer, so a
    // caller who sent one twice must be told rather than picked for.
    for (const name of ["type", "migrated", "publishToGazette"]) {
      if (query.getAll(name).length > 1) {
        send(res, 400, { error: "Invalid request parameter", errors: [{ field: name, message: "must be given at most once" }] });
        return;
      }
    }

    const type = query.get("type");
    if (type !== null && !CASE_TYPES.includes(type)) {
      send(res, 400, { error: "Invalid request parameter", errors: [{ field: "type", message: "is not a valid case type" }] });
      return;
    }

    const migrated = flag(query.get("migrated"), false);
    const publishToGazette = flag(query.get("publishToGazette"), true);
    if (migrated === null || publishToGazette === null) {
      const field = migrated === null ? "migrated" : "publishToGazette";
      send(res, 400, { error: "Invalid request parameter", errors: [{ field, message: "must be true or false" }] });
      return;
    }

    send(res, 200, { rules: rulesFor(type, migrated, publishToGazette) });
  }

  function seed(body: Partial<MockCase> | null): MockCase {
    const now = new Date();
    const record: MockCase = {
      ...CASE_DEFAULTS,
      id: randomUUID(),
      referencenumber: null,
      displayReference: null,
      state: "Received",
      iShall: [],
      iHaveSubscribed: [],
      andAlsoMyOld: [],
      createdOn: now,
      modifiedOn: now,
      // The fallback, not a caller's name: seeding is not a write by anyone, so there is no token to
      // attribute it to. A test that needs a particular author sets `createdBy` in the body.
      createdBy: MOCK_USER_NAME,
      modifiedBy: MOCK_USER_NAME,
      notes: [],
      witnesses: [],
      documents: [],
      ...body
    };
    cases.set(record.id, record);

    return record;
  }

  function reset(): void {
    cases.clear();
    serials.clear();
    savedQueries.clear();
    selectedQueryIds.clear();
  }

  return {
    server,
    get scenario() {
      return scenario;
    },
    setScenario(next: MockScenario) {
      scenario = next;
    },
    seed,
    reset
  };
}

/**
 * Listen on `port` and hand back the URL it actually bound to.
 *
 * Port 0 means "any free port", which is what tests use: a fixed port makes two suites racing on one
 * machine fail intermittently, and an intermittent integration failure is the least useful kind.
 */
export async function startMockApi(options: MockApiOptions & { port?: number } = {}): Promise<RunningMockApi> {
  const mock = createMockApi(options);

  await new Promise<void>((resolve, reject) => {
    mock.server.once("error", reject);
    mock.server.listen(options.port ?? 0, () => resolve());
  });

  const address = mock.server.address();

  // Delegated property by property rather than `{ ...mock }`: spreading READS the `scenario` getter once
  // and stores its value, so a scenario switched over HTTP afterwards would never be visible here — and a
  // test asserting the switch had happened would pass while asserting a stale constant.
  return {
    server: mock.server,
    get scenario() {
      return mock.scenario;
    },
    setScenario: mock.setScenario,
    seed: mock.seed,
    reset: mock.reset,
    url: address && typeof address === "object" ? `http://localhost:${address.port}` : "http://localhost",
    close: () =>
      new Promise<void>((resolve, reject) => {
        mock.server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}

/** Who a write is attributed to when the caller forwarded no token. Deliberately not a plausible name. */
const MOCK_USER_NAME = "Mock Caseworker";

/**
 * Who a write is attributed to: the caller the forwarded token names.
 *
 * **Modelled because a page depends on it.** api derives the audit author from the caller's token and takes
 * no author parameter, so nothing but the token reaching api makes `Created By` right — and the new-case
 * page sent `userName: undefined` for a whole phase without anything noticing. Stamping a constant here
 * would leave that undetectable again: the e2e create journey asserts this value for exactly that reason.
 *
 * **The `sub`, where api uses the display name.** api resolves the name from IDAM's `/o/userinfo`
 * (`IdamUserInfoClient`) — an access token carries no name claim — and the mock has no IDAM to ask, so it
 * stamps the subject the token already carries: an email, for `rse-idam-simulator`. A difference in the
 * TEXT, not in where identity comes from, which is the part a page can get wrong.
 *
 * **Decoded, never verified.** Verification needs IDAM's JWKS, and a mock that refused a badly-signed
 * token would be asserting something no page depends on. Anything undecodable is the fallback rather than
 * an error, so a hand-rolled `curl` against the mock still works.
 */
function auditName(req: IncomingMessage): string {
  const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "");
  const payload = bearer?.[1].split(".")[1];
  if (payload === undefined) return MOCK_USER_NAME;

  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const subject = (claims as { sub?: unknown } | null)?.sub;

    return typeof subject === "string" && subject.length > 0 ? subject : MOCK_USER_NAME;
  } catch {
    return MOCK_USER_NAME;
  }
}

const CASE_TYPES = ["Adult", "AdultTransgender", "Minor", "MinorTransgender", "DeedOfRelinquishment", "Unknown"];

/** The saved-query filters, matching api's `ListFilters` — "open" is everything not yet finished. */
const FILTERS: readonly { key: string; matches: (state: string | null | undefined) => boolean }[] = [
  { key: "all", matches: () => true },
  { key: "open", matches: (state) => state !== "Enroled" && state !== "Returned" },
  { key: "received", matches: (state) => state === "Received" },
  { key: "enroled", matches: (state) => state === "Enroled" },
  { key: "returned", matches: (state) => state === "Returned" }
];

/** api's cap on conditions per request, from `CaseQuery.MAX_CONDITIONS`. */
const MAX_CONDITIONS = 20;

/** api's page size when none is asked for, and the cap it clamps a larger one to — `CasePaging`. */
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/**
 * The fields a condition or a sort may name.
 *
 * Derived from the response schema rather than listed, so a field api adds to a case becomes queryable
 * here without a second edit. The three exclusions are the properties with no column behind them: `id` is
 * not a form field, and the two day counts are computed at read time — api refuses both with *"is derived,
 * not stored"*.
 *
 * Wider than api's set by whatever wire property is not one of its 70 `FormFields`, and that is the
 * accepted imprecision of a mock: api is the authority on the name, and being told about a name it would
 * refuse is a 400 in a deployed environment rather than something a page can render differently.
 */
const QUERYABLE_FIELDS: ReadonlySet<string> = new Set(
  Object.keys(WIRE_SCHEMAS.SavedCaseResponse.shape).filter((name) => !["id", "daysReceivedToEnroled", "daysReceivedToReturned"].includes(name))
);

/**
 * How many values each operator takes, and whether they are comma-separated.
 *
 * The arity is here because nothing can be evaluated without it — `between` needs its bounds split and
 * `isEmpty` must refuse a value. The operator-per-KIND table deliberately is NOT: it lives in api's
 * `QueryOperator` and in this repo in `libs/deed-poll/src/deed-poll/query-fields.ts`, and a third copy
 * would be one more to keep in step. Nothing this app sends can reach it anyway — `caseQueryWhere` only
 * puts a condition on the wire once its own copy has admitted the operator for the field's kind — so a
 * kind mismatch is a hand-edited URL, and api answers that with the 400 the page already renders.
 */
const ARITY_BY_OPERATOR: Readonly<Record<string, 0 | 1 | 2 | "many">> = {
  is: 1,
  contains: 1,
  startsWith: 1,
  before: 1,
  after: 1,
  gt: 1,
  lt: 1,
  between: 2,
  isOneOf: "many",
  isEmpty: 0,
  isNotEmpty: 0
};

/**
 * One `where` entry as a condition, or the message saying why it is not one.
 *
 * Split on the first two colons only, as api splits it: everything after the second is the value, so a
 * colon inside a value survives. An entry with no second colon is how a no-value operator is written
 * (`parents:isEmpty`).
 */
function parseCondition(entry: string): MockCondition | string {
  const firstColon = entry.indexOf(":");
  if (firstColon < 0) return `must be field:operator:value, and was '${entry}'`;

  const secondColon = entry.indexOf(":", firstColon + 1);
  const field = entry.slice(0, firstColon).trim();
  const operator = (secondColon < 0 ? entry.slice(firstColon + 1) : entry.slice(firstColon + 1, secondColon)).trim();
  const valuePart = secondColon < 0 ? null : entry.slice(secondColon + 1);

  if (!QUERYABLE_FIELDS.has(field)) return `names no case field: '${field}'`;
  // `hasOwn` rather than a truthiness check, because `ARITY_BY_OPERATOR["toString"]` is a function.
  if (!Object.hasOwn(ARITY_BY_OPERATOR, operator)) return `names no operator: '${operator}'`;

  const arity = ARITY_BY_OPERATOR[operator];
  const takesList = arity === 2 || arity === "many";
  const values = valuePart === null || valuePart === "" ? [] : takesList ? valuePart.split(",").map((value) => value.trim()) : [valuePart];
  if (arity === "many" ? values.length === 0 : values.length !== arity) return `${operator} takes ${wantedValues(arity)}, and was given ${values.length}`;
  if (values.some((value) => value.trim() === "")) return `${field} was given a blank value; use isEmpty to match a blank`;

  return { field, operator, values };
}

/** What an operator's arity asks for, in the words api's own refusal uses. */
function wantedValues(arity: 0 | 1 | 2 | "many"): string {
  if (arity === 0) return "no value";
  if (arity === 1) return "one value";

  return arity === 2 ? "two comma-separated values" : "at least one comma-separated value";
}

/** `field`, `field:asc` or `field:desc`; a bare field is ascending, as api reads it. */
function parseSort(sort: string | null): MockSort | string {
  if (sort === null || sort.trim() === "") return { field: "createdOn", descending: true };

  const colon = sort.indexOf(":");
  const field = (colon < 0 ? sort : sort.slice(0, colon)).trim();
  const direction = colon < 0 ? "asc" : sort.slice(colon + 1).trim();

  if (!QUERYABLE_FIELDS.has(field)) return `names no sortable case field: '${field}'`;
  if (direction !== "asc" && direction !== "desc") return `takes a direction of asc, desc, and was given '${direction}'`;

  return { field, descending: direction === "desc" };
}

/** The page asked for, clamped as api clamps it, or the parameters that were unusable. */
function parsePaging(page: string | null, size: string | null): { page: number; size: number } | { errors: MockFieldError[] } {
  const errors: MockFieldError[] = [];
  const number = pageNumber("page", page, 1, errors);
  const rows = pageNumber("size", size, DEFAULT_PAGE_SIZE, errors);
  if (errors.length > 0) return { errors };

  // Clamped rather than refused, as `CasePaging` clamps it: the cap is a property of the service and not a
  // mistake the caller made, and the response says what size was applied.
  return { page: number, size: Math.min(rows, MAX_PAGE_SIZE) };
}

function pageNumber(name: string, raw: string | null, whenAbsent: number, errors: MockFieldError[]): number {
  if (raw === null || raw.trim() === "") return whenAbsent;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    errors.push({ field: name, message: `takes a whole number of 1 or more, and was given '${raw}'` });
    return whenAbsent;
  }

  return parsed;
}

/**
 * Whether one condition holds for one case.
 *
 * A blank field matches `isEmpty` and nothing else, which is SQL's own answer: a comparison against null
 * is not false so much as unknown, and a row it is unknown for is not returned.
 */
function matchesCondition(record: MockCase, { field, operator, values }: MockCondition): boolean {
  const stored = (record as unknown as Record<string, unknown>)[field];
  if (operator === "isEmpty") return isBlank(stored);
  if (operator === "isNotEmpty") return !isBlank(stored);
  if (isBlank(stored)) return false;

  switch (operator) {
    case "is":
      return rank(stored, coerce(stored, values[0])) === 0;
    case "isOneOf":
      return values.some((value) => rank(stored, coerce(stored, value)) === 0);
    case "before":
    case "lt":
      return rank(stored, coerce(stored, values[0])) < 0;
    case "after":
    case "gt":
      return rank(stored, coerce(stored, values[0])) > 0;
    case "between":
      return rank(stored, coerce(stored, values[0])) >= 0 && rank(stored, coerce(stored, values[1])) <= 0;
    case "contains":
      // A multiselect holds its Dynamics option values, so "contains" asks whether one of them is chosen.
      // Every other kind is text, and text is matched case-insensitively — api's `lower(col) like lower(?)`.
      return Array.isArray(stored) ? stored.some((option) => String(option) === values[0].trim()) : lower(stored).includes(values[0].toLowerCase());
    case "startsWith":
      return lower(stored).startsWith(values[0].toLowerCase());
    default:
      return false;
  }
}

/** Whether the stored value is one `isEmpty` matches: absent, blank, or an empty multiselect. */
function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;

  return typeof value === "string" && value.trim() === "";
}

/** A condition's value as the type the stored one already is, since that is what decides the comparison. */
function coerce(stored: unknown, value: string): unknown {
  if (stored instanceof Date) return new Date(value.trim());
  if (typeof stored === "number") return Number(value.trim());
  if (typeof stored === "boolean") return value.trim() === "true";

  return value;
}

/** Two comparable values ordered: negative, zero or positive, as a comparator answers. */
function rank(left: unknown, right: unknown): number {
  if (left instanceof Date && right instanceof Date) return left.getTime() - right.getTime();
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "boolean" && typeof right === "boolean") return Number(left) - Number(right);
  const [a, b] = [String(left), String(right)];

  return a === b ? 0 : a < b ? -1 : 1;
}

function lower(value: unknown): string {
  return String(value).toLowerCase();
}

/**
 * The list's order.
 *
 * A blank sorts last ascending and first descending, which is Postgres's default and therefore what api
 * gets — not a choice this file makes.
 */
function comparing(order: MockSort): (left: MockCase, right: MockCase) => number {
  return (left, right) => {
    const a = (left as unknown as Record<string, unknown>)[order.field];
    const b = (right as unknown as Record<string, unknown>)[order.field];
    const ranked = isBlank(a) || isBlank(b) ? (isBlank(a) === isBlank(b) ? 0 : isBlank(a) ? 1 : -1) : rank(a, b);

    return order.descending ? -ranked : ranked;
  };
}

/** One row of the list: the six columns `CaseSummaryResponse` carries and nothing else. */
function toSummary(record: MockCase): unknown {
  return {
    id: record.id,
    displayReference: record.displayReference,
    privacy: record.privacy,
    dateReceived: iso(record.dateReceived),
    type: record.type,
    state: record.state,
    newForename: record.newForename
  };
}

function prefixFor(type: string | null | undefined): string {
  return type === "DeedOfRelinquishment" ? "KBDR" : "KBDP";
}

/** Recompute only the prefix, leaving a reference the mock did not allocate untouched. */
function reprefix(existing: string | null | undefined, type: string | null | undefined): string | null {
  const parsed = existing ? /^KBD[PR](\d{4})-(\d{5})$/.exec(existing) : null;
  if (!parsed) return existing ?? null;

  return `${prefixFor(type)}${parsed[1]}-${parsed[2]}`;
}

/**
 * The state, from which dates are populated. The FIRST match wins, and the order is api's.
 *
 * Note that signature-received is evaluated BEFORE the referral pair, so a signed case reads Awaiting
 * Enrolment even when a referral date is also set. That is the source system's behaviour, preserved.
 */
function deriveState(record: Partial<MockCase>): CaseState {
  if (record.dateReturned) return "Returned";
  if (record.dateEnroled) return "Enroled";
  if (record.signatureReceivedDate) return "AwaitingEnrolment";
  if (record.signatureRequestedDate) return "AwaitingSignature";
  if (record.dateReferred && record.dateReadyForMaster) return "ReferredToMaster";
  if (record.dateReadyForMaster) return "ReadyForMaster";
  if (record.awaitingFurtherDocsInfo) return "AwaitingFurtherDocs";

  return "Received";
}

/** The two cross-field date refusals, checked against a fully-merged record. */
function dateRuleErrors(record: Partial<MockCase>): { field: string; message: string }[] {
  const errors: { field: string; message: string }[] = [];

  if (record.dateReturned && record.dateEnroled) {
    errors.push({
      field: "state",
      message: "Date Enroled and Date Returned both contain a date. Please remove one depending on whether the Deed Poll is to be enroled or returned."
    });
  }

  if (record.signatureRequestedDate && record.signatureReceivedDate && record.signatureReceivedDate.getTime() < record.signatureRequestedDate.getTime()) {
    errors.push({ field: "signatureReceivedDate", message: "Signature received date cannot be before the signature requested date." });
  }

  return errors;
}

/**
 * The two-witness gate on enrolment, restating api's `DeedPollService.requireWitnessesForEnrolment`
 * (deed-poll-api at `62c76f4`). Modelled here because a page that explains the refusal cannot be driven
 * against a mock that never issues one — the `yarn dev` journey and the e2e journey both provoke it.
 *
 * **Checked against the MERGED record, and on update only.** A patch touching only a surname on a case
 * that already carries an enrolment date is still a write that leaves the record enrolled, so it is
 * refused too. A create is not gated at api's end and is not gated here: witnesses are children of a row
 * that has to exist first, so no create can carry two.
 *
 * The refusal names one of the two dates and never a witnesses field — there is no witness control on the
 * case form for an error to render against. The date THIS write sets is preferred so the message lands on
 * the box just filled in; otherwise the cascade's own precedence decides.
 */
function enrolmentWitnessError(record: MockCase, patch: Partial<MockCase>, merged: MockCase): { field: string; message: string } | null {
  if (!merged.dateEnroled && !merged.signatureReceivedDate) return null;

  const recorded = record.witnesses.length;
  if (recorded >= WITNESSES_REQUIRED_FOR_ENROLMENT) return null;

  // Only reached while the record is short, so `recorded` is 0 or 1.
  const shortfall = recorded === 1 ? "This case has one; please add one more witness." : "This case has none; please add two witnesses.";

  return { field: enrolmentDateToAddress(patch, merged), message: `${ENROLMENT_WITNESSES_MESSAGE} ${shortfall}` };
}

function enrolmentDateToAddress(patch: Partial<MockCase>, merged: MockCase): string {
  if ("dateEnroled" in patch && merged.dateEnroled) return "dateEnroled";
  if ("signatureReceivedDate" in patch && merged.signatureReceivedDate) return "signatureReceivedDate";

  return merged.dateEnroled ? "dateEnroled" : "signatureReceivedDate";
}

/** The per-type show / hide / mandate matrix. */
function rulesFor(type: string | null, migrated: boolean, publishToGazette: boolean): Record<string, { visible: boolean; required: boolean }> {
  const rules: Record<string, { visible: boolean; required: boolean }> = {};
  for (const field of RULED_FIELDS) rules[field] = { visible: true, required: false };

  const require = (field: string) => {
    rules[field].required = true;
  };
  const hide = (field: string) => {
    rules[field].visible = false;
  };

  if (type === "Adult" || type === "AdultTransgender") {
    for (const field of ["inPerson", "maritalStatus", "urgency", "nationality", "nationalitySection"]) require(field);
    for (const field of MINOR_ONLY_FIELDS) hide(field);
  } else if (type === "Minor" || type === "MinorTransgender") {
    for (const field of ["inPerson", "maritalStatus", "urgency", "nationality", "nationalitySection", "ageOfMinor", "ageOfMinorMonths", "parents"]) {
      require(field);
    }
  } else if (type === "DeedOfRelinquishment") {
    for (const field of ["inPerson", "urgency"]) require(field);
    for (const field of [
      "oldForename",
      "oldMiddleName",
      "oldSurname",
      "maritalStatus",
      "nationality",
      "nationalitySection",
      "nationalitySectionOther",
      "dateNoticeSentToLondonGazette",
      ...MINOR_ONLY_FIELDS
    ]) {
      hide(field);
    }
  }

  // Last, so it overrides whatever the type branch mandated. Visibility is untouched.
  if (migrated) for (const field of MIGRATED_RELAXED_FIELDS) rules[field].required = false;
  if (!publishToGazette) hide("dateNoticeSentToLondonGazette");

  return rules;
}

/** A boolean query parameter, defaulted when absent and null when it is not a boolean. */
function flag(value: string | null, whenAbsent: boolean): boolean | null {
  if (value === null) return whenAbsent;
  if (/^true$/i.test(value)) return true;
  if (/^false$/i.test(value)) return false;

  return null;
}

function toSaved(record: MockCase): unknown {
  const { notes: _notes, witnesses: _witnesses, documents: _documents, ...fields } = record;

  return {
    ...isoDates(fields),
    daysReceivedToEnroled: daysBetween(record.dateReceived, record.dateEnroled),
    daysReceivedToReturned: daysBetween(record.dateReceived, record.dateReturned)
  };
}

function toDetail(record: MockCase): unknown {
  return {
    ...(toSaved(record) as object),
    notes: record.notes.map(toWireNote),
    witnesses: record.witnesses.map(toWireWitness),
    documents: record.documents.map(toWireDocument)
  };
}

function toWireNote(note: MockNote): unknown {
  return isoDates(note);
}

function toWireWitness(witness: WireWitness): unknown {
  return isoDates(witness);
}

function toWireDocument(document: MockDocument): unknown {
  const { bytes, ...fields } = document;

  return { ...isoDates(fields), hasFile: bytes.length > 0 };
}

/**
 * Every `Date` in an object as an ISO string.
 *
 * Serialised explicitly rather than left to `JSON.stringify`, so the mock's wire format is a decision this
 * file makes rather than a default it inherits — and so a `Date` reaching a response is visible here.
 */
function isoDates<T extends object>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, member]) => [key, member instanceof Date ? iso(member) : member]));
}

/**
 * A date-time in api's format, which is **zoneless** — `2026-03-10T00:00:00.000`, not `…Z`.
 *
 * Every date-time api publishes is a Jackson-serialised `LocalDateTime`, so it carries no offset. That is
 * the whole reason `wire.ts` has `toUtcDate`: read as local time, a midnight date west of Greenwich renders
 * as the previous day. Emitting `toISOString()` here would make the mock the one caller of the adapter that
 * never takes that path, so the conversion the deployed app depends on would be exercised by nothing.
 */
function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString().replace(/Z$/, "") : null;
}

/** Whole days between two dates in UTC, as api's computed columns count them. */
function daysBetween(from: Date | null | undefined, to: Date | null | undefined): number | null {
  if (!from || !to) return null;
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());

  return Math.round((end - start) / 86_400_000);
}

/** A rejected body as api reports one: a message plus the failures addressed to their fields. */
function fieldErrorsFrom(issues: readonly { path: readonly PropertyKey[]; message: string }[]): unknown {
  return {
    error: "Request body is not valid",
    errors: issues.map((issue) => ({ field: issue.path.map(String).join("."), message: issue.message }))
  };
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function sendNoContent(res: ServerResponse): void {
  res.writeHead(204);
  res.end();
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const raw = (await readRawBody(req)).toString("utf8");
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function readRawBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);

  return Buffer.concat(chunks);
}

/**
 * Pull the file part and the text fields out of a multipart body.
 *
 * Enough of RFC 7578 for one upload with three fields beside it. The body is split on the boundary as
 * latin1 so a byte is a character — decoding a JPEG as UTF-8 would report a size that is neither the
 * file's nor reproducible — and the file's bytes are recovered from that same encoding.
 */
function parseMultipart(body: Buffer, contentType: string): ParsedUpload | null {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  if (!boundary) return null;

  const upload: ParsedUpload = { fields: {}, file: null };
  for (const part of body.toString("latin1").split(`--${boundary[1] ?? boundary[2]}`)) {
    const separator = part.indexOf("\r\n\r\n");
    if (separator === -1) continue;

    const headers = part.slice(0, separator);
    const name = /name="([^"]*)"/.exec(headers);
    if (!name) continue;

    // The part's payload ends with the CRLF that precedes the next boundary delimiter.
    const content = part.slice(separator + 4).replace(/\r\n$/, "");
    const filename = /filename="([^"]*)"/.exec(headers);

    if (filename) {
      const mimeType = /content-type:\s*([^\r\n]+)/i.exec(headers);
      upload.file = {
        name: filename[1],
        mimeType: mimeType?.[1].trim() ?? "application/octet-stream",
        bytes: Buffer.from(content, "latin1")
      };
    } else {
      upload.fields[name[1]] = Buffer.from(content, "latin1").toString("utf8");
    }
  }

  return upload;
}

export interface MockApiOptions {
  scenario?: MockScenario;
}

export interface MockApi {
  server: Server;
  readonly scenario: MockScenario;
  setScenario(scenario: MockScenario): void;
  /** Put a case straight into memory, bypassing the create rules. For tests that start mid-lifecycle. */
  seed(record: Partial<MockCase> | null): MockCase;
  /**
   * Forget every case, every reference serial and every saved query.
   *
   * In process as well as over `POST /__mock/reset`, so a suite sharing one mock across a file can start
   * each test from empty. Without it the per-year serials accumulate, and any assertion on a reference
   * number or a list length becomes dependent on what ran before it.
   */
  reset(): void;
}

export interface RunningMockApi extends MockApi {
  url: string;
  close(): Promise<void>;
}

/**
 * A case as the mock holds it: api's saved-case fields with dates still `Date`, plus the children and the
 * document bytes it has nowhere else to put.
 *
 * The two computed columns are absent because they are derived on the way out, and the columns the mock
 * always populates are tightened to non-null — a stored case with no `state` or no `createdOn` is not a
 * state api can be in, so the mock should not be able to represent one either.
 */
export type MockCase = Omit<WireSavedCase, "daysReceivedToEnroled" | "daysReceivedToReturned" | "state" | "createdOn" | "modifiedOn"> & {
  state: CaseState;
  createdOn: Date;
  modifiedOn: Date;
  notes: MockNote[];
  witnesses: WireWitness[];
  documents: MockDocument[];
};

type CaseState = NonNullable<WireSavedCase["state"]>;

/**
 * A saved query as the mock holds it: api's published fields with the dates still `Date`, minus the two
 * flags derived per caller on the way out.
 *
 * `selected` is derived from the selection set and `editable` is the constant this mock cannot do better
 * than, so neither is storable — a record carrying either would be a second place for the answer to live.
 */
type MockSavedQuery = Omit<WireSavedQuery, "selected" | "editable" | "createdOn" | "modifiedOn"> & {
  createdOn: Date;
  modifiedOn: Date;
};

/** One condition of a list query, already checked as far as the mock checks one. */
interface MockCondition {
  field: string;
  operator: string;
  /** One value for most operators, two for `between`, one or more for `isOneOf`, none for the two empties. */
  values: string[];
}

interface MockSort {
  field: string;
  descending: boolean;
}

/** A refusal addressed to the parameter that caused it — `where.0`, `sort`, `page`. */
interface MockFieldError {
  field: string;
  message: string;
}

type MockNote = WireNote;

/** A stored document: what api publishes, minus `hasFile` (derived), plus the bytes and what they are. */
type MockDocument = Omit<WireDocument, "hasFile" | "name" | "originalName" | "mimeType" | "documentType" | "direction"> & {
  name: string;
  originalName: string;
  mimeType: string;
  documentType: WireDocumentType;
  direction: NonNullable<WireDocument["direction"]>;
  bytes: Buffer;
};

interface ParsedUpload {
  fields: Record<string, string>;
  file: { name: string; mimeType: string; bytes: Buffer } | null;
}

/** Re-exported for the mock's own tests and `main.ts`; not part of the package's public surface. */
export type { WireCaseDetail, WireCaseWrite };
