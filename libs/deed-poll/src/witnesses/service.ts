import { type DeedPollWitness, prisma } from "@hmcts/postgres-prisma";
import { NotFoundError } from "../errors.js";
import type { CreateWitnessInput, UpdateWitnessInput } from "./schemas.js";

/** Nested CRUD for witnesses, scoped to a parent DeedPoll (see NotesService). */

async function assertCaseExists(deedPollId: string): Promise<void> {
  const exists = await prisma.deedPoll.findUnique({
    where: { id: deedPollId },
    select: { id: true }
  });
  if (!exists) throw new NotFoundError(`DeedPoll ${deedPollId} not found`);
}

export async function createWitness(deedPollId: string, dto: CreateWitnessInput): Promise<DeedPollWitness> {
  await assertCaseExists(deedPollId);
  return prisma.deedPollWitness.create({ data: { ...dto, deedPollId } });
}

export function findWitnesses(deedPollId: string): Promise<DeedPollWitness[]> {
  return prisma.deedPollWitness.findMany({
    where: { deedPollId },
    orderBy: { createdOn: "asc" }
  });
}

export async function findWitness(deedPollId: string, id: string): Promise<DeedPollWitness> {
  const witness = await prisma.deedPollWitness.findFirst({
    where: { id, deedPollId }
  });
  if (!witness) throw new NotFoundError(`Witness ${id} not found`);
  return witness;
}

export async function updateWitness(deedPollId: string, id: string, dto: UpdateWitnessInput): Promise<DeedPollWitness> {
  await findWitness(deedPollId, id);
  return prisma.deedPollWitness.update({ where: { id }, data: dto });
}

export async function removeWitness(deedPollId: string, id: string): Promise<void> {
  await findWitness(deedPollId, id);
  await prisma.deedPollWitness.delete({ where: { id } });
}
