import { DOCUMENT_DELETION_REASON_LIMITS } from "@hmcts/deed-poll-api-client";
import { describe, expect, it } from "vitest";
import { documentDeletionFormSchema } from "./schemas.js";

const MESSAGES = { reasonRequired: "Enter why", reasonCharacters: "One line", reasonTooLong: "Too long" };
const schema = documentDeletionFormSchema(MESSAGES);

function messagesFor(input: unknown): Record<string, string> {
  const result = schema.safeParse(input);
  if (result.success) return {};
  return Object.fromEntries(result.error.issues.map((issue) => [issue.path.join("."), issue.message]));
}

describe("documentDeletionFormSchema", () => {
  it("should accept a short free-text reason, with no ten-character minimum", () => {
    // Arrange / Act
    const parsed = schema.parse({ reason: "Wrong" });

    // Assert
    expect(parsed).toEqual({ reason: "Wrong" });
    expect(schema.parse({ reason: "x" }).reason).toBe("x");
  });

  it("should strip edge whitespace as Java's strip does, including a browser's trailing line break", () => {
    expect(schema.parse({ reason: "  Uploaded in error\r\n" }).reason).toBe("Uploaded in error");
    expect(schema.parse({ reason: "\t\u3000Uploaded in error\u2003" }).reason).toBe("Uploaded in error");
    expect(schema.parse({ reason: "\u001fUploaded in error" }).reason).toBe("Uploaded in error");
  });

  it("should keep a no-break space or byte-order mark at the edges, which Java does not strip", () => {
    expect(schema.parse({ reason: "\u00a0Uploaded in error" }).reason).toBe("\u00a0Uploaded in error");
    expect(schema.parse({ reason: "Uploaded in error\ufeff" }).reason).toBe("Uploaded in error\ufeff");
  });

  it("should refuse a missing, blank, repeated or object-shaped reason without stringifying it", () => {
    for (const reason of [undefined, "", "   ", "\r\n\t", ["Uploaded in error"], ["a", "b"], { text: "Uploaded in error" }, 7, null]) {
      expect(messagesFor({ reason })).toEqual({ reason: MESSAGES.reasonRequired });
    }
    expect(messagesFor({})).toEqual({ reason: MESSAGES.reasonRequired });
  });

  it("should refuse inner line breaks, tabs, control characters, separators, bidirectional controls and lone surrogates", () => {
    for (const reason of [
      "Uploaded in\nerror",
      "Uploaded in\r\nerror",
      "Uploaded\tin error",
      "Uploaded\u0000in error",
      "Uploaded\u007fin error",
      "Uploaded\u0085in error",
      "Uploaded\u2028in error",
      "Uploaded\u2029in error",
      "Uploaded \u202ein error",
      "Uploaded \u2066in error",
      "Uploaded \u200fin error",
      "Uploaded \u061cin error",
      "Uploaded \ud800 in error",
      "Uploaded \udc00 in error"
    ]) {
      expect(messagesFor({ reason })).toEqual({ reason: MESSAGES.reasonCharacters });
    }
  });

  it("should accept accented letters, Welsh and emoji, and count the limit in code points after stripping", () => {
    const longest = "😀".repeat(DOCUMENT_DELETION_REASON_LIMITS.maxLength);

    expect(schema.parse({ reason: "Llwythwyd i fyny mewn camgymeriad – ŵ ŷ é" }).reason).toBe("Llwythwyd i fyny mewn camgymeriad – ŵ ŷ é");
    expect(schema.parse({ reason: `  ${longest}  ` }).reason).toBe(longest);
    expect(messagesFor({ reason: "a".repeat(DOCUMENT_DELETION_REASON_LIMITS.maxLength + 1) })).toEqual({ reason: MESSAGES.reasonTooLong });
  });

  it("should not escape or rewrite markup, which the template escapes on output", () => {
    expect(schema.parse({ reason: "<script>alert(1)</script> & co" }).reason).toBe("<script>alert(1)</script> & co");
  });
});
