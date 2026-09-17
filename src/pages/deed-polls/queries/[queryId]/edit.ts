/**
 * Amend a saved query: its name, its description, and whether it is published.
 *
 * **Not its conditions.** A query's filters are amended by opening it, changing them in the builder and
 * saving again — the URL is the query, so there is nothing here for a second copy of the builder to edit that
 * the list page does not already do better. The page links to the query so it can be checked.
 *
 * **`editable` is api's statement and this page only renders it** — plan 11's decision 3. Both write controls
 * are hidden when it is false, hidden rather than disabled for the reason `witness-edit.njk` records, and
 * there is no local policy function: api derives the flag from the same predicate its write paths refuse on,
 * so a second opinion here would be a second authority on somebody else's rule. It is read on every render,
 * including the failed-validation one, because a flag read only in `GET` puts the buttons back the moment a
 * caseworker submits an over-long name.
 *
 * **The write branches are deliberately ungated**, as the witness delete is: with the controls hidden,
 * reaching them takes a hand-crafted POST, and api refuses one. A local refusal as well would put the
 * authority in two places.
 *
 * A query the caller cannot see is a 404 and not a 403 — api's decision, so that no id is discoverable by
 * watching status codes. That includes an administrator naming somebody else's *unshared* query. This page
 * renders "gone or never yours" and cannot say which.
 *
 * **Delete is immediate here.** Plan 11's task 7 puts a confirmation in front of a *shared* query's delete,
 * where colleagues may hold it in their own lists; an unshared one has nobody else to warn.
 */
import {
  type FieldError,
  findSavedQuery,
  InvalidInputError,
  MAX_SAVED_QUERY_DESCRIPTION,
  MAX_SAVED_QUERY_NAME,
  removeSavedQuery,
  savedQueryFormSchema,
  savedQueryHref,
  updateSavedQuery,
  zodErrorToFieldErrors
} from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../../../auth/current-user.js";

const LIST_PATH = "/deed-polls";

const LIBRARY_PATH = "/deed-polls/queries";

/** The order the summary lists errors in, which is the order the controls appear in. */
const FIELD_ORDER = ["name", "description"];

const en = {
  title: "Amend saved query",
  heading: "Amend saved query",
  nameLabel: "Name",
  nameHint: "This is what appears in the filter bar.",
  descriptionLabel: "Description (optional)",
  descriptionHint: "Say what the query finds, for whoever else adds it to their list.",
  sharedLegend: "Publish this query",
  sharedLabel: "Keep this query in the library, so colleagues can find it",
  sharedHint: "Unpublishing it leaves it in your own list. Colleagues who added it lose it.",
  openQuery: "Open this query",
  submit: "Save changes",
  delete: "Delete query",
  cancel: "Cancel",
  // Shown in place of the controls for a query api says this caller may not amend, which takes a typed URL:
  // the library offers no link to one.
  readOnly: "This query belongs to someone else, so you cannot change it.",
  errorSummaryTitle: "There is a problem",
  saveRefused: "The query could not be saved. Check the details and try again.",
  maxName: MAX_SAVED_QUERY_NAME,
  maxDescription: MAX_SAVED_QUERY_DESCRIPTION
};

// English content in the cy shape — see the note in ../../index.ts.
const cy = { ...en };

export const GET = async (req: Request, res: Response) => {
  const query = await findSavedQuery(req.params.queryId, callerFromRequest(req));

  // The stored query as the controls want it: `shared` becomes the string the checkbox posts, so one
  // comparison serves this render and every re-render after it.
  await render(req, res, { name: query.name, description: query.description ?? "", shared: query.shared ? "true" : "" }, {}, []);
};

export const POST = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;

  // First, so a name that would fail validation cannot block a deletion.
  if (body.action === "delete") {
    await removeSavedQuery(req.params.queryId, callerFromRequest(req));

    return res.redirect(LIBRARY_PATH);
  }

  const parsed = savedQueryFormSchema.safeParse({ name: body.name, description: body.description, shared: body.shared });

  if (!parsed.success) {
    return await render(req, res, body, messagesFor(zodErrorToFieldErrors(parsed.error)), [], 400);
  }

  try {
    // `null` rather than an omitted description, because the form showed the field: a caseworker who cleared
    // it means "no description", and api reads an omitted property as "leave it as stored" — the one
    // difference between this patch and the note and witness ones, whose columns are not nullable.
    await updateSavedQuery(
      req.params.queryId,
      { name: parsed.data.name, description: parsed.data.description ?? null, shared: parsed.data.shared },
      callerFromRequest(req)
    );
  } catch (error) {
    if (!(error instanceof InvalidInputError)) throw error;

    if (error.errors.length === 0) {
      console.error(`saved query save refused with no field named: ${error.message}`);

      return await render(req, res, body, {}, [{ text: en.saveRefused, href: "#name" }], 400);
    }

    return await render(req, res, body, messagesFor(error.errors), [], 400);
  }

  res.redirect(LIBRARY_PATH);
};

/**
 * The query is re-read on every render, including after a rejected save.
 *
 * A re-render is its own request: `editable` decides whether the controls appear and the 404 for a query this
 * caller cannot see has to hold on this path too, so neither can be carried over from `GET`.
 */
async function render(
  req: Request,
  res: Response,
  values: Record<string, unknown>,
  errors: Record<string, string>,
  formErrors: { text: string; href: string }[],
  status?: number
) {
  const query = await findSavedQuery(req.params.queryId, callerFromRequest(req));

  if (status !== undefined) res.status(status);

  res.render("deed-polls/queries/edit", {
    queryId: query.id,
    // Where the query points, built by the same function the filter bar and the library build their links
    // with, so "Open this query" and the entry that named it cannot disagree.
    queryHref: savedQueryHref(query, LIST_PATH),
    values,
    errors,
    errorList: [...formErrors, ...summaryFor(errors)],
    // api's statement, never this app's. Both write controls hang off it.
    canAmend: query.editable,
    libraryPath: LIBRARY_PATH,
    en,
    cy
  });
}

/** api's field errors and the schema's, in the one shape the controls read. */
function messagesFor(errors: FieldError[]): Record<string, string> {
  return Object.fromEntries(errors.filter((error) => error.field !== "").map((error) => [error.field, error.message]));
}

function summaryFor(errors: Record<string, string>): { text: string; href: string }[] {
  return FIELD_ORDER.filter((field) => errors[field]).map((field) => ({ text: errors[field], href: `#${field}` }));
}
