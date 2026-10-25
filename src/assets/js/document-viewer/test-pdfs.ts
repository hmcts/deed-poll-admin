/**
 * Real PDFs for the renderer's tests, written out object by object with a correct cross-reference table so PDF.js
 * parses them as it would a preview from api. Synthetic and tiny: no fixture file is checked in and no applicant
 * document is involved. Test-only; nothing the viewer ships imports this.
 */

export function testPdf(pages: readonly TestPage[], extras: PdfExtras = {}): Uint8Array<ArrayBuffer> {
  const pageIds = pages.map((_, index) => FIRST_PAGE_ID + index * OBJECTS_PER_PAGE);
  const catalog = [
    "/Type /Catalog /Pages 2 0 R",
    extras.openActionScript ? "/OpenAction 5 0 R" : "",
    extras.formField ? "/AcroForm << /Fields [6 0 R] >>" : ""
  ];
  const objects = [
    `<< ${catalog.filter(Boolean).join(" ")} >>`,
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Annot /Subtype /Link /Rect [72 72 300 100] /A << /S /URI /URI (https://example.invalid/) >> >>",
    `<< /S /JavaScript /JS (${extras.openActionScript ?? ""}) >>`,
    "<< /FT /Tx /T (field) /V (Filled value) /Rect [72 120 300 150] /Subtype /Widget /Type /Annot >>",
    ...pages.flatMap((page, index) => {
      const id = pageIds[index];
      const [width, height] = page.size ?? A4_PORTRAIT;
      const image = page.image ? "q 451 0 0 451 72 200 cm /Im1 Do Q " : "";
      const text = `${image}${page.text === undefined ? "" : `BT /F1 24 Tf 72 ${height - 96} Td (${page.text}) Tj ET`}`;
      const xObjects = page.image ? `/XObject << /Im1 ${id + 2} 0 R >>` : "";
      const font = page.font ? `${id + 6} 0 R` : "3 0 R";
      const pageAnnotations = [extras.link ? "4 0 R" : "", extras.formField ? "6 0 R" : "", page.stamp ? `${id + 3} 0 R` : ""].filter(Boolean);
      const annotations = pageAnnotations.length > 0 ? `/Annots [${pageAnnotations.join(" ")}]` : "";
      return [
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] ${page.rotate ? `/Rotate ${page.rotate}` : ""} ${annotations} /Resources << /Font << /F1 ${font} >> ${xObjects} >> /Contents ${id + 1} 0 R >>`,
        stream("", text),
        page.image ? imageXObject(page.image) : "null",
        ...(page.stamp ? stampObjects(id, page.stamp) : ["null", "null", "null"]),
        ...(page.font ? fontObjects(id, page.font) : ["null", "null", "null"])
      ];
    })
  ];

  let body = "%PDF-1.7\n";
  const offsets = objects.map((object, index) => {
    const offset = body.length;
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  return new TextEncoder().encode(body);
}

/**
 * A one-byte grey image declaring the given size. PDF.js weighs an image's declared `/Width` and `/Height` against
 * `maxImageSize` before reading any of its data, so one byte is enough to stand for a scan of any size.
 */
function imageXObject([width, height]: readonly [number, number]): string {
  return stream(`/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 8`, "\u0000");
}

/** A rubber stamp whose appearance paints an image, as a signature or an "approved" stamp does. */
function stampObjects(id: number, image: readonly [number, number]): string[] {
  return [
    `<< /Type /Annot /Subtype /Stamp /F 4 /Rect [72 400 272 600] /AP << /N ${id + 4} 0 R >> >>`,
    stream(`/Type /XObject /Subtype /Form /BBox [0 0 200 200] /Resources << /XObject << /Im1 ${id + 5} 0 R >> >>`, "q 200 0 0 200 0 0 cm /Im1 Do Q"),
    imageXObject(image)
  ];
}

/**
 * The page's font, broken in the given way: `emptyFontFile` embeds a TrueType program of no bytes, and
 * `malformedToUnicode` gives Helvetica a ToUnicode map building on a CMap that does not exist. PDF.js reads past
 * either with a substitute, so the text still shows.
 */
function fontObjects(id: number, broken: BrokenFont): string[] {
  if (broken === "malformedToUnicode") {
    return [
      `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /ToUnicode ${id + 7} 0 R >>`,
      stream("", "/CIDInit /ProcSet findresource begin 12 dict begin begincmap /Not-A-Real-CMap usecmap endcmap end end"),
      "null"
    ];
  }
  return [
    `<< /Type /Font /Subtype /TrueType /BaseFont /EmptyEmbedded /Encoding /WinAnsiEncoding /FontDescriptor ${id + 7} 0 R >>`,
    `<< /Type /FontDescriptor /FontName /EmptyEmbedded /Flags 32 /FontBBox [0 -200 1000 800] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 /FontFile2 ${id + 8} 0 R >>`,
    stream("", "")
  ];
}

function stream(dictionary: string, content: string): string {
  return `<< ${dictionary} /Length ${content.length} >>\nstream\n${content}\nendstream`;
}

/** `count` portrait pages, each saying which page it is. */
export function pagesSaying(count: number): TestPage[] {
  return Array.from({ length: count }, (_, index) => ({ text: `Page ${index + 1} of ${count}` }));
}

export const A4_PORTRAIT = [595, 842] as const;
export const A4_LANDSCAPE = [842, 595] as const;

const FIRST_PAGE_ID = 7;
/** The page, its content stream, its image, its stamp's three objects and its font's three, each `null` if absent. */
const OBJECTS_PER_PAGE = 9;

export interface TestPage {
  text?: string;
  size?: readonly [number, number];
  rotate?: 90 | 180 | 270;
  /** An image of this declared size in pixels, drawn under the page's text. */
  image?: readonly [number, number];
  /** A stamp annotation whose appearance paints an image of this declared size in pixels. */
  stamp?: readonly [number, number];
  /** The page's text is set in a font broken this way. */
  font?: BrokenFont;
}

export type BrokenFont = "emptyFontFile" | "malformedToUnicode";

export interface PdfExtras {
  /** A document-level script run on open by a viewer that executes scripts. */
  openActionScript?: string;
  /** A link annotation on every page. */
  link?: boolean;
  /** A filled text field on every page. */
  formField?: boolean;
}
