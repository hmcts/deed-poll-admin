/**
 * Witnesses, read through `deed-poll-api`. **Read-only, and deliberately so.**
 *
 * api has no witness write endpoints — task 4 of `docs/plans/02-dal-cutover-to-api.md` records that as
 * a decision rather than a gap, and `DEED_POLL_API_PLAN.md` lists witness writes among the operations
 * not rebuilt until something asks. Nothing asks: this app's edit form renders witnesses as a managed
 * list with zero editable fields, and its detail page reads them off the case. So `createWitness`,
 * `updateWitness` and `removeWitness` are gone, along with `witnesses/schemas.ts`, rather than being
 * left as functions that could only fail. Restoring any of them is a change in api first.
 *
 * They arrive **inside the case**, which is why there is no witness endpoint to call: one
 * `GET /caseworker/cases/{id}` carries the notes, witnesses and documents together. That also keeps the
 * scoping the Prisma version enforced by hand — a witness belonging to another case is not in this
 * case's list, so `findWitness` cannot reach it.
 */
import { getCase, type Witness } from "@hmcts/deed-poll-api-client";
import { type Caller, callApi } from "../api/deed-poll-api.js";
import { NotFoundError } from "../errors.js";

/** Witnesses for a case. A missing case is api's 404, so this never answers `[]` for one. */
export async function findWitnesses(deedPollId: string, caller: Caller): Promise<Witness[]> {
  const found = await callApi(caller, (config) => getCase(deedPollId, config));

  return found.witnesses;
}

export async function findWitness(deedPollId: string, id: string, caller: Caller): Promise<Witness> {
  const witnesses = await findWitnesses(deedPollId, caller);
  const witness = witnesses.find((candidate) => candidate.id === id);
  if (!witness) throw new NotFoundError(`Witness ${id} not found`);

  return witness;
}
