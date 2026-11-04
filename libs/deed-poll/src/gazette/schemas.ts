import { validateGazetteRecipientEmail } from "@hmcts/deed-poll-api-client";
import { z } from "zod";
import { settingsRevision } from "../schema-primitives.js";

export function gazetteSettingsFormSchema(messages: { required: string; invalid: string; reload: string }) {
  return z.object({
    recipientEmail: z
      .string({ error: messages.required })
      .trim()
      .min(1, messages.required)
      .max(254, messages.invalid)
      .superRefine((email, context) => validateGazetteRecipientEmail(email, context, messages.invalid))
      .refine((email) => email.indexOf("@") <= 64, messages.invalid),
    revision: settingsRevision(messages.reload)
  });
}
