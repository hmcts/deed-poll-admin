import { type JudicialApplicationView, type JudicialReferralDetail, type JudicialReferralSummary, MASTER_DECISION } from "@hmcts/deed-poll-api-client";
import { describe, expect, it } from "vitest";
import { buildJudicialReferral, buildMyReferralRows, buildPoolRows, DIRECTION_DECISION_CHOICES } from "./view.js";

const summary = (overrides: Partial<JudicialReferralSummary> = {}): JudicialReferralSummary =>
  ({
    id: "ref-1",
    state: "Open",
    reasons: ["Minor"],
    notes: "Applicant is 15",
    urgency: "Normal",
    urgencyReason: null,
    createdOn: new Date("2026-09-03T08:44:00Z"),
    ...overrides
  }) as JudicialReferralSummary;

const detail = (overrides: Partial<JudicialReferralDetail> = {}): JudicialReferralDetail =>
  ({
    ...summary(),
    claimedBy: null,
    claimedAt: null,
    decision: null,
    directionsText: null,
    publishToGazette: null,
    decisionDate: null,
    decidedBy: null,
    application: {
      displayReference: "KBDP2026-00001",
      type: "Minor",
      oldForename: "John",
      oldMiddleName: "Peter",
      oldSurname: "Smith",
      newForename: "John",
      newMiddleName: "Peter",
      newSurname: "Smyth",
      witnesses: [],
      documents: []
    },
    caseNotes: [],
    ...overrides
  }) as JudicialReferralDetail;

/** Every field `JudicialApplicationView` carries, populated — a minor's application, marked private. */
const FULL_APPLICATION: JudicialApplicationView = {
  displayReference: "KBDP2026-00001",
  type: "Minor",
  state: "ReferredToMaster",
  privacy: "Private",
  urgency: "Urgent",
  urgencyreason: "Hearing on Friday",
  inPerson: false,
  maritalStatus: "Single",
  oldForename: "John",
  oldMiddleName: "Peter",
  oldSurname: "Smith",
  newForename: "John",
  newMiddleName: "Peter",
  newSurname: "Smyth",
  applicantBuildingNoName: "1",
  applicantEmail: "applicant@example.com",
  applicantTelephone: "01632 960001",
  applicantTownCity: "Leeds",
  applicantPostcode: "LS1 1AA",
  representativeName: "A Solicitor",
  representativeBuildingNoName: "2",
  representativeCompany: "Solicitors LLP",
  representativeEmail: "rep@example.com",
  representativeTelephone: "01632 960002",
  representativeTownCity: "York",
  representativePostcode: "YO1 1AA",
  ageOfMinor: 15,
  ageOfMinorMonths: 6,
  minorDateOfBirth: new Date("2011-03-14T00:00:00Z"),
  parents: "Jane Smith and Paul Smith",
  nationality: "BritishCitizen",
  nationalitySection: "Section1",
  nationalitySectionOther: null,
  dateOfDeclaration: new Date("2026-08-20T00:00:00Z"),
  dateOfApplication: new Date("2026-09-01T00:00:00Z"),
  dateReceived: new Date("2026-09-02T00:00:00Z"),
  awaitingFurtherDocsInfo: null,
  referToMasterChoice: null,
  masterName: null,
  masterDirections: null,
  masterDecision: null,
  masterDateOfDecision: null,
  dateDecisionDirectionsReceived: null,
  referralNotes: null,
  witnesses: [
    { witnessName: "Mary Jones", witnessAddress: "1 High Street, Leeds", witnessOccupation: "Solicitor", declarant: true },
    { witnessName: null, witnessAddress: null, witnessOccupation: null, declarant: false }
  ],
  documents: [
    {
      id: "doc-1",
      name: "birth-certificate.pdf",
      documentType: "Birth certificate",
      direction: "Incoming",
      mimeType: "application/pdf",
      sizeBytes: 245_760,
      uploadedOn: new Date("2026-09-02T10:15:00Z")
    },
    { id: "doc-2", name: null, documentType: null, direction: null, mimeType: null, sizeBytes: null, uploadedOn: null }
  ]
};

describe("judicial/view", () => {
  describe("buildPoolRows", () => {
    it("should label each reason in the business's words, the same words the caseworker chose them by", () => {
      const rows = buildPoolRows([summary({ reasons: ["Minor", "DomesticAbuse"] })]);

      expect(rows[0].reasons).toEqual(["Applicant is a minor", "Domestic abuse considerations"]);
    });

    // api publishes the column as plain strings, so a backfilled row may hold a member the enum no longer
    // lists. Printing it beats dropping it: a reason missing from a referral a judge is directing is worse
    // than an unfamiliar word on it.
    it("should print an unrecognised reason as api stored it", () => {
      const rows = buildPoolRows([summary({ reasons: ["SomethingNew"] })]);

      expect(rows[0].reasons).toEqual(["SomethingNew"]);
    });

    it("should label a referral's Normal urgency 'Standard', as the business words it on a referral", () => {
      const rows = buildPoolRows([summary({ urgency: "Normal" })]);

      expect(rows[0]).toMatchObject({ urgency: "Standard", isUrgent: false });
    });

    it("should mark an urgent referral for the tag while still printing the word", () => {
      const rows = buildPoolRows([summary({ urgency: "Urgent" })]);

      expect(rows[0]).toMatchObject({ urgency: "Urgent", isUrgent: true });
    });

    it("should show the wait as the date api recorded, not an age in days", () => {
      const rows = buildPoolRows([summary({ createdOn: new Date("2026-09-03T08:44:00Z") })]);

      expect(rows[0].waitingSince).toBe("3 September 2026 at 9:44am");
    });

    // The pool's order is api's — urgent first, then longest-waiting (decision 3). A row builder that
    // sorted would be this app deciding the queue.
    it("should keep api's order exactly", () => {
      const rows = buildPoolRows([summary({ id: "urgent", urgency: "Urgent" }), summary({ id: "older", urgency: "Normal" })]);

      expect(rows.map((row) => row.id)).toEqual(["urgent", "older"]);
    });

    // No case fields at all: api's pool row carries none, so there is nothing about the application for a
    // page to render even by accident — decision 2, and the reason no judicial URL names a case.
    it("should carry no application field, because the pool row is about the referral only", () => {
      const rows = buildPoolRows([summary()]);

      expect(Object.keys(rows[0])).toEqual(["id", "reasons", "urgency", "isUrgent", "waitingSince"]);
    });

    // The reason behind an urgency is on the referral view, not in the queue: the pool's four columns are what a
    // judge chooses a row by, and a field the row carried but no template read would be a disclosure nobody had
    // decided on, sitting one `{{ }}` away from the page.
    it("should carry no urgency reason, because the pool has no column for one", () => {
      const rows = buildPoolRows([summary({ urgencyReason: "Hearing on Friday" })]);

      expect(rows[0]).not.toHaveProperty("urgencyReason");
    });
  });

  describe("buildMyReferralRows", () => {
    it("should word the two states as what the judge still owes and what they have answered", () => {
      const rows = buildMyReferralRows([summary({ id: "claimed", state: "Claimed" }), summary({ id: "decided", state: "Decided" })]);

      // The judge's side of the same fact, and deliberately not `REFERRAL_STATE_LABEL`'s: "Direction received"
      // tells a caseworker there is something to carry out, which is the wrong sentence for the judge who wrote it.
      expect(rows.map((row) => row.status)).toEqual(["Direction needed", "Direction recorded"]);
    });

    it("should carry a tag colour per state while still printing the status", () => {
      const rows = buildMyReferralRows([summary({ state: "Claimed" }), summary({ state: "Decided" })]);

      expect(rows[0]).toMatchObject({ status: "Direction needed", statusTagClasses: "govuk-tag--purple" });
      expect(rows[1]).toMatchObject({ status: "Direction recorded", statusTagClasses: "govuk-tag--green" });
    });

    it.each([["Open"], ["Withdrawn"], ["Closed"], [null]] as const)("should not invent a judicial word for %s, which this list cannot contain", (state) => {
      // api's membership rule is the two states above, so any of these is api contradicting its own filter. A
      // wording for one would be a label for a row that must not exist, and api's raw member would put the wire's
      // vocabulary on a judge's screen.
      const rows = buildMyReferralRows([summary({ state })]);

      expect(rows[0].status).toBe("Not recorded");
    });

    it("should label the reasons and the urgency in the same words the pool's rows use", () => {
      const rows = buildMyReferralRows([summary({ reasons: ["Minor", "DomesticAbuse"], state: "Claimed", urgency: "Normal" })]);

      // Shared maps, not a second wording: a judge reading one set of words in the pool and another on their own
      // list would be reading two names for the reasons one caseworker picked.
      expect(rows[0]).toMatchObject({
        reasons: ["Applicant is a minor", "Domestic abuse considerations"],
        urgency: "Standard",
        isUrgent: false
      });
    });

    it("should mark an urgent referral for the tag while still printing the word", () => {
      const rows = buildMyReferralRows([summary({ state: "Claimed", urgency: "Urgent" })]);

      expect(rows[0]).toMatchObject({ urgency: "Urgent", isUrgent: true });
    });

    it("should show the date the referral was raised, not an age in days", () => {
      const rows = buildMyReferralRows([summary({ state: "Claimed", createdOn: new Date("2026-09-03T08:44:00Z") })]);

      expect(rows[0].raisedOn).toBe("3 September 2026 at 9:44am");
    });

    it("should keep api's order exactly, because membership and order are both api's", () => {
      // Decision 2: unfinished work first, then the pool's keys. A view model that sorted — by state, by date, by
      // anything — would make the page disagree with its own pagination.
      const rows = buildMyReferralRows([
        summary({ id: "claimed-urgent", state: "Claimed", urgency: "Urgent" }),
        summary({ id: "claimed-older", state: "Claimed" }),
        summary({ id: "decided", state: "Decided" })
      ]);

      expect(rows.map((row) => row.id)).toEqual(["claimed-urgent", "claimed-older", "decided"]);
    });

    it("should drop no row, because the list's membership is api's and not this app's", () => {
      // The same rule from the other side: a row this app filtered out would be work a judge holds and cannot see.
      const rows = buildMyReferralRows([
        summary({ id: "a", state: "Claimed" }),
        summary({ id: "b", state: "Decided" }),
        summary({ id: "c", state: "Claimed" })
      ]);

      expect(rows.map((row) => row.id)).toEqual(["a", "b", "c"]);
    });

    it("should carry no application field and no urgency reason, since the summary carries neither", () => {
      // Decision 3, asserted as the exact key set: a field the row carried but no template read would still be a
      // disclosure nobody had decided on, one `{{ }}` away from the page — and enriching one would mean a call per
      // row over a worklist.
      const rows = buildMyReferralRows([summary({ state: "Claimed", urgencyReason: "Hearing on Friday" })]);

      expect(Object.keys(rows[0])).toEqual(["id", "status", "statusTagClasses", "reasons", "urgency", "isUrgent", "raisedOn"]);
    });

    it("should build nothing from an empty page, rather than a placeholder row", () => {
      expect(buildMyReferralRows([])).toEqual([]);
    });
  });

  describe("buildJudicialReferral", () => {
    it("should group the application's details under the caseworker detail page's section names", () => {
      const view = buildJudicialReferral(detail({ application: FULL_APPLICATION }));

      expect(view.application?.sections.map((section) => section.label)).toEqual([
        "General",
        "Names",
        "Applicant address and contact details",
        "Representative address and contact details",
        "Nationality",
        "Declarations"
      ]);
    });

    // The labels and the formatting are the caseworker page's own (`FIELD_BY_NAME` through `formatValue`), so a
    // judge and a caseworker reading one case read the same words for the same value.
    it("should label and format every field as the caseworker detail page does", () => {
      const view = buildJudicialReferral(detail({ application: FULL_APPLICATION }));
      const rows = Object.fromEntries((view.application?.sections ?? []).flatMap((section) => section.rows.map((row) => [row.key, row.value])));

      expect(rows).toMatchObject({
        "Display reference": "KBDP2026-00001",
        "Date of application": "1 September 2026",
        "In person": "No",
        Type: "Minor",
        "Marital status": "Single",
        "Minor's date of birth": "14 March 2011",
        "Age of minor years": "15",
        "Age of minor months": "6",
        Privacy: "Private",
        Urgency: "Urgent",
        "Urgency reason": "Hearing on Friday",
        "New surname": "Smyth",
        "Old surname": "Smith",
        Nationality: "British Citizen",
        Section: "Section 1",
        "Date of declaration": "20 August 2026"
      });
    });

    // 37 of `JudicialApplicationView`'s 46 properties are case fields; the other nine are the two collections
    // and the seven previous-system referral fields, which have panels of their own. A field api adds to the
    // view reaches this page only by an edit to `APPLICATION_SECTIONS`.
    it("should render every case field the judicial view carries, for a minor's application", () => {
      const view = buildJudicialReferral(detail({ application: FULL_APPLICATION }));

      expect(view.application?.sections.flatMap((section) => section.rows)).toHaveLength(37);
    });

    // Decision: private cases show in full. Nothing here reads `privacy` other than to print it.
    it("should render a private case in full rather than withholding any field", () => {
      const normal = buildJudicialReferral(detail({ application: { ...FULL_APPLICATION, privacy: "Normal" } }));
      const isPrivate = buildJudicialReferral(detail({ application: { ...FULL_APPLICATION, privacy: "Private" } }));

      expect(isPrivate.application?.sections.flatMap((section) => section.rows.map((row) => row.key))).toEqual(
        normal.application?.sections.flatMap((section) => section.rows.map((row) => row.key))
      );
    });

    // The same per-type visibility the caseworker page applies, so an adult's application carries no minor rows.
    it("should leave out the fields the application's type does not use", () => {
      const view = buildJudicialReferral(detail({ application: { ...FULL_APPLICATION, type: "Adult" } }));
      const keys = view.application?.sections.flatMap((section) => section.rows.map((row) => row.key));

      expect(keys).not.toContain("Minor's date of birth");
      expect(keys).not.toContain("Parents");
    });

    it("should say a field api holds no value for was not provided, keeping its row", () => {
      const view = buildJudicialReferral(detail({ application: { ...FULL_APPLICATION, representativeName: null } }));
      const representative = view.application?.sections.find((section) => section.label === "Representative address and contact details");

      expect(representative?.rows).toContainEqual({ key: "Name", value: "Not provided" });
    });

    it("should carry no payment, refund, fee or case-id label", () => {
      const view = buildJudicialReferral(detail({ application: FULL_APPLICATION }));
      const keys = (view.application?.sections ?? []).flatMap((section) => section.rows.map((row) => row.key)).join("|");

      expect(keys).not.toMatch(/payment|refund|fee|reference number|case id/i);
    });

    it("should carry the reference on its own, for the page's caption", () => {
      const view = buildJudicialReferral(detail({ application: FULL_APPLICATION }));

      expect(view.application?.reference).toBe("KBDP2026-00001");
    });

    it("should carry the witnesses as api sent them, with the declarant still a boolean", () => {
      const view = buildJudicialReferral(detail({ application: FULL_APPLICATION }));

      expect(view.application?.witnesses).toEqual([
        { name: "Mary Jones", address: "1 High Street, Leeds", occupation: "Solicitor", declarant: true },
        { name: "Not provided", address: "Not provided", occupation: "Not provided", declarant: false }
      ]);
    });

    it("should carry each document's id, name, type, upload date and size", () => {
      const view = buildJudicialReferral(detail({ application: FULL_APPLICATION }));

      expect(view.application?.documents).toEqual([
        { id: "doc-1", name: "birth-certificate.pdf", type: "Birth certificate", uploadedOn: "2 September 2026", size: "240 KB" },
        { id: "doc-2", name: "Not provided", type: "Not provided", uploadedOn: "Not provided", size: "Not provided" }
      ]);
    });

    it.each([
      [512, "512 bytes"],
      [2048, "2 KB"],
      [3_250_000, "3.1 MB"]
    ])("should give a %d-byte document's size as %s", (sizeBytes, size) => {
      const view = buildJudicialReferral(detail({ application: { ...FULL_APPLICATION, documents: [{ id: "doc-1", sizeBytes }] } }));

      expect(view.application?.documents[0].size).toBe(size);
    });

    it("should carry the previous system's referral record only when it holds something", () => {
      const withRecord = buildJudicialReferral(detail({ application: { ...FULL_APPLICATION, masterName: "Master Smith", masterDecision: "Approved" } }));
      const without = buildJudicialReferral(detail({ application: FULL_APPLICATION }));

      expect(withRecord.application?.previousReferral?.rows).toEqual([
        { key: "Master name", value: "Master Smith" },
        { key: "Master decision", value: "Approved" }
      ]);
      expect(without.application?.previousReferral).toBeNull();
    });

    // A referral is always about an application, so this is a shape the wire type permits rather than a
    // state anyone expects — and the page has to be able to tell it from an application with no name.
    it("should carry no application at all when api sent none, rather than a column of placeholders", () => {
      const view = buildJudicialReferral(detail({ application: null }));

      expect(view.application).toBeNull();
    });

    it("should offer the claim control on an Open referral and not the direction one", () => {
      const view = buildJudicialReferral(detail({ state: "Open" }));

      expect(view).toMatchObject({ claimable: true, directable: false, changeable: false });
    });

    // api's visibility admits a Claimed referral only to its holder, so Claimed means claimed by this
    // judge and the state alone is the answer.
    it("should offer the direction control on a Claimed referral without asking who holds it", () => {
      const view = buildJudicialReferral(detail({ state: "Claimed", claimedBy: null, claimedAt: new Date("2026-09-04T10:00:00Z") }));

      expect(view).toMatchObject({ claimable: false, directable: true, changeable: false, claimedOn: "4 September 2026 at 11:00am" });
    });

    // api's visibility admits a Decided referral only to the judge who directed it, so Decided means directed by
    // this judge, and that judge may change or withdraw the direction until the office closes the referral.
    it("should offer change and withdraw on a Decided referral, and neither claim nor direct", () => {
      const view = buildJudicialReferral(detail({ state: "Decided" }));

      expect(view).toMatchObject({ claimable: false, directable: false, changeable: true });
    });

    it("should offer neither control when api published no state", () => {
      const view = buildJudicialReferral(detail({ state: null }));

      expect(view).toMatchObject({ state: "Not recorded", claimable: false, directable: false, changeable: false, stateTagClasses: "govuk-tag--grey" });
    });

    // Decision 5: which list the referral is on, which is the way back to it. Keyed on the state api published
    // rather than on where the judge came from, because claiming moves it from one list to the other.
    it("should place an Open referral on the shared pool and not on the judge's own list", () => {
      const view = buildJudicialReferral(detail({ state: "Open" }));

      expect(view.isOnMyList).toBe(false);
    });

    it.each([["Claimed"], ["Decided"]] as const)("should place a %s referral on the judge's own list", (state) => {
      const view = buildJudicialReferral(detail({ state }));

      expect(view.isOnMyList).toBe(true);
    });

    // The same two states `buildMyReferralRows` words, from one predicate: a referral whose detail page links to a
    // list that would not have it is the failure this plan exists to fix, arriving from the other direction.
    it.each([["Withdrawn"], ["Closed"], [null]] as const)("should place a %s referral on neither judge's list", (state) => {
      const view = buildJudicialReferral(detail({ state }));

      expect(view.isOnMyList).toBe(false);
    });

    it("should tag the state so the lifecycle is scannable, with the word printed alongside", () => {
      const view = buildJudicialReferral(detail({ state: "Claimed" }));

      expect(view).toMatchObject({ state: "Claimed", stateTagClasses: "govuk-tag--purple" });
    });

    it("should carry the application's timeline read-only, with no note id to link to", () => {
      const view = buildJudicialReferral(
        detail({ caseNotes: [{ note: "Chased the declarant", createdBy: "A Caseworker", createdOn: new Date("2026-09-02T14:30:00Z") }] })
      );

      expect(view.caseNotes).toEqual([{ note: "Chased the declarant", createdBy: "A Caseworker", createdOn: "2 September 2026 at 3:30pm" }]);
    });

    it("should say an unattributed note was not recorded rather than dropping the note", () => {
      const view = buildJudicialReferral(detail({ caseNotes: [{ note: "Migrated", createdBy: null, createdOn: null }] }));

      expect(view.caseNotes).toEqual([{ note: "Migrated", createdBy: "Not recorded", createdOn: "Not recorded" }]);
    });

    it("should carry no timeline when api sent none", () => {
      const view = buildJudicialReferral(detail({ caseNotes: undefined }));

      expect(view.caseNotes).toEqual([]);
    });

    it("should hold no direction while a referral is awaiting one", () => {
      const view = buildJudicialReferral(detail({ state: "Open" }));

      expect(view.direction).toBeNull();
    });

    // Read back off api's own fields, which is how a judge re-reads a referral they have already directed.
    // `publishToGazette` stays a boolean so the page's own en/cy owns "Yes" and "No".
    it("should render the direction api recorded, keeping the Gazette answer a boolean", () => {
      const view = buildJudicialReferral(
        detail({
          state: "Decided",
          decision: "Approved",
          directionsText: "Satisfied the change is in the child's interests",
          publishToGazette: false,
          decisionDate: new Date("2026-09-05T16:05:00Z")
        })
      );

      expect(view.direction).toEqual({
        decision: "Approved",
        directionsText: "Satisfied the change is in the child's interests",
        publishToGazette: false,
        decidedOn: "5 September 2026 at 5:05pm"
      });
    });

    it("should say an approval carried no directions rather than leaving the row blank", () => {
      const view = buildJudicialReferral(detail({ state: "Decided", decision: "Approved", directionsText: null }));

      expect(view.direction).toMatchObject({ directionsText: "Not provided", publishToGazette: null });
    });
  });
});

describe("DIRECTION_DECISION_CHOICES", () => {
  // Built from the client's member array rather than typed out, so a member added at api's end reaches the
  // direction form without an edit here.
  it("should offer every decision api publishes, in its order", () => {
    expect(DIRECTION_DECISION_CHOICES).toEqual([
      { value: "Approved", text: "Approved" },
      { value: "Rejected", text: "Rejected" }
    ]);
  });

  // api-2 decision 5 reuses `MasterDecision` rather than minting a judicial enum, which is what lets a direction
  // recorded here be read back off the case's own decision column.
  it("should carry the same members the case's own decision column does", () => {
    expect(DIRECTION_DECISION_CHOICES.map((choice) => choice.value)).toEqual(MASTER_DECISION as unknown as string[]);
  });
});
