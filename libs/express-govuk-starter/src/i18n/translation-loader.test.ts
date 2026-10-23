import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTranslation, loadTranslations, loadTranslationsFromMultiplePaths } from "./translation-loader.js";

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
    testDir = mkdtempSync(join(tmpdir(), "test-translations-"));
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

  it("should prefer named content when a default export also exists", async () => {
    writeFileSync(join(testDir, "en.js"), 'export const content = { title: "Named" }; export default { title: "Default" };');
    writeFileSync(join(testDir, "cy.js"), "export const content = {};");

    const translations = await loadTranslations(testDir);

    expect(translations.en).toEqual({ title: "Named" });
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

describe("translation loading order", () => {
  let testDir: string;
  let finishLoading: () => Promise<void>;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "translation-order-"));
    finishLoading = async () => {};
  });

  afterEach(async () => {
    // Release imports even when a concurrency regression causes the test to time out.
    await finishLoading();
    rmSync(testDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("should start both locale imports independently and retain locale key order", async ({ signal }) => {
    const en = await controlledLocale(testDir, "en", { title: "English" });
    const cy = await controlledLocale(testDir, "cy", { title: "Welsh" });
    const loading = loadTranslations(testDir);
    finishLoading = async () => {
      en.release();
      cy.release();
      await loading;
    };

    await Promise.all([en.started, cy.started]);
    if (signal.aborted) return;
    cy.release();
    await cy.finished;
    en.release();
    const translations = await loading;

    expect(translations).toEqual({ en: { title: "English" }, cy: { title: "Welsh" } });
    expect(Object.keys(translations)).toEqual(["en", "cy"]);
  });

  it("should overlap paths while later declarations win regardless of completion order", async ({ signal }) => {
    const firstPath = join(testDir, "first");
    const lastPath = join(testDir, "last");
    const first = await controlledLocale(firstPath, "en", { title: "First", retained: "Keep", nested: { old: true } });
    const last = await controlledLocale(lastPath, "en", { title: "Last", nested: { new: true } });
    writeFileSync(join(firstPath, "cy.js"), 'export const content = { title: "Cyntaf", retained: "Cadw" };');
    writeFileSync(join(lastPath, "cy.js"), 'export const content = { title: "Olaf" };');
    const loading = loadTranslationsFromMultiplePaths([firstPath, lastPath]);
    finishLoading = async () => {
      first.release();
      last.release();
      await loading;
    };

    await Promise.all([first.started, last.started]);
    if (signal.aborted) return;
    last.release();
    await last.finished;
    first.release();
    const translations = await loading;

    expect(translations).toEqual({
      en: { title: "Last", retained: "Keep", nested: { new: true } },
      cy: { title: "Olaf", retained: "Cadw" }
    });
    expect(Object.keys(translations)).toEqual(["en", "cy"]);
  });

  it("should return empty supported locales when no paths are supplied", async () => {
    expect(await loadTranslationsFromMultiplePaths([])).toEqual({ en: {}, cy: {} });
  });

  it("should retain successful locales across missing files and failed imports", async () => {
    const firstPath = join(testDir, "first");
    const lastPath = join(testDir, "last");
    mkdirSync(firstPath);
    mkdirSync(lastPath);
    writeFileSync(join(firstPath, "en.js"), 'throw new Error("Unavailable translation");');
    writeFileSync(join(firstPath, "cy.js"), 'export const content = { title: "Cadw" };');
    writeFileSync(join(lastPath, "en.js"), 'export default { title: "Recovered" };');
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});

    const translations = await loadTranslationsFromMultiplePaths([firstPath, lastPath]);

    expect(translations).toEqual({ en: { title: "Recovered" }, cy: { title: "Cadw" } });
    expect(errors).toHaveBeenCalledWith("Failed to load translations for en:", expect.any(Error));
    expect(warnings).toHaveBeenCalledWith(`Translation file not found for cy: ${join(lastPath, "cy.ts")}`);
  });
});

async function controlledLocale(directory: string, locale: string, content: Record<string, unknown>) {
  mkdirSync(directory, { recursive: true });
  const gateName = `${locale}-gate.js`;
  const gatePath = join(directory, gateName);
  writeFileSync(
    gatePath,
    "export const started = Promise.withResolvers(); export const released = Promise.withResolvers(); export const finished = Promise.withResolvers();"
  );
  writeFileSync(
    join(directory, `${locale}.js`),
    `import { started, released, finished } from "./${gateName}";
     started.resolve();
     await released.promise;
     export const content = ${JSON.stringify(content)};
     finished.resolve();`
  );
  const gate = (await import(pathToFileURL(gatePath).href)) as {
    started: { promise: Promise<void> };
    released: { resolve: () => void };
    finished: { promise: Promise<void> };
  };
  return { started: gate.started.promise, release: gate.released.resolve, finished: gate.finished.promise };
}
