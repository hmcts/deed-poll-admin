import { describe, expect, it } from "vitest";
import { kebabCaseFilter } from "./kebab-case.js";

describe("kebabCaseFilter", () => {
  it("should convert camelCase to kebab-case", () => {
    expect(kebabCaseFilter("camelCase")).toBe("camel-case");
    expect(kebabCaseFilter("myVariableName")).toBe("my-variable-name");
  });

  it("should convert PascalCase to kebab-case", () => {
    expect(kebabCaseFilter("PascalCase")).toBe("pascal-case");
    expect(kebabCaseFilter("MyClassName")).toBe("my-class-name");
  });

  it("should convert snake_case to kebab-case", () => {
    expect(kebabCaseFilter("snake_case")).toBe("snake-case");
    expect(kebabCaseFilter("my_variable_name")).toBe("my-variable-name");
  });

  it("should handle spaces", () => {
    expect(kebabCaseFilter("space separated words")).toBe("space-separated-words");
    expect(kebabCaseFilter("  multiple   spaces  ")).toBe("-multiple-spaces-");
  });

  it("should handle mixed formats", () => {
    expect(kebabCaseFilter("mixedCase_with_underscores")).toBe("mixed-case-with-underscores");
    expect(kebabCaseFilter("PascalCase with spaces")).toBe("pascal-case-with-spaces");
  });

  it("should convert to lowercase", () => {
    expect(kebabCaseFilter("UPPERCASE")).toBe("uppercase");
    expect(kebabCaseFilter("MiXeD cAsE")).toBe("mi-xe-d-c-as-e");
  });

  it("should handle already kebab-case strings", () => {
    expect(kebabCaseFilter("already-kebab-case")).toBe("already-kebab-case");
  });

  it("should return empty string for invalid values", () => {
    expect(kebabCaseFilter(null as unknown as string)).toBe("");
    expect(kebabCaseFilter(undefined as unknown as string)).toBe("");
    expect(kebabCaseFilter("")).toBe("");
  });

  it("should handle single words", () => {
    expect(kebabCaseFilter("word")).toBe("word");
    expect(kebabCaseFilter("Word")).toBe("word");
    expect(kebabCaseFilter("WORD")).toBe("word");
  });

  it("should handle consecutive uppercase letters", () => {
    expect(kebabCaseFilter("XMLHttpRequest")).toBe("xmlhttp-request");
    expect(kebabCaseFilter("APIKey")).toBe("apikey");
  });
});
