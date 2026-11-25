import { DELETION_NOTE_LIMITS, DELETION_REASON, type DeletionReason } from "@hmcts/deed-poll-api-client";
import { z } from "zod";

// The page draws a radio per reason and bounds its textarea by api's limits, and reaches api's vocabulary only here.
export { DELETION_NOTE_LIMITS, DELETION_REASON };

// api trims ordinary spaces only (`CreateDeletionRequest.note`), so a tab or a line break is not trimmed away.
const EDGE_SPACES = /^ +| +$/g;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * Reads the confirmation form's two controls into what api's `CreateDeletionRequest` takes from a person. Each must
 * be one string: a repeated control (an array) or a bracketed name (an object) is refused, never stringified. The
 * note follows api's rule exactly, so a note this accepts is one api accepts: spaces trimmed, then 10 to 500
 * characters counted as code points, with no control character (tabs and line breaks included) and no lone
 * surrogate. A line break is refused rather than rewritten, because the note is audit text in the Delivery
 * Manager's own words. The case's `lastChangedOn` is not a control: it travels in the signed journey.
 */
export function deletionFormSchema(messages: DeletionFormMessages) {
  return z.object({
    reason: z.enum(DELETION_REASON, { error: messages.reason }),
    note: z
      .string({ error: messages.noteRequired })
      .transform((note) => note.replace(EDGE_SPACES, ""))
      .superRefine((note, context) => {
        const message = noteRefusal(note, messages);
        if (message) context.addIssue({ code: "custom", message });
      })
  });
}

function noteRefusal(note: string, messages: DeletionFormMessages): string | null {
  if (note === "") return messages.noteRequired;
  if (hasControlCharacter(note) || LONE_SURROGATE.test(note)) return messages.noteCharacters;
  const length = [...note].length;
  if (length < DELETION_NOTE_LIMITS.minLength) return messages.noteTooShort;
  if (length > DELETION_NOTE_LIMITS.maxLength) return messages.noteTooLong;
  return null;
}

// Java's `Character.isISOControl`, which api applies: C0, DEL and C1.
function hasControlCharacter(text: string): boolean {
  return [...text].some((character) => {
    const unit = character.charCodeAt(0);
    return unit <= 0x1f || (unit >= 0x7f && unit <= 0x9f);
  });
}

export interface DeletionFormMessages {
  reason: string;
  noteRequired: string;
  noteCharacters: string;
  noteTooShort: string;
  noteTooLong: string;
}

export type DeletionFormInput = { reason: DeletionReason; note: string };
