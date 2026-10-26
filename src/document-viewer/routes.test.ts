/**
 * The viewer's six routes over HTTP, behind the app's real sign-in gate, judicial gate and error handler.
 *
 * The handler tests beside each route pin what it asks api; this file pins what reaches it at all. Express decodes
 * the route parameters here as it does in the app, so an encoded delimiter reaches the domain call as the raw id it
 * spells. Only the domain's api calls and the session are doubled, and `res.render` names its view rather than
 * rendering it: the markup is `src/pages/document-viewer.njk.test.ts`'s.
 */
import { PassThrough } from "node:stream";
import {
  downloadDocument,
  downloadReferralDocument,
  ForbiddenError,
  findDeedPoll,
  getReferral,
  NotFoundError,
  previewDocument,
  previewReferralDocument,
  UnauthorizedError
} from "@hmcts/deed-poll";
import express, { type NextFunction, type Request, type Response } from "express";
import supertest from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requireAuth } from "../auth/require-auth.js";
import { requireJudicial } from "../auth/require-role.js";
import { domainErrorHandler } from "../errors.js";
import { type Persona, pageRequest } from "../express-doubles.js";
import { GET as caseDownload } from "../pages/deed-polls/[id]/documents/[documentId]/download.js";
import { GET as casePreview } from "../pages/deed-polls/[id]/documents/[documentId]/preview.js";
import { GET as caseView } from "../pages/deed-polls/[id]/documents/[documentId]/view.js";
import { GET as referralDownload } from "../pages/judicial/referrals/[referralId]/documents/[documentId]/download.js";
import { GET as referralPreview } from "../pages/judicial/referrals/[referralId]/documents/[documentId]/preview.js";
import { GET as referralView } from "../pages/judicial/referrals/[referralId]/documents/[documentId]/view.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPoll: vi.fn(),
  getReferral: vi.fn(),
  previewDocument: vi.fn(),
  previewReferralDocument: vi.fn(),
  downloadDocument: vi.fn(),
  downloadReferralDocument: vi.fn()
}));

const CASE_DOCUMENTS = [
  { id: "doc-a", name: "Deed poll", mimeType: "application/pdf", hasFile: true },
  { id: "doc/b", name: "Statement", mimeType: "application/pdf", hasFile: true }
];
const REFERRAL_DOCUMENTS = [{ id: "doc-a", name: "Deed poll", mimeType: "application/pdf" }];

const CASE_ROUTES = ["view", "preview", "download"].map((route) => `/deed-polls/case-1/documents/doc-a/${route}`);
const REFERRAL_ROUTES = ["view", "preview", "download"].map((route) => `/judicial/referrals/ref-1/documents/doc-a/${route}`);

const app = express();
app.use((req: Request, res: Response, next: NextFunction) => {
  const persona = req.get("x-persona") as Persona | undefined;
  const double = pageRequest(persona ? { persona, accessToken: `${persona}-token` } : { signedIn: false });
  Object.assign(req, { session: double.session, sessionID: "test-session" });
  res.render = ((view: string) => res.type("text/plain").send(`view:${view}`)) as Response["render"];
  next();
});
app.use(requireAuth());
app.use("/judicial", requireJudicial());
app.get("/deed-polls/:id/documents/:documentId/view", caseView);
app.get("/deed-polls/:id/documents/:documentId/preview", casePreview);
app.get("/deed-polls/:id/documents/:documentId/download", caseDownload);
app.get("/judicial/referrals/:referralId/documents/:documentId/view", referralView);
app.get("/judicial/referrals/:referralId/documents/:documentId/preview", referralPreview);
app.get("/judicial/referrals/:referralId/documents/:documentId/download", referralDownload);
app.use(domainErrorHandler());

function binary(contentType = "application/pdf") {
  const body = new PassThrough();
  body.end("bytes");
  return { body, contentType, contentDisposition: 'inline; filename="deed poll.pdf"', contentSecurityPolicy: "default-src 'none'; sandbox", contentLength: 5 };
}

describe("document viewer routes over HTTP", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.mocked(findDeedPoll).mockResolvedValue({
      id: "case-1",
      displayReference: "KBDP2026-00042",
      notes: [],
      witnesses: [],
      documents: CASE_DOCUMENTS
    } as never);
    vi.mocked(getReferral).mockResolvedValue({
      id: "ref-1",
      state: "Open",
      reasons: [],
      application: { documents: REFERRAL_DOCUMENTS },
      caseNotes: []
    } as never);
    vi.mocked(previewDocument).mockImplementation(async () => binary() as never);
    vi.mocked(previewReferralDocument).mockImplementation(async () => binary() as never);
    vi.mocked(downloadDocument).mockImplementation(async () => binary() as never);
    vi.mocked(downloadReferralDocument).mockImplementation(async () => binary() as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([...CASE_ROUTES, ...REFERRAL_ROUTES])("should send an anonymous visitor to sign in from %s, asking api nothing", async (route) => {
    const answer = await supertest(app).get(route);

    expect(answer.status).toBe(302);
    expect(answer.headers.location).toBe(`/login?returnTo=${encodeURIComponent(route)}`);
    for (const call of [findDeedPoll, getReferral, previewDocument, previewReferralDocument, downloadDocument, downloadReferralDocument]) {
      expect(call).not.toHaveBeenCalled();
    }
  });

  it.each(REFERRAL_ROUTES)("should refuse a caseworker the judicial %s before anything is read", async (route) => {
    const answer = await supertest(app).get(route).set("x-persona", "caseworker");

    expect(answer.status).toBe(403);
    expect(answer.text).toBe("view:errors/404");
    expect(getReferral).not.toHaveBeenCalled();
    expect(previewReferralDocument).not.toHaveBeenCalled();
    expect(downloadReferralDocument).not.toHaveBeenCalled();
  });

  it("should render the caseworker viewer with the caseworker's token", async () => {
    const answer = await supertest(app).get(CASE_ROUTES[0]).set("x-persona", "caseworker");

    expect(answer.status).toBe(200);
    expect(answer.text).toBe("view:document-viewer");
    expect(findDeedPoll).toHaveBeenCalledWith("case-1", { accessToken: "caseworker-token" });
  });

  it("should render the judicial viewer with the judge's token", async () => {
    const answer = await supertest(app).get(REFERRAL_ROUTES[0]).set("x-persona", "judge");

    expect(answer.status).toBe(200);
    expect(answer.text).toBe("view:document-viewer");
    expect(getReferral).toHaveBeenCalledWith("ref-1", { accessToken: "judge-token" });
  });

  it("should decode an encoded delimiter once, handing the domain the raw id it spells", async () => {
    await supertest(app).get("/deed-polls/case%2F1/documents/doc%2Fb%3Fx/preview").set("x-persona", "caseworker");

    expect(previewDocument).toHaveBeenCalledWith("case/1", "doc/b?x", { accessToken: "caseworker-token" }, expect.any(AbortSignal));
  });

  it("should redirect a selector submission to the chosen document's view, encoded once", async () => {
    const answer = await supertest(app).get(`${CASE_ROUTES[0]}?document=doc%2Fb`).set("x-persona", "caseworker");

    expect(answer.status).toBe(303);
    expect(answer.headers.location).toBe("/deed-polls/case-1/documents/doc%2Fb/view");
  });

  it.each(["https://evil.example", "//evil.example", "doc-elsewhere"])("should refuse the forged selection %s with the shared 404", async (selection) => {
    const answer = await supertest(app)
      .get(`${CASE_ROUTES[0]}?document=${encodeURIComponent(selection)}`)
      .set("x-persona", "caseworker");

    expect(answer.status).toBe(404);
    expect(answer.headers.location).toBeUndefined();
  });

  it("should serve the preview under the viewer's containment, separate from the shell's", async () => {
    const answer = await supertest(app).get(CASE_ROUTES[1]).set("x-persona", "caseworker");

    expect(answer.status).toBe(200);
    expect(answer.headers["content-type"]).toBe("application/pdf");
    expect(answer.headers["content-security-policy"]).toBe("default-src 'none'; sandbox");
    expect(answer.headers["content-disposition"]).toBe('attachment; filename="preview.pdf"');
    expect(answer.headers["cache-control"]).toBe("no-store");
  });

  it("should send no binary policy with the shell", async () => {
    const answer = await supertest(app).get(CASE_ROUTES[0]).set("x-persona", "caseworker");

    expect(answer.headers["content-security-policy"]).toBeUndefined();
    expect(answer.headers["content-disposition"]).toBeUndefined();
  });

  it("should serve the judicial original as an attachment with api's own type", async () => {
    vi.mocked(downloadReferralDocument).mockImplementation(async () => binary("image/tiff") as never);

    const answer = await supertest(app).get(REFERRAL_ROUTES[2]).set("x-persona", "judge");

    expect(answer.status).toBe(200);
    expect(answer.headers["content-type"]).toBe("image/tiff");
    expect(answer.headers["content-disposition"]).toBe('attachment; filename="deed poll.pdf"');
    expect(answer.body).toEqual(Buffer.from("bytes"));
  });

  it("should answer a judicial preview 404 as an unavailable document, not the referral's unavailable page", async () => {
    vi.mocked(previewReferralDocument).mockRejectedValue(new NotFoundError("Referral ref-1 not found"));

    const answer = await supertest(app).get(REFERRAL_ROUTES[1]).set("x-persona", "judge");

    expect(answer.status).toBe(404);
    expect(answer.body).toEqual({ code: "DOCUMENT_UNAVAILABLE" });
  });

  it("should answer a lost referral on the viewer with the existing no-longer-available page", async () => {
    vi.mocked(getReferral).mockRejectedValue(new NotFoundError("Referral ref-1 not found"));

    const answer = await supertest(app).get(REFERRAL_ROUTES[0]).set("x-persona", "judge");

    expect(answer.status).toBe(404);
    expect(answer.text).toBe("view:judicial/referrals/unavailable");
  });

  describe("a preview api refused or never answered", () => {
    const logged = () => vi.mocked(console.error).mock.calls.flat().map(String).join("\n");

    it("should answer 403 on the 404 view when api refuses the caller, logging nothing of the document", async () => {
      vi.mocked(previewDocument).mockRejectedValue(new ForbiddenError("document preview failed (forbidden 403)"));

      const answer = await supertest(app).get(CASE_ROUTES[1]).set("x-persona", "caseworker");

      expect(answer.status).toBe(403);
      expect(answer.text).toBe("view:errors/404");
      expect(logged()).not.toContain("Deed poll");
    });

    it("should sign the session out and answer 401 when api refuses the token", async () => {
      vi.mocked(previewReferralDocument).mockRejectedValue(new UnauthorizedError("document preview failed (unauthorized 401)"));

      const answer = await supertest(app).get(REFERRAL_ROUTES[1]).set("x-persona", "judge");

      expect(answer.status).toBe(401);
      expect(answer.text).toBe("view:errors/401");
    });

    it("should leave a timeout to the fault handler rather than call it an unavailable document", async () => {
      vi.mocked(previewDocument).mockRejectedValue(new Error("deed-poll-api call failed (timeout): document preview failed (timeout)"));

      const answer = await supertest(app).get(CASE_ROUTES[1]).set("x-persona", "caseworker");

      expect(answer.status).toBe(500);
      expect(answer.text).not.toContain("DOCUMENT_UNAVAILABLE");
    });
  });
});
