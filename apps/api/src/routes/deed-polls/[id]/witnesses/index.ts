/**
 * Witnesses collection for a case, ported from `witnesses.controller.ts` (`@Get()` / `@Post()`).
 *
 * No user context at all, unlike notes: `DeedPollWitness` has no `createdBy`/`modifiedBy` columns,
 * so there is nothing to attribute and `createWitness` takes no author argument. The prototype's
 * controller likewise never injected `@User()`.
 *
 * Note that `createWitnessSchema` requires all four fields — witnesses are not logged
 * incrementally the way a case is, so an empty body is a 400 here where it is a 201 on
 * `/deed-polls`.
 */
import { createWitness, createWitnessSchema, findWitnesses } from "@hmcts/deed-poll";
import type { Request, Response } from "express";

export const GET = async (req: Request, res: Response) => {
  res.json(await findWitnesses(req.params.id));
};

export const POST = async (req: Request, res: Response) => {
  const parsed = createWitnessSchema.safeParse(req.body);
  if (!parsed.success) {
    throw parsed.error;
  }

  res.status(201).json(await createWitness(req.params.id, parsed.data));
};
