import type { Config } from "./properties.js";

/**
 * Deep merge two objects, replacing Lodash merge functionality
 */
export function deepMerge(target: Config, source: Config): Config {
  const result = { ...target };

  for (const key in source) {
    if (Object.hasOwn(source, key)) {
      if (isObject(source[key]) && isObject(result[key])) {
        result[key] = deepMerge(result[key], source[key]);
      } else {
        result[key] = source[key];
      }
    }
  }

  return result;
}

/**
 * Get nested property from object using dot notation, replacing Lodash get
 */
export function getProperty(obj: Config, path: string, defaultValue?: any): any {
  const keys = path.split(".");
  let current = obj;

  for (const key of keys) {
    if (current == null || typeof current !== "object") {
      return defaultValue;
    }
    current = current[key];
  }

  return current !== undefined ? current : defaultValue;
}

/**
 * Set nested property in object using dot notation, replacing Lodash set
 */
export function setProperty(obj: Config, path: string, value: any): void {
  const keys = path.split(".");
  let current = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current) || !isObject(current[key])) {
      current[key] = {};
    }
    current = current[key];
  }

  current[keys[keys.length - 1]] = value;
}

/**
 * Deep search for properties in nested object structure
 */
export function deepSearch(obj: any, searchKey: string): any[] {
  const results: any[] = [];

  function search(current: any, key: string): void {
    if (current && typeof current === "object") {
      if (Array.isArray(current)) {
        for (const item of current) {
          search(item, key);
        }
      } else {
        for (const prop in current) {
          if (prop === key) {
            results.push(current[prop]);
          }
          search(current[prop], key);
        }
      }
    }
  }

  search(obj, searchKey);
  return results;
}

/**
 * Check if value is an object (not array or null)
 */
function isObject(value: any): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Normalize secret name for configuration key
 */
export function normalizeSecretName(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, "_");
}
