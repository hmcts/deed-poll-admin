/**
 * The upload page's markup after api refuses the chosen document type, rendered rather than asserted through the
 * view model (review finding R13). The model is asserted in `[id]/documents/upload.test.ts`; what this pins is that
 * neither api's 404 text nor the adapter's own reaches the page, in the error summary or against the field.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findDeedPoll, findDocumentTypes, NotFoundError, uploadDocument } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import nunjucks from "nunjucks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../express-doubles.js";
import { POST } from "./[id]/documents/upload.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPoll: vi.fn(),
  findDocumentTypes: vi.fn(),
  uploadDocument: vi.fn()
}));

const STARTER_VIEWS = path.join(fileURLToPath(import.meta.url), "../../../../libs/express-govuk-starter/src");
const environment = nunjucks.configure(
  [
    path.join(fileURLToPath(import.meta.resolve("govuk-frontend")), "..", ".."),
    path.join(STARTER_VIEWS, "govuk-frontend/views"),
    path.join(STARTER_VIEWS, "cookies/views"),
    path.join(fileURLToPath(import.meta.url), "../../..", "pages")
  ],
  { autoescape: true }
);

const MARKER = "R13-MARKER-7f3a";
const TYPE_ID = "07f3f0e0-0000-4000-8000-000000000000";
const found = { id: "case-1", displayReference: "KBDP2026-00001", notes: [], witnesses: [], documents: [] };
const types = [{ id: TYPE_ID, name: "Birth certificate", applicableMaritalStatuses: [], applicableTypes: [] }];
const aFile = { buffer: Buffer.from("%PDF-1.4"), originalname: "birth.pdf", mimetype: "application/pdf", size: 8 };

/** POST is exported as [parser, handler]; the parser needs a real multipart request, so this drives the handler. */
const handler = (POST as ((req: Request, res: Response) => Promise<void>)[])[1];

const html = (model: Record<string, unknown>): string => environment.render("deed-polls/document-upload.njk", { ...(model.en as object), ...model });

async function refusedWith(apiMessage: string): Promise<string> {
  vi.mocked(uploadDocument).mockRejectedValue(new NotFoundError(apiMessage));
  const req = Object.assign(pageRequest({ params: { id: "case-1" }, body: { documentTypeId: TYPE_ID }, accessToken: "session-token" }), {
    file: aFile
  });
  const res = pageResponse();

  await handler(req as unknown as Request, res as unknown as Response);

  return html(res.render.mock.calls[0][1]);
}

describe("document upload template", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(findDeedPoll).mockResolvedValue(found as never);
    vi.mocked(findDocumentTypes).mockResolvedValue(types as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("never renders api's 404 message for an unknown document type", async () => {
    const page = await refusedWith(`Document type ${MARKER} not found`);

    expect(page).not.toContain(MARKER);
    expect(page).not.toContain("not found");
  });

  it("never renders the adapter's message when api's 404 body is not its JSON", async () => {
    const page = await refusedWith("deed-poll-api answered 404");

    expect(page).not.toContain("deed-poll-api");
    expect(page).not.toContain("answered 404");
  });

  it("renders the page's own sentence in the error summary and against the document type", async () => {
    const page = await refusedWith(`Document type ${MARKER} not found`);

    expect(page).toContain('href="#documentTypeId">Select a document type from the list</a>');
    expect(page).toMatch(/id="documentTypeId-error"[^>]*>\s*<span class="govuk-visually-hidden">Error:<\/span> Select a document type from the list/);
  });
});
