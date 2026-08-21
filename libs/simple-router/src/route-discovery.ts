import type { Dirent } from "node:fs";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { DiscoveredRoute } from "./simple-router.js";

export function discoverRoutes(pagesDir: string): DiscoveredRoute[] {
  return Object.values(scanDirectory(pagesDir, pagesDir));
}

function scanDirectory(dir: string, rootDir: string): Record<string, DiscoveredRoute> {
  let routes: Record<string, DiscoveredRoute> = {};
  const entries = readdirSync(dir, { withFileTypes: true }).filter((e) => !e.name.startsWith("."));

  for (const entry of entries) {
    if (isRouteFile(entry)) {
      const fullPath = join(dir, entry.name);
      const relativePath = relative(rootDir, fullPath);
      const urlPath = filePathToUrlPath(relativePath);

      routes[urlPath] = {
        relativePath,
        urlPath,
        absolutePath: fullPath
      };
    } else if (entry.isDirectory()) {
      const fullPath = join(dir, entry.name);
      routes = { ...routes, ...scanDirectory(fullPath, rootDir) };
    }
  }

  return routes;
}

function isRouteFile(entry: Dirent): boolean {
  return (
    entry.isFile() &&
    (entry.name.endsWith(".ts") || entry.name.endsWith(".js")) &&
    !entry.name.includes(".test.") &&
    !entry.name.includes(".spec.") &&
    !entry.name.endsWith(".d.ts")
  );
}

function filePathToUrlPath(filePath: string): string {
  const normalizedPath = `/${filePath}`
    .replace(/\/\([^)]+\)/g, "") // strip (group) segments from URL
    .replace(/\/index\.(ts|js)$/, "/") // remove the /index from paths
    .replace(/\.(ts|js)$/, "") // remove the .ts from the paths
    .replace(/\[([a-zA-Z0-9_]+)\]/g, ":$1"); // convert [param] to :param

  return normalizedPath !== "/" && normalizedPath.endsWith("/") ? normalizedPath.slice(0, -1) : normalizedPath;
}

export function sortRoutes(routes: DiscoveredRoute[]): DiscoveredRoute[] {
  return routes.toSorted((a, b) => {
    const aSegments = a.urlPath.split("/").filter(Boolean);
    const bSegments = b.urlPath.split("/").filter(Boolean);

    const aParams = aSegments.filter((s) => s.startsWith(":")).length;
    const bParams = bSegments.filter((s) => s.startsWith(":")).length;

    if (aParams !== bParams) {
      return aParams - bParams;
    }

    if (aSegments.length !== bSegments.length) {
      return aSegments.length - bSegments.length;
    }

    for (let i = 0; i < aSegments.length; i++) {
      const aIsParam = aSegments[i].startsWith(":");
      const bIsParam = bSegments[i].startsWith(":");

      if (aIsParam !== bIsParam) {
        return aIsParam ? 1 : -1;
      }
    }

    return a.urlPath.localeCompare(b.urlPath);
  });
}
