/**
 * The wire shape of `deed-poll-api`'s caseworker surface, mirroring `openapi.json` property for
 * property.
 *
 * Zod schemas rather than hand-written interfaces, for the two reasons `deed-poll-web`'s client gives:
 * an external API's response is untrusted input like any other, so a missing field surfaces as a typed
 * `invalid-response` at the call rather than as `undefined` rendered into a case page; and the types are
 * INFERRED from the schemas, so the parser and the type cannot drift. `contract.test.ts` then compares
 * the schemas against the spec, closing the loop with one comparison instead of three.
 *
 * Unlike `deed-poll-web`'s client, these keys are camelCase: api is Spring with Jackson's defaults, so
 * its JSON already uses the names this app's view models read. Nothing is renamed at the boundary. What
 * IS converted is two value types, and both conversions live here because this is the only module that
 * knows the wire format:
 *
 *   - `format: date-time` fields arrive as ISO strings and become `Date`, because every consumer above
 *     the adapter — `computed.ts`, `case-state.ts`, `formatValue` — reads them as dates.
 *   - `refundAmount` arrives as a JSON number where Prisma gave a `Decimal`. It stays a number: its only
 *     reader is `formatValue`'s `number` branch, which stringifies either, and 12,2 fits a double
 *     exactly. Recorded as a difference rather than cast, per task 2 of the plan.
 *
 * NOT exported from the package index: the wire shape is the adapter's own business, per decision 1 of
 * `docs/plans/completed/02-dal-cutover-to-api.md`.
 */
import { z } from "zod";
import { validateGazetteRecipientEmail } from "./gazette-recipient-email.js";

/**
 * The option-set members, as api's spec declares them.
 *
 * Restated rather than imported because after task 5 there is nothing left to import them from: these
 * become the arrays `libs/deed-poll` builds its enums and label maps out of, in place of Prisma's
 * generated ones. `contract.test.ts` asserts every member against the spec, so a member added at either
 * end fails rather than going silently missing from a label map.
 */
export const DEED_POLL_TYPE = ["Adult", "AdultTransgender", "Minor", "MinorTransgender", "DeedOfRelinquishment", "Unknown"] as const;
export const DEED_POLL_STATE = [
  "Received",
  "ReadyForMaster",
  "ReferredToMaster",
  "Enroled",
  "Returned",
  "AwaitingFurtherDocs",
  "AwaitingSignature",
  "AwaitingEnrolment"
] as const;
export const MARITAL_STATUS = ["Single", "MarriedCivilPartnership", "Widowed", "DivorcedDissolved"] as const;
export const PRIVACY = ["Normal", "Private"] as const;
export const URGENCY = ["Normal", "Urgent"] as const;
export const POST_COUNTER = ["Counter", "Online", "Post", "Unknown"] as const;
export const NATIONALITY = ["BritishCitizen", "BritishDependantTerritoriesCitizen", "CommonwealthCitizen", "Unknown"] as const;
export const NATIONALITY_SECTION = ["Section1", "Section11", "Section37", "Section6", "Unknown", "NoneOfTheAbove"] as const;
export const MASTER_DECISION = ["Approved", "Rejected"] as const;
export const REFER_TO_MASTER = ["Yes", "No"] as const;
export const DOCUMENT_DIRECTION = ["Incoming", "Outgoing"] as const;

/**
 * A referral's lifecycle, as api's `ReferralState` declares it. `Closed` and `Withdrawn` are terminal, and a
 * case holds at most one referral that is not.
 */
export const REFERRAL_STATE = ["Open", "Claimed", "Decided", "Closed", "Withdrawn"] as const;

/**
 * Why a case is referred to the judiciary, as api's `ReferralReason` declares it.
 *
 * Published on `CreateReferralRequest`'s array items rather than on a property, so the drift test's enum
 * comparison — which reads `properties[x].enum` — does not reach them. A member added at api's end therefore
 * fails at the wire, not in the suite: check this array when refreshing the document.
 *
 * `Other` is the one member api pairs with a rule — it requires `notes` — and the rule is api's to enforce.
 */
// The `Minor*` members after `Other` are a minor's details (api#155, Master Sullivan's feedback, 2026-10-27): api
// accepts one only beside `Minor`, and `../../../deed-poll/src/referrals/referrals-view.ts` nests them under it.
export const REFERRAL_REASON = [
  "Minor",
  "DomesticAbuse",
  "NonPublication",
  "DeclarantRequirementsNotMet",
  "SeparatedOrEstranged",
  "Other",
  "MinorTransgender",
  "MinorParentalConsent",
  "MinorNoParentalConsent",
  "MinorStepparentConsent",
  "MinorNoStepparentConsent",
  "MinorCourtOrder",
  "MinorAged16Or17Consented",
  "MinorAged16Or17NotConsented"
] as const;

/**
 * What an applicant answered when asked whether they still want their deed enrolled, as api's
 * `ConfirmationOutcome` declares it.
 *
 * **Not a named schema in the document.** api publishes both member lists inline — on
 * `RecordConfirmationRequest.outcome` and on `ReferralResponse.confirmationOutcome` — so there is no
 * `ConfirmationOutcome` to register in `WIRE_SCHEMAS`, and the members are pinned by the enum comparison on
 * each of those two properties instead.
 *
 * `Withdrawn` is a referral outcome and not a case state: a withdrawn applicant's case is still `Returned`,
 * and nothing above this layer may read the member as terminal. It collides by name with
 * `REFERRAL_STATE`'s `Withdrawn`, which is a caseworker withdrawing the *referral* — a different fact about a
 * different thing, and both names are api's.
 */
export const CONFIRMATION_OUTCOME = ["Confirmed", "Withdrawn"] as const;

/**
 * The case-list filter keys, as api's own `LIST_FILTERS` table orders them.
 *
 * Lower case, unlike every vocabulary above: these are URL parameter values rather than stored option-set
 * members. api publishes them as the `filter` enum on both saved-query bodies, and `contract.test.ts`
 * asserts these members against it — so a tab api adds fails here rather than becoming a saved query this
 * app cannot round-trip.
 *
 * Preserve api's published order. `readyForPublication` belongs to the separate admin Gazette queue,
 * so this vocabulary is broader than the general case-list tabs.
 */
export const LIST_FILTER = ["all", "open", "received", "enroled", "returned", "awaitingConfirmation", "readyForPublication"] as const;

/**
 * What a caller may do beyond ordinary casework, as api's `Capability` declares it, in declaration order.
 *
 * Published on `CallerAccessResponse.capabilities`' array items, so the drift test's property enum comparison
 * does not reach it; `contract.test.ts` pins it against the items separately, order included.
 */
export const CAPABILITY = [
  "OVERRIDE_PRIVACY",
  "DELETE_NOTE",
  "DELETE_WITNESS",
  "MANAGE_SHARED_QUERIES",
  "REPAIR_CCD",
  "ACCESS_GAZETTE",
  "MANAGE_PROCESS_CONFIG"
] as const;

/** The two `sortDirection` tokens api matches exactly. A bare field with no direction means ascending. */
export const SORT_DIRECTION = ["asc", "desc"] as const;

/**
 * An api date-time, as a `Date`.
 *
 * api serialises `LocalDateTime` without a zone — `2026-03-10T00:00` — which `new Date()` reads as
 * LOCAL time, where the same value from Prisma was UTC. Every date column in this model is date-only in
 * meaning (Date Received, the signature dates, Date Enroled), and both `formatValue` and `daysBetween`
 * read them in UTC: taken as local, a midnight date west of Greenwich renders as the previous day and
 * "days received to enroled" comes out one short. So a zoneless value is pinned to UTC.
 *
 * A `Date` passes through unchanged, which is what lets a write schema and a read schema share a field
 * list: an outgoing patch already holds dates.
 */
const wireDateTime = z.union([z.date(), z.string().transform(toUtcDate)]).pipe(z.date());

/** ISO 8601 with no zone — a bare date or a zoneless date-time. Both are UTC in this model. */
const ZONELESS = /^\d{4}-\d{2}-\d{2}(T[\d:.]+)?$/;

function toUtcDate(text: string): Date {
  if (!ZONELESS.test(text)) return new Date(text);

  return new Date(text.includes("T") ? `${text}Z` : `${text}T00:00:00Z`);
}

/**
 * A case as api returns it from a read or a write.
 *
 * Every field is nullable except the four the entity declares as Java primitives, which cannot be null
 * at the source. That is deliberately more permissive than the spec: springdoc emits no nullability for
 * a response body, so `type: string` there means "a string when present" rather than "never null", and a
 * schema that took it literally would reject an ordinary half-logged case. `contract.test.ts` pins which
 * properties are strict, so the permissiveness is a listed decision rather than a blanket.
 *
 * `id` is required for a different reason: a case with no id is not a case any page can link to or patch,
 * so a response missing it is a contract failure worth surfacing as one.
 */
const savedCaseSchema = z.object({
  id: z.string(),
  referencenumber: z.int().nullish(),
  displayReference: z.string().nullish(),

  type: z.enum(DEED_POLL_TYPE).nullish(),
  state: z.enum(DEED_POLL_STATE).nullish(),
  privacy: z.enum(PRIVACY).nullish(),
  urgency: z.enum(URGENCY).nullish(),
  urgencyreason: z.string().nullish(),
  postCounter: z.enum(POST_COUNTER).nullish(),
  inPerson: z.boolean().nullish(),
  migratedRecord: z.boolean(),
  retainPermanently: z.boolean(),
  maritalStatus: z.enum(MARITAL_STATUS).nullish(),
  feeReference: z.string().nullish(),
  onlineApplicationReference: z.string().nullish(),

  newForename: z.string().nullish(),
  newMiddleName: z.string().nullish(),
  newSurname: z.string().nullish(),
  oldForename: z.string().nullish(),
  oldMiddleName: z.string().nullish(),
  oldSurname: z.string().nullish(),

  applicantBuildingNoName: z.string().nullish(),
  applicantEmail: z.string().nullish(),
  applicantTelephone: z.string().nullish(),
  applicantAddress1: z.string().nullish(),
  applicantAddress2: z.string().nullish(),
  applicantTownCity: z.string().nullish(),
  applicantPostcode: z.string().nullish(),

  representativeName: z.string().nullish(),
  representativeBuildingNoName: z.string().nullish(),
  representativeCompany: z.string().nullish(),
  representativeAddress1: z.string().nullish(),
  representativeEmail: z.string().nullish(),
  representativeAddress2: z.string().nullish(),
  representativeTelephone: z.string().nullish(),
  representativeTownCity: z.string().nullish(),
  representativePostcode: z.string().nullish(),

  ageOfMinor: z.int().nullish(),
  ageOfMinorMonths: z.int().nullish(),
  minorDateOfBirth: wireDateTime.nullish(),
  parents: z.string().nullish(),

  nationality: z.enum(NATIONALITY).nullish(),
  nationalitySection: z.enum(NATIONALITY_SECTION).nullish(),
  nationalitySectionOther: z.string().nullish(),

  iShall: z.array(z.int()),
  iHaveSubscribed: z.array(z.int()),
  andAlsoMyOld: z.array(z.int()),
  dateOfDeclaration: wireDateTime.nullish(),

  dateOfApplication: wireDateTime.nullish(),
  dateReceived: wireDateTime.nullish(),
  awaitingFurtherDocsInfo: wireDateTime.nullish(),
  signatureRequestedDate: wireDateTime.nullish(),
  signatureReceivedDate: wireDateTime.nullish(),
  dateReadyForMaster: wireDateTime.nullish(),
  dateReferred: wireDateTime.nullish(),
  dateEnroled: wireDateTime.nullish(),
  dateReturned: wireDateTime.nullish(),
  dateNoticeSentToLondonGazette: wireDateTime.nullish(),

  referToMasterChoice: z.enum(REFER_TO_MASTER).nullish(),
  masterName: z.string().nullish(),
  masterDirections: z.string().nullish(),
  masterDecision: z.enum(MASTER_DECISION).nullish(),
  masterDateOfDecision: wireDateTime.nullish(),
  dateDecisionDirectionsReceived: wireDateTime.nullish(),
  referralNotes: z.string().nullish(),
  publishToLondonGazette: z.boolean(),

  // The state of the case's one referral that is not terminal, or null when it has none — api's own
  // denormalisation, never recomputed from the referrals here. Null is the ordinary value: most cases have
  // never been referred, and a case whose referral closed has none live either.
  currentReferralState: z.enum(REFERRAL_STATE).nullish(),

  // When the applicant was asked whether they still want their deed enrolled and has not yet answered, or
  // null. api's denormalisation, recomputed in the transaction that records the answer, and the only thing
  // that says a case is waiting: there is no ninth case state and `state` still reads `Returned`. Never
  // derived here from a referral or from correspondence history.
  awaitingConfirmationSince: wireDateTime.nullish(),

  returnReason: z.string().nullish(),
  refundAmount: z.number().nullish(),
  dateOfRefund: wireDateTime.nullish(),
  refundReference: z.string().nullish(),

  createdOn: wireDateTime.nullish(),
  modifiedOn: wireDateTime.nullish(),
  createdBy: z.string().nullish(),
  modifiedBy: z.string().nullish(),

  daysReceivedToEnroled: z.int().nullish(),
  daysReceivedToReturned: z.int().nullish()
});

const noteSchema = z.object({
  id: z.string(),
  note: z.string(),
  createdBy: z.string().nullish(),
  modifiedBy: z.string().nullish(),
  createdOn: wireDateTime.nullish(),
  modifiedOn: wireDateTime.nullish()
});

const witnessSchema = z.object({
  id: z.string(),
  witnessName: z.string().nullish(),
  witnessAddress: z.string().nullish(),
  witnessOccupation: z.string().nullish(),
  declarant: z.boolean(),
  createdOn: wireDateTime.nullish(),
  modifiedOn: wireDateTime.nullish()
});

const documentTypeSchema = z.object({
  id: z.string(),
  name: z.string().nullish(),
  applicableMaritalStatuses: z.array(z.int()),
  applicableTypes: z.array(z.int())
});

/**
 * A document's metadata.
 *
 * `hasFile` is api's answer to the question `storageKey` answered locally — whether there is a blob to
 * fetch. The key itself is deliberately not published: where api stores a file is not this app's
 * business, and the subgrid only ever asked whether the row was downloadable.
 */
const documentSchema = z.object({
  id: z.string(),
  name: z.string().nullish(),
  documentType: documentTypeSchema.nullish(),
  direction: z.enum(DOCUMENT_DIRECTION).nullish(),
  originalName: z.string().nullish(),
  mimeType: z.string().nullish(),
  sizeBytes: z.int().nullish(),
  hasFile: z.boolean(),
  createdOn: wireDateTime.nullish(),
  modifiedOn: wireDateTime.nullish()
});

/**
 * One referral of a case to the judiciary, as the caseworker surface publishes it.
 *
 * Every column of api's `deedpoll_referral` except the case foreign key and `lastTouchedAt` — the first
 * because the caller named the case in the path, the second because it is the inactivity sweep's
 * bookkeeping rather than a fact about the referral.
 *
 * `reasons` is the stored strings and not `REFERRAL_REASON` members: the column is a JSON array api
 * validates on write, so a backfilled or hand-corrected row is published as it stands. It is **empty for a
 * migrated referral** — the source store had no such field — which is what `migrated` explains, and never
 * null, because api builds it with `List.copyOf`.
 *
 * `changesToStandardPublication` is nullable where `migrated` is not: api boxes it deliberately, because a referral
 * with no direction has not been asked the question and absent is not false. It is the Master's answer to "Are there
 * any changes to the standard publications in the Gazette?" — true for do not publish, or publish only as
 * `directionsText` says.
 *
 * The four `confirmation*` fields are the applicant's answer to the *Request confirmation to proceed* email and
 * api's record of who transcribed it. All four are nullable and they move in pairs rather than independently:
 * `confirmationRequestedAt` alone is a referral still waiting, and the other three arrive together when the
 * answer is recorded. **`confirmationReceivedAt` is when the caseworker recorded the reply and never when the
 * applicant sent it** — api stamps it from its own clock — so nothing above here may present it as the date of
 * the reply.
 */
const referralSchema = z.object({
  id: z.string(),
  state: z.enum(REFERRAL_STATE).nullish(),
  reasons: z.array(z.string()),
  notes: z.string().nullish(),
  urgency: z.enum(URGENCY).nullish(),
  urgencyReason: z.string().nullish(),
  migrated: z.boolean(),
  claimedBy: z.string().nullish(),
  claimedAt: wireDateTime.nullish(),
  decision: z.enum(MASTER_DECISION).nullish(),
  directionsText: z.string().nullish(),
  changesToStandardPublication: z.boolean().nullish(),
  decisionDate: wireDateTime.nullish(),
  decidedBy: z.string().nullish(),
  // Set when the judge changes or withdraws their direction, and never cleared: the caseworker's cue that the
  // direction they may already have acted on is not the one first given.
  directionChangedAt: wireDateTime.nullish(),
  confirmationRequestedAt: wireDateTime.nullish(),
  confirmationOutcome: z.enum(CONFIRMATION_OUTCOME).nullish(),
  confirmationReceivedAt: wireDateTime.nullish(),
  confirmationRecordedBy: z.string().nullish(),
  createdBy: z.string().nullish(),
  modifiedBy: z.string().nullish(),
  createdOn: wireDateTime.nullish(),
  modifiedOn: wireDateTime.nullish()
});

/**
 * One case with its children, as `GET /caseworker/cases/{id}` returns it.
 *
 * Built by extending the saved-case shape rather than restating 76 fields, so the two cannot drift.
 */
const caseDetailSchema = savedCaseSchema.extend({
  notes: z.array(noteSchema),
  witnesses: z.array(witnessSchema),
  documents: z.array(documentSchema)
});

const caseSummarySchema = z.object({
  id: z.string(),
  displayReference: z.string().nullish(),
  privacy: z.enum(PRIVACY).nullish(),
  dateReceived: wireDateTime.nullish(),
  type: z.enum(DEED_POLL_TYPE).nullish(),
  state: z.enum(DEED_POLL_STATE).nullish(),
  newForename: z.string().nullish(),
  // On a list row so a search matching on surname can show the surname it matched — otherwise a `q` of
  // "Smith" answers with a table of forenames. Nullish because api publishes it as a plain string with no
  // `required` entry: a case that has not been given a new surname has none.
  newSurname: z.string().nullish(),
  // On the summary as well as the detail so a worklist can show which rows are with the judiciary without a
  // read per row. Same value and same rule as `savedCaseSchema`'s.
  currentReferralState: z.enum(REFERRAL_STATE).nullish(),
  // How long the applicant has been asked to confirm, counted by api and rendered rather than recalculated —
  // `int32`, so it is whole days. Published on EVERY row and null for a case waiting for nothing, which is
  // nearly all of them; `0` on the day the email was sent, never 1. The `awaitingConfirmation` tab is the only
  // one that shows it, which is a choice about which table needs a workflow column and not about where the
  // value exists.
  daysAwaitingConfirmation: z.int().nullish()
});

/**
 * One page of the list, plus the filter api resolved — which may not be the one that was asked for.
 *
 * The four counts are api's, not this app's: `total` is a count across every page, so a caller must never
 * infer it from `cases.length`. `size` is the page size api APPLIED rather than the one requested — it
 * caps a `size` above 100 instead of refusing it — and `totalPages` is zero for a result set with nothing
 * in it, so "page 1 of 0" is what an empty list says.
 */
const caseListSchema = z.object({
  filter: z.string(),
  cases: z.array(caseSummarySchema),
  page: z.number(),
  size: z.number(),
  total: z.number(),
  totalPages: z.number(),
  // The id of the case whose reference the `q` term matched exactly, or null — api states the fact and the UI
  // decides whether to redirect. Null for no match AND for several, because a serial repeats across years, so
  // there is then no single case to go to. Null too when no `q` was sent at all.
  referenceMatch: z.string().nullish()
});

const fieldRuleSchema = z.object({
  visible: z.boolean(),
  required: z.boolean()
});

const fieldRulesSchema = z.object({
  rules: z.record(z.string(), fieldRuleSchema)
});

/**
 * A case write, create and patch alike.
 *
 * One schema for both because api's two request bodies have identical properties — the difference is
 * what its domain does with them, not what it accepts. Every field is optional: a case is logged
 * incrementally, and a patch mentioning one field must not read as clearing the rest. A field present
 * and null clears the column, which is why these are `nullish` rather than merely `optional`.
 *
 * `referencenumber`, `displayReference` and the audit columns are absent because api does not accept
 * them. Reference numbers in particular are api's to allocate now — see task 3 of the plan.
 */
const caseWriteSchema = z.object({
  type: z.enum(DEED_POLL_TYPE).nullish(),
  state: z.enum(DEED_POLL_STATE).nullish(),
  privacy: z.enum(PRIVACY).optional(),
  urgency: z.enum(URGENCY).optional(),
  urgencyreason: z.string().nullish(),
  postCounter: z.enum(POST_COUNTER).nullish(),
  inPerson: z.boolean().nullish(),
  migratedRecord: z.boolean().optional(),
  retainPermanently: z.boolean().optional(),
  maritalStatus: z.enum(MARITAL_STATUS).nullish(),
  feeReference: z.string().nullish(),
  onlineApplicationReference: z.string().nullish(),

  newForename: z.string().max(1000).nullish(),
  newMiddleName: z.string().max(1000).nullish(),
  newSurname: z.string().max(1000).nullish(),
  oldForename: z.string().max(1000).nullish(),
  oldMiddleName: z.string().max(1000).nullish(),
  oldSurname: z.string().max(1000).nullish(),

  applicantBuildingNoName: z.string().nullish(),
  applicantEmail: z.string().nullish(),
  applicantTelephone: z.string().nullish(),
  applicantAddress1: z.string().nullish(),
  applicantAddress2: z.string().nullish(),
  applicantTownCity: z.string().nullish(),
  applicantPostcode: z.string().nullish(),

  representativeName: z.string().nullish(),
  representativeBuildingNoName: z.string().nullish(),
  representativeCompany: z.string().nullish(),
  representativeAddress1: z.string().nullish(),
  representativeEmail: z.string().nullish(),
  representativeAddress2: z.string().nullish(),
  representativeTelephone: z.string().nullish(),
  representativeTownCity: z.string().nullish(),
  representativePostcode: z.string().nullish(),

  ageOfMinor: z.int().nullish(),
  ageOfMinorMonths: z.int().nullish(),
  minorDateOfBirth: wireDateTime.nullish(),
  parents: z.string().nullish(),

  nationality: z.enum(NATIONALITY).nullish(),
  nationalitySection: z.enum(NATIONALITY_SECTION).nullish(),
  nationalitySectionOther: z.string().nullish(),

  iShall: z.array(z.int()).optional(),
  iHaveSubscribed: z.array(z.int()).optional(),
  andAlsoMyOld: z.array(z.int()).optional(),
  dateOfDeclaration: wireDateTime.nullish(),

  dateOfApplication: wireDateTime.nullish(),
  dateReceived: wireDateTime.nullish(),
  awaitingFurtherDocsInfo: wireDateTime.nullish(),
  signatureRequestedDate: wireDateTime.nullish(),
  signatureReceivedDate: wireDateTime.nullish(),
  dateReadyForMaster: wireDateTime.nullish(),
  dateReferred: wireDateTime.nullish(),
  dateEnroled: wireDateTime.nullish(),
  dateReturned: wireDateTime.nullish(),
  dateNoticeSentToLondonGazette: wireDateTime.nullish(),

  referToMasterChoice: z.enum(REFER_TO_MASTER).nullish(),
  masterName: z.string().nullish(),
  masterDirections: z.string().nullish(),
  masterDecision: z.enum(MASTER_DECISION).nullish(),
  masterDateOfDecision: wireDateTime.nullish(),
  dateDecisionDirectionsReceived: wireDateTime.nullish(),
  referralNotes: z.string().nullish(),
  publishToLondonGazette: z.boolean().optional(),

  returnReason: z.string().nullish(),
  refundAmount: z.number().nullish(),
  dateOfRefund: wireDateTime.nullish(),
  refundReference: z.string().nullish()
});

const createNoteSchema = z.object({
  note: z.string().min(1).max(2000)
});

/** An empty patch is legitimate — api accepts it and re-stamps `modifiedBy`. */
const updateNoteSchema = z.object({
  note: z.string().min(1).max(2000).optional()
});

/**
 * A witness write.
 *
 * All four fields required, and the caps are the source columns' — 100 / 250 / 100, as api's
 * `WitnessSchemas` declares them and the spec publishes them. No minimum length and no trim, both
 * deliberately: api accepts `""` and stores what it was given, so a schema tightening either here would
 * refuse a body api accepts and the two ends would disagree about what a witness is.
 *
 * `declarant` is a boolean and not a coerced string, which is api's own emphasis — `"false"` is truthy in
 * JavaScript, so a declarant coerced from a string can silently become an ordinary witness.
 */
const createWitnessSchema = z.object({
  witnessName: z.string().max(100),
  witnessAddress: z.string().max(250),
  witnessOccupation: z.string().max(100),
  declarant: z.boolean()
});

/** `createWitnessSchema.partial()`, as api's patch body is: an omitted field is left as stored. */
const updateWitnessSchema = createWitnessSchema.partial();

/**
 * Raise a referral. `reasons` is the only field required outright, and the two conditional requirements are
 * api's: `notes` when `Other` is among the reasons, `urgencyReason` when `urgency` is `Urgent`.
 *
 * Neither conditional rule is repeated here, and the page's own form validation is where a caseworker gets a
 * message against the field — a schema that refused the pair would be a second authority on a rule api
 * already enforces, and `deed-poll-validation.ts` is where this repo's copies of api's rules live.
 *
 * No `state`, no `migrated` and no assignee: the state of a new referral is always `Open`, there is no target
 * judge — who picks a referral up is a later transition — and api ignores all three rather than refusing them.
 */
const createReferralSchema = z.object({
  reasons: z.array(z.enum(REFERRAL_REASON)).min(1),
  notes: z.string().max(1000).optional(),
  urgency: z.enum(URGENCY).optional(),
  urgencyReason: z.string().max(500).optional()
});

/**
 * The applicant's answer to *Request confirmation to proceed*, as the caseworker who read the reply records it.
 *
 * `outcome` is the only required property and the only fact: `note` is the evidence for it, optional, and capped
 * at api's published 1,000 — enforced here so a 1,001st character is a message against the field rather than a
 * 400 a caseworker cannot act on. api trims it and treats a whitespace-only value as none, so neither is done
 * here; a schema that trimmed would be a second opinion about what was stored.
 *
 * **No `confirmationRecordedBy` and no `confirmationReceivedAt`.** api takes the recorder from the token and the
 * date from its own clock, and — like every write body but the two email ones — this one is published
 * `additionalProperties: true`, so either one sent from here would be **ignored rather than refused**. Their
 * absence is therefore pinned by `contract.test.ts` and nothing else would catch them.
 *
 * Recording is idempotent by refusal: a second answer and an answer on a referral that was never asked are both
 * 409s. Neither is a rule this schema can express or should try to.
 */
const recordConfirmationSchema = z.object({
  outcome: z.enum(CONFIRMATION_OUTCOME),
  note: z.string().max(1000).optional()
});

/**
 * A saved case-list query, as api returns one.
 *
 * `conditions` is the array of `where` wire strings the list URL carried — `"state:in:Enroled,Received"` —
 * and not structured objects, which is what lets a saved query round-trip a list URL unchanged. It arrives
 * as an array rather than null even for a query that narrows nothing.
 *
 * `selected` and `editable` are the two flags this app renders behaviour from, and both are api's to state:
 * `selected` is whether the caller has it in their own list, `editable` whether they may amend or delete it
 * — the owner, or an Administrator if it is shared. Both are Java primitives at source, so neither is
 * nullish. **Never recompute `editable` here**: api derives it from the same predicate its write paths
 * refuse on, so a local opinion would be a second authority on somebody else's rule.
 *
 * `page` is deliberately absent: api does not store it, because page 4 of a previous result set is not a
 * page of this one.
 */
const savedQuerySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullish(),
  shared: z.boolean(),
  ownerId: z.string().nullish(),
  ownerName: z.string().nullish(),
  filter: z.string().nullish(),
  conditions: z.array(z.string()),
  sortField: z.string().nullish(),
  sortDirection: z.string().nullish(),
  searchTerm: z.string().nullish(),
  selected: z.boolean(),
  editable: z.boolean(),
  createdBy: z.string().nullish(),
  modifiedBy: z.string().nullish(),
  createdOn: wireDateTime.nullish(),
  modifiedOn: wireDateTime.nullish()
});

/**
 * The body of `POST /caseworker/saved-queries`. Only `name` is required — a query that narrows nothing is
 * legitimate, because "everything, newest first" is a view somebody wants a tab for.
 *
 * The bounds are api's, from its published document. `ownerId` is deliberately absent: api takes the owner
 * from the token, so a body cannot claim a query for somebody else.
 */
const createSavedQuerySchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  shared: z.boolean().optional(),
  filter: z.enum(LIST_FILTER).optional(),
  conditions: z.array(z.string()).max(20).optional(),
  sortField: z.string().optional(),
  sortDirection: z.enum(SORT_DIRECTION).optional(),
  searchTerm: z.string().max(100).optional()
});

/**
 * The patch body. Not `createSavedQuerySchema.partial()`, unlike the witness patch: api's nullable columns
 * accept an explicit null to *clear* them, where the witness and note patches answer 400 for a null because
 * no column of theirs is nullable. `name` is the exception — it cannot be cleared.
 */
const updateSavedQuerySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullish(),
  shared: z.boolean().optional(),
  filter: z.enum(LIST_FILTER).nullish(),
  conditions: z.array(z.string()).max(20).optional(),
  sortField: z.string().nullish(),
  sortDirection: z.enum(SORT_DIRECTION).nullish(),
  searchTerm: z.string().max(100).nullish()
});

/**
 * One supporting document a judge may open. api lists only documents with a readable file, so there is no
 * `hasFile`: every row is downloadable through `GET /judicial/referrals/{referralId}/documents/{id}/file`.
 *
 * `documentType` is the type's name, flattened, where the caseworker document nests the whole type record —
 * the judicial surface has no use for its applicability lists. `id` is strict for `documentSchema`'s reason: a
 * row with no id is not one a page can link to.
 */
const judicialDocumentSchema = z.object({
  id: z.string(),
  name: z.string().nullish(),
  documentType: z.string().nullish(),
  direction: z.enum(DOCUMENT_DIRECTION).nullish(),
  mimeType: z.string().nullish(),
  sizeBytes: z.int().nullish(),
  uploadedOn: wireDateTime.nullish()
});

/**
 * The application behind a referral, as api's `/judicial/**` surface publishes it to a Master: the reference, the
 * new and old names, the type, the nationality and section, a minor's parents and the readable documents (narrowed
 * in api on 2026-10-27, Master Sullivan's feedback), and deliberately not a case.
 *
 * **Never modelled as a subset of the case schemas**, which is api's own rule — its
 * `NamespaceSeparationSecurityTest` asserts the two records are unrelated in bytecode, because the failure it
 * guards against is a field added to the caseworker response for a caseworker reason silently appearing here.
 * A separate schema means the same is true of this adapter: widening the judicial view is an edit to this
 * object, not a side effect of one to `savedCaseSchema`.
 *
 * There is no case id, and that is api's decision 2 rather than an omission: the judicial surface is keyed on
 * the referral so a Master cannot name an application. `displayReference` is what a direction quotes and is not
 * an id api accepts anywhere. `parents` is null on any application that is not a minor's.
 */
const judicialApplicationViewSchema = z.object({
  displayReference: z.string().nullish(),

  newForename: z.string().nullish(),
  newMiddleName: z.string().nullish(),
  newSurname: z.string().nullish(),
  oldForename: z.string().nullish(),
  oldMiddleName: z.string().nullish(),
  oldSurname: z.string().nullish(),

  type: z.enum(DEED_POLL_TYPE).nullish(),

  nationality: z.enum(NATIONALITY).nullish(),
  nationalitySection: z.enum(NATIONALITY_SECTION).nullish(),
  nationalitySectionOther: z.string().nullish(),

  parents: z.string().nullish(),

  documents: z.array(judicialDocumentSchema)
});

/**
 * One row of the shared judicial pool: enough to choose which referral to pick up, and nothing about the
 * application behind it.
 *
 * No case fields at all, which is the difference between this and a case list row — a pool row carrying the
 * applicant's names would make the pool a list of applications a judge has not been asked to see. Reaching the
 * application is the detail read, which runs api's visibility check.
 *
 * `createdOn` rather than an age in days, for the reason the case list publishes raw dates: it is the pool's
 * second sort key, and a computed age cannot be sorted or re-rendered tomorrow.
 */
const judicialReferralSummarySchema = z.object({
  id: z.string(),
  state: z.enum(REFERRAL_STATE).nullish(),
  reasons: z.array(z.string()),
  notes: z.string().nullish(),
  urgency: z.enum(URGENCY).nullish(),
  urgencyReason: z.string().nullish(),
  createdOn: wireDateTime.nullish()
});

/**
 * One referral as the Master who may see it reads it: the referral and the narrow application view — one response
 * for what is one screen. No case notes since 2026-10-27.
 *
 * Built by extending the pool row rather than restating its seven fields, as `caseDetailSchema` extends the
 * saved case, so the two cannot drift.
 *
 * `notes` is the referral's free text for the Master, api's name for it; it is not the application's case notes,
 * which a Master is not sent.
 *
 * `claimedBy` and `decidedBy` can only ever name this caller or nobody — api's visibility admits an `Open`
 * referral, which has no holder, or a `Claimed`/`Decided` one only when the caller is the judge on it. So a
 * page rendering them cannot disclose who else holds anything.
 */
const judicialReferralDetailSchema = judicialReferralSummarySchema.extend({
  claimedBy: z.string().nullish(),
  claimedAt: wireDateTime.nullish(),
  decision: z.enum(MASTER_DECISION).nullish(),
  directionsText: z.string().nullish(),
  changesToStandardPublication: z.boolean().nullish(),
  decisionDate: wireDateTime.nullish(),
  decidedBy: z.string().nullish(),
  // When the judge last changed or withdrew their direction; null while it stands as first given. Never
  // cleared, because it is a fact about the referral's history.
  directionChangedAt: wireDateTime.nullish(),
  application: judicialApplicationViewSchema.nullish()
});

/**
 * One page of the shared pool, and how much work is waiting behind it.
 *
 * `total` is what the envelope exists for: a judge is shown ten referrals by default, and ten is a page size
 * rather than a cap, so a bare array would be indistinguishable from "there are ten". `size` is the page size
 * api APPLIED — it clamps an over-cap value rather than refusing it — so a caller that asked for a thousand
 * rows and got a hundred can tell, instead of reading a full page as the whole pool and stopping.
 */
const judicialPoolSchema = z.object({
  referrals: z.array(judicialReferralSummarySchema),
  page: z.number(),
  size: z.number(),
  total: z.number(),
  totalPages: z.number()
});

/**
 * One page of the referrals one judge has in hand, and how much work that is in total.
 *
 * **The same five properties as the pool's envelope and the same row type, and still its own schema** — api
 * publishes `JudicialMyReferralsResponse` beside `JudicialPoolResponse` rather than reusing it, because the two
 * name opposite collections: the pool is the shared unclaimed work every judge sees identically, and this is one
 * judge's own and nobody else's. Registering it as an alias of `judicialPoolSchema` would make the contract test
 * pass while leaving a reader unable to tell which call produced a value. What it does reuse is the ROW —
 * `JudicialMyReferralsResponse.referrals` `$ref`s `JudicialReferralSummary`, so the personal list cannot carry a
 * field the pool does not (`referrals-admin-6` decision 3).
 *
 * **No owner id, and its absence is a checked property of api's contract rather than an omission here.** api keys
 * ownership on the token's IDAM subject (`claimedById`/`decidedById`, added by its `V14__referral_owner_subjects`
 * migration) and publishes neither column in any DTO: whose list this is comes from the token, so there is nothing
 * on the wire to forge and nothing here to send. `contract.test.ts` fails if either name ever appears.
 */
const judicialMyReferralsSchema = z.object({
  referrals: z.array(judicialReferralSummarySchema),
  page: z.number(),
  size: z.number(),
  total: z.number(),
  totalPages: z.number()
});

/**
 * The holding judge's direction on a referral, recorded once and complete — api has no draft and no patch.
 *
 * `changesToStandardPublication` is a required JSON boolean and not a coerced string, which is api's own emphasis:
 * `"false"` is truthy in JavaScript, and publication cannot be taken back. Never derived from a
 * `NonPublication` referral reason — the caseworker's reason for referring is not the judge's decision.
 *
 * `directionsText` is optional on a standard publication, because an approval that needs no comment is a real
 * answer, and **required when there are changes** — api answers 400 on it otherwise. The state, the
 * decider and the decision date come from the transition, the token and api's clock, so none of them is here.
 */
const judicialDirectionSchema = z.object({
  decision: z.enum(MASTER_DECISION),
  changesToStandardPublication: z.boolean(),
  directionsText: z.string().max(4000).optional()
});

/**
 * The outbox state of one email, as api's `NotificationState` declares it.
 *
 * **`Sent` means GOV.UK Notify accepted it, not that it arrived** — api's own schema description says so, and
 * nothing in this estate can say more: delivery status needs Notify callbacks that do not exist yet, and there
 * is no download or open concept in the Notify client at all. So no label built from these members may read as
 * proof of receipt, and `failureReason` is what makes a `Failed` row actionable.
 */
export const NOTIFY_STATE = ["Pending", "Sent", "Failed"] as const;

/**
 * One field of an email a caseworker fills in, and how long it may be.
 *
 * **`name` is `snake_case` and must stay that way.** It is a GOV.UK Notify placeholder name, which is the
 * personalisation key and the request-body key at once — api's `EmailSlot` says it "is not renamed to Java style
 * anywhere". This module's rule is that the wire is camelCase and nothing is renamed at the boundary; these
 * keys are the documented exception, and renaming one anywhere above here makes Notify substitute nothing and
 * send the template with empty slots, with every test still green.
 */
const emailSlotSchema = z.object({
  name: z.string().nullish(),
  maxLength: z.int(),
  required: z.boolean()
});

/**
 * One email type a caseworker could send about a case, applicable or not.
 *
 * api publishes every type rather than only the sendable ones, so `reason` is the sentence that answers "why
 * can I not send the refusal letter" before it is asked. `provisioned` is separate and narrower: whether this
 * environment has a real Notify template behind the key, which is false everywhere until notify-0 runs.
 *
 * **`template` is a bare string, not an enum.** api publishes no member list for it, so `contract.test.ts`
 * cannot pin the set and a template api adds later arrives here with nothing failing — which is the intent:
 * the tab lists what api says is sendable. Nothing above this may model it as a closed union that throws on an
 * unrecognised value.
 */
const emailTypeSchema = z.object({
  template: z.string().nullish(),
  applicable: z.boolean(),
  reason: z.string().nullish(),
  provisioned: z.boolean(),
  slots: z.array(emailSlotSchema)
});

/**
 * The starting values api resolved for one applicable template's slots.
 *
 * `fields` is keyed by the same `snake_case` placeholder names `emailSlotSchema.name` carries, which is why it
 * is a `record` rather than a named shape: the keys are the template's, and a template api adds brings its own.
 * Published so the compose page can pre-populate without calling preview, which costs a Notify call.
 */
const emailSlotDefaultsSchema = z.object({
  template: z.string().nullish(),
  fields: z.record(z.string(), z.string())
});

/** A case document carried by an email — enough to name it, and no storage key, as `documentSchema` is. */
const correspondenceDocumentSchema = z.object({
  id: z.string(),
  name: z.string().nullish()
});

/**
 * One email attempt recorded against a case.
 *
 * **`body` is PLAIN TEXT and not HTML**, which api's own description spells out — the applicant received
 * Notify's branded HTML and this is the text rendering of the same template with the same values. It is
 * therefore rendered through Nunjucks autoescaping, and must never reach the `srcdoc` iframe the preview uses:
 * see `docs/plans/notify-2-caseworker-email-tab.md` decision 12.
 *
 * `subject` and `body` are null until Notify accepts a send, and stay null forever for anything sent before api
 * began capturing them. `documents` is `List.copyOf` at the source, so it is `[]` rather than null — and empty
 * for every email today, because the one shipped template carries no attachments.
 */
const emailHistorySchema = z.object({
  id: z.string(),
  template: z.string().nullish(),
  templateName: z.string().nullish(),
  subject: z.string().nullish(),
  body: z.string().nullish(),
  recipient: z.string().nullish(),
  notifyState: z.enum(NOTIFY_STATE).nullish(),
  failureReason: z.string().nullish(),
  createdBy: z.string().nullish(),
  createdOn: wireDateTime.nullish(),
  documents: z.array(correspondenceDocumentSchema)
});

/**
 * Everything the Email tab needs, from one request.
 *
 * All three arrays in one response is api's answer to this repo's performance rule, and it is load-bearing for
 * more than the tab: the per-email page reads its content from this same payload rather than making a call of
 * its own. Each is built with `stream().toList()` at the source, so an empty one arrives as `[]`.
 */
const caseEmailsSchema = z.object({
  availability: z.array(emailTypeSchema),
  history: z.array(emailHistorySchema),
  slotDefaults: z.array(emailSlotDefaultsSchema)
});

/**
 * The email as Notify renders it, for the caseworker to read before sending.
 *
 * `html` is Notify's own HTML and carries text a caseworker typed, so it is shown in a sandboxed `iframe` with
 * `srcdoc` and never interpolated into the page — decision 3 of the plan, and the reason there is no `| safe`
 * anywhere near it.
 *
 * **Nullable rather than strict, deliberately, though api cannot currently send null.** `EmailPreview.from`
 * reads the client's two `Optional`s with `orElse("")`, so an absent rendering arrives as an **empty string**
 * — which means a caller checking only for null would render an empty iframe and offer a Send. The permissive
 * schema is the safe polarity here: a preview that cannot be shown must become a sentence on the page, not an
 * `invalid-response` that takes the whole journey to the 500 page.
 */
const emailPreviewSchema = z.object({
  subject: z.string().nullish(),
  html: z.string().nullish(),
  templateVersion: z.int()
});

/**
 * What a send returns: the outbox row that now owes the email, not its delivery.
 *
 * **`enqueued` is false when the send was redundant and the request still succeeded**, and since api's notify-6
 * there are *two* unique indexes that can say so: `("deedPollId", "requestId")` — the compose journey's
 * `Idempotency-Key`, which is what makes a double-click or a retried POST one email — and the older
 * one-email-per-referral index, which answers the same way for the same email reached from a *second* journey.
 * Either way a second attempt writes nothing and answers with the first row's id. api's own note is that telling
 * the caseworker their email failed would invite a third attempt.
 *
 * A reused key with *different* content is the one case that is not this: api cannot tell which send the caller
 * meant, so it is a 409 rather than a receipt.
 *
 * No state field, on purpose: api drains the outbox immediately after the enqueue commits, so any state here
 * would have been read before that and could say `Pending` for an email Notify has already accepted.
 */
const sentEmailSchema = z.object({
  id: z.string(),
  recipient: z.string().nullish(),
  enqueued: z.boolean()
});

/**
 * The slots a caseworker fills, and the whole of what this app may set on an email.
 *
 * One schema for the preview body and the send body, as `caseWriteSchema` serves both case writes: api's two
 * bodies have identical properties, and `contract.test.ts` compares each spec name against it separately, so
 * the day they diverge one of the two comparisons fails.
 *
 * **These are the only two contract bodies with `additionalProperties: false`, so an unknown key is a 400 that
 * names it** — not an ignored field. Nothing else may be added here: every other value in the email (the
 * reference number, the former names, which refund paragraph renders) is api's to resolve from the case. **The
 * compose journey's idempotency UUID is a header and never a key here** — `Idempotency-Key`, required of the
 * send since api's notify-6 — and `additionalProperties: false` is what makes putting it in the body a 400
 * that names it rather than a silently ignored field.
 *
 * **These are every slot any template takes, which is not the set any one template takes.** Which slots a given
 * template accepts, what they open with and which of them are required arrive from
 * `GET /caseworker/cases/{id}/emails`, so all three are optional here and api refuses a slot belonging to
 * another template by name. `judges_reason` is pre-populated from the referral's direction when omitted;
 * `documents_required` is pre-populated from nothing, so ⑤ with an empty body is api's 400. Neither
 * conditional mandatoriness is expressible in one schema serving both bodies and every template, and
 * attempting it here would refuse a body api accepts.
 *
 * The caps are api's published ones — the referral direction and notes caps, so a direction a judge could
 * record is always sendable unedited — and are enforced here so a caseworker gets a message against the field
 * rather than a round trip.
 */
const emailSlotsWriteSchema = z.object({
  judges_reason: z.string().max(4000).optional(),
  documents_required: z.string().max(4000).optional(),
  additional_notes: z.string().max(1000).optional()
});

/** Frozen audit previews: the count is the whole batch, not the bounded references array.
 * Java primitives and collections are required; reference-valued attribution follows the nullable wire convention.
 * Preview and page-size caps belong to API; increasing them must not make a readable response invalid.
 */
const gazetteSettingsSchema = z.object({
  recipientEmail: z.string().nullish(),
  revision: z.number().int().nonnegative(),
  updatedAt: wireDateTime.nullish(),
  updatedBy: z.string().nullish()
});

export { GAZETTE_RECIPIENT_EMAIL_PATTERN } from "./gazette-recipient-email.js";

const updateGazetteSettingsSchema = z
  .object({
    recipientEmail: z
      .string()
      .trim()
      .max(254)
      .superRefine(validateGazetteRecipientEmail)
      .refine((value) => value.indexOf("@") <= 64),
    revision: z.number().int().nonnegative()
  })
  .strict();

/**
 * The process settings api accepts: the processing window in whole minutes (1 to 30 days), the reminder interval in
 * hours and the cap per Master per referral window. `contract.test.ts` pins every bound to
 * `UpdateProcessSettingsRequest` in `openapi.json`, so the settings form can refuse early without restating them.
 */
export const PROCESS_SETTINGS_LIMITS = {
  minProcessingMinutes: 1440,
  maxProcessingMinutes: 43200,
  minReminderHours: 1,
  maxReminderHours: 168,
  minMasterWindowCap: 1,
  maxMasterWindowCap: 100
} as const;

/** A referral window time, Europe/London, `HH:mm` on the quarter hour. Pinned to the spec's pattern. */
export const WINDOW_TIME_PATTERN = "^([01][0-9]|2[0-3]):(00|15|30|45)$";

/**
 * The Delivery Manager's process settings. The ints are Java primitives on api's record, so none arrives null; the
 * window times are strings and nullable by this file's convention. The response's bounds are not restated: a read
 * must not fail because api widened what it stores.
 */
const processSettingsSchema = z.object({
  referralClaimExpiryMinutes: z.number().int(),
  reminderIntervalHours: z.number().int(),
  masterWindowCap: z.number().int(),
  morningWindowStart: z.string().nullish(),
  morningWindowEnd: z.string().nullish(),
  afternoonWindowStart: z.string().nullish(),
  afternoonWindowEnd: z.string().nullish(),
  revision: z.number().int().nonnegative(),
  updatedAt: wireDateTime.nullish(),
  updatedBy: z.string().nullish()
});

const windowTime = z.string().regex(new RegExp(WINDOW_TIME_PATTERN));

/**
 * Only the processing window and the revision are required, for one release: an absent setting keeps api's stored
 * value and an explicit null is refused, so the optional fields are `optional()` and never `nullish()`. The ordering
 * rule (each window starts before it ends, the morning one ending before the afternoon one starts) is api's to apply
 * to the merged row, so it is not restated here.
 */
const updateProcessSettingsSchema = z
  .object({
    referralClaimExpiryMinutes: z.number().int().min(PROCESS_SETTINGS_LIMITS.minProcessingMinutes).max(PROCESS_SETTINGS_LIMITS.maxProcessingMinutes),
    reminderIntervalHours: z.number().int().min(PROCESS_SETTINGS_LIMITS.minReminderHours).max(PROCESS_SETTINGS_LIMITS.maxReminderHours).optional(),
    masterWindowCap: z.number().int().min(PROCESS_SETTINGS_LIMITS.minMasterWindowCap).max(PROCESS_SETTINGS_LIMITS.maxMasterWindowCap).optional(),
    morningWindowStart: windowTime.optional(),
    morningWindowEnd: windowTime.optional(),
    afternoonWindowStart: windowTime.optional(),
    afternoonWindowEnd: windowTime.optional(),
    revision: z.number().int().nonnegative()
  })
  .strict();

/** The Masters list's bounds, pinned to `CreateMasterRequest` and `UpdateMasterRequest` by `contract.test.ts`. */
export const MASTER_LIMITS = { maxNameLength: 200, maxEmailLength: 320 } as const;

/**
 * One entry on the Masters list. `linked` says whether the Master has signed in and been matched to an IDAM account
 * by email; the account itself is never published, so nothing here can key on it. `available`, `linked` and
 * `revision` are primitives on api's record, and `id` is strict by choice, as every other id here is.
 */
const masterSchema = z.object({
  id: z.string(),
  name: z.string().nullish(),
  email: z.string().nullish(),
  available: z.boolean(),
  linked: z.boolean(),
  revision: z.number().int().nonnegative()
});

// api trims and lower-cases the address and refuses one without exactly one `@` or with whitespace; that is
// api's rule to apply, so only the published bounds are restated.
const masterName = z.string().trim().min(1).max(MASTER_LIMITS.maxNameLength);
const masterEmail = z.string().max(MASTER_LIMITS.maxEmailLength);

const createMasterSchema = z
  .object({
    name: masterName,
    email: masterEmail,
    available: z.boolean().optional()
  })
  .strict();

/** A keyed patch: the revision and at least one of the three (api's `minProperties: 2`). */
const updateMasterSchema = z
  .object({
    name: masterName.optional(),
    email: masterEmail.optional(),
    available: z.boolean().optional(),
    revision: z.number().int().nonnegative()
  })
  .strict()
  .refine((patch) => patch.name !== undefined || patch.email !== undefined || patch.available !== undefined);

/** The bank holiday name's bound, pinned to `CreateBankHolidayRequest` by `contract.test.ts`. */
export const BANK_HOLIDAY_LIMITS = { maxNameLength: 200 } as const;

/**
 * One England and Wales bank holiday. `date` stays the `yyyy-MM-dd` string api sends rather than becoming a `Date`:
 * it is a calendar day with no time zone, and it is the removal's path segment. Strict by choice, as an id is.
 */
const bankHolidaySchema = z.object({
  date: z.iso.date(),
  name: z.string().nullish()
});

const createBankHolidaySchema = z
  .object({
    date: z.iso.date(),
    name: z.string().trim().min(1).max(BANK_HOLIDAY_LIMITS.maxNameLength)
  })
  .strict();

const gazetteNoticeBatchSchema = z.object({
  batchId: z.uuid().nullish(),
  sentAt: wireDateTime.nullish(),
  sentBy: z.string().nullish(),
  caseCount: z.number().int().nonnegative(),
  referenceNumbers: z.array(z.string()),
  referencesTruncated: z.boolean()
});

const gazetteNoticeHistorySchema = z.object({
  batches: z.array(gazetteNoticeBatchSchema),
  page: z.number().int().positive(),
  size: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative()
});

export const GAZETTE_REQUEST_STATE = ["Preparing", "Sending", "Sent", "NotSent", "Uncertain"] as const;
export const GAZETTE_REFUSAL_CODE = [
  "RECIPIENT_NOT_CONFIGURED",
  "RECIPIENT_CHANGED",
  "SELECTION_CHANGED",
  "CASE_NOT_READY",
  "CASE_TYPE_UNSUPPORTED",
  "CASE_RESERVED",
  "REQUEST_KEY_REUSED",
  "CONFIRMATION_EXPIRED",
  "GAZETTE_UNAVAILABLE"
] as const;
/**
 * Why a document preview was not produced, in api's published order. Each arrives on one status only — 422 for the
 * first two, 503 and 429 for the others — and in every case the original's `/file` download still works.
 */
export const DOCUMENT_PREVIEW_ERROR_CODE = ["PREVIEW_INVALID_DOCUMENT", "PREVIEW_LIMIT_EXCEEDED", "PREVIEW_UNAVAILABLE", "PREVIEW_BUSY"] as const;
const gazetteMemberSchema = z.object({ caseId: z.string(), referenceNumber: z.string() });
const gazetteStatusSchema = z.object({
  batchId: z.uuid(),
  state: z.enum(GAZETTE_REQUEST_STATE),
  caseCount: z.number().int().nonnegative(),
  submittedAt: wireDateTime.nullish(),
  submittedBy: z.string().nullish(),
  recipientEmail: z.string().nullish(),
  recipientRevision: z.number().int().nonnegative().nullish(),
  adultCount: z.number().int().nonnegative().nullish(),
  minorCount: z.number().int().nonnegative().nullish(),
  sentAt: wireDateTime.nullish(),
  failureCode: z.enum(["PREPARATION_FAILED", "CONFIGURATION_INVALID", "PROVIDER_REFUSED", "PRE_SEND_EXPIRED", "SEND_OUTCOME_UNKNOWN"]).nullish()
});
const gazettePagingShape = {
  page: z.number().int().positive(),
  size: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative()
};
const gazetteRequestsSchema = z.object({ ...gazettePagingShape, requests: z.array(gazetteStatusSchema) });
const gazetteMembersSchema = z.object({ ...gazettePagingShape, cases: z.array(gazetteMemberSchema) });
const gazettePreviewSchema = z.object({
  recipientEmail: z.string(),
  recipientRevision: z.number().int().nonnegative(),
  caseCount: z.number().int().positive(),
  adultCount: z.number().int().nonnegative(),
  minorCount: z.number().int().nonnegative(),
  cases: z.array(gazetteMemberSchema),
  selectionFingerprint: z.string().min(1),
  expiresAt: wireDateTime
});
const gazetteSelection = z
  .array(z.string().min(1).max(255))
  .min(1)
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length);
const previewGazetteSchema = z.object({ caseIds: gazetteSelection }).strict();
const submitGazetteSchema = z
  .object({ caseIds: gazetteSelection, recipientRevision: z.number().int().nonnegative(), selectionFingerprint: z.string().min(1).max(512) })
  .strict();
const gazetteConflictSchema = z.object({
  caseId: z.string(),
  reason: z.enum(["NOT_FOUND", "NOT_READY", "TYPE_UNSUPPORTED", "REFERENCE_MISSING", "DATA_CHANGED", "RESERVED"])
});
const gazetteErrorSchema = z.object({ code: z.enum(GAZETTE_REFUSAL_CODE), error: z.string(), conflicts: z.array(gazetteConflictSchema).optional() });

/** A preview that was not produced: a code to switch on and a fixed sentence that never names the document. */
const documentPreviewErrorSchema = z.object({ code: z.enum(DOCUMENT_PREVIEW_ERROR_CODE), error: z.string() });

/**
 * `GET /me`: which staff areas admit the caller and what their roles grant. Both flags are Java primitives and
 * the list is a `List.copyOf`, so all three are strict. No identity, on purpose: admin has IDAM's.
 *
 * A capability this build does not list is dropped rather than refused: api may ship one before admin is redeployed,
 * and rejecting the whole answer would sign every caller in with no access at all.
 */
const callerAccessSchema = z.object({
  staff: z.boolean(),
  judicial: z.boolean(),
  capabilities: z.array(z.string()).transform((names) => CAPABILITY.filter((capability) => names.includes(capability)))
});

/** One field's validation message inside api's failure body. Published as `FieldError` since api's 403 contract. */
const fieldErrorSchema = z.object({ field: z.string(), message: z.string() });

/**
 * api's failure body. `errors` is omitted rather than empty when there are none (`@JsonInclude`).
 *
 * Published as `ApiError` since api documented its 403 response on every staff operation (`OpenAPIForbiddenResponses`),
 * so it is compared with the document like every other schema rather than listed as unspecified.
 */
const apiErrorSchema = z.object({
  error: z.string(),
  errors: z.array(fieldErrorSchema).optional()
});

/**
 * Every consumed named schema in the spec's `components.schemas`, keyed by its spec name.
 *
 * The registry IS the drift test's subject: `contract.test.ts` asserts these keys and the spec's are the
 * same set after including the explicitly pinned deferred CCD inventory, so unknown additions fail.
 *
 * `CreateCaseRequest` and `UpdateCaseRequest` share one schema. The test compares each spec name against
 * it separately, so the day api's two bodies diverge, one of the two comparisons fails.
 */
export const WIRE_SCHEMAS = {
  ApiError: apiErrorSchema,
  FieldError: fieldErrorSchema,
  CallerAccessResponse: callerAccessSchema,
  GazetteMemberResponse: gazetteMemberSchema,
  GazetteStatusResponse: gazetteStatusSchema,
  GazetteRequestsResponse: gazetteRequestsSchema,
  GazetteMembersResponse: gazetteMembersSchema,
  GazettePreviewResponse: gazettePreviewSchema,
  PreviewGazetteRequest: previewGazetteSchema,
  SubmitGazetteRequest: submitGazetteSchema,
  Conflict: gazetteConflictSchema,
  GazetteError: gazetteErrorSchema,
  DocumentPreviewError: documentPreviewErrorSchema,
  GazetteSettingsResponse: gazetteSettingsSchema,
  UpdateGazetteSettingsRequest: updateGazetteSettingsSchema,
  ProcessSettingsResponse: processSettingsSchema,
  UpdateProcessSettingsRequest: updateProcessSettingsSchema,
  MasterResponse: masterSchema,
  CreateMasterRequest: createMasterSchema,
  UpdateMasterRequest: updateMasterSchema,
  BankHolidayResponse: bankHolidaySchema,
  CreateBankHolidayRequest: createBankHolidaySchema,
  GazetteNoticeBatchResponse: gazetteNoticeBatchSchema,
  GazetteNoticeHistoryResponse: gazetteNoticeHistorySchema,
  CaseListResponse: caseListSchema,
  CaseSummaryResponse: caseSummarySchema,
  CaseDetailResponse: caseDetailSchema,
  SavedCaseResponse: savedCaseSchema,
  CreateCaseRequest: caseWriteSchema,
  UpdateCaseRequest: caseWriteSchema,
  CreateNoteRequest: createNoteSchema,
  UpdateNoteRequest: updateNoteSchema,
  NoteResponse: noteSchema,
  CreateWitnessRequest: createWitnessSchema,
  UpdateWitnessRequest: updateWitnessSchema,
  WitnessResponse: witnessSchema,
  DocumentResponse: documentSchema,
  DocumentTypeResponse: documentTypeSchema,
  FieldRuleResponse: fieldRuleSchema,
  FieldRulesResponse: fieldRulesSchema,
  SavedQueryResponse: savedQuerySchema,
  CreateSavedQueryRequest: createSavedQuerySchema,
  UpdateSavedQueryRequest: updateSavedQuerySchema,
  CreateReferralRequest: createReferralSchema,
  RecordConfirmationRequest: recordConfirmationSchema,
  ReferralResponse: referralSchema,
  JudicialDirectionRequest: judicialDirectionSchema,
  JudicialPoolResponse: judicialPoolSchema,
  JudicialMyReferralsResponse: judicialMyReferralsSchema,
  JudicialReferralSummary: judicialReferralSummarySchema,
  JudicialReferralDetail: judicialReferralDetailSchema,
  JudicialApplicationView: judicialApplicationViewSchema,
  JudicialDocument: judicialDocumentSchema,
  CaseEmailsResponse: caseEmailsSchema,
  EmailTypeResponse: emailTypeSchema,
  EmailSlotResponse: emailSlotSchema,
  EmailSlotDefaultsResponse: emailSlotDefaultsSchema,
  EmailHistoryResponse: emailHistorySchema,
  CorrespondenceDocumentResponse: correspondenceDocumentSchema,
  EmailPreviewResponse: emailPreviewSchema,
  SentEmailResponse: sentEmailSchema,
  // Both of api's email write bodies, which have identical properties. One schema, two comparisons — the
  // `CreateCaseRequest`/`UpdateCaseRequest` arrangement, and for the same reason.
  PreviewEmailRequest: emailSlotsWriteSchema,
  SendEmailRequest: emailSlotsWriteSchema
} as const;

/**
 * The response properties that reject null, and the only ones.
 *
 * Pinned by `contract.test.ts` against api's Java types, because the document cannot answer the question:
 * springdoc emits no nullability for a response. Three kinds of property are here and nothing else is:
 *
 *   - Java primitives at the source (`migratedRecord`, `declarant`, `visible`), which cannot be null.
 *   - Collections api builds with `List.of()` or `Arrays.asList` — the multiselects, the children, the
 *     rules map — so an absent one arrives as `[]` rather than as null.
 *   - `id`, which is strict by choice rather than by Java: a case, note or document with no id is not
 *     something a page can link to or patch, so a response missing one is a contract failure worth
 *     surfacing as one.
 *
 * Everything else is nullable, and a schema insisting otherwise would reject an ordinary half-logged case.
 */
export const STRICT_RESPONSE_PROPERTIES: Readonly<Record<string, readonly string[]>> = {
  // api's `ApiError` and `FieldError` records: `error`, `field` and `message` are always set, and `errors` is omitted
  // rather than null when empty (`@JsonInclude(NON_EMPTY)`), so none of the four arrives null.
  ApiError: ["error", "errors"],
  FieldError: ["field", "message"],
  CallerAccessResponse: ["staff", "judicial", "capabilities"],
  GazetteMemberResponse: ["caseId", "referenceNumber"],
  GazetteStatusResponse: ["batchId", "state", "caseCount"],
  GazetteRequestsResponse: ["page", "size", "total", "totalPages", "requests"],
  GazetteMembersResponse: ["page", "size", "total", "totalPages", "cases"],
  GazettePreviewResponse: ["recipientEmail", "recipientRevision", "caseCount", "adultCount", "minorCount", "cases", "selectionFingerprint", "expiresAt"],
  Conflict: ["caseId", "reason"],
  GazetteError: ["code", "error", "conflicts"],
  // Both are required in api's record and the code is an enum, so neither can arrive null.
  DocumentPreviewError: ["code", "error"],
  GazetteSettingsResponse: ["revision"],
  ProcessSettingsResponse: ["referralClaimExpiryMinutes", "reminderIntervalHours", "masterWindowCap", "revision"],
  MasterResponse: ["id", "available", "linked", "revision"],
  // `date` is the row's key, and the removal's path segment, so it is strict for the reason an id is.
  BankHolidayResponse: ["date"],
  GazetteNoticeBatchResponse: ["caseCount", "referenceNumbers", "referencesTruncated"],
  GazetteNoticeHistoryResponse: ["batches", "page", "size", "total", "totalPages"],
  // The four paging counts are `int`, `int`, `long` and `int` on api's record, so none can arrive null.
  CaseListResponse: ["filter", "cases", "page", "size", "total", "totalPages"],
  CaseSummaryResponse: ["id"],
  CaseDetailResponse: [
    "id",
    "migratedRecord",
    "retainPermanently",
    "publishToLondonGazette",
    "iShall",
    "iHaveSubscribed",
    "andAlsoMyOld",
    "notes",
    "witnesses",
    "documents"
  ],
  SavedCaseResponse: ["id", "migratedRecord", "retainPermanently", "publishToLondonGazette", "iShall", "iHaveSubscribed", "andAlsoMyOld"],
  NoteResponse: ["id", "note"],
  WitnessResponse: ["id", "declarant"],
  DocumentResponse: ["id", "hasFile"],
  DocumentTypeResponse: ["id", "applicableMaritalStatuses", "applicableTypes"],
  FieldRuleResponse: ["visible", "required"],
  FieldRulesResponse: ["rules"],
  // `shared`, `selected` and `editable` are Java booleans at source, and `conditions` is a List api always
  // sends — empty for a query that narrows nothing, never null. `name` is NOT NULL in the schema.
  SavedQueryResponse: ["id", "name", "shared", "conditions", "selected", "editable"],
  // `migrated` is a `boolean` primitive on api's record and `reasons` a `List.copyOf` — empty for a migrated
  // referral, never null. `changesToStandardPublication` is a boxed `Boolean` and `decision` a nullable enum, so
  // neither is here: a referral with no direction has not been asked either question.
  ReferralResponse: ["id", "migrated", "reasons"],
  JudicialReferralSummary: ["id", "reasons"],
  // The summary's two and no more: `application` is not pinned, despite api always building one — a nested record
  // is neither a primitive, a collection nor an id. (`caseNotes` was pinned here until api stopped sending it.)
  JudicialReferralDetail: ["id", "reasons"],
  // `page`, `size` and `totalPages` are `int` and `total` is `long`, as `CaseListResponse`'s already are.
  JudicialPoolResponse: ["referrals", "page", "size", "total", "totalPages"],
  // The same five, because api's `ReferralWorkload` is the same record shape as `ReferralPool` — `List.copyOf`
  // rows and the four numbers. A judge holding nothing is `[]` and a total of zero, never a null list.
  JudicialMyReferralsResponse: ["referrals", "page", "size", "total", "totalPages"],
  // The one list and nothing else: api builds it with `toList()`, so an application with no readable documents
  // arrives with `[]`. Every other field is a nullable column of the application.
  JudicialApplicationView: ["documents"],
  // `id` by choice, as `DocumentResponse.id` is: a row with no id is not one a page can link to.
  JudicialDocument: ["id"],
  // All three are `stream().toList()` at the source, so an empty one arrives as `[]`.
  CaseEmailsResponse: ["availability", "history", "slotDefaults"],
  // `applicable` and `provisioned` are `boolean` primitives and `slots` a `toList()`. `template` is NOT here,
  // though api builds it from an enum key that cannot be null: it is the token the tab links with, so a null
  // one is a row the view model skips rather than a reason to fail the whole tab's parse.
  EmailTypeResponse: ["applicable", "provisioned", "slots"],
  // `required` is a `boolean` and `maxLength` an `int` on api's record. `name` is a placeholder literal and
  // still nullable, for the reason `EmailTypeResponse.template` is.
  EmailSlotResponse: ["maxLength", "required"],
  // `fields` is an unmodifiable map api always builds, as `FieldRulesResponse.rules` is.
  EmailSlotDefaultsResponse: ["fields"],
  // `documents` is `List.copyOf`. `subject`, `body`, `failureReason` and `notifyState` are all legitimately
  // null — decision 15's three no-content cases are exactly this.
  EmailHistoryResponse: ["id", "documents"],
  CorrespondenceDocumentResponse: ["id"],
  // `templateVersion` is an `int`. `html` and `subject` are nullable on purpose — see the schema's docblock:
  // api sends `""` rather than null for an absent rendering, and either must become a sentence on the page.
  EmailPreviewResponse: ["templateVersion"],
  // `enqueued` is a `boolean` primitive, and false is a SUCCESS — the send was redundant.
  SentEmailResponse: ["id", "enqueued"]
};

export type WireSavedCase = z.infer<typeof savedCaseSchema>;
export type WireCaseDetail = z.infer<typeof caseDetailSchema>;
export type WireCaseSummary = z.infer<typeof caseSummarySchema>;
export type WireCaseList = z.infer<typeof caseListSchema>;
/** `z.input`, not `z.infer`: a write is what goes OUT, before the date union has been applied. */
export type WireCaseWrite = z.input<typeof caseWriteSchema>;
export type WireNote = z.infer<typeof noteSchema>;
export type WireWitness = z.infer<typeof witnessSchema>;
export type WireWitnessCreate = z.infer<typeof createWitnessSchema>;
export type WireWitnessUpdate = z.infer<typeof updateWitnessSchema>;
export type WireDocument = z.infer<typeof documentSchema>;
export type WireDocumentType = z.infer<typeof documentTypeSchema>;
export type WireFieldRules = z.infer<typeof fieldRulesSchema>;
export type WireSavedQuery = z.infer<typeof savedQuerySchema>;
/** `z.input` for the writes, as `WireCaseWrite` is: a write is what goes out, before any transform. */
export type WireSavedQueryCreate = z.input<typeof createSavedQuerySchema>;
export type WireSavedQueryUpdate = z.input<typeof updateSavedQuerySchema>;
export type WireReferral = z.infer<typeof referralSchema>;
/** `z.input` for the write, as `WireCaseWrite` is: a body is what goes out, before any transform. */
export type WireReferralCreate = z.input<typeof createReferralSchema>;
/** `z.input` for the same reason. `outcome` is required, `note` is not, and neither audit field is here. */
export type WireRecordConfirmation = z.input<typeof recordConfirmationSchema>;
export type WireJudicialPool = z.infer<typeof judicialPoolSchema>;
export type WireJudicialMyReferrals = z.infer<typeof judicialMyReferralsSchema>;
export type WireJudicialReferralSummary = z.infer<typeof judicialReferralSummarySchema>;
export type WireJudicialReferralDetail = z.infer<typeof judicialReferralDetailSchema>;
export type WireJudicialApplicationView = z.infer<typeof judicialApplicationViewSchema>;
export type WireJudicialDocument = z.infer<typeof judicialDocumentSchema>;
export type WireJudicialDirection = z.input<typeof judicialDirectionSchema>;
export type WireCaseEmails = z.infer<typeof caseEmailsSchema>;
export type WireEmailType = z.infer<typeof emailTypeSchema>;
export type WireEmailSlot = z.infer<typeof emailSlotSchema>;
export type WireEmailSlotDefaults = z.infer<typeof emailSlotDefaultsSchema>;
export type WireEmailHistory = z.infer<typeof emailHistorySchema>;
export type WireCorrespondenceDocument = z.infer<typeof correspondenceDocumentSchema>;
export type WireEmailPreview = z.infer<typeof emailPreviewSchema>;
export type WireSentEmail = z.infer<typeof sentEmailSchema>;
/** `z.input` for the write, as `WireCaseWrite` is: a body is what goes out, before any transform. */
export type WireEmailSlotsWrite = z.input<typeof emailSlotsWriteSchema>;
export type WireApiError = z.infer<typeof apiErrorSchema>;
export type WireCallerAccess = z.infer<typeof callerAccessSchema>;

export type WireGazetteNoticeHistory = z.infer<typeof gazetteNoticeHistorySchema>;
export type WireGazetteNoticeBatch = z.infer<typeof gazetteNoticeBatchSchema>;

export type WireGazetteSettings = z.infer<typeof gazetteSettingsSchema>;
export type WireUpdateGazetteSettings = z.infer<typeof updateGazetteSettingsSchema>;
export type WireProcessSettings = z.infer<typeof processSettingsSchema>;
export type WireUpdateProcessSettings = z.infer<typeof updateProcessSettingsSchema>;
export type WireMaster = z.infer<typeof masterSchema>;
export type WireMasterCreate = z.input<typeof createMasterSchema>;
export type WireMasterUpdate = z.input<typeof updateMasterSchema>;
export type WireBankHoliday = z.infer<typeof bankHolidaySchema>;
export type WireBankHolidayCreate = z.input<typeof createBankHolidaySchema>;

export type WireGazettePreview = z.infer<typeof gazettePreviewSchema>;
export type WireGazetteStatus = z.infer<typeof gazetteStatusSchema>;
export type WireGazetteRequests = z.infer<typeof gazetteRequestsSchema>;
export type WireGazetteMembers = z.infer<typeof gazetteMembersSchema>;
export type WirePreviewGazette = z.input<typeof previewGazetteSchema>;
export type WireSubmitGazette = z.input<typeof submitGazetteSchema>;
export type WireGazetteError = z.infer<typeof gazetteErrorSchema>;
export type WireDocumentPreviewError = z.infer<typeof documentPreviewErrorSchema>;
