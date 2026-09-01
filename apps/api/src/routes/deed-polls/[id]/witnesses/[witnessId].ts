/**
 * A single witness, ported from `witnesses.controller.ts` (`@Get(':id')` / `@Patch(':id')` /
 * `@Delete(':id')`).
 *
 * Both ids are passed on every call for the same reason as notes: `findWitness` matches on
 * `{ id, deedPollId }`, so a witness belonging to another case is a 404 rather than reachable
 * through the wrong parent's URL.
 */
import { findWitness, removeWitness, updateWitness, updateWitnessSchema } from "@hmcts/deed-poll";
import type { Request, Response } from "express";

export const GET = async (req: Request, res: Response) => {
  res.json(await findWitness(req.params.id, req.params.witnessId));
};

export const PATCH = async (req: Request, res: Response) => {
  const parsed = updateWitnessSchema.safeParse(req.body);
  if (!parsed.success) {
    throw parsed.error;
  }

  res.json(await updateWitness(req.params.id, req.params.witnessId, parsed.data));
};

export const DELETE = async (req: Request, res: Response) => {
  await removeWitness(req.params.id, req.params.witnessId);

  res.status(204).send();
};
