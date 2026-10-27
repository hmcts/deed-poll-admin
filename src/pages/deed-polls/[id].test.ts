import { findCaseEmails, findDeedPoll, findReferrals, getCaseFieldRules, NotFoundError } from "@hmcts/deed-poll";
import type { Request } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../express-doubles.js";
import { GET } from "./[id].js";

// Only the four api calls are replaced. The tabs, header, notes, documents, referrals and emails view models
// are the domain's and tested there, so this exercises the page against the real ones — which is the point:
// the page's job is to assemble them, and a wrong argument order would not show up against mocks.
vi.mock("@hmcts/deed-poll", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hmcts/deed-poll")>();

  return {
    ...actual,
    findDeedPoll: vi.fn(),
    findReferrals: vi.fn(),
    findCaseEmails: vi.fn(),
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

/** One slot set, as api publishes it per template — `snake_case` names and all. */
const SLOTS = [
  { name: "judges_reason", required: true, maxLength: 4000 },
  { name: "additional_notes", required: false, maxLength: 1000 }
];

/** The emails payload, which answers the tab, the compose form and the per-email page in one read. */
const CASE_EMAILS = {
  availability: [{ template: "application-rejected", applicable: true, reason: null, provisioned: true, slots: SLOTS }],
  history: [],
  slotDefaults: [{ template: "application-rejected", fields: { judges_reason: "The evidence does not establish identity." } }]
};

/** One email api has accepted, for the tab fed by the fourth call. */
const SENT_EMAIL = {
  id: "email-1",
  template: "application-rejected",
  templateName: "Application refused",
  subject: "Your application has been refused",
  body: "Dear applicant,\n\nThe Master has refused your application.",
  recipient: "applicant@example.com",
  notifyState: "Sent" as const,
  failureReason: null,
  createdBy: "caseworker@example.com",
  createdOn: new Date("2026-03-18T11:05:00Z"),
  documents: []
};

function request(teamLeader = false): Request {
  return pageRequest({ params: { id: "case-1" }, teamLeader });
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

/** A promise the test settles by hand, so ordering is asserted against explicit barriers rather than timings. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * The same promise as a bare thenable, so a mock can return it without being the thing that observes it: vitest's
 * spy attaches its own handlers to any returned `Promise` instance to record `settledResults`, which would hide a
 * rejection the handler never handles. `await` and `Promise.allSettled` consume a thenable exactly as a promise.
 */
function unwatched<T>(promise: Promise<T>): Promise<T> {
  // biome-ignore lint/suspicious/noThenProperty: a thenable that is not a Promise is the point — see above.
  return { then: promise.then.bind(promise) } as unknown as Promise<T>;
}

/** A read that fails at call time, returned without the spy observing it — see `unwatched`. */
const failingRead = (error: Error) => () => unwatched(Promise.reject(error));

/** Lets every queued microtask run: a macrotask turn is reached only once the microtask queue is empty. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("case detail page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "test";
    vi.mocked(findDeedPoll).mockResolvedValue(found as never);
    vi.mocked(findReferrals).mockResolvedValue([]);
    vi.mocked(findCaseEmails).mockResolvedValue(CASE_EMAILS as never);
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

  it("makes all four api calls as the signed-in caseworker", async () => {
    const { getCaseFieldRules } = await import("@hmcts/deed-poll");

    await GET(pageRequest({ params: { id: "case-1" }, accessToken: "caseworker-token" }), response());

    expect(findDeedPoll).toHaveBeenCalledWith("case-1", { accessToken: "caseworker-token" });
    expect(getCaseFieldRules).toHaveBeenCalledWith(expect.anything(), { accessToken: "caseworker-token" });
    expect(findReferrals).toHaveBeenCalledWith("case-1", { accessToken: "caseworker-token" });
    expect(findCaseEmails).toHaveBeenCalledWith("case-1", { accessToken: "caseworker-token" });
  });

  describe("read scheduling", () => {
    // The rules depend on the case alone, so a slow referrals or emails read must not hold them back: the page
    // costs max(case + rules, referrals, emails) rather than max(case, referrals, emails) + rules.
    it("starts the field rules once the case resolves, while the referrals read is still pending", async () => {
      const referrals = deferred<never[]>();
      vi.mocked(findReferrals).mockReturnValue(referrals.promise);
      const res = response();

      const handled = GET(request(), res);
      await settle();
      const rulesBeforeReferrals = vi.mocked(getCaseFieldRules).mock.calls.length;
      referrals.resolve([]);
      await handled;

      expect(rulesBeforeReferrals).toBe(1);
      expect(res.render).toHaveBeenCalledTimes(1);
    });

    it("starts the field rules once the case resolves, while the emails read is still pending", async () => {
      const emails = deferred<typeof CASE_EMAILS>();
      vi.mocked(findCaseEmails).mockReturnValue(emails.promise as never);
      const res = response();

      const handled = GET(request(), res);
      await settle();
      const rulesBeforeEmails = vi.mocked(getCaseFieldRules).mock.calls.length;
      emails.resolve(CASE_EMAILS);
      await handled;

      expect(rulesBeforeEmails).toBe(1);
      expect(res.render).toHaveBeenCalledTimes(1);
    });

    it("starts every independent read at once, and the rules only after the case resolves", async () => {
      const deedPoll = deferred<typeof found>();
      vi.mocked(findDeedPoll).mockReturnValue(deedPoll.promise as never);
      const res = response();

      const handled = GET(request(), res);
      await settle();
      const startedBeforeCase = {
        case: vi.mocked(findDeedPoll).mock.calls.length,
        referrals: vi.mocked(findReferrals).mock.calls.length,
        emails: vi.mocked(findCaseEmails).mock.calls.length,
        rules: vi.mocked(getCaseFieldRules).mock.calls.length
      };
      deedPoll.resolve(found);
      await handled;

      expect(startedBeforeCase).toEqual({ case: 1, referrals: 1, emails: 1, rules: 0 });
      expect(getCaseFieldRules).toHaveBeenCalledTimes(1);
    });

    it("reads the case and the rules once each, with the caller and the case's own rule inputs", async () => {
      vi.mocked(findDeedPoll).mockResolvedValue({ ...found, type: "Minor", migratedRecord: true, publishToLondonGazette: false } as never);
      const referrals = deferred<never[]>();
      vi.mocked(findReferrals).mockReturnValue(referrals.promise);

      const handled = GET(pageRequest({ params: { id: "case-1" }, accessToken: "caseworker-token" }), response());
      await settle();
      referrals.resolve([]);
      await handled;

      expect(findDeedPoll).toHaveBeenCalledTimes(1);
      expect(getCaseFieldRules).toHaveBeenCalledTimes(1);
      expect(getCaseFieldRules).toHaveBeenCalledWith({ type: "Minor", migrated: true, publishToGazette: false }, { accessToken: "caseworker-token" });
    });

    it("renders the same model whichever optional read finishes last", async () => {
      const inOrder = response();
      await GET(request(), inOrder);

      const referrals = deferred<never[]>();
      const emails = deferred<typeof CASE_EMAILS>();
      vi.mocked(findReferrals).mockReturnValue(referrals.promise);
      vi.mocked(findCaseEmails).mockReturnValue(emails.promise as never);
      const delayed = response();
      const handled = GET(request(), delayed);
      await settle();
      emails.resolve(CASE_EMAILS);
      await settle();
      referrals.resolve([]);
      await handled;

      expect(delayed.render.mock.calls[0]).toEqual(inOrder.render.mock.calls[0]);
    });

    it("renders the same model when the field rules finish after both optional reads", async () => {
      const { getFieldRules } = await vi.importActual<typeof import("@hmcts/deed-poll")>("@hmcts/deed-poll");
      const inOrder = response();
      await GET(request(), inOrder);

      const rules = deferred<Awaited<ReturnType<typeof getCaseFieldRules>>>();
      vi.mocked(getCaseFieldRules).mockReturnValueOnce(rules.promise);
      const delayed = response();
      const handled = GET(request(), delayed);
      await settle();
      expect(delayed.render).not.toHaveBeenCalled();
      rules.resolve(getFieldRules("Adult" as never, false, true));
      await handled;

      expect(delayed.render.mock.calls[0]).toEqual(inOrder.render.mock.calls[0]);
    });
  });

  describe("read failures", () => {
    // Every started read is observed even when the page fails, so a process-level listener is the only thing
    // that would see a stray rejection. Collected per test and removed after, so no listener outlives one.
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    let logged: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      unhandled.length = 0;
      process.on("unhandledRejection", onUnhandled);
      logged = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      process.off("unhandledRejection", onUnhandled);
      logged.mockRestore();
      // Drops a one-shot rules stub a regressed handler never consumed, so it cannot reach the next test.
      vi.mocked(getCaseFieldRules).mockReset();
    });

    it("rejects with the case read's own error while the optional reads are pending, and reads no rules", async () => {
      const failure = new NotFoundError("DeedPoll nope not found");
      const deedPoll = deferred<typeof found>();
      const referrals = deferred<never[]>();
      const emails = deferred<typeof CASE_EMAILS>();
      vi.mocked(findDeedPoll).mockReturnValue(unwatched(deedPoll.promise) as never);
      vi.mocked(findReferrals).mockReturnValue(unwatched(referrals.promise));
      vi.mocked(findCaseEmails).mockReturnValue(unwatched(emails.promise) as never);
      const res = response();

      const handled = GET(request(), res);
      const outcome = handled.catch((error: unknown) => error);
      deedPoll.reject(failure);
      await settle();
      referrals.resolve([]);
      emails.reject(new Error("deed-poll-api call failed (unavailable): nope"));

      expect(await outcome).toBe(failure);
      await settle();
      expect(getCaseFieldRules).not.toHaveBeenCalled();
      expect(res.render).not.toHaveBeenCalled();
      expect(logged).not.toHaveBeenCalled();
      expect(unhandled).toEqual([]);
    });

    it("rejects with the rules read's own error once the optional reads later reject, logging each panel failure first", async () => {
      const failure = new Error("deed-poll-api call failed (unavailable): rules");
      const rules = deferred<never>();
      const referrals = deferred<never[]>();
      const emails = deferred<typeof CASE_EMAILS>();
      vi.mocked(getCaseFieldRules).mockReturnValueOnce(unwatched(rules.promise));
      vi.mocked(findReferrals).mockReturnValue(unwatched(referrals.promise));
      vi.mocked(findCaseEmails).mockReturnValue(unwatched(emails.promise) as never);
      const res = response();

      const handled = GET(request(), res);
      const outcome = handled.catch((error: unknown) => error);
      await settle();
      rules.reject(failure);
      await settle();
      referrals.reject(new Error("deed-poll-api call failed (timeout): referrals"));
      emails.reject(new Error("deed-poll-api call failed (timeout): emails"));

      expect(await outcome).toBe(failure);
      await settle();
      expect(getCaseFieldRules).toHaveBeenCalledTimes(1);
      expect(res.render).not.toHaveBeenCalled();
      // `src/errors.ts` logs the fatal rules error; the page logs only the panels, which the case now exists for.
      expect(logged).toHaveBeenCalledTimes(2);
      expect(logged).toHaveBeenCalledWith(expect.stringContaining("referrals unavailable"));
      expect(logged).toHaveBeenCalledWith(expect.stringContaining("emails unavailable"));
      expect(unhandled).toEqual([]);
    });

    it("degrades only the referrals panel when only the referrals read fails, logging it once", async () => {
      vi.mocked(findReferrals).mockImplementation(failingRead(new Error("deed-poll-api call failed (timeout): nope")));
      const res = response();

      await GET(request(), res);

      const model = res.render.mock.calls[0][1];
      expect(model.referrals.unavailable).toBe(true);
      expect(model.emails.unavailable).toBe(false);
      expect(model.emails.sendable).toHaveLength(1);
      expect(logged).toHaveBeenCalledTimes(1);
      expect(logged).toHaveBeenCalledWith(expect.stringContaining("referrals unavailable"));
      expect(unhandled).toEqual([]);
    });

    it("degrades only the emails panel when only the emails read fails, logging it once", async () => {
      vi.mocked(findReferrals).mockResolvedValue([REFERRAL] as never);
      vi.mocked(findCaseEmails).mockImplementation(failingRead(new Error("deed-poll-api call failed (timeout): nope")));
      const res = response();

      await GET(request(), res);

      const model = res.render.mock.calls[0][1];
      expect(model.emails.unavailable).toBe(true);
      expect(model.referrals.unavailable).toBe(false);
      expect(model.referrals.count).toBe(1);
      expect(logged).toHaveBeenCalledTimes(1);
      expect(logged).toHaveBeenCalledWith(expect.stringContaining("emails unavailable"));
      expect(unhandled).toEqual([]);
    });

    it("degrades both panels and still renders the case when both optional reads fail, logging each once", async () => {
      vi.mocked(findReferrals).mockImplementation(failingRead(new Error("deed-poll-api call failed (timeout): referrals")));
      vi.mocked(findCaseEmails).mockImplementation(failingRead(new Error("deed-poll-api call failed (timeout): emails")));
      const res = response();

      await GET(request(), res);

      const model = res.render.mock.calls[0][1];
      expect(model.pageHeading).toBe("KBDP2026-00001");
      expect(model.referrals.unavailable).toBe(true);
      expect(model.emails.unavailable).toBe(true);
      expect(logged).toHaveBeenCalledTimes(2);
      expect(logged).toHaveBeenCalledWith(expect.stringContaining("referrals unavailable"));
      expect(logged).toHaveBeenCalledWith(expect.stringContaining("emails unavailable"));
      expect(unhandled).toEqual([]);
    });

    it("logs optional failures that land before the case resolves only once the case is known to exist", async () => {
      const deedPoll = deferred<typeof found>();
      vi.mocked(findDeedPoll).mockReturnValue(unwatched(deedPoll.promise) as never);
      vi.mocked(findReferrals).mockImplementation(failingRead(new Error("deed-poll-api call failed (timeout): referrals")));
      vi.mocked(findCaseEmails).mockImplementation(failingRead(new Error("deed-poll-api call failed (timeout): emails")));
      const res = response();

      const handled = GET(request(), res);
      await settle();
      const loggedBeforeCase = logged.mock.calls.length;
      deedPoll.resolve(found);
      await handled;

      expect(loggedBeforeCase).toBe(0);
      expect(logged).toHaveBeenCalledTimes(2);
      expect(res.render.mock.calls[0][1].referrals.unavailable).toBe(true);
      expect(res.render.mock.calls[0][1].emails.unavailable).toBe(true);
      expect(unhandled).toEqual([]);
    });

    it("logs nothing for optional failures that land before a case read that then fails", async () => {
      const failure = new NotFoundError("DeedPoll nope not found");
      const deedPoll = deferred<typeof found>();
      vi.mocked(findDeedPoll).mockReturnValue(unwatched(deedPoll.promise) as never);
      vi.mocked(findReferrals).mockImplementation(failingRead(new NotFoundError("DeedPoll nope not found")));
      vi.mocked(findCaseEmails).mockImplementation(failingRead(new NotFoundError("DeedPoll nope not found")));

      const handled = GET(request(), response());
      const outcome = handled.catch((error: unknown) => error);
      await settle();
      deedPoll.reject(failure);

      expect(await outcome).toBe(failure);
      await settle();
      expect(getCaseFieldRules).not.toHaveBeenCalled();
      expect(logged).not.toHaveBeenCalled();
      expect(unhandled).toEqual([]);
    });

    it("keeps the permission-derived controls and the send banner when the optional reads settle late", async () => {
      vi.mocked(findCaseEmails).mockResolvedValue({ ...CASE_EMAILS, history: [SENT_EMAIL] } as never);
      const sendRequest = (): Request => pageRequest({ params: { id: "case-1" }, query: { email: "sent", emailId: "email-1" }, teamLeader: true });
      const prompt = response();
      await GET(sendRequest(), prompt);

      const referrals = deferred<never[]>();
      const emails = deferred<typeof CASE_EMAILS>();
      vi.mocked(findReferrals).mockReturnValue(unwatched(referrals.promise));
      vi.mocked(findCaseEmails).mockReturnValue(unwatched(emails.promise) as never);
      const late = response();
      const handled = GET(sendRequest(), late);
      await settle();
      referrals.resolve([]);
      await settle();
      emails.resolve({ ...CASE_EMAILS, history: [SENT_EMAIL] } as never);
      await handled;

      const model = late.render.mock.calls[0][1];
      expect(model).toEqual(prompt.render.mock.calls[0][1]);
      expect(model.presentation.privacy.editable).toBe(true);
      expect(model.emailBanner).toEqual({ text: expect.any(String), href: "/deed-polls/case-1/emails/email-1" });
      expect(unhandled).toEqual([]);
    });
  });

  it("reads the emails once, since one payload answers the tab, the compose form and the per-email page", async () => {
    // Decision 8: api returns availability, history and slot defaults together, so a second call here would be
    // a round trip for an answer the page is already holding.
    await GET(request(), response());

    expect(findCaseEmails).toHaveBeenCalledTimes(1);
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

  // Built here with the viewer's path helpers rather than in the template (CLAUDE.md "Redirect paths").
  it("should open each document in the case's viewer, encoding the document id", async () => {
    const document = { id: "doc/1", name: "Deed.pdf", documentType: null, direction: null, createdOn: null, hasFile: true };
    vi.mocked(findDeedPoll).mockResolvedValue({ ...found, documents: [document] } as never);
    const res = response();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].documents).toEqual([
      expect.objectContaining({ name: "Deed.pdf", downloadable: true, viewHref: "/deed-polls/case-1/documents/doc%2F1/view" })
    ]);
  });

  it("passes a referrals view model built from the second call, formatted rather than raw", async () => {
    // Referrals are the one subgrid whose rows are not on the case payload, so the tab is only ever as
    // populated as this call makes it — and the labels are the view model's, not the template's.
    vi.mocked(findReferrals).mockResolvedValue([REFERRAL] as never);
    const res = response();

    await GET(request(), res);

    const referrals = res.render.mock.calls[0][1].referrals;
    expect(referrals.count).toBe(1);
    expect(referrals.rows[0]).toMatchObject({ id: "ref-1", state: "Awaiting a Master", reasons: ["Applicant is a minor"], urgency: "Standard" });
  });

  it("resolves the change notice for each referral whose direction the judge changed, keyed by its id", async () => {
    vi.mocked(findReferrals).mockResolvedValue([
      { ...REFERRAL, id: "ref-2", state: "Decided", directionChangedAt: new Date("2026-10-19T09:30:00Z") },
      { ...REFERRAL, id: "ref-1", state: "Closed", directionChangedAt: null }
    ] as never);
    const res = response();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].directionChangedNotices).toEqual({ "ref-2": "The Master changed this direction on 19 October 2026 at 10:30am." });
  });

  it("resolves no change notices when the referrals read failed", async () => {
    vi.mocked(findReferrals).mockRejectedValue(new Error("deed-poll-api call failed (unavailable): nope"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = response();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].directionChangedNotices).toEqual({});
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

  it("passes an emails view model built from the fourth call, formatted rather than raw", async () => {
    // The emails tab, like referrals, is only ever as populated as its own call makes it — and every cell is
    // the view model's display string, since a template cannot format a timestamp.
    vi.mocked(findCaseEmails).mockResolvedValue({ ...CASE_EMAILS, history: [SENT_EMAIL] } as never);
    const res = response();

    await GET(request(), res);

    const emails = res.render.mock.calls[0][1].emails;
    expect(emails.count).toBe(1);
    expect(emails.rows[0]).toMatchObject({ id: "email-1", template: "Application refused", state: "Accepted by Notify" });
  });

  it("populates the emails tab from that call, not from the case record", async () => {
    // The same merge the referrals tab needs, and the same failure mode: the case payload carries no emails, so
    // forgetting it leaves the tab claiming an applicant has never been written to.
    vi.mocked(findCaseEmails).mockResolvedValue({ ...CASE_EMAILS, history: [SENT_EMAIL] } as never);
    const res = response();

    await GET(request(), res);

    const tabs = res.render.mock.calls[0][1].tabs as { id: string; subgrid?: string; empty: boolean; label: string }[];
    expect(tabs.find((tab) => tab.id === "emails")).toMatchObject({ subgrid: "emails", empty: false, label: "Emails" });
  });

  it("renders the emails tab last, after the referrals one", async () => {
    // Decision 1, and it is the page's business as much as `FORM_TABS`': this is the order a caseworker's
    // muscle memory is built on, and the read-only page once fell six tabs behind the form it ports.
    const res = response();

    await GET(request(), res);

    const tabs = res.render.mock.calls[0][1].tabs as { id: string }[];
    expect(tabs[tabs.length - 1].id).toBe("emails");
  });

  it("renders the emails tab empty on a case whose applicant has never been written to", async () => {
    const res = response();

    await GET(request(), res);

    const tabs = res.render.mock.calls[0][1].tabs as { id: string; empty: boolean }[];
    expect(tabs.find((tab) => tab.id === "emails")?.empty).toBe(true);
    expect(res.render.mock.calls[0][1].emails).toMatchObject({ rows: [], count: 0, unavailable: false });
  });

  it("offers every template api says may be sent now, so a second one needs no change here", async () => {
    vi.mocked(findCaseEmails).mockResolvedValue({
      ...CASE_EMAILS,
      availability: [...CASE_EMAILS.availability, { template: "chase-missing-documents", applicable: true, reason: null, provisioned: true, slots: SLOTS }]
    } as never);
    const res = response();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].emails.sendable).toEqual([
      { template: "application-rejected", name: "Application rejected" },
      { template: "chase-missing-documents", name: "Chase missing documents" }
    ]);
  });

  it("carries api's reason for a template that cannot be sent, so an absent button is explained", async () => {
    vi.mocked(findCaseEmails).mockResolvedValue({
      ...CASE_EMAILS,
      availability: [
        {
          template: "application-rejected",
          applicable: false,
          reason: "This case has no referral that a Master has refused",
          provisioned: true,
          slots: SLOTS
        }
      ]
    } as never);
    const res = response();

    await GET(request(), res);

    const emails = res.render.mock.calls[0][1].emails;
    expect(emails.sendable).toEqual([]);
    expect(emails.unsendable[0].reason).toBe("This case has no referral that a Master has refused");
  });

  it("renders the case when the emails read fails, rather than losing the page to one panel", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(findCaseEmails).mockRejectedValue(new Error("deed-poll-api call failed (unavailable): nope"));
    const res = response();

    await GET(request(), res);

    expect(res.render).toHaveBeenCalled();
    expect(res.render.mock.calls[0][1].pageHeading).toBe("KBDP2026-00001");
    expect(res.render.mock.calls[0][1].emails).toEqual({ rows: [], count: 0, unavailable: true, sendable: [], unsendable: [] });
    logged.mockRestore();
  });

  // api answers this read 400 for a refusal with no directions text — flag 7 of the plan — which `callApi`
  // turns into an InvalidInputError, not an outage. The panel degrades either way rather than 500ing the page.
  it("renders the case when the emails read is refused rather than unreachable", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { InvalidInputError } = await import("@hmcts/deed-poll");
    vi.mocked(findCaseEmails).mockRejectedValue(new InvalidInputError("judges_reason is required", []));
    const res = response();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].emails.unavailable).toBe(true);
    logged.mockRestore();
  });

  it("logs a degrading emails panel without the case id, so the logs say it is happening and not to whom", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(findCaseEmails).mockRejectedValue(new Error("deed-poll-api call failed (timeout): nope"));

    await GET(request(), response());

    expect(logged).toHaveBeenCalledWith(expect.stringContaining("emails unavailable"));
    expect(logged).not.toHaveBeenCalledWith(expect.stringContaining("case-1"));
    logged.mockRestore();
  });

  it("carries the labels the emails subgrid renders, since a missing one is a blank column or button", async () => {
    const res = response();

    await GET(request(), res);

    const { en } = res.render.mock.calls[0][1];
    expect(en.emailColumns).toHaveLength(3);
    for (const key of ["sendEmail", "viewEmailHint", "emailsStateHint", "emailsUnavailable"]) {
      expect(en[key], key).toBeTruthy();
    }
  });

  it("shows no banner on an ordinary visit to the case", async () => {
    const res = response();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].emailBanner).toBeNull();
  });

  it("confirms a completed send and links to the email the journey named", async () => {
    // `emails/[template]/send.ts` redirects here rather than rendering a confirmation of its own, so this is
    // where the outcome is worded.
    vi.mocked(findCaseEmails).mockResolvedValue({ ...CASE_EMAILS, history: [SENT_EMAIL] } as never);
    const res = response();

    await GET(pageRequest({ params: { id: "case-1" }, query: { email: "sent", emailId: "email-1" } }), res);

    expect(res.render.mock.calls[0][1].emailBanner).toEqual({
      text: "The email has been accepted by GOV.UK Notify for sending to the applicant.",
      href: "/deed-polls/case-1/emails/email-1"
    });
  });

  it("encodes the case id in the email link, as it does the email id", async () => {
    vi.mocked(findCaseEmails).mockResolvedValue({ ...CASE_EMAILS, history: [{ ...SENT_EMAIL, id: "email/1" }] } as never);
    const res = response();

    await GET(pageRequest({ params: { id: "a/b?c#d" }, query: { email: "sent", emailId: "email/1" } }), res);

    expect(res.render.mock.calls[0][1].emailBanner.href).toBe("/deed-polls/a%2Fb%3Fc%23d/emails/email%2F1");
  });

  // The banner is additive, so an email id api returned that cannot be a path segment loses its link, not the page.
  it.each([".", ".."])("still renders the case and the confirmation, without a link, when the sent email's id is %j", async (emailId) => {
    vi.mocked(findCaseEmails).mockResolvedValue({ ...CASE_EMAILS, history: [{ ...SENT_EMAIL, id: emailId }] } as never);
    const res = response();

    await GET(pageRequest({ params: { id: "case-1" }, query: { email: "sent", emailId } }), res);

    expect(res.render.mock.calls[0][1].emailBanner).toEqual({
      text: "The email has been accepted by GOV.UK Notify for sending to the applicant.",
      href: null
    });
  });

  it("tells a caseworker a redundant send had already gone, rather than reporting a failure", async () => {
    // api's insert is `ON CONFLICT DO NOTHING`, so a double-click answers 200 with `enqueued: false` and the row
    // it wrote the first time. Reporting a failure would invite a third attempt.
    vi.mocked(findCaseEmails).mockResolvedValue({ ...CASE_EMAILS, history: [SENT_EMAIL] } as never);
    const res = response();

    await GET(pageRequest({ params: { id: "case-1" }, query: { email: "already-sent", emailId: "email-1" } }), res);

    expect(res.render.mock.calls[0][1].emailBanner.text).toBe("This email had already been sent for this case, so it was not sent again.");
  });

  it("shows no banner at all for an email id this case's history does not carry", async () => {
    // **The whole banner, not just its href.** This test previously asserted that an invented `emailId` still
    // produced the sentence and merely withheld the link — which meant `?email=sent` alone told a caseworker an
    // applicant had been informed their application was refused. Anyone who could hand a caseworker a URL could
    // produce that sentence, and it is the exact misinformation decision 10 exists to prevent. The history is the
    // only thing that knows whether a send happened, so an id it does not carry confirms nothing.
    const res = response();

    await GET(pageRequest({ params: { id: "case-1" }, query: { email: "sent", emailId: "../../somebody-elses" } }), res);

    expect(res.render.mock.calls[0][1].emailBanner).toBeNull();
  });

  it("shows no banner for a query value the journey never produces", async () => {
    const res = response();

    await GET(pageRequest({ params: { id: "case-1" }, query: { email: "delivered" } }), res);

    expect(res.render.mock.calls[0][1].emailBanner).toBeNull();
  });

  it("still confirms the send when the emails read failed, with nothing to link to", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(findCaseEmails).mockRejectedValue(new Error("deed-poll-api call failed (unavailable): nope"));
    const res = response();

    await GET(pageRequest({ params: { id: "case-1" }, query: { email: "sent", emailId: "email-1" } }), res);

    expect(res.render.mock.calls[0][1].emailBanner.href).toBeNull();
    logged.mockRestore();
  });

  it("never labels an email as received, read or downloaded, in any string the tab renders", async () => {
    // Decision 10 from the page's side: api knows only that Notify accepted the send. The rendered assertion is
    // in detail.njk.test.ts; this one covers the copy, where a well-meaning wording change would start.
    const res = response();

    await GET(request(), res);

    const { en } = res.render.mock.calls[0][1];
    for (const key of ["emailColumns", "sendEmail", "viewEmailHint"]) {
      expect(JSON.stringify(en[key]), key).not.toMatch(/delivered|viewed|opened|downloaded/i);
    }
  });

  it("treats a Team leader caller as able to edit privacy", async () => {
    const res = response();

    await GET(request(true), res);

    expect(res.render.mock.calls[0][1].presentation.privacy.editable).toBe(true);
  });

  it("treats a caseworker without staff capabilities caller as unable to edit privacy on an existing case", async () => {
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
  it("does not log a referrals or emails fault when the case itself is missing, which fails every read", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(findDeedPoll).mockRejectedValue(new NotFoundError("DeedPoll nope not found"));
    vi.mocked(findReferrals).mockRejectedValue(new NotFoundError("DeedPoll nope not found"));
    vi.mocked(findCaseEmails).mockRejectedValue(new NotFoundError("DeedPoll nope not found"));

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

  /**
   * That the case is waiting for the applicant to confirm — `notify-3b` decision 2.
   *
   * The date is api's `awaitingConfirmationSince` and the wording is this page's; what the tests own is that it
   * is said *beside* the state rather than instead of it, that it is read off the case and nothing else, and that
   * it says nothing about what the office does next (decision 8, and flag 1's open business question).
   */
  describe("the awaiting-confirmation notice", () => {
    /** A case waiting: api leaves `state` at `Returned`, because there is no ninth case state. */
    const waiting = { ...found, state: "Returned", awaitingConfirmationSince: new Date("2026-05-12T08:44:00.000Z") };

    it("says the case is waiting, and when the applicant was asked", async () => {
      vi.mocked(findDeedPoll).mockResolvedValue(waiting as never);
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].awaitingConfirmation).toBe(
        "The applicant was asked on 12 May 2026 at 9:44am whether they want to proceed, and has not replied yet. Their reply is recorded against the referral it was requested for — see the Referrals tab."
      );
    });

    it("leaves the case state exactly as api published it, rather than relabelling Returned", async () => {
      vi.mocked(findDeedPoll).mockResolvedValue(waiting as never);
      const res = response();

      await GET(request(), res);

      const model = res.render.mock.calls[0][1];
      expect(model.header.rows.find((row: { key: string }) => row.key === "Status").value).toBe("Returned");
      expect(model.case.state).toBe("Returned");
    });

    it("says nothing on a case waiting for nothing, which is nearly all of them", async () => {
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].awaitingConfirmation).toBe("");
    });

    it("reads the wait off the case alone, never off a referral or the email history", async () => {
      // A case with a live referral and no `awaitingConfirmationSince` is not waiting: api recomputes that
      // column in the transaction that records an answer, and inferring it here would be a second opinion.
      vi.mocked(findReferrals).mockResolvedValue([{ ...REFERRAL, confirmationRequestedAt: new Date("2026-05-12T08:44:00.000Z") }] as never);
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].awaitingConfirmation).toBe("");
    });

    it("survives a failed referrals read, since the wait is a column of the case and not of a referral", async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(findDeedPoll).mockResolvedValue(waiting as never);
      vi.mocked(findReferrals).mockRejectedValue(new Error("deed-poll-api call failed (unavailable)"));
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].awaitingConfirmation).toContain("has not replied yet");
      logged.mockRestore();
    });

    it("invents no consequence for the case's dates or state, which nobody has decided yet", async () => {
      vi.mocked(findDeedPoll).mockResolvedValue(waiting as never);
      const res = response();

      await GET(request(), res);

      // `notify-3b` flag 1 is open: this page records a fact and must not imply enrolment or a refund.
      const notice: string = res.render.mock.calls[0][1].awaitingConfirmation;
      expect(notice).not.toMatch(/enrol|refund|ready/i);
    });
  });

  it("provides both en and cy content objects with matching keys", async () => {
    const res = response();

    await GET(request(), res);

    const model = res.render.mock.calls[0][1];
    expect(Object.keys(model.en)).toEqual(Object.keys(model.cy));
  });
});
