/**
 * The one request the viewer makes for a document: its preview, from this app's scoped relay
 * (`src/document-viewer/preview-response.ts`), never the original and never a range.
 *
 * **The answer is read in full, and bounded while it is read.** api publishes a ceiling on a preview's size
 * (`x-document-preview-limits.maxOutputBytes`, handed to the page as `data-max-bytes`), and range requests are
 * unsupported, so a declared length over it is refused before a byte is read and a body that runs past it is
 * cancelled the moment it does. A tab never holds more than the ceiling of one document.
 *
 * **Every refusal is a message key, never text from the response.** The relay answers api's published refusals as
 * `{ code }` on their own statuses; 401 and 403 come from this app's error pages; anything else, including a 200
 * that is not a PDF, is `failed`. A redirect is not followed: under `requireAuth` it can only be the way to
 * sign-in, so it means the session has gone.
 */

export async function fetchPreview(url: string, options: FetchPreviewOptions): Promise<PreviewFetchResult> {
  const { maxBytes, signal, fetchImpl = fetch } = options;

  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { Accept: "application/pdf" }, credentials: "same-origin", redirect: "manual", signal });
  } catch (error) {
    return signal.aborted || isAbort(error) ? ABORTED : failure("failed");
  }

  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) return failure("signedOut");
  if (!response.ok) return failure(await refusalOf(response));
  if (!isPdf(response.headers.get("content-type"))) return discard(response, "failed");

  const declared = Number(response.headers.get("content-length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) return discard(response, "tooLarge");

  try {
    const bytes = await readBounded(response, maxBytes);
    return bytes ? { ok: true, bytes } : failure("tooLarge");
  } catch (error) {
    return signal.aborted || isAbort(error) ? ABORTED : failure("failed");
  }
}

const ABORTED: PreviewFetchResult = { ok: false, reason: "aborted" };

function failure(reason: PreviewFailure): PreviewFetchResult {
  return { ok: false, reason };
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

async function refusalOf(response: Response): Promise<PreviewFailure> {
  const status = response.status;
  if (status === 401) return discardedReason(response, "signedOut");
  if (status === 403) return discardedReason(response, "forbidden");
  if (status === 404) return discardedReason(response, "unavailable");
  if (status === 429) return discardedReason(response, "busy");

  const code = await codeOf(response);
  if (code === "PREVIEW_LIMIT_EXCEEDED" && status === 422) return "tooLarge";
  if ((code === "PREVIEW_INVALID_DOCUMENT" && status === 422) || (code === "PREVIEW_UNAVAILABLE" && status === 503)) return "unavailable";
  return "failed";
}

async function codeOf(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    return typeof body === "object" && body !== null && "code" in body && typeof body.code === "string" ? body.code : null;
  } catch {
    return null;
  }
}

function isPdf(contentType: string | null): boolean {
  return contentType?.split(";")[0].trim().toLowerCase() === "application/pdf";
}

async function discard(response: Response, reason: PreviewFailure): Promise<PreviewFetchResult> {
  return failure(await discardedReason(response, reason));
}

async function discardedReason(response: Response, reason: PreviewFailure): Promise<PreviewFailure> {
  await response.body?.cancel().catch(() => undefined);
  return reason;
}

/** The whole body, or `null` once it runs past `maxBytes`, at which point the rest is never read. */
async function readBounded(response: Response, maxBytes: number): Promise<Uint8Array | null> {
  if (!response.body) return new Uint8Array(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Each is a `data-message-*` sentence on the viewer, except `aborted`, which a newer request replaced. */
export type PreviewFailure = "aborted" | "unavailable" | "tooLarge" | "busy" | "signedOut" | "forbidden" | "failed";

export type PreviewFetchResult = { ok: true; bytes: Uint8Array } | { ok: false; reason: PreviewFailure };

export interface FetchPreviewOptions {
  maxBytes: number;
  signal: AbortSignal;
  /** The browser's `fetch` unless a test supplies one. */
  fetchImpl?: typeof fetch;
}
