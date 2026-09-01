import { prisma as prismaClient } from "@hmcts/postgres-prisma";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InvalidInputError, NotFoundError } from "../errors.js";
import { createFileReadStream, deleteFile, saveFile } from "./file-storage.js";
import type { UploadedFile } from "./service.js";
import { createDocument, downloadDocument, findDocument, removeDocument, updateDocument, uploadDocument } from "./service.js";

// Partial mock: only the client is replaced. The Prisma enums (DocumentDirection,
// DeedPollType, …) are real values the source modules import, so they must pass through.
vi.mock("@hmcts/postgres-prisma", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/postgres-prisma")>()),
  prisma: {
    deedPoll: { findUnique: vi.fn() },
    deedPollSupportingDocumentType: { findUnique: vi.fn() },
    deedPollSupportingDocument: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn()
    }
  }
}));

vi.mock("./file-storage.js", () => ({
  saveFile: vi.fn(),
  deleteFile: vi.fn(),
  createFileReadStream: vi.fn()
}));

const prisma = vi.mocked(prismaClient, { deep: true });

// The blob store was an injected FileStorageService; it is now a module. Mapping the mocked
// functions back onto the old method names keeps every assertion below unchanged.
const storage = {
  save: vi.mocked(saveFile),
  delete: vi.mocked(deleteFile),
  createReadStream: vi.mocked(createFileReadStream)
};

describe("documents/service", () => {
  const dto = {
    direction: "Incoming" as const,
    name: "Birth certificate",
    documentTypeId: "type1"
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Defaults the Nest providers used to set at construction time.
    storage.save.mockResolvedValue("stored-key");
    storage.delete.mockResolvedValue(undefined);
    storage.createReadStream.mockReturnValue("stream" as never);
  });

  it("creates a document when parent and type both exist", async () => {
    prisma.deedPoll.findUnique.mockResolvedValue({ id: "case1" });
    prisma.deedPollSupportingDocumentType.findUnique.mockResolvedValue({
      id: "type1"
    });
    prisma.deedPollSupportingDocument.create.mockResolvedValue({ id: "d1" });
    await createDocument("case1", dto);
    expect(prisma.deedPollSupportingDocument.create).toHaveBeenCalledWith({
      data: { ...dto, deedPollId: "case1" }
    });
  });

  it("404s when the parent case is missing", async () => {
    prisma.deedPoll.findUnique.mockResolvedValue(null);
    await expect(createDocument("nope", dto)).rejects.toBeInstanceOf(NotFoundError);
    expect(prisma.deedPollSupportingDocument.create).not.toHaveBeenCalled();
  });

  it("404s when the document type is missing", async () => {
    prisma.deedPoll.findUnique.mockResolvedValue({ id: "case1" });
    prisma.deedPollSupportingDocumentType.findUnique.mockResolvedValue(null);
    await expect(createDocument("case1", dto)).rejects.toBeInstanceOf(NotFoundError);
    expect(prisma.deedPollSupportingDocument.create).not.toHaveBeenCalled();
  });

  it("findOne 404s across parents", async () => {
    prisma.deedPollSupportingDocument.findFirst.mockResolvedValue(null);
    await expect(findDocument("case1", "d1")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("removes after an existence check and cleans up the blob", async () => {
    prisma.deedPollSupportingDocument.findFirst.mockResolvedValue({
      id: "d1",
      storageKey: "k1"
    });
    prisma.deedPollSupportingDocument.delete.mockResolvedValue({ id: "d1" });
    await removeDocument("case1", "d1");
    expect(prisma.deedPollSupportingDocument.delete).toHaveBeenCalledWith({
      where: { id: "d1", deedPollId: "case1" }
    });
    expect(storage.delete).toHaveBeenCalledWith("k1");
  });

  const file = {
    originalname: "birth.pdf",
    mimetype: "application/pdf",
    size: 1234,
    buffer: Buffer.from("pdf")
  } as UploadedFile;

  it("uploads: stores the blob and records metadata", async () => {
    prisma.deedPoll.findUnique.mockResolvedValue({ id: "case1" });
    prisma.deedPollSupportingDocumentType.findUnique.mockResolvedValue({
      id: "type1"
    });
    prisma.deedPollSupportingDocument.create.mockResolvedValue({ id: "d1" });
    await uploadDocument("case1", "type1", file);
    expect(storage.save).toHaveBeenCalledWith(file.buffer);
    const data = prisma.deedPollSupportingDocument.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      deedPollId: "case1",
      documentTypeId: "type1",
      direction: "Incoming",
      name: "birth.pdf",
      storageKey: "stored-key",
      originalName: "birth.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1234
    });
  });

  it("uploads: rejects a request with no file", async () => {
    await expect(uploadDocument("case1", "type1", undefined)).rejects.toBeInstanceOf(InvalidInputError);
    expect(storage.save).not.toHaveBeenCalled();
  });

  it("download: returns the row and a stream", async () => {
    prisma.deedPollSupportingDocument.findFirst.mockResolvedValue({
      id: "d1",
      storageKey: "k1"
    });
    const out = await downloadDocument("case1", "d1");
    expect(storage.createReadStream).toHaveBeenCalledWith("k1");
    expect(out.stream).toBe("stream");
  });

  it("download: 404s when the row has no attached file", async () => {
    prisma.deedPollSupportingDocument.findFirst.mockResolvedValue({
      id: "d1",
      storageKey: null
    });
    await expect(downloadDocument("case1", "d1")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("404s updating a document that belongs to another case, before writing", async () => {
    prisma.deedPollSupportingDocument.findFirst.mockResolvedValue(null);
    await expect(updateDocument("case1", "d1", { name: "renamed" })).rejects.toBeInstanceOf(NotFoundError);
    expect(prisma.deedPollSupportingDocument.update).not.toHaveBeenCalled();
  });

  it("scopes the update to the parent case, so the write does not rely on the guard above it", async () => {
    prisma.deedPollSupportingDocument.findFirst.mockResolvedValue({ id: "d1" });
    prisma.deedPollSupportingDocument.update.mockResolvedValue({ id: "d1" });
    await updateDocument("case1", "d1", { name: "renamed" });
    expect(prisma.deedPollSupportingDocument.update).toHaveBeenCalledWith({
      where: { id: "d1", deedPollId: "case1" },
      data: { name: "renamed" }
    });
  });
});
