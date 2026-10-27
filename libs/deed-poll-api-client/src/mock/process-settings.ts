import { PROCESS_SETTINGS_LIMITS, type WireProcessSettings } from "../api/wire.js";

const CLAIM_WINDOW = "referralClaimExpiryMinutes";
const REVISION = "revision";
const KEYS = new Set([CLAIM_WINDOW, REVISION]);
const CLAIM_WINDOW_MESSAGE = `Enter a claim window from ${PROCESS_SETTINGS_LIMITS.minClaimMinutes} to ${PROCESS_SETTINGS_LIMITS.maxClaimMinutes} minutes, in whole minutes.`;

/**
 * api's `ProcessSettingsService`, restated for the one settings row: the same closed keys, bounds and checking order,
 * so a stale form holding the value the row already has is told 409 rather than that it saved.
 */
export function createProcessSettings() {
  let settings = seeded();

  return {
    reset() {
      settings = seeded();
    },
    read(): WireProcessSettings {
      return settings;
    },
    update(body: unknown, name: string): Reply {
      const fields = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
      const unknownKey = Object.keys(fields).find((key) => !KEYS.has(key));
      if (unknownKey) return invalid(unknownKey, `Only ${CLAIM_WINDOW} and ${REVISION} may be supplied.`);

      const minutes = fields[CLAIM_WINDOW];
      if (!isWholeNumber(minutes) || minutes < PROCESS_SETTINGS_LIMITS.minClaimMinutes || minutes > PROCESS_SETTINGS_LIMITS.maxClaimMinutes) {
        return invalid(CLAIM_WINDOW, CLAIM_WINDOW_MESSAGE);
      }
      const revision = fields[REVISION];
      if (!isWholeNumber(revision) || revision < 0) return invalid(REVISION, "Reload the process settings before saving.");

      if (revision !== settings.revision) return { status: 409, body: { error: "The process settings have changed. Reload them before saving." } };
      if (minutes !== settings.referralClaimExpiryMinutes) {
        settings = { referralClaimExpiryMinutes: minutes, revision: revision + 1, updatedAt: new Date(), updatedBy: name };
      }
      return { status: 200, body: settings };
    }
  };
}

function seeded(): WireProcessSettings {
  return { referralClaimExpiryMinutes: 120, revision: 0, updatedAt: null, updatedBy: null };
}

function invalid(field: string, message: string): Reply {
  return { status: 400, body: { error: message, errors: [{ field, message }] } };
}

// api reads each as a Java `Integer`, so a string, a fraction or null is refused rather than coerced.
function isWholeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

interface Reply {
  status: number;
  body: unknown;
}
