import { describe, expect, it } from "vitest";
import { numericInputMessage, readNumericInput } from "./numeric-input.js";

describe("deed-poll/numeric-input", () => {
  describe("readNumericInput", () => {
    it("should read an absent control as absent, not as blank, so a patch can leave the field alone", () => {
      expect(readNumericInput(undefined, "decimal")).toEqual({ kind: "absent" });
    });

    it.each(["", "   ", "\t"])("should read %j as blank, the one reading that may clear the field", (raw) => {
      expect(readNumericInput(raw, "decimal")).toEqual({ kind: "blank" });
    });

    it.each([
      ["25.00", 25],
      ["25.5", 25.5],
      ["0", 0],
      ["0.00", 0],
      [".5", 0.5],
      ["5.", 5],
      ["  12.75  ", 12.75],
      ["-3.2", -3.2],
      ["+4", 4],
      ["007", 7]
    ])("should read decimal %j as %d", (raw, expected) => {
      expect(readNumericInput(raw, "decimal")).toEqual({ kind: "valid", value: expected });
    });

    it.each([
      ["7", 7],
      ["0", 0],
      [" 11 ", 11],
      ["7.0", 7],
      ["-1", -1],
      ["2147483647", 2147483647],
      ["-2147483648", -2147483648]
    ])("should read integer %j as %d", (raw, expected) => {
      expect(readNumericInput(raw, "integer")).toEqual({ kind: "valid", value: expected });
    });

    it.each([
      "12x",
      "£25.00",
      "25.00£",
      "1,000",
      "1 000",
      "NaN",
      "Infinity",
      "-Infinity",
      "1e3",
      "1E3",
      "1e999",
      "0x10",
      "0b1",
      "0o7",
      ".",
      "-",
      "+",
      "--1",
      "1.2.3",
      "1_000",
      "٣"
    ])("should read %j as invalid rather than as a number or a clear", (raw) => {
      expect(readNumericInput(raw, "decimal")).toEqual({ kind: "invalid" });
      expect(readNumericInput(raw, "integer")).toEqual({ kind: "invalid" });
    });

    it("should read a decimal too large to be finite as invalid, since JSON would send it as null", () => {
      const overflow = `1${"0".repeat(400)}`;

      expect(readNumericInput(overflow, "decimal")).toEqual({ kind: "invalid" });
    });

    it.each(["7.5", "0.1", "2147483648", "-2147483649", "9007199254740993"])(
      "should read %j as invalid for an integer field rather than rounding or overflowing int32",
      (raw) => {
        expect(readNumericInput(raw, "integer")).toEqual({ kind: "invalid" });
      }
    );

    it.each(["7.00000000000000001", "0.0000000000000000001"])(
      "should read %j as invalid for an integer field even though Number() rounds it to a whole number",
      (raw) => {
        expect(readNumericInput(raw, "integer")).toEqual({ kind: "invalid" });
      }
    );

    it.each([
      ["a duplicated field", ["1", "2"]],
      ["a single-element array", ["1"]],
      ["an object from a bracketed name", { a: "1" }],
      ["null", null],
      ["a number that never came from a form", 7]
    ])("should read %s as invalid rather than taking a part of it", (_name, raw) => {
      expect(readNumericInput(raw, "decimal")).toEqual({ kind: "invalid" });
    });
  });

  describe("numericInputMessage", () => {
    it("should ask for a whole number on an integer field and a number on a decimal one", () => {
      expect(numericInputMessage("Age of minor years", "integer")).toBe("Age of minor years must be a whole number");
      expect(numericInputMessage("Refund amount", "decimal")).toBe("Refund amount must be a number");
    });
  });
});
