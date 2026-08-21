import fs from "node:fs";
import path from "node:path";

export function createAssetHelpers(distPath: string): Record<string, string> {
  const helpers: Record<string, string> = {};
  const manifest = loadManifest(distPath);

  for (const manifestEntry of Object.values(manifest)) {
    const entryNames = [manifestEntry.name, ...(manifestEntry.names || [])].filter(Boolean) as string[];
    for (const name of entryNames) {
      const helperName = name.replace(".css", "");
      helpers[helperName] = `/assets/${manifestEntry.file}`;
    }
  }

  return helpers;
}

function loadManifest(distPath: string): ViteManifest {
  const manifestPath = path.join(distPath, "assets/.vite/manifest.json");

  try {
    if (fs.existsSync(manifestPath)) {
      const manifestContent = fs.readFileSync(manifestPath, "utf-8");
      return JSON.parse(manifestContent);
    }
  } catch (error) {
    console.warn("Failed to load Vite manifest:", error);
  }

  return {};
}

export type AssetOptions = { distPath: string } | { entries: Record<string, string>; viteConfigFile: string };

interface ManifestEntry {
  file: string;
  src?: string;
  name?: string;
  names?: string[];
  isEntry?: boolean;
  css?: string[];
}

interface ViteManifest {
  [key: string]: ManifestEntry;
}
