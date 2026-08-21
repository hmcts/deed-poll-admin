import * as appInsights from "applicationinsights";

/**
 * Tracks an exception to Application Insights using the default client.
 * This function should be used in route handlers where the MonitoringService instance is not directly available.
 * Requires that Application Insights has been initialized via monitoringMiddleware.
 *
 * @param error - The error to track
 * @param properties - Optional contextual properties to include with the exception
 */
export function trackException(error: Error, properties?: Record<string, unknown>): void {
  if (appInsights.defaultClient) {
    console.error(error.message, { ...properties, error });

    appInsights.defaultClient.trackException({
      exception: error,
      properties
    });
  } else {
    console.error("Application Insights not initialized, cannot track exception:", error.message, properties);
  }
}
