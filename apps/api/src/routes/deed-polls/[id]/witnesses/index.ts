/**
 * Witnesses collection for a case, ported from `witnesses.controller.ts` (`@Get()`).
 *
 * **`GET` only.** `deed-poll-api` publishes no witness write endpoints — task 4 of
 * `docs/plans/02-dal-cutover-to-api.md` records that as deliberate — so the `POST` went with
 * `createWitness` and `createWitnessSchema` rather than being left as a route that could only fail.
 * Nothing consumed it: this app's edit form renders witnesses as a managed list with no editable
 * fields. Restoring the operation is a change in api first.
 */
import { findWitnesses } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../../../auth/current-user.js";

export const GET = async (req: Request, res: Response) => {
  res.json(await findWitnesses(req.params.id, callerFromRequest(req)));
};
