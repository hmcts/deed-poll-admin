import { GAZETTE_RECIPIENT_EMAIL_PATTERN } from "@hmcts/deed-poll-api-client";
import { expect, it } from "vitest";
import { z } from "zod";
import { gazetteSettingsFormSchema } from "./schemas.js";

const messages = { required: "Recipient required", invalid: "Recipient invalid", reload: "Reload required" };
const original = z.object({
  recipientEmail: z
    .string({ error: messages.required })
    .trim()
    .min(1, messages.required)
    .max(254, messages.invalid)
    .regex(new RegExp(GAZETTE_RECIPIENT_EMAIL_PATTERN), messages.invalid)
    .refine((email) => email.indexOf("@") <= 64, messages.invalid)
});

it.each([
  "a@b.c",
  " \tfirst.last+tag@sub.example.co.uk\r\n",
  "!#$%&'*+/=?^_`{|}~-@example.com",
  "",
  " \t\n",
  "bad",
  "a..b@c.d",
  "a@b..c",
  "a@-b.c",
  "a@b-.c",
  "a\n@b.c",
  "a@b\n.c",
  "a@b.c\n",
  "a\u2028@b.c",
  "a@b\u2029.c",
  "é@b.c",
  "a@é.c",
  "a@b.c@d",
  "a@b_c.d",
  "\uFEFFa@b.c\uFEFF",
  `${"a".repeat(64)}@b.co`,
  `${"a".repeat(65)}@b.co`,
  `a@${"b".repeat(63)}.co`,
  `a@${"b".repeat(64)}.co`,
  `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`,
  `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(62)}`,
  "!".repeat(255),
  undefined,
  null,
  0,
  [],
  {}
])("should preserve recipient form output and error details for %j", (recipientEmail) => {
  const expected = original.safeParse({ recipientEmail });
  const actual = gazetteSettingsFormSchema(messages).safeParse({ recipientEmail, revision: "0" });

  expect(actual.success).toBe(expected.success);
  if (actual.success && expected.success) expect(actual.data).toEqual({ ...expected.data, revision: 0 });
  else if (!actual.success && !expected.success) expect(actual.error.issues).toEqual(expected.error.issues);
});
