import { describe, expect, it } from "vitest";
import { toCsv } from "./csv.js";

const BOM = "\uFEFF";

describe("toCsv", () => {
  it("should start with a byte order mark and end every row with CRLF", () => {
    const csv = toCsv([
      ["Period start", "Cases"],
      ["2026-10-05", 12]
    ]);

    expect(csv).toBe(`${BOM}Period start,Cases\r\n2026-10-05,12\r\n`);
  });

  it("should leave a null cell empty rather than write zero", () => {
    expect(toCsv([[0, null, 3.25]])).toBe(`${BOM}0,,3.25\r\n`);
  });

  it.each([
    ["=SUM(A1:A9)", "'=SUM(A1:A9)"],
    ["+44 20", "'+44 20"],
    ["-1+2", "'-1+2"],
    ["@cmd", "'@cmd"],
    ["\tTabbed", "'\tTabbed"]
  ])("should put a quote mark before a text cell a spreadsheet would run as a formula: %j", (value, expected) => {
    expect(toCsv([[value]])).toBe(`${BOM}${expected}\r\n`);
  });

  it("should quote a guarded cell that also needs quoting", () => {
    expect(toCsv([["\rline"]])).toBe(`${BOM}"'\rline"\r\n`);
  });

  it("should quote a cell holding a comma, quote mark or line break, doubling its quote marks", () => {
    expect(toCsv([['Received, "urgent"', "two\nlines"]])).toBe(`${BOM}"Received, ""urgent""","two\nlines"\r\n`);
  });

  it("should not guard a negative number, which is a figure and not text", () => {
    expect(toCsv([[-2]])).toBe(`${BOM}-2\r\n`);
  });
});
