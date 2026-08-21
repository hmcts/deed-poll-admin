import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { glob } from "glob";
import { defineConfig, type UserConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const assetsPath = path.join(__dirname, "src", "assets");

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
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: "../../node_modules/govuk-frontend/dist/govuk/assets/fonts/*",
          dest: "fonts"
        },
        {
          src: "../../node_modules/govuk-frontend/dist/govuk/assets/images/*",
          dest: "images"
        },
        {
          src: "../../node_modules/govuk-frontend/dist/govuk/assets/manifest.json",
          dest: "."
        },
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
          dest: "images"
        }
      ]
    })
  ]
};

export default defineConfig(baseConfig);
