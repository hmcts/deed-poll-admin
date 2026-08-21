import { type DeedPollNote, prisma } from "@hmcts/postgres-prisma";
import { SERVICE_ACCOUNT_NAME } from "../auth/current-user.js";
import { NotFoundError } from "../errors.js";
import type { CreateNoteInput, UpdateNoteInput } from "./schemas.js";

/**
 * Who is writing a note. Optional throughout: an omitted name is stamped as the
 * service account, exactly as the case's own audit columns behave.
 */
export interface NoteAuthor {
  userName?: string;
}

/**
 * Nested CRUD for case notes. All operations are scoped to a parent DeedPoll so
 * a note can never be read or mutated outside its case. The parent's existence
 * is checked on create (FK would fail anyway, but a 404 is clearer than a 500).
 */

async function assertCaseExists(deedPollId: string): Promise<void> {
  const exists = await prisma.deedPoll.findUnique({
    where: { id: deedPollId },
    select: { id: true }
  });
  if (!exists) throw new NotFoundError(`DeedPoll ${deedPollId} not found`);
}

export async function createNote(deedPollId: string, dto: CreateNoteInput, author: NoteAuthor = {}): Promise<DeedPollNote> {
  await assertCaseExists(deedPollId);
  // Both stamped on create: the source shows a Modified By on a note that has only
  // ever been created, so "modified" means "last written", not "edited since".
  const name = author.userName ?? SERVICE_ACCOUNT_NAME;
  return prisma.deedPollNote.create({
    data: { ...dto, deedPollId, createdBy: name, modifiedBy: name }
  });
}

export function findNotes(deedPollId: string): Promise<DeedPollNote[]> {
  return prisma.deedPollNote.findMany({
    where: { deedPollId },
    orderBy: { createdOn: "desc" }
  });
}

export async function findNote(deedPollId: string, id: string): Promise<DeedPollNote> {
  const note = await prisma.deedPollNote.findFirst({
    where: { id, deedPollId }
  });
  if (!note) throw new NotFoundError(`Note ${id} not found`);
  return note;
}

export async function updateNote(deedPollId: string, id: string, dto: UpdateNoteInput, author: NoteAuthor = {}): Promise<DeedPollNote> {
  await findNote(deedPollId, id); // 404 if missing or wrong parent
  // `createdBy` is never in the patch — UpdateNoteInput cannot carry it — so an edit
  // can only ever move `modifiedBy`, matching the case's updateNote() rule that no
  // update may rewrite who created a record.
  return prisma.deedPollNote.update({
    where: { id },
    data: { ...dto, modifiedBy: author.userName ?? SERVICE_ACCOUNT_NAME }
  });
}

export async function removeNote(deedPollId: string, id: string): Promise<void> {
  await findNote(deedPollId, id);
  await prisma.deedPollNote.delete({ where: { id } });
}
