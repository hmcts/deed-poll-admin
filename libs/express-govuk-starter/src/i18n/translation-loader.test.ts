import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTranslation, loadTranslations } from "./translation-loader.js";

describe("getTranslation", () => {
  const translations = {
    en: {
      welcome: "Welcome",
      navigation: {
        home: "Home",
        about: "About",
        nested: {
          deep: "Deep value"
        }
      }
    },
    cy: {
      welcome: "Croeso",
      navigation: {
        home: "Hafan",
        about: "Amdanom",
        nested: {
          deep: "Gwerth ddofn"
        }
      }
    }
  };

  it("should get a simple translation key", () => {
    expect(getTranslation(translations, "welcome", "en")).toBe("Welcome");
    expect(getTranslation(translations, "welcome", "cy")).toBe("Croeso");
  });

  it("should get a nested translation key", () => {
    expect(getTranslation(translations, "navigation.home", "en")).toBe("Home");
    expect(getTranslation(translations, "navigation.home", "cy")).toBe("Hafan");
  });

  it("should get a deeply nested translation key", () => {
    expect(getTranslation(translations, "navigation.nested.deep", "en")).toBe("Deep value");
    expect(getTranslation(translations, "navigation.nested.deep", "cy")).toBe("Gwerth ddofn");
  });

  it("should return the key if translation not found", () => {
    expect(getTranslation(translations, "nonexistent", "en")).toBe("nonexistent");
    expect(getTranslation(translations, "navigation.missing", "en")).toBe("navigation.missing");
  });

  it("should fall back to English if Welsh translation missing", () => {
    const partialTranslations = {
      en: {
        onlyInEnglish: "English only"
      },
      cy: {}
    };
    // When the key doesn't exist in Welsh, it falls back to English
    expect(getTranslation(partialTranslations, "onlyInEnglish", "cy")).toBe("English only");
  });

  it("should handle missing locale by using fallback", () => {
    expect(getTranslation(translations, "welcome", "fr", "en")).toBe("Welcome");
  });

  it("should handle non-string values by returning the key", () => {
    const complexTranslations = {
      en: {
        navigation: {
          home: "Home"
        }
      }
    };
    expect(getTranslation(complexTranslations, "navigation", "en")).toBe("navigation");
  });
});

describe("loadTranslations", () => {
  let testDir: string;

  beforeEach(() => {
    // Create a temporary test directory
    testDir = join(tmpdir(), `test-translations-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up the test directory
    rmSync(testDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("should load translations from .js files", async () => {
    // Create test translation files
    const enContent = `export const content = { welcome: "Welcome", title: "English Title" };`;
    const cyContent = `export const content = { welcome: "Croeso", title: "Welsh Title" };`;

    writeFileSync(join(testDir, "en.js"), enContent);
    writeFileSync(join(testDir, "cy.js"), cyContent);

    const translations = await loadTranslations(testDir);

    expect(translations).toHaveProperty("en");
    expect(translations).toHaveProperty("cy");
    expect(translations.en).toEqual({ welcome: "Welcome", title: "English Title" });
    expect(translations.cy).toEqual({ welcome: "Croeso", title: "Welsh Title" });
  });

  it("should load translations from .ts files when .js files don't exist", async () => {
    // Create test translation files (TypeScript)
    const enContent = `export const content = { welcome: "Welcome from TS" };`;
    const cyContent = `export const content = { welcome: "Croeso from TS" };`;

    writeFileSync(join(testDir, "en.ts"), enContent);
    writeFileSync(join(testDir, "cy.ts"), cyContent);

    const translations = await loadTranslations(testDir);

    expect(translations).toHaveProperty("en");
    expect(translations).toHaveProperty("cy");
    expect(translations.en).toEqual({ welcome: "Welcome from TS" });
    expect(translations.cy).toEqual({ welcome: "Croeso from TS" });
  });

  it("should prefer .js files over .ts files", async () => {
    // Create both .js and .ts files
    const enJsContent = `export const content = { welcome: "Welcome from JS" };`;
    const enTsContent = `export const content = { welcome: "Welcome from TS" };`;

    writeFileSync(join(testDir, "en.js"), enJsContent);
    writeFileSync(join(testDir, "en.ts"), enTsContent);
    writeFileSync(join(testDir, "cy.js"), `export const content = { welcome: "Croeso" };`);

    const translations = await loadTranslations(testDir);

    expect(translations.en).toEqual({ welcome: "Welcome from JS" });
  });

  it("should handle missing translation files gracefully", async () => {
    // Don't create any files
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const translations = await loadTranslations(testDir);

    expect(translations).toHaveProperty("en");
    expect(translations).toHaveProperty("cy");
    expect(translations.en).toEqual({});
    expect(translations.cy).toEqual({});
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("Translation file not found for en"));
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining("Translation file not found for cy"));
  });

  it("should handle export default format", async () => {
    // Create files with default export
    const enContent = `export default { welcome: "Welcome Default" };`;
    const cyContent = `export default { welcome: "Croeso Default" };`;

    writeFileSync(join(testDir, "en.js"), enContent);
    writeFileSync(join(testDir, "cy.js"), cyContent);

    const translations = await loadTranslations(testDir);

    expect(translations.en).toEqual({ welcome: "Welcome Default" });
    expect(translations.cy).toEqual({ welcome: "Croeso Default" });
  });

  it("should handle import errors gracefully", async () => {
    // Create file that throws when imported
    const throwContent = `
      throw new Error("Import failed");
      export const content = { welcome: "test" };
    `;

    writeFileSync(join(testDir, "en.js"), throwContent);
    writeFileSync(join(testDir, "cy.js"), throwContent);

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const translations = await loadTranslations(testDir);

    expect(translations).toHaveProperty("en");
    expect(translations).toHaveProperty("cy");
    expect(translations.en).toEqual({});
    expect(translations.cy).toEqual({});
    // Should have logged errors for both files
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(consoleErrorSpy.mock.calls[0][0]).toContain("Failed to load translations for");
  });

  it("should handle files with no exports", async () => {
    // Create files with no exports
    const emptyContent = `// No exports here`;

    writeFileSync(join(testDir, "en.js"), emptyContent);
    writeFileSync(join(testDir, "cy.js"), emptyContent);

    const translations = await loadTranslations(testDir);

    expect(translations.en).toEqual({});
    expect(translations.cy).toEqual({});
  });

  it("should handle mixed file types", async () => {
    // One .js file and one .ts file
    const enJsContent = `export const content = { welcome: "Welcome JS" };`;
    const cyTsContent = `export const content = { welcome: "Croeso TS" };`;

    writeFileSync(join(testDir, "en.js"), enJsContent);
    writeFileSync(join(testDir, "cy.ts"), cyTsContent);

    const translations = await loadTranslations(testDir);

    expect(translations.en).toEqual({ welcome: "Welcome JS" });
    expect(translations.cy).toEqual({ welcome: "Croeso TS" });
  });
});
