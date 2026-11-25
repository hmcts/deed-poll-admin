/**
 * A deletion request's progress, gated on `DELETE_APPLICATION` with the rest of `/deed-polls/deletions` in `app.ts`.
 * Reads only the request, so it answers after the application is gone. See `src/application-deletion/status-page.ts`.
 */
import type { Request, Response } from "express";
import { renderDeletionStatus } from "../../../application-deletion/status-page.js";

export const GET = (req: Request, res: Response) => renderDeletionStatus(req, res, req.params.requestId);
