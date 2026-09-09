/**
 * Field show/hide/mandate rules for a Type — the per-type conditional-rule surface, ported from
 * `@Get('field-rules')`.
 *
 * Static, so it must resolve before `[id].ts` or `/deed-polls/field-rules` would match
 * `/deed-polls/:id` and be read as a case id. `sortRoutes` in `@hmcts-cft/simple-router` orders
 * by parameter count first, so this registers ahead of the dynamic route without anything here
 * asking for it — but that is the reason it is safe, not an accident to rely on silently.
 *
 * `getCaseFieldRules` also takes `migrated` and `publishToGazette`. The prototype's endpoint
 * passed neither, and the SSR pages that do need them call the domain function directly rather
 * than going through HTTP (`deed-poll-pages.controller.ts:149,452`), so they stay unexposed.
 *
 * Unlike the prototype, an unrecognised `type` is rejected rather than cast. `@Query('type')`
 * was typed `DeedPollType` but never validated, so `?type=nonsense` — or a repeated parameter,
 * which Express parses as an array — reached the rule matrix and fell through to its default
 * branch, answering 200 with the rules for no type at all. That is a wrong answer presented as
 * a right one.
 */
import { DeedPollType, getCaseFieldRules } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { z } from "zod";
import { callerFromRequest } from "../../auth/current-user.js";

const fieldRulesQuerySchema = z.object({
  type: z.enum(DeedPollType).optional()
});

export const GET = async (req: Request, res: Response) => {
  const parsed = fieldRulesQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw parsed.error;
  }

  res.json(await getCaseFieldRules({ type: parsed.data.type ?? null }, callerFromRequest(req)));
};
