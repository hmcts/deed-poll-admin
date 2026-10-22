/**
 * Save this query: name it, describe it, and — if you hold MANAGE_SHARED_QUERIES — publish it to the library.
 *
 * **Publishing requires MANAGE_SHARED_QUERIES, and the checkbox is hidden rather than disabled** for the reason
 * `witness-edit.njk` records: a disabled control has no value to read. Saving a query for yourself is every
 * caseworker's, so the form itself is unchanged for them; only the third control goes. The gate is
 * presentational — api refuses an unentitled caller's `shared: true` with a 403, which is what makes a
 * hand-crafted POST fail rather than publish. Plan 14.
 *
 * **Nothing forces `shared` false here for a caseworker, deliberately.** The schema already yields `false`
 * from an absent checkbox, and a local refusal as well would put the authority in two places — the same
 * argument the amend page's ungated write branches make.
 *
 * **A page rather than a control in the builder** — plan 11's decision 9. The list page's `GET` already does
 * two jobs, rendering the canonical URL and redirecting a builder submission to it, and a
 * name-and-description form inside it would be a third.
 *
 * **The query being saved travels in the URL, not in hidden inputs.** A list URL *is* the query, so the form
 * posts back to the query string it was opened with and `case-query.ts` reads it exactly as the list does.
 * Hidden inputs would be a second copy of the same state and the first place a caseworker's conditions get
 * quietly re-serialised into something else. `savedQueryStored` is what turns that half into api's columns —
 * incomplete conditions left off, an unshowable order dropped — and it lives beside the function that reads
 * them back so the two cannot drift.
 *
 * **The new query is selected explicitly.** api does not put a query in its creator's own list, and nothing
 * in the spec says it should; naming a query is how a caseworker asks for it in their filter bar, so the page
 * that names one issues the `PUT` itself. It is idempotent, so a double submit costs nothing.
 */
import {
  type Caller,
  type CaseListLink,
  can,
  caseListSearch,
  createSavedQuery,
  type FieldError,
  filterFor,
  InvalidInputError,
  MANAGE_SHARED_QUERIES,
  MAX_SAVED_QUERY_DESCRIPTION,
  MAX_SAVED_QUERY_NAME,
  parseConditions,
  parseSort,
  savedQueryFormSchema,
  savedQueryStored,
  selectSavedQuery,
  serialiseSort,
  zodErrorToFieldErrors
} from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest, userFromRequest } from "../../../auth/current-user.js";
import { forLog } from "../../../for-log.js";

const LIST_PATH = "/deed-polls";

const FORM_PATH = "/deed-polls/queries/new";

/** The order the summary lists errors in, which is the order the controls appear in. */
const FIELD_ORDER = ["name", "description"];

const en = {
  title: "Save this query",
  heading: "Save this query",
  intro: "The filters you have applied are saved with the name you give them. A saved query always opens at its first page.",
  nameLabel: "Name",
  nameHint: "This is what appears in your filter bar.",
  descriptionLabel: "Description (optional)",
  descriptionHint: "Say what the query finds, for whoever else adds it to their list.",
  sharedLegend: "Publish this query",
  // Decision 6 in words: a shared query is a live reference and not a copy, so a colleague who adds it sees
  // the owner's later edits. Said here because it is the thing a caseworker cannot discover by trying it.
  sharedLabel: "Add this query to the library, so colleagues can find it",
  sharedHint: "Anyone working on deed polls can add a published query to their own list. They see your later changes to it.",
  submit: "Save query",
  cancel: "Cancel",
  errorSummaryTitle: "There is a problem",
  // Shown for a refusal api addressed to no field — its own wording is developer-facing, so it is logged.
  saveRefused: "The query could not be saved. Check the details and try again.",
  maxName: MAX_SAVED_QUERY_NAME,
  maxDescription: MAX_SAVED_QUERY_DESCRIPTION
};

// English content in the cy shape — see the note in ../index.ts.
const cy = { ...en };

export const GET = (req: Request, res: Response) => {
  render(res, req, {}, {}, []);
};

export const POST = async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  // Only the three controls are read. Building the payload from the body wholesale would let a hand-crafted
  // POST set the conditions, which belong to the URL, or `ownerId`, which belongs to api.
  const parsed = savedQueryFormSchema.safeParse({ name: body.name, description: body.description, shared: body.shared });

  if (!parsed.success) {
    return render(res, req, body, messagesFor(zodErrorToFieldErrors(parsed.error)), [], 400);
  }

  const link = queryFrom(req);
  const caller = callerFromRequest(req);

  try {
    const created = await createSavedQuery({ ...savedQueryStored(link), ...parsed.data }, caller);

    await select(created.id, caller);
  } catch (error) {
    if (!(error instanceof InvalidInputError)) throw error;

    if (error.errors.length === 0) {
      console.error(`saved query create refused with no field named: ${forLog(error.message)}`);

      return render(res, req, body, {}, [{ text: en.saveRefused, href: "#name" }], 400);
    }

    return render(res, req, body, messagesFor(error.errors), [], 400);
  }

  // Back to the list the query describes, so the caseworker lands on the results they just named with the
  // new entry current in their filter bar.
  res.redirect(`${LIST_PATH}${caseListSearch(link)}`);
};

/**
 * Put the new query in the caller's own list, and do not lose the save if that fails.
 *
 * The query exists by this point. A 500 here would tell a caseworker their save failed when it did not, and
 * the obvious response to that is to save it again — so the failure is logged and the redirect stands. The
 * query is still in the library for them to add by hand. Logged without the id, per the no-PII rule.
 */
async function select(id: string, caller: Caller) {
  try {
    await selectSavedQuery(id, caller);
  } catch (error) {
    console.error(`saved query created but could not be selected: ${forLog(error instanceof Error ? error.message : String(error))}`);
  }
}

/**
 * The query the form was opened with, read off the URL exactly as the list reads it.
 *
 * `filterFor` and `parseSort` fall back rather than refusing, for the reason they always do: the URL may have
 * been edited or bookmarked, and a 400 on the way to naming a query would be useless.
 */
function queryFrom(req: Request): CaseListLink {
  const query = (req.query ?? {}) as Record<string, unknown>;

  return {
    filter: filterFor(query.filter).key,
    conditions: parseConditions(query.where),
    sort: serialiseSort(parseSort(query.sort)),
    // Handed on untrimmed on purpose: `savedQueryStored` trims it for the column and `caseListSearch` trims
    // it for the URL, so a third trimmer here would be a third opinion about the same string. A repeated
    // `?q=a&q=b` arrives as an array and is not a term.
    q: typeof query.q === "string" ? query.q : undefined
  };
}

function render(
  res: Response,
  req: Request,
  values: Record<string, unknown>,
  errors: Record<string, string>,
  formErrors: { text: string; href: string }[],
  status?: number
) {
  // The same query string on both, so a cancel returns to the results being named and a submit posts the
  // query back to itself.
  const search = caseListSearch(queryFrom(req));

  if (status !== undefined) res.status(status);

  res.render("deed-polls/queries/new", {
    formAction: `${FORM_PATH}${search}`,
    cancelHref: `${LIST_PATH}${search}`,
    values,
    errors,
    errorList: [...formErrors, ...summaryFor(errors)],
    // Whether to offer publishing at all. **This app's own statement, unlike `canAmend` on the amend page**,
    // which is api's per-query `editable`: publishing eligibility is a property of the caller rather than of a
    // row, so there is no flag api could return for it. Resolved here rather than in `GET` for the reason
    // `canAmend` is read on every render — a flag read once puts the control back the moment a caseworker
    // submits an over-long name.
    canPublish: can(userFromRequest(req), MANAGE_SHARED_QUERIES),
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
