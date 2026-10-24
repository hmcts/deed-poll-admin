import type { PreviewRefusalCode } from "@hmcts/deed-poll-api-client";

/**
 * api did not produce a preview, for the published reason `code`, which api published with `status`. The original
 * download is unaffected.
 */
export class DocumentPreviewRefusedError extends Error {
  constructor(
    public readonly code: PreviewRefusalCode,
    public readonly status: number,
    public readonly retryAfterSeconds: number | null
  ) {
    super(`Document preview was refused (${code})`);
    this.name = "DocumentPreviewRefusedError";
  }
}
