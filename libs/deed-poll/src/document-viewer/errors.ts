import type { PreviewRefusalCode } from "@hmcts/deed-poll-api-client";

/** api did not produce a preview, for the published reason `code`. The original download is unaffected. */
export class DocumentPreviewRefusedError extends Error {
  constructor(
    public readonly code: PreviewRefusalCode,
    public readonly retryAfterSeconds: number | null
  ) {
    super(`Document preview was refused (${code})`);
    this.name = "DocumentPreviewRefusedError";
  }
}
