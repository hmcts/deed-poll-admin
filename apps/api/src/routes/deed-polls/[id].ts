/**
 * Single-case routes, ported from the prototype's `@Get(':id')` / `@Patch(':id')`.
 *
 * Neither checks for a missing record: `findDeedPoll` and `updateDeedPoll` both throw `NotFoundError`,
 * which `errorHandler()` maps to a 404. That is why there is no `if (!found)` branch here, unlike the
 * template's `routes/onboarding/[id].ts` — absence is reported by throwing, so a handler that tested
 * for it would be dead code.
 *
 * **There is no `DELETE` any more.** `deed-poll-api` has no case-delete endpoint, deliberately:
 * `.business_context/DEED_POLL_API_PLAN.md` records the deletes as not rebuilt until something asks
 * for them, and nothing does — no page in `apps/web` offers one. It went with the data access layer in
 * task 3 of `docs/plans/02-dal-cutover-to-api.md` rather than being left as a route that could only
 * fail, and the admin-only guard Steve added on 2026-09-03 goes with it. Restoring the operation is a
 * change in api first.
 */
import { findDeedPoll, updateDeedPoll, updateDeedPollSchema } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../auth/current-user.js";

export const GET = async (req: Request, res: Response) => {
  res.json(await findDeedPoll(req.params.id, callerFromRequest(req)));
};

export const PATCH = async (req: Request, res: Response) => {
  const parsed = updateDeedPollSchema.safeParse(req.body);
  if (!parsed.success) {
    throw parsed.error;
  }

  // api decides whether a `privacy` value in this patch is honoured or silently dropped, from the
  // caller's own token — the template's `disabled` attribute on the control is not the control.
  res.json(await updateDeedPoll(req.params.id, parsed.data, callerFromRequest(req)));
};
