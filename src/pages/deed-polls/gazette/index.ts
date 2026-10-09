import { buildCaseList, buildPaging, findGazetteReadyCases, parsePage } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../../auth/current-user.js";

const LIST_PATH = "/deed-polls/gazette";
const en = {
  title: "Applications ready for the London Gazette",
  heading: "Applications ready for the London Gazette",
  intro: "Applications enrolled longest ago are first. Open an application to view its details.",
  back: "All applications",
  requests: "Gazette requests",
  reservations: "Some applications may already be reserved by a Gazette request. Check existing requests before starting another send.",
  history: "Send history",
  settings: "London Gazette recipient",
  reference: "Reference",
  privacy: "Privacy",
  forename: "New forename",
  surname: "New surname",
  received: "Received",
  empty: "There are no applications ready for the London Gazette.",
  emptyPage: "There are no applications on this page.",
  firstPage: "Go to the first page",
  pagingLabel: "Pages of applications",
  pagingSummaryFor: (first: number, last: number, total: number) => `${first} to ${last} of ${total} applications`
};
const cy = {
  title: "Ceisiadau sy’n barod ar gyfer y London Gazette",
  heading: "Ceisiadau sy’n barod ar gyfer y London Gazette",
  intro: "Mae’r ceisiadau a gofrestrwyd gynharaf yn gyntaf. Agorwch gais i weld ei fanylion.",
  back: "Pob cais",
  requests: "Ceisiadau Gazette",
  reservations: "Gall rhai ceisiadau fod wedi’u cadw gan gais Gazette eisoes. Gwiriwch y ceisiadau presennol cyn dechrau anfon eto.",
  history: "Hanes anfon",
  settings: "Derbynnydd y London Gazette",
  reference: "Cyfeirnod",
  privacy: "Preifatrwydd",
  forename: "Enw cyntaf newydd",
  surname: "Cyfenw newydd",
  received: "Derbyniwyd",
  empty: "Nid oes ceisiadau sy’n barod ar gyfer y London Gazette.",
  emptyPage: "Nid oes ceisiadau ar y dudalen hon.",
  firstPage: "Ewch i’r dudalen gyntaf",
  pagingLabel: "Tudalennau ceisiadau",
  pagingSummaryFor: (first: number, last: number, total: number) => `${first} i ${last} o ${total} o geisiadau`
};

// The area gate in app.ts owns access. Only paging travels: API owns membership and order.
export const GET = async (req: Request, res: Response) => {
  const content = res.locals.locale === "cy" ? cy : en;
  const results = await findGazetteReadyCases({ page: parsePage(req.query.page) }, callerFromRequest(req));
  const paging = buildPaging(results, (page) => `${LIST_PATH}?page=${page}`);

  res.render("deed-polls/gazette/index", {
    en,
    cy,
    cases: buildCaseList(results.cases),
    paging,
    isBeyondEnd: results.total > 0 && results.page > results.totalPages,
    pagingSummary: paging.first === 0 ? "" : content.pagingSummaryFor(paging.first, paging.last, paging.total)
  });
};
