import { describe, expect, it } from "vitest";
import { DocumentDirection } from "../deed-poll/enums/option-sets.js";
import { uploadFormSchema } from "./schemas.js";

const validUpload = { documentTypeId: "3f0f5b62-1f0a-4c1e-9b3a-2c1d4e5f6a7b" };

describe("uploadFormSchema", () => {
  it("should accept the document type alone, leaving the name and direction to api's defaults", () => {
    expect(uploadFormSchema.parse(validUpload)).toEqual(validUpload);
  });

  it("should accept an overriding name and direction when the form supplied them", () => {
    const parsed = uploadFormSchema.parse({ ...validUpload, name: "Birth certificate", direction: DocumentDirection.Outgoing });

    expect(parsed.name).toBe("Birth certificate");
    expect(parsed.direction).toBe(DocumentDirection.Outgoing);
  });

  it("should require the document type, because api cannot file a document without one", () => {
    expect(uploadFormSchema.safeParse({}).success).toBe(false);
  });

  it("should require documentTypeId to be a UUID, so a bad reference fails before the bytes go on the wire", () => {
    expect(uploadFormSchema.safeParse({ ...validUpload, documentTypeId: "not-a-uuid" }).success).toBe(false);
  });

  it("should reject a direction outside the option set", () => {
    expect(uploadFormSchema.safeParse({ ...validUpload, direction: "Sideways" }).success).toBe(false);
  });

  it("should enforce the 100-character name limit, which is why the service truncates nothing", () => {
    expect(uploadFormSchema.safeParse({ ...validUpload, name: "a".repeat(101) }).success).toBe(false);
  });
});
