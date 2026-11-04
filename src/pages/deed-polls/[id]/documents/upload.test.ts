import { findDeedPoll, findDocumentTypes, InvalidInputError, NotFoundError, uploadDocument } from "@hmcts/deed-poll";
import express, { type Request, type Response } from "express";
import supertest from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  return Object.assign(pageRequest({ params: { id: "case-1" }, body, accessToken: "session-token" }), { file }) as unknown as Request;
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

/** The session's access token, which is the whole of what this page passes to the domain. */
const CALLER = { accessToken: "session-token" };

describe("document upload page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "test";
    vi.mocked(findDeedPoll).mockResolvedValue(found as never);
    vi.mocked(findDocumentTypes).mockResolvedValue(types as never);
    vi.mocked(uploadDocument).mockResolvedValue({ id: "doc-1" } as never);
  });

  describe("GET", () => {
    it("asks api for the document types, presenting the session's token", async () => {
      await GET(request(), response());

      expect(findDocumentTypes).toHaveBeenCalledWith(CALLER);
    });

    it("renders the form with the document types api published", async () => {
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][0]).toBe("deed-polls/document-upload");
      expect(res.render.mock.calls[0][1].hasTypes).toBe(true);
      expect(res.render.mock.calls[0][1].documentTypes).toContainEqual({ value: TYPE_ID, text: "Birth certificate" });
    });

    it("labels a type api published without a name with its id, so the option is never blank", async () => {
      // `name` is nullable on the wire. An option with no text is selectable, invisible on the page and
      // unreadable to a screen reader, so the id stands in — the same treatment documents-view.ts gives it.
      vi.mocked(findDocumentTypes).mockResolvedValue([{ id: "type-nameless", name: null }] as never);
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].documentTypes).toContainEqual({ value: "type-nameless", text: "type-nameless" });
    });

    it("offers an empty first option so no type is preselected", async () => {
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].documentTypes[0].value).toBe("");
    });

    it("flags an empty type list, so the page shows a message rather than an unusable form", async () => {
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
    it.each([
      ["101-character name", { name: "x".repeat(101) }, "name", "The name must be 100 characters or fewer"],
      ["1023-byte name", { name: "x".repeat(1023) }, "name", "The name must be 100 characters or fewer"],
      ["1024-byte name", { name: "x".repeat(1024) }, "name", "The name must be 100 characters or fewer"],
      ["1025-byte name", { name: "x".repeat(1025) }, "name", "The name must be 100 characters or fewer"],
      ["excess fields", { name: "Typed", extra: "x" }, "file", "The upload contains too many fields. Reload the page and select the file again."]
    ])("should re-render a real multipart submission with %s as 400 without uploading", async (_reason, fields, errorField, message) => {
      const app = express();
      app.use((req, res, next) => {
        req.session = pageRequest({ accessToken: "session-token" }).session;
        res.render = (view, model) => {
          res.json({ view, model });
        };
        next();
      });
      app.post("/deed-polls/:id/documents/upload", ...POST);

      const result = await supertest(app)
        .post("/deed-polls/case-1/documents/upload")
        .field("documentTypeId", TYPE_ID)
        .field("direction", "Incoming")
        .field(fields)
        .attach("file", aFile.buffer, { filename: aFile.originalname, contentType: aFile.mimetype });

      expect(result.status).toBe(400);
      expect(result.body.view).toBe("deed-polls/document-upload");
      expect(result.body.model).toMatchObject({ errorField, errorMessage: message, values: { documentTypeId: TYPE_ID, direction: "Incoming" } });
      expect(uploadDocument).not.toHaveBeenCalled();
    });

    it("uploads the file and redirects to the documents tab", async () => {
      const res = response();

      await handler(request({ documentTypeId: TYPE_ID, name: "Birth certificate", direction: "Incoming" }, aFile), res);

      expect(uploadDocument).toHaveBeenCalledWith("case-1", TYPE_ID, aFile, { name: "Birth certificate", direction: "Incoming" }, CALLER);
      expect(res.redirect).toHaveBeenCalledWith("/deed-polls/case-1#documents");
    });

    it("passes the case id from the path, not from a form field", async () => {
      await handler(request({ documentTypeId: TYPE_ID, deedPollId: "attacker-supplied" }, aFile), response());

      expect(uploadDocument).toHaveBeenCalledWith("case-1", TYPE_ID, aFile, expect.anything(), CALLER);
    });

    it("treats a blank optional name as absent, so api's own fallback to the file name applies", async () => {
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
      vi.mocked(uploadDocument).mockRejectedValue(new InvalidInputError("Select a file to upload", [{ field: "file", message: "Select a file to upload" }]));
      const res = response();

      await handler(request({ documentTypeId: TYPE_ID }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][1].errorMessage).toBe("Select a file to upload");
      expect(res.render.mock.calls[0][1].errorField).toBe("file");
    });

    it("shows this page's own copy, not api's wording, when api refuses the file without naming a field", async () => {
      // How a 413 arrives: api's size limit is below this app's, and `failureFromResponse` classifies it
      // as validation so it lands here rather than on the 500 page. The message is developer-facing —
      // "deed-poll-api answered 413" when the body is not api's JSON — so it must not be rendered.
      vi.mocked(uploadDocument).mockRejectedValue(new InvalidInputError("deed-poll-api answered 413"));
      const res = response();

      await handler(request({ documentTypeId: TYPE_ID }, aFile), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][1].errorField).toBe("file");
      expect(res.render.mock.calls[0][1].errorMessage).not.toContain("deed-poll-api");
      expect(res.render.mock.calls[0][1].errorMessage).toContain("could not be uploaded");
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

    describe("api's 404 wording for an unknown document type (R13)", () => {
      const MARKER = "R13-MARKER-7f3a";

      afterEach(() => {
        vi.restoreAllMocks();
      });

      it.each([
        ["api's JSON message", `Document type ${MARKER} not found`],
        ["the adapter's message for a non-JSON body", "deed-poll-api answered 404"]
      ])("renders this page's own sentence rather than %s", async (_label, apiMessage) => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        vi.mocked(uploadDocument).mockRejectedValue(new NotFoundError(apiMessage));
        const res = response();

        await handler(request({ documentTypeId: TYPE_ID }, aFile), res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.render.mock.calls[0][1].errorField).toBe("documentTypeId");
        expect(res.render.mock.calls[0][1].errorMessage).toBe("Select a document type from the list");
      });

      it("logs api's message with a fixed prefix, cleaned for the log", async () => {
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        vi.mocked(uploadDocument).mockRejectedValue(new NotFoundError(`Document type ${MARKER}\r\nforged line\u001b[2J not found`));

        await handler(request({ documentTypeId: TYPE_ID }, aFile), response());

        expect(log).toHaveBeenCalledWith(`document upload refused an unknown document type: Document type ${MARKER}forged line not found`);
      });
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

  // `../../../../case-path.test.ts` holds the full payload matrix; this pins the destination.
  describe("a case id carrying URL delimiters", () => {
    const RAW_ID = "a/b?c#d";

    function delimited(id: string) {
      const body = { documentTypeId: TYPE_ID, direction: "Incoming" };
      return Object.assign(pageRequest({ params: { id }, body, accessToken: "session-token" }), { file: aFile }) as unknown as Request;
    }

    it("should upload under the raw id and return to the encoded case's documents tab", async () => {
      const res = response();

      await handler(delimited(RAW_ID), res);

      expect(uploadDocument).toHaveBeenCalledTimes(1);
      expect(uploadDocument).toHaveBeenCalledWith(RAW_ID, TYPE_ID, aFile, expect.anything(), CALLER);
      expect(res.redirect).toHaveBeenCalledWith("/deed-polls/a%2Fb%3Fc%23d#documents");
    });

    it.each(["", ".", ".."])("should 404 an upload under case %j before anything is sent", async (id) => {
      const res = response();

      await expect(handler(delimited(id), res)).rejects.toThrow(NotFoundError);

      expect(uploadDocument).not.toHaveBeenCalled();
      expect(res.redirect).not.toHaveBeenCalled();
    });
  });
});
