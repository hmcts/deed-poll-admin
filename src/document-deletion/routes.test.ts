/**
 * The document deletion pages are reached at their case-scoped addresses through the real route table, and neither
 * captures a case's other pages: `documents/[documentId]/delete` sits beside the viewer's `view`, `preview` and
 * `download`, `document-deletions/[requestId]` is not read as a case's document, and application deletion's
 * `deletions` and `[id]/delete` still answer as before.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findDeedPoll, findDeletion, findDocumentDeletion, findProcessSettings } from "@hmcts/deed-poll";
import { createSimpleRouter } from "@hmcts-cft/simple-router";
import express, { type NextFunction, type Request, type Response } from "express";
import supertest from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPoll: vi.fn(),
  findDeletion: vi.fn(),
  findDocumentDeletion: vi.fn(),
  findProcessSettings: vi.fn()
}));

const REQUEST_ID = "6f1c1f4e-2b1a-4d8e-9f3a-1c2b3d4e5f60";
const DOCUMENT = { id: "doc-1", name: "a.pdf", hasFile: true, documentVersion: 2 };
let app: express.Express;

describe("document deletion routes", { timeout: 60_000 }, () => {
  beforeAll(async () => {
    app = express();
    app.use((req: Request, res: Response, next: NextFunction) => {
      Object.assign(req, { sessionID: "session-a", session: { deedPoll: {} } });
      res.render = ((view: string) => res.json({ view })) as never;
      next();
    });
    app.use(await createSimpleRouter({ path: path.join(fileURLToPath(import.meta.url), "../../pages") }));
  }, 120_000); // Loading every page module takes a while beside other suites and under coverage.

  beforeEach(() => {
    vi.mocked(findDeedPoll).mockResolvedValue({ id: "case-1", displayReference: "KBDP2026-00001", lastChangedOn: "x", documents: [DOCUMENT] } as never);
    vi.mocked(findDocumentDeletion).mockResolvedValue({ requestId: REQUEST_ID, documentId: "doc-1", status: "InProgress", requestedAt: new Date() } as never);
    vi.mocked(findDeletion).mockResolvedValue({
      requestId: REQUEST_ID,
      status: "Pending",
      reason: "DUPLICATE",
      requestedAt: new Date(),
      restorableUntil: new Date()
    } as never);
    vi.mocked(findProcessSettings).mockResolvedValue({ deletionGraceDays: 14 } as never);
  });

  it("should answer a document's delete address with that document's confirmation", async () => {
    const response = await supertest(app).get("/deed-polls/case-1/documents/doc-1/delete");

    expect(response.body.view).toBe("deed-polls/document-delete");
    expect(findDeedPoll).toHaveBeenCalledWith("case-1", expect.anything());
  });

  it("should answer a request id under its case with the progress page, reading the request and no case", async () => {
    vi.mocked(findDeedPoll).mockClear();

    const response = await supertest(app).get(`/deed-polls/case-1/document-deletions/${REQUEST_ID}`);

    expect(response.body.view).toBe("deed-polls/document-deletion-status");
    expect(findDocumentDeletion).toHaveBeenCalledWith("case-1", REQUEST_ID, expect.anything());
    expect(findDeedPoll).not.toHaveBeenCalled();
  });

  it("should leave the application deletion pages where they were", async () => {
    expect((await supertest(app).get("/deed-polls/case-1/delete")).body.view).toBe("deed-polls/application-delete");
    expect((await supertest(app).get(`/deed-polls/deletions/${REQUEST_ID}`)).body.view).toBe("deed-polls/deletions/status");
  });

  it("should accept no POST on the progress page, so nothing there can write", async () => {
    const response = await supertest(app).post(`/deed-polls/case-1/document-deletions/${REQUEST_ID}`);

    expect(response.status).toBe(404);
  });
});
