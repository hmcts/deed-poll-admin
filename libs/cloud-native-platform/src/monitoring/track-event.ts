// A default import: see monitoring-service.ts for why the namespace form never sees the client.
import appInsights from "applicationinsights";

/**
 * Tracks a custom event to Application Insights using the default client, as a `customEvents` row.
 *
 * Without a client (development and test) it writes one JSON `console.info` line instead, so the event is still
 * visible and still one parseable record rather than free text.
 *
 * @param name - The event name
 * @param properties - The event's properties; the caller decides which keys are safe to record
 */
export function trackEvent(name: string, properties: Record<string, string> = {}): void {
  if (appInsights.defaultClient) {
    appInsights.defaultClient.trackEvent({ name, properties });
  } else {
    console.info(JSON.stringify({ event: name, properties }));
  }
}
