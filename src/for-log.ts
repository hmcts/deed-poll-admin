/**
 * Makes text this app did not write safe to put in a log line: an api error message is api's prose, and some of it
 * quotes what a caseworker typed. A CR or LF in it would forge a second log line, and a terminal escape would rewrite
 * the one an engineer is reading (CWE-117). Escape sequences go whole, then any control character left, then the
 * length is capped so one message cannot flood the log.
 */
const MAX_LENGTH = 500;
// CSI (`ESC [ … final`), OSC (`ESC ] … BEL|ST`) and the two-byte `ESC <char>` forms, in that order of precedence.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
const ESCAPE_SEQUENCE = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-_]/g;
// C0, DEL, C1, and the two Unicode line terminators some log viewers break on.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching control characters is the point.
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

export function forLog(text: string): string {
  const cleaned = text.replace(ESCAPE_SEQUENCE, "").replace(CONTROL_CHARACTER, "");
  if (cleaned.length <= MAX_LENGTH) return cleaned;

  // By code point, so the cap cannot leave half a surrogate pair at the end.
  return Array.from(cleaned).slice(0, MAX_LENGTH).join("");
}
