export type HealthStatus = "UP" | "DOWN";

export type HealthCheck = () => Promise<HealthStatus>;

export function up(): HealthStatus {
  return "UP";
}

export function down(): HealthStatus {
  return "DOWN";
}

export function web(url: string, timeout = 10000): HealthCheck {
  return async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      return response.ok ? "UP" : "DOWN";
    } catch {
      clearTimeout(timeoutId);
      return "DOWN";
    }
  };
}

export function raw(check: () => Promise<unknown> | unknown): HealthCheck {
  return async () => {
    try {
      const result = await check();
      return result === "UP" || result === "DOWN" ? result : "UP";
    } catch {
      return "DOWN";
    }
  };
}
