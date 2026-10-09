import type { GazetteRefusal } from "@hmcts/deed-poll-api-client";

export class GazetteRefusalError extends Error {
  constructor(public readonly refusal: GazetteRefusal) {
    super("Gazette request was refused");
    this.name = "GazetteRefusalError";
  }
}
export class GazetteOutcomeUnknownError extends Error {
  constructor() {
    super("Gazette request outcome is unknown");
    this.name = "GazetteOutcomeUnknownError";
  }
}
