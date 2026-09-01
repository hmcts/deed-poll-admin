/**
 * Single-case routes, ported from the prototype's `@Get(':id')` / `@Patch(':id')` /
 * `@Delete(':id')`.
 *
 * None of these checks for a missing record: `findDeedPoll`, `updateDeedPoll` and
 * `removeDeedPoll` all throw `NotFoundError`, which `errorHandler()` maps to a 404. That is why
 * there is no `if (!found)` branch here, unlike the template's `routes/onboarding/[id].ts` —
 * the domain reports absence by throwing, so a handler that tested for it would be dead code.
 */
import { findDeedPoll, removeDeedPoll, updateDeedPoll, updateDeedPollSchema } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { userFromRequest } from "../../auth/current-user.js";

export const GET = async (req: Request, res: Response) => {
  res.json(await findDeedPoll(req.params.id));
};

export const PATCH = async (req: Request, res: Response) => {
  const parsed = updateDeedPollSchema.safeParse(req.body);
  if (!parsed.success) {
    throw parsed.error;
  }

  // `isAdmin` decides whether a `privacy` value in this patch is honoured or silently dropped
  // (see applyPrivacyAuthorisation in the domain service) — the template's `disabled` attribute
  // on the control is not the control.
  const { isAdmin, name } = userFromRequest(req);

  res.json(await updateDeedPoll(req.params.id, parsed.data, { isAdmin, userName: name }));
};

export const DELETE = async (req: Request, res: Response) => {
  await removeDeedPoll(req.params.id);

  // 204, as the prototype's @HttpCode(204) declared. `send()` rather than `json()`: a 204 must
  // carry no body, and Express strips one, so calling json() here would only look like it did.
  res.status(204).send();
};
