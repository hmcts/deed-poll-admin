/**
 * Amend-a-witness form. The same four controls as the create form, for the same reasons — see `../new.ts`,
 * which holds the reasoning this file does not repeat: why a blank field is refused, why `declarant` is
 * compared to two literals rather than coerced, and why a schema rejection is rendered in this page's words
 * while api's is rendered in api's.
 *
 * `findWitness` is scoped to the parent — it reads the case's own witness list — so a witness id belonging
 * to another case 404s rather than rendering someone else's details under this case's reference.
 *
 * **Delete is a second submit button on the same form**, not its own route, and the handler branches on
 * `action` with **delete checked first** — the same shape as the note amend form, whose docblock holds the
 * reasoning. An over-long name cannot block a deletion, and only the literal `"delete"` takes that path, so
 * a missing `action` falls through to save and is never destructive.
 *
 * There is no confirmation step, following the note delete rather than inventing a second voice for the same
 * act: the button is styled as a warning so it cannot be mistaken for the primary action, and its label says
 * what it does. api removes the row and there is no recovery.
 *
 * **Only an Administrator is offered the delete button** — `canDeleteWitness`, whose docblock holds the
 * reasoning. Amending stays open to both roles, so the flag gates that one button and not the form. It is
 * read in `GET` **and** in `rerender`: a flag set only on the first render puts the button back the moment a
 * validation error re-renders the form, which is the path a caseworker reaches with an over-long field.
 *
 * The `action === "delete"` branch is deliberately ungated. api enforces the rule and refuses a forged POST;
 * a local refusal as well would put the authority in two places.
 *
 * **`createWitnessSchema`, not `updateWitnessSchema`.** The partial exists because api's PATCH leaves an
 * omitted field as stored, but this form posts all four controls on every submission, so validating against
 * the partial would accept a body missing a field the form always sends — the note edit page uses
 * `createNoteSchema` for the same reason.
 */
import {
  canDeleteWitness,
  createWitnessSchema,
  type FieldError,
  findDeedPoll,
  findWitness,
  InvalidInputError,
  removeWitness,
  updateWitness
} from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest, userFromRequest } from "../../../../../auth/current-user.js";
import { casePath } from "../../../../../case-path.js";
import { forLog } from "../../../../../for-log.js";

const FIELD_ORDER = ["witnessName", "witnessAddress", "witnessOccupation", "declarant"];

// Read off the schema rather than restated — see the same three in `../new.ts`.
const MAX_NAME = createWitnessSchema.shape.witnessName.maxLength;
const MAX_ADDRESS = createWitnessSchema.shape.witnessAddress.maxLength;
const MAX_OCCUPATION = createWitnessSchema.shape.witnessOccupation.maxLength;

const en = {
  title: "Amend witness",
  heading: "Amend witness",
  nameLabel: "Name",
  addressLabel: "Address",
  occupationLabel: "Occupation",
  declarantLabel: "Is this person the declarant?",
  yes: "Yes",
  no: "No",
  submit: "Save witness",
  delete: "Delete witness",
  cancel: "Cancel",
  errorSummaryTitle: "There is a problem",
  fieldErrors: {
    witnessName: `Name must be ${MAX_NAME} characters or fewer`,
    witnessAddress: `Address must be ${MAX_ADDRESS} characters or fewer`,
    witnessOccupation: `Occupation must be ${MAX_OCCUPATION} characters or fewer`,
    declarant: "Select yes if this person is the declarant"
  } as Record<string, string>,
  // No `as` cast here: the Welsh extractor reads only a bare object literal, and a cast one is silently skipped.
  blankErrors: {
    witnessName: "Enter the witness's name",
    witnessAddress: "Enter the witness's address",
    witnessOccupation: "Enter the witness's occupation"
  },
  witnessRefused: "The witness could not be saved. Check the details and try again."
};

// English content in the cy shape — see the note in ../../../index.ts.
const cy = { ...en };

export const GET = async (req: Request, res: Response) => {
  const caller = callerFromRequest(req);
  const [found, witness] = await Promise.all([findDeedPoll(req.params.id, caller), findWitness(req.params.id, req.params.witnessId, caller)]);

  res.render("deed-polls/witness-edit", {
    case: found,
    witnessId: witness.id,
    // The stored witness, as the radio and the inputs want it: `declarant` becomes the string the control
    // posts, so one comparison serves the first render and every re-render after it.
    values: {
      witnessName: witness.witnessName,
      witnessAddress: witness.witnessAddress,
      witnessOccupation: witness.witnessOccupation,
      declarant: witness.declarant ? "true" : "false"
    },
    errors: {},
    errorList: [],
    canDelete: canDeleteWitness(userFromRequest(req)),
    en,
    cy
  });
};

export const POST = async (req: Request, res: Response) => {
  // Before the write, so an id that cannot be redirected to is refused rather than saved or deleted and then refused.
  const caseHref = casePath(req.params.id);
  // First, so a field that would fail validation cannot block a deletion.
  if ((req.body as { action?: unknown } | undefined)?.action === "delete") {
    await removeWitness(req.params.id, req.params.witnessId, callerFromRequest(req));
    return res.redirect(`${caseHref}#witnesses`);
  }

  const parsed = createWitnessSchema.safeParse(submitted(req));

  if (!parsed.success) {
    return rerender(req, res, ownMessages(parsed.error.issues));
  }

  try {
    // The whole witness, because the form showed the whole witness: every field the caseworker could have
    // changed is sent, so the patch and what is on screen cannot disagree.
    await updateWitness(req.params.id, req.params.witnessId, parsed.data, callerFromRequest(req));
  } catch (error) {
    if (error instanceof InvalidInputError) {
      if (error.errors.length === 0) {
        console.error(`witness save refused with no field named: ${forLog(error.message)}`);
        return rerender(req, res, {}, en.witnessRefused);
      }
      return rerender(req, res, apiMessages(error.errors));
    }
    throw error;
  }

  res.redirect(`${caseHref}#witnesses`);
};

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

function ownMessages(issues: readonly SchemaIssue[]): Record<string, string> {
  const blankErrors: Readonly<Record<string, string | undefined>> = en.blankErrors;
  return Object.fromEntries(
    issues.flatMap((issue) => {
      const field = String(issue.path[0] ?? "");
      const message = issue.code === "too_big" ? en.fieldErrors[field] : (blankErrors[field] ?? en.fieldErrors[field]);
      return message ? [[field, message]] : [];
    })
  );
}

function apiMessages(errors: FieldError[]): Record<string, string> {
  return Object.fromEntries(errors.map((error) => [error.field, error.message]));
}

async function rerender(req: Request, res: Response, errors: Record<string, string>, formError?: string) {
  const caller = callerFromRequest(req);
  // The witness is re-read for the id in the form's action and to keep the 404 for another case's witness on
  // the failed-validation path too — a re-render is its own request, and a scoping guarantee that only holds
  // on `GET` is not one.
  const [found, witness] = await Promise.all([findDeedPoll(req.params.id, caller), findWitness(req.params.id, req.params.witnessId, caller)]);

  res.status(400).render("deed-polls/witness-edit", {
    case: found,
    witnessId: witness.id,
    // The submitted values, not the stored ones: what was typed is still there to be corrected.
    values: (req.body ?? {}) as Record<string, unknown>,
    errors,
    errorList: summaryList(errors, formError),
    // Re-read here, not carried from `GET`: a re-render is its own request, and omitting it would put the
    // button back on the failed-validation path.
    canDelete: canDeleteWitness(userFromRequest(req)),
    en,
    cy
  });
}

function summaryList(errors: Record<string, string>, formError?: string): { text: string; href: string }[] {
  const rows = FIELD_ORDER.filter((field) => errors[field]).map((field) => ({ text: errors[field], href: `#${field}` }));

  return formError ? [{ text: formError, href: "#witnessName" }, ...rows] : rows;
}

interface SchemaIssue {
  code: string;
  path: readonly PropertyKey[];
}
