/**
 * PDF.js's data files in development, at the same `/assets/pdfjs/` paths the production build copies them to
 * (`vite.build.ts`). The vite middleware serves the viewer's scripts and the worker, but not a package's data
 * directories, so without this a development viewer would render non-embedded fonts with system substitutes
 * and fail every JPEG 2000 or JBIG2 image that production renders.
 *
 * Only the plain-JavaScript image decoders are served from `wasm/`, as in production: the viewer runs with
 * `useWasm: false`, and nothing here should let a development run succeed through a file production lacks.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Router } from "express";

export const PDFJS_ASSET_MOUNT = "/assets/pdfjs";

const WASM_FALLBACK = /^\/[a-z0-9]+_nowasm_fallback\.js$/;

export function pdfjsDevelopmentAssets(): Router {
  const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.resolve("pdfjs-dist"))), "..");
  const router = express.Router();

  router.use("/standard_fonts", express.static(path.join(packageRoot, "standard_fonts")));
  router.use("/cmaps", express.static(path.join(packageRoot, "cmaps")));
  router.use("/wasm", (req, res, next) => (WASM_FALLBACK.test(req.path) ? next() : res.sendStatus(404)), express.static(path.join(packageRoot, "wasm")));

  return router;
}
