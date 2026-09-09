/**
 * The new-case form, ported from the prototype's `@Get('new')` / `@Post('new')`.
 *
 * Static, so it must resolve before `[id].ts` or `/deed-polls/new` would be read as a case id.
 * `sortRoutes` orders by parameter count, so it does — the same mechanism that saves
 * `field-rules` in the API, and pinned by a wiring test for the same reason.
 *
 * The form asks for four things, not the whole case: a case is logged incrementally, and the rest
 * is filled in through the edit tabs. `dateReceived` is the one that cannot be deferred, because api
 * derives the reference number's year from it — a create without it comes back as a 400 attributed to
 * that field, which is why the field is on this form at all rather than left to the Application tab.
 */
import { composeDateParts, createDeedPoll, createDeedPollSchema, DEED_POLL_TYPE_LABEL, InvalidInputError } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../auth/current-user.js";

const en = {
  title: "New deed poll case",
  heading: "New deed poll case",
  typeLabel: "Application type",
  typeEmpty: "Choose a type",
  forenameLabel: "New forename",
  surnameLabel: "New surname",
  dateReceivedLabel: "Date received",
  dateReceivedHint: "For example, 27 3 2026",
  submit: "Create case",
  errorSummaryTitle: "There is a problem"
};

// English content in the cy shape — see the note in index.ts.
const cy = { ...en };

const typeOptions = [{ value: "", text: en.typeEmpty }, ...Object.entries(DEED_POLL_TYPE_LABEL).map(([value, text]) => ({ value, text }))];

export const GET = async (_req: Request, res: Response) => {
  res.render("deed-polls/new", { values: {}, typeOptions, en, cy });
};

export const POST = async (req: Request, res: Response) => {
  const body = req.body as Record<string, string>;

  // Only the four fields the form offers are read. Building from the body wholesale would let a
  // hand-crafted POST set anything on the schema, including `state`, which is derived not supplied.
  const parsed = createDeedPollSchema.safeParse({
    type: body.type || undefined,
    newForename: body.newForename || undefined,
    newSurname: body.newSurname || undefined,
    dateReceived: composeDateParts(body["dateReceived-day"], body["dateReceived-month"], body["dateReceived-year"]) ?? undefined
  });

  if (!parsed.success) {
    // String() because a Zod issue path may contain a symbol, which template-interpolating would
    // throw on at runtime rather than at the type level.
    return rerender(
      req,
      res,
      parsed.error.issues.map((issue) => ({ text: issue.message, href: `#${String(issue.path[0] ?? "")}` }))
    );
  }

  try {
    // The caller's own token, not this app's. api attributes the case and decides the create-time
    // privacy default from it, so a page that sent a service credential would create every case as the
    // service account — which is what this page did until Phase 5 made identity real.
    const created = await createDeedPoll(parsed.data, callerFromRequest(req));
    return res.redirect(`/deed-polls/${created.id}`);
  } catch (error) {
    // A missing or unusable Date Received surfaces here rather than from the schema, because the
    // schema accepts a case with no dates at all — it is api's reference-number allocation that
    // cannot proceed. Re-rendered with the error rather than 500ing at a browser.
    if (error instanceof InvalidInputError) {
      // A rejection that names no field still has to say something. `fieldErrors` is legitimately empty
      // when api answers 400 without an `errors` array, or when the failure body was not api's at all —
      // a proxy's HTML — and the template hides an empty summary, so the caseworker would get their form
      // back with no indication anything failed. The message stands in for the missing field errors, with
      // no `href` because there is no input to link to.
      return rerender(req, res, summaryFor(error));
    }
    throw error;
  }
};

/**
 * Re-render with the submitted values, not an empty form.
 *
 * A redirect would be the usual answer to a failed POST, but it would discard everything typed, and
 * these errors are per-field so they need to render against their inputs — which a query string
 * cannot express. The same reasoning the prototype applied to its edit form, applied here too.
 */
function rerender(req: Request, res: Response, errorSummary: { text: string; href?: string }[]) {
  res.status(400).render("deed-polls/new", { values: req.body, typeOptions, errorSummary, en, cy });
}

function summaryFor(error: InvalidInputError): { text: string; href?: string }[] {
  if (error.errors.length === 0) return [{ text: error.message }];

  return error.errors.map((fieldError) => ({ text: fieldError.message, href: `#${fieldError.field}` }));
}
