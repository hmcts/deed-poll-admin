import { describe, expect, it } from "vitest";
import { buildDocumentPreview, DOCX_PREVIEW_PAGES, PREVIEW_REFUSALS, syntheticPdf } from "./document-preview.js";
import { DOCX_BYTES, JPEG_BYTES, PNG_BYTES, pdfPages, tiff } from "./preview-sources.js";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe("syntheticPdf", () => {
  it("should write a PDF whose cross-reference table points at every object it declares", () => {
    const pdf = syntheticPdf(3, "Page").toString("latin1");
    const xref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(pdf)?.[1]);
    const offsets = [...pdf.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]));

    expect(pdf.startsWith("%PDF-1.4\n")).toBe(true);
    expect(pdf.slice(xref).startsWith("xref\n")).toBe(true);
    expect(offsets).toHaveLength(3 + 3 * 2);
    offsets.forEach((offset, index) => {
      expect(pdf.slice(offset).startsWith(`${index + 1} 0 obj\n`)).toBe(true);
    });
  });

  it("should give every page the requested size and a stream length matching its content", () => {
    const pdf = syntheticPdf(2, "Frame", [842, 595]).toString("latin1");

    expect(pdfPages(Buffer.from(pdf, "latin1"))).toBe(2);
    expect(pdf.match(/\/MediaBox \[0 0 842 595\]/g)).toHaveLength(2);
    for (const [, length, content] of pdf.matchAll(/<< \/Length (\d+) >>\nstream\n(.*)\nendstream/g)) {
      expect(Buffer.byteLength(content, "latin1")).toBe(Number(length));
    }
  });
});

describe("buildDocumentPreview", () => {
  it("should pass a complete PDF original through unchanged", () => {
    const original = syntheticPdf(4, "Original");

    const outcome = buildDocumentPreview("application/pdf", original, "convert");

    expect(outcome).toEqual({ ok: true, pdf: original });
  });

  it("should make one page of a JPEG and of a PNG", () => {
    const jpeg = buildDocumentPreview("image/jpeg", JPEG_BYTES, "convert");
    const png = buildDocumentPreview("image/png", PNG_BYTES, "convert");

    expect(jpeg.ok && pdfPages(jpeg.pdf)).toBe(1);
    expect(png.ok && pdfPages(png.pdf)).toBe(1);
  });

  it("should make one page per TIFF frame, in either byte order", () => {
    const little = buildDocumentPreview("image/tiff", tiff(3), "convert");
    const big = buildDocumentPreview("image/tiff", tiff(2, { bigEndian: true }), "convert");

    expect(little.ok && pdfPages(little.pdf)).toBe(3);
    expect(little.ok && little.pdf.toString("latin1")).toContain("(Mock preview: TIFF frame 3 of 3)");
    expect(big.ok && pdfPages(big.pdf)).toBe(2);
  });

  it("should paginate a DOCX across several portrait pages", () => {
    const outcome = buildDocumentPreview(DOCX, DOCX_BYTES, "convert");

    expect(outcome.ok && pdfPages(outcome.pdf)).toBe(DOCX_PREVIEW_PAGES);
    expect(DOCX_PREVIEW_PAGES).toBeGreaterThan(1);
    expect(outcome.ok && outcome.pdf.toString("latin1")).toContain("/MediaBox [0 0 595 842]");
  });

  it.each([
    ["a PDF with no end marker", "application/pdf", Buffer.from("%PDF-1.7\nno trailer")],
    ["bytes that are not the stored type", "image/jpeg", PNG_BYTES],
    ["a PNG without its signature", "image/png", JPEG_BYTES],
    ["a JPEG-compressed TIFF", "image/tiff", tiff(1, { compression: 7 })],
    ["a TIFF whose frame chain loops", "image/tiff", tiff(2, { loop: true })],
    ["a TIFF with no valid header", "image/tiff", Buffer.from("II*\u0000")],
    ["a DOCX that is not a package", DOCX, Buffer.from("not a zip")],
    ["a type with no preview", "application/msword", DOCX_BYTES]
  ])("should refuse %s as an invalid document", (_label, mimeType, bytes) => {
    const outcome = buildDocumentPreview(mimeType, bytes, "convert");

    expect(outcome).toEqual({ ok: false, code: "PREVIEW_INVALID_DOCUMENT", ...PREVIEW_REFUSALS.PREVIEW_INVALID_DOCUMENT });
  });

  it("should refuse a TIFF with more frames than the page limit, rather than truncating it", () => {
    const outcome = buildDocumentPreview("image/tiff", tiff(101), "convert");

    expect(outcome).toMatchObject({ ok: false, code: "PREVIEW_LIMIT_EXCEEDED", status: 422 });
  });

  it("should preview a TIFF of exactly the page limit", () => {
    const outcome = buildDocumentPreview("image/tiff", tiff(100), "convert");

    expect(outcome.ok && pdfPages(outcome.pdf)).toBe(100);
  });

  it.each([false, true])("should refuse malformed TIFF directories with bigEndian=%s", (bigEndian) => {
    const writeShort = (bytes: Buffer, value: number, at: number) => (bigEndian ? bytes.writeUInt16BE(value, at) : bytes.writeUInt16LE(value, at));
    const writeLong = (bytes: Buffer, value: number, at: number) => (bigEndian ? bytes.writeUInt32BE(value, at) : bytes.writeUInt32LE(value, at));
    const changed = (change: (bytes: Buffer) => void) => {
      const bytes = tiff(1, { bigEndian });
      change(bytes);
      return bytes;
    };
    const invalid = [
      changed((bytes) => bytes.write("XX", 0, "latin1")),
      changed((bytes) => writeShort(bytes, 43, 2)),
      changed((bytes) => writeLong(bytes, 0, 4)),
      changed((bytes) => writeLong(bytes, bytes.length - 1, 4)),
      changed((bytes) => writeShort(bytes, 0, 8)),
      changed((bytes) => writeShort(bytes, 2, 8)),
      tiff(1, { bigEndian }).subarray(0, 25),
      tiff(2, { bigEndian, loop: true }),
      tiff(1, { bigEndian, compression: 6 }),
      tiff(1, { bigEndian, compression: 7 })
    ];

    for (const bytes of invalid) {
      expect(buildDocumentPreview("image/tiff", bytes, "convert")).toEqual({
        ok: false,
        code: "PREVIEW_INVALID_DOCUMENT",
        ...PREVIEW_REFUSALS.PREVIEW_INVALID_DOCUMENT
      });
    }
  });

  it("should validate the first over-limit TIFF frame before refusing its page count", () => {
    const bytes = tiff(101);
    bytes.writeUInt16LE(7, 8 + 100 * 18 + 10);

    expect(buildDocumentPreview("image/tiff", bytes, "convert")).toMatchObject({ ok: false, code: "PREVIEW_INVALID_DOCUMENT" });
  });

  it("should stop inspecting TIFF directories after the first over-limit frame", () => {
    const bytes = tiff(101);
    bytes.writeUInt32LE(0xffffffff, bytes.length - 4);

    expect(buildDocumentPreview("image/tiff", bytes, "convert")).toMatchObject({ ok: false, code: "PREVIEW_LIMIT_EXCEEDED" });
  });

  it("should refuse only the DOCX when the converter is unavailable", () => {
    const docx = buildDocumentPreview(DOCX, DOCX_BYTES, "converter-unavailable");
    const tiffPreview = buildDocumentPreview("image/tiff", tiff(2), "converter-unavailable");

    expect(docx).toMatchObject({ ok: false, code: "PREVIEW_UNAVAILABLE", status: 503 });
    expect(tiffPreview.ok).toBe(true);
  });

  it("should still refuse a malformed DOCX as invalid when the converter is unavailable, as api checks it first", () => {
    const outcome = buildDocumentPreview(DOCX, Buffer.from("not a zip"), "converter-unavailable");

    expect(outcome).toMatchObject({ ok: false, code: "PREVIEW_INVALID_DOCUMENT" });
  });

  it("should refuse every format as busy when no permit is free", () => {
    const outcome = buildDocumentPreview("application/pdf", syntheticPdf(1, "Original"), "busy");

    expect(outcome).toMatchObject({ ok: false, code: "PREVIEW_BUSY", status: 429 });
  });
});
