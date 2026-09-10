/**
 * One tab of a case as an editable form, ported from the prototype's `@Get(':id/edit/:tab')` and
 * `@Post(':id/edit/:tab')`.
 *
 * The view model is `buildEditView`, which decorates each field with its value, rule, options and
 * date parts so the template needs no per-field logic. State is re-derived by `updateDeedPoll` on
 * save, so this handler never computes it.
 *
 * **Validation re-renders rather than redirecting**, unlike the note and upload forms. Those carry
 * one field between them; this carries up to 46, and a redirect would discard everything the
 * caseworker had typed to fix a single bad year. The errors are per-field, so they must render
 * against their inputs, which a query string cannot express.
 *
 * Two checks, in this order:
 *  1. **Date parts**, per field — is `99/99/abcd` even a date? Must run first, because the
 *     cross-field rules compare dates and can say nothing useful about a pair where one side is
 *     unparseable.
 *  2. **Cross-field rules**, via `updateDeedPoll`, which throws `InvalidInputError`. Caught and
 *     turned back into form errors: the domain is right to throw, since it also guards the API, and
 *     this page is right not to show a browser a JSON 400.
 */
import {
  buildEditView,
  buildErrorSummary,
  buildUpdatePatch,
  collectDateErrors,
  FORM_TABS,
  type FormError,
  findDeedPoll,
  InvalidInputError,
  NotFoundError,
  type TabDef,
  tabFor,
  updateDeedPoll
} from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest, userFromRequest } from "../../../../auth/current-user.js";

const en = {
  titlePrefix: "Edit",
  errorSummaryTitle: "There is a problem",
  subgridIntro: "This section is managed as a list.",
  subgridLinkPrefix: "View",
  save: "Save",
  cancel: "Cancel",
  // Shown when api refuses the save without naming a field. Its own wording is developer-facing — the
  // fallback in `failureFromResponse` is literally "deed-poll-api answered 400" — and
  // `.claude/rules/backend.md` forbids putting api's internal error text in front of a caseworker, so
  // this page's copy is rendered and api's is logged. Same treatment as the upload page.
  saveRefused: "The case could not be saved. Check the details and try again.",
  noteMaxLength: 2000
};

// English content in the cy shape — see the note in ../../index.ts.
const cy = { ...en };

export const GET = async (req: Request, res: Response) => {
  const found = await findDeedPoll(req.params.id, callerFromRequest(req));
  const { isAdmin } = userFromRequest(req);

  // Lenient on read: the tab id comes from a URL that may have been edited or bookmarked against an
  // older version, and showing the first tab is a harmless answer.
  render(res, tabFor(req.params.tab), found, { isAdmin });
};

export const POST = async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;

  // **Strict on write, deliberately unlike GET.** `tabFor` falls back to the first tab, which is
  // Application — 46 editable fields. `buildUpdatePatch` writes every field it is given, blanking
  // absent ones, so falling back here would null all 46 from a body that never mentioned them.
  // A mistyped tab in a POST target is not something to guess at.
  const tab = FORM_TABS.find((candidate) => candidate.id === req.params.tab);
  if (!tab) {
    throw new NotFoundError(`Unknown tab ${req.params.tab}`);
  }

  const fields = tab.sections.flatMap((section) => section.fields);

  const dateErrors = collectDateErrors(body, fields);
  if (dateErrors.length > 0) {
    return rerenderWithErrors(req, res, tab, dateErrors);
  }

  try {
    await updateDeedPoll(req.params.id, buildUpdatePatch(body, fields), callerFromRequest(req));
  } catch (error) {
    if (error instanceof InvalidInputError) {
      // A rejection that names no field still has to say something: `buildErrorSummary([])` is empty and
      // the template hides an empty summary, so the caseworker would get their tab back with no
      // indication the save failed. The field is deliberately blank — no input is implicated, and
      // `buildErrorSummary` then renders the message without a link.
      //
      // Naming no field also means the refusal is api's alone, since every local rejection attributes
      // itself. So api's wording is logged and this page's own copy is shown — see `en.saveRefused`.
      if (error.errors.length === 0) {
        console.error(`case save refused with no field named: ${error.message}`);
        return rerenderWithErrors(req, res, tab, [{ field: "", message: en.saveRefused }]);
      }
      return rerenderWithErrors(req, res, tab, error.errors);
    }
    // Not a validation failure, so let it surface honestly rather than as an empty error summary
    // over a real fault.
    throw error;
  }

  // Back to the read-only detail, anchored at the tab just saved.
  res.redirect(`/deed-polls/${req.params.id}#${tab.id}`);
};

/**
 * Re-render with the SUBMITTED values, not the stored ones.
 *
 * Showing stored values would silently discard the caseworker's work and leave them staring at an
 * error against a field that now looks fine. `buildEditView`'s `submitted` argument replays the body
 * over the record for exactly that reason.
 */
async function rerenderWithErrors(req: Request, res: Response, tab: TabDef, errors: FormError[]) {
  const found = await findDeedPoll(req.params.id, callerFromRequest(req));
  const { isAdmin } = userFromRequest(req);

  res.status(400);
  render(res, tab, found, { isAdmin }, req.body as Record<string, unknown>, errors);
}

function render(
  res: Response,
  tab: TabDef,
  found: Awaited<ReturnType<typeof findDeedPoll>>,
  ctx: { isAdmin: boolean },
  submitted?: Record<string, unknown>,
  errors?: FormError[]
) {
  const view = buildEditView(found as unknown as Record<string, unknown>, tab, ctx, submitted);

  res.render("deed-polls/edit", {
    ...view,
    caption: found.displayReference,
    errors: errors ?? [],
    errorSummary: errors ? buildErrorSummary(errors, tab) : [],
    en,
    cy
  });
}
