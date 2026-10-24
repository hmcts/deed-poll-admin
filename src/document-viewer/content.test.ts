import { describe, expect, it } from "vitest";
import { cy, en } from "./content.js";

describe("document viewer content", () => {
  it("should give Welsh the same shape as English, so no label is missing in either language", () => {
    expect(Object.keys(cy).sort()).toEqual(Object.keys(en).sort());
    expect(Object.keys(cy.messages).sort()).toEqual(Object.keys(en.messages).sort());
    expect(Object.keys(cy.formats).sort()).toEqual(Object.keys(en.formats).sort());
  });

  it("should name every allowed upload format", () => {
    expect(Object.keys(en.formats).sort()).toEqual(["docx", "jpeg", "pdf", "png", "tiff"]);
  });

  it("should state the document's position from the numbers it is given", () => {
    expect(en.documentPosition(2, 5)).toBe("Document 2 of 5");
  });

  it("should offer the original download in every preview failure that concerns the document", () => {
    for (const key of ["unavailable", "tooLarge", "busy", "failed"] as const) {
      expect(en.messages[key]).toContain("download the original");
    }
  });
});
