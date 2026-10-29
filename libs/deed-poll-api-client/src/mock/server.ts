/**
 * A mock `deed-poll-api`, implementing its published caseworker surface in memory.
 *
 * It exists because api is not deployed, so without it neither `yarn dev` nor the e2e suite can reach a
 * case page. It is a stand-in for the CONTRACT, not a second implementation of api: there is no database,
 * no signature verification, no S2S and no document storage, and it forgets everything when it stops.
 *
 * Nine routes are OUTSIDE the contract and exist only here, all under `/__mock` so no route in this file
 * could be mistaken for one api serves:
 *
 *   POST /__mock/scenario   switch behaviour (see fixtures.ts)
 *   POST /__mock/reset      forget every case
 *   POST /__mock/cases      seed a case without going through a create
 *   POST /__mock/gazette-requests  seed a request outcome and frozen members
 *   POST /__mock/gazette-outcome   choose the next simulated send outcome/lost response
 *   POST /__mock/gazette-batches  seed frozen audit membership without sending
 *   POST /__mock/referrals/{id}/confirmation-request
 *                           start the wait for an applicant's confirmation, which no contract route here can
 *                           do: the write that starts it is notify-3's email and this mock has no template
 *                           for it. See the route for why it is not a second template.
 *   POST /__mock/clock      move the referral clock by `{ offsetMinutes }` from real time, so a journey can make
 *                           an assignment overdue or cross a referral window without waiting (plan Db1)
 *   POST /__mock/referrals/unassign-overdue
 *                           run api's processing-window sweep now, as its timer would
 *
 * `GET /health` and `GET /health/liveness` are outside the contract too, so `yarn dev` and Playwright's
 * `webServer` have something to wait for — and so the readiness check task 5 adds has something to probe.
 * Both, because api's actuator serves both and `checkApiReachable` deliberately probes the liveness group.
 *
 * **Sixteen of api's rules are restated here.** A mock that applied none of them would let a
 * page ship having never seen a real reference number or a derived state:
 *
 *   1. Reference-number allocation — the year from Date Received, the prefix from Type, a per-year serial.
 *   2. State derivation from the populated dates.
 *   3. The two cross-field date refusals.
 *   4. The per-type field-rule matrix.
 *   5. The audit author taken from the caller's token — see `auditName`.
 *   6. The two-witness gate on enrolment — see `enrolmentWitnessError`.
 *   7. The list query — the search term, the `where` conditions, the sort and the paging — see `list`.
 *      Without it a query builder could ship having narrowed nothing: every page and every e2e journey
 *      would see the same list whatever it asked for, which is the one thing about a query worth testing.
 *      The search term brings `referenceMatch` with it, since a page redirects on it — see `matchesTerm`.
 *   8. The referral state machine, including the one-live-referral guard and the two conditional
 *      requirements on a create — `Open → Claimed → Decided → Closed`, `Withdrawn` from any live state, and
 *      a 409 rather than a silent success for every transition that is not available. Restated because
 *      answering 200 where api answers 409 is how a page ships with no conflict handling at all.
 *   9. `currentReferralState` recomputed from the case's referrals at every transition — never pushed per
 *      site. See `refreshCurrentReferralState`, which is also why closing a referral leaves the case null.
 *  10. The judicial surface's visibility rule, and the order of a judge's list — since api D2 an `Open` referral
 *      (waiting for assignment) is no judge's, an assigned or decided one is only its Master's, and a closed or
 *      withdrawn one is nobody's. The deprecated pool is always empty; a judge's own list is undirected first,
 *      urgent first among those only, then oldest, then the id. See `visibleToJudge` and `myReferralsOrder`. **Ownership is the
 *      token's subject and never the display name** (api's `claimedById`/`decidedById`), which is why
 *      `callerSubject` exists beside `auditName`: keyed on the name, one judge's list would enumerate a
 *      namesake's work.
 *  11. The email rules — what makes a template applicable, what a slot payload may contain, the 422 for a case
 *      with no applicant email address, and one email per referral. Restated because every one of them is a
 *      state the Email tab has to render, and the last is the difference between a redundant send being a
 *      success and being an error. See `emails`, `composeEmail` and `enqueueEmail`.
 *
 *      **And the `Idempotency-Key` a send must carry**, which notify-6 made required: absent or unparseable is a
 *      400 naming the header, the same key on the same case answers with the original receipt and `enqueued:
 *      false`, and a key already used there for a different email is a 409. Restated because a mock more forgiving
 *      than api is the one thing this mock must never be — every send in the suite would pass with no header at
 *      all, which is exactly how the app reached master unable to send anything. The key is asked about BEFORE
 *      the per-referral rule, as api's `resolveRefusedInsert` asks. See `idempotencyKey` and `isTheSameSend`.
 *  12. The case notes a referral writes as it moves — raised, claimed, directed, actioned and withdrawn — and
 *      the order the two note reads publish them in. Restated because the Notes grid is the only place this
 *      app shows a referral's history, so a mock that wrote none would let the caseworker and judicial
 *      timelines ship against a case that looks as though the referral had never moved. See
 *      `referralRaisedNote` and `appendNote`; the wording's authority is api's `ReferralNotes`.
 *
 *      **And the notes an email writes**, for the same reason and with the same consequence: one on a fresh
 *      enqueue, one on the transition into `Failed`, and none for an idempotent repeat send. Their authority is
 *      api's `EmailNotes`, and the failure half is reachable only under the `email-send-failure` scenario,
 *      because nothing else here drives a row out of `Sent`. See `emailSentNote` and `emailCouldNotBeSentNote`.
 *
 *  13. `GET /me` and the Gazette's `ACCESS_GAZETTE` gate, both from one role table (`caller-access.ts`, after
 *      api's `StaffArea` and `RoleCapabilities`), and Gazette history's paging. Fixture claims are decoded,
 *      never verified; local IDAM tokens without roles use the configured userinfo endpoint; the history
 *      reads frozen batches, newest first with an identity tie-break and a sorted 100-reference preview.
 *  14. Document previews on both surfaces (api PR #129), scoped and visible exactly as `/file` is: a real PDF
 *      per format, or api's refusal for the same input — see `document-preview.ts`, whose fixtures are all
 *      synthetic. The `preview-converter-unavailable` and `preview-busy` scenarios reach api's 503 and 429.
 *  15. api D1's Masters list, bank holidays and extended process settings (`masters.ts`, `bank-holidays.ts`,
 *      `process-settings.ts`), in api's words: the Delivery Manager's writes, a revision and a stale-beats-no-op
 *      check on each, the window ordering rule, api's V42 holiday seed, and a judge linked to the unlinked entry
 *      holding their IDAM email on their first judicial request. Reads admit any staff caller; the subject a
 *      Master is linked to is never published.
 *  16. api D2's assignment (`assignReferral`): a referral raised with a `masterId` or assigned later goes to that
 *      Master, in api's checking order and words (an unavailable Master, a referral not waiting for a direction,
 *      the per-Master cap per referral window from `referral-windows.ts`); linking's and unlinking's referral
 *      side; `directionDueBy`; and the processing window's `unassignOverdue`, on api's request-time triggers and
 *      the explicit `/__mock` hook, against the mock's clock.
 *
 * They are restatements, and the authority is api's `DeedPollService`, `CaseStates`, `DeedPollValidation`,
 * `ReferenceNumbers`, `CaseQuery`, `ReferralService`, `ReferralNotes`, `JudicialReferralService`,
 * `CaseEmailService`, `GazetteNoticeHistory`, `DocumentPreviewService`, `MasterService`, `BankHolidays`, `ProcessSettingsService`, `RoleCapabilities`, `StaffArea` and `IdamAuthenticationConverter` — not this file. Everything else api does (the
 * privacy lock, the minor and Gazette write gates, create-time defaults, the saved-query permission rules —
 * see `savedQuery`) is deliberately NOT modelled: no
 * page's behaviour depends on it, and a half-copy would be a second opinion to keep in step. If a page
 * ever does depend on one, model it here and say so in this list.
 *
 * Two referral-shaped omissions, each for one of those reasons rather than by oversight:
 *
 *   - **The `caseworker-deedpoll-judicial` role gate on `/judicial/**`.** This mock reads a name out of a
 *     token and no roles on this surface, exactly as for the saved-query and witness-delete gates, so a 403
 *     is not a state those routes can produce. Gazette history separately models its admin gate. api's gate is api's own test.
 *   - **api's timer for the processing window.** `unassignOverdue` runs on api's request-time triggers here and on
 *     the `/__mock` hook, never on a timer of the mock's own: a journey drives it by moving the mock's clock and
 *     then asking, so nothing happens behind a test's back.
 *
 * **On the email surface this mock stands in for GOV.UK Notify as well as for api**, which none of the other
 * routes require. Three consequences, all deliberate:
 *
 *   - **It renders the preview and the sent body itself** — `renderEmail` — and a send drains immediately to
 *     `Sent` with that rendering stored, because api drains immediately too. The wording is a stand-in and
 *     nothing should assert on it: the real template is a content designer's, authored in Notify.
 *   - **It does NOT escape the caseworker's text into the preview HTML, where Notify does.** That is the awkward
 *     path made reachable rather than an opinion about Notify: decision 3 of
 *     `docs/plans/notify-2-caseworker-email-tab.md` renders that HTML in a sandboxed `iframe` precisely because
 *     it is not this app's to trust, and a mock that escaped would let the tab ship having only ever been given
 *     safe HTML. Do not read this as evidence that Notify passes markup through.
 *   - **`provisioned` is true**, because a mock with no Notify service is nevertheless the Notify service here.
 *     Deployed environments answer false until notify-0 runs, and what a tab does with false is tested by giving
 *     it both values in the page tests — the arrangement `editable` already has (see `savedQuery`).
 *
 * One email rule is restated only in part. V12 of api's schema narrowed the unique index so a **permanently
 * failed** row no longer blocks a re-send; here any existing row for the referral blocks. Nothing can reach the
 * difference — decision 10 of the plan forbids a retry control, so there is no second send to make — and
 * modelling it would mean storing a `failureVerdict` that appears on no response.
 *
 * **One half of the idempotency rule is unreachable rather than unmodelled**, and it is worth knowing which. "A
 * different key is a new send" holds here only where the per-referral rule does not already refuse the second one,
 * and the one template shipped is referral-driven — so within a case a fresh key still answers `enqueued: false`,
 * which is api's answer too (its V15 index refuses the insert whatever the key). What the key-keyed lookup adds on
 * this template is the 409 for a reused key, and across cases it is the whole answer: the same key on two cases is
 * two sends, because V19's index is `("deedPollId", "requestId")`. A template with no referral — notify-6's chase —
 * is what would reach the missing half, and it needs more than its entry in `MOCK_EMAIL_TEMPLATES`: `ComposedEmail`
 * carries a referral that is not optional and a row is keyed on it, where api's column is null for a case-driven
 * email. That is a change for whoever brings the chase here, and it is not made in advance of one.
 */

import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { z } from "zod";
import type {
  WireCaseDetail,
  WireCaseWrite,
  WireDocument,
  WireDocumentType,
  WireNote,
  WireReferral,
  WireSavedCase,
  WireSavedQuery,
  WireWitness
} from "../api/wire.js";
import { REFERRAL_REASON, REFERRAL_STATE, URGENCY, WIRE_SCHEMAS } from "../api/wire.js";
import { createBankHolidays } from "./bank-holidays.js";
import { callerAccess } from "./caller-access.js";
import { buildDocumentPreview, type DocumentPreviewMode, PREVIEW_BUSY_RETRY_AFTER_SECONDS } from "./document-preview.js";
import {
  APPLICATION_REJECTED,
  DEFAULT_SCENARIO,
  isMockScenario,
  MOCK_DOCUMENT_TYPES,
  MOCK_EMAIL_FAILURE_REASON,
  MOCK_EMAIL_TEMPLATES,
  MOCK_SCENARIOS,
  MOCK_WRITE_REJECTION,
  type MockEmailTemplate,
  type MockNotification,
  type MockScenario
} from "./fixtures.js";
import { createGazetteRequests } from "./gazette-requests.js";
import { createMasters } from "./masters.js";
import { createProcessSettings } from "./process-settings.js";
import { isWeekdayNotIn, type ReferralWindow, windowFor } from "./referral-windows.js";

/** Fixture-only batch input: full frozen membership, never a production send operation. */
const SEEDABLE_GAZETTE_BATCH = z
  .object({
    id: z.uuid().optional(),
    sentAt: WIRE_SCHEMAS.GazetteNoticeBatchResponse.shape.sentAt.unwrap().unwrap(),
    sentBy: z.string(),
    referenceNumbers: z.array(z.string())
  })
  .strict();

/** Five digits, zero-padded, as api's `ReferenceNumbers` formats it. */
const REFERENCE_SERIAL_DIGITS = 5;

/**
 * The header a send identifies its compose journey with — api's `CaseworkerEmailController.IDEMPOTENCY_KEY`.
 *
 * Lower-case because that is how `node:http` presents it, and named here rather than written twice: the refusal
 * body quotes the header to the caller, and a near-miss spelling in one of the two places would refuse every send
 * or accept every one.
 */
const IDEMPOTENCY_HEADER = "idempotency-key";

/** The spelling of the same header in a refusal, which quotes the caller's own contract back at them. */
const IDEMPOTENCY_HEADER_NAME = "Idempotency-Key";

/**
 * The canonical UUID, which is what api's `@RequestHeader(IDEMPOTENCY_KEY) UUID requestId` will parse.
 *
 * Case-insensitive and normalised on the way in, because api holds a `UUID` rather than the text it arrived as —
 * so two spellings of one key are one key, and a mock keyed on the string would answer a retry that re-cased it
 * with a second email.
 */
const IDEMPOTENCY_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `CaseEmailService.REQUEST_ALREADY_USED`, verbatim: one journey's key used for a second, different email.
 *
 * 409 rather than 400 because nothing in the payload is wrong — the same body under a request of its own would be
 * accepted — so the sentence says what to do rather than naming a field to correct. It quotes neither the key nor
 * either email's content: the key is transport and the content is the applicant's.
 */
const REQUEST_ALREADY_USED =
  "This send was already recorded for this case as a different email, so nothing was sent: start composing the email again, which gives it a request of its own";

/**
 * The types api serves `inline` rather than as an attachment, from its `INLINE_MIME_TYPES`.
 *
 * Narrower than the upload policy's list on purpose at api's end and therefore here: TIFF and the two
 * Word types are download-only because nothing renders them, and the renderable-and-dangerous types —
 * SVG, HTML — are on neither list.
 */
const INLINE_MIME_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);

/** The fields whose visibility or mandatoriness varies by type, per api's field-rule matrix. */
const RULED_FIELDS = [
  "inPerson",
  "maritalStatus",
  "ageOfMinor",
  "ageOfMinorMonths",
  "parents",
  "minorDateOfBirth",
  "urgency",
  "nationality",
  "nationalitySection",
  "nationalitySectionOther",
  "oldForename",
  "oldMiddleName",
  "oldSurname",
  "dateNoticeSentToLondonGazette"
] as const;

const MINOR_ONLY_FIELDS = ["minorDateOfBirth", "ageOfMinor", "ageOfMinorMonths", "parents"] as const;

/**
 * The fields a search term is matched against as a substring, from the published `q` description. A closed
 * list: addresses and the narrative fields are deliberately outside it.
 */
const SEARCHED_NAME_FIELDS = ["newForename", "newSurname", "oldForename", "oldSurname", "parents", "representativeName"] as const;

/** Relaxed to optional when Migrated Record = Yes, whatever the type. Visibility is untouched. */
const MIGRATED_RELAXED_FIELDS = [
  "inPerson",
  "maritalStatus",
  "ageOfMinor",
  "ageOfMinorMonths",
  "parents",
  "urgency",
  "nationality",
  "nationalitySection"
] as const;

/**
 * A seeded case, with every field optional and its dates coerced from strings.
 *
 * The saved-case schema rather than a list of date fields kept here, so the one place that decides how an
 * api date is read stays `wire.ts`.
 */
const SEEDABLE_CASE = WIRE_SCHEMAS.SavedCaseResponse.partial();

/**
 * The one field `POST /__mock/referrals/{id}/confirmation-request` accepts, coerced the same way.
 *
 * Picked off the referral schema rather than restated, for the reason `SEEDABLE_CASE` is the saved-case
 * schema: `wire.ts` is the only place that decides how an api date-time is read, and `confirmationRequestedAt`
 * is nullish there, so an absent value is legal and means "now".
 */
const SEEDABLE_CONFIRMATION_REQUEST = WIRE_SCHEMAS.ReferralResponse.pick({ confirmationRequestedAt: true });

/**
 * How a lifecycle note dates the referral it is about — api's `ReferralNotes.DAY`, `d MMMM yyyy`.
 *
 * The day rather than the instant, because a caseworker reads it in a grid. Formatted in UTC for the reason
 * `iso` publishes UTC: api's timestamps are zoneless `LocalDateTime`s, so a note formatted in the local zone
 * would date a midnight referral to the previous day west of Greenwich.
 */
/** api's `ReferralSchemas.SELECT_A_MASTER`. */
const SELECT_A_MASTER = "Select a Master who is available";
/** api's `ReferralNotes.MAX_JUDGE_NAME_LENGTH`. */
const MAX_MASTER_NAME_IN_NOTE = 200;
/** Who api attributes the processing window's release to, `CurrentUser.SERVICE_ACCOUNT_NAME`: no person did it. */
const SERVICE_ACCOUNT_NAME = "# svc_HMCTS_LCPT_Dev";
const NOTE_DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** api's `DeedPollService.WITNESSES_REQUIRED_FOR_ENROLMENT`. Restated because this file plays api. */
const WITNESSES_REQUIRED_FOR_ENROLMENT = 2;

/** api's `DeedPollService.ENROLMENT_WITNESSES_MESSAGE`, verbatim — the opening sentence of the refusal. */
const ENROLMENT_WITNESSES_MESSAGE = "A Deed Poll cannot be sent for enrolment until two witnesses have been recorded.";

/** The columns whose presence decides the state, and the audit columns a write stamps. */
const CASE_DEFAULTS = {
  privacy: "Normal",
  urgency: "Normal",
  migratedRecord: false,
  retainPermanently: false,
  publishToLondonGazette: true,
  // Present and null rather than absent, because api publishes the column either way: a page reading it off a
  // case it has never referred should see the value api sends, not the one a missing JSON key produces.
  currentReferralState: null,
  // The second denormalised column, for the same reason and with the same rule: it is recomputed from the
  // case's referrals rather than written by whatever moved one — see `refreshAwaitingConfirmation`.
  awaitingConfirmationSince: null
} as const;

/** The same table `GET /me` answers from, as api gates the Gazette on the capability its `/me` publishes. */
function hasGazetteAccess(claims: { roles?: unknown }): boolean {
  return callerAccess(claims).capabilities.includes("ACCESS_GAZETTE");
}

function hasProcessConfigAccess(claims: { roles?: unknown }): boolean {
  return callerAccess(claims).capabilities.includes("MANAGE_PROCESS_CONFIG");
}

/**
 * Build the mock. Nothing is listening until `listen` is called — `startMockApi` does that.
 *
 * State is closed over rather than module-level so two instances in one test process cannot see each
 * other's cases.
 */
export function createMockApi(options: MockApiOptions = {}): MockApi {
  const cases = new Map<string, MockCase>();
  let gazetteSettings: z.infer<typeof WIRE_SCHEMAS.GazetteSettingsResponse> = {
    recipientEmail: null,
    revision: 0,
    updatedAt: null,
    updatedBy: null
  };
  const gazetteRequests = createGazetteRequests();
  const processSettings = createProcessSettings();
  const masters = createMasters({ linked: attachToLinkedMaster, unlinked: detachFromUnlinkedMaster });
  const bankHolidays = createBankHolidays();
  const gazetteBatches = new Map<string, z.infer<typeof SEEDABLE_GAZETTE_BATCH>>();
  const savedQueries = new Map<string, MockSavedQuery>();
  /**
   * The ids in "my list", for the one notional caller this mock has.
   *
   * api keys the selection by the caller's subject, so two people can select the same shared query and one
   * unselecting it leaves the other's alone. **Not modelled**, for the same reason the permission rules are
   * not (see `savedQuery`): a set is enough for every journey a page can drive here, and a per-subject map
   * would look like it modelled two users while still reading no roles out of a token.
   */
  const selectedQueryIds = new Set<string>();
  let scenario: MockScenario = options.scenario ?? DEFAULT_SCENARIO;
  const serials = new Map<number, number>();
  /**
   * How far the referral clock runs ahead of (or behind) real time, which `/__mock/clock` moves. It dates a referral's
   * raise, assignment, claim and direction, its window and `directionDueBy`, and the processing window's cutoff, so a
   * journey can make an assignment overdue or cross a window. Notes and audit columns keep real time.
   */
  let clockOffsetMinutes = 0;

  const server = createServer((req, res) => {
    handle(req, res).catch((error) => {
      // A throw here is a bug in the mock, not a scenario. Answering 500 keeps a failing test's message
      // about its assertion rather than about a hung socket.
      send(res, 500, { error: `mock failed: ${error instanceof Error ? error.message : String(error)}` });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? "GET";
    const { pathname, searchParams } = new URL(req.url ?? "/", "http://localhost");

    // Both, because api serves both and they answer different questions — see `checkApiReachable`, which
    // probes the liveness group precisely so api's database cannot take this app's readiness down.
    if (method === "GET" && (pathname === "/health" || pathname === "/health/liveness")) {
      return send(res, 200, { status: "UP" });
    }

    if (method === "POST" && pathname === "/__mock/scenario") {
      const requested = ((await readJsonBody(req)) as { scenario?: unknown } | null)?.scenario;
      if (!isMockScenario(requested)) return send(res, 400, { error: `unknown scenario: ${String(requested)}` });
      scenario = requested;
      return send(res, 200, { scenario });
    }

    if (method === "POST" && pathname === "/__mock/clock") {
      const offset = ((await readJsonBody(req)) as { offsetMinutes?: unknown } | null)?.offsetMinutes;
      if (typeof offset !== "number" || !Number.isSafeInteger(offset)) return send(res, 400, { error: "offsetMinutes must be a whole number" });
      clockOffsetMinutes = offset;
      return send(res, 200, { now: clock().toISOString(), offsetMinutes: clockOffsetMinutes });
    }

    if (method === "POST" && pathname === "/__mock/referrals/unassign-overdue") {
      return send(res, 200, { released: unassignOverdue() });
    }

    if (method === "POST" && pathname === "/__mock/reset") {
      reset();
      return send(res, 200, { scenario });
    }

    if (method === "POST" && pathname === "/__mock/gazette-requests") {
      const result = gazetteRequests.seed(await readJsonBody(req));
      return send(res, result.status, result.body);
    }
    if (method === "POST" && pathname === "/__mock/gazette-outcome") {
      const result = gazetteRequests.configure(await readJsonBody(req));
      return send(res, result.status, result.body);
    }

    if (method === "POST" && pathname === "/__mock/gazette-batches") {
      const parsed = SEEDABLE_GAZETTE_BATCH.safeParse(await readJsonBody(req));
      if (!parsed.success) return send(res, 400, fieldErrorsFrom(parsed.error.issues));
      const id = parsed.data.id ?? randomUUID();
      if (gazetteBatches.has(id)) return send(res, 409, { error: "Batch already seeded" });
      gazetteBatches.set(id, { ...parsed.data, id });
      return send(res, 201, { id });
    }

    // Seeding, so a test can start from a case in a given state without driving the create form. Outside
    // the contract deliberately: it skips the refusals a real create applies.
    if (method === "POST" && pathname === "/__mock/cases") {
      const body = await readJsonBody(req);
      // `seed` holds a `MockCase`, whose dates are `Date` — which is what an in-process caller passes.
      // Over HTTP they arrive as the ISO strings `JSON.parse` leaves behind, and a string reaching
      // `isoDates` or `daysBetween` is a 500 that ALSO leaves the unusable record in the map, so every
      // later read of the list fails for the rest of the process. Coerced through the saved-case schema so
      // the formats accepted are the wire's, and merged back over the body so the children this route also
      // seeds survive the parse that would otherwise strip them.
      //
      // The case's own fields, not its children's: a document's bytes are a `Buffer` and no JSON body can
      // carry one, so a case WITH children is seeded in process through `mock.seed` instead.
      const coerced = SEEDABLE_CASE.safeParse(body ?? {});
      if (!coerced.success) return send(res, 400, fieldErrorsFrom(coerced.error.issues));

      const seeded = seed(body === null ? null : { ...(body as Partial<MockCase>), ...(coerced.data as Partial<MockCase>) });
      return send(res, 201, toDetail(seeded));
    }

    // Start the wait for an applicant's confirmation, which **nothing in the contract can do from out here**.
    // The write that sets `confirmationRequestedAt` at api's end is notify-3's *Request confirmation to
    // proceed* email, and `MOCK_EMAIL_TEMPLATES` carries only `application-rejected` — so a journey driven
    // through a browser has no way to reach the state the whole of notify-3b is about.
    //
    // A control route rather than a second mock template, deliberately: inventing the template would mean
    // inventing api's applicability rule for it as well, and this mock would then be answering a question api
    // owns. It is also not `POST /__mock/cases` widened to coerce a whole seeded referral — that route
    // coerces the case's own fields only, and teaching it to build a `MockReferral` would put a second
    // referral factory beside `createReferral`. So the referral is raised through the contract and only the
    // wait is arranged here.
    const waiting = /^\/__mock\/referrals\/([^/]+)\/confirmation-request$/.exec(pathname);
    if (waiting && method === "POST") {
      const referralId = decodeURIComponent(waiting[1]);
      const located = locateReferral(referralId);
      // The same sentence api's own 404 carries, so a seeder that names a referral wrongly reads the same as a
      // read that does.
      if (!located) return send(res, 404, { error: `Referral ${referralId} not found` });

      const requested = SEEDABLE_CONFIRMATION_REQUEST.safeParse((await readJsonBody(req)) ?? {});
      if (!requested.success) return send(res, 400, fieldErrorsFrom(requested.error.issues));

      // Absent means now, which is the day-zero case: api publishes `daysAwaitingConfirmation` as `0` on the
      // day the email went, never 1. A date is how a journey arranges a longer wait than this process has run.
      located.referral.confirmationRequestedAt = requested.data.confirmationRequestedAt ?? new Date();
      // The case's column is recomputed rather than written, exactly as `recordConfirmation` recomputes it:
      // this is api's denormalisation, and a second request on the same case must not move it forward.
      refreshAwaitingConfirmation(located.record);

      return send(res, 200, toWireReferral(located.referral));
    }

    // Everything below is the contract, so everything below is unreachable when the scenario says api is
    // down — including reads, which is what makes `api-unavailable` a realistic outage.
    if (!MOCK_SCENARIOS[scenario].reachable) return send(res, 503, { error: "deed-poll-api is unavailable" });

    if (pathname === "/me") {
      if (method !== "GET") return send(res, 405, { error: "Method not allowed" });
      const claims = await callerClaims(req, options.userInfoUrl);
      if (!claims) return send(res, 401, { error: "Authentication required" });
      return send(res, 200, callerAccess(claims));
    }

    if (pathname === "/caseworker/gazette-settings") {
      const claims = await callerClaims(req, options.userInfoUrl);
      if (!claims) return send(res, 401, { error: "Authentication required" });
      if (!hasGazetteAccess(claims)) {
        return send(res, 403, { error: "Delivery Manager role required" });
      }
      if (method === "GET") return send(res, 200, gazetteSettings);
      if (method !== "PUT") return send(res, 405, { error: "Method not allowed" });
      const parsed = WIRE_SCHEMAS.UpdateGazetteSettingsRequest.safeParse(await readJsonBody(req));
      if (!parsed.success)
        return send(res, 400, {
          error: "Invalid recipient settings",
          errors: parsed.error.issues.flatMap((issue) => {
            const field = issue.path[0];
            return typeof field === "string" ? [{ field, message: issue.message }] : [];
          })
        });
      if (parsed.data.revision !== gazetteSettings.revision) return send(res, 409, { error: "Recipient settings have changed" });
      if (parsed.data.recipientEmail !== gazetteSettings.recipientEmail) {
        gazetteSettings = {
          recipientEmail: parsed.data.recipientEmail,
          revision: gazetteSettings.revision + 1,
          updatedAt: new Date(),
          updatedBy: typeof claims.name === "string" ? claims.name : "Administrator"
        };
      }
      return send(res, 200, gazetteSettings);
    }

    if (pathname === "/caseworker/masters" || pathname.startsWith("/caseworker/masters/")) {
      const claims = await callerClaims(req, options.userInfoUrl);
      if (!claims) return send(res, 401, { error: "Authentication required" });
      const id = pathname === "/caseworker/masters" ? null : decodeURIComponent(pathname.slice("/caseworker/masters/".length));
      if (id === null && method === "GET") {
        if (!callerAccess(claims).staff) return send(res, 403, { error: "Deed poll staff role required" });
        return send(res, 200, masterList());
      }
      if (id?.includes("/")) return send(res, 404, { error: "Not found" });
      if ((id === null && method !== "POST") || (id !== null && method !== "PATCH")) return send(res, 405, { error: "Method not allowed" });
      if (!hasProcessConfigAccess(claims)) return send(res, 403, { error: "Delivery Manager role required" });
      const result = id === null ? masters.create(await readJsonBody(req)) : masters.update(id, await readJsonBody(req));
      return send(res, result.status, result.body);
    }

    if (pathname === "/caseworker/process-settings/bank-holidays" || pathname.startsWith("/caseworker/process-settings/bank-holidays/")) {
      const claims = await callerClaims(req, options.userInfoUrl);
      if (!claims) return send(res, 401, { error: "Authentication required" });
      const date =
        pathname === "/caseworker/process-settings/bank-holidays"
          ? null
          : decodeURIComponent(pathname.slice("/caseworker/process-settings/bank-holidays/".length));
      if (date === null && method === "GET") {
        if (!callerAccess(claims).staff) return send(res, 403, { error: "Deed poll staff role required" });
        return send(res, 200, bankHolidays.list());
      }
      if ((date === null && method !== "POST") || (date !== null && method !== "DELETE")) return send(res, 405, { error: "Method not allowed" });
      if (!hasProcessConfigAccess(claims)) return send(res, 403, { error: "Delivery Manager role required" });
      if (date !== null) return bankHolidays.remove(date) ? sendNoContent(res) : send(res, 404, { error: "No such bank holiday" });
      const result = bankHolidays.add(await readJsonBody(req));
      return send(res, result.status, result.body);
    }

    if (pathname === "/caseworker/process-settings") {
      const claims = await callerClaims(req, options.userInfoUrl);
      if (!claims) return send(res, 401, { error: "Authentication required" });
      if (!hasProcessConfigAccess(claims)) return send(res, 403, { error: "Delivery Manager role required" });
      if (method === "GET") return send(res, 200, processSettings.read());
      if (method !== "PUT") return send(res, 405, { error: "Method not allowed" });
      const result = processSettings.update(await readJsonBody(req), typeof claims.name === "string" ? claims.name : "Delivery Manager");
      return send(res, result.status, result.body);
    }

    if (
      pathname === "/caseworker/gazette-notice-previews" ||
      pathname === "/caseworker/gazette-notice-requests" ||
      pathname.startsWith("/caseworker/gazette-notices/") ||
      (pathname === "/caseworker/gazette-notices" && method === "POST")
    ) {
      const claims = await callerClaims(req, options.userInfoUrl);
      if (!claims) return send(res, 401, { error: "Authentication required" });
      if (!hasGazetteAccess(claims)) {
        return send(res, 403, { error: "Delivery Manager role required" });
      }
      if (method === "POST" && (typeof claims.sub !== "string" || !claims.sub)) return send(res, 401, { error: "Subject required" });
      const result = gazetteRequests.handle(
        {
          method,
          path: pathname,
          query: searchParams,
          body: method === "POST" ? await readJsonBody(req) : undefined,
          key: req.headers["idempotency-key"],
          subject: typeof claims.sub === "string" ? claims.sub : "",
          name: typeof claims.name === "string" ? claims.name : "Administrator"
        },
        { cases, settings: gazetteSettings, batches: gazetteBatches }
      );
      if (result.loseResponse) {
        res.destroy();
        return;
      }
      if (pathname === "/caseworker/gazette-notices" && result.status < 300 && result.body && typeof result.body === "object" && "batchId" in result.body)
        res.setHeader("Location", `/caseworker/gazette-notices/${result.body.batchId}`);
      return send(res, result.status, result.body);
    }

    // GazetteNoticeHistory reads frozen batches, independently of today's case records.
    if (pathname === "/caseworker/gazette-notices") {
      const claims = await callerClaims(req, options.userInfoUrl);
      if (!claims) return send(res, 401, { error: "Authentication required" });
      if (!hasGazetteAccess(claims)) {
        return send(res, 403, { error: "Delivery Manager role required" });
      }
      if (method !== "GET") return send(res, 405, { error: "No Gazette write operation" });
      const paging = parsePaging(searchParams.get("page"), searchParams.get("size"));
      if ("errors" in paging) return send(res, 400, { error: "Invalid paging", errors: paging.errors });
      const ordered = [...gazetteBatches.values()].sort((a, b) => rank(b.sentAt, a.sentAt) || rank(b.id, a.id));
      const from = (paging.page - 1) * paging.size;
      const batches = ordered.slice(from, from + paging.size).map((batch) => ({
        batchId: batch.id,
        sentAt: iso(batch.sentAt),
        sentBy: batch.sentBy,
        caseCount: batch.referenceNumbers.length,
        // PostgreSQL COLLATE "C" orders UTF-8 bytes, not the host's locale.
        referenceNumbers: [...batch.referenceNumbers].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))).slice(0, 100),
        referencesTruncated: batch.referenceNumbers.length > 100
      }));
      return send(res, 200, { batches, ...paging, total: ordered.length, totalPages: Math.ceil(ordered.length / paging.size) });
    }

    if (method === "GET" && pathname === "/caseworker/document-types") return send(res, 200, MOCK_DOCUMENT_TYPES);

    // The collection before the `{id}` pattern, for the reason recorded above the field-rules route: matched
    // the other way round, a `PUT /caseworker/saved-queries/…` would be reached but the bare collection would
    // not, and the literal path is the one Spring resolves first.
    if (pathname === "/caseworker/saved-queries") {
      // Ordered by name, as api v1 orders them — its own open question, and a page that renders them in the
      // order it is given would otherwise be seeing insertion order here and something else deployed.
      if (method === "GET") return send(res, 200, [...savedQueries.values()].sort((left, right) => rank(left.name, right.name)).map(toWireSavedQuery));
      if (method === "POST") return createSavedQuery(req, res);
      return send(res, 405, { error: `no such route: ${method} ${pathname}` });
    }

    const query = /^\/caseworker\/saved-queries\/([^/]+)(\/selection)?$/.exec(pathname);
    if (query) return savedQuery(req, res, method, decodeURIComponent(query[1]), query[2] !== undefined);

    // A sibling namespace to `/caseworker`, not a section of it, so its own branch rather than a widening of
    // the case-scoped pattern below: a judicial path carries no case id, because api resolves the case from
    // the referral precisely so a judge cannot name an application.
    // api's `MasterLinking` interceptor, on every judicial path before the request is answered.
    if (pathname.startsWith("/judicial/")) await linkJudicialCaller(req);

    if (pathname === "/judicial/referrals") {
      if (method === "GET") {
        unassignOverdue();
        return judicialPool(res, searchParams);
      }
      return send(res, 405, { error: `no such route: ${method} ${pathname}` });
    }

    // **Before the referral pattern below, and that ordering is load-bearing.** api gets it from Spring, which
    // resolves a literal path segment ahead of a template one; here the patterns are tried in the order they are
    // written, so matched the other way round `mine` would be read as a referral id and answer the 404 an unknown
    // one gets — for a page that exists. `referrals-admin-6` decision 6, and `server.test.ts` asserts the dispatch
    // rather than trusting this comment.
    if (pathname === "/judicial/referrals/mine") {
      if (method === "GET") {
        unassignOverdue();
        return myReferrals(req, res, searchParams);
      }
      return send(res, 405, { error: `no such route: ${method} ${pathname}` });
    }

    const judicial = /^\/judicial\/referrals\/([^/]+)(?:\/(claim|direction|direction\/withdraw|documents\/([^/]+)\/(file|preview)))?$/.exec(pathname);
    if (judicial) {
      const documentId = judicial[3] === undefined ? undefined : decodeURIComponent(judicial[3]);
      return judicialReferral(req, res, method, decodeURIComponent(judicial[1]), documentId === undefined ? judicial[2] : judicial[4], documentId);
    }

    // Before the `{id}` route, exactly as api relies on Spring ordering a literal pattern first: matched
    // the other way round, "field-rules" would be read as a case id and answer 404 for a route that exists.
    if (method === "GET" && pathname === "/caseworker/cases/field-rules") return fieldRules(res, searchParams);

    if (pathname === "/caseworker/cases") {
      if (method === "GET" && searchParams.get("filter") === "readyForPublication") {
        const claims = await callerClaims(req, options.userInfoUrl);
        if (!claims) return send(res, 401, { error: "Authentication required" });
        if (!hasGazetteAccess(claims)) return send(res, 403, { error: "Delivery Manager role required" });
      }
      if (method === "GET") return list(res, searchParams);
      if (method === "POST") return createCase(req, res);
      return send(res, 405, { error: `no such route: ${method} ${pathname}` });
    }

    // The trailing group is an ACTION on the child rather than a second child id — `/file` on a document,
    // `/withdrawal`, `/closure`, `/confirmation` and `/assignment` on a referral, `/preview` on an email — which is why they
    // share one group. An email's "child" is its template key rather than a stored row's id, which is api's shape
    // too: the key is the only thing that identifies which email is being composed.
    const scoped =
      /^\/caseworker\/cases\/([^/]+)(?:\/(notes|witnesses|documents|referrals|emails)(?:\/([^/]+))?)?(?:\/(file|withdrawal|closure|confirmation|preview|assignment))?$/.exec(
        pathname
      );
    if (!scoped) return send(res, 404, { error: `no such route: ${method} ${pathname}` });

    const [, rawId, collection, childId, action] = scoped;
    const found = cases.get(decodeURIComponent(rawId));
    if (!found) return send(res, 404, { error: `DeedPoll ${decodeURIComponent(rawId)} not found` });

    if (collection === undefined) {
      if (method === "GET") return send(res, 200, toDetail(found));
      if (method === "PATCH") return patchCase(req, res, found);
      return send(res, 405, { error: `no such route: ${method} ${pathname}` });
    }

    if (collection === "notes") return notes(req, res, method, found, childId);
    if (collection === "witnesses") return witnesses(req, res, method, found, childId);
    if (collection === "documents") return documents(req, res, method, found, childId, action);
    if (collection === "referrals") return referrals(req, res, method, found, childId, action);
    if (collection === "emails") return emails(req, res, method, found, childId, action === "preview");

    return send(res, 404, { error: `no such route: ${method} ${pathname}` });
  }

  /**
   * One page of the list: the search term, the saved-query filter, the field-level conditions, the order
   * and the page.
   *
   * Refusals are sent in api's order — the conditions, then the sort, then the paging — each as its own
   * 400, because that is the order `CaseworkerReadController` parses them in and a page rendering the
   * first refusal it is given should see the same one either way. The condition errors are addressed to
   * `where.0`, `where.1` … since the parameter is repeated and a position is the only thing that says
   * which of three conditions was the wrong one.
   *
   * `q` is not refusable: a blank term is no search and a long one is truncated by api rather than
   * rejected, so there is no 400 to send and it is applied with the rest of the narrowing.
   */
  function list(res: ServerResponse, parameters: URLSearchParams): void {
    const where = parameters.getAll("where");
    // The cap alone, before the conditions are read: a request over it is refused whole, as api refuses it.
    if (where.length > MAX_CONDITIONS) {
      const message = `takes at most ${MAX_CONDITIONS} conditions, and was given ${where.length}`;
      send(res, 400, { error: "Case query is not valid", errors: [{ field: "where", message }] });
      return;
    }

    const conditions: MockCondition[] = [];
    const conditionErrors: MockFieldError[] = [];
    where.forEach((entry, index) => {
      const parsed = parseCondition(entry);
      if (typeof parsed === "string") conditionErrors.push({ field: `where.${index}`, message: parsed });
      else conditions.push(parsed);
    });
    if (conditionErrors.length > 0) {
      send(res, 400, { error: "Case query is not valid", errors: conditionErrors });
      return;
    }

    // The filter is resolved before the sort is parsed, because the tab supplies the default order a request
    // that named none falls back to — `awaitingConfirmation` is longest-waiting first where every other tab is
    // newest first. Resolving it here changes no refusal order: an unrecognised key falls back rather than
    // failing, so this cannot answer a 400 ahead of the sort's.
    const resolved = FILTERS.find((candidate) => candidate.key === parameters.get("filter")) ?? FILTERS[0];

    const order = parseSort(parameters.get("sort"), resolved.defaultSort);
    if (typeof order === "string") {
      send(res, 400, { error: "Case list sort is not valid", errors: [{ field: "sort", message: order }] });
      return;
    }

    const paging = parsePaging(parameters.get("page"), parameters.get("size"));
    if ("errors" in paging) {
      send(res, 400, { error: "Case list paging is not valid", errors: paging.errors });
      return;
    }

    const term = (parameters.get("q") ?? "").trim();
    const matching = [...cases.values()]
      .filter((record) => resolved.matches(record))
      .filter((record) => conditions.every((condition) => matchesCondition(record, condition)))
      .filter((record) => term === "" || matchesTerm(record, term))
      .sort(comparing(order));

    const from = (paging.page - 1) * paging.size;

    send(res, 200, {
      filter: resolved.key,
      cases: matching.slice(from, from + paging.size).map(toSummary),
      page: paging.page,
      // The exact-reference hit among the cases the whole query left, so a term whose case the filter or a
      // condition excluded does not redirect a page past the empty list it asked for.
      referenceMatch: matching.find((record) => matchesReference(record, term))?.id ?? null,
      size: paging.size,
      total: matching.length,
      // Zero pages for an empty result set, as `CaseResults` derives it: "page 1 of 0" tells the truth
      // about a list with nothing in it where "page 1 of 1" claims a page that has no rows on it.
      totalPages: Math.ceil(matching.length / paging.size)
    });
  }

  async function createCase(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const parsed = WIRE_SCHEMAS.CreateCaseRequest.safeParse(await readJsonBody(req));
    if (!parsed.success) return send(res, 400, fieldErrorsFrom(parsed.error.issues));
    if (MOCK_SCENARIOS[scenario].caseWrite === "reject") return send(res, 400, MOCK_WRITE_REJECTION);

    const patch = parsed.data as Partial<MockCase>;
    const dateErrors = dateRuleErrors(patch);
    if (dateErrors.length > 0) return send(res, 400, { error: "Case dates are inconsistent", errors: dateErrors });

    // api derives the year before it touches the counter, so a create with no Date Received consumes no
    // serial. The refusal is attributed to the field, which is what the new-case form renders it against.
    const year = patch.dateReceived?.getUTCFullYear();
    if (year === undefined) {
      return send(res, 400, {
        error: "Cannot allocate a reference number without a Date Received to derive the year",
        errors: [{ field: "dateReceived", message: "Enter the date the application was received" }]
      });
    }

    const serial = (serials.get(year) ?? 0) + 1;
    serials.set(year, serial);

    const now = new Date();
    const author = auditName(req);
    const record: MockCase = {
      ...CASE_DEFAULTS,
      ...patch,
      id: randomUUID(),
      referencenumber: serial,
      displayReference: `${prefixFor(patch.type)}${year}-${String(serial).padStart(REFERENCE_SERIAL_DIGITS, "0")}`,
      state: deriveState(patch),
      iShall: patch.iShall ?? [],
      iHaveSubscribed: patch.iHaveSubscribed ?? [],
      andAlsoMyOld: patch.andAlsoMyOld ?? [],
      createdOn: now,
      modifiedOn: now,
      createdBy: author,
      modifiedBy: author,
      notes: [],
      witnesses: [],
      documents: [],
      referrals: [],
      notifications: []
    };
    cases.set(record.id, record);

    return send(res, 201, toSaved(record));
  }

  async function patchCase(req: IncomingMessage, res: ServerResponse, record: MockCase): Promise<void> {
    const parsed = WIRE_SCHEMAS.UpdateCaseRequest.safeParse(await readJsonBody(req));
    if (!parsed.success) return send(res, 400, fieldErrorsFrom(parsed.error.issues));
    if (MOCK_SCENARIOS[scenario].caseWrite === "reject") return send(res, 400, MOCK_WRITE_REJECTION);

    // Merged before the rules run, for the reason api's own update does: a patch setting one date of a
    // pair is valid or not depending on the other, which it may never mention. Then gated, as api's
    // `applyGazetteGate` and `applyMinorGate` gate the merged record: admin leaves a field its rules hide out
    // of the patch (review finding R02), so this is what clears one.
    const merged = writeGates({ ...record, ...(parsed.data as Partial<MockCase>) });
    const dateErrors = dateRuleErrors(merged);
    if (dateErrors.length > 0) return send(res, 400, { error: "Case dates are inconsistent", errors: dateErrors });

    // After the date rules, as api orders them: a patch that contradicts a pair is refused for that before
    // the witness count is looked at, so the caseworker is told about one thing at a time.
    const witnessError = enrolmentWitnessError(record, parsed.data as Partial<MockCase>, merged);
    if (witnessError) return send(res, 400, { error: "Case cannot be sent for enrolment", errors: [witnessError] });

    Object.assign(record, merged, {
      state: deriveState(merged),
      // The prefix is recomputed from the new type; the year and serial are never re-allocated.
      displayReference: reprefix(record.displayReference, merged.type),
      modifiedOn: new Date(),
      modifiedBy: auditName(req)
    });

    return send(res, 200, toSaved(record));
  }

  async function notes(req: IncomingMessage, res: ServerResponse, method: string, record: MockCase, noteId: string | undefined): Promise<void> {
    if (noteId === undefined) {
      // Newest first, as `NoteService.findNotes` orders it — and unlike the `notes` on the case detail, which
      // api publishes oldest first. See `newestFirst` for why the two differ.
      if (method === "GET") return send(res, 200, newestFirst(record.notes).map(toWireNote));
      if (method === "POST") {
        const parsed = WIRE_SCHEMAS.CreateNoteRequest.safeParse(await readJsonBody(req));
        if (!parsed.success) return send(res, 400, fieldErrorsFrom(parsed.error.issues));

        const now = new Date();
        const author = auditName(req);
        const created: MockNote = {
          id: randomUUID(),
          note: parsed.data.note.trim(),
          createdOn: now,
          modifiedOn: now,
          createdBy: author,
          modifiedBy: author
        };
        record.notes.push(created);
        return send(res, 201, toWireNote(created));
      }
      return send(res, 405, { error: `no such route: ${method} on notes` });
    }

    const id = decodeURIComponent(noteId);
    const index = record.notes.findIndex((note) => note.id === id);
    if (index === -1) return send(res, 404, { error: `Note ${id} not found` });
    const note = record.notes[index];

    if (method === "GET") return send(res, 200, toWireNote(note));

    if (method === "PATCH") {
      const parsed = WIRE_SCHEMAS.UpdateNoteRequest.safeParse(await readJsonBody(req));
      if (!parsed.success) return send(res, 400, fieldErrorsFrom(parsed.error.issues));

      // An empty patch re-stamps the author and nothing else, which is api's documented behaviour.
      if (parsed.data.note !== undefined) note.note = parsed.data.note.trim();
      note.modifiedOn = new Date();
      note.modifiedBy = auditName(req);
      return send(res, 200, toWireNote(note));
    }

    if (method === "DELETE") {
      record.notes.splice(index, 1);
      return sendNoContent(res);
    }

    return send(res, 405, { error: `no such route: ${method} on a note` });
  }

  /**
   * A case's witnesses: list, add, read, amend and delete.
   *
   * No author is stamped and none is accepted — `deedpoll_witness` holds the two timestamps and no author
   * columns, so `auditName` has nothing to attribute here. Values go in untrimmed, unlike a note's text:
   * api's `WitnessSchemas` stores what it was given and says so.
   *
   * **The delete's Administrator gate is not modelled**, exactly as the note delete's is not: this mock
   * takes a token to name an audit author and reads no roles out of one, so a 403 is not a state it can
   * produce. What decides who is offered the control is `canDeleteWitness`, tested against the user rather
   * than against api, and api's own gate is tested in api's repo.
   */
  async function witnesses(req: IncomingMessage, res: ServerResponse, method: string, record: MockCase, witnessId: string | undefined): Promise<void> {
    if (witnessId === undefined) {
      if (method === "GET") return send(res, 200, record.witnesses.map(toWireWitness));
      if (method === "POST") {
        const parsed = WIRE_SCHEMAS.CreateWitnessRequest.safeParse(await readJsonBody(req));
        if (!parsed.success) return send(res, 400, fieldErrorsFrom(parsed.error.issues));

        const now = new Date();
        const created: WireWitness = { id: randomUUID(), ...parsed.data, createdOn: now, modifiedOn: now };
        record.witnesses.push(created);
        return send(res, 201, toWireWitness(created));
      }
      return send(res, 405, { error: `no such route: ${method} on witnesses` });
    }

    const id = decodeURIComponent(witnessId);
    const index = record.witnesses.findIndex((candidate) => candidate.id === id);
    // Only this case's list is searched, which is api's scoping rule: a witness of another case is a 404
    // here rather than a row read through the wrong parent.
    if (index === -1) return send(res, 404, { error: `Witness ${id} not found` });
    const witness = record.witnesses[index];

    if (method === "GET") return send(res, 200, toWireWitness(witness));

    if (method === "PATCH") {
      const parsed = WIRE_SCHEMAS.UpdateWitnessRequest.safeParse(await readJsonBody(req));
      if (!parsed.success) return send(res, 400, fieldErrorsFrom(parsed.error.issues));

      // An omitted field is absent from the parsed patch rather than present as undefined, so an empty
      // patch re-stamps `modifiedOn` and changes nothing else — api's documented behaviour.
      Object.assign(witness, parsed.data, { modifiedOn: new Date() });
      return send(res, 200, toWireWitness(witness));
    }

    if (method === "DELETE") {
      record.witnesses.splice(index, 1);
      return sendNoContent(res);
    }

    return send(res, 405, { error: `no such route: ${method} on a witness` });
  }

  async function documents(
    req: IncomingMessage,
    res: ServerResponse,
    method: string,
    record: MockCase,
    documentId: string | undefined,
    action: string | undefined
  ): Promise<void> {
    if (documentId === undefined && method === "POST") {
      const upload = parseMultipart(await readRawBody(req), req.headers["content-type"] ?? "");
      if (!upload?.file) return send(res, 400, { error: "Select a file to upload", errors: [{ field: "file", message: "Select a file to upload" }] });

      const documentTypeId = upload.fields.documentTypeId;
      const documentType = MOCK_DOCUMENT_TYPES.find((candidate) => candidate.id === documentTypeId);
      if (!documentType) return send(res, 404, { error: `Document type ${documentTypeId} not found` });

      const now = new Date();
      const created: MockDocument = {
        id: randomUUID(),
        name: (upload.fields.name || upload.file.name).slice(0, 100),
        documentType,
        direction: upload.fields.direction === "Outgoing" ? "Outgoing" : "Incoming",
        originalName: upload.file.name,
        mimeType: upload.file.mimeType,
        sizeBytes: upload.file.bytes.length,
        bytes: upload.file.bytes,
        createdOn: now,
        modifiedOn: now
      };
      record.documents.push(created);
      return send(res, 201, toWireDocument(created));
    }

    if (documentId !== undefined && method === "GET" && (action === "file" || action === "preview")) {
      const id = decodeURIComponent(documentId);
      const document = record.documents.find((candidate) => candidate.id === id);
      if (!document) return send(res, 404, { error: `Document ${id} not found` });

      return action === "file" ? sendDocumentFile(res, document) : sendDocumentPreview(res, document, MOCK_SCENARIOS[scenario].documentPreview);
    }

    return send(res, 404, { error: `no such route: ${method} on documents` });
  }

  /**
   * A case's referrals to the judiciary: list, raise, read one, withdraw and close.
   *
   * Newest first, as api's `findByDeedPollIdOrderByCreatedOnDesc` answers — a tab rendering them in the order
   * it is given would otherwise see insertion order here and the reverse deployed.
   *
   * The two caseworker transitions are guarded as api guards them, and the difference between the two guards
   * is api's rather than an inconsistency: withdrawal asks `canBeWithdrawn`, because a referral a judge is
   * holding is still withdrawable but one they have directed is not, and closure names `Decided` alone,
   * because closing anything else would relabel a referral nobody directed as one that was actioned.
   *
   * **Withdrawal's refusal carries two messages, as api's does**, because the caseworker's next move differs:
   * a `Decided` referral has a direction on it to carry out and close, while a `Closed` or `Withdrawn` one is
   * over. Reusing "already Decided" would tell someone reading a returned direction that they had already
   * withdrawn it.
   */
  async function referrals(
    req: IncomingMessage,
    res: ServerResponse,
    method: string,
    record: MockCase,
    referralId: string | undefined,
    action: string | undefined
  ): Promise<void> {
    if (referralId === undefined) {
      if (method === "GET")
        return send(res, 200, [...record.referrals].sort((left, right) => right.createdOn.getTime() - left.createdOn.getTime()).map(toWireReferral));
      if (method === "POST") return createReferral(req, res, record);
      return send(res, 405, { error: `no such route: ${method} on referrals` });
    }

    const id = decodeURIComponent(referralId);
    // Only this case's list is searched, which is api's scoping rule: a referral of another case is a 404
    // here rather than a row read through the wrong parent.
    const referral = record.referrals.find((candidate) => candidate.id === id);
    if (!referral) return send(res, 404, { error: `Referral ${id} not found` });

    if (method === "GET" && action === undefined) return send(res, 200, toWireReferral(referral));

    if (method === "POST" && action === "withdrawal") {
      // Not idempotent-and-silent: a second withdrawal is a caseworker acting on a stale screen, and
      // answering 200 would tell them their click did something it did not.
      if (!canBeWithdrawn(referral.state)) return send(res, 409, { error: withdrawalRefusal(id, referral.state) });

      // The note is written after the transition and never beside the guard above, which is what makes a
      // refused withdrawal leave the timeline alone — api writes it inside the same transaction for that
      // reason. Written here rather than inside `transition` because each event has its own prose and its own
      // author: a helper that wrote one note for every transition would put a withdrawal's words on a claim.
      const withdrawnBy = auditName(req);
      const withdrawn = transition(record, referral, withdrawnBy, { state: "Withdrawn" });
      appendNote(record, referralWithdrawnNote(withdrawn), withdrawnBy);

      return send(res, 200, toWireReferral(withdrawn));
    }

    if (method === "POST" && action === "closure") {
      if (referral.state !== "Decided") return send(res, 409, { error: `Referral ${id} is ${referral.state} and can only be closed once it is Decided` });

      // The caseworker who actioned the direction, not the judge who gave it: `decidedBy` on the referral still
      // says who directed it, and this note's author is who carried it out.
      const closedBy = auditName(req);
      const closed = transition(record, referral, closedBy, { state: "Closed" });
      appendNote(record, referralActionedNote(closed), closedBy);

      return send(res, 200, toWireReferral(closed));
    }

    if (method === "POST" && action === "confirmation") return recordConfirmation(req, res, record, referral);
    if (method === "PUT" && action === "assignment") return reassign(req, res, record, referral);

    return send(res, 405, { error: `no such route: ${method} on a referral` });
  }

  /**
   * Record the applicant's answer to *Request confirmation to proceed*.
   *
   * **The only referral write that moves no state**, which is why it does not go through `transition`: api's
   * `recordConfirmation` writes the four confirmation columns, a case note and the case's
   * `awaitingConfirmationSince`, and deliberately leaves `state`, `currentReferralState` and every case date
   * alone. So there is nothing for `refreshCurrentReferralState` to recompute here.
   *
   * **The refusals are in api's order — already-recorded first, never-asked second** — so a referral that
   * somehow holds an outcome without a request answers the first message. Both are 409s and they are
   * distinguishable only by their prose, which is why neither is a code a caller can branch on.
   *
   * Neither the recorder nor the received date is read off the body. api's schema publishes
   * `additionalProperties: true`, so one sent here is IGNORED rather than refused — copied deliberately, because
   * a mock that answered 400 would let this app ship a body api silently drops.
   */
  async function recordConfirmation(req: IncomingMessage, res: ServerResponse, record: MockCase, referral: MockReferral): Promise<void> {
    const parsed = WIRE_SCHEMAS.RecordConfirmationRequest.safeParse(await readJsonBody(req));
    if (!parsed.success) return send(res, 400, fieldErrorsFrom(parsed.error.issues));

    // After the body, as api orders them: Spring validates the payload before the service's guards run, and the
    // same request succeeds unchanged once the referral has been asked — so each 409 is a state rather than a
    // malformed body.
    if (referral.confirmationOutcome) return send(res, 409, { error: alreadyConfirmedRefusal(referral) });
    if (!referral.confirmationRequestedAt) {
      return send(res, 409, {
        error: `Referral ${referral.id} has not been asked to confirm whether the applicant wants to proceed, so there is no answer to record`
      });
    }

    const now = new Date();
    const recordedBy = auditName(req);
    Object.assign(referral, {
      confirmationOutcome: parsed.data.outcome,
      // api's own clock, so this is when the caseworker recorded the reply and never when the applicant sent it.
      confirmationReceivedAt: now,
      confirmationRecordedBy: recordedBy,
      modifiedBy: recordedBy,
      modifiedOn: now
    });
    // Composed from the stored referral rather than from the body, as api composes it: the note reads the outcome
    // as it was saved. api trims the note and treats a whitespace-only one as none, so the note does too.
    appendNote(record, confirmationRecordedNote(referral, parsed.data.note?.trim() || null), recordedBy);
    // How the case leaves the awaiting-confirmation worklist, and by recompute rather than by writing null: a
    // case can hold a second outstanding request, and this one's answer does not end that wait.
    refreshAwaitingConfirmation(record);

    return send(res, 200, toWireReferral(referral));
  }

  /**
   * Raise a referral, assigned to the Master `masterId` names or, without one, `Open` and waiting for assignment.
   *
   * The state is not the caller's to choose, so it is not read off the body. `migrated` is false because a
   * caseworker raised it — the flag exists to explain why a backfilled referral has no reasons.
   *
   * The 409 comes after the body checks, as api orders them: at most one referral of a case may be live, and
   * the same request succeeds unchanged once that one is closed or withdrawn, so it is a state rather than a
   * malformed body. With a `masterId` the assignment's own refusals follow (`assignmentRefusal`), and a refused
   * one refuses the whole create, as api's one transaction does. A created and assigned referral has two notes,
   * the raise's and then the assignment's.
   */
  async function createReferral(req: IncomingMessage, res: ServerResponse, record: MockCase): Promise<void> {
    const parsed = WIRE_SCHEMAS.CreateReferralRequest.safeParse(await readJsonBody(req));
    if (!parsed.success) return send(res, 400, fieldErrorsFrom(parsed.error.issues));

    const conditional = referralConditionalErrors(parsed.data);
    if (conditional.length > 0) return send(res, 400, { error: "Referral is not valid", errors: conditional });

    if (record.referrals.some((candidate) => !isTerminal(candidate.state))) {
      return send(res, 409, { error: `Case ${record.id} already has a referral that has not been closed or withdrawn` });
    }

    const now = clock();
    const master = parsed.data.masterId === undefined ? null : masters.assignee(parsed.data.masterId);
    if (master !== null) {
      const refused = assignmentRefusal(master, now);
      if (refused) return send(res, refused.status, refused.body);
    }
    const author = auditName(req);
    const created: MockReferral = {
      id: randomUUID(),
      state: "Open",
      reasons: [...parsed.data.reasons],
      notes: parsed.data.notes?.trim() || null,
      // api defaults an absent urgency to `Normal` rather than storing none, so the pool's first sort key is
      // never blank.
      urgency: parsed.data.urgency ?? "Normal",
      urgencyReason: parsed.data.urgencyReason?.trim() || null,
      migrated: false,
      claimedBy: null,
      claimedById: null,
      claimedAt: null,
      decision: null,
      directionsText: null,
      changesToStandardPublication: null,
      decisionDate: null,
      decidedBy: null,
      decidedById: null,
      directionChangedAt: null,
      // All four null on a raise: the wait starts when *Request confirmation to proceed* is sent, which is a
      // later event and another package's write at api's end.
      confirmationRequestedAt: null,
      confirmationOutcome: null,
      confirmationReceivedAt: null,
      confirmationRecordedBy: null,
      createdBy: author,
      modifiedBy: author,
      createdOn: now,
      modifiedOn: now
    };
    record.referrals.push(created);
    // The caseworker who raised it, from the same token the referral's own audit columns took — api writes the
    // note inside the create's transaction, so a refused create leaves none.
    appendNote(record, referralRaisedNote(created), author);
    if (master) assign(record, created, master, author, now);
    refreshCurrentReferralState(record);

    return send(res, 201, toWireReferral(created));
  }

  /**
   * A case's emails: what may be sent, what one would look like, and sending it.
   *
   * Three operations and no fourth, which is api's surface: an email is owed or it is not, and an owed one is
   * either accepted by Notify or fails with a reason on its row. There is no route to read one row back by id —
   * the per-email page reads it out of the `GET`'s history, which is why that response carries the content.
   *
   * The refusals in order, because the order is api's and a page renders the first one it is given: a send with no
   * usable `Idempotency-Key` is a 400 before anything else is looked at, then an unknown template key is a 404,
   * then a case in no state to send is a 409, then a slot payload is a 400, then a case with no applicant email
   * address is a 422.
   *
   * **The header is checked ahead of the template's own 404, and that is api's order rather than a choice here.**
   * api binds it as `@RequestHeader(IDEMPOTENCY_KEY) UUID requestId` and Spring resolves every argument before the
   * handler body runs, so a send carrying no header never reaches `requireTemplate`. Only the send binds one: the
   * preview writes nothing, so there is nothing about it to make idempotent, and requiring one there would make
   * every check-page render need a key of its own.
   *
   * **The payload is checked before the recipient here, and api stopped doing that in notify-6.** This said api's
   * javadoc claimed the reverse while its code did this, which was true when it was written and is not now: api's
   * `2f6f8d8` split `compose` into `entitle` + `compose` and put `requireRecipient` between them, so at master
   * `b01f8f4` the order is entitlement, then the address, then the payload — its prose and its code agree and this
   * mock is the one that disagrees. Reachable only by a case with no applicant email address AND an unacceptable
   * payload, which answers 422 at api and 400 here. Left as a recorded divergence rather than quietly reordered:
   * the swap is a behaviour change to a refusal a page renders, and it is flagged on
   * `docs/plans/completed/notify-6-admin-idempotent-send.md` for a decision rather than folded into the header work.
   */
  async function emails(req: IncomingMessage, res: ServerResponse, method: string, record: MockCase, template: string | undefined, wantsPreview: boolean) {
    if (template === undefined) {
      if (method === "GET") return send(res, 200, toWireCaseEmails(record));
      return send(res, 405, { error: `no such route: ${method} on emails` });
    }

    // `""` on the two paths that reach no enqueue — the preview and a method with no route — rather than a null
    // carried through three narrowings to a call that cannot receive one.
    const requestId = method === "POST" && !wantsPreview ? idempotencyKey(req) : "";
    if (requestId === null) {
      return send(res, 400, {
        error: "Invalid request parameter",
        errors: [
          {
            field: IDEMPOTENCY_HEADER_NAME,
            // api's two refusals, from `DomainErrorHandler.missingHeader` and `unconvertibleParameter`. Neither
            // echoes the rejected value: the header NAME is the caller's own contract, and the value is
            // caller-supplied text this body would hand to whatever renders it.
            message: req.headers[IDEMPOTENCY_HEADER] === undefined ? "is a required header for this operation" : "is not a valid value for this parameter"
          }
        ]
      });
    }

    const key = decodeURIComponent(template);
    const resolved = MOCK_EMAIL_TEMPLATES.find((candidate) => candidate.key === key);
    // 404 rather than 400, as api's `requireTemplate` answers: `/emails/whatever` is a path nothing is served
    // at, exactly as an unknown case id is. The keys that would have worked are named because a client that got
    // this wrong has no other way to find out; the rejected token is deliberately not echoed back, since it is
    // caller-supplied text and this body is rendered by whatever is on the other end.
    if (!resolved) return send(res, 404, { error: `There is no such email type. One of: ${MOCK_EMAIL_TEMPLATES.map((each) => each.key).join(", ")}` });
    if (method !== "POST") return send(res, 405, { error: `no such route: ${method} on an email type` });

    const composed = composeEmail(record, resolved, await readJsonBody(req));
    if ("status" in composed) return send(res, composed.status, composed.body);

    if (wantsPreview) return send(res, 200, renderEmail(record, resolved, composed.slots).preview);

    return enqueueEmail(res, record, resolved, composed, auditName(req), requestId);
  }

  /**
   * Owe the applicant this email, then drain it.
   *
   * **A second send for the same referral is a 200 carrying the first row's id, not a 409.** api's insert is
   * `ON CONFLICT DO NOTHING` on a partial unique index, so a double-click or two replicas racing cannot tell an
   * applicant twice that their application was refused — and `enqueued: false` is how the caseworker is told
   * their click was redundant rather than that it failed, because a reported failure invites a third attempt.
   *
   * **Two rules can answer that way and the request id is asked FIRST, which is api's order and matters.** V19's
   * key is `("deedPollId", "requestId")` and V15's is the referral's exclusion group, so a zero-row insert has two
   * possible causes and `resolveRefusedInsert` reads the more specific one first: this case's row under this very
   * request names the send the caller is retrying, where the referral's rule would tell a caller retrying its own
   * POST about some other email of the same family. Asking the other way round is invisible for the one template
   * shipped here — both answer 200 with the same row — and wrong for a template with no referral, which is why the
   * order is restated rather than left to the rule that happens to fire.
   *
   * **A request id already used on this case for a DIFFERENT email is a 409**, not the original receipt: the key
   * asserts "this is the send I already made" and the payload says otherwise, so believing either one would
   * discard a caseworker's edits or write the second row the key exists to prevent. See `REQUEST_ALREADY_USED`.
   *
   * Drained in the same breath, as api drains immediately after the enqueue commits: a row left `Pending` would
   * make `Pending` the state every locally-driven send produced, and the tab would ship having never rendered
   * the common one.
   */
  function enqueueEmail(res: ServerResponse, record: MockCase, template: MockEmailTemplate, composed: ComposedEmail, author: string, requestId: string): void {
    // Blank counts as absent, because `applicantEmail` is free text with no format constraint: a row holding a
    // space would otherwise be enqueued and then fail permanently where nobody is waiting to read it.
    const recipient = (record.applicantEmail ?? "").trim();
    // 422 and never a silent skip, which is the opposite of what an automatic sender does and is the point: a
    // caseworker has CHOSEN to send, so saying nothing would leave them believing an applicant had been told.
    // Addressed to the column so the tab can say whose address is missing.
    if (recipient === "") {
      send(res, 422, {
        error: "This applicant has no email address, so this email cannot be sent",
        errors: [{ field: "applicantEmail", message: "is empty on this case, and is where this email would be sent" }]
      });
      return;
    }

    // Rendered before either lookup, because the same-send comparison needs the email this request WOULD have
    // written: `renderEmail` is pure, so doing it here costs a repeat send the rendering it then throws away.
    const rendered = renderEmail(record, template, composed.slots);

    // Scoped to the case because these rows are the case's, which is V19's index rather than an omission: a key
    // chosen on one case cannot collide with another case's row.
    const sameRequest = record.notifications.find((candidate) => candidate.requestId === requestId);
    if (sameRequest) {
      if (!isTheSameSend(sameRequest, template, composed.referral.id, recipient, rendered)) {
        send(res, 409, { error: REQUEST_ALREADY_USED });
        return;
      }

      send(res, 200, { id: sameRequest.id, recipient: sameRequest.recipient, enqueued: false });
      return;
    }

    const owed = record.notifications.find((candidate) => candidate.referralId === composed.referral.id && candidate.template === template.member);
    if (owed) {
      send(res, 200, { id: owed.id, recipient: owed.recipient, enqueued: false });
      return;
    }

    // What the drain below did with the row. A send always enqueues; only the outcome is the scenario's.
    const failed = MOCK_SCENARIOS[scenario].emailSend === "fail";
    const created: MockNotification = {
      id: randomUUID(),
      requestId,
      referralId: composed.referral.id,
      template: template.member,
      // Frozen here rather than recomputed later, as api freezes them: a later edit to the case cannot redirect
      // an email already owed, and "what was this applicant told" stays answerable from the row.
      recipient,
      state: failed ? "Failed" : "Sent",
      failureReason: failed ? MOCK_EMAIL_FAILURE_REASON : null,
      subject: rendered.preview.subject,
      body: rendered.body,
      createdOn: new Date(),
      createdBy: author
    };
    record.notifications.push(created);

    // Last of the writes, as api orders them: `CaseEmailService.send` appends the note at the end of its own
    // transaction. **Only on a fresh enqueue** — the `owed` return above is what makes an idempotent repeat send
    // write no second note, because the applicant is owed one email so the timeline says it once.
    appendNote(record, emailSentNote(template), author);
    // The failure note belongs to the *drain*, not the send, and it is written on the transition INTO `Failed`
    // rather than on a permanent verdict — api's `NotificationOutbox.settle` keys it that way so a retryable
    // failure that ran out of attempts still gets one. Authored from the row's `createdBy` and not from `author`
    // directly, because that column is api's source of truth for it: a real drain has no caller behind it, and
    // reading the row is what makes the send and its outcome appear under one name.
    if (failed) appendNote(record, emailCouldNotBeSentNote(template), created.createdBy);

    // No state on the response, which is api's shape: it drains after the enqueue, so any state read here could
    // say `Pending` for an email Notify has already accepted.
    send(res, 200, { id: created.id, recipient, enqueued: true });
  }

  /**
   * The former shared pool, deprecated by api D2 and kept for one release: referrals are assigned by the office, so
   * it is always an empty page with a total of 0. It still parses its paging, as api's `CasePaging` still does, and
   * its caller still sweeps first.
   */
  function judicialPool(res: ServerResponse, parameters: URLSearchParams): void {
    const paging = parsePaging(parameters.get("page"), parameters.get("size"), POOL_PAGE_SIZE);
    if ("errors" in paging) {
      send(res, 400, { error: "Case list paging is not valid", errors: paging.errors });
      return;
    }

    send(res, 200, { referrals: [], page: paging.page, size: paging.size, total: 0, totalPages: 0 });
  }

  /**
   * The referrals one judge has in hand: the ones they are holding, and the directions the office has not yet
   * actioned.
   *
   * **Membership is `visibleToJudge` restricted to the two states a judge owns**, which is api's own rule and the
   * reason the two are stated together here: a list that offered a referral whose own link answered 404 would be
   * worse than no list. `Open` is the shared pool's, and `Closed`/`Withdrawn` are the judiciary's involvement being
   * over.
   *
   * **Keyed on the token's subject, so there is nothing a caller can ask for.** api takes no owner parameter and
   * neither does this: `?claimedBy=` would make whose list this is something a judge types, and one who typed a
   * colleague's would be *enumerating* their work — a sharper disclosure than the individual read, which at least
   * needed an id. A referral with no owner subject is on nobody's list, exactly as it is visible to nobody.
   *
   * **api's order, reproduced rather than approximated** — `MINE_ORDER` since D2: undirected first, urgent first
   * among those only, then oldest, then the id. See `myReferralsOrder`. A page must not compensate for this, so
   * getting it wrong here is worse than not modelling it at all. Its caller sweeps overdue assignments first, as
   * api's `mine` does.
   */
  function myReferrals(req: IncomingMessage, res: ServerResponse, parameters: URLSearchParams): void {
    const paging = parsePaging(parameters.get("page"), parameters.get("size"), POOL_PAGE_SIZE);
    if ("errors" in paging) {
      send(res, 400, { error: "Case list paging is not valid", errors: paging.errors });
      return;
    }

    const subject = callerSubject(req);
    const mine = [...cases.values()]
      .flatMap((record) => record.referrals)
      .filter((referral) => (referral.state === "Claimed" || referral.state === "Decided") && visibleToJudge(referral, subject))
      .sort(myReferralsOrder);
    const from = (paging.page - 1) * paging.size;

    send(res, 200, {
      referrals: mine.slice(from, from + paging.size).map(toWireJudicialSummary),
      page: paging.page,
      size: paging.size,
      total: mine.length,
      totalPages: Math.ceil(mine.length / paging.size)
    });
  }

  /**
   * One referral as a judge reads it, the claim that takes it out of the pool, and the direction that ends it.
   *
   * **Every way this caller may not have the referral is the same 404** — an id nothing was stored under, one
   * another judge holds, and one already closed or withdrawn — which is what stops a referral id being probed
   * for and stops one judge learning that another holds a case. The 403 of api's role gate is the one refusal
   * this mock cannot produce (see the file's docblock).
   *
   * Reading a referral this judge holds refreshes the claim at api's end; there is no clock here to refresh it
   * against, since the sweep that would read it is not modelled.
   */
  async function judicialReferral(
    req: IncomingMessage,
    res: ServerResponse,
    method: string,
    referralId: string,
    action: string | undefined,
    documentId?: string
  ): Promise<void> {
    // Two identities from one token, because api keeps two: the subject decides what this caller may see and
    // hold, and the name is what a caseworker reads afterwards. See `callerSubject`.
    const judge = auditName(req);
    const subject = callerSubject(req);
    // api's deprecated claim sweeps before it resolves, as the two lists do; the read and the direction do not.
    if (method === "POST" && action === "claim") unassignOverdue();
    const located = locateReferral(referralId);
    if (!located || !visibleToJudge(located.referral, subject)) return send(res, 404, { error: `Referral ${referralId} not found` });

    const { record, referral } = located;

    if (method === "GET" && action === undefined) return send(res, 200, toWireJudicialDetail(record, referral));

    // Visibility is the referral's, already checked above: a document is readable by exactly the judges who may
    // read the referral. One 404 for a document not on this application and one with no file, as api answers.
    if (method === "GET" && (action === "file" || action === "preview")) {
      const document = record.documents.find((candidate) => candidate.id === documentId && candidate.bytes.length > 0);
      if (!document) return send(res, 404, { error: `Document ${documentId} not found` });

      return action === "file" ? sendDocumentFile(res, document) : sendDocumentPreview(res, document, MOCK_SCENARIOS[scenario].documentPreview);
    }

    if (method === "POST" && action === "claim") {
      // State after visibility, which is what makes this 409 narrow: the caller has got past `visibleToJudge`, so
      // a non-`Open` referral here is one they hold or have already decided. Another judge's is the 404 above.
      if (referral.state !== "Open") return send(res, 409, { error: `Referral ${referralId} is ${referral.state} and can only be claimed while it is Open` });

      const now = clock();
      // Both halves of the identity: the subject is what makes it theirs, the name is what says whose it is.
      transition(record, referral, judge, { state: "Claimed", claimedBy: judge, claimedById: subject, claimedAt: now, modifiedOn: now });
      // The claiming judge, not the service account: a person did this, and their name in `createdBy` is why the
      // prose does not name them a second time.
      appendNote(record, referralClaimedNote(referral), judge);

      return send(res, 200, toWireJudicialDetail(record, referral));
    }

    if (method === "POST" && action === "direction") {
      const parsed = WIRE_SCHEMAS.JudicialDirectionRequest.safeParse(await readJsonBody(req));
      if (!parsed.success) return send(res, 400, fieldErrorsFrom(parsed.error.issues));
      const missing = directionsMissing(parsed.data);
      if (missing) return send(res, 400, missing);

      // Both halves, as api asks both: the state says a claim exists and the subject says whose. This is what
      // refuses a direction on a referral withdrawn under the judge who was reading it. The SUBJECT and not the
      // name, for `visibleToJudge`'s reason — api's `requireHeldBy` compares the same column.
      if (referral.state !== "Claimed" || referral.claimedById !== subject) {
        return send(res, 409, { error: `Referral ${referralId} is not claimed by ${judge} -- it is ${referral.state}` });
      }

      const now = clock();
      transition(record, referral, judge, {
        state: "Decided",
        decision: parsed.data.decision,
        directionsText: parsed.data.directionsText?.trim() || null,
        changesToStandardPublication: parsed.data.changesToStandardPublication,
        // From the clock and the token, never from the payload — api's rule, and the reason the direction body
        // carries neither.
        decisionDate: now,
        decidedBy: judge,
        decidedById: subject,
        modifiedOn: now
      });
      // Composed after the transition, so the note reads the decision and the Gazette answer as they were
      // stored rather than as they arrived — api composes it from the saved referral for the same reason.
      appendNote(record, referralDirectedNote(referral), judge);

      return send(res, 200, toWireJudicialDetail(record, referral));
    }

    if ((method === "PUT" && action === "direction") || (method === "POST" && action === "direction/withdraw")) {
      const parsed = method === "PUT" ? WIRE_SCHEMAS.JudicialDirectionRequest.safeParse(await readJsonBody(req)) : null;
      if (parsed && !parsed.success) return send(res, 400, fieldErrorsFrom(parsed.error.issues));
      const missing = parsed ? directionsMissing(parsed.data) : null;
      if (missing) return send(res, 400, missing);

      // Visibility already admits a `Decided` referral only to the judge who directed it, so the state is the
      // whole of the check: a 409 here is the pool or the caller's own undirected claim, never someone else's.
      if (referral.state !== "Decided") {
        return send(res, 409, { error: `Referral ${referralId} is ${referral.state} -- only a direction you gave can be changed or withdrawn` });
      }

      const now = clock();
      if (parsed) {
        // `decidedBy` stays as first signed and `decisionDate` moves to now, as api's `reviseDirection` does.
        transition(record, referral, judge, {
          state: "Decided",
          decision: parsed.data.decision,
          directionsText: parsed.data.directionsText?.trim() || null,
          changesToStandardPublication: parsed.data.changesToStandardPublication,
          decisionDate: now,
          directionChangedAt: now,
          modifiedOn: now
        });
        appendNote(record, referralDirectionRevisedNote(referral), judge);
      } else {
        // Composed before the direction is cleared, because the note says which direction stopped being the answer.
        const note = referralDirectionWithdrawnNote(referral);
        // Back with its Master to direct again, restarting the processing window but keeping the cap's window, as
        // api's `withdrawDirection` does. An assignment goes to whoever its Master is linked to now; a pre-D2 claim
        // has no Master and stays with the subject that claimed it.
        transition(record, referral, judge, {
          state: "Claimed",
          claimedById: referral.assignedMasterId ? (masters.assignee(referral.assignedMasterId)?.subject ?? null) : referral.claimedById,
          claimedAt: now,
          assignedAt: now,
          decision: null,
          directionsText: null,
          changesToStandardPublication: null,
          decisionDate: null,
          decidedBy: null,
          decidedById: null,
          directionChangedAt: now,
          modifiedOn: now
        });
        appendNote(record, note, judge);
      }

      return send(res, 200, toWireJudicialDetail(record, referral));
    }

    return send(res, 405, { error: `no such route: ${method} on a judicial referral` });
  }

  /**
   * The referral this id names and the case behind it.
   *
   * The resolution api's judicial surface performs, because a judicial path carries no case id. Every case is
   * searched, which is the one place this mock reads across cases — and it is why the visibility check at the
   * caller is not optional.
   */
  function locateReferral(referralId: string): { record: MockCase; referral: MockReferral } | null {
    for (const record of cases.values()) {
      const referral = record.referrals.find((candidate) => candidate.id === referralId);
      if (referral) return { record, referral };
    }

    return null;
  }

  /** The referral clock: real time moved by `/__mock/clock`. */
  function clock(): Date {
    return new Date(Date.now() + clockOffsetMinutes * 60_000);
  }

  /** The window a referral assigned at `at` counts towards, from the stored window times and bank holidays. */
  function windowAt(at: Date): ReferralWindow {
    const settings = processSettings.read();
    return windowFor(
      at,
      { morningEnd: settings.morningWindowEnd ?? "10:30", afternoonEnd: settings.afternoonWindowEnd ?? "14:30" },
      isWeekdayNotIn((day) => bankHolidays.has(day))
    );
  }

  function processingMinutes(): number {
    return processSettings.read().referralClaimExpiryMinutes;
  }

  /** How many `Claimed` referrals a Master is assigned in a window, which is what the cap counts. */
  function assignedInWindow(masterId: string, window: ReferralWindow): number {
    return [...cases.values()]
      .flatMap((record) => record.referrals)
      .filter(
        (referral) =>
          referral.state === "Claimed" && referral.assignedMasterId === masterId && referral.windowDate === window.date && referral.windowSlot === window.slot
      ).length;
  }

  /** `GET /caseworker/masters` since api D2: every Master with their count in the current window, the window and the cap. */
  function masterList(): unknown {
    const window = windowAt(clock());
    return {
      masters: masters.list().map((master) => ({ ...master, assignedInWindow: assignedInWindow(master.id, window) })),
      window,
      cap: processSettings.read().masterWindowCap
    };
  }

  /**
   * api's `assignLocked` checks that do not depend on the referral, in its order: the Master must exist and be
   * available (400 on `masterId`), and must hold fewer than the cap in the window for now (409 on `masterId`, the
   * window in words). The referral's own state check and the same-Master no-op sit between the two in api, so
   * `reassign` asks them itself before the cap.
   */
  function assignmentRefusal(master: Assignee | undefined, now: Date): { status: number; body: unknown } | null {
    if (!master?.available) return selectAMaster();
    return capRefusal(master, now);
  }

  function capRefusal(master: Assignee, now: Date): { status: number; body: unknown } | null {
    const window = windowAt(now);
    const held = assignedInWindow(master.id, window);
    if (held < processSettings.read().masterWindowCap) return null;
    const full = `This Master already has ${held} ${held === 1 ? "referral" : "referrals"} for ${windowInWords(window)}. Choose another Master.`;
    return { status: 409, body: { error: full, errors: [{ field: "masterId", message: full }] } };
  }

  /**
   * The assignment itself, as api's `assignLocked` writes it: `Claimed` by the Master's name, owned by their linked
   * subject or by nobody until they sign in, `claimedAt` and `assignedAt` now (so a reassignment restarts the
   * processing window), and the window it counts towards. One note, naming the previous Master on a reassignment.
   */
  function assign(record: MockCase, referral: MockReferral, master: Assignee, author: string, now: Date): void {
    const from = referral.state === "Claimed" ? referral.claimedBy : null;
    const window = windowAt(now);
    transition(record, referral, author, {
      state: "Claimed",
      claimedBy: master.name,
      claimedById: master.subject,
      claimedAt: now,
      assignedAt: now,
      assignedMasterId: master.id,
      windowDate: window.date,
      windowSlot: window.slot,
      modifiedOn: now
    });
    appendNote(record, from ? referralReassignedNote(referral, from, master.name) : referralAssignedNote(referral, master.name), author);
  }

  /**
   * `PUT …/assignment` (api D2): any caseworker, while the referral is `Open` or `Claimed`. The checks in api's order:
   * the body, the Master (400), the referral's state (409), the Master it already has (a no-op 200 writing nothing),
   * then the cap (409).
   */
  async function reassign(req: IncomingMessage, res: ServerResponse, record: MockCase, referral: MockReferral): Promise<void> {
    const parsed = WIRE_SCHEMAS.AssignReferralRequest.safeParse(await readJsonBody(req));
    if (!parsed.success) {
      const { status, body } = selectAMaster();
      return send(res, status, body);
    }
    const master = masters.assignee(parsed.data.masterId);
    if (!master?.available) {
      const { status, body } = selectAMaster();
      return send(res, status, body);
    }
    if (referral.state !== "Open" && referral.state !== "Claimed") {
      return send(res, 409, { error: `Referral ${referral.id} is ${referral.state}: only a referral waiting for a direction can be assigned` });
    }
    if (referral.state === "Claimed" && referral.assignedMasterId === master.id) return send(res, 200, toWireReferral(referral));

    const now = clock();
    const refused = capRefusal(master, now);
    if (refused) return send(res, refused.status, refused.body);
    assign(record, referral, master, auditName(req), now);
    refreshAwaitingConfirmation(record);

    return send(res, 200, toWireReferral(referral));
  }

  /**
   * api's `unassignOverdue`: every `Claimed` referral whose processing window, from `assignedAt` or for a pre-D2 claim
   * `claimedAt`, ended before now goes back to the office, `Open` with its claim and assignment cleared, with one
   * note attributed to the service account. Returns how many it released.
   */
  function unassignOverdue(): number {
    const minutes = processingMinutes();
    const cutoff = clock().getTime() - minutes * 60_000;
    let released = 0;
    for (const record of cases.values()) {
      for (const referral of record.referrals) {
        const started = referral.assignedAt ?? referral.claimedAt;
        if (referral.state !== "Claimed" || !started || started.getTime() >= cutoff) continue;
        const from = referral.claimedBy;
        transition(record, referral, SERVICE_ACCOUNT_NAME, {
          state: "Open",
          claimedBy: null,
          claimedById: null,
          claimedAt: null,
          assignedMasterId: null,
          assignedAt: null,
          windowDate: null,
          windowSlot: null
        });
        appendNote(record, referralReturnedForAssignmentNote(referral, from, minutes), SERVICE_ACCOUNT_NAME);
        released++;
      }
    }
    return released;
  }

  /** Linking's referral side, api's `attachToLinkedMaster` and `attachLegacyClaims`, in that order. */
  function attachToLinkedMaster(masterId: string, subject: string): void {
    for (const referral of [...cases.values()].flatMap((record) => record.referrals)) {
      if (referral.assignedMasterId === masterId && referral.claimedById === null && (referral.state === "Claimed" || referral.state === "Decided")) {
        referral.claimedById = subject;
      }
      if (referral.claimedById === subject && !referral.assignedMasterId && referral.state === "Claimed") referral.assignedMasterId = masterId;
    }
  }

  /** api's `detachFromUnlinkedMaster`: an email change cuts the old account off the Master's undirected referrals. */
  function detachFromUnlinkedMaster(masterId: string): void {
    for (const referral of [...cases.values()].flatMap((record) => record.referrals)) {
      if (referral.assignedMasterId === masterId && referral.claimedById !== null && referral.state === "Claimed") referral.claimedById = null;
    }
  }

  function toWireReferral(referral: MockReferral): unknown {
    return wireReferral(referral, processingMinutes());
  }

  function toWireJudicialSummary(referral: MockReferral): unknown {
    return wireJudicialSummary(referral, processingMinutes());
  }

  function toWireJudicialDetail(record: MockCase, referral: MockReferral): unknown {
    return wireJudicialDetail(record, referral, processingMinutes());
  }

  async function createSavedQuery(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const parsed = WIRE_SCHEMAS.CreateSavedQueryRequest.safeParse(await readJsonBody(req));
    if (!parsed.success) return send(res, 400, fieldErrorsFrom(parsed.error.issues));

    const now = new Date();
    // The owner from the token, which is the one thing about identity this mock does model — api takes the
    // owner from the subject exactly as it takes the audit author, so a caller sending no token owns
    // everything it creates under the fallback name.
    const owner = auditName(req);
    const record: MockSavedQuery = {
      id: randomUUID(),
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      shared: parsed.data.shared ?? false,
      filter: parsed.data.filter ?? null,
      // Never null, as api's `List.of()` never is: a query that narrows nothing has no conditions, not
      // absent ones.
      conditions: parsed.data.conditions ?? [],
      sortField: parsed.data.sortField ?? null,
      sortDirection: parsed.data.sortDirection ?? null,
      searchTerm: parsed.data.searchTerm ?? null,
      ownerId: owner,
      ownerName: owner,
      createdBy: owner,
      modifiedBy: owner,
      createdOn: now,
      modifiedOn: now
    };
    savedQueries.set(record.id, record);

    // Deliberately NOT selected for its creator: the spec does not say api selects one, and a mock that
    // did would let a page ship relying on it. A page that wants the query in the caller's list says so
    // with the `PUT`, which is idempotent either way.
    return send(res, 201, toWireSavedQuery(record));
  }

  /**
   * One saved query: read, amend, delete, and the selection sub-resource.
   *
   * **The permission rules are not modelled, and this mock must not be read as evidence that the UI's
   * handling of them is tested.** api decides who may amend or delete from `SavedQueryPermissions` — the
   * owner, or an Administrator for a shared query — and computes `editable` from that same predicate. This
   * mock has no roles: `auditName` decodes an unverified token for a subject and nothing else, so a 403 is
   * not a state it can produce, exactly as the witness delete's Administrator gate is unmodelled. So it
   * sets **`editable: true` on everything and answers every write**. What that leaves untested locally is
   * api's gate, which is api's own test; what the UI does with the flag is tested by giving the flag both
   * values in the page tests, not by driving this.
   *
   * The one asymmetry that IS modelled, because a page depends on it: `PUT …/selection` answers 404 for a
   * query that is not there, and `DELETE …/selection` answers 204 regardless — the selection row is keyed
   * by the caller, so a subscriber can always clear a stale selection for a query since unshared.
   */
  async function savedQuery(req: IncomingMessage, res: ServerResponse, method: string, id: string, isSelection: boolean): Promise<void> {
    if (isSelection) {
      if (method === "DELETE") {
        selectedQueryIds.delete(id);
        return sendNoContent(res);
      }
      if (method === "PUT") {
        if (!savedQueries.has(id)) return send(res, 404, { error: `Saved query ${id} not found` });
        selectedQueryIds.add(id);
        return sendNoContent(res);
      }
      return send(res, 405, { error: `no such route: ${method} on a saved query's selection` });
    }

    const found = savedQueries.get(id);
    // 404 for a query the caller cannot see as well as for one that never existed, which is api's rule —
    // indistinguishable on purpose, so no id is discoverable by watching status codes. Here the two collapse
    // into one branch because everything this mock holds is visible to it.
    if (!found) return send(res, 404, { error: `Saved query ${id} not found` });

    if (method === "GET") return send(res, 200, toWireSavedQuery(found));

    if (method === "PATCH") {
      const parsed = WIRE_SCHEMAS.UpdateSavedQueryRequest.safeParse(await readJsonBody(req));
      if (!parsed.success) return send(res, 400, fieldErrorsFrom(parsed.error.issues));

      // An omitted field is absent from the parsed patch rather than present as undefined, so an empty patch
      // re-stamps the author and changes nothing — and an explicit null CLEARS the column, which is api's
      // behaviour here and not the note or witness patches', whose columns are all NOT NULL.
      Object.assign(found, parsed.data, { modifiedOn: new Date(), modifiedBy: auditName(req) });
      return send(res, 200, toWireSavedQuery(found));
    }

    if (method === "DELETE") {
      savedQueries.delete(id);
      // Every selection of it goes too, through api's foreign-key cascade: a subscriber's list cannot hold a
      // query that no longer exists.
      selectedQueryIds.delete(id);
      return sendNoContent(res);
    }

    return send(res, 405, { error: `no such route: ${method} on a saved query` });
  }

  /** A saved query on the wire: the stored fields, plus the two flags api derives per caller. */
  function toWireSavedQuery(record: MockSavedQuery): unknown {
    return { ...isoDates(record), selected: selectedQueryIds.has(record.id), editable: true };
  }

  function fieldRules(res: ServerResponse, query: URLSearchParams): void {
    // Taken as lists and refused when repeated, for api's reason: each parameter changes the answer, so a
    // caller who sent one twice must be told rather than picked for.
    for (const name of ["type", "migrated", "publishToGazette"]) {
      if (query.getAll(name).length > 1) {
        send(res, 400, { error: "Invalid request parameter", errors: [{ field: name, message: "must be given at most once" }] });
        return;
      }
    }

    const type = query.get("type");
    if (type !== null && !CASE_TYPES.includes(type)) {
      send(res, 400, { error: "Invalid request parameter", errors: [{ field: "type", message: "is not a valid case type" }] });
      return;
    }

    const migrated = flag(query.get("migrated"), false);
    const publishToGazette = flag(query.get("publishToGazette"), true);
    if (migrated === null || publishToGazette === null) {
      const field = migrated === null ? "migrated" : "publishToGazette";
      send(res, 400, { error: "Invalid request parameter", errors: [{ field, message: "must be true or false" }] });
      return;
    }

    send(res, 200, { rules: rulesFor(type, migrated, publishToGazette) });
  }

  function seed(body: Partial<MockCase> | null): MockCase {
    const now = new Date();
    const record: MockCase = {
      ...CASE_DEFAULTS,
      id: randomUUID(),
      referencenumber: null,
      displayReference: null,
      state: "Received",
      iShall: [],
      iHaveSubscribed: [],
      andAlsoMyOld: [],
      createdOn: now,
      modifiedOn: now,
      // The fallback, not a caller's name: seeding is not a write by anyone, so there is no token to
      // attribute it to. A test that needs a particular author sets `createdBy` in the body.
      createdBy: MOCK_USER_NAME,
      modifiedBy: MOCK_USER_NAME,
      notes: [],
      witnesses: [],
      documents: [],
      referrals: [],
      notifications: [],
      ...body
    };
    // A case seeded WITH referrals gets its column from them, for the reason every transition recomputes it:
    // the two disagreeing is the one thing a count over the column cannot be tested against. A case seeded
    // with the column and no referrals keeps what it was given — that is how a test arranges a case referred
    // before this process started, and there is nothing to recompute from.
    if (record.referrals.length > 0) refreshCurrentReferralState(record);
    // The other denormalised column, on the same terms: a case seeded with a referral that has been asked to
    // confirm and has not answered belongs on the waiting list, and neither column is the seeder's to state. A
    // case seeded with no referrals keeps what it was given, which is how a test arranges a wait that began
    // before this process started.
    if (record.referrals.length > 0) refreshAwaitingConfirmation(record);
    cases.set(record.id, record);

    return record;
  }

  /**
   * The caller api would link: the judicial role, the subject and IDAM's email, trimmed and lower-cased and
   * ignored without an `@`, as api's `CurrentUser` reads it. Best effort, as api's interceptor is: nothing here can
   * refuse the request.
   */
  async function linkJudicialCaller(req: IncomingMessage): Promise<void> {
    const claims = await callerClaims(req, options.userInfoUrl);
    if (!claims) return;
    const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
    masters.linkIfListed({
      isJudicial: callerAccess(claims).judicial,
      subject: typeof claims.sub === "string" && claims.sub.length > 0 ? claims.sub : null,
      email: email.includes("@") ? email : null
    });
  }

  function reset(): void {
    cases.clear();
    clockOffsetMinutes = 0;
    gazetteBatches.clear();
    gazetteRequests.reset();
    processSettings.reset();
    masters.reset();
    bankHolidays.reset();
    gazetteSettings = { recipientEmail: null, revision: 0, updatedAt: null, updatedBy: null };
    serials.clear();
    savedQueries.clear();
    selectedQueryIds.clear();
  }

  return {
    server,
    get scenario() {
      return scenario;
    },
    setScenario(next: MockScenario) {
      scenario = next;
    },
    seed,
    reset
  };
}

/**
 * Listen on `port` and hand back the URL it actually bound to.
 *
 * Port 0 means "any free port", which is what tests use: a fixed port makes two suites racing on one
 * machine fail intermittently, and an intermittent integration failure is the least useful kind.
 */
export async function startMockApi(options: MockApiOptions & { port?: number } = {}): Promise<RunningMockApi> {
  const mock = createMockApi(options);

  await new Promise<void>((resolve, reject) => {
    mock.server.once("error", reject);
    mock.server.listen(options.port ?? 0, () => resolve());
  });

  const address = mock.server.address();

  // Delegated property by property rather than `{ ...mock }`: spreading READS the `scenario` getter once
  // and stores its value, so a scenario switched over HTTP afterwards would never be visible here — and a
  // test asserting the switch had happened would pass while asserting a stale constant.
  return {
    server: mock.server,
    get scenario() {
      return mock.scenario;
    },
    setScenario: mock.setScenario,
    seed: mock.seed,
    reset: mock.reset,
    url: address && typeof address === "object" ? `http://localhost:${address.port}` : "http://localhost",
    close: () =>
      new Promise<void>((resolve, reject) => {
        mock.server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}

/** Who a write is attributed to when the caller forwarded no token. Deliberately not a plausible name. */
const MOCK_USER_NAME = "Mock Caseworker";

/**
 * Whose work a caller owns when they forwarded no readable token.
 *
 * Deliberately not `MOCK_USER_NAME`: the two are different fields at api, so a mock that used one string for both
 * could not tell a test keyed on attribution from one keyed on ownership — see `callerSubject`. Not a plausible
 * subject either, for the same reason the name is not a plausible name.
 */
const MOCK_SUBJECT = "mock-subject";

/**
 * Who a write is attributed to: the caller the forwarded token names.
 *
 * **Modelled because a page depends on it.** api derives the audit author from the caller's token and takes
 * no author parameter, so nothing but the token reaching api makes `Created By` right — and the new-case
 * page sent `userName: undefined` for a whole phase without anything noticing. Stamping a constant here
 * would leave that undetectable again: the e2e create journey asserts this value for exactly that reason.
 *
 * **The `sub`, where api uses the display name.** api resolves the name from IDAM's `/o/userinfo`
 * (`IdamUserInfoClient`) — an access token carries no name claim — and the mock has no IDAM to ask, so it
 * stamps the subject the token already carries: an email, for `rse-idam-simulator`. A difference in the
 * TEXT, not in where identity comes from, which is the part a page can get wrong.
 *
 * **Decoded, never verified.** Verification needs IDAM's JWKS, and a mock that refused a badly-signed
 * token would be asserting something no page depends on. Anything undecodable is the fallback rather than
 * an error, so a hand-rolled `curl` against the mock still works.
 */
function auditName(req: IncomingMessage): string {
  const claims = tokenClaims(req);
  const name = claims?.name;
  if (typeof name === "string" && name.length > 0) return name;

  const subject = claims?.sub;

  return typeof subject === "string" && subject.length > 0 ? subject : MOCK_USER_NAME;
}

/**
 * The caller's stable identity: the token's subject, and nothing that could collide with another person's.
 *
 * **Separate from `auditName` because ownership and attribution are separate things, and api-6 separated
 * them.** Every judicial owner check was the display name until `V14__referral_owner_subjects.sql` added
 * `claimedById`/`decidedById`: two judges sharing a display name saw and directed each other's referrals, and a
 * judge whose name changed lost their own. api's `visibleTo` and `mine` now compare the subject; `claimedBy` and
 * `decidedBy` stay as the attribution a caseworker reads, and **authorise nothing**.
 *
 * So this mock has to be able to tell them apart, or a page could ship keyed on the wrong one with every test
 * green. `auditName` above therefore prefers a `name` claim where the token carries one — which is also closer to
 * api, whose display name comes from IDAM's `/o/userinfo` rather than from the token — and this returns the `sub`
 * regardless. A token with only a `sub` makes them equal, which is the ordinary case and the reason the
 * distinction had to be asserted deliberately: see the same-display-name test in `server.test.ts`.
 *
 * **`MOCK_SUBJECT` for a caller with no readable token, not `null`.** api answers 401 to a judicial token with no
 * subject, which is a refusal this mock cannot produce for the reason it cannot produce the role gate's 403 — it
 * verifies nothing. So an anonymous caller is one consistent identity here rather than an unidentified one, and
 * what that leaves untested locally is api's own 401.
 */
function callerSubject(req: IncomingMessage): string {
  const subject = tokenClaims(req)?.sub;

  return typeof subject === "string" && subject.length > 0 ? subject : MOCK_SUBJECT;
}

// Local IDAM puts roles in userinfo, not its access token. Fixture tokens still carry roles directly. Shared by
// `GET /me` and the Gazette gate so the two read the same roles for one token.
async function callerClaims(req: IncomingMessage, userInfoUrl?: string): Promise<{ sub?: unknown; roles?: unknown; name?: unknown; email?: unknown } | null> {
  const claims = tokenClaims(req);
  if (!claims || claims.roles !== undefined || !userInfoUrl) return claims;
  try {
    const response = await fetch(userInfoUrl, {
      headers: { authorization: req.headers.authorization ?? "" },
      signal: AbortSignal.timeout(2000)
    });
    if (!response.ok) return null;
    const info = await response.json();
    return info && typeof info === "object" && !Array.isArray(info) ? info : null;
  } catch {
    return null;
  }
}

/**
 * The claims of the forwarded bearer token, **decoded and never verified**.
 *
 * Verification needs IDAM's JWKS, and a mock that refused a badly-signed token would be asserting something no
 * page depends on. Anything undecodable is `null` rather than an error, so a hand-rolled `curl` against the mock
 * still works.
 */
function tokenClaims(req: IncomingMessage): { sub?: unknown; name?: unknown; roles?: unknown; email?: unknown } | null {
  const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "");
  const payload = bearer?.[1].split(".")[1];
  if (payload === undefined) return null;

  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: unknown; name?: unknown; roles?: unknown; email?: unknown };
  } catch {
    return null;
  }
}

/**
 * The compose journey the send names, normalised — or `null` when it named none this mock could use.
 *
 * **`null` covers api's two 400s and the caller distinguishes them**, because they are one thing to the mock and
 * two sentences to a client: Spring answers `MissingRequestHeaderException` for an absent header and
 * `MethodArgumentTypeMismatchException` for a value that will not convert to a `UUID`. Restating the parse rather
 * than accepting any string is the point of the second one — a mock that stored "retry-1" as a key would let a
 * client ship sending something api answers 400 to, which is the whole of what this plan repaired.
 *
 * A repeated header arrives here joined by `node:http` and so fails the parse, where Spring would take the first
 * value. Nothing this app does can send two, and the refusal is the safer direction.
 */
function idempotencyKey(req: IncomingMessage): string | null {
  const header = req.headers[IDEMPOTENCY_HEADER];
  if (typeof header !== "string") return null;

  const value = header.trim();

  return IDEMPOTENCY_KEY_PATTERN.test(value) ? value.toLowerCase() : null;
}

/**
 * Whether the row already recorded under this request id is the send being retried.
 *
 * api compares the template, the referral, the recipient and the **frozen personalisation** — the whole of what the
 * row was written with, minus the audit columns and whatever the drain has since moved. This mock keeps no
 * personalisation column (see `MockNotification`), so the comparison is against the rendering: a second send under
 * one key whose wording differs renders differently, which is the same question asked of the one field this row has.
 *
 * **The rendering is a function of the slots *and* the case**, not of the slots alone — `renderEmail` also reads
 * `displayReference`, the former name and `postCounter` — so a case edited between a send and its retry compares
 * unequal and earns the 409. That matches api rather than diverging from it: api's personalisation map is built from
 * the same case-derived values and it recomputes one to compare, so it answers the same way. Worth stating because
 * "only the wording decides" is the wrong thing to reason from when adding a field to either side.
 *
 * A row with no stored wording — anything seeded as sent before api kept it — therefore differs from every
 * rendering, so a key claiming to be a retry of one is the 409. That is the right answer for the right reason: such
 * a row cannot be shown to be the same send, and guessing that it is would answer with an email nobody can read.
 */
function isTheSameSend(existing: MockNotification, template: MockEmailTemplate, referralId: string, recipient: string, rendered: RenderedEmail): boolean {
  return (
    existing.template === template.member &&
    existing.referralId === referralId &&
    existing.recipient === recipient &&
    existing.subject === rendered.preview.subject &&
    existing.body === rendered.body
  );
}

const CASE_TYPES = ["Adult", "AdultTransgender", "Minor", "MinorTransgender", "DeedOfRelinquishment", "Unknown"];

/**
 * The saved-query filters, matching api's `ListFilters` — "open" is everything not yet finished.
 *
 * **Each one is asked about the whole case rather than about its state**, because `awaitingConfirmation` is the
 * one tab whose criterion is not a state at all: a case waiting for an applicant's reply is in whatever state its
 * dates make it, ordinarily `Returned`.
 *
 * It is **appended** and not slotted beside the state tabs, as api appends it: the order here is the order the
 * tab bar renders. It is also the one tab that carries an order of its own — a list of waiting cases in creation
 * order would bury the longest wait — and `defaultSort` is a DEFAULT, so a `sort` the caller named still wins.
 */
const FILTERS: readonly { key: string; matches: (record: MockCase) => boolean; defaultSort?: MockSort }[] = [
  { key: "all", matches: () => true },
  { key: "open", matches: ({ state }) => state !== "Enroled" && state !== "Returned" },
  { key: "received", matches: ({ state }) => state === "Received" },
  { key: "enroled", matches: ({ state }) => state === "Enroled" },
  { key: "returned", matches: ({ state }) => state === "Returned" },
  {
    key: "awaitingConfirmation",
    matches: ({ awaitingConfirmationSince }) => Boolean(awaitingConfirmationSince),
    // Ascending the stamp, which is descending in days waited: the case at risk of being forgotten is the one at
    // the top. api's `ListFilters.LONGEST_WAIT_FIRST`.
    defaultSort: { field: "awaitingConfirmationSince", descending: false }
  },
  {
    key: "readyForPublication",
    matches: (record) =>
      record.publishToLondonGazette === true &&
      record.dateNoticeSentToLondonGazette == null &&
      record.state === "Enroled" &&
      record.type !== "DeedOfRelinquishment",
    defaultSort: { field: "dateEnroled", descending: false }
  }
];

/** api's cap on conditions per request, from `CaseQuery.MAX_CONDITIONS`. */
const MAX_CONDITIONS = 20;

/** api's page size when none is asked for, and the cap it clamps a larger one to — `CasePaging`. */
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/**
 * The judicial pool's default page size, from api's `JudicialReferralService.POOL_PAGE_SIZE`.
 *
 * Ten rather than the case list's twenty-five, and a page size rather than a cap: the whole pool is reachable
 * by paging and `total` says how much is waiting. The same `MAX_PAGE_SIZE` applies above it.
 */
const POOL_PAGE_SIZE = 10;

/**
 * The fields a condition or a sort may name.
 *
 * Derived from the response schema rather than listed, so a field api adds to a case becomes queryable
 * here without a second edit. The three exclusions are the properties with no column behind them: `id` is
 * not a form field, and the two day counts are computed at read time — api refuses both with *"is derived,
 * not stored"*.
 *
 * Wider than api's set by whatever wire property is not one of its 70 `FormFields`, and that is the
 * accepted imprecision of a mock: api is the authority on the name, and being told about a name it would
 * refuse is a 400 in a deployed environment rather than something a page can render differently.
 */
const QUERYABLE_FIELDS: ReadonlySet<string> = new Set(
  Object.keys(WIRE_SCHEMAS.SavedCaseResponse.shape).filter((name) => !["id", "daysReceivedToEnroled", "daysReceivedToReturned"].includes(name))
);

/**
 * How many values each operator takes, and whether they are comma-separated.
 *
 * The arity is here because nothing can be evaluated without it — `between` needs its bounds split and
 * `isEmpty` must refuse a value. The operator-per-KIND table deliberately is NOT: it lives in api's
 * `QueryOperator` and in this repo in `libs/deed-poll/src/deed-poll/query-fields.ts`, and a third copy
 * would be one more to keep in step. Nothing this app sends can reach it anyway — `caseQueryWhere` only
 * puts a condition on the wire once its own copy has admitted the operator for the field's kind — so a
 * kind mismatch is a hand-edited URL, and api answers that with the 400 the page already renders.
 */
const ARITY_BY_OPERATOR: Readonly<Record<string, 0 | 1 | 2 | "many">> = {
  is: 1,
  contains: 1,
  startsWith: 1,
  before: 1,
  after: 1,
  gt: 1,
  lt: 1,
  between: 2,
  isOneOf: "many",
  isEmpty: 0,
  isNotEmpty: 0
};

/**
 * One `where` entry as a condition, or the message saying why it is not one.
 *
 * Split on the first two colons only, as api splits it: everything after the second is the value, so a
 * colon inside a value survives. An entry with no second colon is how a no-value operator is written
 * (`parents:isEmpty`).
 */
function parseCondition(entry: string): MockCondition | string {
  const firstColon = entry.indexOf(":");
  if (firstColon < 0) return `must be field:operator:value, and was '${entry}'`;

  const secondColon = entry.indexOf(":", firstColon + 1);
  const field = entry.slice(0, firstColon).trim();
  const operator = (secondColon < 0 ? entry.slice(firstColon + 1) : entry.slice(firstColon + 1, secondColon)).trim();
  const valuePart = secondColon < 0 ? null : entry.slice(secondColon + 1);

  if (!QUERYABLE_FIELDS.has(field)) return `names no case field: '${field}'`;
  // `hasOwn` rather than a truthiness check, because `ARITY_BY_OPERATOR["toString"]` is a function.
  if (!Object.hasOwn(ARITY_BY_OPERATOR, operator)) return `names no operator: '${operator}'`;

  const arity = ARITY_BY_OPERATOR[operator];
  const takesList = arity === 2 || arity === "many";
  const values = valuePart === null || valuePart === "" ? [] : takesList ? valuePart.split(",").map((value) => value.trim()) : [valuePart];
  if (arity === "many" ? values.length === 0 : values.length !== arity) return `${operator} takes ${wantedValues(arity)}, and was given ${values.length}`;
  if (values.some((value) => value.trim() === "")) return `${field} was given a blank value; use isEmpty to match a blank`;

  return { field, operator, values };
}

/** What an operator's arity asks for, in the words api's own refusal uses. */
function wantedValues(arity: 0 | 1 | 2 | "many"): string {
  if (arity === 0) return "no value";
  if (arity === 1) return "one value";

  return arity === 2 ? "two comma-separated values" : "at least one comma-separated value";
}

/**
 * `field`, `field:asc` or `field:desc`; a bare field is ascending, as api reads it.
 *
 * `whenAbsent` is the resolved tab's own order, for the reason api's `CaseSort.parse` takes one: the
 * `awaitingConfirmation` tab defaults to longest-waiting first, and every other tab to newest first. A named
 * `sort` wins over either, which is what makes the tab's order a default rather than a fixed one.
 */
function parseSort(sort: string | null, whenAbsent: MockSort = { field: "createdOn", descending: true }): MockSort | string {
  if (sort === null || sort.trim() === "") return whenAbsent;

  const colon = sort.indexOf(":");
  const field = (colon < 0 ? sort : sort.slice(0, colon)).trim();
  const direction = colon < 0 ? "asc" : sort.slice(colon + 1).trim();

  if (!QUERYABLE_FIELDS.has(field)) return `names no sortable case field: '${field}'`;
  if (direction !== "asc" && direction !== "desc") return `takes a direction of asc, desc, and was given '${direction}'`;

  return { field, descending: direction === "desc" };
}

/**
 * The page asked for, clamped as api clamps it, or the parameters that were unusable.
 *
 * `whenSizeAbsent` is a parameter for the reason api's `CasePaging.parse` takes one: the judicial pool applies
 * a different default to the case list's, and everything else about reading the two parameters is the same.
 */
function parsePaging(
  page: string | null,
  size: string | null,
  whenSizeAbsent = DEFAULT_PAGE_SIZE
): { page: number; size: number } | { errors: MockFieldError[] } {
  const errors: MockFieldError[] = [];
  const number = pageNumber("page", page, 1, errors);
  const rows = pageNumber("size", size, whenSizeAbsent, errors);
  if (errors.length > 0) return { errors };

  // Clamped rather than refused, as `CasePaging` clamps it: the cap is a property of the service and not a
  // mistake the caller made, and the response says what size was applied.
  return { page: number, size: Math.min(rows, MAX_PAGE_SIZE) };
}

function pageNumber(name: string, raw: string | null, whenAbsent: number, errors: MockFieldError[]): number {
  if (raw === null || raw.trim() === "") return whenAbsent;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    errors.push({ field: name, message: `takes a whole number of 1 or more, and was given '${raw}'` });
    return whenAbsent;
  }

  return parsed;
}

/**
 * Whether one condition holds for one case.
 *
 * A blank field matches `isEmpty` and nothing else, which is SQL's own answer: a comparison against null
 * is not false so much as unknown, and a row it is unknown for is not returned.
 */
function matchesCondition(record: MockCase, { field, operator, values }: MockCondition): boolean {
  const stored = (record as unknown as Record<string, unknown>)[field];
  if (operator === "isEmpty") return isBlank(stored);
  if (operator === "isNotEmpty") return !isBlank(stored);
  if (isBlank(stored)) return false;

  switch (operator) {
    case "is":
      return rank(stored, coerce(stored, values[0])) === 0;
    case "isOneOf":
      return values.some((value) => rank(stored, coerce(stored, value)) === 0);
    case "before":
    case "lt":
      return rank(stored, coerce(stored, values[0])) < 0;
    case "after":
    case "gt":
      return rank(stored, coerce(stored, values[0])) > 0;
    case "between":
      return rank(stored, coerce(stored, values[0])) >= 0 && rank(stored, coerce(stored, values[1])) <= 0;
    case "contains":
      // A multiselect holds its Dynamics option values, so "contains" asks whether one of them is chosen.
      // Every other kind is text, and text is matched case-insensitively — api's `lower(col) like lower(?)`.
      return Array.isArray(stored) ? stored.some((option) => String(option) === values[0].trim()) : lower(stored).includes(values[0].toLowerCase());
    case "startsWith":
      return lower(stored).startsWith(values[0].toLowerCase());
    default:
      return false;
  }
}

/**
 * Whether the search term matches one case: its reference exactly, or one of the six searched names
 * loosely. api's `q` rule, in one function as api keeps it in one function.
 *
 * The two are ORed and the term is substring, **not** fuzzy — a misspelling matches nothing, so there is
 * no tolerance to add here either. The six fields are the closed list the published `q` description names;
 * addresses and the narrative fields are deliberately not searched, so the mock must not search them.
 */
function matchesTerm(record: MockCase, term: string): boolean {
  if (matchesReference(record, term)) return true;

  const needle = term.toLowerCase();

  return SEARCHED_NAME_FIELDS.some((field) => {
    const stored = record[field];

    return typeof stored === "string" && stored.toLowerCase().includes(needle);
  });
}

/**
 * Whether the term is this case's reference, tolerant of case, hyphens and spaces — so `kbdp2026-10100`
 * and `KBDP202610100` find the same case, as the published description states.
 *
 * The bare serial counts too, since a caseworker reading one off a spreadsheet column has no prefix. A
 * case with no reference matches nothing, rather than matching a term that normalises to empty.
 */
function matchesReference(record: MockCase, term: string): boolean {
  const wanted = normaliseReference(term);
  if (wanted === "") return false;

  return [record.displayReference, record.referencenumber].some(
    (candidate) => candidate !== null && candidate !== undefined && normaliseReference(String(candidate)) === wanted
  );
}

function normaliseReference(value: string): string {
  return value.toLowerCase().replaceAll(/[\s-]/g, "");
}

/** Whether the stored value is one `isEmpty` matches: absent, blank, or an empty multiselect. */
function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;

  return typeof value === "string" && value.trim() === "";
}

/** A condition's value as the type the stored one already is, since that is what decides the comparison. */
function coerce(stored: unknown, value: string): unknown {
  if (stored instanceof Date) return new Date(value.trim());
  if (typeof stored === "number") return Number(value.trim());
  if (typeof stored === "boolean") return value.trim() === "true";

  return value;
}

/** Two comparable values ordered: negative, zero or positive, as a comparator answers. */
function rank(left: unknown, right: unknown): number {
  if (left instanceof Date && right instanceof Date) return left.getTime() - right.getTime();
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "boolean" && typeof right === "boolean") return Number(left) - Number(right);
  const [a, b] = [String(left), String(right)];

  return a === b ? 0 : a < b ? -1 : 1;
}

function lower(value: unknown): string {
  return String(value).toLowerCase();
}

/**
 * The list's order.
 *
 * A blank sorts last ascending and first descending, which is Postgres's default and therefore what api
 * gets — not a choice this file makes.
 */
function comparing(order: MockSort): (left: MockCase, right: MockCase) => number {
  return (left, right) => {
    const a = (left as unknown as Record<string, unknown>)[order.field];
    const b = (right as unknown as Record<string, unknown>)[order.field];
    const ranked = isBlank(a) || isBlank(b) ? (isBlank(a) === isBlank(b) ? 0 : isBlank(a) ? 1 : -1) : rank(a, b);

    // DeedPollService.order appends ascending id even when the primary field is descending.
    return (order.descending ? -ranked : ranked) || rank(left.id, right.id);
  };
}

/** One row of the list: the columns `CaseSummaryResponse` carries and nothing else. */
function toSummary(record: MockCase): unknown {
  return {
    id: record.id,
    displayReference: record.displayReference,
    privacy: record.privacy,
    dateReceived: iso(record.dateReceived),
    type: record.type,
    state: record.state,
    newForename: record.newForename,
    newSurname: record.newSurname,
    // On the row as well as the case, so a worklist can show which rows are with the judiciary without a read
    // per row — which is the whole reason api denormalised it.
    currentReferralState: record.currentReferralState ?? null,
    // Computed at read time from the case's column, as api computes it — so `0` on the day the email was sent
    // and never 1, and `null` for a case waiting for nothing, which is nearly every row. On EVERY row rather than
    // only the waiting tab's: which table shows it is the app's choice about space, not api's about availability.
    daysAwaitingConfirmation: daysBetween(record.awaitingConfirmationSince, new Date())
  };
}

function prefixFor(type: string | null | undefined): string {
  return type === "DeedOfRelinquishment" ? "KBDR" : "KBDP";
}

/** Recompute only the prefix, leaving a reference the mock did not allocate untouched. */
function reprefix(existing: string | null | undefined, type: string | null | undefined): string | null {
  const parsed = existing ? /^KBD[PR](\d{4})-(\d{5})$/.exec(existing) : null;
  if (!parsed) return existing ?? null;

  return `${prefixFor(type)}${parsed[1]}-${parsed[2]}`;
}

/**
 * api's two write-path gates on an update: Publish to London Gazette = No clears the notice date, and a type
 * that hides the minor-only fields (Adult, Adult Transgender, Relinquishment) clears all four.
 */
function writeGates<T extends Partial<MockCase>>(merged: T): T {
  const hidesMinorFields = merged.type === "Adult" || merged.type === "AdultTransgender" || merged.type === "DeedOfRelinquishment";
  return {
    ...merged,
    ...(merged.publishToLondonGazette === false ? { dateNoticeSentToLondonGazette: null } : {}),
    ...(hidesMinorFields ? Object.fromEntries(MINOR_ONLY_FIELDS.map((field) => [field, null])) : {})
  };
}

/**
 * The state, from which dates are populated. The FIRST match wins, and the order is api's.
 *
 * Note that signature-received is evaluated BEFORE the referral pair, so a signed case reads Awaiting
 * Enrolment even when a referral date is also set. That is the source system's behaviour, preserved.
 */
function deriveState(record: Partial<MockCase>): CaseState {
  if (record.dateReturned) return "Returned";
  if (record.dateEnroled) return "Enroled";
  if (record.signatureReceivedDate) return "AwaitingEnrolment";
  if (record.signatureRequestedDate) return "AwaitingSignature";
  if (record.dateReferred && record.dateReadyForMaster) return "ReferredToMaster";
  if (record.dateReadyForMaster) return "ReadyForMaster";
  if (record.awaitingFurtherDocsInfo) return "AwaitingFurtherDocs";

  return "Received";
}

/** The two cross-field date refusals, checked against a fully-merged record. */
function dateRuleErrors(record: Partial<MockCase>): { field: string; message: string }[] {
  const errors: { field: string; message: string }[] = [];

  if (record.dateReturned && record.dateEnroled) {
    errors.push({
      field: "state",
      message: "Date Enroled and Date Returned both contain a date. Please remove one depending on whether the Deed Poll is to be enroled or returned."
    });
  }

  if (record.signatureRequestedDate && record.signatureReceivedDate && record.signatureReceivedDate.getTime() < record.signatureRequestedDate.getTime()) {
    errors.push({ field: "signatureReceivedDate", message: "Signature received date cannot be before the signature requested date." });
  }

  return errors;
}

/**
 * The two-witness gate on enrolment, restating api's `DeedPollService.requireWitnessesForEnrolment`
 * (deed-poll-api at `62c76f4`). Modelled here because a page that explains the refusal cannot be driven
 * against a mock that never issues one — the `yarn dev` journey and the e2e journey both provoke it.
 *
 * **Checked against the MERGED record, and on update only.** A patch touching only a surname on a case
 * that already carries an enrolment date is still a write that leaves the record enrolled, so it is
 * refused too. A create is not gated at api's end and is not gated here: witnesses are children of a row
 * that has to exist first, so no create can carry two.
 *
 * The refusal names one of the two dates and never a witnesses field — there is no witness control on the
 * case form for an error to render against. The date THIS write sets is preferred so the message lands on
 * the box just filled in; otherwise the cascade's own precedence decides.
 */
function enrolmentWitnessError(record: MockCase, patch: Partial<MockCase>, merged: MockCase): { field: string; message: string } | null {
  if (!merged.dateEnroled && !merged.signatureReceivedDate) return null;

  const recorded = record.witnesses.length;
  if (recorded >= WITNESSES_REQUIRED_FOR_ENROLMENT) return null;

  // Only reached while the record is short, so `recorded` is 0 or 1.
  const shortfall = recorded === 1 ? "This case has one; please add one more witness." : "This case has none; please add two witnesses.";

  return { field: enrolmentDateToAddress(patch, merged), message: `${ENROLMENT_WITNESSES_MESSAGE} ${shortfall}` };
}

function enrolmentDateToAddress(patch: Partial<MockCase>, merged: MockCase): string {
  if ("dateEnroled" in patch && merged.dateEnroled) return "dateEnroled";
  if ("signatureReceivedDate" in patch && merged.signatureReceivedDate) return "signatureReceivedDate";

  return merged.dateEnroled ? "dateEnroled" : "signatureReceivedDate";
}

/** The per-type show / hide / mandate matrix. */
function rulesFor(type: string | null, migrated: boolean, publishToGazette: boolean): Record<string, { visible: boolean; required: boolean }> {
  const rules: Record<string, { visible: boolean; required: boolean }> = {};
  for (const field of RULED_FIELDS) rules[field] = { visible: true, required: false };

  const require = (field: string) => {
    rules[field].required = true;
  };
  const hide = (field: string) => {
    rules[field].visible = false;
  };

  if (type === "Adult" || type === "AdultTransgender") {
    for (const field of ["inPerson", "maritalStatus", "urgency", "nationality", "nationalitySection"]) require(field);
    for (const field of MINOR_ONLY_FIELDS) hide(field);
  } else if (type === "Minor" || type === "MinorTransgender") {
    for (const field of ["inPerson", "maritalStatus", "urgency", "nationality", "nationalitySection", "ageOfMinor", "ageOfMinorMonths", "parents"]) {
      require(field);
    }
  } else if (type === "DeedOfRelinquishment") {
    for (const field of ["inPerson", "urgency"]) require(field);
    for (const field of [
      "oldForename",
      "oldMiddleName",
      "oldSurname",
      "maritalStatus",
      "nationality",
      "nationalitySection",
      "nationalitySectionOther",
      "dateNoticeSentToLondonGazette",
      ...MINOR_ONLY_FIELDS
    ]) {
      hide(field);
    }
  }

  // Last, so it overrides whatever the type branch mandated. Visibility is untouched.
  if (migrated) for (const field of MIGRATED_RELAXED_FIELDS) rules[field].required = false;
  if (!publishToGazette) hide("dateNoticeSentToLondonGazette");

  return rules;
}

/** A boolean query parameter, defaulted when absent and null when it is not a boolean. */
function flag(value: string | null, whenAbsent: boolean): boolean | null {
  if (value === null) return whenAbsent;
  if (/^true$/i.test(value)) return true;
  if (/^false$/i.test(value)) return false;

  return null;
}

function toSaved(record: MockCase): unknown {
  // The referrals go with the other children, and unlike them they are on NO case response: api publishes them
  // only under `/caseworker/cases/{id}/referrals`, and what the case itself carries is `currentReferralState`.
  // The notifications are the same, under `/caseworker/cases/{id}/emails` — and there is no column on the case
  // saying an email has been sent, so nothing here is derived from them either.
  const { notes: _notes, witnesses: _witnesses, documents: _documents, referrals: _referrals, notifications: _notifications, ...fields } = record;

  return {
    ...isoDates(fields),
    daysReceivedToEnroled: daysBetween(record.dateReceived, record.dateEnroled),
    daysReceivedToReturned: daysBetween(record.dateReceived, record.dateReturned)
  };
}

/**
 * One case in full, with the three child lists the detail response carries.
 *
 * All three in stored order, which is oldest first and is api's: `DeedPoll`'s associations each declare
 * `@OrderBy("createdOn ASC")`, so the detail response's `notes` are the opposite way round from the notes
 * `GET …/notes` answers. **Do not sort here to match that route** — see `newestFirst`.
 */
function toDetail(record: MockCase): unknown {
  return {
    ...(toSaved(record) as object),
    notes: record.notes.map(toWireNote),
    witnesses: record.witnesses.map(toWireWitness),
    documents: record.documents.map(toWireDocument)
  };
}

/** One document's bytes, with the headers api serves both the caseworker and the judicial download with. */
function sendDocumentFile(res: ServerResponse, document: MockDocument): void {
  res.writeHead(200, {
    "content-type": document.mimeType,
    // `inline` for the three types a browser renders natively, `attachment` otherwise — api's
    // allowlist, mirrored so a caller cannot be written against a disposition the real service
    // never sends. The two headers below travel with it: an inline PDF's viewer runs embedded
    // script, and the policy is what makes rendering one in the caller's origin defensible.
    "content-disposition": `${INLINE_MIME_TYPES.has(document.mimeType) ? "inline" : "attachment"}; filename="${document.originalName.replace(/[^A-Za-z0-9._ -]/g, "")}"`,
    "content-security-policy": "default-src 'none'; sandbox",
    "x-content-type-options": "nosniff",
    "cache-control": "no-store"
  });
  res.end(document.bytes);
}

/**
 * One document's preview, with the headers api publishes for both preview operations, or api's refusal. The same
 * 404 as `/file` for a document with no bytes, because api reads the original first. See `document-preview.ts`.
 */
function sendDocumentPreview(res: ServerResponse, document: MockDocument, mode: DocumentPreviewMode): void {
  if (document.bytes.length === 0) {
    send(res, 404, { error: `Document ${document.id} not found` });
    return;
  }

  const outcome = buildDocumentPreview(document.mimeType, document.bytes, mode);
  if (!outcome.ok) {
    res.writeHead(outcome.status, {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...(outcome.code === "PREVIEW_BUSY" ? { "retry-after": String(PREVIEW_BUSY_RETRY_AFTER_SECONDS) } : {})
    });
    res.end(JSON.stringify({ error: outcome.error, code: outcome.code }));
    return;
  }

  res.writeHead(200, {
    "content-type": "application/pdf",
    "content-length": String(outcome.pdf.length),
    "content-disposition": 'inline; filename="document-preview.pdf"',
    "content-security-policy": "default-src 'none'; sandbox",
    "x-content-type-options": "nosniff",
    "cache-control": "no-store",
    "accept-ranges": "none"
  });
  res.end(outcome.pdf);
}

function toWireNote(note: MockNote): unknown {
  return isoDates(note);
}

function toWireWitness(witness: WireWitness): unknown {
  return isoDates(witness);
}

function toWireDocument(document: MockDocument): unknown {
  const { bytes, ...fields } = document;

  return { ...isoDates(fields), hasFile: bytes.length > 0 };
}

/**
 * One referral's state change: what moved, the audit stamp, and the case column that has to follow it.
 *
 * The stamp is a default rather than a fixed value, so `claimedAt` and `decisionDate` can be the same instant
 * as the `modifiedOn` beside them — a claim recorded a millisecond before the row that holds it is a
 * difference tests would have to tolerate for no reason.
 */
function transition(record: MockCase, referral: MockReferral, author: string, changes: Partial<MockReferral> & { state: ReferralState }): MockReferral {
  Object.assign(referral, { modifiedBy: author, modifiedOn: new Date() }, changes);
  refreshCurrentReferralState(record);

  return referral;
}

/**
 * The case's `currentReferralState`, **recomputed from its referrals** — api-2b's rule, which is "the state of
 * the case's one referral that is not terminal, or null when it has none".
 *
 * A recompute and never a push, which is the whole point of the mechanism rather than a preference: pushing a
 * value per site would write `Closed` when a referral closes, and a case whose direction has been actioned
 * would then sit in the "returned — action needed" queue for good. Closing and withdrawing are both terminal,
 * so both leave this null and the case referable again.
 */
function refreshCurrentReferralState(record: MockCase): void {
  record.currentReferralState = record.referrals.find((referral) => !isTerminal(referral.state))?.state ?? null;
}

/**
 * The case's `awaitingConfirmationSince`, **recomputed from its referrals** — api's `ConfirmationWait`, which is
 * "the earliest confirmation request on the case that has no answer yet, or null when none is outstanding".
 *
 * The **earliest** and not the latest, because the column is what the waiting list orders by: the caseworker is
 * being reminded of the case that has waited longest.
 *
 * **A case really can hold two outstanding requests**, so the `min` is the rule rather than a tie-break for a
 * shape that cannot happen: closing a referral clears neither confirmation column, so a referral closed while
 * its outcome is still null stays outstanding for ever, and the case may be referred, refused and asked again.
 * Recording an answer against the newer one therefore leaves the case on the list, on the older referral's date,
 * which is the whole reason this is a recompute and not a write of null.
 *
 * **The state is not consulted.** api's query filters on the two confirmation columns alone, and a mock that
 * also asked whether the referral was live would take a case off the list the moment somebody closed the
 * referral holding it there.
 */
function refreshAwaitingConfirmation(record: MockCase): void {
  // `flatMap` rather than a filter and a map, so the narrowing survives: a filtered array is still typed as
  // holding nullable dates, which is what a cast would then have to paper over.
  const outstanding = record.referrals.flatMap((referral) =>
    referral.confirmationRequestedAt && !referral.confirmationOutcome ? [referral.confirmationRequestedAt.getTime()] : []
  );

  record.awaitingConfirmationSince = outstanding.length === 0 ? null : new Date(Math.min(...outstanding));
}

/** api's `ReferralState.isTerminal()`. A case holds at most one referral for which this is false. */
function isTerminal(state: ReferralState): boolean {
  return state === "Closed" || state === "Withdrawn";
}

/**
 * api's `ReferralState.canBeWithdrawn()` — a second, independent predicate rather than a narrower
 * `isTerminal`, exactly as `referrals-api-4` added it.
 *
 * **Do not fold this into `isTerminal`.** That one still means `Closed || Withdrawn` and backs two other rules:
 * a case may hold only one referral for which it is false, and `currentReferralState` is the state of that one.
 * Narrowing it so `Decided` counted as terminal would let a case raise a second referral beside a decided one
 * *and* drop the case out of the returned-for-action queue the moment a judge answered it — api's own javadoc
 * says so. `Decided` is deliberately non-terminal and not withdrawable.
 */
function canBeWithdrawn(state: ReferralState): boolean {
  return state === "Open" || state === "Claimed";
}

/**
 * api's two withdrawal refusals, which differ because the caseworker's next action does.
 *
 * A `Decided` referral is refused because there is a direction on it to carry out and then close; a `Closed`
 * or `Withdrawn` one is refused because it is over. One "already X" message for both would tell a caseworker
 * looking at a returned direction that they had already withdrawn it.
 */
function withdrawalRefusal(id: string, state: ReferralState): string {
  return state === "Decided"
    ? `Referral ${id} is Decided -- a direction has been recorded on it and must be actioned and the referral closed, rather than withdrawn`
    : `Referral ${id} is already ${state} and cannot be withdrawn`;
}

/**
 * The note a raised referral writes: what it says, and why it is urgent if it is.
 *
 * **The six composers below reproduce api's `ReferralNotes` word for word** — five at the commit
 * `referrals-admin-5` reconciled against (api `7226fc9`), and the confirmation's at api `83ec959`, which is the
 * document this plan imported. That is deliberate duplication and the one place
 * this mock copies prose: the text is observable behaviour no part of `openapi.json` describes, so nothing but
 * a copy makes the Notes grid locally look like the Notes grid deployed. api's file is the authority —
 * **reword there first**, then here. Nothing parses any of it.
 *
 * Composed from the stored referral rather than from the request body, where api composes this one from the
 * DTO: api's schema trims each optional and treats a blank as absent, which is exactly what `createReferral`
 * stores, so the two agree and the mock has one source for the note instead of two.
 */
function referralRaisedNote(referral: MockReferral): string {
  // Each piece of the caseworker's own text on its own line rather than run into the sentence before it with
  // a full stop this would have to add — api's reasoning: their text is prose they wrote, and one that
  // already ended in a stop would read as "Friday..".
  const lines = [`Referred to a Master. Reasons: ${describedReasons(referral.reasons)}.`];
  if (referral.urgency === "Urgent" && referral.urgencyReason) lines.push(`Marked urgent: ${referral.urgencyReason}`);
  if (referral.notes) lines.push(`Notes: ${referral.notes}`);

  return lines.join("\n");
}

/**
 * The note for a judge taking a referral out of the pool.
 *
 * Says the judiciary has it rather than naming the judge: the note's `createdBy` is that judge, so naming
 * them in the prose would put the same name in the grid twice.
 */
function referralClaimedNote(referral: MockReferral): string {
  return `Referral ${identifiesReferral(referral)}, claimed by a Master.`;
}

/** api D2's `ReferralNotes.assigned`, for a referral assigned from waiting (on its raise, or later). */
function referralAssignedNote(referral: MockReferral, master: string): string {
  return `Referral ${identifiesReferral(referral)}, assigned to ${namedMaster(master)}.`;
}

/** api D2's `ReferralNotes.reassigned`. */
function referralReassignedNote(referral: MockReferral, from: string, to: string): string {
  return `Referral ${identifiesReferral(referral)}, reassigned from ${namedMaster(from)} to ${namedMaster(to)}.`;
}

/** api D2's `ReferralNotes.returnedForAssignment`, composed before the release clears the Master's name. */
function referralReturnedForAssignmentNote(referral: MockReferral, from: string | null | undefined, processingMinutes: number): string {
  return `Referral ${identifiesReferral(referral)}, returned to the office for assignment: no direction from ${namedMaster(from)} within ${durationInWords(processingMinutes)}.`;
}

/** api's `ReferralNotes.named`: a Master's display name bounded at 200 characters, or "an unnamed Master". */
function namedMaster(name: string | null | undefined): string {
  return !name || name.trim() === "" ? "an unnamed Master" : name.slice(0, MAX_MASTER_NAME_IN_NOTE);
}

/** api's `ReferralNotes.inWords`: whole days, else whole hours, else minutes. */
function durationInWords(minutes: number): string {
  const [count, unit] = minutes % 1440 === 0 ? [minutes / 1440, "day"] : minutes % 60 === 0 ? [minutes / 60, "hour"] : [minutes, "minute"];
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/** "the morning of 28 October 2026", as api's cap refusal names a window. */
function windowInWords(window: ReferralWindow): string {
  return `${window.slot === "AM" ? "the morning of" : "the afternoon of"} ${NOTE_DAY.format(new Date(`${window.date}T00:00:00Z`))}`;
}

/** api's 400 for an unknown or unavailable Master, on `masterId`. */
function selectAMaster(): { status: number; body: unknown } {
  return { status: 400, body: { error: SELECT_A_MASTER, errors: [{ field: "masterId", message: SELECT_A_MASTER }] } };
}

/**
 * The note for a judge's direction coming back: what they decided, and whether it goes in the Gazette.
 *
 * **A summary, and deliberately not a copy of `directionsText`** — api allows a direction to be twice what a
 * note may hold, so copying it would compose a note api's own validator refuses, and truncating it would put
 * an incomplete second version of a judicial direction on the timeline reading as though it were the whole of
 * it. The referral's own page has the full text, so the note points at it.
 */
function referralDirectedNote(referral: MockReferral): string {
  return (
    `Master’s direction recorded for referral ${identifiesReferral(referral)}.` +
    ` Decision: ${referral.decision ?? "not recorded"}.` +
    ` Changes to standard publication in the Gazette: ${gazetteAnswer(referral.changesToStandardPublication)}.` +
    " See the referral for the full direction."
  );
}

/**
 * The note for a judge changing the direction they gave. `referralDirectedNote`'s summary with one word changed,
 * so a caseworker scanning the grid can tell a revision from a first direction.
 */
function referralDirectionRevisedNote(referral: MockReferral): string {
  return (
    `Master’s direction revised for referral ${identifiesReferral(referral)}.` +
    ` Decision: ${referral.decision ?? "not recorded"}.` +
    ` Changes to standard publication in the Gazette: ${gazetteAnswer(referral.changesToStandardPublication)}.` +
    " See the referral for the full direction."
  );
}

/** The note for a judge withdrawing their direction to give a new one, composed before the direction is cleared. */
function referralDirectionWithdrawnNote(referral: MockReferral): string {
  return (
    `Master’s direction withdrawn for referral ${identifiesReferral(referral)}.` +
    ` The withdrawn decision was: ${referral.decision ?? "not recorded"}.` +
    ` Changes to standard publication in the Gazette: ${gazetteAnswer(referral.changesToStandardPublication)}.` +
    " The referral is back with the Master to direct again."
  );
}

/** The note for the office acknowledging that a returned direction has been carried out. */
function referralActionedNote(referral: MockReferral): string {
  return `Master’s direction for referral ${identifiesReferral(referral)}, marked as actioned.`;
}

/**
 * The note for a withdrawn referral, naming when it was raised and what for.
 *
 * Said again rather than left to the reader to pair up with the raised note: a case may carry several
 * referrals over its life, and a bare "referral withdrawn" in a grid of thirty notes does not say which.
 */
function referralWithdrawnNote(referral: MockReferral): string {
  return `Referral to a Master withdrawn. It was ${identifiesReferral(referral)}.`;
}

/**
 * The note an applicant's answer writes: which referral was asked, when, what they said, and the caseworker's
 * own words.
 *
 * api's `ReferralNotes.confirmationRecorded`, and the one composer here whose subject is not a state change —
 * recording moves no referral state, and the grid is the only place the answer would otherwise appear.
 *
 * **The answer is the member NAME plus what it means**, as api spells it out: "Confirmed" alone in a grid does
 * not say whether the applicant wanted the deed enrolled or the fee back.
 */
function confirmationRecordedNote(referral: MockReferral, note: string | null): string {
  const lines = [
    `Applicant's confirmation recorded for referral ${identifiesReferral(referral)}. Asked on ${askedOn(referral)}. Answer: ${confirmationAnswer(referral)}.`
  ];
  // The caseworker's own text on its own line with no full stop added, for the reason the raised note's is.
  if (note) lines.push(`Notes: ${note}`);

  return lines.join("\n");
}

/** When the applicant was asked, or that the request was never recorded — api's `asked()`. */
function askedOn(referral: MockReferral): string {
  return referral.confirmationRequestedAt ? NOTE_DAY.format(referral.confirmationRequestedAt) : "a date that was not recorded";
}

/**
 * The answer as the timeline states it — api's `outcome()`, verbatim.
 *
 * Each member carries the consequence the business attaches to it, because the two are not symmetrical: one
 * asks for the deed to be enrolled in the knowledge that it will be published, the other asks for a refund.
 */
function confirmationAnswer(referral: MockReferral): string {
  if (!referral.confirmationOutcome) return "not recorded";

  return referral.confirmationOutcome === "Confirmed"
    ? `${referral.confirmationOutcome} -- the applicant wants the deed enrolled, knowing it will be published in the London Gazette`
    : `${referral.confirmationOutcome} -- the applicant does not want to proceed and asks for a refund`;
}

/**
 * api's refusal of a second answer, verbatim — and it deliberately does **not** name who recorded the first:
 * "naming a colleague in a refusal turns a correction into an accusation".
 *
 * The date is written with the outcome, so a row holding one without the other is unreachable through this
 * route; the fallback exists because a refusal that threw while composing itself would answer 500 for the state
 * it is supposed to explain.
 */
function alreadyConfirmedRefusal(referral: MockReferral): string {
  const when = referral.confirmationReceivedAt ? NOTE_DAY.format(referral.confirmationReceivedAt) : "a date that was not recorded";

  return (
    `Referral ${referral.id} already has a confirmation outcome of ${referral.confirmationOutcome},` +
    ` recorded on ${when}. Recording a second answer would overwrite it, so it is refused`
  );
}

/**
 * The note a sent email writes — api's `EmailNotes.sent`, verbatim.
 *
 * Restated for the reason the referral notes above are: the Notes grid is the only timeline a case has, so an
 * email that left no marker on it is invisible to a caseworker reading the history. Without this the Emails tab
 * and the Notes grid disagree, and a page could ship having never rendered the note api actually writes.
 *
 * **The display name is the only varying part, and there is deliberately no branching per template** — api
 * composes from `EmailTemplate.displayName()` for every member, so a template added later gets its note free.
 *
 * **"Sent", with the second sentence disclaiming delivery.** The note is written at enqueue, when this service
 * has accepted the email and Notify has not; even `Sent` only means Notify accepted it. Pointing at the tab
 * "for its delivery status" is what keeps the sentence true, and keeps it true when callbacks land.
 */
function emailSentNote(template: MockEmailTemplate): string {
  return `${template.displayName} email sent. See the Emails tab for its delivery status.`;
}

/**
 * The note a terminally failed email writes — api's `EmailNotes.couldNotBeSent`, verbatim.
 *
 * **Says nothing about why, and that is api's decision rather than an omission here.** The provider's
 * `failureReason` is unbounded external text, and api excludes it so the note's length stays provable against
 * the notes column — the failure note is written inside the drain's batch transaction, so one the validator
 * refused would roll back rows Notify had already accepted. The tab holds the reason and the verdict, which is
 * what the pointer is for.
 */
function emailCouldNotBeSentNote(template: MockEmailTemplate): string {
  return `${template.displayName} email could not be sent. See the Emails tab for the reason.`;
}

/**
 * Which referral a note is about, in terms a caseworker can recognise — api's `identifies()` fragment, shared
 * by five of the six composers so the notes of one referral pair up in the grid.
 *
 * **Never the id**: it is a uuid, and nobody matches two of those by eye. Nothing of the applicant's either —
 * the note is already under their case. A referral with no reasons is a backfilled one, so it says so rather
 * than trailing off; the raised note above has no such fallback, because api's does not.
 */
/**
 * api's `ReferralReason.label()`: each reason in the admin screens' words, which api's notes write since api#155
 * (Steve, 2026-10-27). Restated here because the mock cannot import the domain's `REFERRAL_REASON_LABEL`; the two
 * must say the same, and `server.test.ts` pins the folded sentence.
 */
const REASON_NOTE_LABEL: Record<string, string> = {
  Minor: "Applicant is a minor",
  DomesticAbuse: "Domestic abuse considerations",
  NonPublication: "Non-publication request",
  DeclarantRequirementsNotMet: "Declarant requirements not met",
  SeparatedOrEstranged: "Separated or estranged",
  Other: "Other",
  MinorTransgender: "Transgender",
  MinorParentalConsent: "Have parental consent",
  MinorNoParentalConsent: "Do not have parental consent",
  MinorStepparentConsent: "Stepparent parental consent",
  MinorNoStepparentConsent: "Do not have stepparent consent",
  MinorCourtOrder: "Court Order",
  MinorAged16Or17Consented: "16/17 year old applicant has consented",
  MinorAged16Or17NotConsented: "16/17 year old applicant has not consented"
};

/**
 * api's `ReferralNotes.described`: a minor's details folded into `Minor`, semicolons between reasons, and an unknown
 * stored name quoted as it stands.
 */
function describedReasons(reasons: readonly string[]): string {
  const label = (name: string) => (Object.hasOwn(REASON_NOTE_LABEL, name) ? REASON_NOTE_LABEL[name] : name);
  const details = reasons.filter((name) => name.startsWith("Minor") && name !== "Minor" && Object.hasOwn(REASON_NOTE_LABEL, name));
  const folded = reasons.includes("Minor") && details.length > 0;

  return reasons
    .filter((name) => !(folded && details.includes(name)))
    .map((name) => (folded && name === "Minor" ? `${label(name)}: ${details.map(label).join(", ")}` : label(name)))
    .join("; ");
}

function identifiesReferral(referral: MockReferral): string {
  const reasons = referral.reasons.length > 0 ? describedReasons(referral.reasons) : "no reasons recorded";

  return `raised on ${NOTE_DAY.format(referral.createdOn)}, reasons: ${reasons}`;
}

/**
 * The Gazette answer as Yes or No, or that it was never recorded.
 *
 * Spelled out and never abbreviated to the presence of a word, which is api's rule and its reason: publication
 * puts the applicant's former and new names in a public notice, so "no changes" and "nothing recorded" must
 * not read alike. Unreachable through the direction route, which stores both halves.
 */
function gazetteAnswer(changes: boolean | null | undefined): string {
  if (changes === null || changes === undefined) return "not recorded";

  return changes ? "Yes" : "No";
}

/**
 * api's directions rule (`ReferralSchemas.parseDirection`): changes to the standard publication need the text that
 * says what they are. In api's words and on api's field, so a page's handling of the 400 is exercised as it will be
 * against api. The mock takes only the new name, as api will once its one-release alias is removed.
 */
function directionsMissing(direction: { changesToStandardPublication: boolean; directionsText?: string }): unknown {
  if (!direction.changesToStandardPublication || direction.directionsText?.trim()) return null;

  return {
    error: "Direction is not valid",
    errors: [
      {
        field: "directionsText",
        message:
          "directionsText is required when there are changes to the standard publication in the Gazette: say whether to publish nothing, or what to publish"
      }
    ]
  };
}

/**
 * Write a note onto a case's timeline, as api's `NoteService.createNote` writes one.
 *
 * Both audit columns are stamped on create and with the same instant, which is api's behaviour and what makes
 * the grid's `unmodified` flag true: "modified" there means "last written", not "edited since".
 *
 * Pushed onto the stored array in insertion order — the reads are what order a timeline, see `newestFirst`.
 */
function appendNote(record: MockCase, text: string, author: string): void {
  const now = new Date();
  record.notes.push({ id: randomUUID(), note: text, createdOn: now, modifiedOn: now, createdBy: author, modifiedBy: author });
}

/**
 * A case's notes newest first — a sorted COPY, because the stored array is the chronology the case detail
 * publishes and reversing it in place would make one read's order depend on another having happened.
 *
 * **One of the two note reads is newest-first and the other is not, which is api's shape rather than an
 * inconsistency here.** `GET …/notes` comes from `NoteService.findNotes` — `findByDeedPollIdOrderByCreatedOnDesc` —
 * while the `notes` on `GET /caseworker/cases/{id}` come off the entity's `@OneToMany` with
 * `@OrderBy("createdOn ASC")`, oldest first. (A Master's referral carried a third, newest-first copy until
 * 2026-10-27.) So `toDetail` deliberately does NOT call this: making both newest-first would read as tidiness
 * and be the drift this mock exists to prevent. (`referrals-admin-5`'s decision 2 asked for all three; api's
 * source says otherwise and api is the authority. The app's own grid sorts what it is given —
 * `buildNotesView` — so no page depends on either order.)
 *
 * Equal timestamps fall back to insertion order reversed, which api leaves to Postgres: several notes of one
 * transition sequence land in the same millisecond here, and without a tiebreak the order of a timeline would
 * be whatever `sort` did with them.
 */
function newestFirst(notes: readonly MockNote[]): MockNote[] {
  return notes
    .map((note, at) => ({ note, at }))
    .sort((left, right) => writtenAt(right.note) - writtenAt(left.note) || right.at - left.at)
    .map((entry) => entry.note);
}

/** When a note was written, or the epoch for a seeded one carrying no timestamp — which sorts it last. */
function writtenAt(note: MockNote): number {
  return note.createdOn ? note.createdOn.getTime() : 0;
}

/**
 * api's two conditional requirements on a create, from `ReferralSchemas.parseCreateReferral`: `notes` when
 * `Other` is among the reasons, and `urgencyReason` when the urgency is `Urgent`.
 *
 * Restated because both are refusals a page renders against a field, and a mock that accepted either pair
 * would let the create form ship with the rule applied at neither end. The bounds and the members are the
 * schema's, so only what a shape cannot express is here.
 */
function referralConditionalErrors(body: { reasons: readonly string[]; notes?: string; urgency?: string; urgencyReason?: string }): MockFieldError[] {
  const errors: MockFieldError[] = [];

  if (body.reasons.includes("Other") && !body.notes?.trim()) {
    errors.push({ field: "notes", message: "notes is required when Other is among the reasons" });
  }
  if (body.urgency === "Urgent" && !body.urgencyReason?.trim()) {
    errors.push({ field: "urgencyReason", message: "urgencyReason is required when urgency is Urgent" });
  }
  // api's three rules on a minor's details, in its words. `Minor` alone is refused on a create only, as api.
  const details = body.reasons.filter((reason) => reason.startsWith("Minor") && reason !== "Minor");
  if (details.length === 0 && body.reasons.includes("Minor")) {
    errors.push({
      field: "reasons",
      message: `reasons names Minor without saying what applies to the minor's application: name at least one of ${MOCK_MINOR_DETAILS.join(", ")}`
    });
  }
  if (details.length > 0 && !body.reasons.includes("Minor")) {
    errors.push({ field: "reasons", message: `reasons names a minor's detail (${details.join(", ")}) without Minor` });
  }
  for (const [first, second] of MOCK_CONTRADICTORY_MINOR_DETAILS) {
    if (details.includes(first) && details.includes(second)) {
      errors.push({ field: "reasons", message: `reasons cannot name both ${first} and ${second}` });
    }
  }

  return errors;
}

/** api's `ReferralReason::isMinorDetail` members, in declaration order, as its refusal names them. */
const MOCK_MINOR_DETAILS = REFERRAL_REASON.filter((reason) => reason.startsWith("Minor") && reason !== "Minor");

/** api's `ReferralSchemas.CONTRADICTORY_MINOR_DETAILS`. */
const MOCK_CONTRADICTORY_MINOR_DETAILS = [
  ["MinorParentalConsent", "MinorNoParentalConsent"],
  ["MinorStepparentConsent", "MinorNoStepparentConsent"],
  ["MinorAged16Or17Consented", "MinorAged16Or17NotConsented"]
] as const;

/**
 * The one slot api pre-populates, from the referral's direction. api's `EmailSlot.JUDGES_REASON`.
 *
 * `snake_case` because it is a GOV.UK Notify placeholder name, which is the personalisation key and the
 * request-body key at once — the documented exception to this package's camelCase wire rule. Renamed, Notify
 * substitutes nothing and the applicant reads a refusal with an empty quotation in it.
 */
const JUDGES_REASON = "judges_reason";

/**
 * Everything the Email tab needs, in one response — api's `CaseEmailService.overview`.
 *
 * Availability carries **every** template, applicable or not, with the sentence saying why not: a tab sent only
 * the applicable ones would show a shorter list with no explanation, and "why can I not send the refusal letter"
 * is the question a caseworker would then ask a person.
 */
function toWireCaseEmails(record: MockCase): unknown {
  const availability = MOCK_EMAIL_TEMPLATES.map((template) => {
    const applicable = applicableReferral(record, template) !== undefined;

    return {
      template: template.key,
      applicable,
      // Null when it applies rather than a sentence saying so, which is api's shape: `reason` answers only "why
      // can I not send this".
      reason: applicable ? null : template.notApplicable,
      provisioned: true,
      slots: template.slots.map((slot) => ({ name: slot.name, required: slot.required, maxLength: slot.maxLength }))
    };
  });

  return {
    availability,
    // Newest first, as api's `findByDeedPollIdOrderByCreatedOnDesc` answers — a tab rendering them in the order
    // it is given would otherwise see insertion order here and the reverse deployed.
    history: [...record.notifications].sort((left, right) => right.createdOn.getTime() - left.createdOn.getTime()).map(toWireEmailHistory),
    // Only the APPLICABLE templates, which is api's `overview`: a default for an email that cannot be sent would
    // be a value resolved from a referral that does not exist.
    slotDefaults: MOCK_EMAIL_TEMPLATES.filter((template) => applicableReferral(record, template) !== undefined).map((template) => ({
      template: template.key,
      fields: slotDefaults(record, template)
    }))
  };
}

/**
 * The starting values for one template's slots: the judge's words for the slot that has them, and empty for the
 * rest.
 *
 * **api resolves these through the same path a send takes, and that path can refuse — so this is narrower than
 * api on purpose.** `CaseEmailService.slotDefaults` composes with an empty payload, which means a Rejected
 * referral carrying *no* directions text makes `judges_reason` fail its required check and the whole
 * `GET …/emails` answer 400 — the Email tab's one load-bearing read, refused for a case that legitimately
 * exists, since a direction is optional even on a refusal. That is api's defect rather than a rule worth
 * restating: mirroring it would have the tab built to handle its own read failing, so here an undefaulted slot
 * is the empty string api's own `getOrDefault(…, "")` intends. Raised as a flag on the plan.
 */
function slotDefaults(record: MockCase, template: MockEmailTemplate): Record<string, string> {
  const referral = applicableReferral(record, template);

  return Object.fromEntries(template.slots.map((slot) => [slot.name, slot.name === JUDGES_REASON ? (referral?.directionsText ?? "") : ""]));
}

/** One history row: the stored notification, minus the outbox bookkeeping no response carries. */
function toWireEmailHistory(notification: MockNotification): unknown {
  const template = MOCK_EMAIL_TEMPLATES.find((candidate) => candidate.member === notification.template);

  return {
    id: notification.id,
    // The KEY, not the stored member name — and a row whose template no longer exists keeps the raw column in
    // both fields rather than making the whole history unreadable, which is api's own fallback.
    template: template?.key ?? notification.template,
    templateName: template?.displayName ?? notification.template,
    subject: notification.subject,
    body: notification.body,
    recipient: notification.recipient,
    notifyState: notification.state,
    failureReason: notification.failureReason,
    createdBy: notification.createdBy,
    createdOn: iso(notification.createdOn),
    // Always empty, because the one shipped template declares no document keys: an email cannot currently carry
    // an attachment at all. Attachments arrive with notify-4, which is blocked on document generation.
    documents: []
  };
}

/**
 * The referral that entitles this case to this email, or undefined.
 *
 * Newest first, because api's case-scoped finder is ordered that way and a case referred twice has been refused
 * on whichever referral was most recent — quoting an older refusal would tell the applicant about a decision
 * that has since been superseded.
 *
 * One rule for the one template, and it is api's `cause`: a referral of this case that a Master has refused.
 */
function applicableReferral(record: MockCase, template: MockEmailTemplate): MockReferral | undefined {
  if (template.member !== APPLICATION_REJECTED) return undefined;

  return [...record.referrals].sort((left, right) => right.createdOn.getTime() - left.createdOn.getTime()).find((referral) => referral.decision === "Rejected");
}

/**
 * The referral behind the email and the slots as api would accept them, or the refusal to send back.
 *
 * Shared by the preview and the send so what a caseworker approved is what is stored: two resolvers would be two
 * ways of answering the same question, and the one place they could differ is the content of a letter about a
 * refusal.
 *
 * **Every refusal at once**, as api's `EmailSlots.parse` reports them: a payload that both omits the judge's
 * reason and tries to set the reference number comes back naming both, rather than costing a round trip per
 * mistake.
 */
function composeEmail(record: MockCase, template: MockEmailTemplate, body: unknown): ComposedEmail | MockRefusal {
  const referral = applicableReferral(record, template);
  // 409 and not a 400: nothing about the request is wrong, and the same request succeeds unchanged once a Master
  // has refused the application.
  if (!referral) return { status: 409, body: { error: template.notApplicable } };

  const fields: Record<string, unknown> = body !== null && typeof body === "object" ? { ...(body as Record<string, unknown>) } : {};
  const errors: MockFieldError[] = [];

  // Unknown keys are REFUSED AND NAMED rather than stripped, which is `additionalProperties: false` on both write
  // bodies and the one place api departs from every other schema of its own. The interesting unknown keys are
  // exactly the ones a caller must not send — `reference_number`, `applied_online` — so stripping them would
  // honour the request while silently ignoring the part that mattered, and a caseworker who had tried to change
  // the reference an applicant is told would get a success and a different email.
  for (const key of Object.keys(fields)) {
    if (template.slots.some((slot) => slot.name === key)) continue;
    errors.push({
      field: key,
      message: template.resolvedKeys.includes(key)
        ? `${key} is resolved from the case and cannot be set by the caller. Only ${slotNames(template)} may be supplied`
        : `'${key}' is not a slot of ${template.key}. One of ${slotNames(template)}`
    });
  }

  const slots: Record<string, string> = {};
  for (const slot of template.slots) {
    const sent = fields[slot.name];
    if (sent !== undefined && sent !== null && typeof sent !== "string") {
      errors.push({ field: slot.name, message: `${slot.name} must be text` });
      continue;
    }

    // Blank becomes absent rather than an empty string, which is what makes `required` mean anything: a
    // `judges_reason` of spaces must not satisfy it, because an email quoting a judge as having said nothing
    // reads as a quotation until somebody opens it.
    const supplied = typeof sent === "string" ? sent.trim() : "";
    const direction = slot.name === JUDGES_REASON ? (referral.directionsText ?? "") : "";
    // The judge's own words when the caseworker sent none, read UNALTERED: they were trimmed and bounded when the
    // judge recorded them, and re-trimming here would make this the second place that decides what a direction
    // says.
    const prePopulated = supplied === "" && direction.trim() !== "";
    const value = prePopulated ? direction : supplied;

    if (value === "") {
      if (slot.required) {
        errors.push({
          field: slot.name,
          message: `${slot.name} is required: this email quotes the judge, and there is no direction recorded to pre-populate it from`
        });
      }
      continue;
    }

    // Refused rather than truncated, at either origin: a shortened quotation of a judge is worse than a
    // caseworker being asked to shorten one. The message differs because somebody who typed nothing needs to be
    // told why the pre-filled text is the problem.
    if (value.length > slot.maxLength) {
      errors.push({
        field: slot.name,
        message: prePopulated
          ? `${slot.name} is pre-populated from the judge's direction, which is longer than the ${slot.maxLength} characters this email can carry. Shorten it before sending`
          : `${slot.name} must be ${slot.maxLength} characters or fewer`
      });
      continue;
    }

    slots[slot.name] = value;
  }

  if (errors.length > 0) return { status: 400, body: { error: "Email content is not valid", errors } };

  return { referral, slots };
}

/** The slots a template takes, listed in a refusal so a client does not have to hold the enum. */
function slotNames(template: MockEmailTemplate): string {
  return template.slots.map((slot) => slot.name).join(", ");
}

/**
 * The email as this mock's stand-in Notify renders it: a subject, the HTML an applicant would see, and the text
 * rendering of the same thing.
 *
 * **The wording is a stand-in and nothing should assert on it.** The real template is a content designer's,
 * authored in Notify, and this exists so a preview page has real HTML to sandbox and a history page has real
 * paragraphs to render. What IS faithful is the shape: HTML for the preview and plain text for the stored body,
 * which are two different renderings of one template rather than one string used twice.
 *
 * The refund paragraph branches on `postCounter`, which is api's `appliedOnline`: only `Online` means the
 * applicant paid online, and every other value gets the paragraph that asks how they paid — a wrong guess
 * recovers, where promising a refund to a card nobody paid with leaves somebody waiting for money.
 */
function renderEmail(record: MockCase, template: MockEmailTemplate, slots: Record<string, string>): RenderedEmail {
  const formerName = [record.oldForename, record.oldSurname].filter((part) => (part ?? "").trim() !== "").join(" ");
  const paragraphs = [
    "Dear applicant,",
    `Regarding your application to change your name from ${formerName || "the name on your application"} (reference ${record.displayReference ?? "not yet allocated"}).`,
    "The Master has refused your application for the following reason:",
    slots[JUDGES_REASON] ?? "",
    slots.additional_notes ?? "",
    record.postCounter === "Online"
      ? "We will refund your fee to the account you paid from."
      : "We will refund your fee. Please tell us how you paid and where to send the refund.",
    "Kind regards,"
  ].filter((paragraph) => paragraph !== "");

  return {
    preview: {
      subject: `${template.displayName}: ${record.displayReference ?? "your application"}`,
      // Not escaped, deliberately — see the file's docblock. Notify escapes personalisation; a mock that did
      // would let the preview page ship having only ever been given HTML it was safe to interpolate, which is
      // the one thing decision 3's sandbox exists to stop anybody relying on.
      html: `<html lang="en"><body>${paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join("")}</body></html>`,
      // Fixed, because Notify increments the version when a content designer edits the template and there is no
      // template here to edit.
      templateVersion: 1
    },
    body: paragraphs.join("\n\n")
  };
}

/**
 * Whether a judge may see one referral at all — api's `JudicialReferralService.visibleTo`.
 *
 * Since api D2 an `Open` referral is waiting for assignment and nobody's; a `Claimed` one is only its assigned
 * Master's, once linked (an assignment to a Master who has never signed in is visible to nobody until linking); a
 * `Decided` one is only the judge's who directed it; and a `Closed` or `Withdrawn` one is nobody's.
 *
 * **The identity compared is the token's subject and never the display name** — api's `claimedById`/`decidedById`
 * since `V14__referral_owner_subjects.sql`. Comparing names was the defect that migration fixed: two judges
 * sharing one saw and directed each other's referrals, and a judge whose name changed lost their own.
 *
 * A row with no owner subject is visible to nobody, and there is deliberately **no fall back to the name**: that
 * row is a pre-migration claim, and comparing names on exactly the rows where identity is least certain would keep
 * the collision where it does most harm.
 */
function visibleToJudge(referral: MockReferral, subject: string): boolean {
  // Since api D2 an `Open` referral is waiting for assignment and visible to no judge.
  // `subject ===`, so a null owner is false rather than a match on two absent values.
  if (referral.state === "Claimed") return subject === referral.claimedById;
  if (referral.state === "Decided") return subject === referral.decidedById;

  return false;
}

/**
 * The order a judge's own referrals are listed in, from api D2's `MINE_ORDER` (Steve, 2026-10-28, for the Master's
 * grouped page): `Claimed` (undirected) before `Decided`; among the undirected only, urgent first; then the oldest
 * `createdOn` first; then the id, so the order between one page and the next is deterministic.
 */
function myReferralsOrder(left: MockReferral, right: MockReferral): number {
  return (
    stateKey(left) - stateKey(right) || urgentKey(left) - urgentKey(right) || left.createdOn.getTime() - right.createdOn.getTime() || rank(left.id, right.id)
  );
}

function stateKey(referral: MockReferral): number {
  return referral.state === "Claimed" ? 0 : 1;
}

function urgentKey(referral: MockReferral): number {
  return referral.state === "Claimed" && referral.urgency === "Urgent" ? 0 : 1;
}

/**
 * One referral as the caseworker surface publishes it — every stored field except the two owner subjects.
 *
 * **Named out rather than filtered by a rule**, because a spread is what this is: `isoDates` copies the record, so
 * any field added to `MockReferral` reaches the wire unless it is destructured away here. api publishes
 * `claimedById`/`decidedById` on no DTO, and a mock that leaked them would let a page key authorisation off a
 * subject api never sends.
 */
function wireReferral(referral: MockReferral, processingMinutes: number): unknown {
  const { claimedById, decidedById, assignedMasterId, ...published } = referral;

  return {
    ...isoDates(published),
    assignedAt: iso(referral.assignedAt),
    windowDate: referral.windowDate ?? null,
    windowSlot: referral.windowSlot ?? null,
    // The name it was assigned under, as api's `AssignedMasterResponse` carries it; never the subject or the email.
    assignedMaster: assignedMasterId ? { id: assignedMasterId, name: referral.claimedBy ?? null } : null,
    directionDueBy: iso(directionDueBy(referral, processingMinutes))
  };
}

/**
 * api's `DirectionDue.by`: while `Claimed`, the processing window's start (`assignedAt`, or `claimedAt` for a claim
 * made before assignment) plus its length as set now; null in every other state.
 */
function directionDueBy(referral: MockReferral, processingMinutes: number): Date | null {
  if (referral.state !== "Claimed") return null;
  const started = referral.assignedAt ?? referral.claimedAt;
  return started ? new Date(started.getTime() + processingMinutes * 60_000) : null;
}

/**
 * One pool row: the seven fields `JudicialReferralSummary` carries.
 *
 * Built field by field rather than from the stored referral, because what is left out is the point — a pool row
 * carrying the direction would show a judge the answer before they had read the papers, and one carrying the
 * applicant's names would make the pool a list of applications a judge has not been asked to see.
 */
function wireJudicialSummary(referral: MockReferral, processingMinutes: number): unknown {
  return {
    id: referral.id,
    state: referral.state,
    reasons: referral.reasons,
    notes: referral.notes ?? null,
    urgency: referral.urgency ?? null,
    urgencyReason: referral.urgencyReason ?? null,
    createdOn: iso(referral.createdOn),
    assignedAt: iso(referral.assignedAt),
    directionDueBy: iso(directionDueBy(referral, processingMinutes))
  };
}

/**
 * One referral as the Master who may see it reads it: the referral and the application with its readable documents.
 * No case notes since 2026-10-27 (Master Sullivan's feedback), as api.
 *
 * `application` is api's `JudicialApplicationView` written out field by field, and deliberately not a projection
 * of the case: api's own `NamespaceSeparationSecurityTest` asserts the two records are unrelated, because the
 * failure it guards against is a field added to the caseworker response silently appearing on a Master's screen.
 * Spreading the case here would be exactly that failure.
 */
function wireJudicialDetail(record: MockCase, referral: MockReferral, processingMinutes: number): unknown {
  return {
    ...(wireJudicialSummary(referral, processingMinutes) as object),
    claimedBy: referral.claimedBy ?? null,
    claimedAt: iso(referral.claimedAt),
    decision: referral.decision ?? null,
    directionsText: referral.directionsText ?? null,
    changesToStandardPublication: referral.changesToStandardPublication ?? null,
    decisionDate: iso(referral.decisionDate),
    decidedBy: referral.decidedBy ?? null,
    directionChangedAt: iso(referral.directionChangedAt),
    application: toWireJudicialApplication(record)
  };
}

/** The two case types api's `DeedPollValidation.isMinor` names: the only applications whose parents a Master sees. */
const MINOR_TYPES: ReadonlySet<string> = new Set(["Minor", "MinorTransgender"]);

function toWireJudicialApplication(record: MockCase): unknown {
  return {
    displayReference: record.displayReference ?? null,
    newForename: record.newForename ?? null,
    newMiddleName: record.newMiddleName ?? null,
    newSurname: record.newSurname ?? null,
    oldForename: record.oldForename ?? null,
    oldMiddleName: record.oldMiddleName ?? null,
    oldSurname: record.oldSurname ?? null,
    type: record.type ?? null,
    nationality: record.nationality ?? null,
    nationalitySection: record.nationalitySection ?? null,
    nationalitySectionOther: record.nationalitySectionOther ?? null,
    // api sends the parents only on a minor's application, whatever the row holds.
    parents: record.type && MINOR_TYPES.has(record.type) ? (record.parents ?? null) : null,
    // Only documents with a file, as api lists only readable ones: every row a Master sees can be opened.
    documents: record.documents
      .filter((document) => document.bytes.length > 0)
      .map((document) => ({
        id: document.id,
        name: document.name,
        documentType: document.documentType.name ?? null,
        direction: document.direction,
        mimeType: document.mimeType,
        sizeBytes: document.sizeBytes ?? null,
        uploadedOn: iso(document.createdOn)
      }))
  };
}

/**
 * Every `Date` in an object as an ISO string.
 *
 * Serialised explicitly rather than left to `JSON.stringify`, so the mock's wire format is a decision this
 * file makes rather than a default it inherits — and so a `Date` reaching a response is visible here.
 */
function isoDates<T extends object>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, member]) => [key, member instanceof Date ? iso(member) : member]));
}

/**
 * A date-time in api's format, which is **zoneless** — `2026-03-10T00:00:00.000`, not `…Z`.
 *
 * Every date-time api publishes is a Jackson-serialised `LocalDateTime`, so it carries no offset. That is
 * the whole reason `wire.ts` has `toUtcDate`: read as local time, a midnight date west of Greenwich renders
 * as the previous day. Emitting `toISOString()` here would make the mock the one caller of the adapter that
 * never takes that path, so the conversion the deployed app depends on would be exercised by nothing.
 */
function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString().replace(/Z$/, "") : null;
}

/** Whole days between two dates in UTC, as api's computed columns count them. */
function daysBetween(from: Date | null | undefined, to: Date | null | undefined): number | null {
  if (!from || !to) return null;
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());

  return Math.round((end - start) / 86_400_000);
}

/** A rejected body as api reports one: a message plus the failures addressed to their fields. */
function fieldErrorsFrom(issues: readonly { path: readonly PropertyKey[]; message: string }[]): unknown {
  return {
    error: "Request body is not valid",
    errors: issues.map((issue) => ({ field: issue.path.map(String).join("."), message: issue.message }))
  };
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function sendNoContent(res: ServerResponse): void {
  res.writeHead(204);
  res.end();
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const raw = (await readRawBody(req)).toString("utf8");
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function readRawBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);

  return Buffer.concat(chunks);
}

/**
 * Pull the file part and the text fields out of a multipart body.
 *
 * Enough of RFC 7578 for one upload with three fields beside it. The body is split on the boundary as
 * latin1 so a byte is a character — decoding a JPEG as UTF-8 would report a size that is neither the
 * file's nor reproducible — and the file's bytes are recovered from that same encoding.
 */
function parseMultipart(body: Buffer, contentType: string): ParsedUpload | null {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  if (!boundary) return null;

  const upload: ParsedUpload = { fields: {}, file: null };
  for (const part of body.toString("latin1").split(`--${boundary[1] ?? boundary[2]}`)) {
    const separator = part.indexOf("\r\n\r\n");
    if (separator === -1) continue;

    const headers = part.slice(0, separator);
    const name = /name="([^"]*)"/.exec(headers);
    if (!name) continue;

    // The part's payload ends with the CRLF that precedes the next boundary delimiter.
    const content = part.slice(separator + 4).replace(/\r\n$/, "");
    const filename = /filename="([^"]*)"/.exec(headers);

    if (filename) {
      const mimeType = /content-type:\s*([^\r\n]+)/i.exec(headers);
      upload.file = {
        name: filename[1],
        mimeType: mimeType?.[1].trim() ?? "application/octet-stream",
        bytes: Buffer.from(content, "latin1")
      };
    } else {
      upload.fields[name[1]] = Buffer.from(content, "latin1").toString("utf8");
    }
  }

  return upload;
}

export interface MockApiOptions {
  scenario?: MockScenario;
  /** Optional local IDAM endpoint for access tokens whose roles live in userinfo. */
  userInfoUrl?: string;
}

export interface MockApi {
  server: Server;
  readonly scenario: MockScenario;
  setScenario(scenario: MockScenario): void;
  /** Put a case straight into memory, bypassing the create rules. For tests that start mid-lifecycle. */
  seed(record: Partial<MockCase> | null): MockCase;
  /**
   * Forget every case, every reference serial and every saved query.
   *
   * In process as well as over `POST /__mock/reset`, so a suite sharing one mock across a file can start
   * each test from empty. Without it the per-year serials accumulate, and any assertion on a reference
   * number or a list length becomes dependent on what ran before it.
   */
  reset(): void;
}

export interface RunningMockApi extends MockApi {
  url: string;
  close(): Promise<void>;
}

/**
 * A case as the mock holds it: api's saved-case fields with dates still `Date`, plus the children and the
 * document bytes it has nowhere else to put.
 *
 * The two computed columns are absent because they are derived on the way out, and the columns the mock
 * always populates are tightened to non-null — a stored case with no `state` or no `createdOn` is not a
 * state api can be in, so the mock should not be able to represent one either.
 */
export type MockCase = Omit<WireSavedCase, "daysReceivedToEnroled" | "daysReceivedToReturned" | "state" | "createdOn" | "modifiedOn"> & {
  state: CaseState;
  createdOn: Date;
  modifiedOn: Date;
  notes: MockNote[];
  witnesses: WireWitness[];
  documents: MockDocument[];
  referrals: MockReferral[];
  /**
   * The outbox rows for this case, which are a child of it here and at api — but unlike the other four they are
   * on **no** case response: they reach a caller only through `GET /caseworker/cases/{id}/emails`.
   *
   * Seedable, because three of the four states a row can be in are unreachable through the contract: a send
   * drains immediately, so everything driven through the send route is `Sent` with content. See
   * `MOCK_EMAIL_HISTORY`.
   */
  notifications: MockNotification[];
};

type CaseState = NonNullable<WireSavedCase["state"]>;

/**
 * A referral as the mock holds it: api's published referral with its dates still `Date`, and `state` tightened
 * to non-null, since a stored referral without one is not a state api can be in.
 *
 * No `lastTouchedAt`, which api keeps and publishes nowhere: it is the inactivity sweep's bookkeeping, and the
 * sweep is one of the three things this mock deliberately does not model.
 */
type MockReferral = Omit<
  WireReferral,
  | "state"
  | "claimedAt"
  | "decisionDate"
  | "directionChangedAt"
  | "confirmationRequestedAt"
  | "confirmationReceivedAt"
  | "createdOn"
  | "modifiedOn"
  | "assignedAt"
  | "assignedMaster"
  | "directionDueBy"
> & {
  state: ReferralState;
  claimedAt: Date | null;
  /**
   * api D2's assignment: the Masters-list entry (published only as `assignedMaster`, with the name it was assigned
   * under) and when, which starts the processing window. Optional so a referral seeded before assignment existed
   * reads as api's pre-D2 claim. `windowDate`/`windowSlot` are the wire's own.
   */
  assignedMasterId?: string | null;
  assignedAt?: Date | null;
  decisionDate: Date | null;
  /** Set by a change or a withdrawal of the direction and never cleared, as api's column is. */
  directionChangedAt: Date | null;
  /**
   * The wait for the applicant's answer and the moment a caseworker recorded it — `Date | null` for the reason
   * every other stored date here is, and never `undefined`: `refreshAwaitingConfirmation` reads both to decide
   * whether the case is still on the waiting list, and a third absent-ish value would be a third case to get
   * right at that one site.
   *
   * **`confirmationReceivedAt` is when the answer was RECORDED**, from this mock's clock as api takes it from
   * its own, and never when the applicant replied — which nothing here or at api's end knows.
   */
  confirmationRequestedAt: Date | null;
  confirmationReceivedAt: Date | null;
  createdOn: Date;
  modifiedOn: Date;
  /**
   * Who holds it and who directed it, as their IDAM subject — api's `claimedById`/`decidedById`, added by
   * `V14__referral_owner_subjects.sql` and published by **no** DTO.
   *
   * **Stored here and stripped on the way out**, which is the point rather than an oddity: these are what
   * `visibleToJudge` and `myReferrals` compare, and `claimedBy`/`decidedBy` beside them are attribution that
   * authorises nothing. `toWireReferral` omits them explicitly — it spreads the record, so a new field reaches
   * the caseworker referral response unless it is named there — and the two judicial serialisers build their
   * fields one at a time and never could.
   *
   * `null` on a referral nobody has claimed, and also on one this mock seeded with a `claimedBy` and no subject:
   * that is api's pre-migration row, and it is visible to nobody and on nobody's list, exactly as api fails it
   * closed rather than falling back to the name.
   */
  claimedById: string | null;
  decidedById: string | null;
};

type ReferralState = NonNullable<WireReferral["state"]>;

/** A Master as assignment reads one: the subject is stored on the referral and never published. */
type Assignee = NonNullable<ReturnType<ReturnType<typeof createMasters>["assignee"]>>;

/**
 * A saved query as the mock holds it: api's published fields with the dates still `Date`, minus the two
 * flags derived per caller on the way out.
 *
 * `selected` is derived from the selection set and `editable` is the constant this mock cannot do better
 * than, so neither is storable — a record carrying either would be a second place for the answer to live.
 */
type MockSavedQuery = Omit<WireSavedQuery, "selected" | "editable" | "createdOn" | "modifiedOn"> & {
  createdOn: Date;
  modifiedOn: Date;
};

/** One condition of a list query, already checked as far as the mock checks one. */
interface MockCondition {
  field: string;
  operator: string;
  /** One value for most operators, two for `between`, one or more for `isOneOf`, none for the two empties. */
  values: string[];
}

interface MockSort {
  field: string;
  descending: boolean;
}

/** A refusal addressed to the parameter that caused it — `where.0`, `sort`, `page`. */
interface MockFieldError {
  field: string;
  message: string;
}

/** One request's resolved email: the referral that caused it, and the slots as api would have accepted them. */
interface ComposedEmail {
  referral: MockReferral;
  /** Keyed by `snake_case` placeholder name, absent where an optional slot was left blank. */
  slots: Record<string, string>;
}

/**
 * A refusal ready to send, so a compose can report one without holding the response.
 *
 * `status` is what distinguishes it from a `ComposedEmail`, which is why the caller narrows on that key rather
 * than on a flag: an extra discriminator would be a second thing to keep true.
 */
interface MockRefusal {
  status: number;
  body: { error: string; errors?: MockFieldError[] };
}

/** One rendered email: what a preview answers, and the text rendering a sent row stores. */
interface RenderedEmail {
  preview: { subject: string; html: string; templateVersion: number };
  body: string;
}

type MockNote = WireNote;

/** A stored document: what api publishes, minus `hasFile` (derived), plus the bytes and what they are. */
type MockDocument = Omit<WireDocument, "hasFile" | "name" | "originalName" | "mimeType" | "documentType" | "direction"> & {
  name: string;
  originalName: string;
  mimeType: string;
  documentType: WireDocumentType;
  direction: NonNullable<WireDocument["direction"]>;
  bytes: Buffer;
};

interface ParsedUpload {
  fields: Record<string, string>;
  file: { name: string; mimeType: string; bytes: Buffer } | null;
}

/** Re-exported for the mock's own tests and `main.ts`; not part of the package's public surface. */
export type { WireCaseDetail, WireCaseWrite };
