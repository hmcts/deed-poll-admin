import {
  buildPaging,
  ForbiddenError,
  findGazetteMembers,
  findGazetteStatus,
  formatTimestamp,
  NotFoundError,
  parsePage,
  UnauthorizedError
} from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../../../auth/current-user.js";

const en = {
  title: "Gazette request",
  heading: "Gazette request",
  back: "Gazette requests",
  history: "Send history",
  refresh: "Refresh status",
  Preparing: "Preparing",
  Sending: "Sending",
  Sent: "Sent",
  NotSent: "Not sent",
  Uncertain: "Outcome uncertain",
  preparing: "The request is being prepared. Refresh the status to check progress. Do not start another send for these applications.",
  sending: "The email is being sent. Refresh the status to check progress. Do not start another send for these applications.",
  sent: "The email has been accepted for sending. This does not confirm delivery or publication in the London Gazette.",
  notSent: "The email was not sent. A new review and confirmation are needed before another attempt.",
  uncertain: "The email may have been sent. Do not send these applications again. Contact support to investigate this request.",
  unknown: "Not recorded",
  legacy: "Some details were not recorded for older sends.",
  status: "Status",
  submitted: "Submitted at",
  by: "Submitted by",
  recipient: "Recipient email address",
  sentAt: "Sent at",
  count: "Number of applications",
  adults: "Adult applications",
  minors: "Minor applications",
  membersHeading: "Applications in this request",
  reference: "Application reference",
  frozen: "These references were recorded with the request. They do not change when an application is edited.",
  empty: "No application references were recorded.",
  emptyPage: "There are no application references on this page.",
  firstPage: "Go to the first page",
  unavailable: "The request status could not be loaded. The email may have been sent. Do not start another send. Refresh the status or contact support.",
  membersUnavailable: "Application references could not be loaded. Refresh the status to try again.",
  pagingLabel: "Pages of application references",
  pagingSummaryFor: (first: number, last: number, total: number) => `${first} to ${last} of ${total} applications`
};
const cy = {
  title: "Cais Gazette",
  heading: "Cais Gazette",
  back: "Ceisiadau Gazette",
  history: "Hanes anfon",
  refresh: "Adnewyddu’r statws",
  Preparing: "Yn paratoi",
  Sending: "Yn anfon",
  Sent: "Anfonwyd",
  NotSent: "Heb ei anfon",
  Uncertain: "Canlyniad ansicr",
  preparing: "Mae’r cais yn cael ei baratoi. Adnewyddwch y statws i weld y cynnydd. Peidiwch â dechrau anfon y ceisiadau hyn eto.",
  sending: "Mae’r e-bost yn cael ei anfon. Adnewyddwch y statws i weld y cynnydd. Peidiwch â dechrau anfon y ceisiadau hyn eto.",
  sent: "Mae’r e-bost wedi’i dderbyn i’w anfon. Nid yw hyn yn cadarnhau ei fod wedi cyrraedd na’i fod wedi’i gyhoeddi yn y London Gazette.",
  notSent: "Ni anfonwyd yr e-bost. Mae angen adolygiad a chadarnhad newydd cyn rhoi cynnig arall arni.",
  uncertain: "Efallai fod yr e-bost wedi’i anfon. Peidiwch ag anfon y ceisiadau hyn eto. Cysylltwch â’r gwasanaeth cymorth i ymchwilio i’r cais hwn.",
  unknown: "Heb ei gofnodi",
  legacy: "Ni chofnodwyd rhai manylion ar gyfer cofnodion anfon hŷn.",
  status: "Statws",
  submitted: "Cyflwynwyd am",
  by: "Cyflwynwyd gan",
  recipient: "Cyfeiriad e-bost y derbynnydd",
  sentAt: "Anfonwyd am",
  count: "Nifer y ceisiadau",
  adults: "Ceisiadau oedolion",
  minors: "Ceisiadau plant",
  membersHeading: "Ceisiadau yn y cais hwn",
  reference: "Cyfeirnod y cais",
  frozen: "Cofnodwyd y cyfeirnodau hyn gyda’r cais. Nid ydynt yn newid pan fydd cais yn cael ei olygu.",
  empty: "Ni chofnodwyd cyfeirnodau ceisiadau.",
  emptyPage: "Nid oes cyfeirnodau ceisiadau ar y dudalen hon.",
  firstPage: "Ewch i’r dudalen gyntaf",
  unavailable:
    "Ni ellid llwytho statws y cais. Efallai fod yr e-bost wedi’i anfon. Peidiwch â dechrau anfon eto. Adnewyddwch y statws neu cysylltwch â’r gwasanaeth cymorth.",
  membersUnavailable: "Ni ellid llwytho cyfeirnodau ceisiadau. Adnewyddwch y statws i roi cynnig arall arni.",
  pagingLabel: "Tudalennau cyfeirnodau ceisiadau",
  pagingSummaryFor: (first: number, last: number, total: number) => `${first} i ${last} o ${total} o geisiadau`
};

export const GET = async (req: Request, res: Response) => {
  const content = res.locals.locale === "cy" ? cy : en;
  const batchId = String(req.params.batchId);
  const path = `/deed-polls/gazette/requests/${encodeURIComponent(batchId)}`;
  const caller = callerFromRequest(req);
  const [statusResult, membersResult] = await Promise.allSettled([
    findGazetteStatus(batchId, caller),
    findGazetteMembers(batchId, { page: parsePage(req.query.page) }, caller)
  ]);
  if (statusResult.status === "rejected") {
    const error = statusResult.reason;
    if (error instanceof NotFoundError || error instanceof ForbiddenError || error instanceof UnauthorizedError) throw error;
    console.error("Gazette request status unavailable");
    res.status(503).render("deed-polls/gazette/requests/[batchId]", { en, cy, isUnavailable: true });
    return;
  }
  const status = statusResult.value;
  const explanations = { Preparing: content.preparing, Sending: content.sending, Sent: content.sent, NotSent: content.notSent, Uncertain: content.uncertain };
  const rows = [
    { key: { text: content.status }, value: { text: content[status.state] } },
    { key: { text: content.submitted }, value: { text: status.submittedAt ? formatTimestamp(status.submittedAt) : content.unknown } },
    { key: { text: content.by }, value: { text: status.submittedBy ?? content.unknown } },
    { key: { text: content.recipient }, value: { text: status.recipientEmail ?? content.unknown } },
    { key: { text: content.sentAt }, value: { text: status.sentAt ? formatTimestamp(status.sentAt) : content.unknown } },
    { key: { text: content.count }, value: { text: status.caseCount } },
    { key: { text: content.adults }, value: { text: status.adultCount ?? content.unknown } },
    { key: { text: content.minors }, value: { text: status.minorCount ?? content.unknown } }
  ];
  // Membership is additive: its failure must not turn a known outcome into an unknown one.
  if (membersResult.status === "rejected") console.error("Gazette request membership unavailable");
  const members = membersResult.status === "fulfilled" ? membersResult.value : null;
  const paging = members ? buildPaging(members, (page) => `${path}?page=${page}`) : null;
  res.render("deed-polls/gazette/requests/[batchId]", {
    en,
    cy,
    rows,
    explanation: explanations[status.state],
    hasMissingDetails: status.submittedAt == null || status.recipientEmail == null,
    members,
    paging,
    path,
    isBeyondEnd: members && members.total > 0 && members.page > members.totalPages,
    pagingSummary: paging && paging.first !== 0 ? content.pagingSummaryFor(paging.first, paging.last, paging.total) : ""
  });
};
