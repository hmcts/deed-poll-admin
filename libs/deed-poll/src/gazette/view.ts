import type { GazetteNoticeBatch } from "@hmcts/deed-poll-api-client";
import { formatTimestamp, NOT_RECORDED } from "../deed-poll/case-header.js";

// The ready list uses buildCaseList: CaseSummary carries no enrolment date to add a column for.
/** Keep API order, full count and truncation flag; references stay plain text for template escaping. */
export function buildGazetteHistory(batches: GazetteNoticeBatch[]) {
  return batches.map((batch) => ({
    batchId: batch.batchId,
    sentAt: formatTimestamp(batch.sentAt),
    sentBy: batch.sentBy ?? NOT_RECORDED,
    caseCount: batch.caseCount,
    referenceNumbers: [...batch.referenceNumbers],
    referencesTruncated: batch.referencesTruncated
  }));
}
