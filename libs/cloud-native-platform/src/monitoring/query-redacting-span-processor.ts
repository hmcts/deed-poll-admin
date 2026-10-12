import type { Span, SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { REDACTED, redactUrl } from "./redact-url.js";

const URL_ATTRIBUTES = ["http.url", "url.full", "http.target"];

/**
 * Removes query strings from every span before it is exported, so auto-collected requests and dependencies carry no
 * search terms or OAuth codes. See `redactUrl` for why.
 *
 * A span processor, not `addTelemetryProcessor`, because applicationinsights 3.x keeps that method only as a no-op
 * that logs a warning. Both HTTP semantic conventions are covered (`http.url` / `http.target` and the stable
 * `url.full` / `url.query`), so an SDK bump that switches convention changes nothing.
 *
 * `onStart`, because the HTTP instrumentation and the shim's `trackRequest` both set their URL attributes when the
 * span starts. `query-redacting-span-processor.test.ts` proves the rewrite survives to export with a real provider.
 */
export const queryRedactingSpanProcessor: SpanProcessor = {
  onStart(span: Span) {
    for (const key of URL_ATTRIBUTES) {
      const value = span.attributes[key];
      if (typeof value === "string") {
        span.setAttribute(key, redactUrl(value));
      }
    }
    if (span.attributes["url.query"] !== undefined) {
      span.setAttribute("url.query", REDACTED);
    }
  },
  onEnd() {},
  forceFlush: () => Promise.resolve(),
  shutdown: () => Promise.resolve()
};
