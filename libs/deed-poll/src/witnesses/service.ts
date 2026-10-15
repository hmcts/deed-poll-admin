/**
 * Witnesses, read and written through `deed-poll-api`.
 *
 * **The writes are api's now.** `deed-poll-api#8` (`ee5cc86`, 2026-09-12) added the four witness routes
 * under `/caseworker/cases/{id}/witnesses`, so `createWitness` and `updateWitness` are back — as one-line
 * `callApi` calls rather than the Prisma bodies they had before `5dc0d08`. **Neither is role-gated**, at
 * api's end or here: the business capability matrix gives both roles "Add and edit witnesses". The role
 * split is deletion only, and `deed-poll-api#9` (`051f3b4`, 2026-09-13) added that `DELETE` — so
 * `removeWitness` exists now, and is the one witness operation with a role attached to it.
 *
 * **The reads still come off the case, and that is not an oversight.** api publishes
 * `GET …/witnesses` and `GET …/witnesses/{witnessId}`, but one `GET /caseworker/cases/{id}` already
 * carries the notes, witnesses and documents together, so a page holding the case has its witnesses and a
 * second call would buy nothing. It also keeps the scoping the Prisma version enforced by hand: a witness
 * belonging to another case is not in this case's list, so `findWitness` cannot reach it. The writes have
 * no such shortcut — api answers 404 for a witness id that is not under the case in the path, which is the
 * same guarantee made at the only place that can still make it, so there is no scoping pre-read here.
 *
 * **No author parameter, and for a different reason than notes.** `deedpoll_witness` has no author
 * columns at all, so there is nothing for api to stamp from the token — the `Caller` is carried because
 * every call is authenticated, not because a witness records who touched it.
 */
import { createWitness as apiCreateWitness, updateWitness as apiUpdateWitness, deleteWitness, getCase, type Witness } from "@hmcts/deed-poll-api-client";
import { type Caller, callApi } from "../api/deed-poll-api.js";
import { NotFoundError } from "../errors.js";
import type { CreateWitnessInput, UpdateWitnessInput } from "./schemas.js";

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

/** Add a witness. All four fields are required, so the DTO goes on the wire unchanged. */
export function createWitness(deedPollId: string, dto: CreateWitnessInput, caller: Caller): Promise<Witness> {
  return callApi(caller, (config) => apiCreateWitness(deedPollId, dto, config));
}

/**
 * Amend a witness.
 *
 * `updateWitnessSchema` is a partial, and an absent field is passed through rather than defaulted: api
 * leaves an omitted field as stored, so defaulting one here would overwrite it with a blank.
 */
export function updateWitness(deedPollId: string, id: string, dto: UpdateWitnessInput, caller: Caller): Promise<Witness> {
  return callApi(caller, (config) => apiUpdateWitness(deedPollId, id, dto, config));
}

/**
 * Delete a witness. **DELETE_WITNESS capability required, and api is what says so.**
 *
 * No role check here: api's `WitnessService.removeWitness` requires DELETE_WITNESS before it
 * resolves the witness, and it derives the role from the token this `Caller` carries. Re-checking would
 * assert an identity this app never verified — the flag in the session decides what the page *offers*
 * (`canDeleteWitness`), not what is permitted. A refusal arrives as `ForbiddenError`, a witness that is not
 * under this case as `NotFoundError`, both from `callApi`.
 */
export function removeWitness(deedPollId: string, id: string, caller: Caller): Promise<void> {
  return callApi(caller, (config) => deleteWitness(deedPollId, id, config));
}
