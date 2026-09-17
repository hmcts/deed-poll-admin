/**
 * The confirmation in front of deleting a **published** query — plan 11's decision 5.
 *
 * **There is no interstitial anywhere else in this repo to copy.** The witness and note deletes are a
 * warning-styled submit on their own edit form and they act immediately (`witness-edit.njk:79`,
 * `note-edit.njk:64`). This page exists because a published query has a wider blast radius than a note: a
 * colleague may be navigating by it, and the person deleting it cannot see whose filter bar it is in.
 *
 * **The wording claims no number.** api publishes no subscriber count and plan 11 deliberately does not ask
 * for one — *"3 people"* would be invented, and a sentence is not worth a second api change. So the copy
 * states the uncertainty instead.
 *
 * **An unshared query never reaches this page.** Nobody else can see it, so there is nothing to warn about and
 * this page's own sentence would be untrue of it; the amend form deletes it outright. A typed URL for one is
 * sent back to that form rather than shown a warning that does not apply.
 *
 * **Cancel is a link, so it acts on nothing.** Nothing here is destructive but the one submit whose `action`
 * is the literal `delete`, which is the same rule the amend form's two buttons follow.
 */
import { findSavedQuery, removeSavedQuery, savedQueryHref } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../../../auth/current-user.js";

const LIST_PATH = "/deed-polls";

const LIBRARY_PATH = "/deed-polls/queries";

const en = {
  title: "Are you sure you want to delete this query?",
  heading: "Are you sure you want to delete this query?",
  nameLabel: "Query",
  openQuery: "Open this query",
  // Decision 5. No count, because api exposes none and this app cannot know one.
  warning: "Other people may have this query in their filter bar. If they have, it will disappear from theirs too.",
  irreversible: "You cannot undo this. Saving the query again gives colleagues a different one to add.",
  confirm: "Delete query",
  cancel: "Cancel",
  // Reaching this for somebody else's query takes a typed URL; the library and the amend form both offer no
  // control for one. Hidden rather than disabled, for the reason `witness-edit.njk` records.
  readOnly: "This query belongs to someone else, so you cannot delete it.",
  warningIconText: "Warning"
};

// English content in the cy shape — see the note in ../../index.ts.
const cy = { ...en };

export const GET = async (req: Request, res: Response) => {
  const query = await findSavedQuery(req.params.queryId, callerFromRequest(req));

  if (!query.shared) return res.redirect(editHref(query.id));

  res.render("deed-polls/queries/delete", {
    queryId: query.id,
    queryName: query.name,
    // The same function the filter bar and the library build their links with, so what is about to be deleted
    // can be checked against the rows it finds.
    queryHref: savedQueryHref(query, LIST_PATH),
    editHref: editHref(query.id),
    libraryPath: LIBRARY_PATH,
    // api's `editable`, never a local policy function — decision 3.
    canDelete: query.editable,
    en,
    cy
  });
};

export const POST = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;

  // Only the literal deletes. Cancel posts nothing at all, so any other body arriving here is not one this
  // page produced and the safe reading of it is "went back".
  if (body.action !== "delete") return res.redirect(editHref(req.params.queryId));

  // Ungated, as the amend form's delete is: with the control hidden, reaching it takes a hand-crafted POST and
  // api refuses one. `shared` is not re-read either — the confirmation was for the caseworker, and a query
  // unpublished since it was rendered is still the query they asked to delete.
  await removeSavedQuery(req.params.queryId, callerFromRequest(req));

  res.redirect(LIBRARY_PATH);
};

function editHref(queryId: string): string {
  return `${LIBRARY_PATH}/${encodeURIComponent(queryId)}/edit`;
}
