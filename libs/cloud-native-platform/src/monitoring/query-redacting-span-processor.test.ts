import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { afterEach, describe, expect, it } from "vitest";
import { queryRedactingSpanProcessor } from "./query-redacting-span-processor.js";

/**
 * A real tracer provider and exporter, so what is asserted is what would be exported to App Insights, not what a
 * mock was told. The redacting processor runs first, as `setAzureMonitorOptions` places it ahead of the exporter.
 */
describe("queryRedactingSpanProcessor", () => {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [queryRedactingSpanProcessor, new SimpleSpanProcessor(exporter)]
  });
  const tracer = provider.getTracer("test");

  afterEach(() => exporter.reset());

  it("should export no URL attribute carrying the search term, under either HTTP convention", () => {
    tracer
      .startSpan("GET", {
        attributes: {
          "http.url": "http://admin.test/deed-polls?q=Testperson",
          "url.full": "http://admin.test/deed-polls?q=Testperson",
          "http.target": "/deed-polls?q=Testperson",
          "url.query": "q=Testperson"
        }
      })
      .end();

    const [span] = exporter.getFinishedSpans();
    expect(span.attributes).toEqual({
      "http.url": "http://admin.test/deed-polls?REDACTED",
      "url.full": "http://admin.test/deed-polls?REDACTED",
      "http.target": "/deed-polls?REDACTED",
      "url.query": "REDACTED"
    });
    expect(JSON.stringify(span.attributes)).not.toContain("Testperson");
  });

  it("should leave a span without URL attributes as it was", () => {
    tracer.startSpan("SELECT", { attributes: { "db.system": "redis" } }).end();

    expect(exporter.getFinishedSpans()[0].attributes).toEqual({ "db.system": "redis" });
  });

  it("should leave a URL without a query as it was", () => {
    tracer.startSpan("GET", { attributes: { "url.full": "http://admin.test/deed-polls/a-case-id" } }).end();

    expect(exporter.getFinishedSpans()[0].attributes["url.full"]).toBe("http://admin.test/deed-polls/a-case-id");
  });
});
