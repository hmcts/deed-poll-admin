/**
 * Amend a saved query: its name, its description, and — for an Administrator — whether it is published.
 *
 * **Two different flags decide what renders, and conflating them is the mistake to avoid.** `canAmend` is
 * api's per-query `editable`; `canPublish` is this app's own `isAdmin`. Publishing is a property of the
 * *caller* and amending is a property of the *row*, so there is no flag api could return for the first and no
 * reason to ask it for one. Plan 14.
 *
 * **A caller who may not publish sends no `shared` at all, and the patch must omit it rather than send
 * `false`.** See the call site: sending `false` would silently unpublish a query on an edit to its name, for
 * an owner who published it while an Administrator and has since lost the role.
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
 * **Delete is immediate only for an unshared query.** A published one goes through `delete.ts`'s confirmation,
 * because colleagues may hold it in their own lists and this app cannot see whose — plan 11's decision 5. The
 * branch reads the *stored* `shared` rather than the checkbox's value, so an untouched-but-unsaved form cannot
 * decide whether anybody else is affected.
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
import { callerFromRequest, userFromRequest } from "../../../../auth/current-user.js";

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
    const caller = callerFromRequest(req);
    // The stored `shared`, not the checkbox's — a caseworker who unticked the box without saving has published
    // the query as far as everybody else is concerned, and it is their lists the warning is about.
    const query = await findSavedQuery(req.params.queryId, caller);

    // Decision 5: a published query may be in colleagues' filter bars and this app cannot know whose, so the
    // delete goes through a confirmation. An unshared one has nobody else to warn, so it goes now.
    if (query.shared) return res.redirect(`${LIBRARY_PATH}/${encodeURIComponent(query.id)}/delete`);

    await removeSavedQuery(req.params.queryId, caller);

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
      {
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        // **Omitted rather than `false` when this caller may not publish, and the difference is a real
        // defect otherwise.** The checkbox is absent for them, so the body carries no `shared` and the schema
        // yields `false` — sending that would silently *unpublish* a query on an edit to its name, and
        // "colleagues who added it lose it" is what the copy says that costs. It is reachable without any
        // hand-crafting: an Administrator publishes a query and later loses the role, keeping ownership.
        // Omitting the property is exactly what the three-state patch is for, and it is distinguishable on
        // the wire because `JSON.stringify` drops an undefined one.
        ...(userFromRequest(req).isAdmin ? { shared: parsed.data.shared } : {})
      },
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
    // **This app's own statement, and the contrast with `canAmend` above is the point.** `editable` asks
    // whether this caller may change *this row*; publishing asks whether they may publish *at all*, which is
    // a property of the caller and so not something api could return per query. Read on every render for the
    // same reason `canAmend` is.
    canPublish: userFromRequest(req).isAdmin,
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
