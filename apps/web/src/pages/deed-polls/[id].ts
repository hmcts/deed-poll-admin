/**
 * The read-only case detail page, ported from the prototype's `@Get(':id')`.
 *
 * Every part of the view model comes from the domain — `buildDetailTabs`, `buildCaseHeader`,
 * `buildNotesView`, `buildDocumentsView`, `build` for presentation — so this handler assembles
 * rather than decides. That matters more here than anywhere: the tabs, sections and rows are derived
 * from `FORM_TABS`, the same metadata the edit forms use, which is what stops the read-only page
 * falling behind the form the way it once did. A new field belongs in `form-fields.ts` and then
 * appears on both.
 *
 * `findDeedPoll` includes the children, so notes, witnesses and documents come from the one query.
 */
import {
  buildCaseHeader,
  buildDetailTabs,
  buildDocumentsView,
  buildNotesView,
  build as buildPresentation,
  DOCUMENT_COLUMNS,
  findDeedPoll,
  getCaseFieldRules
} from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { userFromRequest } from "../../auth/current-user.js";

const en = {
  title: "Case",
  privateTag: "Private",
  declarantTag: "Declarant",
  bannerTitle: "Important",
  noneRecorded: "None recorded.",
  notEdited: "Not edited",
  addNote: "Add a note",
  uploadDocument: "Upload a document",
  changeLink: "Change",
  backToCases: "Back to cases",
  unknownType: "Unknown",
  noteColumns: ["NoteID", "Note", "Created", "Modified"],
  amendNoteHint: "amend this note",
  documentColumns: DOCUMENT_COLUMNS,
  witnessAddress: "Address",
  witnessOccupation: "Occupation"
};

// English content in the cy shape — see the note in index.ts.
const cy = { ...en };

export const GET = async (req: Request, res: Response) => {
  const found = await findDeedPoll(req.params.id);
  const { isAdmin } = userFromRequest(req);

  const presentation = buildPresentation(
    { type: found.type, privacy: found.privacy, referToMasterChoice: found.referToMasterChoice, state: found.state },
    { isAdmin, isNew: false }
  );

  const rules = getCaseFieldRules(found.type, found.migratedRecord === true, found.publishToLondonGazette !== false);

  res.render("deed-polls/detail", {
    // The page title is the reference, so it is passed rather than sitting in `en`: it is data.
    pageHeading: found.displayReference,
    case: found,
    presentation,
    tabs: buildDetailTabs(found as unknown as Record<string, unknown>, rules, presentation),
    header: buildCaseHeader(found),
    notes: buildNotesView(found.notes),
    documents: buildDocumentsView(found.documents),
    en,
    cy
  });
};
