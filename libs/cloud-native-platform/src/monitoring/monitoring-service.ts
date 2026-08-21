import * as appInsights from "applicationinsights";

export class MonitoringService {
  private client?: appInsights.TelemetryClient;

  constructor(
    connectionString: string,
    serviceName: string,
    private readonly logger: Logger = console
  ) {
    // Set cloud role name via environment variable before setup (required for AI v3)
    process.env.APPLICATIONINSIGHTS_ROLE_NAME = serviceName;

    appInsights
      .setup(connectionString)
      .setAutoCollectRequests(true)
      .setAutoCollectPerformance(true, true)
      .setAutoCollectExceptions(true)
      .setAutoCollectDependencies(true)
      .setAutoCollectConsole(true, true)
      .setUseDiskRetryCaching(true)
      .start();

    this.client = appInsights.defaultClient;
  }

  trackRequest(options: TrackRequestOptions): void {
    this.client?.trackRequest({
      name: options.name,
      url: options.url,
      duration: options.duration,
      resultCode: options.resultCode.toString(),
      success: options.success,
      properties: options.properties
    });
  }

  trackException(error: Error, properties?: Record<string, any>): void {
    this.logger.error(error.message, { error, ...properties });

    this.client?.trackException({
      exception: error,
      properties
    });
  }

  trackEvent(name: string, properties?: Record<string, any>): void {
    this.logger.info(`Event: ${name}`, properties);

    this.client?.trackEvent({
      name,
      properties
    });
  }

  trackMetric(name: string, value: number, properties?: Record<string, any>): void {
    this.client?.trackMetric({
      name,
      value,
      properties
    });
  }

  flush(): Promise<void> {
    this.client?.flush();
    return Promise.resolve();
  }
}

export interface TrackRequestOptions {
  name: string;
  url: string;
  duration: number;
  resultCode: number;
  success: boolean;
  properties?: Record<string, any>;
}

export type Logger = Pick<typeof console, "log" | "info" | "warn" | "error">;
