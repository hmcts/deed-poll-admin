/**
 * The deletion pages are reached at the addresses the gate in `app.ts` covers, through the real route table:
 * `simple-router` sorts the static `deletions` segment ahead of a case's `[id]`, so a request id is never read as
 * a case id, and the case-scoped confirmation does not shadow a case's other pages.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findDeedPoll, findDeletion, findProcessSettings } from "@hmcts/deed-poll";
import { createSimpleRouter } from "@hmcts-cft/simple-router";
import express, { type NextFunction, type Request, type Response } from "express";
import supertest from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPoll: vi.fn(),
  findDeletion: vi.fn(),
  findProcessSettings: vi.fn()
}));

const REQUEST_ID = "6f1c1f4e-2b1a-4d8e-9f3a-1c2b3d4e5f60";
let app: express.Express;

describe("application deletion routes", { timeout: 60_000 }, () => {
  beforeAll(async () => {
    vi.mocked(findDeletion).mockResolvedValue({
      requestId: REQUEST_ID,
      caseId: "case-1",
      reason: "DUPLICATE",
      status: "Pending",
      requestedAt: new Date(),
      restorableUntil: new Date(Date.now() + 86_400_000),
      completedAt: null,
      failure: null
    } as never);
    vi.mocked(findDeedPoll).mockResolvedValue({ id: "case-1", displayReference: "KBDP2026-00001", lastChangedOn: "2026-11-20T10:15:30.123" } as never);
    vi.mocked(findProcessSettings).mockResolvedValue({ deletionGraceDays: 14 } as never);
    app = express();
    app.use((req: Request, res: Response, next: NextFunction) => {
      Object.assign(req, { sessionID: "session-a", session: { deedPoll: {} } });
      res.render = ((view: string) => res.json({ view })) as never;
      next();
    });
    app.use(await createSimpleRouter({ path: path.join(fileURLToPath(import.meta.url), "../../pages") }));
  }, 120_000); // Loading every page module takes a while beside other suites and under coverage.

  it("should answer a request id with the status page, reading the request and no case", async () => {
    const response = await supertest(app).get(`/deed-polls/deletions/${REQUEST_ID}`);

    expect(response.body.view).toBe("deed-polls/deletions/status");
    expect(findDeletion).toHaveBeenCalledWith(REQUEST_ID, expect.anything());
    expect(findDeedPoll).not.toHaveBeenCalledWith("deletions", expect.anything());
  });

  it("should answer the restore address with its confirmation", async () => {
    const response = await supertest(app).get(`/deed-polls/deletions/${REQUEST_ID}/restore?case=case-1`);

    expect(response.body.view).toBe("deed-polls/deletions/restore");
  });

  it("should answer a case's delete address with the confirmation for that case", async () => {
    const response = await supertest(app).get("/deed-polls/case-1/delete");

    expect(response.body.view).toBe("deed-polls/application-delete");
    expect(findDeedPoll).toHaveBeenCalledWith("case-1", expect.anything());
  });
});
