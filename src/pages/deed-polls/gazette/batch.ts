import {
  buildCaseList,
  type Caller,
  ForbiddenError,
  findDeedPoll,
  findGazetteReadyCases,
  formatTimestamp,
  GAZETTE_CHECKS,
  GazetteRefusalError,
  gazetteChecklistComplete,
  gazetteReviewsCurrent,
  gazetteReviewVersion,
  previewGazetteSelection,
  sendGazetteSelection,
  UnauthorizedError
} from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../../auth/current-user.js";
import {
  type GazetteJourney,
  gazetteRequestKey,
  newGazetteJourney,
  openGazetteJourney,
  sealGazetteJourney,
  selectedGazetteCases
} from "../../../gazette/journey.js";

const en = {
  title: "Review applications for the London Gazette",
  heading: "Review applications for the London Gazette",
  intro:
    "Complete all five checks for each application before selecting it. You can review up to 100 applications in one visit. Reviews apply to this visit only. Changes to an application require another review.",
  reference: "Reference",
  name: "New name",
  review: "Review application",
  reviewed: "Reviewed",
  unreviewed: "Review required",
  select: "Select",
  previous: "Previous page",
  next: "Next page",
  preview: "Check selected applications",
  back: "Back to selection",
  ready: "Applications ready for the London Gazette",
  requests: "Gazette requests",
  settings: "London Gazette recipient",
  empty: "There are no applications on this page.",
  countFor: (count: number) => `${count} applications selected`,
  reviewHeading: "Complete the application checklist",
  application: "View application details (opens in a new tab)",
  former: "Former name",
  newName: "New name",
  state: "Application state",
  enrolled: "The application is enrolled.",
  queries: "There is no open referral or unresolved query against the application.",
  names: "The former and new names match the application’s declaration.",
  documents: "There is no outstanding document or witness issue recorded against the application.",
  signOff: "I have checked this application and it is ready to be sent to the London Gazette.",
  saveReview: "Complete review",
  checklist: "Required checks",
  checkAll: "Complete all five checks before selecting this application",
  errorTitle: "There is a problem",
  selectOne: "Select at least one reviewed application",
  invalid: "This review form is no longer valid. Check existing Gazette requests before starting again.",
  changed: "An application has changed since it was reviewed. Check existing Gazette requests, then review the application again.",
  expired: "This review visit has expired. Check existing Gazette requests before starting a new review.",
  confirmHeading: "Check the Gazette email",
  recipient: "Recipient",
  adults: "Adult applications",
  minors: "Minor applications",
  expiry: "Confirmation expires at",
  email: "One email will contain download links for the adult and minor spreadsheets. A link is omitted if there are no applications in that group.",
  send: "Confirm and send email",
  confirm: "I confirm that these reviewed applications should be sent to this recipient.",
  mustConfirm: "Confirm the recipient and applications before sending",
  unknown:
    "The request outcome is unknown. Do not start another send for these applications. Check this request using its original details, or use Gazette requests to investigate.",
  checkStatus: "Check request status",
  unavailable: "The applications could not be checked. No new email has been requested from this page. Try again or check Gazette requests.",
  again: "Review selection again",
  incomplete: "Only applications with a completed checklist can be selected",
  RECIPIENT_NOT_CONFIGURED: "Set the London Gazette recipient before checking this selection again.",
  RECIPIENT_CHANGED: "The recipient has changed. Check the selection and confirm the current recipient again.",
  SELECTION_CHANGED: "The selected data has changed. Review the applications and obtain a new confirmation.",
  CASE_NOT_READY: "An application is no longer ready. Check the selection and review the applications again.",
  CASE_TYPE_UNSUPPORTED: "An application type is not supported for Gazette sending. Check the selection.",
  CASE_RESERVED: "An application belongs to an existing Gazette request. Check Gazette requests before continuing.",
  REQUEST_KEY_REUSED: "This request identity has already been used with different details. Check Gazette requests to resolve the existing attempt.",
  CONFIRMATION_EXPIRED: "This confirmation has expired. Check the selection and confirm again.",
  GAZETTE_UNAVAILABLE: "Gazette sending is unavailable. Check with support before trying again."
};
const cy = {
  title: "Adolygu ceisiadau ar gyfer y London Gazette",
  heading: "Adolygu ceisiadau ar gyfer y London Gazette",
  intro:
    "Cwblhewch bob un o’r pum gwiriad ar gyfer pob cais cyn ei ddewis. Gallwch adolygu hyd at 100 o geisiadau mewn un ymweliad. Mae adolygiadau’n berthnasol i’r ymweliad hwn yn unig. Mae angen adolygu cais eto os yw’n newid.",
  reference: "Cyfeirnod",
  name: "Enw newydd",
  review: "Adolygu’r cais",
  reviewed: "Wedi’i adolygu",
  unreviewed: "Angen adolygiad",
  select: "Dewis",
  previous: "Y dudalen flaenorol",
  next: "Y dudalen nesaf",
  preview: "Gwirio’r ceisiadau a ddewiswyd",
  back: "Yn ôl i’r dewis",
  ready: "Ceisiadau sy’n barod ar gyfer y London Gazette",
  requests: "Ceisiadau Gazette",
  settings: "Derbynnydd y London Gazette",
  empty: "Nid oes ceisiadau ar y dudalen hon.",
  countFor: (count: number) => `${count} o geisiadau wedi’u dewis`,
  reviewHeading: "Cwblhau rhestr wirio’r cais",
  application: "Gweld manylion y cais (yn agor mewn tab newydd)",
  former: "Enw blaenorol",
  newName: "Enw newydd",
  state: "Statws y cais",
  enrolled: "Mae’r cais wedi’i gofrestru.",
  queries: "Nid oes atgyfeiriad agored na mater heb ei ddatrys yn erbyn y cais.",
  names: "Mae’r enwau blaenorol a newydd yn cyfateb i ddatganiad y cais.",
  documents: "Nid oes mater heb ei ddatrys ynghylch dogfen neu dyst wedi’i gofnodi yn erbyn y cais.",
  signOff: "Rwyf wedi gwirio’r cais hwn ac mae’n barod i’w anfon i’r London Gazette.",
  saveReview: "Cwblhau’r adolygiad",
  checklist: "Gwiriadau gofynnol",
  checkAll: "Cwblhewch bob un o’r pum gwiriad cyn dewis y cais hwn",
  errorTitle: "Mae problem wedi codi",
  selectOne: "Dewiswch o leiaf un cais sydd wedi’i adolygu",
  invalid: "Nid yw’r ffurflen adolygu hon yn ddilys mwyach. Gwiriwch y ceisiadau Gazette presennol cyn dechrau eto.",
  changed: "Mae cais wedi newid ers iddo gael ei adolygu. Gwiriwch y ceisiadau Gazette presennol, yna adolygwch y cais eto.",
  expired: "Mae’r ymweliad adolygu hwn wedi dod i ben. Gwiriwch y ceisiadau Gazette presennol cyn dechrau adolygiad newydd.",
  confirmHeading: "Gwirio e-bost y Gazette",
  recipient: "Derbynnydd",
  adults: "Ceisiadau oedolion",
  minors: "Ceisiadau plant",
  expiry: "Daw’r cadarnhad i ben am",
  email: "Bydd un e-bost yn cynnwys dolenni lawrlwytho ar gyfer taenlenni oedolion a phlant. Ni fydd dolen os nad oes ceisiadau yn y grŵp hwnnw.",
  send: "Cadarnhau ac anfon yr e-bost",
  confirm: "Rwy’n cadarnhau y dylid anfon y ceisiadau hyn sydd wedi’u hadolygu at y derbynnydd hwn.",
  mustConfirm: "Cadarnhewch y derbynnydd a’r ceisiadau cyn anfon",
  unknown:
    "Nid yw canlyniad y cais yn hysbys. Peidiwch â dechrau anfon y ceisiadau hyn eto. Gwiriwch y cais hwn gan ddefnyddio ei fanylion gwreiddiol, neu defnyddiwch geisiadau Gazette i ymchwilio.",
  checkStatus: "Gwirio statws y cais",
  unavailable:
    "Ni ellid gwirio’r ceisiadau. Nid oes e-bost newydd wedi’i ofyn amdano o’r dudalen hon. Rhowch gynnig arall arni neu gwiriwch geisiadau Gazette.",
  again: "Adolygu’r dewis eto",
  incomplete: "Dim ond ceisiadau â rhestr wirio gyflawn y gellir eu dewis",
  RECIPIENT_NOT_CONFIGURED: "Gosodwch dderbynnydd y London Gazette cyn gwirio’r dewis hwn eto.",
  RECIPIENT_CHANGED: "Mae’r derbynnydd wedi newid. Gwiriwch y dewis a chadarnhewch y derbynnydd presennol eto.",
  SELECTION_CHANGED: "Mae’r data a ddewiswyd wedi newid. Adolygwch y ceisiadau a chael cadarnhad newydd.",
  CASE_NOT_READY: "Nid yw cais yn barod mwyach. Gwiriwch y dewis ac adolygwch y ceisiadau eto.",
  CASE_TYPE_UNSUPPORTED: "Nid yw math o gais yn cael ei gefnogi ar gyfer anfon i’r Gazette. Gwiriwch y dewis.",
  CASE_RESERVED: "Mae cais yn perthyn i gais Gazette presennol. Gwiriwch geisiadau Gazette cyn parhau.",
  REQUEST_KEY_REUSED: "Mae’r dynodwr cais hwn eisoes wedi’i ddefnyddio gyda manylion gwahanol. Gwiriwch geisiadau Gazette i ddatrys yr ymgais bresennol.",
  CONFIRMATION_EXPIRED: "Mae’r cadarnhad hwn wedi dod i ben. Gwiriwch y dewis a chadarnhewch eto.",
  GAZETTE_UNAVAILABLE: "Nid yw anfon i’r Gazette ar gael. Gwiriwch gyda’r gwasanaeth cymorth cyn rhoi cynnig arall arni."
};

export const GET = async (req: Request, res: Response) => render(req, res, newGazetteJourney());

export const POST = async (req: Request, res: Response) => {
  const journey = await openGazetteJourney(req);
  if (!journey) return render(req, res, null, "invalid");
  const action: unknown = req.body?.action;
  // Recovery carries the original payload even after review/preview expiry. No readiness pre-read here.
  if (journey.phase === "recover" && action === "check") return submit(req, res, journey);
  if (journey.phase === "refused" && action === "again") {
    return render(req, res, { ...journey, phase: "select", confirmation: undefined, reviewing: undefined });
  }
  if (Date.now() - journey.createdAt > 2 * 60 * 60_000) return render(req, res, null, "expired");
  const caller = callerFromRequest(req);
  if (journey.phase === "select") return selectCases(req, res, journey, action, caller);
  if (journey.phase === "review") return reviewCase(req, res, journey, action, caller);
  if (journey.phase === "confirm") return confirmSelection(req, res, journey, action, caller);
  return render(req, res, null, "invalid");
};

async function selectCases(req: Request, res: Response, journey: GazetteJourney, action: unknown, caller: Caller) {
  const selected = selectedGazetteCases(journey, req.body?.caseIds);
  if (!selected) return render(req, res, journey, "incomplete");
  const withSelection = { ...journey, selected };
  try {
    if (typeof action === "string" && action.startsWith("review:")) {
      const id = action.slice(7);
      if (!id || id.length > 255 || (journey.reviews.length >= 100 && !journey.reviews.some((r) => r.id === id)))
        return render(req, res, withSelection, "invalid");
      const record = await findDeedPoll(id, caller);
      return render(req, res, { ...withSelection, phase: "review", reviewing: { id, version: gazetteReviewVersion(record) } }, undefined, record);
    }
    if (typeof action === "string" && /^page:[1-9]\d{0,5}$/.test(action)) return render(req, res, { ...withSelection, page: Number(action.slice(5)) });
    if (action === "preview") return previewSelection(req, res, withSelection, caller);
    return render(req, res, null, "invalid");
  } catch (error) {
    return operationFailed(req, res, withSelection, error);
  }
}

async function previewSelection(req: Request, res: Response, journey: GazetteJourney, caller: Caller) {
  const { selected } = journey;
  if (!selected.length) return render(req, res, journey, "selectOne");
  try {
    const reviews = journey.reviews.filter((r) => selected.includes(r.id));
    if (!(await gazetteReviewsCurrent(reviews, caller))) return render(req, res, { ...journey, reviews: [], selected: [] }, "changed");
    const preview = await previewGazetteSelection(selected, caller);
    // Prevent a preview obtained after an intervening edit from blessing the old checklist.
    if (!(await gazetteReviewsCurrent(reviews, caller))) return render(req, res, { ...journey, reviews: [], selected: [] }, "changed");
    return render(req, res, {
      ...journey,
      phase: "confirm",
      confirmation: {
        key: await gazetteRequestKey(req, journey),
        caseIds: [...selected],
        recipientRevision: preview.recipientRevision,
        selectionFingerprint: preview.selectionFingerprint,
        recipientEmail: preview.recipientEmail,
        expiresAt: preview.expiresAt.toISOString(),
        adultCount: preview.adultCount,
        minorCount: preview.minorCount,
        references: preview.cases.map((c) => c.referenceNumber)
      }
    });
  } catch (error) {
    return operationFailed(req, res, journey, error);
  }
}

async function reviewCase(req: Request, res: Response, journey: GazetteJourney, action: unknown, caller: Caller) {
  if (!journey.reviewing) return render(req, res, null, "invalid");
  try {
    if (action === "back") return render(req, res, { ...journey, phase: "select", reviewing: undefined });
    if (action === "save") {
      const record = await findDeedPoll(journey.reviewing.id, caller);
      if (gazetteReviewVersion(record) !== journey.reviewing.version) {
        return render(req, res, { ...journey, reviewing: { id: record.id, version: gazetteReviewVersion(record) } }, "changed", record);
      }
      if (!gazetteChecklistComplete(req.body?.checks)) return render(req, res, journey, "checkAll", record);
      const reviews = [...journey.reviews.filter((r) => r.id !== record.id), journey.reviewing];
      return render(req, res, { ...journey, phase: "select", reviews, reviewing: undefined });
    }
    return render(req, res, null, "invalid");
  } catch (error) {
    return operationFailed(req, res, journey, error);
  }
}

async function confirmSelection(req: Request, res: Response, journey: GazetteJourney, action: unknown, caller: Caller) {
  if (!journey.confirmation) return render(req, res, null, "invalid");
  try {
    if (action === "back") return render(req, res, { ...journey, phase: "select", confirmation: undefined });
    if (action === "send") {
      if (req.body?.confirmed !== "yes") return render(req, res, journey, "mustConfirm");
      const confirmedIds = journey.confirmation.caseIds;
      const reviews = journey.reviews.filter((r) => confirmedIds.includes(r.id));
      if (reviews.length !== journey.confirmation.caseIds.length || !(await gazetteReviewsCurrent(reviews, caller))) {
        // An old confirmation may already have been posted in another tab. Do not offer a new identity.
        return render(req, res, null, "changed");
      }
      return submit(req, res, { ...journey, phase: "recover" });
    }
    return render(req, res, null, "invalid");
  } catch (error) {
    return operationFailed(req, res, journey, error);
  }
}

// Catch operation failures within each step, without reclassifying rejected render/submit promises.
function operationFailed(req: Request, res: Response, journey: GazetteJourney, error: unknown) {
  if (error instanceof ForbiddenError || error instanceof UnauthorizedError) throw error;
  if (error instanceof GazetteRefusalError) return render(req, res, { ...journey, phase: "refused" }, error.refusal.code);
  console.error("Gazette review or preview unavailable");
  return render(req, res, null, "unavailable");
}

async function submit(req: Request, res: Response, journey: GazetteJourney) {
  const confirmation = journey.confirmation;
  if (!confirmation) return render(req, res, null, "invalid");
  try {
    const status = await sendGazetteSelection(
      { caseIds: confirmation.caseIds, recipientRevision: confirmation.recipientRevision, selectionFingerprint: confirmation.selectionFingerprint },
      confirmation.key,
      callerFromRequest(req)
    );
    res.redirect(303, `/deed-polls/gazette/requests/${encodeURIComponent(status.batchId)}`);
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof UnauthorizedError) throw error;
    if (error instanceof GazetteRefusalError) {
      return render(req, res, error.refusal.code === "REQUEST_KEY_REUSED" ? null : { ...journey, phase: "refused" }, error.refusal.code);
    }
    console.error("Gazette submission outcome unknown");
    return render(req, res, { ...journey, phase: "recover" }, "unknown");
  }
}

async function render(req: Request, res: Response, journey: GazetteJourney | null, error?: keyof typeof en, record?: Awaited<ReturnType<typeof findDeedPoll>>) {
  const content = res.locals.locale === "cy" ? cy : en;
  const page = journey?.phase === "select" ? await findGazetteReadyCases({ page: journey.page }, callerFromRequest(req)) : null;
  const cases = page
    ? buildCaseList(page.cases).map((c) => ({ ...c, isReviewed: journey?.reviews.some((r) => r.id === c.id), isSelected: journey?.selected.includes(c.id) }))
    : [];
  const phase = journey?.phase;
  const { errorId, heading, status } = pagePresentation(phase, content, error);
  res.status(status).render("deed-polls/gazette/batch", {
    en,
    cy,
    title: heading,
    heading,
    phase,
    journey: journey ? await sealGazetteJourney(req, journey) : null,
    cases,
    page,
    record,
    selectedCount: content.countFor(journey?.selected.length ?? 0),
    offPage: journey?.selected.filter((id) => !cases.some((c) => c.id === id)) ?? [],
    previousPage: page && page.page > 1 ? page.page - 1 : null,
    nextPage: page && page.page < page.totalPages ? page.page + 1 : null,
    checks: GAZETTE_CHECKS.map((value) => ({
      value,
      text: content[value],
      checked: error === "checkAll" && (req.body?.checks === value || (Array.isArray(req.body?.checks) && req.body.checks.includes(value)))
    })),
    confirmation: journey?.confirmation,
    expiryText: journey?.confirmation ? formatTimestamp(new Date(journey.confirmation.expiresAt)) : null,
    errorList: error ? [{ text: content[error], href: `#${errorId}` }] : [],
    errorId,
    errorText: error ? content[error] : null
  });
}

function pagePresentation(phase: GazetteJourney["phase"] | undefined, content: typeof en, error?: keyof typeof en) {
  const errorId = phase === "review" ? "checks" : phase === "confirm" ? "confirmed" : "selection";
  const heading = phase === "review" ? content.reviewHeading : phase === "confirm" || phase === "recover" ? content.confirmHeading : content.heading;
  const errorStatus = error === "unknown" || error === "unavailable" ? 503 : 400;
  const status = error ? errorStatus : 200;
  return { errorId, heading, status };
}
