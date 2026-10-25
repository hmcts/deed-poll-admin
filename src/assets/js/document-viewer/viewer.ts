/**
 * The document viewer's renderer, started by `index.ts` only on a page carrying the viewer
 * (`src/pages/document-viewer.njk`), so no other page downloads PDF.js.
 *
 * It asks for the one preview the page names, opens it, draws the selected page, then the thumbnails. Every outcome
 * other than a drawn page is one of the template's fixed `data-message-*` sentences in the status region, with the
 * frame emptied, and the page's plain links (other documents, **Download original**, the way back) keep working
 * whatever happens here.
 *
 * **Documents switch in place.** The selector and the previous/next document buttons change the heading, the
 * download link and the URL (replacing the history entry, never adding one), empty the frame, and only then ask for
 * the new preview, so no page of the old document is ever on show under the new one's name. Each document's page,
 * zoom and rotation are kept for the visit (`presentation.ts`): in memory, in the history entry's state as ids and
 * numbers, and in the URL fragment for the open one, so a reload, a bookmark or a return through browser Back
 * finds the reader where they were, and another tab keeps its own place. Nothing about a document's content or name
 * is written anywhere.
 *
 * **One page that cannot be drawn in full is that page's state, not the document's** (`render-page.ts`). The frame
 * says so with **Download original** beside it, and every control stays usable, so the reader can move to the next
 * page, which draws as usual.
 *
 * Leaving the page aborts the request and destroys the document and its worker; a page restored from the
 * back-forward cache loads its preview again rather than showing a canvas whose document is gone.
 */
import { GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
// The worker PDF.js was built with, emitted by vite as a hashed same-origin asset: CSP's `script-src 'self'`
// covers it, and no CDN or blob URL is involved.
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { MAX_CANVAS_PIXELS } from "./page-geometry.js";
import {
  canGoToPage,
  canZoom,
  clampPresentation,
  DEFAULT_PRESENTATION,
  effectiveScale,
  neighbours,
  type Presentation,
  parsePageNumber,
  presentationFragment,
  presentationFromFragment,
  presentationsForHistory,
  presentationsFromHistory,
  rotateClockwise,
  type Size,
  stepZoom,
  zoomPercent
} from "./presentation.js";
import { createPreviewLoader, type LoadFailure, type LoadResult } from "./preview-loader.js";
import { type RenderedPage, renderPage } from "./render-page.js";
import { createThumbnails, type Thumbnails } from "./thumbnails.js";

const MESSAGE_KEYS: Readonly<Record<Exclude<LoadFailure, "stale">, string>> = {
  unavailable: "messageUnavailable",
  tooLarge: "messageTooLarge",
  busy: "messageBusy",
  signedOut: "messageSignedOut",
  forbidden: "messageForbidden",
  failed: "messageFailed"
};

/** The failures a second request can cure. The rest answer the same however often they are asked. */
const RETRYABLE: ReadonlySet<Exclude<LoadFailure, "stale">> = new Set(["busy", "failed"]);

/** GOV.UK Frontend's tablet breakpoint, 641px. */
const TABLET_AND_WIDER = "(min-width: 40.0625em)";

export function initDocumentViewer(root: HTMLElement): void {
  const controls = findControls(root);
  const previewUrl = root.dataset.previewUrl;
  const maxPages = Number(root.dataset.maxPages);
  const maxBytes = Number(root.dataset.maxBytes);
  const documents = controls ? documentsFrom(controls.select) : [];
  const first = documents.find((entry) => entry.previewUrl === previewUrl);
  if (!controls || !first || !(maxPages > 0) || !(maxBytes > 0)) return;

  GlobalWorkerOptions.workerSrc = workerUrl;
  const { frame, status, announcement, thumbnailsRegion } = controls;
  const loader = createPreviewLoader({ maxBytes, maxPages });
  const pageLabel = root.dataset.labelPage ?? "";
  const presentations = presentationsFromHistory(history.state);
  const linked = presentationFromFragment(location.hash);
  if (linked) presentations.set(first.id, linked);

  let current = first;
  let opened: Extract<LoadResult, { ok: true }> | null = null;
  let page: RenderedPage | null = null;
  let thumbnails: Thumbnails | null = null;
  let shownScale: number | null = null;
  let drawnFrame: Size | null = null;
  let drawnPage: number | null = null;

  const presentation = (): Presentation => presentations.get(current.id) ?? DEFAULT_PRESENTATION;

  const remember = (next: Presentation) => {
    presentations.set(current.id, next);
    history.replaceState(presentationsForHistory(presentations), "", `${current.viewUrl}${presentationFragment(next)}`);
  };

  const say = (text: string) => {
    status.textContent = text;
    status.hidden = text === "";
  };

  /** The failure's fixed sentence, with the one action that can help beside it. */
  const fail = (reason: Exclude<LoadFailure, "stale">) => {
    say(root.dataset[MESSAGE_KEYS[reason]] ?? "");
    controls.retry.hidden = !RETRYABLE.has(reason);
    controls.signIn.hidden = reason !== "signedOut";
    controls.pageDownload.hidden = true;
  };

  // Settled only by a change, so a redraw of the same page (a resize, a zoom) does not announce its sentence again.
  const showIncomplete = (incomplete: boolean) => {
    if (incomplete === !controls.pageDownload.hidden) return;
    say(incomplete ? (root.dataset.messagePageIncomplete ?? "") : "");
    controls.pageDownload.hidden = !incomplete;
  };

  const announce = (text: string) => {
    announcement.textContent = text;
  };

  const clear = () => {
    page?.release();
    page = null;
    thumbnails?.destroy();
    thumbnails = null;
    thumbnailsRegion.hidden = true;
    shownScale = null;
    drawnFrame = null;
    drawnPage = null;
  };

  const sync = () => {
    const numPages = opened?.numPages ?? 0;
    const shown = opened ? clampPresentation(presentation(), numPages) : DEFAULT_PRESENTATION;
    const ready = opened !== null;
    const focused = window.document.activeElement;

    controls.previousPage.disabled = !ready || !canGoToPage(shown.page - 1, numPages);
    controls.nextPage.disabled = !ready || !canGoToPage(shown.page + 1, numPages);
    controls.pageNumber.disabled = !ready || numPages <= 1;
    controls.pageNumber.value = ready ? String(shown.page) : "";
    controls.pageTotal.textContent = ready ? fill(root.dataset.templatePageTotal, { total: numPages }) : "";
    controls.zoomOut.disabled = shownScale === null || !canZoom(shownScale, -1);
    controls.zoomIn.disabled = shownScale === null || !canZoom(shownScale, 1);
    controls.zoomLevel.textContent = shownScale === null ? "" : zoomPercent(shownScale);
    controls.fitWidth.disabled = !ready;
    controls.fitPage.disabled = !ready;
    controls.fitWidth.setAttribute("aria-pressed", String(shown.zoom.mode === "width"));
    controls.fitPage.setAttribute("aria-pressed", String(shown.zoom.mode === "page"));
    controls.rotate.disabled = !ready;
    controls.thumbnailsToggle.disabled = !ready;

    const { previous, next } = neighbours(documents, current.id);
    controls.previousDocument.disabled = previous === null;
    controls.nextDocument.disabled = next === null;
    controls.position.textContent = current.position;

    keepFocus(focused, controls);
  };

  const draw = async (): Promise<void> => {
    const showing = opened;
    if (!showing) return;
    const shown = clampPresentation(presentation(), showing.numPages);

    page?.release();
    if (shown.page !== drawnPage) showIncomplete(false);
    const available = innerSize(frame);
    let scale: number | null = null;
    const drawing = renderPage(showing.document, {
      pageNumber: shown.page,
      rotation: shown.rotation,
      scale: (width, height) => {
        scale = effectiveScale(shown.zoom, { width, height }, available);
        return scale;
      },
      maxPixels: MAX_CANVAS_PIXELS,
      withText: true,
      className: "app-document-viewer__sheet"
    });
    page = drawing;
    frame.append(drawing.element);

    const outcome = await drawing.done;
    if (page !== drawing || !showing.isCurrent()) return;
    if (outcome === "failed") {
      clear();
      opened = null;
      sync();
      fail("unavailable");
      return;
    }
    if (outcome === "incomplete") drawing.release();
    if (outcome === "rendered" || outcome === "incomplete") {
      showIncomplete(outcome === "incomplete");
      shownScale = scale;
      drawnFrame = available;
      drawnPage = shown.page;
      sync();
    }
  };

  const goToPage = (pageNumber: number) => {
    if (!opened || !canGoToPage(pageNumber, opened.numPages)) return;
    remember({ ...presentation(), page: pageNumber });
    frame.scrollTop = 0;
    thumbnails?.setCurrent(pageNumber);
    announce(fill(root.dataset.templatePageStatus, { page: pageNumber, total: opened.numPages }));
    sync();
    void draw();
  };

  const present = (change: (shown: Presentation) => Presentation) => {
    if (!opened) return;
    remember(change(clampPresentation(presentation(), opened.numPages)));
    void draw();
  };

  const load = async (): Promise<void> => {
    const entry = current;
    clear();
    opened = null;
    sync();
    controls.retry.hidden = true;
    controls.signIn.hidden = true;
    controls.pageDownload.hidden = true;
    say(root.dataset.messageLoading ?? "");

    const result = await loader.load(entry.previewUrl);
    if (!result.ok) {
      if (result.reason !== "stale") fail(result.reason);
      return;
    }

    opened = result;
    const shown = clampPresentation(presentation(), result.numPages);
    presentations.set(entry.id, shown);
    say("");
    // Shown before the page is measured, so a fit is to the space the page actually gets beside them.
    thumbnailsRegion.hidden = !controls.thumbnailsShown();
    sync();
    await draw();
    if (!result.isCurrent() || opened !== result) return;

    thumbnails = createThumbnails(thumbnailsRegion, result.document, {
      numPages: result.numPages,
      pageLabel: (n) => `${pageLabel} ${n}`,
      currentPage: clampPresentation(presentation(), result.numPages).page,
      onSelect: goToPage
    });
  };

  const openDocument = (id: string) => {
    const entry = documents.find((candidate) => candidate.id === id);
    if (!entry || entry === current) return;

    const previousName = current.name;
    current = entry;
    controls.title.textContent = entry.name;
    window.document.title = retitled(window.document.title, previousName, entry.name);
    controls.format.textContent = entry.format;
    controls.formatRow.hidden = entry.format === "";
    controls.download.setAttribute("href", entry.downloadUrl);
    controls.pageDownload.querySelector("a")?.setAttribute("href", entry.downloadUrl);
    controls.signIn.querySelector("a")?.setAttribute("href", entry.viewUrl);
    controls.selector.setAttribute("action", entry.viewUrl);
    controls.select.value = entry.id;
    remember(presentation());
    announce(`${entry.name}. ${entry.position}`);
    void load();
  };

  enhance(controls);
  controls.selector.addEventListener("submit", (event) => {
    event.preventDefault();
    openDocument(controls.select.value);
  });
  controls.previousDocument.addEventListener("click", () => {
    const { previous } = neighbours(documents, current.id);
    if (previous) openDocument(previous.id);
  });
  controls.nextDocument.addEventListener("click", () => {
    const { next } = neighbours(documents, current.id);
    if (next) openDocument(next.id);
  });
  // The button hides itself as the request starts, so focus goes to the heading rather than to the page's body.
  controls.retry.addEventListener("click", () => {
    controls.title.focus();
    void load();
  });
  controls.previousPage.addEventListener("click", () => goToPage(presentation().page - 1));
  controls.nextPage.addEventListener("click", () => goToPage(presentation().page + 1));
  const jump = () => {
    const wanted = opened ? parsePageNumber(controls.pageNumber.value, opened.numPages) : null;
    if (wanted === null || wanted === presentation().page) {
      sync();
      return;
    }
    goToPage(wanted);
  };
  controls.pageNumber.addEventListener("change", jump);
  controls.pageNumber.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    jump();
  });
  controls.zoomOut.addEventListener("click", () => {
    if (shownScale !== null && canZoom(shownScale, -1)) present((shown) => ({ ...shown, zoom: stepZoom(shownScale ?? 1, -1) }));
  });
  controls.zoomIn.addEventListener("click", () => {
    if (shownScale !== null && canZoom(shownScale, 1)) present((shown) => ({ ...shown, zoom: stepZoom(shownScale ?? 1, 1) }));
  });
  controls.fitWidth.addEventListener("click", () => present((shown) => ({ ...shown, zoom: { mode: "width" } })));
  controls.fitPage.addEventListener("click", () => present((shown) => ({ ...shown, zoom: { mode: "page" } })));
  controls.rotate.addEventListener("click", () => present((shown) => ({ ...shown, rotation: rotateClockwise(shown.rotation) })));
  controls.thumbnailsToggle.addEventListener("click", () => {
    const shown = !controls.thumbnailsShown();
    setThumbnailsToggle(controls.thumbnailsToggle, shown);
    if (opened) thumbnailsRegion.hidden = !shown;
  });
  window.addEventListener("hashchange", () => {
    const wanted = presentationFromFragment(location.hash);
    if (wanted && opened) {
      remember(clampPresentation(wanted, opened.numPages));
      thumbnails?.setCurrent(presentation().page);
      void draw();
    }
  });

  // A fit follows the frame: a resized window, hidden thumbnails or a 200% browser zoom redraws the page, and so does
  // a move to a screen of another density. A chosen zoom is a size, so only the density can change what it needs.
  let resizeQueued = false;
  new ResizeObserver(() => {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => {
      resizeQueued = false;
      const size = innerSize(frame);
      if (opened && drawnFrame && presentation().zoom.mode !== "custom" && !sameSize(size, drawnFrame)) void draw();
    });
  }).observe(frame);
  watchDensity(() => {
    if (opened) void draw();
  });

  const leave = () => {
    clear();
    opened = null;
    void loader.close();
  };
  window.addEventListener("pagehide", leave);
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) void load();
  });

  void load();
}

function findControls(root: HTMLElement): Controls | null {
  const one = <T extends Element>(selector: string) => root.querySelector<T>(selector);
  const found = {
    frame: one<HTMLElement>("[data-viewer-page]"),
    status: one<HTMLElement>("[data-viewer-status]"),
    retry: one<HTMLButtonElement>("[data-viewer-retry]"),
    signIn: one<HTMLElement>("[data-viewer-sign-in]"),
    pageDownload: one<HTMLElement>("[data-viewer-page-download]"),
    announcement: one<HTMLElement>("[data-viewer-announcement]"),
    thumbnailsRegion: one<HTMLElement>("[data-viewer-thumbnails]"),
    toolbar: one<HTMLElement>("[data-viewer-toolbar]"),
    title: one<HTMLElement>("[data-viewer-title]"),
    format: one<HTMLElement>("[data-viewer-format]"),
    formatRow: one<HTMLElement>("[data-viewer-format-row]"),
    position: one<HTMLElement>("[data-viewer-position]"),
    download: one<HTMLAnchorElement>("[data-viewer-download]"),
    selector: one<HTMLFormElement>("[data-viewer-selector]"),
    select: one<HTMLSelectElement>("[data-viewer-selector] select"),
    previousDocument: one<HTMLButtonElement>("[data-viewer-previous-document-button]"),
    nextDocument: one<HTMLButtonElement>("[data-viewer-next-document-button]"),
    previousPage: one<HTMLButtonElement>("[data-viewer-previous-page]"),
    nextPage: one<HTMLButtonElement>("[data-viewer-next-page]"),
    pageNumber: one<HTMLInputElement>("[data-viewer-page-number]"),
    pageTotal: one<HTMLElement>("[data-viewer-page-total]"),
    zoomOut: one<HTMLButtonElement>("[data-viewer-zoom-out]"),
    zoomIn: one<HTMLButtonElement>("[data-viewer-zoom-in]"),
    zoomLevel: one<HTMLElement>("[data-viewer-zoom-level]"),
    fitWidth: one<HTMLButtonElement>("[data-viewer-fit-width]"),
    fitPage: one<HTMLButtonElement>("[data-viewer-fit-page]"),
    rotate: one<HTMLButtonElement>("[data-viewer-rotate]"),
    thumbnailsToggle: one<HTMLButtonElement>("[data-viewer-thumbnails-toggle]")
  };
  if (Object.values(found).some((element) => element === null)) return null;

  const controls = found as { [K in keyof typeof found]: NonNullable<(typeof found)[K]> };
  return {
    ...controls,
    noScriptLinks: [...root.querySelectorAll<HTMLElement>("[data-viewer-no-js]")],
    thumbnailsShown: () => controls.thumbnailsToggle.getAttribute("aria-expanded") !== "false"
  };
}

function documentsFrom(select: HTMLSelectElement): ViewerEntry[] {
  return [...select.options].flatMap((option) => {
    const { viewUrl, previewUrl, downloadUrl } = option.dataset;
    if (!viewUrl || !previewUrl || !downloadUrl) return [];

    return [
      { id: option.value, name: option.text, viewUrl, previewUrl, downloadUrl, format: option.dataset.format ?? "", position: option.dataset.position ?? "" }
    ];
  });
}

/**
 * Swap the no-JavaScript neighbour links for the buttons that switch in place, and show the toolbar. Below the
 * tablet breakpoint the thumbnails start hidden: beside them a fitted page would be squeezed to the 25% floor.
 */
function enhance(controls: Controls): void {
  for (const link of controls.noScriptLinks) link.hidden = true;
  controls.previousDocument.hidden = false;
  controls.nextDocument.hidden = false;
  controls.toolbar.hidden = false;
  setThumbnailsToggle(controls.thumbnailsToggle, window.matchMedia(TABLET_AND_WIDER).matches);
}

function setThumbnailsToggle(toggle: HTMLButtonElement, shown: boolean): void {
  toggle.setAttribute("aria-expanded", String(shown));
  toggle.textContent = (shown ? toggle.dataset.hideText : toggle.dataset.showText) ?? "";
}

function fill(template: string | undefined, values: Record<string, number>): string {
  return (template ?? "").replace(/\{(\w+)\}/g, (placeholder, name: string) => (name in values ? String(values[name]) : placeholder));
}

/**
 * A control that has just been disabled (the last page, the last document, the zoom limit) would otherwise drop focus
 * to the page's body, so it moves to its partner, or to the heading if the partner is disabled too.
 */
function keepFocus(focused: Element | null, controls: Controls): void {
  if (!(focused instanceof HTMLButtonElement) || !focused.disabled) return;
  const partners = new Map<HTMLButtonElement, HTMLButtonElement>([
    [controls.previousPage, controls.nextPage],
    [controls.nextPage, controls.previousPage],
    [controls.zoomOut, controls.zoomIn],
    [controls.zoomIn, controls.zoomOut],
    [controls.previousDocument, controls.nextDocument],
    [controls.nextDocument, controls.previousDocument]
  ]);
  const partner = partners.get(focused);
  if (partner && !partner.disabled) partner.focus();
  else controls.title.focus();
}

function innerSize(frame: HTMLElement): Size {
  const style = getComputedStyle(frame);
  const horizontal = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
  const vertical = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);

  return { width: Math.max(0, frame.clientWidth - horizontal), height: Math.max(0, frame.clientHeight - vertical) };
}

function sameSize(a: Size, b: Size): boolean {
  return Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;
}

function retitled(title: string, previousName: string, name: string): string {
  const trimmed = title.trim();

  return trimmed.startsWith(previousName) ? `${name}${trimmed.slice(previousName.length)}` : trimmed;
}

/** Calls `onChange` each time the screen's density changes, re-arming itself for the new density. */
function watchDensity(onChange: () => void): void {
  const query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  query.addEventListener(
    "change",
    () => {
      onChange();
      watchDensity(onChange);
    },
    { once: true }
  );
}

interface ViewerEntry {
  id: string;
  name: string;
  viewUrl: string;
  previewUrl: string;
  downloadUrl: string;
  format: string;
  position: string;
}

interface Controls {
  frame: HTMLElement;
  status: HTMLElement;
  retry: HTMLButtonElement;
  signIn: HTMLElement;
  pageDownload: HTMLElement;
  announcement: HTMLElement;
  thumbnailsRegion: HTMLElement;
  toolbar: HTMLElement;
  title: HTMLElement;
  format: HTMLElement;
  formatRow: HTMLElement;
  position: HTMLElement;
  download: HTMLAnchorElement;
  selector: HTMLFormElement;
  select: HTMLSelectElement;
  previousDocument: HTMLButtonElement;
  nextDocument: HTMLButtonElement;
  previousPage: HTMLButtonElement;
  nextPage: HTMLButtonElement;
  pageNumber: HTMLInputElement;
  pageTotal: HTMLElement;
  zoomOut: HTMLButtonElement;
  zoomIn: HTMLButtonElement;
  zoomLevel: HTMLElement;
  fitWidth: HTMLButtonElement;
  fitPage: HTMLButtonElement;
  rotate: HTMLButtonElement;
  thumbnailsToggle: HTMLButtonElement;
  noScriptLinks: HTMLElement[];
  thumbnailsShown: () => boolean;
}
