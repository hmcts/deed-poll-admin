import { buildGazetteHistory, buildPaging, findGazetteHistory, parsePage } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../../auth/current-user.js";

const LIST_PATH = "/deed-polls/gazette/history";
const en = {
  title: "London Gazette send history",
  heading: "London Gazette send history",
  back: "Applications ready for the London Gazette",
  sentAt: "Sent at",
  sentBy: "Sent by",
  caseCount: "Number of applications",
  references: "Application references",
  truncated: "Only some application references are shown.",
  empty: "No notices have been sent to the London Gazette.",
  emptyPage: "There are no sends on this page.",
  firstPage: "Go to the first page",
  pagingLabel: "Pages of send history",
  pagingSummaryFor: (first: number, last: number, total: number) => `${first} to ${last} of ${total} sends`
};
const cy = {
  title: "Hanes anfon i’r London Gazette",
  heading: "Hanes anfon i’r London Gazette",
  back: "Ceisiadau sy’n barod ar gyfer y London Gazette",
  sentAt: "Anfonwyd am",
  sentBy: "Anfonwyd gan",
  caseCount: "Nifer y ceisiadau",
  references: "Cyfeirnodau ceisiadau",
  truncated: "Dim ond rhai cyfeirnodau ceisiadau sy’n cael eu dangos.",
  empty: "Nid oes hysbysiadau wedi’u hanfon i’r London Gazette.",
  emptyPage: "Nid oes cofnodion anfon ar y dudalen hon.",
  firstPage: "Ewch i’r dudalen gyntaf",
  pagingLabel: "Tudalennau hanes anfon",
  pagingSummaryFor: (first: number, last: number, total: number) => `${first} i ${last} o ${total} o gofnodion anfon`
};

// Access is owned by the Gazette area gate; API owns history order and pagination.
export const GET = async (req: Request, res: Response) => {
  const content = res.locals.locale === "cy" ? cy : en;
  const results = await findGazetteHistory({ page: parsePage(req.query.page) }, callerFromRequest(req));
  const paging = buildPaging(results, (page) => `${LIST_PATH}?page=${page}`);

  res.render("deed-polls/gazette/history", {
    en,
    cy,
    batches: buildGazetteHistory(results.batches),
    paging,
    isBeyondEnd: results.total > 0 && results.page > results.totalPages,
    pagingSummary: paging.first === 0 ? "" : content.pagingSummaryFor(paging.first, paging.last, paging.total)
  });
};
