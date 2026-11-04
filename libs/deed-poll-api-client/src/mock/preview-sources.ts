/**
 * Synthetic originals of each previewable type, for the mock's tests and the adapter's. None is a real photograph
 * or Word file: each carries only the structure `document-preview.ts` checks (magic bytes, a TIFF's frame chain), so
 * every fixture's provenance is this file.
 */

/** A JPEG's start-of-image and APP0 markers. */
export const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);

/** A PNG's signature and the start of an IHDR chunk. */
export const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);

/** A ZIP local-file header, which is how a DOCX package starts. */
export const DOCX_BYTES = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00, 0x08, 0x00]);

/**
 * A TIFF of `frames` directories, each holding one Compression entry, chained in order. `loop` points the last
 * frame back at the first; `compression` is the value every frame declares (1, none, by default).
 */
export function tiff(frames: number, options: { bigEndian?: boolean; compression?: number; loop?: boolean } = {}): Buffer {
  const { bigEndian = false, compression = 1, loop = false } = options;
  const directory = 2 + 12 + 4;
  const finalOffset = loop ? 8 : 0;
  const bytes = Buffer.alloc(8 + frames * directory);
  const short = (value: number, at: number) => (bigEndian ? bytes.writeUInt16BE(value, at) : bytes.writeUInt16LE(value, at));
  const long = (value: number, at: number) => (bigEndian ? bytes.writeUInt32BE(value, at) : bytes.writeUInt32LE(value, at));

  bytes.write(bigEndian ? "MM" : "II", 0, "latin1");
  short(42, 2);
  long(8, 4);
  for (let frame = 0; frame < frames; frame++) {
    const at = 8 + frame * directory;
    short(1, at);
    // Tag 259 (Compression), type SHORT, count 1, value in the entry.
    short(259, at + 2);
    short(3, at + 4);
    long(1, at + 6);
    short(compression, at + 10);
    const last = frame === frames - 1;
    long(last ? finalOffset : at + directory, at + 14);
  }

  return bytes;
}

/** The pages a PDF declares, by its page objects: enough to tell one preview from another without a parser. */
export function pdfPages(pdf: Buffer): number {
  return pdf.toString("latin1").match(/\/Type \/Page /g)?.length ?? 0;
}
