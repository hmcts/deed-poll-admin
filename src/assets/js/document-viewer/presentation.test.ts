import { describe, expect, it } from "vitest";
import {
  canGoToPage,
  canZoom,
  clampPresentation,
  DEFAULT_PRESENTATION,
  effectiveScale,
  neighbours,
  type Presentation,
  parsePageNumber,
  presentationFragment,
  presentationFromFragment,
  presentationsForHistory,
  presentationsFromHistory,
  rotateClockwise,
  stepZoom,
  zoomPercent
} from "./presentation.js";

const A4 = { width: 595, height: 842 };

describe("presentation", () => {
  describe("DEFAULT_PRESENTATION", () => {
    it("should open on the first page, fitted to width, the right way up", () => {
      expect(DEFAULT_PRESENTATION).toEqual({ page: 1, zoom: { mode: "width" }, rotation: 0 });
    });
  });

  describe("clampPresentation", () => {
    it("should move a remembered page past the end of a shorter preview to its last page", () => {
      const remembered: Presentation = { page: 7, zoom: { mode: "custom", scale: 1.5 }, rotation: 90 };

      expect(clampPresentation(remembered, 3)).toEqual({ page: 3, zoom: { mode: "custom", scale: 1.5 }, rotation: 90 });
    });

    it("should keep a page the preview has, returning the same presentation", () => {
      const remembered: Presentation = { ...DEFAULT_PRESENTATION, page: 2 };

      expect(clampPresentation(remembered, 3)).toBe(remembered);
    });

    it("should keep the only page of a one-page image", () => {
      expect(clampPresentation({ ...DEFAULT_PRESENTATION, page: 4 }, 1).page).toBe(1);
    });
  });

  describe("parsePageNumber", () => {
    it.each([
      ["2", 2],
      [" 3 ", 3],
      ["5", 5]
    ])("should accept %j as page %i of five", (text, page) => {
      expect(parsePageNumber(text, 5)).toBe(page);
    });

    it.each(["0", "6", "", " ", "2.5", "-1", "+2", "1e0", "0x2", "two", "２", "1234567"])("should refuse %j for a five-page preview", (text) => {
      expect(parsePageNumber(text, 5)).toBeNull();
    });
  });

  describe("canGoToPage", () => {
    it("should refuse the page before the first and after the last, so a one-page image has neither", () => {
      expect([canGoToPage(0, 1), canGoToPage(1, 1), canGoToPage(2, 1)]).toEqual([false, true, false]);
    });
  });

  describe("effectiveScale", () => {
    it("should fit the page's width to the frame's", () => {
      expect(effectiveScale({ mode: "width" }, A4, { width: 1190, height: 500 })).toBe(2);
    });

    it("should fit the whole page by whichever side is tighter", () => {
      expect(effectiveScale({ mode: "page" }, A4, { width: 1190, height: 421 })).toBe(0.5);
    });

    it("should fit a rotated (landscape) page by its rotated sides", () => {
      expect(effectiveScale({ mode: "page" }, { width: 842, height: 595 }, { width: 421, height: 1000 })).toBe(0.5);
    });

    it("should keep both fits inside 25–300%", () => {
      expect(effectiveScale({ mode: "width" }, { width: 100, height: 100 }, { width: 1000, height: 1000 })).toBe(3);
      expect(effectiveScale({ mode: "page" }, { width: 10_000, height: 10_000 }, { width: 100, height: 100 })).toBe(0.25);
    });

    it("should use a chosen zoom whatever the frame, still inside the range", () => {
      expect(effectiveScale({ mode: "custom", scale: 1.5 }, A4, { width: 10, height: 10 })).toBe(1.5);
      expect(effectiveScale({ mode: "custom", scale: 9 }, A4, { width: 10, height: 10 })).toBe(3);
    });

    it("should draw at 100% while the frame has no size yet", () => {
      expect(effectiveScale({ mode: "width" }, A4, { width: 0, height: 0 })).toBe(1);
    });
  });

  describe("stepZoom", () => {
    it("should move from a fitted 87% to the next ten per cent either way", () => {
      expect(stepZoom(0.87, 1)).toEqual({ mode: "custom", scale: 0.9 });
      expect(stepZoom(0.87, -1)).toEqual({ mode: "custom", scale: 0.8 });
    });

    it("should move a whole ten by a full step", () => {
      expect(stepZoom(1, 1)).toEqual({ mode: "custom", scale: 1.1 });
      expect(stepZoom(1, -1)).toEqual({ mode: "custom", scale: 0.9 });
    });

    it("should stop at 25% and 300%", () => {
      expect(stepZoom(0.25, -1)).toEqual({ mode: "custom", scale: 0.25 });
      expect(stepZoom(3, 1)).toEqual({ mode: "custom", scale: 3 });
    });
  });

  describe("canZoom", () => {
    it("should refuse zooming out at 25% and in at 300%, and allow both between", () => {
      expect([canZoom(0.25, -1), canZoom(0.25, 1), canZoom(3, 1), canZoom(3, -1), canZoom(1, 1), canZoom(1, -1)]).toEqual([
        false,
        true,
        false,
        true,
        true,
        true
      ]);
    });
  });

  describe("zoomPercent", () => {
    it("should show the scale as a whole percentage", () => {
      expect(zoomPercent(0.8749)).toBe("87%");
    });
  });

  describe("rotateClockwise", () => {
    it("should turn a quarter at a time and come back round", () => {
      expect([rotateClockwise(0), rotateClockwise(90), rotateClockwise(180), rotateClockwise(270)]).toEqual([90, 180, 270, 0]);
    });
  });

  describe("presentationFragment and presentationFromFragment", () => {
    it.each<Presentation>([
      DEFAULT_PRESENTATION,
      { page: 12, zoom: { mode: "page" }, rotation: 270 },
      { page: 2, zoom: { mode: "custom", scale: 1.5 }, rotation: 90 }
    ])("should read back the fragment it writes for %j", (presentation) => {
      expect(presentationFromFragment(presentationFragment(presentation))).toEqual(presentation);
    });

    it("should write the page, zoom and rotation and nothing else", () => {
      expect(presentationFragment({ page: 2, zoom: { mode: "custom", scale: 1.5 }, rotation: 90 })).toBe("#page=2&zoom=150&rotate=90");
    });

    it.each([
      "",
      "#",
      "#documents",
      "#page=0&zoom=width&rotate=0",
      "#page=2&zoom=width&rotate=45",
      "#page=2&zoom=10&rotate=0",
      "#page=2&zoom=301&rotate=0",
      "#page=2&zoom=fit&rotate=0",
      "#page=2&zoom=width&rotate=0&name=Deed",
      "#zoom=width&page=2&rotate=0",
      "#page=2&page=3&zoom=width&rotate=0",
      "#page=1e3&zoom=width&rotate=0"
    ])("should ignore %j whole", (hash) => {
      expect(presentationFromFragment(hash)).toBeNull();
    });

    it("should leave a page past the end for clamping once the page count is known", () => {
      expect(presentationFromFragment("#page=999&zoom=width&rotate=0")?.page).toBe(999);
    });
  });

  describe("presentationsForHistory and presentationsFromHistory", () => {
    it("should keep each document's place by id through a history entry", () => {
      const remembered = new Map<string, Presentation>([
        ["doc/a", { page: 3, zoom: { mode: "page" }, rotation: 0 }],
        ["doc-b", { page: 1, zoom: { mode: "custom", scale: 2 }, rotation: 180 }]
      ]);

      const state = presentationsForHistory(remembered);

      expect(state).toEqual({
        documentViewer: [
          ["doc/a", "#page=3&zoom=page&rotate=0"],
          ["doc-b", "#page=1&zoom=200&rotate=180"]
        ]
      });
      expect(presentationsFromHistory(JSON.parse(JSON.stringify(state)))).toEqual(remembered);
    });

    it.each([null, undefined, "x", {}, { documentViewer: "x" }, { documentViewer: {} }])("should remember nothing from %j", (state) => {
      expect(presentationsFromHistory(state).size).toBe(0);
    });

    it("should drop a malformed entry and keep the valid ones", () => {
      const state = {
        documentViewer: [
          ["doc-a", "#page=2&zoom=width&rotate=0"],
          ["doc-b", "#page=2&zoom=width&rotate=45"],
          [7, "#page=2&zoom=width&rotate=0"],
          ["doc-c"],
          "doc-d"
        ]
      };

      expect([...presentationsFromHistory(state).keys()]).toEqual(["doc-a"]);
    });
  });

  describe("neighbours", () => {
    const documents = [{ id: "a" }, { id: "b" }, { id: "c" }];

    it("should name the documents either side, in the context's order", () => {
      expect(neighbours(documents, "b")).toEqual({ previous: { id: "a" }, next: { id: "c" } });
    });

    it("should offer no previous document on the first and no next on the last", () => {
      expect(neighbours(documents, "a")).toMatchObject({ previous: null });
      expect(neighbours(documents, "c")).toMatchObject({ next: null });
    });

    it("should offer neither for the only document", () => {
      expect(neighbours([{ id: "a" }], "a")).toEqual({ previous: null, next: null });
    });

    it("should offer nothing for a document outside the context", () => {
      expect(neighbours(documents, "z")).toEqual({ previous: null, next: null });
    });
  });
});
