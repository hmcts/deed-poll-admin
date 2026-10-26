/**
 * The viewer shell both scopes render: one template, one model, built from a context the route has already read.
 *
 * **The shell fetches no document.** It carries the preview's URL for the renderer to ask for, but nothing here or
 * in the template requests, preloads or embeds a preview or an original: api audits each fetch
 * (`DOCUMENT_PREVIEWED`, `DOCUMENT_DOWNLOADED`), so a shell that fetched one would record a reading nobody did.
 *
 * **The selector works without JavaScript.** It is a GET form back to the current view, naming a document in
 * `document`; the answer is a redirect to that document's own view, and only to one in the context just read. A
 * value that is not one of them (a forged id, a repeated or bracketed parameter) is refused with the same fixed
 * `NotFoundError` as an unknown selection, never substituted.
 */
import { DOCUMENT_PREVIEW_LIMITS, type DocumentViewerContext, documentInContext, NotFoundError } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { cy, en } from "./content.js";
import { documentPaths, type ViewerScope, viewerLinks } from "./context.js";

const SELECTION_PARAMETER = "document";
// The same fixed refusal `documentInContext` gives an unknown id, for a value that is not one id at all.
const NOT_IN_CONTEXT = "The selected document is not one of this context's documents";

export function showViewer(req: Request, res: Response, scope: ViewerScope, context: DocumentViewerContext): void {
  const selection = req.query[SELECTION_PARAMETER];
  if (selection !== undefined) {
    res.redirect(303, selectedViewPath(scope, context, selection));
    return;
  }

  const content = res.locals.locale === "cy" ? cy : en;
  const links = viewerLinks(scope, context);

  res.render("document-viewer", {
    en,
    cy,
    title: context.current.name,
    scope: context.scope,
    caseReference: context.caseReference,
    viewer: links,
    // Each document's own position and format, so the renderer can switch documents in place with the same words.
    documents: links.documents.map((document, index) => ({
      ...document,
      positionText: content.documentPosition(index + 1, context.total),
      formatText: document.format ? content.formats[document.format] : ""
    })),
    selectionParameter: SELECTION_PARAMETER,
    previewLimits: { maxPages: DOCUMENT_PREVIEW_LIMITS.maxPages, maxBytes: DOCUMENT_PREVIEW_LIMITS.maxOutputBytes },
    positionText: content.documentPosition(context.position, context.total),
    formatText: context.current.format ? content.formats[context.current.format] : null,
    backText: context.scope === "judicial" ? content.backToReferral : content.backToCase
  });
}

function selectedViewPath(scope: ViewerScope, context: DocumentViewerContext, selection: unknown): string {
  if (typeof selection !== "string") throw new NotFoundError(NOT_IN_CONTEXT);

  return documentPaths(scope, documentInContext(context, selection).id).viewPath;
}
