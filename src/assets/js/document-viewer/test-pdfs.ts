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
      const routed = page.imageVia ? ROUTED_CONTENT[page.imageVia.via](page.imageVia.image) : "";
      const text = `${image}${routed}${page.text === undefined ? "" : `BT /F1 24 Tf 72 ${height - 96} Td (${page.text}) Tj ET`}`;
      const xObjects = page.image ? `/XObject << /Im1 ${id + 2} 0 R >>` : "";
      const routedResources = page.imageVia ? ROUTED_RESOURCES[page.imageVia.via](id) : "";
      const font = page.font ? `${id + 6} 0 R` : "3 0 R";
      const pageAnnotations = [extras.link ? "4 0 R" : "", extras.formField ? "6 0 R" : "", page.stamp ? `${id + 3} 0 R` : ""].filter(Boolean);
      const annotations = pageAnnotations.length > 0 ? `/Annots [${pageAnnotations.join(" ")}]` : "";
      return [
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] ${page.rotate ? `/Rotate ${page.rotate}` : ""} ${annotations} /Resources << /Font << /F1 ${font} >> ${xObjects} ${routedResources} >> /Contents ${id + 1} 0 R >>`,
        stream("", text),
        page.image ? imageXObject(page.image) : "null",
        ...(page.stamp ? stampObjects(id, page.stamp) : ["null", "null", "null"]),
        ...(page.font ? fontObjects(id, page.font) : ["null", "null", "null"]),
        ...(page.imageVia ? routedObjects(id, page.imageVia) : ["null", "null", "null"])
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

/**
 * The objects that carry an image some way other than the page's own `Do`: a form XObject nested in the page, a
 * tiling pattern's cell, or the group of an ExtGState soft mask. Each is a separate catch in PDF.js's evaluator that
 * the patch makes rethrow an oversized image. An inline image needs no object: it is in the content stream.
 */
function routedObjects(id: number, { via, image }: RoutedImage): string[] {
  const paint = "q 100 0 0 100 0 0 cm /Im1 Do Q";
  const imageResources = (imageId: number) => `/Resources << /XObject << /Im1 ${imageId} 0 R >> >>`;
  switch (via) {
    case "form":
      return [stream(`/Type /XObject /Subtype /Form /BBox [0 0 100 100] ${imageResources(id + 10)}`, paint), imageXObject(image), "null"];
    case "pattern":
      return [
        stream(`/Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 100 100] /XStep 100 /YStep 100 ${imageResources(id + 10)}`, paint),
        imageXObject(image),
        "null"
      ];
    case "softMask":
      return [
        `<< /Type /ExtGState /SMask << /Type /Mask /S /Luminosity /G ${id + 10} 0 R >> >>`,
        stream(`/Type /XObject /Subtype /Form /BBox [0 0 595 842] /Group << /S /Transparency /CS /DeviceGray >> ${imageResources(id + 11)}`, paint),
        imageXObject(image)
      ];
    case "inline":
      return ["null", "null", "null"];
  }
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
/**
 * The page, its content stream, its image, its stamp's three objects, its font's three and its routed image's three,
 * each `null` if absent.
 */
const OBJECTS_PER_PAGE = 12;

const ROUTED_CONTENT: Record<ImageRoute, (image: readonly [number, number]) => string> = {
  form: () => "q 2 0 0 2 72 200 cm /Fm1 Do Q ",
  pattern: () => "q /Pattern cs /P1 scn 72 200 200 200 re f Q ",
  softMask: () => "q /GS1 gs 72 200 200 200 re f Q ",
  inline: ([width, height]) => `q 100 0 0 100 72 200 cm BI /W ${width} /H ${height} /CS /G /BPC 8 ID \u0000\nEI Q `
};

const ROUTED_RESOURCES: Record<ImageRoute, (id: number) => string> = {
  form: (id) => `/XObject << /Fm1 ${id + 9} 0 R >>`,
  pattern: (id) => `/Pattern << /P1 ${id + 9} 0 R >>`,
  softMask: (id) => `/ExtGState << /GS1 ${id + 9} 0 R >>`,
  inline: () => ""
};

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
  /** An image of this declared size in pixels, reaching the page by this route rather than the page's own `Do`. */
  imageVia?: RoutedImage;
}

export type ImageRoute = "form" | "pattern" | "softMask" | "inline";

export interface RoutedImage {
  via: ImageRoute;
  image: readonly [number, number];
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
