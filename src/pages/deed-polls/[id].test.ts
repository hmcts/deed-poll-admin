import { findDeedPoll, NotFoundError } from "@hmcts/deed-poll";
import type { Request } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../express-doubles.js";
import { GET } from "./[id].js";

// Only the two api calls are replaced. The tabs, header, notes and documents view models are the
// domain's and tested there, so this exercises the page against the real ones — which is the point: the
// page's job is to assemble them, and a wrong argument order would not show up against mocks.
vi.mock("@hmcts/deed-poll", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hmcts/deed-poll")>();

  return {
    ...actual,
    findDeedPoll: vi.fn(),
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

  it("makes both api calls as the signed-in caseworker", async () => {
    const { getCaseFieldRules } = await import("@hmcts/deed-poll");

    await GET(pageRequest({ params: { id: "case-1" }, accessToken: "caseworker-token" }), response());

    expect(findDeedPoll).toHaveBeenCalledWith("case-1", { accessToken: "caseworker-token" });
    expect(getCaseFieldRules).toHaveBeenCalledWith(expect.anything(), { accessToken: "caseworker-token" });
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

  it("provides both en and cy content objects with matching keys", async () => {
    const res = response();

    await GET(request(), res);

    const model = res.render.mock.calls[0][1];
    expect(Object.keys(model.en)).toEqual(Object.keys(model.cy));
  });
});
