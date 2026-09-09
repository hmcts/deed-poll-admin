import { downloadDocument as apiDownloadDocument, uploadDocument as apiUploadDocument, getCase } from "@hmcts/deed-poll-api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InvalidInputError, NotFoundError } from "../errors.js";
import { downloadDocument, findDocument, findDocuments, uploadDocument } from "./service.js";

vi.mock("@hmcts/deed-poll-api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll-api-client")>()),
  getCase: vi.fn(),
  uploadDocument: vi.fn(),
  downloadDocument: vi.fn()
}));

const CALLER = { accessToken: "caseworker-token" };

const ok = <T>(data: T) => ({ ok: true as const, data });

const caseWith = (documents: { id: string; hasFile?: boolean }[]) => ok({ id: "case-1", notes: [], witnesses: [], documents });

const aFile = { buffer: Buffer.from("scanned bytes"), originalname: "birth-certificate.pdf", mimetype: "application/pdf", size: 13 };

describe("documents/service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DEED_POLL_API_URL = "http://api.test";
  });

  describe("findDocuments", () => {
    it("should return the documents api sent inside the case", async () => {
      vi.mocked(getCase).mockResolvedValue(caseWith([{ id: "doc-1", hasFile: true }]) as never);

      expect(await findDocuments("case-1", CALLER)).toEqual([{ id: "doc-1", hasFile: true }]);
      expect(getCase).toHaveBeenCalledWith("case-1", expect.objectContaining({ baseUrl: "http://api.test" }));
    });

    it("should throw NotFoundError for a case that does not exist, rather than an empty list", async () => {
      vi.mocked(getCase).mockResolvedValue({ ok: false, error: { kind: "not-found", status: 404, message: "DeedPoll nope not found" } } as never);

      await expect(findDocuments("nope", CALLER)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("findDocument", () => {
    it("should return the document with the matching id", async () => {
      vi.mocked(getCase).mockResolvedValue(caseWith([{ id: "doc-1" }, { id: "doc-2" }]) as never);

      expect(await findDocument("case-1", "doc-2", CALLER)).toEqual({ id: "doc-2" });
    });

    it("should throw NotFoundError for a document that belongs to a different case", async () => {
      vi.mocked(getCase).mockResolvedValue(caseWith([{ id: "doc-1" }]) as never);

      await expect(findDocument("case-1", "doc-of-another-case", CALLER)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("uploadDocument", () => {
    it("should send the bytes, the type and the file's own name to api's multipart endpoint", async () => {
      vi.mocked(apiUploadDocument).mockResolvedValue(ok({ id: "doc-1", hasFile: true }) as never);

      const created = await uploadDocument("case-1", "type-1", aFile, {}, CALLER);

      expect(created.id).toBe("doc-1");
      const [caseId, upload] = vi.mocked(apiUploadDocument).mock.calls[0];
      expect(caseId).toBe("case-1");
      expect(upload).toEqual({
        documentTypeId: "type-1",
        name: "birth-certificate.pdf",
        mimeType: "application/pdf",
        bytes: aFile.buffer,
        documentName: undefined,
        direction: undefined
      });
    });

    it("should forward an overriding name and direction only when the form supplied them", async () => {
      // Omitted rather than defaulted, so api applies its own rules — the row's name falls back to the
      // file's and the direction to Incoming. Defaulting here would be a second opinion about both.
      vi.mocked(apiUploadDocument).mockResolvedValue(ok({ id: "doc-1", hasFile: true }) as never);

      await uploadDocument("case-1", "type-1", aFile, { name: "Birth certificate", direction: "Outgoing" }, CALLER);

      const [, upload] = vi.mocked(apiUploadDocument).mock.calls[0];
      expect(upload.documentName).toBe("Birth certificate");
      expect(upload.direction).toBe("Outgoing");
    });

    it("should reject a submission with no file before anything reaches api", async () => {
      await expect(uploadDocument("case-1", "type-1", undefined, {}, CALLER)).rejects.toBeInstanceOf(InvalidInputError);
      expect(apiUploadDocument).not.toHaveBeenCalled();
    });

    it("should surface api's field errors as an InvalidInputError the upload form can render", async () => {
      vi.mocked(apiUploadDocument).mockResolvedValue({
        ok: false,
        error: { kind: "validation", status: 400, message: "Invalid input", fieldErrors: [{ field: "documentTypeId", message: "Choose a document type" }] }
      } as never);

      const error = await uploadDocument("case-1", "type-1", aFile, {}, CALLER).catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(InvalidInputError);
      expect((error as InvalidInputError).errors).toEqual([{ field: "documentTypeId", message: "Choose a document type" }]);
    });
  });

  describe("downloadDocument", () => {
    it("should return api's stream and the headers it put on it, buffering nothing", async () => {
      const download = { body: new ReadableStream<Uint8Array>(), contentType: "application/pdf", contentDisposition: 'attachment; filename="deed.pdf"' };
      vi.mocked(apiDownloadDocument).mockResolvedValue(ok(download) as never);

      expect(await downloadDocument("case-1", "doc-1", CALLER)).toBe(download);
      expect(apiDownloadDocument).toHaveBeenCalledWith("case-1", "doc-1", expect.anything());
    });

    it("should throw NotFoundError when the row has no attached file, which is api's answer now", async () => {
      // The local check this replaces read `storageKey`, which api deliberately does not publish.
      vi.mocked(apiDownloadDocument).mockResolvedValue({
        ok: false,
        error: { kind: "not-found", status: 404, message: "This document has no attached file" }
      } as never);

      await expect(downloadDocument("case-1", "doc-1", CALLER)).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
