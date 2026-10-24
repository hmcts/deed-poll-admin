/**
 * Real PDFs for the renderer's tests, written out object by object with a correct cross-reference table so PDF.js
 * parses them as it would a preview from api. Synthetic and tiny: no fixture file is checked in and no applicant
 * document is involved. Test-only; nothing the viewer ships imports this.
 */

export function testPdf(pages: readonly TestPage[], extras: PdfExtras = {}): Uint8Array<ArrayBuffer> {
  const pageIds = pages.map((_, index) => FIRST_PAGE_ID + index * 2);
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
      const [width, height] = page.size ?? A4_PORTRAIT;
      const text = page.text === undefined ? "" : `BT /F1 24 Tf 72 ${height - 96} Td (${page.text}) Tj ET`;
      const annotations = extras.link || extras.formField ? `/Annots [${extras.link ? "4 0 R " : ""}${extras.formField ? "6 0 R" : ""}]` : "";
      return [
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] ${page.rotate ? `/Rotate ${page.rotate}` : ""} ${annotations} /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[index] + 1} 0 R >>`,
        `<< /Length ${text.length} >>\nstream\n${text}\nendstream`
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

/** `count` portrait pages, each saying which page it is. */
export function pagesSaying(count: number): TestPage[] {
  return Array.from({ length: count }, (_, index) => ({ text: `Page ${index + 1} of ${count}` }));
}

export const A4_PORTRAIT = [595, 842] as const;
export const A4_LANDSCAPE = [842, 595] as const;

const FIRST_PAGE_ID = 7;

export interface TestPage {
  text?: string;
  size?: readonly [number, number];
  rotate?: 90 | 180 | 270;
}

export interface PdfExtras {
  /** A document-level script run on open by a viewer that executes scripts. */
  openActionScript?: string;
  /** A link annotation on every page. */
  link?: boolean;
  /** A filled text field on every page. */
  formField?: boolean;
}
