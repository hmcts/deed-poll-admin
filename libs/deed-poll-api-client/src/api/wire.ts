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
export const REFERRAL_REASON = ["Minor", "DomesticAbuse", "NonPublication", "DeclarantRequirementsNotMet", "SeparatedOrEstranged", "Other"] as const;

/**
 * The case-list filter keys, as api's own `LIST_FILTERS` table orders them.
 *
 * Lower case, unlike every vocabulary above: these are URL parameter values rather than stored option-set
 * members. api publishes them as the `filter` enum on both saved-query bodies, and `contract.test.ts`
 * asserts these members against it — so a tab api adds fails here rather than becoming a saved query this
 * app cannot round-trip.
 */
export const LIST_FILTER = ["all", "open", "received", "enroled", "returned"] as const;

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
 * Exported alongside the registry, temporarily, because `client.ts` parses with it before Task 2b registers
 * it in {@link WIRE_SCHEMAS}. Fold these back into the registry reference when it does.
 *
 * `reasons` is the stored strings and not `REFERRAL_REASON` members: the column is a JSON array api
 * validates on write, so a backfilled or hand-corrected row is published as it stands. It is **empty for a
 * migrated referral** — the source store had no such field — which is what `migrated` explains, and never
 * null, because api builds it with `List.copyOf`.
 *
 * `publishToGazette` is nullable where `migrated` is not: api boxes it deliberately, because a referral with
 * no direction has not been asked the question and absent is not false.
 */
export const referralSchema = z.object({
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
  publishToGazette: z.boolean().nullish(),
  decisionDate: wireDateTime.nullish(),
  decidedBy: z.string().nullish(),
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
  newSurname: z.string().nullish()
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
export const createReferralSchema = z.object({
  reasons: z.array(z.enum(REFERRAL_REASON)).min(1),
  notes: z.string().max(1000).optional(),
  urgency: z.enum(URGENCY).optional(),
  urgencyReason: z.string().max(500).optional()
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
 * The application behind a referral, as api's `/judicial/**` surface publishes it: eight fields, and
 * deliberately not a case.
 *
 * **Never modelled as a subset of the case schemas**, which is api's own rule — its
 * `NamespaceSeparationSecurityTest` asserts the two records are unrelated in bytecode, because the failure it
 * guards against is a field added to the caseworker response for a caseworker reason silently appearing here.
 * A separate schema means the same is true of this adapter: widening the judicial view is an edit to this
 * object, not a side effect of one to `savedCaseSchema`.
 *
 * There is no case id, and that is api's decision 2 rather than an omission: the judicial surface is keyed on
 * the referral so a judge cannot name an application. `displayReference` is what a direction quotes and is not
 * an id api accepts anywhere. All six name components travel together because a deed poll is about the whole
 * name — showing the first and last parts of "John Peter Smith" to "John Peter Smyth" would hide the only part
 * that moved.
 */
export const judicialCaseViewSchema = z.object({
  displayReference: z.string().nullish(),
  type: z.enum(DEED_POLL_TYPE).nullish(),
  oldForename: z.string().nullish(),
  oldMiddleName: z.string().nullish(),
  oldSurname: z.string().nullish(),
  newForename: z.string().nullish(),
  newMiddleName: z.string().nullish(),
  newSurname: z.string().nullish()
});

/**
 * One note from the application's timeline, as a judge reads it.
 *
 * Narrower than `noteSchema`: no id, because no judicial route accepts one, and no `modifiedBy`/`modifiedOn`,
 * because the amendment audit trail is the office's record-keeping rather than the timeline. `createdBy` stays
 * — an unattributed timeline is one a judge cannot weigh.
 */
export const judicialCaseNoteSchema = z.object({
  note: z.string(),
  createdBy: z.string().nullish(),
  createdOn: wireDateTime.nullish()
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
export const judicialReferralSummarySchema = z.object({
  id: z.string(),
  state: z.enum(REFERRAL_STATE).nullish(),
  reasons: z.array(z.string()),
  notes: z.string().nullish(),
  urgency: z.enum(URGENCY).nullish(),
  urgencyReason: z.string().nullish(),
  createdOn: wireDateTime.nullish()
});

/**
 * One referral as the judge who may see it reads it: the referral, the narrow application view, and the
 * application's timeline — one response for what is one screen.
 *
 * Built by extending the pool row rather than restating its seven fields, as `caseDetailSchema` extends the
 * saved case, so the two cannot drift.
 *
 * `notes` is the referral's free text and `caseNotes` the application's timeline. Two different things with
 * confusable names, and both names are api's: renaming either here would make one disagree with the resource
 * it belongs to.
 *
 * `claimedBy` and `decidedBy` can only ever name this caller or nobody — api's visibility admits an `Open`
 * referral, which has no holder, or a `Claimed`/`Decided` one only when the caller is the judge on it. So a
 * page rendering them cannot disclose who else holds anything.
 */
export const judicialReferralDetailSchema = judicialReferralSummarySchema.extend({
  claimedBy: z.string().nullish(),
  claimedAt: wireDateTime.nullish(),
  decision: z.enum(MASTER_DECISION).nullish(),
  directionsText: z.string().nullish(),
  publishToGazette: z.boolean().nullish(),
  decisionDate: wireDateTime.nullish(),
  decidedBy: z.string().nullish(),
  application: judicialCaseViewSchema.nullish(),
  caseNotes: z.array(judicialCaseNoteSchema)
});

/**
 * One page of the shared pool, and how much work is waiting behind it.
 *
 * `total` is what the envelope exists for: a judge is shown ten referrals by default, and ten is a page size
 * rather than a cap, so a bare array would be indistinguishable from "there are ten". `size` is the page size
 * api APPLIED — it clamps an over-cap value rather than refusing it — so a caller that asked for a thousand
 * rows and got a hundred can tell, instead of reading a full page as the whole pool and stopping.
 */
export const judicialPoolSchema = z.object({
  referrals: z.array(judicialReferralSummarySchema),
  page: z.number(),
  size: z.number(),
  total: z.number(),
  totalPages: z.number()
});

/**
 * The holding judge's direction on a referral, recorded once and complete — api has no draft and no patch.
 *
 * `publishToGazette` is a required JSON boolean and not a coerced string, which is api's own emphasis:
 * `"false"` is truthy in JavaScript, and publication cannot be taken back. Never derived from a
 * `NonPublication` referral reason — the caseworker's reason for referring is not the judge's decision.
 *
 * `directionsText` is optional, because an approval that needs no comment is a real answer. The state, the
 * decider and the decision date come from the transition, the token and api's clock, so none of them is here.
 */
export const judicialDirectionSchema = z.object({
  decision: z.enum(MASTER_DECISION),
  publishToGazette: z.boolean(),
  directionsText: z.string().max(4000).optional()
});

/** api's failure body. `errors` is omitted rather than empty when there are none (`@JsonInclude`). */
const apiErrorSchema = z.object({
  error: z.string(),
  errors: z.array(z.object({ field: z.string(), message: z.string() })).optional()
});

/**
 * Every named schema in the spec's `components.schemas`, keyed by its spec name.
 *
 * The registry IS the drift test's subject: `contract.test.ts` asserts these keys and the spec's are the
 * same set, so a schema added at one end and not the other fails rather than going unnoticed.
 *
 * `CreateCaseRequest` and `UpdateCaseRequest` share one schema. The test compares each spec name against
 * it separately, so the day api's two bodies diverge, one of the two comparisons fails.
 */
export const WIRE_SCHEMAS = {
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
  UpdateSavedQueryRequest: updateSavedQuerySchema
} as const;

/**
 * Schemas this module defines that the spec does not describe.
 *
 * `ApiError` is api's error body, produced by a `@RestControllerAdvice`. springdoc only publishes a
 * schema some declared response references, and no handler declares this one, so it is absent from the
 * document. Listed explicitly so the drift test accounts for the difference rather than being loosened
 * to ignore whatever it cannot find on one side.
 */
export const UNSPECIFIED_SCHEMAS = { ApiError: apiErrorSchema } as const;

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
  SavedQueryResponse: ["id", "name", "shared", "conditions", "selected", "editable"]
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
export type WireJudicialPool = z.infer<typeof judicialPoolSchema>;
export type WireJudicialReferralSummary = z.infer<typeof judicialReferralSummarySchema>;
export type WireJudicialReferralDetail = z.infer<typeof judicialReferralDetailSchema>;
export type WireJudicialCaseView = z.infer<typeof judicialCaseViewSchema>;
export type WireJudicialCaseNote = z.infer<typeof judicialCaseNoteSchema>;
export type WireJudicialDirection = z.input<typeof judicialDirectionSchema>;
export type WireApiError = z.infer<typeof apiErrorSchema>;
