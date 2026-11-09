import accessibleAutocomplete from "accessible-autocomplete";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initDocumentTypeAutocomplete } from "./document-type-autocomplete.js";

vi.mock("accessible-autocomplete", () => ({ default: { enhanceSelectElement: vi.fn() } }));

const SELECT = `<select id="documentTypeId" name="documentTypeId" data-module="app-document-type-autocomplete">
  <option value="">Select a document type</option>
  <option value="type-passport">Passport</option>
  <option value="type-birth">Birth certificate</option>
</select>`;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(accessibleAutocomplete.enhanceSelectElement).mockReset();
});

describe("initDocumentTypeAutocomplete", () => {
  it("should do nothing on a page with no document type select", () => {
    // Arrange
    page("<form><select id='other'></select></form>");

    // Act
    initDocumentTypeAutocomplete();

    // Assert
    expect(accessibleAutocomplete.enhanceSelectElement).not.toHaveBeenCalled();
  });

  it("should do nothing for a select outside any form, which no submit could set", () => {
    // Arrange
    page(SELECT);

    // Act
    initDocumentTypeAutocomplete();

    // Assert
    expect(accessibleAutocomplete.enhanceSelectElement).not.toHaveBeenCalled();
  });

  it("should enhance the select inside a form, with no default and every option shown", () => {
    // Arrange
    const document = page(`<form>${SELECT}</form>`);
    const select = document.querySelector("select");

    // Act
    initDocumentTypeAutocomplete();

    // Assert
    expect(accessibleAutocomplete.enhanceSelectElement).toHaveBeenCalledExactlyOnceWith({ selectElement: select, defaultValue: "", showAllValues: true });
  });

  it.each([
    ["the option's exact name", "Passport", "type-passport"],
    ["the name in another case, with spaces around it", "  birth CERTIFICATE ", "type-birth"],
    ["text no option is named", "Pass", ""],
    ["nothing", "", ""]
  ])("should set the select on submit from the input's text when it holds %s", (_case, typed, submitted) => {
    // Arrange
    const document = page(`<form>${SELECT}</form>`);
    const select = document.querySelector("select") as HTMLSelectElement;
    select.value = "type-birth";
    widgetReplacesSelect(document);
    initDocumentTypeAutocomplete();
    (document.getElementById("documentTypeId") as HTMLInputElement).value = typed;

    // Act
    select.form?.dispatchEvent(new document.defaultView!.Event("submit"));

    // Assert
    expect(select.value).toBe(submitted);
  });

  it("should leave the select alone on submit when the widget put no input under its id", () => {
    // Arrange
    const document = page(`<form>${SELECT}</form>`);
    const select = document.querySelector("select") as HTMLSelectElement;
    select.value = "type-birth";
    initDocumentTypeAutocomplete();

    // Act
    select.form?.dispatchEvent(new document.defaultView!.Event("submit"));

    // Assert
    expect(select.value).toBe("type-birth");
  });
});

/** A page whose `document` and `HTMLInputElement` are what the browser bundle reads as globals. */
function page(body: string): Document {
  const { window } = new JSDOM(`<!doctype html><body>${body}</body>`);
  vi.stubGlobal("document", window.document);
  vi.stubGlobal("HTMLInputElement", window.HTMLInputElement);
  return window.document;
}

/** What alphagov's widget does to the DOM: the select gives up its id to an input that takes its place. */
function widgetReplacesSelect(document: Document): void {
  vi.mocked(accessibleAutocomplete.enhanceSelectElement).mockImplementation(({ selectElement }) => {
    const input = document.createElement("input");
    input.id = selectElement.id;
    selectElement.id = `${selectElement.id}-select`;
    selectElement.before(input);
  });
}
