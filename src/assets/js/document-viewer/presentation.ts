/**
 * How the reader has chosen to see one document: which page, how large, which way up. Kept apart from the DOM so
 * every rule the controls obey can be tested exactly, and so a value that arrives from a URL fragment or a history
 * entry is validated in one place before the viewer trusts it.
 *
 * **Presentation only.** Nothing here touches the preview's bytes, and nothing it records names a document or holds
 * its content: a fragment carries a page, a zoom and a rotation, and a history entry adds the document's id, which
 * is already in the URL. Each tab's history is its own, so two tabs on one case never share a reader's place.
 */

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 3;

/** One press of zoom in or out moves to the next whole ten per cent, as the approved design does. */
const ZOOM_STEP_PERCENT = 10;

const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270];

export const DEFAULT_PRESENTATION: Presentation = { page: 1, zoom: { mode: "width" }, rotation: 0 };

/** The page a preview of `numPages` pages can show: a remembered page past the end becomes the last one. */
export function clampPresentation(presentation: Presentation, numPages: number): Presentation {
  const last = Math.max(1, Math.floor(numPages));
  const page = Math.min(Math.max(1, presentation.page), last);

  return page === presentation.page ? presentation : { ...presentation, page };
}

/** A typed page number, accepted only as whole digits naming a page the preview has; anything else is `null`. */
export function parsePageNumber(text: string, numPages: number): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,6}$/.test(trimmed)) return null;
  const page = Number(trimmed);

  return page >= 1 && page <= numPages ? page : null;
}

export function canGoToPage(page: number, numPages: number): boolean {
  return Number.isInteger(page) && page >= 1 && page <= numPages;
}

/**
 * The scale a page of this (already rotated) size is drawn at in a frame of this size. Both fits share a chosen
 * zoom's 300% ceiling, so a tiny image is not blown up to fill a wide screen, but not its 25% floor: a fit that
 * stopped there would leave a page over four times the frame (a large scan or photo) partly off screen. Zoom out
 * is simply unavailable below the floor, and zoom in steps up from wherever the fit landed.
 */
export function effectiveScale(zoom: Zoom, page: Size, frame: Size): number {
  if (zoom.mode === "custom") return clampZoom(zoom.scale);
  if (page.width <= 0 || page.height <= 0 || frame.width <= 0) return 1;

  const toWidth = frame.width / page.width;
  if (zoom.mode === "width" || frame.height <= 0) return Math.min(MAX_ZOOM, toWidth);

  return Math.min(MAX_ZOOM, toWidth, frame.height / page.height);
}

/** The zoom after one press of zoom in (`1`) or out (`-1`) from the scale the page is shown at now. */
export function stepZoom(currentScale: number, direction: 1 | -1): Zoom {
  const percent = Math.round(currentScale * 100);
  const tens = direction > 0 ? Math.floor(percent / ZOOM_STEP_PERCENT) + 1 : Math.ceil(percent / ZOOM_STEP_PERCENT) - 1;

  return { mode: "custom", scale: clampZoom((tens * ZOOM_STEP_PERCENT) / 100) };
}

export function canZoom(currentScale: number, direction: 1 | -1): boolean {
  const percent = Math.round(currentScale * 100);

  return direction > 0 ? percent < MAX_ZOOM * 100 : percent > MIN_ZOOM * 100;
}

export function zoomPercent(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

export function rotateClockwise(rotation: Rotation): Rotation {
  return ROTATIONS[(ROTATIONS.indexOf(rotation) + 1) % ROTATIONS.length];
}

/** `#page=2&zoom=width&rotate=90`: the reader's place in the open document, for a reload or a bookmark. */
export function presentationFragment(presentation: Presentation): string {
  const zoom = presentation.zoom.mode === "custom" ? String(Math.round(presentation.zoom.scale * 100)) : presentation.zoom.mode;

  return `#page=${presentation.page}&zoom=${zoom}&rotate=${presentation.rotation}`;
}

/**
 * The fragment's presentation, or `null` unless it is exactly the shape {@link presentationFragment} writes. A
 * fragment is the reader's to edit, so a page past the end is only clamped later, once the preview's real page count
 * is known, and anything else (another key, a repeated one, a zoom outside the range) is ignored whole.
 */
export function presentationFromFragment(hash: string): Presentation | null {
  const match = /^#page=(\d{1,6})&zoom=(width|page|\d{2,3})&rotate=(0|90|180|270)$/.exec(hash);
  if (!match) return null;

  const page = Number(match[1]);
  if (page < 1) return null;
  const zoom = zoomFrom(match[2]);
  if (!zoom) return null;

  return { page, zoom, rotation: Number(match[3]) as Rotation };
}

/** Every document's presentation this visit, read back from a history entry and validated entry by entry. */
export function presentationsFromHistory(state: unknown): Map<string, Presentation> {
  const remembered = new Map<string, Presentation>();
  const entries = (state as { documentViewer?: unknown } | null)?.documentViewer;
  if (!Array.isArray(entries)) return remembered;

  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || typeof entry[1] !== "string") continue;
    const presentation = presentationFromFragment(entry[1]);
    if (presentation) remembered.set(entry[0], presentation);
  }

  return remembered;
}

/** The history entry's state: each document's id and fragment, and nothing else about it. */
export function presentationsForHistory(presentations: ReadonlyMap<string, Presentation>): HistoryState {
  return { documentViewer: [...presentations].map(([id, presentation]) => [id, presentationFragment(presentation)]) };
}

/** The documents either side of the current one, in the context's order, for the previous/next controls. */
export function neighbours<T extends { id: string }>(documents: readonly T[], currentId: string): Neighbours<T> {
  const index = documents.findIndex((document) => document.id === currentId);
  if (index < 0) return { previous: null, next: null };

  return { previous: documents[index - 1] ?? null, next: documents[index + 1] ?? null };
}

function clampZoom(scale: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

function zoomFrom(value: string): Zoom | null {
  if (value === "width" || value === "page") return { mode: value };
  const percent = Number(value);

  return percent >= MIN_ZOOM * 100 && percent <= MAX_ZOOM * 100 ? { mode: "custom", scale: percent / 100 } : null;
}

export type Rotation = 0 | 90 | 180 | 270;

export type Zoom = { mode: "width" } | { mode: "page" } | { mode: "custom"; scale: number };

export interface Presentation {
  page: number;
  zoom: Zoom;
  /** Quarter turns on top of the page's own rotation. */
  rotation: Rotation;
}

export interface Size {
  width: number;
  height: number;
}

export interface HistoryState {
  documentViewer: [string, string][];
}

export interface Neighbours<T> {
  previous: T | null;
  next: T | null;
}
