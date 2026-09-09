import type { Document } from "@hmcts/deed-poll-api-client";
import { describe, expect, it } from "vitest";
import { NOT_PROVIDED } from "../deed-poll/detail-view.js";
import { buildDocumentsView, DOCUMENT_COLUMNS } from "./documents-view.js";

const document: Document = {
  id: "doc-1",
  name: "Birth certificate",
  direction: "Incoming",
  documentType: { id: "type-1", name: "Birth certificate", applicableMaritalStatuses: [], applicableTypes: [] },
  hasFile: true,
  originalName: "birth.pdf",
  mimeType: "application/pdf",
  sizeBytes: 41,
  createdOn: new Date("2026-03-01T00:00:00.000Z"),
  modifiedOn: new Date("2026-03-01T00:00:00.000Z")
};

describe("documents/documents-view", () => {
  it("labels the direction rather than showing the enum member", () => {
    expect(buildDocumentsView([document])[0].direction).toBe("Incoming");
  });

  it("formats the added date GOV.UK style, in UTC", () => {
    expect(buildDocumentsView([document])[0].added).toBe("1 March 2026");
  });

  it("takes the type name from the loaded relation", () => {
    expect(buildDocumentsView([document])[0].type).toBe("Birth certificate");
  });

  it("says the type is not provided when the relation was not loaded", () => {
    // The FK is required, so an absent relation means "not included in the query" rather than "no
    // type" — the placeholder is a claim about the query, not about the data.
    const row = buildDocumentsView([{ ...document, documentType: null }])[0];

    expect(row.type).toBe(NOT_PROVIDED);
  });

  it("marks a document with an attached file as downloadable", () => {
    expect(buildDocumentsView([document])[0].downloadable).toBe(true);
  });

  it("does not mark a metadata-only document as downloadable", () => {
    // A metadata row can exist before its file arrives, so a link would 404 for a document that is
    // legitimately still pending. api answers that question with `hasFile`.
    const row = buildDocumentsView([{ ...document, hasFile: false }])[0];

    expect(row.downloadable).toBe(false);
  });

  it("carries the id so the row can link to the download", () => {
    expect(buildDocumentsView([document])[0].id).toBe("doc-1");
  });

  it("returns an empty array for no documents, so the page renders its own empty state", () => {
    expect(buildDocumentsView([])).toEqual([]);
  });

  it("has a heading for every displayed cell", () => {
    const row = buildDocumentsView([document])[0];
    const cells = Object.keys(row).filter((key) => key !== "id" && key !== "downloadable");

    expect(cells).toHaveLength(DOCUMENT_COLUMNS.length);
  });

  it("preserves the order it was given, since the domain decides the sort", () => {
    const rows = buildDocumentsView([document, { ...document, id: "doc-2" }]);

    expect(rows.map((r) => r.id)).toEqual(["doc-1", "doc-2"]);
  });
});
