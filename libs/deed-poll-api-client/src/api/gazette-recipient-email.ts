import type { RefinementCtx } from "zod";

/** Published contract data; runtime validation below checks its parts without compiling the repeated groups. */
export const GAZETTE_RECIPIENT_EMAIL_PATTERN =
  "^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:[.][A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:[.][A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$";

/** Check an already-trimmed address; callers retain their own length limits and required-field messages. */
export function validateGazetteRecipientEmail(email: string, context: RefinementCtx<string>, message?: string): void {
  if (hasEmailStructure(email)) return;
  // The mock exposes these messages in its 400 response; keep the existing regex issue shape as well.
  context.addIssue({
    origin: "string",
    code: "invalid_format",
    format: "regex",
    pattern: `/${GAZETTE_RECIPIENT_EMAIL_PATTERN}/`,
    message
  });
}

function hasEmailStructure(email: string): boolean {
  const parts = email.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local.split(".").every((atom) => atom.length > 0 && !/[^A-Za-z0-9!#$%&'*+/=?^_`{|}~-]/.test(atom))) return false;
  const labels = domain.split(".");
  return (
    labels.length >= 2 &&
    labels.every((label) => label.length > 0 && label.length <= 63 && !label.startsWith("-") && !label.endsWith("-") && !/[^A-Za-z0-9-]/.test(label))
  );
}
