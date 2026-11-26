import {
  ConflictError,
  DOCUMENT_DELETION_REFUSAL_CODE,
  DocumentDeletionOutcomeUnknownError,
  ForbiddenError,
  findDeedPoll,
  InvalidInputError,
  NotFoundError,
  requestDocumentDeletion,
  UnauthorizedError
} from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DOCUMENT_DELETION_JOURNEY_TTL_MS,
  type DocumentDeletionJourney,
  newDocumentDeletionJourney,
  sealDocumentDeletionJourney
} from "../../../../../document-deletion/journey.js";
import { pageRequest, pageResponse } from "../../../../../express-doubles.js";
import { GET, POST } from "./delete.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPoll: vi.fn(),
  requestDocumentDeletion: vi.fn()
}));

const REQUEST_ID = "6f1c1f4e-2b1a-4d8e-9f3a-1c2b3d4e5f60";
const REASON = "Uploaded in error";
const DOCUMENT = {
  id: "doc-1",
  name: "Statutory declaration.pdf",
  documentType: { id: "t-1", name: "Statutory declaration", applicableMaritalStatuses: [], applicableTypes: [] },
  hasFile: true,
  createdOn: new Date("2026-11-20T10:00:00Z"),
  documentVersion: 3
};
const CASE = { id: "case-1", displayReference: "KBDP2026-00001", documents: [DOCUMENT, { ...DOCUMENT, id: "doc-2", name: "Other.pdf", documentVersion: 1 }] };
const PARAMS = { id: "case-1", documentId: "doc-1" };

function request(body?: Record<string, unknown>, params: Record<string, string> = PARAMS, sessionID = "session-a") {
  return Object.assign(pageRequest({ params, body, accessToken: "session-token" }), { sessionID });
}

async function posted(fields: Record<string, unknown>, journey: DocumentDeletionJourney = newDocumentDeletionJourney("case-1", "doc-1", 3)) {
  return request({ journey: await sealDocumentDeletionJourney(request(), journey), ...fields });
}

function journeyIn(model: Record<string, unknown>): DocumentDeletionJourney {
  return JSON.parse(Buffer.from(String(model.journey).split(".")[0], "base64url").toString());
}

describe("document deletion confirmation page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findDeedPoll).mockResolvedValue(CASE as never);
    vi.mocked(requestDocumentDeletion).mockResolvedValue({ requestId: REQUEST_ID, status: "Completed" } as never);
  });

  describe("GET", () => {
    it("should identify the document, ask for a reason with none prefilled and write nothing", async () => {
      // Arrange
      const res = pageResponse();

      // Act
      await GET(request(), res);

      // Assert
      const [view, model] = res.render.mock.calls[0];
      expect(view).toBe("deed-polls/document-delete");
      expect(res.status).toHaveBeenCalledWith(200);
      expect(model.state).toBe("form");
      expect(model.reason).toBe("");
      expect(model.summaryRows).toEqual([
        { key: "Application reference", value: "KBDP2026-00001" },
        { key: "Document", value: "Statutory declaration.pdf" },
        { key: "Type", value: "Statutory declaration" },
        { key: "Added", value: expect.stringContaining("2026") }
      ]);
      expect(model.viewHref).toBe("/deed-polls/case-1/documents/doc-1/view");
      expect(model.actionPath).toBe("/deed-polls/case-1/documents/doc-1/delete");
      expect(model.documentsPath).toBe("/deed-polls/case-1#documents");
      expect(model.reasonMax).toBe(500);
      expect(requestDocumentDeletion).not.toHaveBeenCalled();
    });

    it("should bind a fresh key to the case, the document and the documentVersion api published", async () => {
      const first = pageResponse();
      const second = pageResponse();

      await GET(request(), first);
      await GET(request(), second);

      const journey = journeyIn(first.render.mock.calls[0][1]);
      expect(journey).toMatchObject({ caseId: "case-1", documentId: "doc-1", documentVersion: 3 });
      expect(journey.confirmed).toBeUndefined();
      expect(journeyIn(second.render.mock.calls[0][1]).key).not.toBe(journey.key);
    });

    it("should offer no view link for a document with no file", async () => {
      vi.mocked(findDeedPoll).mockResolvedValue({ ...CASE, documents: [{ ...DOCUMENT, hasFile: false }] } as never);
      const res = pageResponse();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].viewHref).toBeNull();
    });

    it("should be the not-found page for a document that is not on the case", async () => {
      const res = pageResponse();

      await expect(GET(request(undefined, { id: "case-1", documentId: "doc-9" }), res)).rejects.toBeInstanceOf(NotFoundError);

      expect(res.render).not.toHaveBeenCalled();
    });

    it("should refuse a dot-only document id before reading anything", async () => {
      await expect(GET(request(undefined, { id: "case-1", documentId: ".." }), pageResponse())).rejects.toBeInstanceOf(NotFoundError);

      expect(findDeedPoll).not.toHaveBeenCalled();
    });

    it("should leave api's refusal of the case to the existing flows", async () => {
      vi.mocked(findDeedPoll).mockRejectedValue(new ForbiddenError("deed-poll-api call failed (forbidden)"));

      await expect(GET(request(), pageResponse())).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("should carry the content pair for both locales", async () => {
      const res = pageResponse();
      res.locals.locale = "cy";

      await GET(request(), res);

      const model = res.render.mock.calls[0][1];
      expect(Object.keys(model.cy)).toEqual(Object.keys(model.en));
      expect(model.en.warning).toBe(
        "This will permanently delete the document. You cannot undo this. The reason will be recorded in the audit trail and as a case note."
      );
      expect(model.en.reasonHint).toBe("For example, uploaded in error. Do not include unnecessary personal information.");
      expect(model.summaryRows[0].key).toBe(model.cy.referenceLabel);
    });
  });

  describe("POST", () => {
    it("should delete with the reviewed version and the journey's key, and land on the Documents tab when api completes", async () => {
      // Arrange
      const journey = newDocumentDeletionJourney("case-1", "doc-1", 3);
      const res = pageResponse();

      // Act
      await POST(await posted({ action: "delete", reason: `  ${REASON}  ` }, journey), res);

      // Assert
      expect(requestDocumentDeletion).toHaveBeenCalledWith("case-1", "doc-1", { reason: REASON, expectedDocumentVersion: 3 }, journey.key, {
        accessToken: "session-token"
      });
      expect(res.redirect).toHaveBeenCalledWith(303, "/deed-polls/case-1?document=deleted#documents");
    });

    it.each(["InProgress", "NeedsAttention"])("should go to the progress page, not the banner, when api answers %s", async (status) => {
      vi.mocked(requestDocumentDeletion).mockResolvedValue({ requestId: REQUEST_ID, status } as never);
      const res = pageResponse();

      await POST(await posted({ action: "delete", reason: REASON }), res);

      expect(res.redirect).toHaveBeenCalledWith(303, `/deed-polls/case-1/document-deletions/${REQUEST_ID}`);
    });

    it.each([
      ["a GET-style empty body", {}],
      ["Cancel or any other action", { action: "cancel", reason: REASON }]
    ])("should write nothing for %s", async (_label, fields) => {
      const res = pageResponse();

      await POST(await posted(fields), res);

      expect(requestDocumentDeletion).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(303, "/deed-polls/case-1#documents");
    });

    it.each([
      ["blank", "   ", "Enter why you are deleting this document"],
      ["over 500 characters", "a".repeat(501), "Why you are deleting this document must be 500 characters or fewer"],
      ["on two lines", "Uploaded\nin error", "Why you are deleting this document must be on one line, with no tabs or special characters"]
    ])("should redraw a %s reason as typed with the error linked to the field, keeping the key", async (_label, reason, message) => {
      // Arrange
      const journey = newDocumentDeletionJourney("case-1", "doc-1", 3);
      const res = pageResponse();

      // Act
      await POST(await posted({ action: "delete", reason }, journey), res);

      // Assert
      const model = res.render.mock.calls[0][1];
      expect(res.status).toHaveBeenCalledWith(400);
      expect(model.state).toBe("form");
      expect(model.reason).toBe(reason);
      expect(model.errors).toEqual({ reason: message });
      expect(model.errorList).toEqual([{ text: message, href: "#reason" }]);
      expect(journeyIn(model)).toEqual(journey);
      expect(requestDocumentDeletion).not.toHaveBeenCalled();
    });

    it("should redraw a repeated reason control empty rather than stringify it", async () => {
      const res = pageResponse();

      await POST(await posted({ action: "delete", reason: ["a", "b"] }), res);

      expect(res.render.mock.calls[0][1].reason).toBe("");
      expect(requestDocumentDeletion).not.toHaveBeenCalled();
    });

    it("should say exactly why when the document is in use, keeping the reason and the key for a deliberate resubmit", async () => {
      // Arrange
      vi.mocked(requestDocumentDeletion).mockRejectedValue(new ConflictError("in use", [], "DOCUMENT_IN_USE"));
      const journey = newDocumentDeletionJourney("case-1", "doc-1", 3);
      const res = pageResponse();

      // Act
      await POST(await posted({ action: "delete", reason: REASON }, journey), res);

      // Assert
      const model = res.render.mock.calls[0][1];
      expect(res.status).toHaveBeenCalledWith(409);
      expect(model.state).toBe("form");
      expect(model.reason).toBe(REASON);
      expect(model.errorList).toEqual([{ text: "This document is currently being used and cannot be deleted. Try again once the operation has finished." }]);
      const redrawn = journeyIn(model);
      expect(redrawn.key).toBe(journey.key);
      expect(redrawn.confirmed).toBeUndefined();
    });

    it.each([
      ["DOCUMENT_STORAGE_UNRESOLVED", "This document has not finished being stored, so it cannot be deleted yet. Try again later."],
      ["DOCUMENT_SHARED", "This document’s file is also used by another document on the service, so it cannot be deleted. Contact the service support team."],
      ["APPLICATION_DELETION_PENDING", "This application is being deleted, so its documents cannot be deleted separately."],
      [null, "The document was not deleted. Check the document’s details and try again."]
    ])("should redraw the form with this page's sentence for a %s refusal and never api's words", async (code, sentence) => {
      vi.mocked(requestDocumentDeletion).mockRejectedValue(new ConflictError("api's own prose", [], code as never));
      const res = pageResponse();

      await POST(await posted({ action: "delete", reason: REASON }), res);

      const model = res.render.mock.calls[0][1];
      expect(model.state).toBe("form");
      expect(model.errors.form).toBe(sentence);
      expect(JSON.stringify(model)).not.toContain("api's own prose");
    });

    it.each([
      ["DOCUMENT_CHANGED", "The document has changed"],
      ["KEY_REUSED", "The document cannot be deleted from this page"]
    ])("should stop with links only after %s, because only a fresh review can follow it", async (code, heading) => {
      vi.mocked(requestDocumentDeletion).mockRejectedValue(new ConflictError("refused", [], code as never));
      const res = pageResponse();

      await POST(await posted({ action: "delete", reason: REASON }), res);

      const model = res.render.mock.calls[0][1];
      expect(res.status).toHaveBeenCalledWith(409);
      expect(model.state).toBe("stopped");
      expect(model.heading).toBe(heading);
      expect(model.journey).toBeUndefined();
      expect(model.documentsPath).toBe("/deed-polls/case-1#documents");
    });

    it("should have a sentence for every refusal api publishes", async () => {
      const res = pageResponse();

      await GET(request(), res);

      const { en } = res.render.mock.calls[0][1];
      for (const code of DOCUMENT_DELETION_REFUSAL_CODE) expect(en[code], code).toEqual(expect.any(String));
    });

    it("should redraw api's 400 on the reason in this page's words, unsealed with the same key", async () => {
      vi.mocked(requestDocumentDeletion).mockRejectedValue(new InvalidInputError("bad", [{ field: "reason", message: "api's words" }]));
      const journey = newDocumentDeletionJourney("case-1", "doc-1", 3);
      const res = pageResponse();

      await POST(await posted({ action: "delete", reason: REASON }, journey), res);

      const model = res.render.mock.calls[0][1];
      expect(res.status).toHaveBeenCalledWith(400);
      expect(model.errors).toEqual({ reason: "Enter why you are deleting this document in 500 characters or fewer, on one line" });
      expect(journeyIn(model).key).toBe(journey.key);
    });

    it("should put api's 400 on anything else on the form", async () => {
      vi.mocked(requestDocumentDeletion).mockRejectedValue(new InvalidInputError("bad", [{ field: "Idempotency-Key", message: "x" }]));
      const res = pageResponse();

      await POST(await posted({ action: "delete", reason: REASON }), res);

      expect(res.render.mock.calls[0][1].errorList).toEqual([{ text: "The document was not deleted. Check your answer and try again." }]);
    });

    it("should keep the reason but drop the summary when the redraw cannot read the case", async () => {
      vi.mocked(requestDocumentDeletion).mockRejectedValue(new ConflictError("in use", [], "DOCUMENT_IN_USE"));
      vi.mocked(findDeedPoll).mockRejectedValue(new Error("deed-poll-api call failed (unavailable)"));
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const res = pageResponse();

      await POST(await posted({ action: "delete", reason: REASON }), res);

      const model = res.render.mock.calls[0][1];
      expect(model.summaryRows).toEqual([]);
      expect(model.reason).toBe(REASON);
    });

    describe("an unknown outcome", () => {
      let logged: ReturnType<typeof vi.spyOn>;

      beforeEach(() => {
        vi.mocked(requestDocumentDeletion).mockRejectedValue(new DocumentDeletionOutcomeUnknownError());
        logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
      });

      it("should offer only the check, sealing the reason as sent and reading nothing to guess", async () => {
        // Arrange
        const journey = newDocumentDeletionJourney("case-1", "doc-1", 3);
        const res = pageResponse();

        // Act
        await POST(await posted({ action: "delete", reason: REASON }, journey), res);

        // Assert
        const model = res.render.mock.calls[0][1];
        expect(res.status).toHaveBeenCalledWith(503);
        expect(model.state).toBe("unknown");
        expect(model.heading).toBe("We do not know whether the document has been deleted");
        expect(journeyIn(model)).toEqual({ ...journey, confirmed: { reason: REASON } });
        expect(findDeedPoll).not.toHaveBeenCalled();
        expect(JSON.stringify(logged.mock.calls)).not.toContain(REASON);
      });

      it("should replay exactly the sealed request with the original key, whatever is posted beside it", async () => {
        // Arrange
        vi.mocked(requestDocumentDeletion).mockResolvedValue({ requestId: REQUEST_ID, status: "Completed" } as never);
        const sealed = { ...newDocumentDeletionJourney("case-1", "doc-1", 3), confirmed: { reason: REASON } };
        const res = pageResponse();

        // Act
        await POST(await posted({ action: "check", reason: "Something else" }, sealed), res);

        // Assert
        expect(requestDocumentDeletion).toHaveBeenCalledWith("case-1", "doc-1", { reason: REASON, expectedDocumentVersion: 3 }, sealed.key, expect.anything());
        expect(res.redirect).toHaveBeenCalledWith(303, "/deed-polls/case-1?document=deleted#documents");
      });

      it("should keep offering the same check when the replay is unknown too, never a new key", async () => {
        const sealed = { ...newDocumentDeletionJourney("case-1", "doc-1", 3), confirmed: { reason: REASON } };
        const res = pageResponse();

        await POST(await posted({ action: "check" }, sealed), res);

        expect(journeyIn(res.render.mock.calls[0][1])).toEqual(sealed);
      });

      it("should not let a sealed journey's delete action write again", async () => {
        const sealed = { ...newDocumentDeletionJourney("case-1", "doc-1", 3), confirmed: { reason: REASON } };
        const res = pageResponse();

        await POST(await posted({ action: "delete", reason: "Something else" }, sealed), res);

        expect(requestDocumentDeletion).not.toHaveBeenCalled();
        expect(res.redirect).toHaveBeenCalledWith(303, "/deed-polls/case-1#documents");
      });
    });

    it.each([
      ["forged", async () => request({ action: "delete", reason: REASON, journey: "abc.def" })],
      [
        "another session's",
        async () =>
          request({
            action: "delete",
            reason: REASON,
            journey: await sealDocumentDeletionJourney(request(undefined, PARAMS, "session-b"), newDocumentDeletionJourney("case-1", "doc-1", 3))
          })
      ],
      ["another document's", async () => posted({ action: "delete", reason: REASON }, newDocumentDeletionJourney("case-1", "doc-2", 1))]
    ])("should write nothing for a %s confirmation", async (_label, build) => {
      const res = pageResponse();

      await POST(await build(), res);

      const model = res.render.mock.calls[0][1];
      expect(res.status).toHaveBeenCalledWith(400);
      expect(model.state).toBe("stopped");
      expect(model.heading).toBe("This confirmation can no longer be used");
      expect(requestDocumentDeletion).not.toHaveBeenCalled();
    });

    it("should say an expired recovery's outcome is still unknown, never that nothing was sent", async () => {
      const old = { ...newDocumentDeletionJourney("case-1", "doc-1", 3, Date.now() - DOCUMENT_DELETION_JOURNEY_TTL_MS - 1), confirmed: { reason: REASON } };
      const res = pageResponse();

      await POST(await posted({ action: "check" }, old), res);

      const model = res.render.mock.calls[0][1];
      expect(model.heading).toBe("This confirmation has expired");
      expect(model.sentence).toContain("we still do not know whether the document has been deleted");
      expect(requestDocumentDeletion).not.toHaveBeenCalled();
    });

    it.each([
      ["access was removed", new ForbiddenError("deed-poll-api call failed (forbidden)")],
      ["the session was refused", new UnauthorizedError("deed-poll-api call failed (unauthorized)")],
      ["the document is not there", new NotFoundError("deed-poll-api call failed (not-found)")]
    ])("should leave api's answer to the existing flows when %s", async (_label, error) => {
      vi.mocked(requestDocumentDeletion).mockRejectedValue(error);
      const res = pageResponse();

      await expect(POST(await posted({ action: "delete", reason: REASON }), res)).rejects.toBe(error);

      expect(res.render).not.toHaveBeenCalled();
    });
  });
});
