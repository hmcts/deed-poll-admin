/**
 * Dynamics option-set value maps.
 *
 * The option sets use readable member names; Dynamics stores integers. These maps
 * are the single source of truth linking the two, so:
 *   - UI can render the human label,
 *   - a future Dataverse import/export can round-trip the exact integer,
 *   - business logic that mirrors the original (e.g. "type === 5") stays legible.
 *
 * Each map is keyed by the option-set member -> Dynamics integer. Reverse maps
 * are derived for import. Keying by `Record<DeedPollType, number>` is what makes a
 * member added to api's option set a compile error here rather than a missing label.
 */
import { REFERRAL_STATE, type ReferralState } from "@hmcts/deed-poll-api-client";
import type {
  DeedPollState,
  DeedPollType,
  DocumentDirection,
  MaritalStatus,
  MasterDecision,
  Nationality,
  NationalitySection,
  PostCounter,
  Privacy,
  ReferToMaster,
  Urgency
} from "./option-sets.js";

export const DEED_POLL_TYPE_VALUE: Record<DeedPollType, number> = {
  Adult: 1,
  AdultTransgender: 2,
  Minor: 3,
  MinorTransgender: 4,
  DeedOfRelinquishment: 5,
  Unknown: 6
};

export const DEED_POLL_STATE_VALUE: Record<DeedPollState, number> = {
  Received: 1,
  ReadyForMaster: 2,
  ReferredToMaster: 3,
  Enroled: 4,
  Returned: 5,
  AwaitingFurtherDocs: 6,
  AwaitingSignature: 7,
  AwaitingEnrolment: 8
};

export const MARITAL_STATUS_VALUE: Record<MaritalStatus, number> = {
  Single: 1,
  MarriedCivilPartnership: 2,
  Widowed: 3,
  DivorcedDissolved: 4
};

export const PRIVACY_VALUE: Record<Privacy, number> = {
  Normal: 1,
  Private: 2
};

export const URGENCY_VALUE: Record<Urgency, number> = {
  Normal: 1,
  Urgent: 2
};

export const POST_COUNTER_VALUE: Record<PostCounter, number> = {
  Counter: 1,
  Online: 2,
  Post: 3,
  Unknown: 4
};

export const NATIONALITY_VALUE: Record<Nationality, number> = {
  BritishCitizen: 1,
  BritishDependantTerritoriesCitizen: 2,
  CommonwealthCitizen: 3,
  Unknown: 4
};

export const NATIONALITY_SECTION_VALUE: Record<NationalitySection, number> = {
  Section1: 1,
  Section11: 2,
  Section37: 3,
  Section6: 4,
  Unknown: 5,
  NoneOfTheAbove: 6
};

export const MASTER_DECISION_VALUE: Record<MasterDecision, number> = {
  Approved: 1,
  Rejected: 2
};

export const REFER_TO_MASTER_VALUE: Record<ReferToMaster, number> = {
  Yes: 1,
  No: 2
};

export const DOCUMENT_DIRECTION_VALUE: Record<DocumentDirection, number> = {
  Incoming: 1,
  Outgoing: 2
};

/** Human-readable labels for UI (Phase 9). */
export const DEED_POLL_TYPE_LABEL: Record<DeedPollType, string> = {
  Adult: "Adult",
  AdultTransgender: "Adult Transgender",
  Minor: "Minor",
  MinorTransgender: "Minor Transgender",
  DeedOfRelinquishment: "Deed of Relinquishment",
  Unknown: "Unknown"
};

export const DEED_POLL_STATE_LABEL: Record<DeedPollState, string> = {
  Received: "Received",
  ReadyForMaster: "Ready for Master",
  ReferredToMaster: "Referred to Master",
  Enroled: "Enrolled",
  Returned: "Returned",
  AwaitingFurtherDocs: "Awaiting Further Docs/Info",
  AwaitingSignature: "Awaiting Signature",
  AwaitingEnrolment: "Awaiting Enrolment"
};

export const MARITAL_STATUS_LABEL: Record<MaritalStatus, string> = {
  Single: "Single",
  MarriedCivilPartnership: "Married / Civil Partnership",
  Widowed: "Widowed",
  DivorcedDissolved: "Divorced / Civil Partnership Dissolved"
};

export const PRIVACY_LABEL: Record<Privacy, string> = {
  Normal: "Normal",
  Private: "Private"
};

/**
 * The **case's** urgency, in the Dynamics form's words.
 *
 * A referral's urgency is api's same `Urgency` enum asked as a different question, and the business calls its
 * `Normal` "Standard" — see `REFERRAL_URGENCY_LABEL` in `../../referrals/referrals-view.ts`. Two wordings on
 * purpose: aligning one to the other does not align the other to it.
 */
export const URGENCY_LABEL: Record<Urgency, string> = {
  Normal: "Normal",
  Urgent: "Urgent"
};

export const POST_COUNTER_LABEL: Record<PostCounter, string> = {
  Counter: "Counter",
  Online: "Online",
  Post: "Post",
  Unknown: "Unknown"
};

export const NATIONALITY_LABEL: Record<Nationality, string> = {
  BritishCitizen: "British Citizen",
  BritishDependantTerritoriesCitizen: "British Dependant Territories Citizen",
  CommonwealthCitizen: "Commonwealth Citizen",
  Unknown: "Unknown"
};

export const NATIONALITY_SECTION_LABEL: Record<NationalitySection, string> = {
  Section1: "Section 1",
  Section11: "Section 11",
  Section37: "Section 37",
  Section6: "Section 6",
  Unknown: "Unknown",
  NoneOfTheAbove: "None of the Above"
};

export const MASTER_DECISION_LABEL: Record<MasterDecision, string> = {
  Approved: "Approved",
  Rejected: "Rejected"
};

export const REFER_TO_MASTER_LABEL: Record<ReferToMaster, string> = {
  Yes: "Yes",
  No: "No"
};

export const DOCUMENT_DIRECTION_LABEL: Record<DocumentDirection, string> = {
  Incoming: "Incoming",
  Outgoing: "Outgoing"
};

/**
 * The two states a referral cannot leave, as api's `ReferralState` documents them.
 *
 * The **only** referral-state rule this repo keeps, and it decides two display questions and nothing else:
 * whether the withdraw control is offered (`../../referrals/referrals-view.ts`) and which states the
 * `currentReferralState` filter can usefully ask for (below). Anything beyond "is this state terminal" — who
 * may claim, what a decision permits — is api's and stays there. Lives here rather than beside the withdraw
 * rule because the option set below is built from it and `referrals-view.ts` cannot be imported from this file
 * without a cycle through `detail-view.ts`.
 */
export const TERMINAL_REFERRAL_STATES: readonly ReferralState[] = ["Closed", "Withdrawn"];

/**
 * The states the *case field* `currentReferralState` can hold, for the query builder's value chooser
 * (`NON_FORM_QUERYABLE_FIELDS`). Not a Dynamics option set — referrals are api's own — but a queryable `enum`
 * with no entry here renders a value chooser holding nothing, so the condition the dashboard's worklist link
 * carries could not be shown or resubmitted.
 *
 * **Narrower than `ReferralState` on purpose: the terminal members are absent.** api derives this field from
 * the case's *live* referral, so a case whose only referral is `Closed` or `Withdrawn` carries `null`, not the
 * terminal state — offering either as a filter value would be offering a condition that can only ever answer
 * an empty list, and "0 applications" reads as "no case has a closed referral" when the truth is that this
 * field never records one. A caseworker reading a case's own referral history reads it on the referrals tab,
 * where every state including the terminal two is tagged (`REFERRAL_STATE_TAG`).
 *
 * Each member's label is its own name, because that is what the referrals tab prints (it tags `referral.state`
 * raw) and two wordings for one state is the divergence `REFERRAL_URGENCY_LABEL`'s docblock is careful about.
 * Built by filtering api's member array rather than typed out, per the "option sets are built, never restated"
 * rule: a state added at api's end reaches the builder without an edit here.
 */
export const CURRENT_REFERRAL_STATE_LABEL: Record<string, string> = Object.fromEntries(
  REFERRAL_STATE.filter((state) => !TERMINAL_REFERRAL_STATES.includes(state)).map((state) => [state, state])
);

/**
 * Multiselect option sets — stored as Int[] on the record, so these maps are
 * keyed by the Dynamics integer value (mirrors deedpoll_ishall etc.).
 */
export const I_SHALL_LABEL: Record<number, string> = {
  1: "and my wife",
  2: "and my husband",
  3: "and my civil partner",
  4: "and my children",
  5: "and I alone"
};

export const I_HAVE_SUBSCRIBED_LABEL: Record<number, string> = {
  1: "Forename(s)",
  2: "Middle Name(s)",
  3: "Surname(s)"
};

export const AND_ALSO_MY_OLD_LABEL: Record<number, string> = {
  1: "Forename(s)",
  2: "Middle Name(s)",
  3: "Surname(s)"
};

/**
 * Aggregate of all label maps, keyed by a short set name the Nunjucks `label`
 * filter uses (e.g. `{{ case.type | label('type') }}`). Single source for the UI.
 */
export const LABELS = {
  type: DEED_POLL_TYPE_LABEL,
  state: DEED_POLL_STATE_LABEL,
  maritalStatus: MARITAL_STATUS_LABEL,
  privacy: PRIVACY_LABEL,
  urgency: URGENCY_LABEL,
  postCounter: POST_COUNTER_LABEL,
  nationality: NATIONALITY_LABEL,
  nationalitySection: NATIONALITY_SECTION_LABEL,
  masterDecision: MASTER_DECISION_LABEL,
  referToMaster: REFER_TO_MASTER_LABEL,
  documentDirection: DOCUMENT_DIRECTION_LABEL,
  currentReferralState: CURRENT_REFERRAL_STATE_LABEL,
  iShall: I_SHALL_LABEL,
  iHaveSubscribed: I_HAVE_SUBSCRIBED_LABEL,
  andAlsoMyOld: AND_ALSO_MY_OLD_LABEL
} as const;

/** Build a reverse map (Dynamics int -> enum member) for imports. */
export function reverse<E extends string>(map: Record<E, number>): Record<number, E> {
  const out = {} as Record<number, E>;
  (Object.keys(map) as E[]).forEach((k) => {
    out[map[k]] = k;
  });
  return out;
}
