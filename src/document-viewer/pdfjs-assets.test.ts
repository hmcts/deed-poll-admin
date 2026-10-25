import { existsSync, readFileSync } from "node:fs";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { PDFJS_ASSET_PATH } from "../assets/js/document-viewer/pdf-document.js";
import { PDFJS_ASSET_MOUNT, pdfjsDevelopmentAssets } from "./pdfjs-assets.js";

// Yarn's patch protocol over an exact version: `patch:pdfjs-dist@npm%3A<version>#~/.yarn/patches/<file>`.
const PATCHED_PDFJS = /^patch:pdfjs-dist@npm%3A(\d+\.\d+\.\d+)#~\/(\.yarn\/patches\/pdfjs-dist-npm-\1-[0-9a-f]+\.patch)$/;

const root = (file: string) => new URL(`../../${file}`, import.meta.url);
const app = express().use(PDFJS_ASSET_MOUNT, pdfjsDevelopmentAssets());

describe("pdfjsDevelopmentAssets", () => {
  it("should serve PDF.js's data at the path the renderer asks for", () => {
    expect(PDFJS_ASSET_PATH).toBe(`${PDFJS_ASSET_MOUNT}/`);
  });

  it("should serve a standard font, a CMap and the plain-JavaScript image decoders", async () => {
    const font = await request(app).get(`${PDFJS_ASSET_MOUNT}/standard_fonts/FoxitSerif.pfb`);
    const cmap = await request(app).get(`${PDFJS_ASSET_MOUNT}/cmaps/Adobe-Japan1-UCS2.bcmap`);
    const openjpeg = await request(app).get(`${PDFJS_ASSET_MOUNT}/wasm/openjpeg_nowasm_fallback.js`);
    const jbig2 = await request(app).get(`${PDFJS_ASSET_MOUNT}/wasm/jbig2_nowasm_fallback.js`);

    expect([font.status, cmap.status, openjpeg.status, jbig2.status]).toEqual([200, 200, 200, 200]);
  });

  it("should not serve WebAssembly or the scripting engine, which production does not ship either", async () => {
    const wasm = await request(app).get(`${PDFJS_ASSET_MOUNT}/wasm/openjpeg.wasm`);
    const scripting = await request(app).get(`${PDFJS_ASSET_MOUNT}/wasm/quickjs-eval.js`);

    expect([wasm.status, scripting.status]).toEqual([404, 404]);
  });
});

describe("PDF.js packaging", () => {
  // The patch that makes a failed page render reject (docs/pdfjs-render-error-upstream-issue.md) is a committed file,
  // so a resolution naming one that is not there would fail every install.
  it("should pin PDF.js exactly through a committed patch, as a build-time dependency the production image does not install", () => {
    const manifest = JSON.parse(readFileSync(root("package.json"), "utf8"));

    const resolution = PATCHED_PDFJS.exec(manifest.devDependencies["pdfjs-dist"]);
    if (!resolution) throw new Error(`pdfjs-dist is not resolved through a patch: ${manifest.devDependencies["pdfjs-dist"]}`);

    expect(existsSync(root(resolution[2]))).toBe(true);
    expect(manifest.dependencies["pdfjs-dist"]).toBeUndefined();
  });

  it("should copy the fallback decoders under the names the pinned worker imports", () => {
    const worker = readFileSync(root("node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"), "utf8");
    const named = [...worker.matchAll(/_noWasmFilename = "([^"]+)"/g)].map((match) => match[1]).sort();
    const build = readFileSync(root("vite.build.ts"), "utf8");

    expect(named).toEqual(["jbig2_nowasm_fallback.js", "openjpeg_nowasm_fallback.js"]);
    expect(build).toContain("node_modules/pdfjs-dist/wasm/*_nowasm_fallback.js");
  });
});
