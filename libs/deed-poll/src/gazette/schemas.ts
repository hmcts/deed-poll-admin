import { validateGazetteRecipientEmail } from "@hmcts/deed-poll-api-client";
import { z } from "zod";

export function gazetteSettingsFormSchema(messages: { required: string; invalid: string; reload: string }) {
  return z.object({
    recipientEmail: z
      .string({ error: messages.required })
      .trim()
      .min(1, messages.required)
      .max(254, messages.invalid)
      .superRefine((email, context) => validateGazetteRecipientEmail(email, context, messages.invalid))
      .refine((email) => email.indexOf("@") <= 64, messages.invalid),
    revision: z
      .string({ error: messages.reload })
      .regex(/^(0|[1-9]\d*)$/, messages.reload)
      .transform(Number)
      .refine((value) => Number.isSafeInteger(value) && value <= 2147483647, messages.reload)
  });
}
