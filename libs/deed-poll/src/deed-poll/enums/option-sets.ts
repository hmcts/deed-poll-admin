/**
 * The case option sets, as named members.
 *
 * These used to be Prisma's generated enums, which gave both a type (`DeedPollType`) and a value
 * (`DeedPollType.Minor`) under one name. api publishes the same option sets — they are the same
 * Dataverse option sets on both sides — but as a spec, so the client hands over a member ARRAY and
 * a union type. This module turns each array back into the named-member object the rules below it
 * were written against, so `deriveState`, `getFieldRules` and `defaultPrivacy` keep reading
 * `DeedPollState.Returned` rather than a bare `"Returned"` a typo would slip past silently.
 *
 * The members are never restated here. Every object is BUILT from the client's array, so a member
 * added at api's end appears here and in the Dynamics label maps without an edit, and one that
 * disappears is a type error at every call site rather than a runtime `undefined`.
 *
 * The names are this codebase's, not api's: api calls a case a Case, and `DeedPollType` is what the
 * source Dynamics entity, the ported workflows and every comment in `libs/deed-poll` call it.
 * Renaming 40 call sites to match the transport would lose the tie back to the source material.
 */
import type {
  DocumentDirection as ApiDocumentDirection,
  MaritalStatus as ApiMaritalStatus,
  MasterDecision as ApiMasterDecision,
  Nationality as ApiNationality,
  NationalitySection as ApiNationalitySection,
  PostCounter as ApiPostCounter,
  Privacy as ApiPrivacy,
  ReferToMaster as ApiReferToMaster,
  Urgency as ApiUrgency,
  CaseState,
  CaseType
} from "@hmcts/deed-poll-api-client";
import {
  DEED_POLL_STATE,
  DEED_POLL_TYPE,
  DOCUMENT_DIRECTION,
  MARITAL_STATUS,
  MASTER_DECISION,
  NATIONALITY,
  NATIONALITY_SECTION,
  POST_COUNTER,
  PRIVACY,
  REFER_TO_MASTER,
  URGENCY
} from "@hmcts/deed-poll-api-client";

/**
 * Turn a member array into `{ Member: "Member" }`.
 *
 * The mapped return type is what makes `DeedPollType.Minor` resolve to the literal `"Minor"`
 * rather than to the whole union, so a member the array does not contain fails to compile.
 */
function members<T extends string>(values: readonly T[]): { readonly [K in T]: K } {
  return Object.freeze(Object.fromEntries(values.map((value) => [value, value]))) as { readonly [K in T]: K };
}

export const DeedPollType = members(DEED_POLL_TYPE);
export const DeedPollState = members(DEED_POLL_STATE);
export const MaritalStatus = members(MARITAL_STATUS);
export const Privacy = members(PRIVACY);
export const Urgency = members(URGENCY);
export const PostCounter = members(POST_COUNTER);
export const Nationality = members(NATIONALITY);
export const NationalitySection = members(NATIONALITY_SECTION);
export const MasterDecision = members(MASTER_DECISION);
export const ReferToMaster = members(REFER_TO_MASTER);
export const DocumentDirection = members(DOCUMENT_DIRECTION);

/**
 * The member unions under the same names, so one import serves a value and an annotation exactly
 * as the Prisma import it replaces did. Aliases of the client's types, not copies of them.
 */
export type DeedPollType = CaseType;
export type DeedPollState = CaseState;
export type MaritalStatus = ApiMaritalStatus;
export type Privacy = ApiPrivacy;
export type Urgency = ApiUrgency;
export type PostCounter = ApiPostCounter;
export type Nationality = ApiNationality;
export type NationalitySection = ApiNationalitySection;
export type MasterDecision = ApiMasterDecision;
export type ReferToMaster = ApiReferToMaster;
export type DocumentDirection = ApiDocumentDirection;
