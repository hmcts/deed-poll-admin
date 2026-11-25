import { DELETION_NOTE_LIMITS } from "@hmcts/deed-poll-api-client";
import { describe, expect, it } from "vitest";
import { deletionFormSchema } from "./schemas.js";

const MESSAGES = {
  reason: "Choose a reason",
  noteRequired: "Enter why",
  noteCharacters: "No line breaks",
  noteTooShort: "Too short",
  noteTooLong: "Too long"
};
const schema = deletionFormSchema(MESSAGES);
const NOTE = "Created twice by mistake";

function messagesFor(input: unknown): Record<string, string> {
  const result = schema.safeParse(input);
  if (result.success) return {};
  return Object.fromEntries(result.error.issues.map((issue) => [issue.path.join("."), issue.message]));
}

describe("deletionFormSchema", () => {
  it("should accept either published reason with a note, trimming only ordinary spaces", () => {
    // Arrange / Act
    const created = schema.parse({ reason: "CREATED_IN_ERROR", note: `   ${NOTE}  ` });
    const duplicate = schema.parse({ reason: "DUPLICATE", note: NOTE });

    // Assert
    expect(created).toEqual({ reason: "CREATED_IN_ERROR", note: NOTE });
    expect(duplicate).toEqual({ reason: "DUPLICATE", note: NOTE });
  });

  it("should refuse a missing, unknown, differently cased, repeated or object-shaped reason without stringifying it", () => {
    for (const reason of [undefined, "", "VOIDED", "duplicate", ["DUPLICATE"], ["DUPLICATE", "DUPLICATE"], { DUPLICATE: "" }]) {
      expect(messagesFor({ reason, note: NOTE })).toEqual({ reason: MESSAGES.reason });
    }
  });

  it("should refuse a missing, blank, repeated or object-shaped note", () => {
    expect(messagesFor({ reason: "DUPLICATE" })).toEqual({ note: MESSAGES.noteRequired });
    expect(messagesFor({ reason: "DUPLICATE", note: "     " })).toEqual({ note: MESSAGES.noteRequired });
    expect(messagesFor({ reason: "DUPLICATE", note: [NOTE, NOTE] })).toEqual({ note: MESSAGES.noteRequired });
    expect(messagesFor({ reason: "DUPLICATE", note: { text: NOTE } })).toEqual({ note: MESSAGES.noteRequired });
  });

  it("should refuse tabs, line breaks, other control characters and lone surrogates as api does, rather than rewriting them", () => {
    for (const note of [
      "Created in\nerror twice",
      "Created in\r\nerror",
      "\tCreated in error",
      "Created\u0000in error",
      "Created\u007Fin error",
      "Created\u0085in error",
      "Created \uD800 in error"
    ]) {
      expect(messagesFor({ reason: "DUPLICATE", note })).toEqual({ note: MESSAGES.noteCharacters });
    }
  });

  it("should count the note's bounds in characters after trimming, as api does", () => {
    const shortest = "a".repeat(DELETION_NOTE_LIMITS.minLength);
    const longest = "😀".repeat(DELETION_NOTE_LIMITS.maxLength);

    expect(schema.parse({ reason: "DUPLICATE", note: `  ${shortest}  ` }).note).toBe(shortest);
    expect(schema.parse({ reason: "DUPLICATE", note: longest }).note).toBe(longest);
    expect(messagesFor({ reason: "DUPLICATE", note: `  ${"a".repeat(DELETION_NOTE_LIMITS.minLength - 1)}  ` })).toEqual({ note: MESSAGES.noteTooShort });
    expect(messagesFor({ reason: "DUPLICATE", note: "a".repeat(DELETION_NOTE_LIMITS.maxLength + 1) })).toEqual({ note: MESSAGES.noteTooLong });
  });

  it("should report both controls together when both are wrong", () => {
    expect(messagesFor({})).toEqual({ reason: MESSAGES.reason, note: MESSAGES.noteRequired });
  });
});
