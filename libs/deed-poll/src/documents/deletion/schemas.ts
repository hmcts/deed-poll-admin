import { DOCUMENT_DELETION_REASON_LIMITS, DOCUMENT_DELETION_REFUSAL_CODE } from "@hmcts/deed-poll-api-client";
import { z } from "zod";

// The page bounds its textarea by api's limit and picks its sentences by api's codes, and reaches them only here.
export { DOCUMENT_DELETION_REASON_LIMITS, DOCUMENT_DELETION_REFUSAL_CODE };

// Java's `String.strip()`, which api applies (`CreateDocumentDeletionRequest.reason`): `Character.isWhitespace` at
// either end. Not JavaScript's `trim()`, which also takes U+00A0 and U+FEFF and keeps U+001C to U+001F.
const JAVA_WHITESPACE = "[\\t\\n\\u000b\\f\\r\\u001c-\\u001f \\u1680\\u2000-\\u2006\\u2008-\\u200a\\u2028\\u2029\\u205f\\u3000]";
const STRIP = new RegExp(`^${JAVA_WHITESPACE}+|${JAVA_WHITESPACE}+$`, "g");
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
// api's bidirectional controls: the Arabic letter mark, the LRM and RLM, the embeddings and overrides, the isolates.
const BIDI_CONTROL = /[؜‎‏‪-‮⁦-⁩]/;

/**
 * Reads the confirmation form's one control into the reason api's `CreateDocumentDeletionRequest` takes. The reason
 * is free text in the staff member's own words, kept in the audit trail and written into a case note, so it follows
 * api's rule exactly and a reason this accepts is one api accepts: stripped as Java strips, then 1 to 500 code
 * points, with no control character (an inner line break or tab included), line or paragraph separator,
 * bidirectional control or lone surrogate. A refused character is refused, never rewritten. A repeated control (an
 * array) or a bracketed name (an object) is refused, never stringified. The document's version is not a control: it
 * travels in the signed journey.
 */
export function documentDeletionFormSchema(messages: DocumentDeletionFormMessages) {
  return z.object({
    reason: z
      .string({ error: messages.reasonRequired })
      .transform((reason) => reason.replace(STRIP, ""))
      .superRefine((reason, context) => {
        const message = reasonRefusal(reason, messages);
        if (message) context.addIssue({ code: "custom", message });
      })
  });
}

function reasonRefusal(reason: string, messages: DocumentDeletionFormMessages): string | null {
  if (reason === "") return messages.reasonRequired;
  if (LONE_SURROGATE.test(reason) || BIDI_CONTROL.test(reason) || [...reason].some(isForbidden)) return messages.reasonCharacters;
  if ([...reason].length > DOCUMENT_DELETION_REASON_LIMITS.maxLength) return messages.reasonTooLong;
  return null;
}

// Java's `Character.isISOControl` (C0, DEL and C1) and the line and paragraph separators.
function isForbidden(character: string): boolean {
  const unit = character.charCodeAt(0);
  return unit <= 0x1f || (unit >= 0x7f && unit <= 0x9f) || unit === 0x2028 || unit === 0x2029;
}

export interface DocumentDeletionFormMessages {
  reasonRequired: string;
  reasonCharacters: string;
  reasonTooLong: string;
}

export type DocumentDeletionFormInput = { reason: string };
