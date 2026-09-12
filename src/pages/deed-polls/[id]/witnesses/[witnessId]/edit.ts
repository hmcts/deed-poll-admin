/**
 * Amend-a-witness form. The same four controls as the create form, for the same reasons — see `../new.ts`,
 * which holds the reasoning this file does not repeat: why a blank field is accepted, why `declarant` is
 * compared to two literals rather than coerced, and why a schema rejection is rendered in this page's words
 * while api's is rendered in api's.
 *
 * `findWitness` is scoped to the parent — it reads the case's own witness list — so a witness id belonging
 * to another case 404s rather than rendering someone else's details under this case's reference.
 *
 * **There is no delete button.** api publishes no `DELETE` for a witness yet, and a control that could only
 * fail is worse than one that is not there. Deletion arrives with the Administrator gate that goes with it;
 * amending is open to both roles, so this form carries no permission check at all.
 *
 * **`createWitnessSchema`, not `updateWitnessSchema`.** The partial exists because api's PATCH leaves an
 * omitted field as stored, but this form posts all four controls on every submission, so validating against
 * the partial would accept a body missing a field the form always sends — the note edit page uses
 * `createNoteSchema` for the same reason.
 */
import { createWitnessSchema, type FieldError, findDeedPoll, findWitness, InvalidInputError, updateWitness, zodErrorToFieldErrors } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../../../../auth/current-user.js";

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
  cancel: "Cancel",
  errorSummaryTitle: "There is a problem",
  fieldErrors: {
    witnessName: `Name must be ${MAX_NAME} characters or fewer`,
    witnessAddress: `Address must be ${MAX_ADDRESS} characters or fewer`,
    witnessOccupation: `Occupation must be ${MAX_OCCUPATION} characters or fewer`,
    declarant: "Select yes if this person is the declarant"
  } as Record<string, string>,
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
    en,
    cy
  });
};

export const POST = async (req: Request, res: Response) => {
  const parsed = createWitnessSchema.safeParse(submitted(req));

  if (!parsed.success) {
    return rerender(req, res, ownMessages(zodErrorToFieldErrors(parsed.error)));
  }

  try {
    // The whole witness, because the form showed the whole witness: every field the caseworker could have
    // changed is sent, so the patch and what is on screen cannot disagree.
    await updateWitness(req.params.id, req.params.witnessId, parsed.data, callerFromRequest(req));
  } catch (error) {
    if (error instanceof InvalidInputError) {
      if (error.errors.length === 0) {
        console.error(`witness save refused with no field named: ${error.message}`);
        return rerender(req, res, {}, en.witnessRefused);
      }
      return rerender(req, res, apiMessages(error.errors));
    }
    throw error;
  }

  res.redirect(`/deed-polls/${req.params.id}#witnesses`);
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

function ownMessages(errors: FieldError[]): Record<string, string> {
  return Object.fromEntries(errors.filter((error) => en.fieldErrors[error.field]).map((error) => [error.field, en.fieldErrors[error.field]]));
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
    en,
    cy
  });
}

function summaryList(errors: Record<string, string>, formError?: string): { text: string; href: string }[] {
  const rows = FIELD_ORDER.filter((field) => errors[field]).map((field) => ({ text: errors[field], href: `#${field}` }));

  return formError ? [{ text: formError, href: "#witnessName" }, ...rows] : rows;
}
