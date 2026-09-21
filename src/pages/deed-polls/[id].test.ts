import { findDeedPoll, findReferrals, NotFoundError } from "@hmcts/deed-poll";
import type { Request } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../express-doubles.js";
import { GET } from "./[id].js";

// Only the three api calls are replaced. The tabs, header, notes, documents and referrals view models are
// the domain's and tested there, so this exercises the page against the real ones — which is the point: the
// page's job is to assemble them, and a wrong argument order would not show up against mocks.
vi.mock("@hmcts/deed-poll", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hmcts/deed-poll")>();

  return {
    ...actual,
    findDeedPoll: vi.fn(),
    findReferrals: vi.fn(),
    // The rules come over HTTP now, so the call is stubbed — but stubbed with the local matrix, which
    // is the same one api's port answers from. A stub map would make the type-awareness assertions
    // below assertions about the stub.
    getCaseFieldRules: vi.fn(async (query: { type?: string | null; migrated?: boolean; publishToGazette?: boolean }) =>
      actual.getFieldRules(query.type as never, query.migrated, query.publishToGazette)
    )
  };
});

const found = {
  id: "case-1",
  displayReference: "KBDP2026-00001",
  type: "Adult",
  privacy: "Normal",
  state: "Received",
  referToMasterChoice: null,
  migratedRecord: false,
  publishToLondonGazette: true,
  dateReceived: new Date("2026-03-01T00:00:00.000Z"),
  createdOn: new Date("2026-03-01T00:00:00.000Z"),
  modifiedOn: new Date("2026-03-01T00:00:00.000Z"),
  createdBy: "A Caseworker",
  modifiedBy: "A Caseworker",
  notes: [],
  witnesses: [],
  documents: []
};

/** One referral as api answers it, for the tab that is the only subgrid fed by a second call. */
const REFERRAL = {
  id: "ref-1",
  state: "Open",
  reasons: ["Minor"],
  notes: null,
  urgency: "Normal",
  urgencyReason: null,
  migrated: false,
  createdBy: "A Caseworker",
  modifiedBy: "A Caseworker",
  createdOn: new Date("2026-05-13T08:44:00Z"),
  modifiedOn: new Date("2026-05-13T08:44:00Z")
};

function request(admin = false): Request {
  return pageRequest({ params: { id: "case-1" }, admin });
}

/** Every summary-list key rendered across every tab, which is what type rules add to or remove. */
function keysOf(res: { render: ReturnType<typeof vi.fn> }): string[] {
  type Row = { key: string };
  type Block = { kind: string; rows?: Row[]; left?: Row[]; right?: Row[] };
  type Section = { blocks: Block[] };
  const tabs = res.render.mock.calls[0][1].tabs as { sections?: Section[] }[];

  return tabs.flatMap((tab) =>
    (tab.sections ?? []).flatMap((section) =>
      section.blocks.flatMap((block) => [...(block.rows ?? []), ...(block.left ?? []), ...(block.right ?? [])].map((row) => row.key))
    )
  );
}

const response = pageResponse;

describe("case detail page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "test";
    vi.mocked(findDeedPoll).mockResolvedValue(found as never);
    vi.mocked(findReferrals).mockResolvedValue([]);
  });

  it("renders its own template, qualified by directory", async () => {
    const res = response();

    await GET(request(), res);

    expect(res.render.mock.calls[0][0]).toBe("deed-polls/detail");
  });

  it("looks the case up by the id in the path", async () => {
    await GET(request(), response());

    expect(findDeedPoll).toHaveBeenCalledWith("case-1", expect.anything());
  });

  it("makes all three api calls as the signed-in caseworker", async () => {
    const { getCaseFieldRules } = await import("@hmcts/deed-poll");

    await GET(pageRequest({ params: { id: "case-1" }, accessToken: "caseworker-token" }), response());

    expect(findDeedPoll).toHaveBeenCalledWith("case-1", { accessToken: "caseworker-token" });
    expect(getCaseFieldRules).toHaveBeenCalledWith(expect.anything(), { accessToken: "caseworker-token" });
    expect(findReferrals).toHaveBeenCalledWith("case-1", { accessToken: "caseworker-token" });
  });

  it("uses the reference as the page heading, since that is data rather than content", async () => {
    const res = response();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].pageHeading).toBe("KBDP2026-00001");
  });

  it("derives the tabs from the shared field metadata rather than a hand-written list", async () => {
    // The whole reason buildDetailTabs exists: the prototype's read-only page fell six tabs behind
    // its edit form. If the tabs ever come from anywhere else, this count stops matching FORM_TABS.
    const { FORM_TABS } = await import("@hmcts/deed-poll");
    const res = response();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].tabs).toHaveLength(FORM_TABS.length);
  });

  it("shows one referral tab, the retired Referral to Master form having gone", async () => {
    // `referrals-admin-4` decision 1: the Referrals panel is the case's whole referral surface. Two tabs whose
    // ids differ by an "s" was the confusion this removes, so the assertion is on the count and not only on the
    // retired id.
    const res = response();

    await GET(request(), res);

    const tabs = res.render.mock.calls[0][1].tabs as { id: string }[];
    expect(tabs.filter((tab) => tab.id.startsWith("referral")).map((tab) => tab.id)).toEqual(["referrals"]);
  });

  it("passes the retired referral fields as a read-only snapshot when the case holds any", async () => {
    // Decision 2: retiring the fields must not make a migrated business record unreadable. Built from the case,
    // so it is the values that decide whether the section exists — not `migratedRecord`, and not the case's
    // answer to refer-to-Master.
    vi.mocked(findDeedPoll).mockResolvedValue({ ...found, masterName: "Master Smith", masterDecision: "Approved" } as never);
    const res = response();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].legacyReferral.rows).toEqual([
      { key: "Master name", value: "Master Smith" },
      { key: "Master decision", value: "Approved" },
      // Part of the record once there is one, and never the reason there is one — api publishes a Gazette answer
      // for every case, so counting it as evidence headed all of them "Previous system referral information".
      { key: "Publish to London Gazette", value: "Yes" }
    ]);
  });

  it("passes no snapshot for a case that holds none of the retired fields, so the panel renders no section", async () => {
    // `found` carries the Gazette answer api gives every case and nothing else retired, which is the ordinary
    // case and must render no section.
    const res = response();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].legacyReferral).toBeNull();
  });

  it("still passes the snapshot when the referrals read fails, the two being different records", async () => {
    // A failed call to api's referral endpoint says nothing about the retired fields the case itself carries, so
    // the degraded panel must not take the history down with it.
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(findDeedPoll).mockResolvedValue({ ...found, masterName: "Master Smith" } as never);
    vi.mocked(findReferrals).mockRejectedValue(new Error("deed-poll-api call failed (unavailable): nope"));
    const res = response();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].referrals.unavailable).toBe(true);
    expect(res.render.mock.calls[0][1].legacyReferral.rows.map((row: { key: string }) => row.key)).toContain("Master name");
    logged.mockRestore();
  });

  it("passes a case header built from the record", async () => {
    const res = response();

    await GET(request(), res);

    const header = res.render.mock.calls[0][1].header;
    expect(header.entityLabel).toBe("Deed Poll");
    expect(header.rows.length).toBeGreaterThan(0);
  });

  it("passes formatted notes and documents view models, not the raw rows", async () => {
    const res = response();

    await GET(request(), res);

    const model = res.render.mock.calls[0][1];
    expect(model.notes).toHaveProperty("count", 0);
    expect(model.documents).toEqual([]);
  });

  it("passes a referrals view model built from the second call, formatted rather than raw", async () => {
    // Referrals are the one subgrid whose rows are not on the case payload, so the tab is only ever as
    // populated as this call makes it — and the labels are the view model's, not the template's.
    vi.mocked(findReferrals).mockResolvedValue([REFERRAL] as never);
    const res = response();

    await GET(request(), res);

    const referrals = res.render.mock.calls[0][1].referrals;
    expect(referrals.count).toBe(1);
    expect(referrals.rows[0]).toMatchObject({ id: "ref-1", state: "Awaiting a judge", reasons: ["Applicant is a minor"], urgency: "Standard" });
  });

  it("populates the referrals tab from that call, not from the case record", async () => {
    // The merge in the handler is the whole mechanism: `buildDetailTabs` counts `record.referrals`, and the
    // case api returned carries no such property, so a tab that says "None recorded" on a referred case is
    // what forgetting it looks like.
    vi.mocked(findReferrals).mockResolvedValue([REFERRAL] as never);
    const res = response();

    await GET(request(), res);

    const tabs = res.render.mock.calls[0][1].tabs as { id: string; subgrid?: string; empty: boolean }[];
    expect(tabs.find((tab) => tab.id === "referrals")).toMatchObject({ subgrid: "referrals", empty: false, label: "Referrals" });
  });

  it("renders the referrals tab empty on a case that has never been referred", async () => {
    const res = response();

    await GET(request(), res);

    const tabs = res.render.mock.calls[0][1].tabs as { id: string; empty: boolean }[];
    expect(tabs.find((tab) => tab.id === "referrals")?.empty).toBe(true);
    expect(res.render.mock.calls[0][1].referrals).toEqual({ rows: [], count: 0, liveReferral: null, unavailable: false, offerRaise: true });
  });

  it("reports the live referral so the tab can withhold the raise button api would refuse", async () => {
    vi.mocked(findReferrals).mockResolvedValue([REFERRAL] as never);
    const open = response();
    await GET(request(), open);

    vi.mocked(findReferrals).mockResolvedValue([{ ...REFERRAL, state: "Withdrawn" }] as never);
    const closed = response();
    await GET(request(), closed);

    expect(open.render.mock.calls[0][1].referrals.liveReferral).toMatchObject({ id: "ref-1", message: "withJudiciary" });
    expect(closed.render.mock.calls[0][1].referrals.liveReferral).toBeNull();
  });

  it("reports a returned direction as its own live state, so the tab asks for it to be actioned", async () => {
    vi.mocked(findReferrals).mockResolvedValue([{ ...REFERRAL, state: "Decided" }] as never);
    const res = response();

    await GET(request(), res);

    const { referrals, en } = res.render.mock.calls[0][1];
    expect(referrals.liveReferral.message).toBe("directionReceived");
    // The message the template looks up has to exist, or the panel withholds the button and says nothing.
    expect(en.liveReferralMessages[referrals.liveReferral.message]).toContain("mark the referral as actioned");
  });

  it("carries the labels the referrals subgrid renders, since a missing one is a blank column or button", async () => {
    const res = response();

    await GET(request(), res);

    const { en } = res.render.mock.calls[0][1];
    expect(en.referralColumns).toHaveLength(4);
    for (const key of ["raiseReferral", "viewReferralHint", "migratedReferral", "legacyReferralHeading", "legacyReferralIntro"]) {
      expect(en[key], key).toBeTruthy();
    }
    // One message per live state the view model can report — a missing one is a panel with no button and no
    // explanation, which reads as a case whose referral history has gone.
    for (const key of ["withJudiciary", "directionReceived", "stateUnknown"]) {
      expect(en.liveReferralMessages[key], key).toBeTruthy();
    }
  });

  it("treats an admin caller as able to edit privacy", async () => {
    const res = response();

    await GET(request(true), res);

    expect(res.render.mock.calls[0][1].presentation.privacy.editable).toBe(true);
  });

  it("treats a non-admin caller as unable to edit privacy on an existing case", async () => {
    const res = response();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].presentation.privacy.editable).toBe(false);
  });

  it("passes the field rules for the case's own type, so a Minor field is absent from an Adult case", async () => {
    // The rules are what make the read-only page type-aware. Passing the wrong type, or no rules at
    // all, would silently show every field on every case.
    const adult = response();
    await GET(request(), adult);

    vi.mocked(findDeedPoll).mockResolvedValue({ ...found, type: "Minor" } as never);
    const minor = response();
    await GET(request(), minor);

    expect(keysOf(adult)).not.toContain("Age of minor years");
    expect(keysOf(minor)).toContain("Age of minor years");
  });

  it("lets a NotFoundError propagate, so a missing case 404s rather than rendering an empty page", async () => {
    vi.mocked(findDeedPoll).mockRejectedValue(new NotFoundError("DeedPoll nope not found"));
    const res = response();

    await expect(GET(request(), res)).rejects.toThrow(NotFoundError);

    expect(res.render).not.toHaveBeenCalled();
  });

  // The other half of the decision above: the case read stays fatal, the referrals read does not. Both
  // directions are pinned because the whole point is that they differ.
  it("renders the case when the referrals read fails, rather than losing the page to one panel", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(findReferrals).mockRejectedValue(new Error("deed-poll-api call failed (unavailable): nope"));
    const res = response();

    await GET(request(), res);

    expect(res.render).toHaveBeenCalled();
    expect(res.render.mock.calls[0][1].pageHeading).toBe("KBDP2026-00001");
    expect(res.render.mock.calls[0][1].referrals).toEqual({ rows: [], count: 0, liveReferral: null, unavailable: true, offerRaise: false });
    logged.mockRestore();
  });

  // A 404 on referrals is the case that made this worth changing: `classify` maps by status, so it used to
  // become NotFoundError and render "Page not found" for a case sitting right there.
  it("renders the case when the referrals endpoint answers 404, which used to 404 the whole page", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(findReferrals).mockRejectedValue(new NotFoundError("no such thing"));
    const res = response();

    await GET(request(), res);

    expect(res.render).toHaveBeenCalled();
    expect(res.render.mock.calls[0][1].referrals.unavailable).toBe(true);
    logged.mockRestore();
  });

  it("logs a degrading referrals panel without the case id, so the logs say it is happening and not to whom", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(findReferrals).mockRejectedValue(new Error("deed-poll-api call failed (timeout): nope"));

    await GET(request(), response());

    expect(logged).toHaveBeenCalledWith(expect.stringContaining("referrals unavailable"));
    expect(logged).not.toHaveBeenCalledWith(expect.stringContaining("case-1"));
    logged.mockRestore();
  });

  // A mistyped id 404s both calls, since findReferrals answers api's 404 rather than an empty list. Logging
  // the referrals leg before the case leg is known good would file a fault for every wrong URL.
  it("does not log a referrals fault when the case itself is missing, which fails both reads", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(findDeedPoll).mockRejectedValue(new NotFoundError("DeedPoll nope not found"));
    vi.mocked(findReferrals).mockRejectedValue(new NotFoundError("DeedPoll nope not found"));

    await expect(GET(request(), response())).rejects.toThrow(NotFoundError);

    expect(logged).not.toHaveBeenCalled();
    logged.mockRestore();
  });

  it("carries the labels the witnesses subgrid renders, since a missing one is an empty link or button", async () => {
    // The subgrid's entry points are label-driven: the amend link's text is the witness name plus
    // `amendWitnessHint`, and the Add button is `addWitness`. Nothing fails if either goes — the page
    // renders an unreadable link and a blank button.
    const res = response();

    await GET(request(), res);

    const { en } = res.render.mock.calls[0][1];
    for (const key of ["addWitness", "amendWitnessHint", "witnessDeclarant", "unnamedWitness", "yes", "no"]) {
      expect(en[key], key).toBeTruthy();
    }
  });

  it("states the witness count against api's threshold, so the subgrid says how far off enrolment the case is", async () => {
    vi.mocked(findDeedPoll).mockResolvedValue({ ...found, witnesses: [{ id: "witness-1" }] } as never);
    const res = response();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].witnessCount).toBe("1 of 2 witnesses recorded");
  });

  it("states the witness count on a case with none, which is the case that needs it most", async () => {
    const res = response();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].witnessCount).toBe("0 of 2 witnesses recorded");
  });

  it("provides both en and cy content objects with matching keys", async () => {
    const res = response();

    await GET(request(), res);

    const model = res.render.mock.calls[0][1];
    expect(Object.keys(model.en)).toEqual(Object.keys(model.cy));
  });
});
