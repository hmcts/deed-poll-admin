/**
 * The arithmetic behind every canvas the viewer draws, kept apart from the DOM so it can be tested exactly.
 *
 * **A canvas is bounded in pixels, not in CSS size.** A page drawn at a high zoom on a high-density screen would
 * otherwise ask for a backing store of hundreds of megapixels, which a browser either refuses (a blank page) or
 * grants at the cost of the tab. The page keeps its CSS size and is drawn at a lower density instead, so it goes
 * soft rather than missing.
 */

/** 4096 × 4096: inside every current browser's canvas limit, and a sharp A4 page at well over 300% zoom. */
export const MAX_CANVAS_PIXELS = 16_777_216;

/** A thumbnail's CSS width; its height follows the page's own shape. */
export const THUMBNAIL_WIDTH = 120;

/** About 1.4 canvas pixels per CSS pixel for a portrait A4 thumbnail, so a hundred of them stay a few megabytes. */
export const THUMBNAIL_MAX_PIXELS = 40_000;

/** The scale at which a page `pageWidth` points wide (already rotated) fills `containerWidth` CSS pixels. */
export function fitWidthScale(pageWidth: number, containerWidth: number): number {
  return pageWidth > 0 && containerWidth > 0 ? containerWidth / pageWidth : 1;
}

/**
 * How many canvas pixels to use per CSS pixel: the screen's density, lowered only as far as keeping the canvas
 * under `maxPixels` requires.
 */
export function canvasDensity(cssWidth: number, cssHeight: number, devicePixelRatio: number, maxPixels = MAX_CANVAS_PIXELS): number {
  const wanted = devicePixelRatio > 0 ? devicePixelRatio : 1;
  const area = cssWidth * cssHeight;
  if (area <= 0) return wanted;

  return Math.min(wanted, Math.sqrt(maxPixels / area));
}

/** The canvas's whole-pixel size for a CSS size at a density, never zero and never over `maxPixels`. */
export function canvasSize(cssWidth: number, cssHeight: number, density: number): { width: number; height: number } {
  return { width: Math.max(1, Math.floor(cssWidth * density)), height: Math.max(1, Math.floor(cssHeight * density)) };
}
