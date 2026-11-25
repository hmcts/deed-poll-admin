/**
 * A deletion request was sent and no definite answer came back: a timeout, a transport failure, a 5xx, a body this
 * app could not read, or api's limiter. api may have admitted it, so the page must keep the original key and body and
 * offer only the same request again, never a new one and never "nothing happened". The message is fixed: api's
 * prose is not a reason to show a Delivery Manager and is not needed to recover.
 */
export class DeletionOutcomeUnknownError extends Error {
  constructor() {
    super("Application deletion request outcome is unknown");
    this.name = "DeletionOutcomeUnknownError";
  }
}
