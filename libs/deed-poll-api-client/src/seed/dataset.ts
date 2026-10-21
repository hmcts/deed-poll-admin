import type { CaseState, CaseType, CaseWrite, JudicialDirection, ReferralCreate, ReferralState, WitnessCreate } from "../api/client.js";

const ROWS: readonly [CaseState, CaseType, string, string, number, ReferralState?][] = [
  ["Received", "Adult", "Alex", "Morgan", 2],
  ["Received", "Adult", "Priya", "Shah", 5],
  ["Received", "Minor", "Theo", "Williams", 8],
  ["Received", "AdultTransgender", "Jamie", "Clarke", 12],
  ["Received", "DeedOfRelinquishment", "Sam", "Bennett", 3],
  ["Received", "Unknown", "Robin", "Taylor", 1],
  ["AwaitingFurtherDocs", "Adult", "Amira", "Hussain", 35],
  ["AwaitingFurtherDocs", "Minor", "Isla", "Evans", 24],
  ["AwaitingFurtherDocs", "MinorTransgender", "Rowan", "Davies", 48],
  ["AwaitingFurtherDocs", "Adult", "Daniel", "O'Neill", 18, "Withdrawn"],
  ["ReadyForMaster", "Minor", "Ava", "Thomas", 30],
  ["ReadyForMaster", "AdultTransgender", "Charlie", "Reed", 22],
  ["ReadyForMaster", "DeedOfRelinquishment", "Jules", "Patel", 41],
  ["ReferredToMaster", "Minor", "Noah", "Ahmed", 28, "Open"],
  ["ReferredToMaster", "MinorTransgender", "Eden", "Lewis", 44, "Claimed"],
  ["ReferredToMaster", "Adult", "Sofia", "Martin", 37, "Decided"],
  ["ReferredToMaster", "Adult", "Oliver", "Green", 52, "Decided"],
  ["AwaitingSignature", "Adult", "Freya", "Wilson", 20],
  ["AwaitingSignature", "Minor", "Leo", "Roberts", 46],
  ["AwaitingSignature", "AdultTransgender", "Blake", "Hughes", 61],
  ["AwaitingSignature", "DeedOfRelinquishment", "Harper", "Jones", 25],
  ["AwaitingEnrolment", "Adult", "Maya", "Campbell", 33],
  ["AwaitingEnrolment", "Minor", "Arlo", "Edwards", 40],
  ["AwaitingEnrolment", "AdultTransgender", "Ashley", "Walker", 55],
  ["Enroled", "Adult", "Luca", "Brown", 70],
  ["Enroled", "Minor", "Grace", "Davies", 83, "Closed"],
  ["Enroled", "MinorTransgender", "Frankie", "Robinson", 96, "Closed"],
  ["Enroled", "DeedOfRelinquishment", "Ellis", "Wright", 120],
  ["Returned", "Adult", "Zara", "Thompson", 57],
  ["Returned", "Minor", "Oscar", "White", 64]
];
const TOWNS = ["Cardiff", "Bristol", "Leeds", "Manchester", "Birmingham", "London"];
const POSTCODES = ["CF10 1EP", "BS1 5AH", "LS1 3AD", "M1 1AD", "B1 1BB", "WC2A 2LL"];
const SCENARIOS: Record<CaseState, string> = {
  Received: "New application logged; initial completeness check is outstanding.",
  AwaitingFurtherDocs: "Evidence is incomplete; awaiting the applicant's supporting paperwork.",
  ReadyForMaster: "Caseworker checks completed; the papers are ready for judicial referral.",
  ReferredToMaster: "Papers referred for judicial consideration; see the referral history for the next action.",
  AwaitingSignature: "Deed pack prepared; awaiting signed and witnessed paperwork.",
  AwaitingEnrolment: "Signed paperwork checked and two witnesses recorded; awaiting enrolment.",
  Enroled: "Enrolment completed; Gazette publication eligibility varies across this group.",
  Returned: "Application returned to the applicant without enrolment; see the return reason."
};

export function seedDataset(batch: string, asOf: string): SeedCase[] {
  if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(batch)) throw new Error("Batch must contain 3–40 lowercase letters, digits or hyphens.");
  const anchor = new Date(`${asOf}T12:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !Number.isFinite(anchor.getTime()) || anchor.toISOString().slice(0, 10) !== asOf) {
    throw new Error("--as-of must be a real date in YYYY-MM-DD form.");
  }
  return ROWS.map((row, i) => seedCase(row, i, batch, anchor));
}

function seedCase([state, type, forename, surname, age, referralState]: (typeof ROWS)[number], i: number, batch: string, anchor: Date): SeedCase {
  const number = String(i + 1).padStart(2, "0");
  const marker = `SEED-${batch}-${number}`;
  const minor = type === "Minor" || type === "MinorTransgender";
  const urgent = [3, 8, 14, 19, 22].includes(i);
  const received = daysBefore(anchor, age);
  const typeIsPrivate = type === "AdultTransgender" || type === "MinorTransgender";
  const create: CaseWrite = {
    type,
    newForename: forename,
    newSurname: `${surname}-Test`,
    oldForename: forename,
    oldSurname: `${surname}-Sample`,
    newMiddleName: i % 4 === 0 ? "Louise" : null,
    dateReceived: received,
    dateOfApplication: daysBefore(anchor, age + 3),
    // Kept on every row as a searchable seed marker, including synthetic post/counter scenarios.
    onlineApplicationReference: marker,
    applicantBuildingNoName: `${10 + i} Example House`,
    applicantAddress1: "Test Data Street",
    applicantAddress2: "Synthetic address — not for correspondence",
    applicantTownCity: TOWNS[i % TOWNS.length],
    applicantPostcode: POSTCODES[i % POSTCODES.length],
    applicantEmail: `${marker.toLowerCase()}@example.invalid`,
    postCounter: ["Online", "Post", "Counter"][i % 3] as "Online" | "Post" | "Counter",
    inPerson: i % 3 === 2,
    nationality: "BritishCitizen",
    nationalitySection: "Section1",
    maritalStatus: !minor && i % 3 === 0 ? "MarriedCivilPartnership" : "Single",
    privacy: typeIsPrivate ? "Private" : "Normal",
    publishToLondonGazette: !typeIsPrivate && type !== "DeedOfRelinquishment",
    urgency: urgent ? "Urgent" : "Normal",
    urgencyreason: urgent ? "Synthetic scenario: travel document needed for an imminent journey." : null,
    migratedRecord: false,
    retainPermanently: false,
    ...(minor
      ? {
          minorDateOfBirth: daysBefore(anchor, (8 + (i % 8)) * 365 + 90),
          ageOfMinor: 8 + (i % 8),
          ageOfMinorMonths: 3,
          parents: `Jordan and Casey ${surname}-Sample`
        }
      : {}),
    ...(i % 5 === 2
      ? {
          representativeName: "Taylor Example",
          representativeCompany: "Example Test Solicitors",
          representativeEmail: `representative-${number}@example.invalid`,
          representativeBuildingNoName: "2",
          representativeAddress1: "Synthetic Court",
          representativeTownCity: TOWNS[i % TOWNS.length],
          representativePostcode: POSTCODES[i % POSTCODES.length]
        }
      : {})
  };
  const progress = seedProgress(state, anchor, age, i, minor);
  const witnesses = seedWitnesses(state, i, number, minor);
  const rejected = i === 16;
  return {
    marker,
    state,
    create,
    progress,
    witnesses,
    notes: [
      `[${marker}] SYNTHETIC TEST DATA. ${SCENARIOS[state]} No real applicant, payment or correspondence.`,
      `Scenario history: application received ${received.toISOString().slice(0, 10)}. ${minor ? "Minor application; parental details supplied for testing." : "Identity and name details are fictional."} Milestone dates are simulated; audit timestamps reflect the actual seed run.`
    ],
    ...(referralState
      ? {
          referral: seedReferral(referralState, marker, minor, urgent, typeIsPrivate, rejected)
        }
      : {})
  };
}

function seedProgress(state: CaseState, anchor: Date, age: number, i: number, minor: boolean): CaseWrite {
  const progressed = daysBefore(anchor, Math.max(1, Math.floor(age / 3)));
  const signatureRequested = daysBefore(anchor, Math.max(3, Math.floor(age / 2)));
  const signatureReceived = daysBefore(anchor, Math.max(2, Math.floor(age / 4)));
  const progress: CaseWrite = {};
  switch (state) {
    case "AwaitingFurtherDocs":
      progress.awaitingFurtherDocsInfo = progressed;
      break;
    case "ReadyForMaster":
      progress.dateReadyForMaster = progressed;
      break;
    case "ReferredToMaster":
      progress.dateReadyForMaster = daysBefore(anchor, Math.floor(age / 2));
      progress.dateReferred = progressed;
      break;
    case "AwaitingSignature":
      progress.signatureRequestedDate = signatureRequested;
      break;
    case "AwaitingEnrolment":
    case "Enroled":
      progress.signatureRequestedDate = signatureRequested;
      progress.signatureReceivedDate = signatureReceived;
      if (state === "Enroled") progress.dateEnroled = daysBefore(anchor, 1 + (i % 4));
      break;
    case "Returned":
      progress.dateReturned = progressed;
      progress.returnReason = minor
        ? "Required parental consent was not supplied; application returned with guidance."
        : "Applicant withdrew the application before enrolment.";
      break;
  }
  return progress;
}

function seedWitnesses(state: CaseState, i: number, number: string, minor: boolean): WitnessCreate[] {
  let witnessCount = 2;
  if (state === "Received") witnessCount = i % 3;
  else if (state === "AwaitingFurtherDocs") witnessCount = 1;
  return Array.from({ length: witnessCount }, (_, w) => ({
    witnessName: `${w === 0 ? "Morgan" : "Casey"} Witness-${number}`,
    witnessAddress: `${w + 1} Synthetic Witness Road, ${TOWNS[i % TOWNS.length]}, ${POSTCODES[i % POSTCODES.length]}`,
    witnessOccupation: w === 0 ? "Teacher" : "Engineer",
    declarant: minor && w === 0
  }));
}

function seedReferral(
  state: ReferralState,
  marker: string,
  minor: boolean,
  urgent: boolean,
  typeIsPrivate: boolean,
  rejected: boolean
): NonNullable<SeedCase["referral"]> {
  return {
    state,
    create: {
      reasons: minor ? ["Minor"] : ["NonPublication"],
      notes: `[${marker}] Synthetic ${minor ? "minor application for judicial consideration" : "request to consider non-publication"}.`,
      urgency: urgent ? "Urgent" : "Normal",
      ...(urgent ? { urgencyReason: "Synthetic urgent travel scenario." } : {})
    },
    direction: {
      decision: rejected ? "Rejected" : "Approved",
      publishToGazette: !typeIsPrivate,
      directionsText: rejected
        ? "Non-publication request refused in this synthetic scenario; ask whether the applicant wishes to proceed."
        : "Synthetic direction: the application may proceed subject to the usual signed evidence."
    }
  };
}

function daysBefore(anchor: Date, days: number): Date {
  return new Date(anchor.getTime() - days * 86_400_000);
}

export interface SeedCase {
  marker: string;
  state: CaseState;
  create: CaseWrite;
  progress: CaseWrite;
  witnesses: WitnessCreate[];
  notes: string[];
  referral?: { state: ReferralState; create: ReferralCreate; direction: JudicialDirection };
}
