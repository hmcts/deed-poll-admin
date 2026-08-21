import { pathToFileURL } from "node:url";
import type { Handler, HandlerExport, HttpMethod, RouteModule } from "./simple-router.js";

const VALID_METHODS: HttpMethod[] = ["get", "post", "put", "patch", "delete", "del", "head", "options", "trace", "connect", "all"];

export async function loadRouteModule(absolutePath: string): Promise<RouteModule> {
  const fileUrl = pathToFileURL(absolutePath).href;
  const module = await import(fileUrl);
  return module;
}

export function extractHandlers(module: RouteModule): Map<string, HandlerExport> {
  const handlers = new Map<string, HandlerExport>();
  const seenMethods = new Set<string>();

  for (const [key, value] of Object.entries(module)) {
    const methodName = key.toLowerCase();

    if (!VALID_METHODS.includes(methodName as HttpMethod)) {
      continue;
    }

    if (seenMethods.has(methodName)) {
      throw new Error(`Duplicate method export found: ${key}. Module exports the same method with different casings.`);
    }

    seenMethods.add(methodName);

    if (!isValidHandler(value)) {
      throw new Error(`Invalid handler for method ${key}. Expected a function or array of functions with 2-4 parameters, got ${typeof value}`);
    }

    const normalizedMethod = methodName === "del" ? "delete" : methodName;
    handlers.set(normalizedMethod, value as HandlerExport);
  }

  return handlers;
}

function isValidHandler(value: unknown): boolean {
  if (typeof value === "function") {
    return isRequestHandler(value);
  }

  if (Array.isArray(value)) {
    return value.length > 0 && value.every((item) => typeof item === "function" && isRequestHandler(item));
  }

  return false;
}

function isRequestHandler(fn: unknown): boolean {
  if (typeof fn !== "function") return false;
  const arity = (fn as (...args: unknown[]) => unknown).length;
  return arity >= 2 && arity <= 4;
}

export function normalizeHandlers(handlerExport: HandlerExport): Handler[] {
  return Array.isArray(handlerExport) ? handlerExport : [handlerExport];
}
