import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { WIRE_SCHEMAS } from "./wire.js";

const spec = JSON.parse(readFileSync(new URL("../../openapi.json", import.meta.url), "utf8"));
const publishedPattern = new RegExp(spec.components.schemas.UpdateGazetteSettingsRequest.properties.recipientEmail.pattern);
const publishedSchema = z
  .object({
    recipientEmail: z
      .string()
      .trim()
      .max(254)
      .regex(publishedPattern)
      .refine((email) => email.indexOf("@") <= 64),
    revision: z.number().int().nonnegative()
  })
  .strict();
const schema = WIRE_SCHEMAS.UpdateGazetteSettingsRequest;

describe("Gazette recipient email contract", () => {
  it.each([
    "a@b.c",
    "first.last@sub.example.co.uk",
    "!#$%&'*+/=?^_`{|}~-@example.com",
    "a@1.2",
    "A@B.C",
    "a@b-c.d",
    `${"a".repeat(64)}@b.co`,
    `a@${"b".repeat(63)}.co`,
    `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`
  ])("should accept the published address %s", (recipientEmail) => {
    expect(schema.parse({ recipientEmail: ` \t${recipientEmail}\r\n`, revision: 0 })).toEqual({ recipientEmail, revision: 0 });
  });

  it.each([
    "",
    "@",
    "a@",
    "@b.co",
    "a@b",
    ".a@b.co",
    "a.@b.co",
    "a..b@c.co",
    "a@-b.co",
    "a@b-.co",
    "a@b..co",
    "a@.b.co",
    "a@b.co.",
    "a@b@c.co",
    "a b@c.co",
    "a\n@b.co",
    "a@b\n.co",
    "a@b_co.d",
    "é@b.co",
    "a@é.co",
    "a@b.💌",
    "Name <a@b.co>",
    "a@b.co,c@d.co",
    `${"a".repeat(65)}@b.co`,
    `a@${"b".repeat(64)}.co`,
    `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(62)}`,
    undefined,
    null,
    7,
    [],
    {}
  ])("should preserve all validation issues for invalid recipient %j", (recipientEmail) => {
    const input = { recipientEmail, revision: 0 };
    const expected = publishedSchema.safeParse(input);
    const actual = schema.safeParse(input);
    expect(expected.success).toBe(false);
    expect(actual.success).toBe(false);
    if (!actual.success && !expected.success) expect(actual.error.issues).toEqual(expected.error.issues);
  });

  it("should agree with the published pattern on every UTF-16 code unit inside each address part", () => {
    for (let code = 0; code <= 0xffff; code++) {
      const character = String.fromCharCode(code);
      for (const recipientEmail of [`a${character}b@c.d`, `a@b${character}c.d`]) {
        expect(schema.safeParse({ recipientEmail, revision: 0 }).success, JSON.stringify(recipientEmail)).toBe(publishedPattern.test(recipientEmail));
      }
    }
  }, 15_000);

  it("should preserve parsing and complete errors for a deterministic corpus of near-valid addresses", () => {
    let state = 20261024;
    const next = (maximum: number) => {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0;
      return state % maximum;
    };
    const parts = (alphabet: string, maximum: number) =>
      Array.from({ length: 1 + next(4) }, () => Array.from({ length: 1 + next(maximum) }, () => alphabet[next(alphabet.length)]).join("")).join(".");
    const noise = "aZ09.-@ _+é\n\r\t\u2028\u2029";
    let accepted = 0;
    for (let index = 0; index < 10_000; index++) {
      const address = `${parts("aZ09!#$%&'*+/=?^_`{|}~-", 20)}@${parts("aZ09-", 66)}`;
      const position = next(address.length + 1);
      const recipientEmail = address.slice(0, position) + noise[next(noise.length)] + address.slice(position);
      const input = { recipientEmail, revision: 0 };
      const expected = publishedSchema.safeParse(input);
      const actual = schema.safeParse(input);
      expect(actual.success, JSON.stringify(input)).toBe(expected.success);
      if (actual.success && expected.success) {
        accepted++;
        expect(actual.data).toEqual(expected.data);
      } else if (!actual.success && !expected.success) {
        expect(actual.error.issues).toEqual(expected.error.issues);
      }
    }
    expect(accepted).toBeGreaterThan(100);
    expect(accepted).toBeLessThan(9_900);
  }, 15_000);
});
