/**
 * Supporting documents, read and uploaded through `deed-poll-api`.
 *
 * **`file-storage.ts` is gone, and that is the substance of this change.** Local disk was always a
 * development story: pods are ephemeral, replicas share no volume, so a document uploaded to one pod
 * was invisible to the next request and lost on the next deploy. api owns the bytes now, and this file
 * no longer knows where they are — `hasFile` is all it is told, which is all the subgrid ever asked.
 *
 * **Four operations went with the storage**, all of them because api has no endpoint and none of this
 * app's pages offer one: the metadata-only create (a document logged as expected-but-not-yet-received),
 * the metadata patch, the document delete, and the document-type writes in `document-types.ts`.
 * `DEED_POLL_API_PLAN.md` records them as not rebuilt until something asks. `createDocumentSchema` and
 * `updateDocumentSchema` went too; `uploadFormSchema` is what the upload form still validates against.
 *
 * The reads come out of the case rather than a documents endpoint — one `GET /caseworker/cases/{id}`
 * carries the children — which is also what keeps the parent scoping the Prisma version enforced by
 * hand: a document belonging to another case is not in this case's list.
 */
import {
  downloadDocument as apiDownloadDocument,
  previewDocument as apiPreviewDocument,
  uploadDocument as apiUploadDocument,
  type Document,
  type DocumentDirection,
  type DocumentDownload,
  type DocumentPreview,
  getCase
} from "@hmcts/deed-poll-api-client";
import { type Caller, callApi, callPreviewApi } from "../api/deed-poll-api.js";
import { InvalidInputError, NotFoundError } from "../errors.js";
import { UPLOAD_FILE_FIELD } from "./upload-policy.js";

/** Documents for a case. A missing case is api's 404, so this never answers `[]` for one. */
export async function findDocuments(deedPollId: string, caller: Caller): Promise<Document[]> {
  const found = await callApi(caller, (config) => getCase(deedPollId, config));

  return found.documents;
}

export async function findDocument(deedPollId: string, id: string, caller: Caller): Promise<Document> {
  const documents = await findDocuments(deedPollId, caller);
  const document = documents.find((candidate) => candidate.id === id);
  if (!document) throw new NotFoundError(`Document ${id} not found`);

  return document;
}

/**
 * Upload a file and create its document row, in one call to api's multipart endpoint.
 *
 * The local defaults are gone with the local write: api names the row from the file when no name is
 * given and defaults the direction to Incoming, so both are forwarded only when the form supplied them
 * — sending an empty string instead would name the row "". `uploadFormSchema` still caps the name at
 * 100 characters, which is why nothing is truncated here.
 *
 * The missing-file rejection stays local, because it is the one check that cannot usefully be api's:
 * a body with no file part is a form the caseworker has not finished, and `upload-policy.ts` already
 * establishes that rejecting early beats a 400 from api. It owns the message so this page and any
 * other caller give the same one.
 */
export async function uploadDocument(
  deedPollId: string,
  documentTypeId: string,
  file: UploadedFile | undefined,
  opts: { name?: string; direction?: DocumentDirection },
  caller: Caller
): Promise<Document> {
  // Attributed to the file input, the way `uploadTypeRejection` and `uploadLimitRejection` are: a
  // rejection that names its field is one a form can render against the control, and it leaves "no field
  // named" meaning "this came from api", which is what lets a page tell its own copy from api's.
  if (!file) throw new InvalidInputError("Select a file to upload", [{ field: UPLOAD_FILE_FIELD, message: "Select a file to upload" }]);

  return callApi(caller, (config) =>
    apiUploadDocument(
      deedPollId,
      {
        documentTypeId,
        name: file.originalname,
        mimeType: file.mimetype,
        bytes: file.buffer,
        documentName: opts.name,
        direction: opts.direction
      },
      config
    )
  );
}

/**
 * A document's bytes, still streaming, plus the headers api put on them.
 *
 * Not buffered: a scanned deed poll is megabytes and a caller's job is to forward them. api decides
 * the filename and the disposition, so neither is re-derived — which also retires the `safeFilename`
 * sanitising both download routes did, because the header is api's output rather than the uploading
 * client's text.
 *
 * A row with no attached file is api's 404, so the local `"This document has no attached file"` check
 * went with `storageKey`.
 */
export function downloadDocument(deedPollId: string, id: string, caller: Caller): Promise<DocumentDownload> {
  return callApi(caller, (config) => apiDownloadDocument(deedPollId, id, config));
}

/**
 * A document's preview: always one PDF, whatever the original's type, still streaming.
 *
 * A separate operation from {@link downloadDocument} on purpose: api records a preview as `DOCUMENT_PREVIEWED` and a
 * download as `DOCUMENT_DOWNLOADED` (Decision 5 of `docs/plans/20261023-full-page-document-viewer.md`), so neither
 * may stand in for the other. A preview api did not produce is `DocumentPreviewRefusedError`; every other failure
 * is `callApi`'s. No pre-read: api checks the document belongs to the case.
 */
export function previewDocument(deedPollId: string, id: string, caller: Caller, signal?: AbortSignal): Promise<DocumentPreview> {
  return callPreviewApi(caller, (config) => apiPreviewDocument(deedPollId, id, config), signal);
}

// Both download routes relay this through one module, so the app names the type it is handed.
export type { DocumentDownload, DocumentPreview };

/**
 * The parts of an uploaded file this domain needs.
 *
 * The prototype typed this as `Express.Multer.File`, which put a transport type in the domain layer.
 * These four fields are all it ever read, so the app maps whatever its upload middleware produces onto
 * this. `size` is here for `upload-policy.ts`'s benefit rather than api's — the multipart body carries
 * its own length.
 */
export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}
