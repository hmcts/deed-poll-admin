import { describe, expect, it } from "vitest";
import { redactUrl } from "./redact-url.js";

describe("redactUrl", () => {
  it("should replace a case search's query with a marker, keeping the path", () => {
    expect(redactUrl("/deed-polls?q=Testperson&where=dateOfBirth:eq:1980-01-01")).toBe("/deed-polls?REDACTED");
  });

  it("should keep the scheme and host of an absolute URL", () => {
    expect(redactUrl("http://deed-poll-api.internal/caseworker/cases?q=Testperson")).toBe("http://deed-poll-api.internal/caseworker/cases?REDACTED");
  });

  it("should redact the OAuth code and state on the callback", () => {
    expect(redactUrl("/oauth2/callback?code=abc&state=xyz")).toBe("/oauth2/callback?REDACTED");
  });

  it("should redact a returnTo whose own query carries a search term", () => {
    expect(redactUrl("/login?returnTo=%2Fdeed-polls%3Fq%3DTestperson")).toBe("/login?REDACTED");
  });

  it("should drop a fragment, and a query before it, without leaving either", () => {
    expect(redactUrl("/deed-polls?q=Testperson#results")).toBe("/deed-polls?REDACTED");
    expect(redactUrl("/deed-polls#results")).toBe("/deed-polls");
  });

  it("should leave a URL with no query unchanged", () => {
    expect(redactUrl("/deed-polls/a-case-id")).toBe("/deed-polls/a-case-id");
    expect(redactUrl("https://example.test/")).toBe("https://example.test/");
  });

  it("should not invent a marker for an empty query", () => {
    expect(redactUrl("/deed-polls?")).toBe("/deed-polls");
  });
});
