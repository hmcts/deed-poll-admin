import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ErrorRequestHandler, Express, RequestHandler, Router } from "express";
import { Router as expressRouter } from "express";
import { discoverRoutes, sortRoutes } from "./route-discovery.js";
import { extractHandlers, loadRouteModule, normalizeHandlers } from "./route-loader.js";

export async function createSimpleRouter(...mounts: MountSpec[]): Promise<Router> {
  const router = expressRouter();

  if (mounts.length === 0) {
    throw new Error("At least one mount specification is required");
  }

  try {
    const allRoutes = await discoverAndLoadRoutes(mounts);
    validateRoutes(allRoutes);
    mountRoutes(router, allRoutes);
  } catch (error) {
    console.error("Failed to initialize file-system router:", error);
    throw error;
  }

  return router;
}

async function discoverAndLoadRoutes(mounts: MountSpec[]): Promise<RouteEntry[]> {
  const allRoutes: RouteEntry[] = [];

  for (const mountSpec of mounts) {
    const mountRoutes = await processMountSpec(mountSpec);
    allRoutes.push(...mountRoutes);
  }

  return allRoutes;
}

async function processMountSpec(mountSpec: MountSpec): Promise<RouteEntry[]> {
  const dir = process.env.NODE_ENV === "production" ? mountSpec.path.replace("/src/", "/dist/") : mountSpec.path;
  const routesDir = resolve(dir);

  if (!existsSync(routesDir)) {
    throw new Error(`Routes directory does not exist: ${routesDir}`);
  }

  const prefix = normalizePrefix(mountSpec.prefix || "");
  const routes = discoverAndSortRoutes(routesDir);

  const routeEntries: RouteEntry[] = [];

  for (const route of routes) {
    const moduleRoutes = await loadModuleRoutes(route, prefix, mountSpec);
    routeEntries.push(...moduleRoutes);
  }

  return routeEntries;
}

function discoverAndSortRoutes(pagesDir: string) {
  const discoveredRoutes = discoverRoutes(pagesDir);
  return sortRoutes(discoveredRoutes);
}

async function loadModuleRoutes(
  route: { absolutePath: string; urlPath: string; relativePath: string },
  prefix: string,
  mountSpec: MountSpec
): Promise<RouteEntry[]> {
  const module = await loadRouteModule(route.absolutePath);
  const handlers = extractHandlers(module);
  const routeEntries: RouteEntry[] = [];

  const fullPath = buildFullPath(prefix, route.urlPath);

  // Add method handlers
  for (const [method, handlerExport] of handlers.entries()) {
    routeEntries.push({
      path: fullPath,
      method,
      handlers: normalizeHandlers(handlerExport),
      sourcePath: route.absolutePath,
      mountSpec
    });
  }

  // Add error handler if present
  // Note: Error handlers have 4 params (err, req, res, next) vs regular handlers with 3
  // Express handles this difference internally based on function arity
  if (module.onError) {
    routeEntries.push({
      path: fullPath,
      method: "use",
      // Cast to any[] first to bypass TypeScript's strict checking
      // Express internally handles both 3-param and 4-param handlers
      handlers: [module.onError] as any as Handler[],
      sourcePath: route.absolutePath,
      mountSpec
    });
  }

  return routeEntries;
}

function buildFullPath(prefix: string, urlPath: string): string {
  if (prefix === "/") {
    return urlPath;
  }
  return `${prefix}${urlPath === "/" ? "" : urlPath}`;
}

function normalizePrefix(prefix: string): string {
  if (!prefix || prefix === "/") {
    return "/";
  }

  let normalized = prefix;

  if (!normalized.startsWith("/")) {
    normalized = `/${normalized}`;
  }

  if (normalized.endsWith("/") && normalized !== "/") {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

function validateRoutes(routes: RouteEntry[]): void {
  const routeMap = new Map<string, RouteEntry>();

  for (const route of routes) {
    const key = `${route.method.toUpperCase()} ${route.path}`;

    if (routeMap.has(key)) {
      const existing = routeMap.get(key)!;
      throw new Error(
        `Route conflict detected:\n` +
          `  ${key}\n` +
          `  Defined in:\n` +
          `    1. ${existing.sourcePath} (mount: ${existing.mountSpec.path})\n` +
          `    2. ${route.sourcePath} (mount: ${route.mountSpec.path})`
      );
    }

    routeMap.set(key, route);
  }
}

function mountRoutes(router: Router | Express, routes: RouteEntry[]): void {
  for (const route of routes) {
    const { path, method, handlers } = route;

    if (method === "use") {
      (router as any).use(path, ...handlers);
    } else if (method === "all") {
      (router as any).all(path, ...handlers);
    } else {
      (router as any)[method](path, ...handlers);
    }
  }
}

export type Handler = RequestHandler;
export type HandlerExport = Handler | Handler[];
export type HttpMethod = "get" | "post" | "put" | "patch" | "delete" | "del" | "head" | "options" | "trace" | "connect" | "all";

export interface MountSpec {
  path: string;
  prefix?: string;
  trailingSlash?: "off" | "enforce" | "redirect";
}

export interface RouteModule {
  [key: string]: unknown;
  onError?: ErrorRequestHandler;
}

export interface RouteEntry {
  path: string;
  method: string;
  handlers: Handler[];
  sourcePath: string;
  mountSpec: MountSpec;
}

export interface DiscoveredRoute {
  relativePath: string;
  urlPath: string;
  absolutePath: string;
}
