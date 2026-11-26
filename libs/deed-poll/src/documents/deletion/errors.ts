/**
 * A document deletion request was sent and no definite answer came back: a timeout, a transport failure, a 5xx, a body
 * this app could not read, or api's limiter. api may have admitted it, so the page must keep the original key and body
 * and offer only the same request again, never a new key, and never read the document to guess: a 404 there is also
 * what an admitted deletion looks like. The message is fixed, because api's prose is not needed to recover.
 */
export class DocumentDeletionOutcomeUnknownError extends Error {
  constructor() {
    super("Document deletion request outcome is unknown");
    this.name = "DocumentDeletionOutcomeUnknownError";
  }
}
