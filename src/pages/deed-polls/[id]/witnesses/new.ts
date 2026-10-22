/**
 * Add-a-witness form. New work: no witness page has ever existed, so this is the note forms' shape
 * applied to the four `deedpoll_witness` fields rather than a port of anything.
 *
 * Static, so it resolves before `[witnessId]/edit.ts` — `sortRoutes` orders by parameter count and this
 * has one fewer.
 *
 * **No permission check, deliberately.** The business capability matrix gives both roles "Add and edit
 * witnesses", and api gates neither write. The role split is deletion only, which is why there is no
 * delete button on the amend form either — there is no `DELETE` to call yet.
 *
 * **Validation re-renders rather than redirecting with `?error=`**, as both note forms do: an address of
 * up to 250 characters is the field most expensive to lose, and it is also the one most likely to trip the
 * limit.
 *
 * **A blank field is refused** (review finding R15). `createWitnessSchema` trims each text field and requires
 * something to be left, because a blank witness counted towards the enrolment-witness threshold. That is
 * stricter than api, which still accepts `""`; the rule lives in the domain schema, not in this handler. A
 * blank, whitespace-only or absent field gets `blankErrors`, a too-long one `fieldErrors`.
 */
import { createWitness, createWitnessSchema, type FieldError, findDeedPoll, InvalidInputError } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../../../auth/current-user.js";
import { casePath } from "../../../../case-path.js";
import { forLog } from "../../../../for-log.js";

// Read off the schema rather than restated, so the message and the rule it explains cannot drift: the
// caps are api's, and a hint naming 100 while the schema rejects at 250 is worse than no hint.
const FIELD_ORDER = ["witnessName", "witnessAddress", "witnessOccupation", "declarant"];

const MAX_NAME = createWitnessSchema.shape.witnessName.maxLength;
const MAX_ADDRESS = createWitnessSchema.shape.witnessAddress.maxLength;
const MAX_OCCUPATION = createWitnessSchema.shape.witnessOccupation.maxLength;

const en = {
  title: "Add a witness",
  heading: "Add a witness",
  nameLabel: "Name",
  addressLabel: "Address",
  occupationLabel: "Occupation",
  declarantLabel: "Is this person the declarant?",
  yes: "Yes",
  no: "No",
  submit: "Add witness",
  cancel: "Cancel",
  errorSummaryTitle: "There is a problem",
  // The page's own copy for a schema rejection. Zod's messages are developer-facing ("Too big: expected
  // string to have <=100 characters"), so the wording belongs here rather than in the domain schema.
  fieldErrors: {
    witnessName: `Name must be ${MAX_NAME} characters or fewer`,
    witnessAddress: `Address must be ${MAX_ADDRESS} characters or fewer`,
    witnessOccupation: `Occupation must be ${MAX_OCCUPATION} characters or fewer`,
    declarant: "Select yes if this person is the declarant"
  } as Record<string, string>,
  blankErrors: {
    witnessName: "Enter the witness's name",
    witnessAddress: "Enter the witness's address",
    witnessOccupation: "Enter the witness's occupation"
  } as Record<string, string>,
  witnessRefused: "The witness could not be saved. Check the details and try again."
};

// English content in the cy shape — see the note in ../../index.ts.
const cy = { ...en };

export const GET = async (req: Request, res: Response) => {
  await render(req, res, {}, {});
};

export const POST = async (req: Request, res: Response) => {
  // Before the write, so an id that cannot be redirected to is refused rather than stored and then refused.
  const caseHref = casePath(req.params.id);
  const parsed = createWitnessSchema.safeParse(submitted(req));

  if (!parsed.success) {
    return rerender(req, res, ownMessages(parsed.error.issues));
  }

  try {
    // The caller's token and nothing else. `deedpoll_witness` records no author at all, so there is not
    // even a name for api to stamp — the token is carried because every call is authenticated.
    await createWitness(req.params.id, parsed.data, callerFromRequest(req));
  } catch (error) {
    // api applies its own rules and this form does not mirror all of them, so a rejection it has no local
    // equivalent for still has to reach the fields rather than the 500 page — `domainErrorHandler` passes
    // `InvalidInputError` on, on the grounds that a page which validates has caught it. api's field names
    // are the wire names, which are this form's field names, so its errors land on the right controls.
    if (error instanceof InvalidInputError) {
      // A rejection naming no field is api's alone — every local rejection attributes itself — and its
      // wording is written for whoever reads api's logs. A gateway answering 400 with an HTML body leaves
      // the adapter with nothing but `deed-poll-api answered 400`, so it is logged and this page's copy is
      // shown, the same split as the note forms.
      if (error.errors.length === 0) {
        console.error(`witness create refused with no field named: ${forLog(error.message)}`);
        return rerender(req, res, {}, en.witnessRefused);
      }
      return rerender(req, res, apiMessages(error.errors));
    }
    throw error;
  }

  res.redirect(`${caseHref}#witnesses`);
};

/**
 * The submitted body as the schema's shape.
 *
 * `declarant` is compared to the two literals rather than coerced: the radio's "no" posts the string
 * `"false"`, which is truthy, so `Boolean(body.declarant)` would silently make every witness a declarant.
 * Anything else — including no selection — stays `undefined` so the schema rejects it and the error lands
 * on the radios instead of a default being invented for a question nobody answered.
 */
function submitted(req: Request): Record<string, unknown> {
  const body = (req.body ?? {}) as Record<string, unknown>;

  return {
    witnessName: body.witnessName,
    witnessAddress: body.witnessAddress,
    witnessOccupation: body.witnessOccupation,
    declarant: declarantFrom(body.declarant)
  };
}

function declarantFrom(value: unknown): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;

  return undefined;
}

/**
 * Schema rejections, rendered in this page's words and keyed by the control they belong against. Only a
 * too-long text field gets the length message: blank, whitespace-only and absent all read as not entered.
 */
function ownMessages(issues: readonly SchemaIssue[]): Record<string, string> {
  return Object.fromEntries(
    issues
      .map((issue) => [String(issue.path[0] ?? ""), issue] as const)
      .flatMap(([field, issue]) => {
        const message = issue.code === "too_big" ? en.fieldErrors[field] : (en.blankErrors[field] ?? en.fieldErrors[field]);
        return message ? [[field, message]] : [];
      })
  );
}

/** api's rejections, rendered in api's words: it applies rules this form has no local copy of. */
function apiMessages(errors: FieldError[]): Record<string, string> {
  return Object.fromEntries(errors.map((error) => [error.field, error.message]));
}

async function rerender(req: Request, res: Response, errors: Record<string, string>, formError?: string) {
  res.status(400);
  // The submitted values, not blanks: the point of re-rendering is that what was typed is still there to
  // be corrected.
  await render(req, res, (req.body ?? {}) as Record<string, unknown>, errors, formError);
}

async function render(req: Request, res: Response, values: Record<string, unknown>, errors: Record<string, string>, formError?: string) {
  const found = await findDeedPoll(req.params.id, callerFromRequest(req));

  res.render("deed-polls/witness-form", {
    case: found,
    values,
    errors,
    // The summary lists every error, in the order the controls appear, so a form failing two fields costs
    // one submission rather than two.
    errorList: summaryList(errors, formError),
    en,
    cy
  });
}

/** Error-summary rows, ordered by the controls rather than by whatever order the errors arrived in. */
function summaryList(errors: Record<string, string>, formError?: string): { text: string; href: string }[] {
  const rows = FIELD_ORDER.filter((field) => errors[field]).map((field) => ({ text: errors[field], href: `#${field}` }));

  return formError ? [{ text: formError, href: "#witnessName" }, ...rows] : rows;
}

interface SchemaIssue {
  code: string;
  path: readonly PropertyKey[];
}
