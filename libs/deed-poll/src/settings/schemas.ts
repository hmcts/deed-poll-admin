import { PROCESS_SETTINGS_LIMITS } from "@hmcts/deed-poll-api-client";
import { z } from "zod";
import { settingsRevision } from "../schema-primitives.js";

// ASCII digits only, unlike the case form's `readNumericInput`: a sign, a fraction or an exponent is not a
// spelling of a duration anyone types into an hours box (plan `docs/plans/20261026-dm-settings-page.md`).
const DIGITS = /^\d{1,4}$/;
const MAX_HOURS = 24;
const MAX_MINUTES = 59;

/**
 * Reads the claim window's hours and minutes into `referralClaimExpiryMinutes`. An issue on `claimWindowHours` or
 * `claimWindowMinutes` belongs to that input; one on `claimWindow` belongs to the fieldset holding both.
 */
export function processSettingsFormSchema(messages: ProcessSettingsFormMessages) {
  return z
    .object({
      claimWindowHours: durationPart(MAX_HOURS, messages.hours),
      claimWindowMinutes: durationPart(MAX_MINUTES, messages.minutes),
      revision: settingsRevision(messages.reload)
    })
    .transform(({ claimWindowHours, claimWindowMinutes, revision }, context) => {
      if (claimWindowHours === null && claimWindowMinutes === null) {
        context.addIssue({ code: "custom", path: ["claimWindow"], message: messages.required });
        return z.NEVER;
      }
      const total = (claimWindowHours ?? 0) * 60 + (claimWindowMinutes ?? 0);
      if (total < PROCESS_SETTINGS_LIMITS.minClaimMinutes || total > PROCESS_SETTINGS_LIMITS.maxClaimMinutes) {
        context.addIssue({ code: "custom", path: ["claimWindow"], message: messages.range });
        return z.NEVER;
      }
      return { referralClaimExpiryMinutes: total, revision };
    });
}

/** Blank reads as `null`, so the object can tell "both blank" from "0 hours". */
function durationPart(max: number, message: string) {
  return z
    .string({ error: message })
    .trim()
    .refine((value) => value === "" || DIGITS.test(value), message)
    .transform((value) => (value === "" ? null : Number(value)))
    .refine((value) => value === null || value <= max, message);
}

export interface ProcessSettingsFormMessages {
  hours: string;
  minutes: string;
  required: string;
  range: string;
  reload: string;
}
