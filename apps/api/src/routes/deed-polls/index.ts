/**
 * Collection routes for DeedPoll cases, ported from the prototype's
 * `deed-poll.controller.ts` (`@Get()` / `@Post()`).
 *
 * Two things the Nest version got from framework configuration and this has to state:
 *
 *  - **Validation.** `main.ts` registered a global `ValidationPipe({ whitelist: true })`, so a
 *    DTO-typed body was validated and stripped of unknown keys before the handler saw it. The
 *    equivalent here is an explicit `safeParse` against the Zod schema — `z.object()` also
 *    strips unknown keys, so `whitelist` carries over. A failed parse throws the `ZodError`,
 *    which `errorHandler()` maps to a 400 carrying per-field errors (see `../../errors.ts`).
 *
 *  - **Status codes.** Nest returns 201 from `@Post()` by default. Express does not, so it is
 *    set here.
 *
 * No role middleware is mounted, matching the prototype: `RolesGuard` was registered globally
 * but no deed-poll handler carried `@Roles(...)`, so every one of these was open. The real
 * privilege check is inside `createDeedPoll`, which takes `isAdmin` and uses it to decide
 * whether the caller may set `privacy`.
 */
import { createDeedPoll, createDeedPollSchema, findDeedPolls } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { userFromRequest } from "../../auth/current-user.js";

export const GET = async (_req: Request, res: Response) => {
  res.json(await findDeedPolls());
};

export const POST = async (req: Request, res: Response) => {
  const parsed = createDeedPollSchema.safeParse(req.body);
  if (!parsed.success) {
    throw parsed.error;
  }

  // Admin status drives the create-time privacy auto-default (ported from
  // deedpoll_javascript's admin branch in FormPresentationService); the name is audit text
  // only, recorded as createdBy/modifiedBy.
  const { isAdmin, name } = userFromRequest(req);
  const created = await createDeedPoll(parsed.data, { isAdmin, userName: name });

  res.status(201).json(created);
};
