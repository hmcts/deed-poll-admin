import { buildPaging, ForbiddenError, findGazetteRequests, formatTimestamp, parsePage, UnauthorizedError } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../../../auth/current-user.js";

const LIST_PATH = "/deed-polls/gazette/requests";
const en = {
  title: "Gazette requests",
  heading: "Gazette requests",
  back: "Applications ready for the London Gazette",
  intro: "Requests include attempts that have not been sent. Older sends appear in send history.",
  history: "Send history",
  submitted: "Submitted at",
  by: "Submitted by",
  state: "Status",
  count: "Applications",
  details: "View request",
  Preparing: "Preparing",
  Sending: "Sending",
  Sent: "Sent",
  NotSent: "Not sent",
  Uncertain: "Outcome uncertain",
  unknown: "Not recorded",
  empty: "There are no Gazette requests.",
  emptyPage: "There are no requests on this page.",
  firstPage: "Go to the first page",
  unavailable: "Gazette requests could not be loaded. Do not start another send to resolve an unknown outcome.",
  refresh: "Refresh requests",
  pagingLabel: "Pages of Gazette requests",
  pagingSummaryFor: (first: number, last: number, total: number) => `${first} to ${last} of ${total} requests`
};
const cy = {
  title: "Ceisiadau Gazette",
  heading: "Ceisiadau Gazette",
  back: "Ceisiadau sy’n barod ar gyfer y London Gazette",
  intro: "Mae’r ceisiadau’n cynnwys ymdrechion nad ydynt wedi’u hanfon. Mae cofnodion anfon hŷn yn ymddangos yn yr hanes anfon.",
  history: "Hanes anfon",
  submitted: "Cyflwynwyd am",
  by: "Cyflwynwyd gan",
  state: "Statws",
  count: "Ceisiadau",
  details: "Gweld y cais",
  Preparing: "Yn paratoi",
  Sending: "Yn anfon",
  Sent: "Anfonwyd",
  NotSent: "Heb ei anfon",
  Uncertain: "Canlyniad ansicr",
  unknown: "Heb ei gofnodi",
  empty: "Nid oes ceisiadau Gazette.",
  emptyPage: "Nid oes ceisiadau ar y dudalen hon.",
  firstPage: "Ewch i’r dudalen gyntaf",
  unavailable: "Ni ellid llwytho ceisiadau Gazette. Peidiwch â dechrau anfon eto i ddatrys canlyniad anhysbys.",
  refresh: "Adnewyddu ceisiadau",
  pagingLabel: "Tudalennau ceisiadau Gazette",
  pagingSummaryFor: (first: number, last: number, total: number) => `${first} i ${last} o ${total} o geisiadau`
};

export const GET = async (req: Request, res: Response) => {
  const content = res.locals.locale === "cy" ? cy : en;
  try {
    const results = await findGazetteRequests({ page: parsePage(req.query.page) }, callerFromRequest(req));
    const paging = buildPaging(results, (page) => `${LIST_PATH}?page=${page}`);
    res.render("deed-polls/gazette/requests/index", {
      en,
      cy,
      requests: results.requests.map((row) => ({
        batchId: row.batchId,
        state: content[row.state],
        caseCount: row.caseCount,
        submittedAt: row.submittedAt ? formatTimestamp(row.submittedAt) : content.unknown,
        submittedBy: row.submittedBy ?? content.unknown
      })),
      paging,
      isBeyondEnd: results.total > 0 && results.page > results.totalPages,
      pagingSummary: paging.first === 0 ? "" : content.pagingSummaryFor(paging.first, paging.last, paging.total)
    });
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof UnauthorizedError) throw error;
    console.error("Gazette request list unavailable");
    res.status(503).render("deed-polls/gazette/requests/index", { en, cy, isUnavailable: true });
  }
};
