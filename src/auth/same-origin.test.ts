/**
 * Both directions, and the sibling-service case in particular: a gate that only refuses `evil.example` is
 * the protection `SameSite=Lax` already gave.
 *
 * **Every header combination here was measured, not imagined.** The pairs a real Chromium sends against this
 * app's own `Referrer-Policy: no-referrer` are in `./same-origin.ts`'s docblock — including the one that
 * makes `Origin` useless here, where a legitimate form post and a sibling service's forged one both arrive
 * as `Origin: null`. Tests written from the intuitive model instead would have pinned a gate that refuses
 * every form in the service.
 */
import { ForbiddenError } from "@hmcts/deed-poll";
import type { Request } from "express";
import { describe, expect, it, vi } from "vitest";
import { pageResponse } from "../express-doubles.js";
import { requireSameOrigin } from "./same-origin.js";

const HOST = "deed-poll-admin.aat.platform.hmcts.net";

describe("requireSameOrigin", () => {
  it("lets a GET through without looking at where it came from", () => {
    // A `GET` that changed something would be the bug; this gate must not be what hides one.
    const next = vi.fn();

    requireSameOrigin()(requestDouble({ method: "GET", secFetchSite: "cross-site" }), pageResponse(), next);

    expect(next).toHaveBeenCalledWith();
  });

  // The measured shape of every ordinary form post in this app: `Origin: null` because of the referrer
  // policy, and `Sec-Fetch-Site: same-origin` because it came from one of our own pages.
  it("lets the app's own form post through, even though its Origin is null", () => {
    const next = vi.fn();

    requireSameOrigin()(requestDouble({ secFetchSite: "same-origin", origin: "null" }), pageResponse(), next);

    expect(next).toHaveBeenCalledWith();
  });

  it.each([
    // The case this middleware exists for, and the measured pair it arrives as: byte-for-byte the same
    // `Origin` as the test above, distinguishable only by `Sec-Fetch-Site`.
    {
      behaviour: "refuses a post from another service in the same environment, which SameSite=Lax permits",
      secFetchSite: "same-site",
      origin: "null"
    },
    {
      behaviour: "refuses a cross-site post",
      secFetchSite: "cross-site",
      origin: "https://evil.example"
    },
    {
      behaviour: "refuses a sibling's fetch(), which names its origin and is still same-site",
      secFetchSite: "same-site",
      origin: "https://xui-webapp.aat.platform.hmcts.net"
    }
  ])("$behaviour", ({ secFetchSite, origin }) => {
    const next = vi.fn();

    requireSameOrigin()(requestDouble({ secFetchSite, origin }), pageResponse(), next);

    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
  });

  // The timeout warning's keep-alive is a write like any other: a sibling site must not be able to keep a session alive.
  it("refuses a same-site post to the session keep-alive", () => {
    const next = vi.fn();

    requireSameOrigin()(requestDouble({ secFetchSite: "same-site", originalUrl: "/session/keep-alive" }), pageResponse(), next);

    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
  });

  it("allows a user-initiated request with no initiating document, which is not another site's page", () => {
    const next = vi.fn();

    requireSameOrigin()(requestDouble({ secFetchSite: "none" }), pageResponse(), next);

    expect(next).toHaveBeenCalledWith();
  });

  it("refuses a same-site initiator on every unsafe method, not only POST", () => {
    for (const method of ["PUT", "PATCH", "DELETE"]) {
      const next = vi.fn();

      requireSameOrigin()(requestDouble({ method, secFetchSite: "same-site" }), pageResponse(), next);

      expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
    }
  });

  it("refuses a Sec-Fetch-Site value it does not recognise, rather than reading it as this app's own", () => {
    const next = vi.fn();

    requireSameOrigin()(requestDouble({ secFetchSite: "same-orogin" }), pageResponse(), next);

    expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
  });

  describe("on a browser too old to send fetch metadata", () => {
    it("refuses a post whose Origin names somebody else", () => {
      const next = vi.fn();

      requireSameOrigin()(requestDouble({ origin: "https://xui-webapp.aat.platform.hmcts.net" }), pageResponse(), next);

      expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
    });

    it("allows a post whose Origin names this app", () => {
      const next = vi.fn();

      requireSameOrigin()(requestDouble({ origin: `https://${HOST}` }), pageResponse(), next);

      expect(next).toHaveBeenCalledWith();
    });

    it("ignores the scheme, which TLS termination at the ingress makes ours to assert wrongly", () => {
      const next = vi.fn();

      requireSameOrigin()(requestDouble({ origin: `http://${HOST}` }), pageResponse(), next);

      expect(next).toHaveBeenCalledWith();
    });

    it("allows an opaque origin, because this app's own forms send one", () => {
      // `Origin: null` is what `Referrer-Policy: no-referrer` produces for a legitimate same-origin form
      // post, so it cannot be read as evidence of forgery. The residual gap is stated in the docblock.
      const next = vi.fn();

      requireSameOrigin()(requestDouble({ origin: "null" }), pageResponse(), next);

      expect(next).toHaveBeenCalledWith();
    });

    it("refuses when the request has no host to compare a named origin against", () => {
      const next = vi.fn();

      requireSameOrigin()(requestDouble({ origin: `https://${HOST}`, host: "" }), pageResponse(), next);

      expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
    });
  });

  it("allows a post that carries neither header, because a non-browser client is not the threat", () => {
    // `e2e-tests/tests/judicial.spec.ts` posts to a claim route through Playwright's `APIRequestContext`,
    // which sends neither. A client with no cookies cannot be made to act as a signed-in caseworker.
    const next = vi.fn();

    requireSameOrigin()(requestDouble({}), pageResponse(), next);

    expect(next).toHaveBeenCalledWith();
  });

  it("names the method, the path and what the headers said, for the log rather than the page", () => {
    const next = vi.fn();

    requireSameOrigin()(requestDouble({ secFetchSite: "same-site", originalUrl: "/switch-persona" }), pageResponse(), next);

    const error = vi.mocked(next).mock.calls[0][0] as unknown as ForbiddenError;
    expect(error.message).toBe("POST /switch-persona from a same-site initiator");
  });

  // A search's query string carries applicant names, and the headers are whatever the sender chose: neither may
  // reach the message, which is logged. The bounded detail still says which kind of refusal it was.
  describe("what it leaves out of the message", () => {
    const QUERY = `?q=${encodeURIComponent("MARKER-Q Smith")}&where=${encodeURIComponent('surname = "MARKER-WHERE"')}&other=MARKER-OTHER#MARKER-FRAGMENT`;
    const message = (headers: { secFetchSite?: string; origin?: string }) => {
      const next = vi.fn();
      requireSameOrigin()(requestDouble({ ...headers, originalUrl: `/deed-polls/new${QUERY}` }), pageResponse(), next);
      return (next.mock.calls[0][0] as ForbiddenError).message;
    };

    it.each([
      [{ secFetchSite: "same-site" }, "POST /deed-polls/new from a same-site initiator"],
      [{ secFetchSite: "cross-site", origin: "https://MARKER-ORIGIN.example" }, "POST /deed-polls/new from a cross-site initiator"],
      [{ secFetchSite: "MARKER-SITE\nINFO auth.login.succeeded\u001b[31m" }, "POST /deed-polls/new from an unrecognised Sec-Fetch-Site value"],
      [{ origin: "https://MARKER-ORIGIN.example:8443/MARKER-PATH" }, "POST /deed-polls/new from a cross-origin Origin"],
      [{ origin: "MARKER-ORIGIN not a url\r\n" }, "POST /deed-polls/new from a cross-origin Origin"]
    ])("should name the refusal %j with fixed text and no query or header value", (headers, expected) => {
      const text = message(headers);

      expect(text).toBe(expected);
      expect(text).not.toContain("MARKER");
    });
  });

  describe("what it records for the security event", () => {
    const refusal = (headers: { secFetchSite?: string; origin?: string }) => {
      const next = vi.fn();
      requireSameOrigin()(requestDouble(headers), pageResponse(), next);
      return next.mock.calls[0][0] as ForbiddenError;
    };

    it("marks its refusal as the same-origin gate's and records the fetch site", () => {
      const error = refusal({ secFetchSite: "same-site" });

      expect(error.reason).toBe("same-origin");
      expect(error.fetchSite).toBe("same-site");
      expect(error.originHost).toBeUndefined();
    });

    // `Sec-Fetch-Site` is forbidden to a page but not to a script, so a value outside the spec is recorded as
    // that rather than as whatever text the sender chose.
    it("records a fetch site outside the specification as unrecognised", () => {
      expect(refusal({ secFetchSite: "evil\nline" }).fetchSite).toBe("unrecognised");
    });

    it("records only the host of a cross-origin Origin, never the full value", () => {
      const error = refusal({ origin: "https://evil.example:8443" });

      expect(error.reason).toBe("same-origin");
      expect(error.originHost).toBe("evil.example:8443");
      expect(error.fetchSite).toBeUndefined();
    });

    it("records no host for an Origin longer than a DNS name can be", () => {
      const error = refusal({ origin: `https://${"a".repeat(300)}.example` });

      expect(error.reason).toBe("same-origin");
      expect(error.originHost).toBeUndefined();
    });

    it("records no host for an Origin that does not parse", () => {
      const error = refusal({ origin: "not a url" });

      expect(error.reason).toBe("same-origin");
      expect(error.originHost).toBeUndefined();
    });
  });

  it("does not render or set a status itself, leaving the 403 to the one error mapping", () => {
    const res = pageResponse();

    requireSameOrigin()(requestDouble({ secFetchSite: "cross-site" }), res, vi.fn());

    expect(res.render).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});

/**
 * A request with a method and the three headers this reads, which `pageRequest` does not model — it builds a
 * session for page handlers, and nothing here looks at one.
 */
function requestDouble({
  method = "POST",
  secFetchSite,
  origin,
  host = HOST,
  originalUrl = "/deed-polls/new"
}: {
  method?: string;
  secFetchSite?: string;
  origin?: string;
  host?: string;
  originalUrl?: string;
}): Request {
  const headers: Record<string, string | undefined> = { "sec-fetch-site": secFetchSite, origin, host };

  // Mounted on the app, so `baseUrl` is empty and `path` is Express's: the URL without its query or fragment.
  const path = originalUrl.split(/[?#]/, 1)[0];

  return { method, originalUrl, baseUrl: "", path, get: (name: string) => headers[name.toLowerCase()] } as unknown as Request;
}
