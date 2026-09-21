import { type JudicialReferralDetail, type JudicialReferralSummary, MASTER_DECISION } from "@hmcts/deed-poll-api-client";
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
      newSurname: "Smyth"
    },
    caseNotes: [],
    ...overrides
  }) as JudicialReferralDetail;

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
    it("should show both names in full, so the part that changed cannot be hidden", () => {
      const view = buildJudicialReferral(detail());

      expect(view.application).toEqual({
        reference: "KBDP2026-00001",
        type: "Minor",
        oldName: "John Peter Smith",
        newName: "John Peter Smyth"
      });
    });

    // The disclosure boundary is api's, and this is what it looks like from here: the four keys
    // `JudicialCaseView` supports and no fifth one to add a fee or a payment reference to.
    it("should render exactly the four application values the judicial DTO supports", () => {
      const view = buildJudicialReferral(detail());

      expect(Object.keys(view.application ?? {})).toEqual(["reference", "type", "oldName", "newName"]);
    });

    it("should join a name that has no middle name without a double space", () => {
      const view = buildJudicialReferral(detail({ application: { newForename: "Jo", newMiddleName: null, newSurname: "Bloggs" } }));

      expect(view.application?.newName).toBe("Jo Bloggs");
    });

    it("should say a name api holds no part of was not provided", () => {
      const view = buildJudicialReferral(detail({ application: { oldForename: null, oldMiddleName: null, oldSurname: null } }));

      expect(view.application?.oldName).toBe("Not provided");
    });

    // A referral is always about an application, so this is a shape the wire type permits rather than a
    // state anyone expects — and the page has to be able to tell it from an application with no name.
    it("should carry no application at all when api sent none, rather than four placeholders", () => {
      const view = buildJudicialReferral(detail({ application: null }));

      expect(view.application).toBeNull();
    });

    it("should offer the claim control on an Open referral and not the direction one", () => {
      const view = buildJudicialReferral(detail({ state: "Open" }));

      expect(view).toMatchObject({ claimable: true, directable: false });
    });

    // api's visibility admits a Claimed referral only to its holder, so Claimed means claimed by this
    // judge and the state alone is the answer.
    it("should offer the direction control on a Claimed referral without asking who holds it", () => {
      const view = buildJudicialReferral(detail({ state: "Claimed", claimedBy: null, claimedAt: new Date("2026-09-04T10:00:00Z") }));

      expect(view).toMatchObject({ claimable: false, directable: true, claimedOn: "4 September 2026 at 11:00am" });
    });

    it("should offer neither control on a Decided referral", () => {
      const view = buildJudicialReferral(detail({ state: "Decided" }));

      expect(view).toMatchObject({ claimable: false, directable: false });
    });

    it("should offer neither control when api published no state", () => {
      const view = buildJudicialReferral(detail({ state: null }));

      expect(view).toMatchObject({ state: "Not recorded", claimable: false, directable: false, stateTagClasses: "govuk-tag--grey" });
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
