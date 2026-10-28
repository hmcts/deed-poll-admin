import { PROCESS_SETTINGS_LIMITS, WINDOW_TIME_PATTERN, type WireProcessSettings } from "../api/wire.js";

const PROCESSING_WINDOW = "referralClaimExpiryMinutes";
const REVISION = "revision";
const WINDOW_TIMES = ["morningWindowStart", "morningWindowEnd", "afternoonWindowStart", "afternoonWindowEnd"] as const;
const OPTIONAL_INTS = {
  reminderIntervalHours: {
    min: PROCESS_SETTINGS_LIMITS.minReminderHours,
    max: PROCESS_SETTINGS_LIMITS.maxReminderHours,
    message: `Enter a reminder interval from ${PROCESS_SETTINGS_LIMITS.minReminderHours} to ${PROCESS_SETTINGS_LIMITS.maxReminderHours} hours, in whole hours.`
  },
  masterWindowCap: {
    min: PROCESS_SETTINGS_LIMITS.minMasterWindowCap,
    max: PROCESS_SETTINGS_LIMITS.maxMasterWindowCap,
    message: `Enter a cap from ${PROCESS_SETTINGS_LIMITS.minMasterWindowCap} to ${PROCESS_SETTINGS_LIMITS.maxMasterWindowCap} referrals per Master per window.`
  }
} as const;
const KEYS = new Set<string>([PROCESSING_WINDOW, REVISION, ...Object.keys(OPTIONAL_INTS), ...WINDOW_TIMES]);
const PROCESSING_WINDOW_MESSAGE = `Enter a processing window from ${PROCESS_SETTINGS_LIMITS.minProcessingMinutes} to ${PROCESS_SETTINGS_LIMITS.maxProcessingMinutes} minutes (1 to 30 days), in whole minutes.`;
const WINDOW_TIME = new RegExp(WINDOW_TIME_PATTERN);

/**
 * api's `ProcessSettingsService`, restated for the one settings row: the same closed keys, bounds and checking order,
 * so a stale form holding the value the row already has is told 409 rather than that it saved. Every setting but the
 * processing window is optional for one release, and an absent one keeps the stored value.
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
      if (unknownKey) return invalid(unknownKey, `${unknownKey} is not a process setting.`);

      const minutes = fields[PROCESSING_WINDOW];
      if (!isWholeNumber(minutes) || minutes < PROCESS_SETTINGS_LIMITS.minProcessingMinutes || minutes > PROCESS_SETTINGS_LIMITS.maxProcessingMinutes) {
        return invalid(PROCESSING_WINDOW, PROCESSING_WINDOW_MESSAGE);
      }
      for (const [key, bounds] of Object.entries(OPTIONAL_INTS)) {
        if (!(key in fields)) continue;
        const value = fields[key];
        if (!isWholeNumber(value) || value < bounds.min || value > bounds.max) return invalid(key, bounds.message);
      }
      for (const key of WINDOW_TIMES) {
        if (!(key in fields)) continue;
        const value = fields[key];
        if (typeof value !== "string" || !WINDOW_TIME.test(value)) return invalid(key, "Enter a time as HH:mm on the quarter hour.");
      }
      const revision = fields[REVISION];
      if (!isWholeNumber(revision) || revision < 0) return invalid(REVISION, "Reload the process settings before saving.");

      if (revision !== settings.revision) return { status: 409, body: { error: "The process settings have changed. Reload them before saving." } };
      const merged = { ...settings, ...(fields as Partial<WireProcessSettings>), revision: settings.revision };
      if (changed(settings, merged)) {
        settings = { ...merged, revision: revision + 1, updatedAt: new Date(), updatedBy: name };
      }
      return { status: 200, body: settings };
    }
  };
}

/** api's seeded row: seven days, 48 hours, ten per window, 07:00-10:30 and 14:00-14:30 Europe/London. */
function seeded(): WireProcessSettings {
  return {
    referralClaimExpiryMinutes: 10080,
    reminderIntervalHours: 48,
    masterWindowCap: 10,
    morningWindowStart: "07:00",
    morningWindowEnd: "10:30",
    afternoonWindowStart: "14:00",
    afternoonWindowEnd: "14:30",
    revision: 0,
    updatedAt: null,
    updatedBy: null
  };
}

function changed(stored: WireProcessSettings, merged: WireProcessSettings): boolean {
  return [PROCESSING_WINDOW, ...Object.keys(OPTIONAL_INTS), ...WINDOW_TIMES].some(
    (key) => stored[key as keyof WireProcessSettings] !== merged[key as keyof WireProcessSettings]
  );
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
