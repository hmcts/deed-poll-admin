/**
 * Validate a case for submission, ported from `@Post(':id/validate')` with `@HttpCode(200)`.
 *
 * A POST that creates nothing, which is deliberate and inherited: the check is the point at
 * which the source form's per-type required-levels must all be satisfied, and it is kept out of
 * `updateDeedPoll` so incremental saves stay unblocked.
 *
 * There is no body to validate — the case being checked is whatever is already persisted. The
 * outcome is carried by the status: 200 with the record when it is submittable, and 400 with the
 * collected violations when it is not, because `validateCaseForSubmit` throws
 * `InvalidInputError` whose `FieldError[]` the error handler surfaces. Phase 4's forms render
 * those against individual inputs, so they must stay attributed to fields rather than collapse
 * into one message.
 */
import { validateCaseForSubmit } from "@hmcts/deed-poll";
import type { Request, Response } from "express";

export const POST = async (req: Request, res: Response) => {
  res.json(await validateCaseForSubmit(req.params.id));
};
