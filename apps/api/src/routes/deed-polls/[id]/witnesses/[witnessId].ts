/**
 * A single witness, ported from `witnesses.controller.ts` (`@Get(':id')`).
 *
 * **`GET` only**, for the reason given in `index.ts`: api has no witness writes, so the `PATCH` and the
 * admin-only `DELETE` went with `updateWitness` and `removeWitness`.
 *
 * Both ids are still passed. `findWitness` looks only in this case's own witness list — the case is
 * where api publishes them — so a witness belonging to another case is a 404 rather than reachable
 * through the wrong parent's URL.
 */
import { findWitness } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../../../auth/current-user.js";

export const GET = async (req: Request, res: Response) => {
  res.json(await findWitness(req.params.id, req.params.witnessId, callerFromRequest(req)));
};
