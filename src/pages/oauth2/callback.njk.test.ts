/**
 * The sign-in refusal page as the browser receives it (review finding R10, plan
 * `docs/plans/completed/20261021-r10-r14-error-disclosure.md`). The callback's query is the browser's to write, so the
 * real `errors/403.njk` must carry only this app's own sentence for a code it knows, and none of the query's text.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import nunjucks from "nunjucks";
import { describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../express-doubles.js";
import { GET } from "./callback.js";

vi.mock("@hmcts-cft/cloud-native-platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts-cft/cloud-native-platform")>()),
  trackEvent: vi.fn()
}));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STARTER_VIEWS = path.join(HERE, "../../../libs/express-govuk-starter/src");
const environment = nunjucks.configure(
  [
    path.join(fileURLToPath(import.meta.resolve("govuk-frontend")), "..", ".."),
    path.join(STARTER_VIEWS, "govuk-frontend/views"),
    path.join(STARTER_VIEWS, "cookies/views"),
    path.join(HERE, "..")
  ],
  { autoescape: true }
);
const FLOW = { codeVerifier: "a-verifier", state: "a-state", returnTo: "/deed-polls" };
const MARKER = "MARKER-a1b2c3";

async function html(query: Record<string, unknown>): Promise<string> {
  const res = pageResponse();
  const req = Object.assign(pageRequest({ signedIn: false, flow: FLOW, query }), { method: "GET", baseUrl: "", path: "/oauth2/callback" });
  await GET(req, res);
  const [view, model] = res.render.mock.calls[0] as [string, Record<string, unknown>];
  return environment.render(`${view}.njk`, { ...(model.en as object), ...model });
}

describe("the sign-in refusal page", () => {
  it("should show this app's sentence for access_denied and none of IDAM's description", async () => {
    const markup = await html({ error: "access_denied", error_description: `${MARKER} Call 0800 000 0000` });

    expect(markup).toContain("Sign in was cancelled or refused.");
    expect(markup).not.toContain(MARKER);
    expect(markup).not.toContain("0800");
  });

  it("should show the shared unavailable sentence for temporarily_unavailable", async () => {
    const markup = await html({ error: "temporarily_unavailable", error_description: MARKER });

    expect(markup).toContain("The sign-in service is not working at the moment. Try again later.");
    expect(markup).not.toContain(MARKER);
  });

  it.each([
    ["an unrecognised code", { error: `${MARKER}_code`, error_description: MARKER }],
    ["a code outside the code pattern", { error: `access_denied ${MARKER}` }],
    ["a repeated description", { error: "invalid_request", error_description: [MARKER, MARKER] }]
  ])("should show only the page's fixed text for %s", async (_label, query) => {
    const markup = await html(query);

    expect(markup).toContain("You cannot access this page");
    expect(markup).toContain("You may need to");
    expect(markup).not.toContain(MARKER);
    expect(markup).not.toContain("Sign in was cancelled");
    expect(markup).not.toContain("is not working at the moment");
  });
});
