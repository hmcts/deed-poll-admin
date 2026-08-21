import { type DeedPollSupportingDocumentType, prisma } from "@hmcts/postgres-prisma";
import { NotFoundError } from "../errors.js";
import type { CreateDocumentTypeInput, UpdateDocumentTypeInput } from "./schemas.js";

/**
 * CRUD for supporting-document *types* — global reference data (not nested under
 * a case). Documents reference a type by FK; a type in use cannot be deleted
 * (Prisma's default restrict on the relation surfaces as a 409-style failure).
 */

export function createDocumentType(dto: CreateDocumentTypeInput): Promise<DeedPollSupportingDocumentType> {
  return prisma.deedPollSupportingDocumentType.create({ data: dto });
}

export function findDocumentTypes(): Promise<DeedPollSupportingDocumentType[]> {
  return prisma.deedPollSupportingDocumentType.findMany({
    orderBy: { name: "asc" }
  });
}

export async function findDocumentType(id: string): Promise<DeedPollSupportingDocumentType> {
  const type = await prisma.deedPollSupportingDocumentType.findUnique({
    where: { id }
  });
  if (!type) throw new NotFoundError(`Document type ${id} not found`);
  return type;
}

export async function updateDocumentType(id: string, dto: UpdateDocumentTypeInput): Promise<DeedPollSupportingDocumentType> {
  await findDocumentType(id);
  return prisma.deedPollSupportingDocumentType.update({
    where: { id },
    data: dto
  });
}

export async function removeDocumentType(id: string): Promise<void> {
  await findDocumentType(id);
  await prisma.deedPollSupportingDocumentType.delete({ where: { id } });
}
