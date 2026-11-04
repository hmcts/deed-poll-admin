import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { glob } from "glob";
import { defineConfig, type UserConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const assetsPath = path.join(__dirname, "src", "assets");
const PDFJS_ASSET_DIRECTORIES = ["standard_fonts", "cmaps"];

function getEntries(assetsPath: string): Record<string, string> {
  const entries: Record<string, string> = {};
  const resolved = path.resolve(assetsPath);

  if (existsSync(resolved)) {
    const jsFiles = glob.sync(path.resolve(resolved, "js/*.ts")).filter((f) => !f.endsWith(".d.ts"));
    const cssFiles = glob.sync(path.resolve(resolved, "css/*.scss"));

    for (const asset of [...jsFiles, ...cssFiles]) {
      const fileName = path.basename(asset);
      const baseName = fileName.replace(/\.(ts|scss)$/, "");
      const fileType = fileName.endsWith(".ts") ? "js" : "css";
      entries[`${baseName}_${fileType}`] = asset;
    }
  }

  return entries;
}

const baseConfig: UserConfig = {
  build: {
    outDir: "dist/assets",
    emptyOutDir: true,
    rollupOptions: {
      input: getEntries(assetsPath),
      output: {
        format: "es",
        entryFileNames: "js/[name]-[hash].js",
        chunkFileNames: "js/[name]-[hash].js",
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith(".css")) {
            return "css/[name]-[hash][extname]";
          }
          return "assets/[name]-[hash][extname]";
        }
      }
    },
    sourcemap: process.env.NODE_ENV !== "production",
    minify: process.env.NODE_ENV === "production",
    manifest: true
  },
  css: {
    preprocessorOptions: {
      scss: {
        loadPaths: ["node_modules"]
      }
    },
    devSourcemap: true,
    lightningcss: {
      errorRecovery: true
    }
  },
  resolve: {
    extensions: [".ts", ".js", ".scss", ".css"],
    preserveSymlinks: true
  },
  publicDir: false,
  // An asset a script imports by URL (the document viewer's PDF.js worker) is emitted under `dist/assets/assets/`,
  // which `/assets` serves as `/assets/assets/`. With the default base of `/` its URL would be `/assets/…` and 404,
  // so built URLs are resolved relative to the chunk that imports them instead. Development is unaffected.
  experimental: {
    renderBuiltUrl: () => ({ relative: true })
  },
  plugins: [
    viteStaticCopy({
      targets: [
        // `stripBase` on each GOV.UK Frontend target: without it vite-plugin-static-copy keeps the matched path under
        // `dest`, so the fonts landed at `fonts/node_modules/govuk-frontend/dist/govuk/assets/fonts/` and every page's
        // `/assets/fonts/…`, crest, favicon and `/assets/manifest.json` requests answered 404.
        {
          src: "node_modules/govuk-frontend/dist/govuk/assets/fonts/*",
          dest: "fonts",
          rename: { stripBase: true }
        },
        {
          src: "node_modules/govuk-frontend/dist/govuk/assets/images/*",
          dest: "images",
          rename: { stripBase: true }
        },
        {
          src: "node_modules/govuk-frontend/dist/govuk/assets/manifest.json",
          dest: ".",
          rename: { stripBase: true }
        },
        // **The output path this produces is not what the `rename` below reads as, and it works anyway.**
        // Every template lands doubly nested — `dist/pages/src/pages/deed-polls/deed-polls/index.njk` —
        // because vite-plugin-static-copy preserves the matched directory structure under `dest` *and then*
        // appends whatever `rename` returns, so a `rename` that returns a path rather than a file name
        // repeats it. Pre-existing, and confirmed on `master` before plan 03 flattened `apps/web`.
        //
        // It resolves because `configureGovuk`'s `collectViewPaths` recurses into every directory under
        // `dist/pages` and adds each as a nunjucks search path: `res.render("deed-polls/index")` then finds
        // `deed-polls/index.njk` under the `dist/pages/src/pages/deed-polls` path. The doubled segment is
        // load-bearing given that, so plan 03 task 5 left it alone rather than "fixing" the rename:
        // flattening the output changes template resolution for every page and belongs in its own commit,
        // not in a relocation. What it did instead was check the claim — the whole Playwright suite passes
        // against `node dist/server.js` with `VITE_MIDDLEWARE=false`, so every page renders from here.
        {
          src: "src/pages/**/*.{njk,html}",
          dest: "../pages",
          rename: (_fileName, _fileExtension, fullPath) => {
            const pagesRoot = path.resolve(__dirname, "src/pages");
            return path.relative(pagesRoot, fullPath).split(path.sep).join("/");
          }
        },
        {
          src: "src/assets/images/**/*",
          dest: "images",
          rename: { stripBase: true }
        },
        // The document viewer's PDF.js data, served from this app under `/assets/pdfjs/` (`PDFJS_ASSET_PATH` in
        // `src/assets/js/document-viewer/pdf-document.ts`; `src/app.ts` serves the same paths in development).
        // Only the plain-JavaScript image decoders are copied from `wasm/`: the viewer sets `useWasm: false`
        // because WebAssembly would need `'wasm-unsafe-eval'` in the CSP, and the scripting engine is never used.
        ...PDFJS_ASSET_DIRECTORIES.map((directory) => ({
          src: `node_modules/pdfjs-dist/${directory}/*`,
          dest: `pdfjs/${directory}`,
          rename: { stripBase: true }
        })),
        {
          src: ["node_modules/pdfjs-dist/wasm/*_nowasm_fallback.js", "node_modules/pdfjs-dist/wasm/LICENSE_*"],
          dest: "pdfjs/wasm",
          rename: { stripBase: true }
        }
      ]
    })
  ]
};

export default defineConfig(baseConfig);
