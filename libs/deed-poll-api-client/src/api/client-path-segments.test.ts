/**
 * No id that is empty, `.` or `..` ever reaches api's path (review finding R11).
 *
 * `encodeURIComponent` leaves dots alone, so such an id would change which path is requested rather than name
 * a resource: `getCase("..")` asked for `/caseworker/`. Against a server that records every path it is sent,
 * because the claim is about what leaves the adapter, which the mock would answer for rather than reveal.
 */
import { createServer } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type ApiConfig,
  type ApiResult,
  claimJudicialReferral,
  closeReferral,
  createNote,
  createReferral,
  createWitness,
  deleteNote,
  deleteSavedQuery,
  deleteWitness,
  deselectSavedQuery,
  directJudicialReferral,
  downloadDocument,
  downloadJudicialDocument,
  getCase,
  getCaseEmails,
  getGazetteMembers,
  getGazetteStatus,
  getJudicialReferral,
  getNote,
  getReferral,
  getSavedQuery,
  getWitness,
  listNotes,
  listReferrals,
  listWitnesses,
  patchCase,
  patchNote,
  patchSavedQuery,
  previewEmail,
  recordConfirmation,
  reviseDirection,
  selectSavedQuery,
  sendEmail,
  updateWitness,
  uploadDocument,
  withdrawDirection,
  withdrawReferral
} from "./client.js";

const KEY = "6f1c2a4e-8b3d-4f5a-9c7e-1d2b3a4c5d6e";
const UPLOAD = { documentTypeId: "type-1", name: "a.pdf", mimeType: "application/pdf", bytes: new Uint8Array([37, 80, 68, 70]) };
const UNUSABLE = ["", ".", ".."];

// Each operation with its ids in order, so every position can be made unusable on its own.
const OPERATIONS: Operation[] = [
  { name: "getGazetteStatus", ids: ["batch-1"], path: "/caseworker/gazette-notices/batch-1", call: ([a], c) => getGazetteStatus(a, c) },
  {
    name: "getGazetteMembers",
    ids: ["batch-1"],
    path: "/caseworker/gazette-notices/batch-1/cases?page=1",
    call: ([a], c) => getGazetteMembers(a, { page: 1 }, c)
  },
  { name: "getCase", ids: ["case-1"], path: "/caseworker/cases/case-1", call: ([a], c) => getCase(a, c) },
  { name: "patchCase", ids: ["case-1"], path: "/caseworker/cases/case-1", call: ([a], c) => patchCase(a, {}, c) },
  { name: "listNotes", ids: ["case-1"], path: "/caseworker/cases/case-1/notes", call: ([a], c) => listNotes(a, c) },
  { name: "getNote", ids: ["case-1", "note-1"], path: "/caseworker/cases/case-1/notes/note-1", call: ([a, b], c) => getNote(a, b, c) },
  { name: "createNote", ids: ["case-1"], path: "/caseworker/cases/case-1/notes", call: ([a], c) => createNote(a, "text", c) },
  { name: "patchNote", ids: ["case-1", "note-1"], path: "/caseworker/cases/case-1/notes/note-1", call: ([a, b], c) => patchNote(a, b, "text", c) },
  { name: "deleteNote", ids: ["case-1", "note-1"], path: "/caseworker/cases/case-1/notes/note-1", call: ([a, b], c) => deleteNote(a, b, c) },
  { name: "listWitnesses", ids: ["case-1"], path: "/caseworker/cases/case-1/witnesses", call: ([a], c) => listWitnesses(a, c) },
  { name: "getWitness", ids: ["case-1", "w-1"], path: "/caseworker/cases/case-1/witnesses/w-1", call: ([a, b], c) => getWitness(a, b, c) },
  { name: "createWitness", ids: ["case-1"], path: "/caseworker/cases/case-1/witnesses", call: ([a], c) => createWitness(a, {} as never, c) },
  { name: "updateWitness", ids: ["case-1", "w-1"], path: "/caseworker/cases/case-1/witnesses/w-1", call: ([a, b], c) => updateWitness(a, b, {}, c) },
  { name: "deleteWitness", ids: ["case-1", "w-1"], path: "/caseworker/cases/case-1/witnesses/w-1", call: ([a, b], c) => deleteWitness(a, b, c) },
  { name: "uploadDocument", ids: ["case-1"], path: "/caseworker/cases/case-1/documents", call: ([a], c) => uploadDocument(a, UPLOAD, c) },
  {
    name: "downloadDocument",
    ids: ["case-1", "doc-1"],
    path: "/caseworker/cases/case-1/documents/doc-1/file",
    call: ([a, b], c) => downloadDocument(a, b, c)
  },
  {
    name: "downloadJudicialDocument",
    ids: ["ref-1", "doc-1"],
    path: "/judicial/referrals/ref-1/documents/doc-1/file",
    call: ([a, b], c) => downloadJudicialDocument(a, b, c)
  },
  { name: "listReferrals", ids: ["case-1"], path: "/caseworker/cases/case-1/referrals", call: ([a], c) => listReferrals(a, c) },
  { name: "getReferral", ids: ["case-1", "ref-1"], path: "/caseworker/cases/case-1/referrals/ref-1", call: ([a, b], c) => getReferral(a, b, c) },
  {
    name: "createReferral",
    ids: ["case-1"],
    path: "/caseworker/cases/case-1/referrals",
    call: ([a], c) => createReferral(a, { reasons: ["Minor"] }, c)
  },
  {
    name: "withdrawReferral",
    ids: ["case-1", "ref-1"],
    path: "/caseworker/cases/case-1/referrals/ref-1/withdrawal",
    call: ([a, b], c) => withdrawReferral(a, b, c)
  },
  {
    name: "closeReferral",
    ids: ["case-1", "ref-1"],
    path: "/caseworker/cases/case-1/referrals/ref-1/closure",
    call: ([a, b], c) => closeReferral(a, b, c)
  },
  {
    name: "recordConfirmation",
    ids: ["case-1", "ref-1"],
    path: "/caseworker/cases/case-1/referrals/ref-1/confirmation",
    call: ([a, b], c) => recordConfirmation(a, b, {} as never, c)
  },
  { name: "getCaseEmails", ids: ["case-1"], path: "/caseworker/cases/case-1/emails", call: ([a], c) => getCaseEmails(a, c) },
  {
    name: "previewEmail",
    ids: ["case-1", "tpl"],
    path: "/caseworker/cases/case-1/emails/tpl/preview",
    call: ([a, b], c) => previewEmail(a, b, {} as never, c)
  },
  { name: "sendEmail", ids: ["case-1", "tpl"], path: "/caseworker/cases/case-1/emails/tpl", call: ([a, b], c) => sendEmail(a, b, {} as never, KEY, c) },
  { name: "getSavedQuery", ids: ["q-1"], path: "/caseworker/saved-queries/q-1", call: ([a], c) => getSavedQuery(a, c) },
  { name: "patchSavedQuery", ids: ["q-1"], path: "/caseworker/saved-queries/q-1", call: ([a], c) => patchSavedQuery(a, {}, c) },
  { name: "deleteSavedQuery", ids: ["q-1"], path: "/caseworker/saved-queries/q-1", call: ([a], c) => deleteSavedQuery(a, c) },
  { name: "selectSavedQuery", ids: ["q-1"], path: "/caseworker/saved-queries/q-1/selection", call: ([a], c) => selectSavedQuery(a, c) },
  { name: "deselectSavedQuery", ids: ["q-1"], path: "/caseworker/saved-queries/q-1/selection", call: ([a], c) => deselectSavedQuery(a, c) },
  { name: "getJudicialReferral", ids: ["ref-1"], path: "/judicial/referrals/ref-1", call: ([a], c) => getJudicialReferral(a, c) },
  { name: "claimJudicialReferral", ids: ["ref-1"], path: "/judicial/referrals/ref-1/claim", call: ([a], c) => claimJudicialReferral(a, c) },
  {
    name: "directJudicialReferral",
    ids: ["ref-1"],
    path: "/judicial/referrals/ref-1/direction",
    call: ([a], c) => directJudicialReferral(a, {} as never, c)
  },
  { name: "reviseDirection", ids: ["ref-1"], path: "/judicial/referrals/ref-1/direction", call: ([a], c) => reviseDirection(a, {} as never, c) },
  { name: "withdrawDirection", ids: ["ref-1"], path: "/judicial/referrals/ref-1/direction/withdraw", call: ([a], c) => withdrawDirection(a, c) }
];

const UNUSABLE_CASES = OPERATIONS.flatMap((operation) =>
  operation.ids.flatMap((_, position) =>
    UNUSABLE.map((bad) => ({ label: `${operation.name} with ${JSON.stringify(bad)} as id ${position + 1}`, operation, bad, position }))
  )
);

const paths: string[] = [];
let config: ApiConfig;
let close: () => Promise<void>;

describe("client path segments", () => {
  beforeAll(async () => {
    const server = createServer((req, res) => {
      paths.push(req.url ?? "");
      req.resume();
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: "nothing here" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    config = { baseUrl: `http://127.0.0.1:${address && typeof address === "object" ? address.port : 0}`, accessToken: "synthetic-token" };
    close = () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  afterAll(() => close());

  beforeEach(() => {
    paths.length = 0;
  });

  it.each(UNUSABLE_CASES)("should answer not-found without any request for $label", async ({ operation, bad, position }) => {
    const ids = operation.ids.map((id, index) => (index === position ? bad : id));

    const result = await operation.call(ids, config);

    expect(paths).toEqual([]);
    expect(result).toEqual({ ok: false, error: { kind: "not-found", status: 404, message: "deed-poll-api path would contain an unusable id" } });
  });

  it.each(OPERATIONS)("should request exactly today's path for $name with ordinary ids", async ({ ids, path, call }) => {
    await call(ids, config);

    expect(paths).toEqual([path]);
  });

  it("should still encode an id with other characters once, dots included", async () => {
    await getNote("a/b", "...", config);
    await getCase("%2E%2E", config);
    await getCase(".hidden", config);

    expect(paths).toEqual(["/caseworker/cases/a%2Fb/notes/...", "/caseworker/cases/%252E%252E", "/caseworker/cases/.hidden"]);
  });
});

interface Operation {
  name: string;
  ids: string[];
  path: string;
  call: (ids: string[], config: ApiConfig) => Promise<ApiResult<unknown>>;
}
