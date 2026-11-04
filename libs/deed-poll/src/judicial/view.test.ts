import { type JudicialApplicationView, type JudicialReferralDetail, type JudicialReferralSummary, MASTER_DECISION } from "@hmcts/deed-poll-api-client";
import { describe, expect, it } from "vitest";
import { referralReasonLabels } from "../referrals/referrals-view.js";
import { buildJudicialReferral, buildMyReferralSections, DIRECTION_DECISION_CHOICES } from "./view.js";

const summary = (overrides: Partial<JudicialReferralSummary> = {}): JudicialReferralSummary =>
  ({
    id: "ref-1",
    state: "Open",
    reasons: ["Minor"],
    notes: "Applicant is 15",
    urgency: "Normal",
    urgencyReason: null,
    createdOn: new Date("2026-09-03T08:44:00Z"),
    assignedAt: new Date("2026-09-04T09:00:00Z"),
    ...overrides
  }) as JudicialReferralSummary;

const detail = (overrides: Partial<JudicialReferralDetail> = {}): JudicialReferralDetail =>
  ({
    ...summary(),
    assignedAt: null,
    claimedBy: null,
    claimedAt: null,
    decision: null,
    directionsText: null,
    changesToStandardPublication: null,
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
      documents: []
    },
    ...overrides
  }) as JudicialReferralDetail;

/** Every field `JudicialApplicationView` carries, populated — a minor's application. */
const FULL_APPLICATION: JudicialApplicationView = {
  displayReference: "KBDP2026-00001",
  newForename: "John",
  newMiddleName: "Peter",
  newSurname: "Smyth",
  oldForename: "John",
  oldMiddleName: "Peter",
  oldSurname: "Smith",
  type: "Minor",
  nationality: "BritishCitizen",
  nationalitySection: "Section1",
  nationalitySectionOther: null,
  parents: "Jane Smith and Paul Smith",
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
  describe("buildMyReferralSections", () => {
    // api's MINE_ORDER for one page: urgent undirected oldest first, the other undirected by day, then the directed
    // by day. Three undirected days and two directed ones, with times either side of midnight in London.
    const PAGE: JudicialReferralSummary[] = [
      summary({
        id: "urgent-1",
        state: "Claimed",
        urgency: "Urgent",
        assignedAt: new Date("2026-10-20T09:00:00Z"),
        directionDueBy: new Date("2026-10-27T09:00:00Z")
      }),
      summary({
        id: "urgent-2",
        state: "Claimed",
        urgency: "Urgent",
        assignedAt: new Date("2026-10-22T09:00:00Z"),
        directionDueBy: new Date("2026-10-29T09:00:00Z")
      }),
      summary({ id: "await-1", state: "Claimed", assignedAt: new Date("2026-10-19T08:00:00Z"), directionDueBy: new Date("2026-10-26T08:00:00Z") }),
      summary({ id: "await-2", state: "Claimed", assignedAt: new Date("2026-10-19T22:30:00Z"), directionDueBy: new Date("2026-10-26T22:30:00Z") }),
      summary({ id: "await-3", state: "Claimed", assignedAt: new Date("2026-10-21T10:00:00Z"), directionDueBy: new Date("2026-10-28T10:00:00Z") }),
      summary({ id: "await-4", state: "Claimed", assignedAt: new Date("2026-10-23T10:00:00Z"), directionDueBy: new Date("2026-10-30T10:00:00Z") }),
      summary({
        id: "directed-1",
        state: "Decided",
        urgency: "Urgent",
        assignedAt: new Date("2026-10-15T10:00:00Z"),
        directionDueBy: new Date("2026-10-22T10:00:00Z")
      }),
      summary({ id: "directed-2", state: "Decided", assignedAt: new Date("2026-10-16T10:00:00Z") }),
      summary({ id: "directed-3", state: "Decided", assignedAt: new Date("2026-10-16T12:00:00Z") })
    ];

    const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

    it("should put the urgent undirected referrals first, in api's order", () => {
      const sections = buildMyReferralSections(PAGE);

      expect(ids(sections.urgent)).toEqual(["urgent-1", "urgent-2"]);
    });

    it("should group the other undirected referrals under one heading per London day, oldest day first", () => {
      const sections = buildMyReferralSections(PAGE);

      // 22:30 UTC on the 19th is 23:30 in London, still the 19th.
      expect(sections.awaiting.map((group) => ({ day: group.day, ids: ids(group.rows) }))).toEqual([
        { day: "19-10-26", ids: ["await-1", "await-2"] },
        { day: "21-10-26", ids: ["await-3"] },
        { day: "23-10-26", ids: ["await-4"] }
      ]);
    });

    it("should group the directed referrals by day too, an urgent one among them rather than in Urgent", () => {
      const sections = buildMyReferralSections(PAGE);

      expect(sections.directed.map((group) => ({ day: group.day, ids: ids(group.rows) }))).toEqual([
        { day: "15-10-26", ids: ["directed-1"] },
        { day: "16-10-26", ids: ["directed-2", "directed-3"] }
      ]);
    });

    it("should show each referral once", () => {
      const sections = buildMyReferralSections(PAGE);
      const all = [...sections.urgent, ...[...sections.awaiting, ...sections.directed].flatMap((group) => group.rows)];

      expect(ids(all).sort()).toEqual(ids(PAGE).sort());
    });

    // Plan Fa1 step 4: a referral can wait in the queue for days, so the day it was raised says nothing about when
    // the Master received it.
    it("should group by the day sent, not the day the referral was raised", () => {
      const sections = buildMyReferralSections([
        summary({ id: "a", state: "Claimed", createdOn: new Date("2026-10-19T10:00:00Z"), assignedAt: new Date("2026-10-22T08:00:00Z") }),
        summary({ id: "b", state: "Claimed", createdOn: new Date("2026-10-21T10:00:00Z"), assignedAt: new Date("2026-10-22T09:00:00Z") })
      ]);

      expect(sections.awaiting.map((group) => [group.day, ids(group.rows)])).toEqual([["22-10-26", ["a", "b"]]]);
      expect(sections.awaiting[0].rows[0].sentOn).toBe("22-10-26");
    });

    // api orders such a referral by `coalesce(assignedAt, claimedAt, createdOn)`, and the summary carries no
    // `claimedAt`, so the day it was raised is the nearest date the row has.
    it("should fall back to the day raised for a referral claimed before assignment existed", () => {
      const sections = buildMyReferralSections([summary({ id: "claimed", state: "Claimed", createdOn: new Date("2026-10-19T10:00:00Z"), assignedAt: null })]);

      expect(sections.awaiting[0].day).toBe("19-10-26");
    });

    it("should read the day sent across midnight in London, not in UTC", () => {
      // 23:30 UTC on 20 October is 00:30 on the 21st in London (BST).
      const sections = buildMyReferralSections([summary({ id: "late", state: "Claimed", assignedAt: new Date("2026-10-20T23:30:00Z") })]);

      expect(sections.awaiting[0].day).toBe("21-10-26");
    });

    // A day split by the page boundary: the second page starts mid-day, and grouping that page on its own gives it
    // the day's heading again.
    it("should repeat a day's heading on the next page when the page boundary splits the day", () => {
      const firstPage = buildMyReferralSections(PAGE.slice(0, 4));
      const secondPage = buildMyReferralSections(PAGE.slice(3));

      expect(firstPage.awaiting.map((group) => group.day)).toEqual(["19-10-26"]);
      expect(ids(firstPage.awaiting[0].rows)).toEqual(["await-1", "await-2"]);
      expect(secondPage.awaiting.map((group) => group.day)).toEqual(["19-10-26", "21-10-26", "23-10-26"]);
      expect(ids(secondPage.awaiting[0].rows)).toEqual(["await-2"]);
    });

    it("should not re-sort what api sent, so a broken run shows its day twice", () => {
      const sections = buildMyReferralSections([
        summary({ id: "b", state: "Claimed", assignedAt: new Date("2026-10-21T10:00:00Z") }),
        summary({ id: "a", state: "Claimed", assignedAt: new Date("2026-10-19T10:00:00Z") }),
        summary({ id: "c", state: "Claimed", assignedAt: new Date("2026-10-21T11:00:00Z") })
      ]);

      expect(sections.awaiting.map((group) => group.day)).toEqual(["21-10-26", "19-10-26", "21-10-26"]);
    });

    it("should give the sent date and the due date in dd-mm-yy, and no due date once directed", () => {
      const sections = buildMyReferralSections(PAGE);

      expect(sections.urgent[0]).toEqual({ id: "urgent-1", reasons: ["Applicant is a minor"], sentOn: "20-10-26", directionDueBy: "27-10-26" });
      expect(sections.directed[0].rows[0].directionDueBy).toBeNull();
    });

    it("should say the due date was not recorded when api sent none for an undirected referral", () => {
      const sections = buildMyReferralSections([summary({ state: "Claimed", directionDueBy: null })]);

      expect(sections.awaiting[0].rows[0].directionDueBy).toBe("Not recorded");
    });

    it("should label the reasons in the business's words, the minor details folded in", () => {
      const sections = buildMyReferralSections([summary({ state: "Claimed", reasons: ["Minor", "MinorTransgender", "DomesticAbuse"] })]);

      expect(sections.awaiting[0].rows[0].reasons).toEqual(referralReasonLabels(["Minor", "MinorTransgender", "DomesticAbuse"]));
    });

    it("should be empty, with every section empty, when api sent no rows", () => {
      expect(buildMyReferralSections([])).toEqual({ urgent: [], awaiting: [], directed: [], isEmpty: true });
    });

    it("should not be empty when any section has a row", () => {
      expect(buildMyReferralSections([summary({ state: "Decided" })]).isEmpty).toBe(false);
    });
  });

  describe("buildJudicialReferral", () => {
    it("should show one General group, as the Masters asked", () => {
      const view = buildJudicialReferral(detail({ application: FULL_APPLICATION }));

      expect(view.application?.sections.map((section) => section.label)).toEqual(["General"]);
    });

    // Master Sullivan's feedback (2026-10-27): these eleven, in this order. The formatting is the caseworker page's
    // own (`formatValue`), so a Master and a caseworker read the same words for the same value.
    it("should list the Masters' fields in their order, formatted as the caseworker page formats them", () => {
      const view = buildJudicialReferral(detail({ application: FULL_APPLICATION }));

      expect(view.application?.sections[0].rows).toEqual([
        { key: "New forename", value: "John" },
        { key: "New middle name", value: "Peter" },
        { key: "New surname", value: "Smyth" },
        { key: "Old forename", value: "John" },
        { key: "Old middle name", value: "Peter" },
        { key: "Old surname", value: "Smith" },
        { key: "Type", value: "Minor" },
        { key: "Nationality", value: "British Citizen" },
        { key: "Section", value: "Section 1" },
        { key: "Section (other)", value: "Not provided" },
        { key: "Minor’s parents’ names", value: "Jane Smith and Paul Smith" }
      ]);
    });

    // The same per-type visibility the caseworker page applies, so an adult's application carries no parents row.
    it("should show the minor's parents only on a minor's application", () => {
      const view = buildJudicialReferral(detail({ application: { ...FULL_APPLICATION, type: "Adult", parents: null } }));
      const keys = view.application?.sections.flatMap((section) => section.rows.map((row) => row.key));

      expect(keys).not.toContain("Minor’s parents’ names");
      expect(keys).not.toContain("Parents");
    });

    it("should carry no reference, date, status, contact or witness row", () => {
      const view = buildJudicialReferral(detail({ application: FULL_APPLICATION }));
      const keys = (view.application?.sections ?? []).flatMap((section) => section.rows.map((row) => row.key)).join("|");

      expect(keys).not.toMatch(/reference|date|in person|privacy|status|urgency|email|telephone|postcode|witness|declaration/i);
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

    // A referral is always about an application, so this is a shape the wire type permits rather than a
    // state anyone expects — and the page has to be able to tell it from an application with no name.
    it("should carry no application at all when api sent none, rather than a column of placeholders", () => {
      const view = buildJudicialReferral(detail({ application: null }));

      expect(view.application).toBeNull();
    });

    // There is no claim since api D2: a referral reaches a Master by assignment, and Open is visible to none.
    it("should offer no control on an Open referral", () => {
      const view = buildJudicialReferral(detail({ state: "Open" }));

      expect(view).toMatchObject({ directable: false, changeable: false });
      expect(view).not.toHaveProperty("claimable");
    });

    // api's visibility admits a Claimed referral only to the Master it is assigned to, so the state alone is the answer.
    it("should offer the direction control on a Claimed referral without asking who holds it", () => {
      const view = buildJudicialReferral(detail({ state: "Claimed", claimedBy: null, assignedAt: new Date("2026-09-04T10:00:00Z") }));

      expect(view).toMatchObject({ directable: true, changeable: false, assignedOn: "4 September 2026 at 11:00am" });
    });

    it("should fall back to the claim time for a referral claimed before assignment existed", () => {
      const view = buildJudicialReferral(detail({ state: "Claimed", assignedAt: null, claimedAt: new Date("2026-09-04T10:00:00Z") }));

      expect(view.assignedOn).toBe("4 September 2026 at 11:00am");
    });

    it("should carry no assignment time when api sent neither", () => {
      expect(buildJudicialReferral(detail({ state: "Claimed" })).assignedOn).toBeNull();
    });

    it("should give the direction's due date while one is owed", () => {
      const view = buildJudicialReferral(detail({ state: "Claimed", directionDueBy: new Date("2026-10-30T10:00:00Z") }));

      expect(view.directionDueBy).toBe("30-10-26");
    });

    it.each([["Decided"], ["Closed"], ["Withdrawn"]] as const)("should give no due date on a %s referral", (state) => {
      const view = buildJudicialReferral(detail({ state, directionDueBy: new Date("2026-10-30T10:00:00Z") }));

      expect(view.directionDueBy).toBeNull();
    });

    it("should give no due date when api sent none", () => {
      expect(buildJudicialReferral(detail({ state: "Claimed", directionDueBy: null })).directionDueBy).toBeNull();
    });

    // api's visibility admits a Decided referral only to the judge who directed it, so Decided means directed by
    // this judge, and that judge may change or withdraw the direction until the office closes the referral.
    it("should offer change and withdraw on a Decided referral, and not direct", () => {
      const view = buildJudicialReferral(detail({ state: "Decided" }));

      expect(view).toMatchObject({ directable: false, changeable: true });
    });

    it("should offer neither control when api published no state", () => {
      const view = buildJudicialReferral(detail({ state: null }));

      expect(view).toMatchObject({ state: "Not recorded", directable: false, changeable: false, stateTagClasses: "govuk-tag--grey" });
    });

    it("should tag the state so the lifecycle is scannable, with the word printed alongside", () => {
      const view = buildJudicialReferral(detail({ state: "Claimed" }));

      expect(view).toMatchObject({ state: "Claimed", stateTagClasses: "govuk-tag--purple" });
    });

    it("should carry no case notes, witnesses or previous-system record, as the Masters asked", () => {
      const view = buildJudicialReferral(detail({ application: FULL_APPLICATION }));

      expect(view).not.toHaveProperty("caseNotes");
      expect(view.application).not.toHaveProperty("witnesses");
      expect(view.application).not.toHaveProperty("previousReferral");
    });

    it("should hold no direction while a referral is awaiting one", () => {
      const view = buildJudicialReferral(detail({ state: "Open" }));

      expect(view.direction).toBeNull();
    });

    // Read back off api's own fields, which is how a judge re-reads a referral they have already directed.
    // `changesToStandardPublication` stays a boolean so the page's own en/cy owns "Yes" and "No".
    it("should render the direction api recorded, keeping the Gazette answer a boolean", () => {
      const view = buildJudicialReferral(
        detail({
          state: "Decided",
          decision: "Approved",
          directionsText: "Satisfied the change is in the child's interests",
          changesToStandardPublication: true,
          decisionDate: new Date("2026-09-05T16:05:00Z")
        })
      );

      expect(view.direction).toEqual({
        decision: "Approved",
        directionsText: "Satisfied the change is in the child's interests",
        changesToStandardPublication: true,
        decidedOn: "5 September 2026 at 5:05pm"
      });
    });

    it("should say an approval carried no directions rather than leaving the row blank", () => {
      const view = buildJudicialReferral(detail({ state: "Decided", decision: "Approved", directionsText: null }));

      expect(view.direction).toMatchObject({ directionsText: "Not provided", changesToStandardPublication: null });
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
