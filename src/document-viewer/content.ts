/**
 * The document viewer's words, shared by the caseworker and judicial routes because both render one template.
 *
 * Every refusal the viewer can show is one of these fixed sentences, chosen by the app from a published code or a
 * status: api's prose, a provider's message and the document's bytes never reach the page. Each one that concerns
 * the preview says the original can still be downloaded, because in every case it can.
 */

export const en = {
  backToCase: "Back to case",
  backToReferral: "Back to referral",
  caseReferenceLabel: "Case reference",
  fileTypeLabel: "File type",
  formats: {
    pdf: "PDF document",
    jpeg: "JPEG image",
    png: "PNG image",
    tiff: "TIFF image",
    docx: "Word document"
  },
  viewerLabel: "Document viewer",
  documentControlsLabel: "Document controls",
  documentSelectLabel: "Document",
  openDocument: "Open document",
  documentPosition: (position: number, total: number) => `Document ${position} of ${total}`,
  previousDocument: "Previous document",
  nextDocument: "Next document",
  downloadOriginal: "Download original",
  // A preview cannot promise to show everything (see "Document viewer" in CLAUDE.md for the known gaps), so the
  // notice tells the reader where the definitive copy is.
  previewNotice: "This is a preview. If anything looks missing or unclear, download the original.",
  pageNavigationLabel: "Page navigation",
  previousPage: "Previous page",
  nextPage: "Next page",
  pageNumberLabel: "Page",
  // `{total}` and `{page}` are filled in by the renderer, which knows the preview's page count only once it loads.
  pageTotal: "of {total}",
  pageStatus: "Page {page} of {total}",
  zoomLabel: "Zoom",
  zoomOut: "Zoom out",
  zoomIn: "Zoom in",
  zoomLevelLabel: "Zoom level",
  fitWidth: "Fit to width",
  fitPage: "Fit whole page",
  rotate: "Rotate 90°",
  thumbnailsLabel: "Page thumbnails",
  hideThumbnails: "Hide thumbnails",
  showThumbnails: "Show thumbnails",
  documentPageLabel: "Document page",
  // Shown until the renderer starts, so a browser without JavaScript is told what still works rather than shown an
  // empty frame.
  noScript: "The interactive preview needs JavaScript. You can still move between documents, download the original or go back.",
  messages: {
    loading: "Loading the preview.",
    unavailable: "A preview of this document is not available. You can still download the original.",
    tooLarge: "This document is too large to preview. You can still download the original.",
    busy: "Previews are busy at the moment. Try again shortly, or download the original.",
    signedOut: "You have been signed out. Sign in again to view this document.",
    forbidden: "You do not have permission to view this document.",
    failed: "The preview could not be loaded. Try again, or download the original.",
    // One page of a preview that otherwise opened, for example a scan too large to draw. The other pages still show.
    pageIncomplete: "This page could not be shown in full. Download the original to see it."
  },
  // Offered beside `busy` and `failed` only: the other refusals give the same answer however often they are asked.
  tryAgain: "Try again",
  // Beside `signedOut`. A link to this document's own view: a navigation, so a timed-out session is ended through IDAM
  // there before sign-in brings the reader back.
  signInAgain: "Sign in again",
  referralUnavailable: {
    title: "This referral is no longer available",
    heading: "This referral is no longer available",
    body: "This referral is no longer in the shared list. Choose another referral from the list.",
    backToPool: "Back to referrals for a direction"
  }
};

export const cy = { ...en };
