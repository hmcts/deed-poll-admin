import { findDeedPoll, findDocumentTypes, InvalidInputError, NotFoundError, uploadDocument } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest } from "../../../../express-doubles.js";
import { GET, POST } from "./upload.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPoll: vi.fn(),
  findDocumentTypes: vi.fn(),
  uploadDocument: vi.fn()
}));

const TYPE_ID = "07f3f0e0-0000-4000-8000-000000000000";
const found = { id: "case-1", displayReference: "KBDP2026-00001", notes: [], witnesses: [], documents: [] };
const types = [{ id: TYPE_ID, name: "Birth certificate", applicableMaritalStatuses: [], applicableTypes: [] }];

/** POST is exported as [parser, handler]; the parser needs a real request, so tests drive handler. */
const handler = (POST as ((req: Request, res: Response) => Promise<void>)[])[1];

/**
 * Built through `pageRequest`, not by hand: the page reads the session for the token it calls api with,
 * so a double without one throws before the handler does anything. `file` is what the multipart parser
 * would have left behind, which no shared double models.
 */
function request(body: Record<string, unknown> = {}, file?: unknown): Request {
  return Object.assign(pageRequest({ params: { id: "case-1" }, body }), { file }) as unknown as Request;
}

function response() {
  const res = { render: vi.fn(), redirect: vi.fn(), status: vi.fn(), locals: {} } as unknown as Response & {
    render: ReturnType<typeof vi.fn>;
    redirect: ReturnType<typeof vi.fn>;
    status: ReturnType<typeof vi.fn>;
  };
  res.status.mockReturnValue(res);
  return res;
}

const aFile = { buffer: Buffer.from("%PDF-1.4"), originalname: "birth.pdf", mimetype: "application/pdf", size: 8 };

describe("document upload page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "test";
    vi.mocked(findDeedPoll).mockResolvedValue(found as never);
    vi.mocked(findDocumentTypes).mockResolvedValue(types as never);
    vi.mocked(uploadDocument).mockResolvedValue({ id: "doc-1" } as never);
  });

  describe("GET", () => {
    it("renders the form with the document types from the reference table", async () => {
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][0]).toBe("deed-polls/document-upload");
      expect(res.render.mock.calls[0][1].hasTypes).toBe(true);
      expect(res.render.mock.calls[0][1].documentTypes).toContainEqual({ value: TYPE_ID, text: "Birth certificate" });
    });

    it("offers an empty first option so no type is preselected", async () => {
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].documentTypes[0].value).toBe("");
    });

    it("flags an empty reference table, so the page shows a message rather than an unusable form", async () => {
      vi.mocked(findDocumentTypes).mockResolvedValue([] as never);
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].hasTypes).toBe(false);
    });

    it("404s for a missing case", async () => {
      vi.mocked(findDeedPoll).mockRejectedValue(new NotFoundError("DeedPoll nope not found"));

      await expect(GET(request(), response())).rejects.toThrow(NotFoundError);
    });
  });

  describe("POST", () => {
    it("uploads the file and redirects to the documents tab", async () => {
      const res = response();

      await handler(request({ documentTypeId: TYPE_ID, name: "Birth certificate", direction: "Incoming" }, aFile), res);

      expect(uploadDocument).toHaveBeenCalledWith("case-1", TYPE_ID, aFile, { name: "Birth certificate", direction: "Incoming" });
      expect(res.redirect).toHaveBeenCalledWith("/deed-polls/case-1#documents");
    });

    it("passes the case id from the path, not from a form field", async () => {
      await handler(request({ documentTypeId: TYPE_ID, deedPollId: "attacker-supplied" }, aFile), response());

      expect(uploadDocument).toHaveBeenCalledWith("case-1", TYPE_ID, aFile, expect.anything());
    });

    it("treats a blank optional name as absent, so the file's own name is used", async () => {
      await handler(request({ documentTypeId: TYPE_ID, name: "" }, aFile), response());

      expect(vi.mocked(uploadDocument).mock.calls[0][3]).toEqual({ name: undefined, direction: undefined });
    });

    it("re-renders with a 400 and the error against the type field when no type was chosen", async () => {
      const res = response();

      await handler(request({}, aFile), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][1].errorField).toBe("documentTypeId");
      expect(uploadDocument).not.toHaveBeenCalled();
    });

    it("re-renders with a 400 for an unrecognised direction", async () => {
      const res = response();

      await handler(request({ documentTypeId: TYPE_ID, direction: "Sideways" }, aFile), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][1].errorField).toBe("direction");
    });

    it("keeps the type and direction choices on a rejected submission", async () => {
      // The file input cannot be repopulated, but these can — which is what a ?error= redirect could
      // not do.
      const res = response();

      await handler(request({ documentTypeId: TYPE_ID, direction: "Sideways", name: "Typed" }, aFile), res);

      expect(res.render.mock.calls[0][1].values).toMatchObject({ documentTypeId: TYPE_ID, name: "Typed" });
    });

    it("shows the domain's own message, against the file field, when no file was sent", async () => {
      vi.mocked(uploadDocument).mockRejectedValue(new InvalidInputError("Select a file to upload"));
      const res = response();

      await handler(request({ documentTypeId: TYPE_ID }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][1].errorMessage).toBe("Select a file to upload");
      expect(res.render.mock.calls[0][1].errorField).toBe("file");
    });

    it("shows an unknown document type against the type field rather than 404ing the page", async () => {
      // The caseworker picked from a list this page rendered, so the failure belongs against the
      // field they chose from — a 404 would suggest the case had gone.
      vi.mocked(uploadDocument).mockRejectedValue(new NotFoundError("Document type nope not found"));
      const res = response();

      await handler(request({ documentTypeId: TYPE_ID }, aFile), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][1].errorField).toBe("documentTypeId");
    });

    it("rethrows anything that is not a validation or lookup failure", async () => {
      vi.mocked(uploadDocument).mockRejectedValue(new Error("ENOSPC: no space left on device"));

      await expect(handler(request({ documentTypeId: TYPE_ID }, aFile), response())).rejects.toThrow("ENOSPC");
    });
  });

  it("re-renders a parser rejection instead of letting it escape as a 500", async () => {
    // The parser records its rejections on res.locals rather than throwing, because
    // domainErrorHandler deliberately passes InvalidInputError on — true of a handler that validates,
    // false of middleware running before one. Propagating it produced a 500 that even showed the right
    // message on the starter's development error page, which read as a status bug rather than a
    // routing one.
    const res = response();
    res.locals = { uploadRejection: new InvalidInputError("Too big", [{ field: "file", message: "The file must be smaller than 25MB" }]) };

    await handler(request({ documentTypeId: TYPE_ID }), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.render.mock.calls[0][1].errorField).toBe("file");
    expect(res.render.mock.calls[0][1].errorMessage).toBe("The file must be smaller than 25MB");
    expect(uploadDocument).not.toHaveBeenCalled();
  });

  it("exports POST as an array so the multipart parser runs before the handler", () => {
    expect(Array.isArray(POST)).toBe(true);
    expect(POST).toHaveLength(2);
  });
});
