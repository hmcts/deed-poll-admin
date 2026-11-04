import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const SUPPORTED_LOCALES = ["en", "cy"];

export interface Translations {
  [locale: string]: any;
}

export async function loadTranslationsFromMultiplePaths(paths: string[]): Promise<Translations> {
  const allTranslations: Translations = {};

  // Initialize empty objects for each locale
  for (const locale of SUPPORTED_LOCALES) {
    allTranslations[locale] = {};
  }

  // Imports overlap, but later declared paths must still override earlier ones.
  const translationsByPath = await Promise.all(paths.map(loadTranslations));
  for (const translations of translationsByPath) {
    for (const locale of SUPPORTED_LOCALES) {
      if (translations[locale]) {
        allTranslations[locale] = {
          ...allTranslations[locale],
          ...translations[locale]
        };
      }
    }
  }

  return allTranslations;
}

export async function loadTranslations(localesPath: string): Promise<Translations> {
  const entries = await Promise.all(SUPPORTED_LOCALES.map(async (locale) => [locale, await loadLocale(localesPath, locale)] as const));
  return Object.fromEntries(entries);
}

export function getTranslation(translations: Translations, key: string, locale: string, fallbackLocale = "en"): string {
  const keys = key.split(".");

  // Try to get the value from the requested locale
  let value = translations[locale];

  for (const k of keys) {
    if (value && typeof value === "object" && k in value) {
      value = value[k];
    } else {
      // If we can't find it in the requested locale and it's not the fallback, try the fallback
      if (locale !== fallbackLocale && translations[fallbackLocale]) {
        return getTranslation(translations, key, fallbackLocale, fallbackLocale);
      }
      return key;
    }
  }

  if (typeof value === "string") {
    return value;
  }

  return key;
}

async function loadLocale(localesPath: string, locale: string) {
  const tsFilePath = join(localesPath, `${locale}.ts`);
  const jsFilePath = join(localesPath, `${locale}.js`);
  const filePath = existsSync(jsFilePath) ? jsFilePath : tsFilePath;

  if (!existsSync(filePath)) {
    console.warn(`Translation file not found for ${locale}: ${filePath}`);
    return {};
  }

  try {
    const langContent = await import(pathToFileURL(filePath).href);
    return langContent.content || langContent.default || {};
  } catch (error) {
    console.error(`Failed to load translations for ${locale}:`, error);
    return {};
  }
}
