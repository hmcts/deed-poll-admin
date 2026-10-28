/**
 * api D2's assignment, as the mock restates it: raising with a Master, reassigning, the per-Master cap per referral
 * window, `directionDueBy`, the Master's visibility and `MINE_ORDER`, linking's referral side, the processing window's
 * `unassignOverdue`, and the `/__mock/clock` that lets a journey reach the last two without waiting.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type MockCase, type RunningMockApi, startMockApi } from "./server.js";

const DELIVERY_MANAGER = token({ sub: "manager", name: "Delivery Manager", roles: ["caseworker-deedpoll-delivery-manager"] });
const CASEWORKER = token({ sub: "cw-1", name: "Casey Worker", roles: ["caseworker-deedpoll"] });
const SULLIVAN_SUBJECT = "sullivan-subject-1";
const WREN_SUBJECT = "wren-subject-2";
const SULLIVAN = judge("sullivan@example.test", SULLIVAN_SUBJECT);
const WREN = judge("wren@example.test", WREN_SUBJECT);
const DAY_MINUTES = 1440;
const SELECT_A_MASTER = "Select a Master who is available";

let mock: RunningMockApi;
/** The seeded records, which `seed` hands back by reference, so a test reads the stored notes and referrals. */
const records = new Map<string, MockCase>();

beforeAll(async () => {
  mock = await startMockApi();
});

afterAll(async () => {
  await mock.close();
});

beforeEach(() => {
  mock.reset();
  records.clear();
  mock.setScenario("happy-path");
});

describe("raising a referral with a Master", () => {
  it("should assign it at once, with the window it counts towards and when the direction is due", async () => {
    // Arrange
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    const caseId = newCase();
    await clockAt("2026-10-28T10:45:00Z");

    // Act
    const created = await raise(caseId, { reasons: ["Minor", "MinorTransgender"], masterId: sullivan });

    // Assert
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({
      state: "Claimed",
      claimedBy: "Master Sullivan",
      assignedMaster: { id: sullivan, name: "Master Sullivan" },
      windowDate: "2026-10-28",
      windowSlot: "PM"
    });
    const assignedAt = Date.parse(created.json.assignedAt);
    expect(Math.abs(assignedAt - Date.parse("2026-10-28T10:45:00Z"))).toBeLessThan(60_000);
    expect(Date.parse(created.json.directionDueBy) - assignedAt).toBe(7 * DAY_MINUTES * 60_000);
    expect(caseState(caseId)).toBe("Claimed");
  });

  it("should write the raise's note and then the assignment's, naming the Master", async () => {
    // Arrange
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    const caseId = newCase();

    // Act
    await raise(caseId, { reasons: ["Other"], notes: "See the letter", masterId: sullivan });

    // Assert
    const notes = noteTexts(caseId);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatch(/^Referred to a Master\. Reasons: Other\./);
    expect(notes[1]).toMatch(/^Referral raised on \d{1,2} \w+ \d{4}, reasons: Other, assigned to Master Sullivan\.$/);
  });

  it("should leave a referral raised without a Master waiting for assignment", async () => {
    // Arrange
    const caseId = newCase();

    // Act
    const created = await raise(caseId, { reasons: ["Minor", "MinorTransgender"] });

    // Assert
    expect(created.json).toMatchObject({
      state: "Open",
      claimedBy: null,
      assignedMaster: null,
      assignedAt: null,
      windowDate: null,
      windowSlot: null,
      directionDueBy: null
    });
    expect(noteTexts(caseId)).toHaveLength(1);
  });

  it.each([
    ["an unknown Master", async () => "00000000-0000-4000-8000-000000000000"],
    ["an unavailable Master", async () => master("Master Wren", "wren@example.test", false)]
  ])("should refuse %s on masterId in api's words and write nothing", async (_what, masterId) => {
    // Arrange
    const caseId = newCase();

    // Act
    const refused = await raise(caseId, { reasons: ["Minor", "MinorTransgender"], masterId: await masterId() });

    // Assert
    expect(refused.status).toBe(400);
    expect(refused.json).toEqual({ error: SELECT_A_MASTER, errors: [{ field: "masterId", message: SELECT_A_MASTER }] });
    expect(records.get(caseId)?.referrals).toEqual([]);
    expect(noteTexts(caseId)).toEqual([]);
  });

  it("should refuse a masterId that is not a UUID on masterId", async () => {
    // Act
    const refused = await raise(newCase(), { reasons: ["Minor", "MinorTransgender"], masterId: "sullivan" });

    // Assert
    expect(refused.status).toBe(400);
    expect(refused.json.errors[0].field).toBe("masterId");
  });

  it("should refuse a Master at the cap with a 409 on masterId naming the window, and write nothing", async () => {
    // Arrange
    await setCap(1);
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    await clockAt("2026-10-28T08:00:00Z");
    await raise(newCase(), { reasons: ["Minor", "MinorTransgender"], masterId: sullivan });
    const caseId = newCase();

    // Act
    const refused = await raise(caseId, { reasons: ["Minor", "MinorTransgender"], masterId: sullivan });

    // Assert
    const full = "This Master already has 1 referral for the morning of 28 October 2026. Choose another Master.";
    expect(refused.status).toBe(409);
    expect(refused.json).toEqual({ error: full, errors: [{ field: "masterId", message: full }] });
    expect(records.get(caseId)?.referrals).toEqual([]);
  });

  it("should count a referral raised outside the windows towards the next working day's morning", async () => {
    // Arrange
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    // Friday 30 October 2026 after the afternoon window.
    await clockAt("2026-10-30T16:00:00Z");

    // Act
    const created = await raise(newCase(), { reasons: ["Minor", "MinorTransgender"], masterId: sullivan });

    // Assert
    expect(created.json).toMatchObject({ windowDate: "2026-11-02", windowSlot: "AM" });
  });
});

describe("assigning and reassigning", () => {
  it("should assign a referral waiting for assignment, with the assignment's note", async () => {
    // Arrange
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    const caseId = newCase();
    const referralId = (await raise(caseId, { reasons: ["Minor", "MinorTransgender"] })).json.id;

    // Act
    const assigned = await assignment(caseId, referralId, { masterId: sullivan });

    // Assert
    expect(assigned.status).toBe(200);
    expect(assigned.json).toMatchObject({ state: "Claimed", assignedMaster: { id: sullivan, name: "Master Sullivan" } });
    expect(noteTexts(caseId).at(-1)).toMatch(/, assigned to Master Sullivan\.$/);
    expect(caseState(caseId)).toBe("Claimed");
  });

  it("should move a referral to another Master, restart the window and drop the first Master's count", async () => {
    // Arrange
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    const wren = await master("Master Wren", "wren@example.test");
    await clockAt("2026-10-28T08:00:00Z");
    const caseId = newCase();
    const first = await raise(caseId, { reasons: ["Minor", "MinorTransgender"], masterId: sullivan });
    await clockAt("2026-10-28T09:00:00Z");

    // Act
    const moved = await assignment(caseId, first.json.id, { masterId: wren });

    // Assert
    expect(moved.json).toMatchObject({ claimedBy: "Master Wren", assignedMaster: { id: wren, name: "Master Wren" } });
    expect(Date.parse(moved.json.assignedAt) - Date.parse(first.json.assignedAt)).toBeGreaterThan(50 * 60_000);
    expect(noteTexts(caseId).at(-1)).toMatch(/, reassigned from Master Sullivan to Master Wren\.$/);
    expect(await counts()).toEqual({ "Master Sullivan": 0, "Master Wren": 1 });
  });

  it("should treat the Master it already has as a no-op that writes nothing", async () => {
    // Arrange
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    const caseId = newCase();
    const created = await raise(caseId, { reasons: ["Minor", "MinorTransgender"], masterId: sullivan });
    const notes = noteTexts(caseId).length;

    // Act
    const same = await assignment(caseId, created.json.id, { masterId: sullivan });

    // Assert
    expect(same.status).toBe(200);
    expect(same.json.assignedAt).toBe(created.json.assignedAt);
    expect(noteTexts(caseId)).toHaveLength(notes);
  });

  it("should refuse a referral no longer waiting for a direction with a 409 carrying no field", async () => {
    // Arrange
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    await link(SULLIVAN);
    const caseId = newCase();
    const referralId = (await raise(caseId, { reasons: ["Minor", "MinorTransgender"], masterId: sullivan })).json.id;
    await direct(referralId, SULLIVAN);

    // Act
    const refused = await assignment(caseId, referralId, { masterId: sullivan });

    // Assert
    expect(refused.status).toBe(409);
    expect(refused.json).toEqual({ error: `Referral ${referralId} is Decided: only a referral waiting for a direction can be assigned` });
  });

  it("should check the cap against the new Master, not the old one", async () => {
    // Arrange
    await setCap(1);
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    const wren = await master("Master Wren", "wren@example.test");
    await clockAt("2026-10-28T08:00:00Z");
    await raise(newCase(), { reasons: ["Minor", "MinorTransgender"], masterId: wren });
    const caseId = newCase();
    const referralId = (await raise(caseId, { reasons: ["Minor", "MinorTransgender"], masterId: sullivan })).json.id;

    // Act
    const refused = await assignment(caseId, referralId, { masterId: wren });

    // Assert
    expect(refused.status).toBe(409);
    expect(refused.json.errors).toEqual([{ field: "masterId", message: expect.stringContaining("the morning of 28 October 2026") }]);
  });

  it.each([
    ["no masterId", {}],
    ["an unknown Master", { masterId: "00000000-0000-4000-8000-000000000000" }]
  ])("should refuse %s on masterId", async (_what, body) => {
    // Arrange
    const caseId = newCase();
    const referralId = (await raise(caseId, { reasons: ["Minor", "MinorTransgender"] })).json.id;

    // Act
    const refused = await assignment(caseId, referralId, body);

    // Assert
    expect(refused.status).toBe(400);
    expect(refused.json.errors).toEqual([{ field: "masterId", message: SELECT_A_MASTER }]);
  });

  it("should answer 404 for a referral of another case", async () => {
    // Arrange
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    const referralId = (await raise(newCase(), { reasons: ["Minor", "MinorTransgender"] })).json.id;

    // Act
    const missing = await assignment(newCase(), referralId, { masterId: sullivan });

    // Assert
    expect(missing.status).toBe(404);
  });
});

describe("the Masters list's window", () => {
  it("should carry the current window, the cap and each Master's count in it", async () => {
    // Arrange
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    await master("Master Wren", "wren@example.test");
    await clockAt("2026-10-28T12:00:00Z");
    await raise(newCase(), { reasons: ["Minor", "MinorTransgender"], masterId: sullivan });

    // Act
    const listed = await call("GET", "/caseworker/masters", undefined, CASEWORKER);

    // Assert
    expect(listed.json.window).toEqual({ date: "2026-10-28", slot: "PM" });
    expect(listed.json.cap).toBe(10);
    expect(listed.json.masters.map((entry: { name: string; assignedInWindow: number }) => [entry.name, entry.assignedInWindow])).toEqual([
      ["Master Sullivan", 1],
      ["Master Wren", 0]
    ]);
  });

  it("should stop counting an assignment once the clock reaches the next window", async () => {
    // Arrange
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    await clockAt("2026-10-28T08:00:00Z");
    await raise(newCase(), { reasons: ["Minor", "MinorTransgender"], masterId: sullivan });

    // Act
    await clockAt("2026-10-28T12:00:00Z");

    // Assert
    expect(await counts()).toEqual({ "Master Sullivan": 0 });
  });
});

describe("the Master's side", () => {
  it("should show a linked Master their assignment by id and on their list, and nobody else", async () => {
    // Arrange
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    await master("Master Wren", "wren@example.test");
    await link(SULLIVAN);
    await link(WREN);
    const referralId = (await raise(newCase(), { reasons: ["Minor", "MinorTransgender"], masterId: sullivan })).json.id;

    // Act
    const own = await call("GET", `/judicial/referrals/${referralId}`, undefined, SULLIVAN);
    const other = await call("GET", `/judicial/referrals/${referralId}`, undefined, WREN);

    // Assert
    expect(own.status).toBe(200);
    expect(own.json).toMatchObject({ state: "Claimed", claimedBy: "Master Sullivan" });
    expect(own.json.directionDueBy).toEqual(expect.any(String));
    expect(own.json.assignedAt).toEqual(expect.any(String));
    expect(other.status).toBe(404);
    expect(await mine(SULLIVAN)).toEqual([referralId]);
    expect(await mine(WREN)).toEqual([]);
  });

  it("should show a referral waiting for assignment to no judge, and leave the pool empty", async () => {
    // Arrange
    await master("Master Sullivan", "sullivan@example.test");
    await link(SULLIVAN);
    const referralId = (await raise(newCase(), { reasons: ["Minor", "MinorTransgender"] })).json.id;

    // Act
    const read = await call("GET", `/judicial/referrals/${referralId}`, undefined, SULLIVAN);
    const pool = await call("GET", "/judicial/referrals", undefined, SULLIVAN);
    const claim = await call("POST", `/judicial/referrals/${referralId}/claim`, undefined, SULLIVAN);

    // Assert
    expect(read.status).toBe(404);
    expect(pool.json).toEqual({ referrals: [], page: 1, size: 10, total: 0, totalPages: 0 });
    expect(claim.status).toBe(404);
  });

  it("should keep an assignment to a Master who has never signed in from everyone until they are linked", async () => {
    // Arrange
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    const referralId = (await raise(newCase(), { reasons: ["Minor", "MinorTransgender"], masterId: sullivan })).json.id;
    const unlinkedJudge = judge("someone@example.test", SULLIVAN_SUBJECT);
    expect((await call("GET", `/judicial/referrals/${referralId}`, undefined, unlinkedJudge)).status).toBe(404);

    // Act
    await link(SULLIVAN);

    // Assert
    expect((await call("GET", `/judicial/referrals/${referralId}`, undefined, SULLIVAN)).status).toBe(200);
  });

  it("should cut a Master's old account off their undirected referrals when their email changes", async () => {
    // Arrange
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    await link(SULLIVAN);
    const referralId = (await raise(newCase(), { reasons: ["Minor", "MinorTransgender"], masterId: sullivan })).json.id;

    // Act
    await call("PATCH", `/caseworker/masters/${sullivan}`, { email: "m.sullivan@example.test", revision: 0 });

    // Assert
    expect((await call("GET", `/judicial/referrals/${referralId}`, undefined, judge("other@example.test", SULLIVAN_SUBJECT))).status).toBe(404);
  });

  it("should attach a claim made before assignment existed to its claimer's Masters-list entry on linking", async () => {
    // Arrange
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    const seeded = mock.seed({
      referrals: [legacyClaim({ claimedBy: "Master Sullivan", claimedById: SULLIVAN_SUBJECT, claimedAt: new Date(Date.now() - 60_000) })]
    });

    // Act
    await link(SULLIVAN);

    // Assert
    const listed = await call("GET", `/caseworker/cases/${seeded.id}/referrals`, undefined, CASEWORKER);
    expect(listed.json[0].assignedMaster).toEqual({ id: sullivan, name: "Master Sullivan" });
  });

  it("should restart the processing window when a direction is withdrawn, keeping the cap's window", async () => {
    // Arrange
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    await link(SULLIVAN);
    await clockAt("2026-10-28T08:00:00Z");
    const created = await raise(newCase(), { reasons: ["Minor", "MinorTransgender"], masterId: sullivan });
    await direct(created.json.id, SULLIVAN);
    await clockAt("2026-10-29T08:00:00Z");

    // Act
    const withdrawn = await call("POST", `/judicial/referrals/${created.json.id}/direction/withdraw`, undefined, SULLIVAN);

    // Assert
    expect(withdrawn.json).toMatchObject({ state: "Claimed", claimedBy: "Master Sullivan" });
    expect(Date.parse(withdrawn.json.assignedAt) - Date.parse(created.json.assignedAt)).toBeGreaterThan(23 * 60 * 60_000);
    const stored = [...records.values()].flatMap((record) => record.referrals).find((referral) => referral.id === created.json.id);
    expect(stored).toMatchObject({ windowDate: "2026-10-28", windowSlot: "AM" });
  });

  it("should list a Master's referrals undirected first, urgent first among those only, then oldest, then directed oldest", async () => {
    // Arrange
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    await link(SULLIVAN);
    const raiseOn = async (at: string, urgent: boolean) => {
      await clockAt(at);
      const body = urgent ? { reasons: ["Other"], notes: "x", urgency: "Urgent", urgencyReason: "Hearing" } : { reasons: ["Other"], notes: "x" };
      return (await raise(newCase(), { ...body, masterId: sullivan })).json.id as string;
    };
    const directedOldNormal = await raiseOn("2026-10-19T08:00:00Z", false);
    const directedNewUrgent = await raiseOn("2026-10-20T08:00:00Z", true);
    const normalOld = await raiseOn("2026-10-21T08:00:00Z", false);
    const urgentOld = await raiseOn("2026-10-22T08:00:00Z", true);
    const normalNew = await raiseOn("2026-10-23T08:00:00Z", false);
    const urgentNew = await raiseOn("2026-10-26T08:00:00Z", true);
    await direct(directedNewUrgent, SULLIVAN);
    await direct(directedOldNormal, SULLIVAN);

    // Act
    const order = await mine(SULLIVAN, 20);

    // Assert
    expect(order).toEqual([urgentOld, urgentNew, normalOld, normalNew, directedOldNormal, directedNewUrgent]);
  });
});

describe("the processing window", () => {
  it("should return an assignment with no direction to the office once its window has passed, and not before", async () => {
    // Arrange
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    await link(SULLIVAN);
    await clockAt("2026-10-21T08:00:00Z");
    const caseId = newCase();
    const referralId = (await raise(caseId, { reasons: ["Minor", "MinorTransgender"], masterId: sullivan })).json.id;
    await clockAt("2026-10-28T07:58:00Z");
    expect(await unassign()).toBe(0);
    await clockAt("2026-10-28T08:02:00Z");

    // Act
    const released = await unassign();

    // Assert
    expect(released).toBe(1);
    const referral = (await call("GET", `/caseworker/cases/${caseId}/referrals/${referralId}`, undefined, CASEWORKER)).json;
    expect(referral).toMatchObject({ state: "Open", claimedBy: null, assignedMaster: null, assignedAt: null, windowDate: null, directionDueBy: null });
    expect(caseState(caseId)).toBe("Open");
    const last = records.get(caseId)?.notes.at(-1);
    expect(last?.note).toBe(
      "Referral raised on 21 October 2026, reasons: Applicant is a minor: Transgender, returned to the office for assignment: no direction from Master Sullivan within 7 days."
    );
    expect(last?.createdBy).toBe("# svc_HMCTS_LCPT_Dev");
    expect(await mine(SULLIVAN)).toEqual([]);
  });

  it("should sweep on a Master's list read, as api's request-time trigger does", async () => {
    // Arrange
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    await link(SULLIVAN);
    await clockAt("2026-10-21T08:00:00Z");
    const caseId = newCase();
    await raise(caseId, { reasons: ["Minor", "MinorTransgender"], masterId: sullivan });
    await clockAt("2026-10-29T08:00:00Z");

    // Act
    const listed = await mine(SULLIVAN);

    // Assert
    expect(listed).toEqual([]);
    expect(caseState(caseId)).toBe("Open");
  });

  it("should leave a direction alone, whatever its age", async () => {
    // Arrange
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    await link(SULLIVAN);
    await clockAt("2026-10-01T08:00:00Z");
    const referralId = (await raise(newCase(), { reasons: ["Minor", "MinorTransgender"], masterId: sullivan })).json.id;
    await direct(referralId, SULLIVAN);
    await clockAt("2026-10-28T08:00:00Z");

    // Act
    const released = await unassign();

    // Assert
    expect(released).toBe(0);
    expect(await mine(SULLIVAN)).toEqual([referralId]);
  });

  it("should count a claim made before assignment existed from its claim", async () => {
    // Arrange
    mock.seed({
      referrals: [legacyClaim({ claimedBy: "Master Sullivan", claimedById: SULLIVAN_SUBJECT, claimedAt: new Date(Date.now() - 8 * DAY_MINUTES * 60_000) })]
    });

    // Act
    const released = await unassign();

    // Assert
    expect(released).toBe(1);
  });

  it("should follow the processing window as it is set now in directionDueBy", async () => {
    // Arrange
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    const caseId = newCase();
    const created = await raise(caseId, { reasons: ["Minor", "MinorTransgender"], masterId: sullivan });
    await call("PUT", "/caseworker/process-settings", { referralClaimExpiryMinutes: 2 * DAY_MINUTES, revision: 0 });

    // Act
    const read = await call("GET", `/caseworker/cases/${caseId}/referrals/${created.json.id}`, undefined, CASEWORKER);

    // Assert
    expect(Date.parse(read.json.directionDueBy) - Date.parse(read.json.assignedAt)).toBe(2 * DAY_MINUTES * 60_000);
  });
});

describe("POST /__mock/clock", () => {
  it("should refuse an offset that is not a whole number of minutes", async () => {
    // Act
    const refused = await call("POST", "/__mock/clock", { offsetMinutes: "soon" });

    // Assert
    expect(refused.status).toBe(400);
  });

  it("should return to real time on reset", async () => {
    // Arrange
    await call("POST", "/__mock/clock", { offsetMinutes: 60 });

    // Act
    mock.reset();
    const now = await call("POST", "/__mock/clock", { offsetMinutes: 0 });

    // Assert
    expect(Math.abs(Date.parse(now.json.now) - Date.now())).toBeLessThan(5_000);
  });
});

describe("what assignment publishes", () => {
  it("should never carry the Master's subject or email in a caseworker or judicial response", async () => {
    // Arrange
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    await link(SULLIVAN);
    const caseId = newCase();
    const created = await raise(caseId, { reasons: ["Minor", "MinorTransgender"], masterId: sullivan });

    // Act
    const responses = [
      created.text,
      (await call("GET", `/caseworker/cases/${caseId}/referrals`, undefined, CASEWORKER)).text,
      (await call("GET", `/judicial/referrals/${created.json.id}`, undefined, SULLIVAN)).text,
      (await call("GET", "/judicial/referrals/mine", undefined, SULLIVAN)).text
    ];

    // Assert
    for (const text of responses) {
      expect(text).not.toContain(SULLIVAN_SUBJECT);
      expect(text).not.toContain("sullivan@example.test");
      expect(text).not.toContain("assignedMasterId");
    }
  });
});

function token(claims: Record<string, unknown>): string {
  return `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;
}

function judge(email: string, sub: string): string {
  return token({ sub, email, roles: ["caseworker-deedpoll-judicial"] });
}

async function call(method: string, path: string, body?: unknown, accessToken = DELIVERY_MANAGER) {
  const response = await fetch(`${mock.url}${path}`, {
    method,
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  return { status: response.status, text, json: (text ? JSON.parse(text) : undefined) as Answer };
}

async function master(name: string, email: string, available = true): Promise<string> {
  const created = await call("POST", "/caseworker/masters", { name, email, available });
  if (created.status !== 201) throw new Error(`Expected a Master, got ${created.status}`);
  return created.json.id;
}

/** A judge's first judicial request, which links them to the entry holding their email. */
async function link(accessToken: string): Promise<void> {
  await call("GET", "/judicial/referrals/mine", undefined, accessToken);
}

async function clockAt(iso: string): Promise<void> {
  await call("POST", "/__mock/clock", { offsetMinutes: Math.round((Date.parse(iso) - Date.now()) / 60_000) });
}

async function setCap(cap: number): Promise<void> {
  const settings = (await call("GET", "/caseworker/process-settings")).json;
  await call("PUT", "/caseworker/process-settings", {
    referralClaimExpiryMinutes: settings.referralClaimExpiryMinutes,
    masterWindowCap: cap,
    revision: settings.revision
  });
}

function newCase(): string {
  const record = mock.seed({ state: "ReadyForMaster" });
  records.set(record.id, record);
  return record.id;
}

function raise(caseId: string, body: Record<string, unknown>) {
  return call("POST", `/caseworker/cases/${caseId}/referrals`, body, CASEWORKER);
}

function assignment(caseId: string, referralId: string, body: Record<string, unknown>) {
  return call("PUT", `/caseworker/cases/${caseId}/referrals/${referralId}/assignment`, body, CASEWORKER);
}

async function direct(referralId: string, accessToken: string): Promise<void> {
  const directed = await call(
    "POST",
    `/judicial/referrals/${referralId}/direction`,
    { decision: "Approved", changesToStandardPublication: false },
    accessToken
  );
  if (directed.status !== 200) throw new Error(`Expected a direction, got ${directed.status}`);
}

async function unassign(): Promise<number> {
  return (await call("POST", "/__mock/referrals/unassign-overdue")).json.released;
}

async function mine(accessToken: string, size = 10): Promise<string[]> {
  return (await call("GET", `/judicial/referrals/mine?size=${size}`, undefined, accessToken)).json.referrals.map((row: { id: string }) => row.id);
}

async function counts(): Promise<Record<string, number>> {
  const listed = (await call("GET", "/caseworker/masters")).json.masters as { name: string; assignedInWindow: number }[];
  return Object.fromEntries(listed.map((entry) => [entry.name, entry.assignedInWindow]));
}

function noteTexts(caseId: string): string[] {
  return records.get(caseId)?.notes.map((note) => note.note) ?? [];
}

function caseState(caseId: string): string | null | undefined {
  return records.get(caseId)?.currentReferralState;
}

/** A referral claimed from the pool before assignment existed: a claimer subject and no Masters-list entry. */
function legacyClaim(claim: { claimedBy: string; claimedById: string; claimedAt: Date }) {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    state: "Claimed" as const,
    reasons: ["Other"],
    notes: "x",
    urgency: "Normal" as const,
    urgencyReason: null,
    migrated: false,
    ...claim,
    decision: null,
    directionsText: null,
    changesToStandardPublication: null,
    decisionDate: null,
    decidedBy: null,
    decidedById: null,
    directionChangedAt: null,
    confirmationRequestedAt: null,
    confirmationOutcome: null,
    confirmationReceivedAt: null,
    confirmationRecordedBy: null,
    createdBy: "Casey Worker",
    modifiedBy: "Casey Worker",
    createdOn: now,
    modifiedOn: now
  };
}

/** What the mock answers here, read field by field: each response is one of these shapes, so only part is present. */
interface Answer {
  id: string;
  state: string;
  assignedAt: string;
  directionDueBy: string;
  error: string;
  errors: { field: string; message: string }[];
  referrals: { id: string }[];
  masters: { id: string; name: string; assignedInWindow: number }[];
  window: unknown;
  cap: number;
  released: number;
  now: string;
  revision: number;
  referralClaimExpiryMinutes: number;
  0: { assignedMaster: unknown };
}
