import { GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initDocumentViewer } from "./viewer.js";

const ADMITTED = new Error("Viewer configuration admitted");

describe("document viewer admission", () => {
  beforeEach(() => {
    // Stop at the first renderer side effect, after the real public initializer has checked its DOM inputs.
    vi.spyOn(GlobalWorkerOptions, "workerSrc", "set").mockImplementation(() => {
      throw ADMITTED;
    });
  });

  afterEach(() => vi.restoreAllMocks());

  describe.each(["maxPages", "maxBytes"] as const)("%s", (limit) => {
    it.each([undefined, "", " ", "not-a-number", "NaN", "0", "-0", "-1", "-Infinity"])("should leave the viewer untouched when the limit is %s", (value) => {
      const root = viewerRoot({ [limit]: value });

      expect(() => initDocumentViewer(root)).not.toThrow();
    });

    it.each(["1", "0.5", "100", "Infinity"])("should admit a positive limit of %s", (value) => {
      const root = viewerRoot({ [limit]: value });

      expect(() => initDocumentViewer(root)).toThrow(ADMITTED);
    });
  });

  it.each(["[data-viewer-retry]", "[data-viewer-selector] select"])("should leave the viewer untouched without %s", (selector) => {
    const root = viewerRoot({}, selector);

    expect(() => initDocumentViewer(root)).not.toThrow();
  });

  it("should leave the viewer untouched when the selected preview is not in the document list", () => {
    const root = viewerRoot({ previewUrl: "/missing-preview" });

    expect(() => initDocumentViewer(root)).not.toThrow();
  });
});

function viewerRoot(dataset: Partial<Record<"maxPages" | "maxBytes" | "previewUrl", string | undefined>> = {}, missingSelector?: string): HTMLElement {
  const control = {};
  const select = {
    options: [{ value: "document-1", text: "Document", dataset: { viewUrl: "/view", previewUrl: "/preview", downloadUrl: "/file" } }]
  };

  // Only these structural DOM reads precede worker configuration; no rendering or browser API is simulated.
  return {
    dataset: { previewUrl: "/preview", maxPages: "100", maxBytes: "1000000", ...dataset },
    querySelector: (selector: string) => {
      if (selector === missingSelector) return null;
      return selector === "[data-viewer-selector] select" ? select : control;
    },
    querySelectorAll: () => []
  } as unknown as HTMLElement;
}
