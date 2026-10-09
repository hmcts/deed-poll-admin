import { expect, it } from "vitest";
import { NOT_RECORDED } from "../deed-poll/case-header.js";
import { buildGazetteHistory } from "./view.js";

it("should preserve order, full counts, plain text and the API truncation flag without mutating batches", () => {
  const batches = [
    {
      sentAt: new Date("2026-01-02T09:30:00Z"),
      sentBy: "<script>sender</script>",
      caseCount: 101,
      referenceNumbers: ["<b>frozen</b>"],
      referencesTruncated: true
    },
    { sentAt: null, sentBy: null, caseCount: 0, referenceNumbers: [], referencesTruncated: false }
  ];

  const rows = buildGazetteHistory(batches);

  expect(rows[0]).toEqual({ ...batches[0], batchId: undefined, sentAt: "2 January 2026 at 9:30am" });
  expect(rows[1]).toEqual({ ...batches[1], batchId: undefined, sentAt: NOT_RECORDED, sentBy: NOT_RECORDED });
  expect(rows[0].referenceNumbers).not.toBe(batches[0].referenceNumbers);
  expect(batches[0].sentAt).toBeInstanceOf(Date);
  expect(buildGazetteHistory([])).toEqual([]);
});
