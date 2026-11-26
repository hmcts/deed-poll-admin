import { NotFoundError } from "@hmcts/deed-poll";
import { describe, expect, it } from "vitest";
import { caseDocumentsPath, documentDeletedPath, documentDeletionConfirmationPath, documentDeletionStatusPath } from "./paths.js";

describe("document deletion paths", () => {
  it("should build every address under its case, encoding each id once", () => {
    expect(documentDeletionConfirmationPath("case/1", "doc?1")).toBe("/deed-polls/case%2F1/documents/doc%3F1/delete");
    expect(documentDeletionStatusPath("case-1", "req#1")).toBe("/deed-polls/case-1/document-deletions/req%231");
    expect(caseDocumentsPath("case-1")).toBe("/deed-polls/case-1#documents");
    expect(documentDeletedPath("case-1")).toBe("/deed-polls/case-1?document=deleted#documents");
  });

  it("should refuse a dot-only or empty id rather than build a path a browser would collapse", () => {
    expect(() => documentDeletionConfirmationPath("case-1", "..")).toThrow(NotFoundError);
    expect(() => documentDeletionStatusPath("case-1", "")).toThrow(NotFoundError);
    expect(() => documentDeletionConfirmationPath(".", "doc-1")).toThrow(NotFoundError);
  });
});
