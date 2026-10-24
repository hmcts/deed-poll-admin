import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * What the renderer must never do, checked on its source because the unit suite has no browser to run it in: the
 * DOM wiring is exercised by the browser journeys, and these are the properties a journey cannot see go missing.
 *
 * - **No keep-alive.** Reading a document is not activity the idle limit should forget: only the session warning's
 *   own "Stay signed in" extends a session, so the viewer requests nothing but the preview it was asked for.
 * - **Nothing kept outside the tab's memory.** No storage API, and no console or telemetry line that could carry a
 *   document's name, bytes or a provider's message.
 * - **Torn down on leaving**, so a logout or persona switch, both of which navigate away, leaves no document behind.
 */
const DIRECTORY = fileURLToPath(new URL(".", import.meta.url));
const SOURCES = readdirSync(DIRECTORY)
  .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && name !== "test-pdfs.ts")
  .map((name) => ({ name, text: readFileSync(`${DIRECTORY}${name}`, "utf8") }));

describe("the document viewer's renderer modules", () => {
  it.each(SOURCES.map((source) => [source.name, source.text]))("%s should make no session request of its own", (_name, text) => {
    expect(text).not.toMatch(/\/session\/|keep-alive|setInterval/);
  });

  it.each(SOURCES.map((source) => [source.name, source.text]))("%s should store and log nothing", (_name, text) => {
    expect(text).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|console\.|trackEvent|sendBeacon/);
  });

  it("should tear the open document down when the page is left", () => {
    const viewer = SOURCES.find((source) => source.name === "viewer.ts")?.text ?? "";

    expect(viewer).toMatch(/addEventListener\("pagehide", leave\)/);
    expect(viewer).toMatch(/const leave = \(\) => \{\s*clear\(\);\s*opened = null;\s*void loader\.close\(\);/);
  });
});
