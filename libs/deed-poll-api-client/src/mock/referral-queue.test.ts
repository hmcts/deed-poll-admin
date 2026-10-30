/**
 * api F1's referral queue, as the mock restates it: raising with no Master, the queue read and its window, the batch
 * send in api's checking order, reassignment, `directionDueBy`, the Master's visibility and `MINE_ORDER` by the day
 * sent, linking's referral side, the processing window's `unassignOverdue` back to the queue, and the `/__mock/clock`
 * that places a journey inside or outside a window.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type MockCase, type RunningMockApi, startMockApi } from "./server.js";

const DELIVERY_MANAGER = token({ sub: "manager", name: "Delivery Manager", roles: ["caseworker-deedpoll-delivery-manager"] });
const TEAM_LEADER = token({ sub: "lead-1", name: "Terry Leader", roles: ["caseworker-deedpoll-team-leader"] });
const LEGACY_ADMIN = token({ sub: "admin-1", name: "Old Admin", roles: ["caseworker-deedpoll-admin"] });
const CASEWORKER = token({ sub: "cw-1", name: "Casey Worker", roles: ["caseworker-deedpoll"] });
const SULLIVAN_SUBJECT = "sullivan-subject-1";
const WREN_SUBJECT = "wren-subject-2";
const SULLIVAN = judge("sullivan@example.test", SULLIVAN_SUBJECT);
const WREN = judge("wren@example.test", WREN_SUBJECT);
const DAY_MINUTES = 1440;
const SELECT_A_MASTER = "Select a Master who is available";
const NO_LONGER_WAITING = "This referral is no longer waiting to be sent";
// Wednesday 28 October 2026, GMT: inside the morning window (07:00-10:30), and between the two windows.
const MORNING = "2026-10-28T08:00:00Z";
const BETWEEN = "2026-10-28T11:00:00Z";
const REASONS = { reasons: ["Minor", "MinorTransgender"] };

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

describe("raising a referral", () => {
  it("should leave every new referral Open, waiting to be sent, whatever masterId the body carries", async () => {
    // Arrange
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    const caseId = newCase();

    // Act
    const created = await raise(caseId, { ...REASONS, masterId: sullivan });

    // Assert
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ state: "Open", claimedBy: null, assignedMaster: null, assignedAt: null, windowDate: null, directionDueBy: null });
    expect(caseState(caseId)).toBe("Open");
  });

  it("should write one note saying it waits to be sent to a Master", async () => {
    // Arrange
    const caseId = newCase();

    // Act
    await raise(caseId, { reasons: ["Other"], notes: "See the letter" });

    // Assert
    expect(noteTexts(caseId)).toEqual(["Referral raised, waiting to be sent to a Master. Reasons: Other.\nNotes: See the letter"]);
  });
});

describe("GET /caseworker/referral-queue", () => {
  it.each([
    ["a Team leader", TEAM_LEADER],
    ["a Delivery Manager", DELIVERY_MANAGER],
    ["the legacy admin", LEGACY_ADMIN]
  ])("should admit %s", async (_, accessToken) => {
    // Act
    const read = await call("GET", "/caseworker/referral-queue", undefined, accessToken);

    // Assert
    expect(read.status).toBe(200);
  });

  it("should refuse a caseworker with 403, and an unauthenticated caller with 401", async () => {
    // Act
    const refused = await call("GET", "/caseworker/referral-queue?state=Nonsense", undefined, CASEWORKER);
    const anonymous = await fetch(`${mock.url}/caseworker/referral-queue`);

    // Assert
    expect(refused.status).toBe(403);
    expect(anonymous.status).toBe(401);
  });

  it("should list Open referrals across every case, urgent first, then the oldest raised", async () => {
    // Arrange
    const raiseAt = async (at: string, urgent: boolean) => {
      await clockAt(at);
      const body = urgent ? { ...REASONS, urgency: "Urgent", urgencyReason: "Hearing" } : REASONS;
      return (await raise(newCase(), body)).json.id;
    };
    const normalOld = await raiseAt("2026-10-20T08:00:00Z", false);
    const urgentNew = await raiseAt("2026-10-23T08:00:00Z", true);
    const normalNew = await raiseAt("2026-10-22T08:00:00Z", false);
    const urgentOld = await raiseAt("2026-10-21T08:00:00Z", true);

    // Act
    const read = await queue("");

    // Assert
    expect(read.json.referrals.map((row) => row.id)).toEqual([urgentOld, urgentNew, normalOld, normalNew]);
    expect(read.json).toMatchObject({ page: 1, size: 25, total: 4, totalPages: 1 });
  });

  it("should list Claimed referrals the oldest sent first, leaving Open ones out", async () => {
    // Arrange
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    const first = (await raise(newCase(), REASONS)).json.id;
    const second = (await raise(newCase(), REASONS)).json.id;
    await raise(newCase(), REASONS);
    await clockAt(MORNING);
    await sendAll([{ referralId: second, masterId: sullivan }]);
    await clockAt("2026-10-28T08:30:00Z");
    await sendAll([{ referralId: first, masterId: sullivan }]);

    // Act
    const read = await queue("?state=Claimed");

    // Assert
    expect(read.json.referrals.map((row) => row.id)).toEqual([second, first]);
  });

  it("should page as the case list pages", async () => {
    // Arrange
    for (let i = 0; i < 3; i++) await raise(newCase(), REASONS);

    // Act
    const read = await queue("?page=2&size=2");

    // Assert
    expect(read.json).toMatchObject({ page: 2, size: 2, total: 3, totalPages: 2 });
    expect(read.json.referrals).toHaveLength(1);
  });

  it("should refuse a state other than Open or Claimed on state", async () => {
    // Act
    const refused = await queue("?state=Decided");

    // Assert
    expect(refused.status).toBe(400);
    expect(refused.json.errors.map((error) => error.field)).toEqual(["state"]);
  });

  it("should carry what the checker compares from the case, and for a sent one who has it", async () => {
    // Arrange
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    const record = mock.seed({
      state: "ReadyForMaster",
      newForename: "Ada",
      newSurname: "Lovelace",
      oldSurname: "Byron",
      type: "Adult",
      nationality: "BritishCitizen"
    });
    records.set(record.id, record);
    const referralId = (await raise(record.id, { reasons: ["Other"], notes: "x", urgency: "Urgent", urgencyReason: "Hearing" })).json.id;
    await clockAt(MORNING);
    await sendAll([{ referralId, masterId: sullivan }]);

    // Act
    const row = (await queue("?state=Claimed")).json.referrals[0];

    // Assert
    expect(row).toMatchObject({
      id: referralId,
      caseId: record.id,
      displayReference: record.displayReference,
      state: "Claimed",
      newForename: "Ada",
      newSurname: "Lovelace",
      oldSurname: "Byron",
      type: "Adult",
      nationality: "BritishCitizen",
      reasons: ["Other"],
      urgency: "Urgent",
      urgencyReason: "Hearing",
      createdBy: "Casey Worker",
      assignedMaster: { id: sullivan, name: "Master Sullivan" },
      windowDate: "2026-10-28",
      windowSlot: "AM"
    });
    expect(Date.parse(row.directionDueBy) - Date.parse(row.assignedAt)).toBe(7 * DAY_MINUTES * 60_000);
  });

  it("should carry the open window, its cap and what has been sent in it, in total and by each available Master", async () => {
    // Arrange
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    const wren = await master("Master Wren", "wren@example.test");
    await master("Master Away", "away@example.test", false);
    const one = (await raise(newCase(), REASONS)).json.id;
    const two = (await raise(newCase(), REASONS)).json.id;
    await clockAt(MORNING);
    await sendAll([
      { referralId: one, masterId: sullivan },
      { referralId: two, masterId: sullivan }
    ]);

    // Act
    const { window } = (await queue("")).json;

    // Assert
    expect(window).toEqual({
      current: { date: "2026-10-28", slot: "AM", closesAt: "2026-10-28T10:30:00.000Z" },
      next: { date: "2026-10-28", slot: "PM", opensAt: "2026-10-28T14:00:00.000Z" },
      cap: 10,
      sent: 2,
      masters: [
        { id: sullivan, name: "Master Sullivan", sentInWindow: 2 },
        { id: wren, name: "Master Wren", sentInWindow: 0 }
      ]
    });
  });

  it("should carry no open window and nothing sent between the windows, naming the next", async () => {
    // Arrange
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    const one = (await raise(newCase(), REASONS)).json.id;
    await clockAt(MORNING);
    await sendAll([{ referralId: one, masterId: sullivan }]);
    await clockAt(BETWEEN);

    // Act
    const { window } = (await queue("")).json;

    // Assert
    expect(window).toMatchObject({
      current: null,
      next: { date: "2026-10-28", slot: "PM", opensAt: "2026-10-28T14:00:00.000Z" },
      sent: 0,
      masters: [{ id: sullivan, sentInWindow: 0 }]
    });
  });

  it.each([
    ["a Saturday", "2026-10-31T08:00:00Z", "2026-11-02"],
    ["a bank holiday", "2026-12-25T08:00:00Z", "2026-12-29"]
  ])("should open no window on %s, the next being the next working day's morning", async (_, at, date) => {
    // Arrange
    await clockAt(at);

    // Act
    const { window } = (await queue("")).json;

    // Assert
    expect(window).toMatchObject({ current: null, next: { date, slot: "AM" } });
  });
});

describe("POST /caseworker/referral-queue/sends", () => {
  it("should refuse a caseworker with 403 before the body is read", async () => {
    // Act
    const refused = await call("POST", "/caseworker/referral-queue/sends", { nonsense: true }, CASEWORKER);

    // Assert
    expect(refused.status).toBe(403);
  });

  it("should send each referral to its Master in the open window, with a note each", async () => {
    // Arrange
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    const wren = await master("Master Wren", "wren@example.test");
    const firstCase = newCase();
    const secondCase = newCase();
    const first = (await raise(firstCase, REASONS)).json.id;
    const second = (await raise(secondCase, { reasons: ["Other"], notes: "x" })).json.id;
    await clockAt(MORNING);

    // Act
    const sent = await send([
      { referralId: first, masterId: sullivan },
      { referralId: second, masterId: wren }
    ]);

    // Assert
    expect(sent.status).toBe(200);
    expect(sent.json.referrals.map((row) => [row.id, row.state, row.assignedMaster.name])).toEqual([
      [first, "Claimed", "Master Sullivan"],
      [second, "Claimed", "Master Wren"]
    ]);
    expect(sent.json.window).toMatchObject({ sent: 2, current: { date: "2026-10-28", slot: "AM" } });
    expect(caseState(firstCase)).toBe("Claimed");
    expect(noteTexts(firstCase).at(-1)).toMatch(
      /^Referral raised on \d{1,2} \w+ \d{4}, reasons: Applicant is a minor: Transgender, sent to Master Sullivan by the office\.$/
    );
    expect(noteTexts(secondCase).at(-1)).toMatch(/^Referral raised on \d{1,2} \w+ \d{4}, reasons: Other, sent to Master Wren by the office\.$/);
    expect(records.get(firstCase)?.notes.at(-1)?.createdBy).toBe("Terry Leader");
  });

  it("should say 'this afternoon' of the afternoon window and send in it", async () => {
    // Arrange
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    const referralId = (await raise(newCase(), REASONS)).json.id;
    await clockAt("2026-10-28T14:10:00Z");

    // Act
    const sent = await send([{ referralId, masterId: sullivan }]);

    // Assert
    expect(sent.json.referrals[0]).toMatchObject({ windowDate: "2026-10-28", windowSlot: "PM" });
  });

  it.each([
    [{}, "allocations"],
    [{ allocations: [] }, "allocations"],
    [{ allocations: ["x"] }, "allocations[0]"],
    [{ allocations: [{ referralId: "not-a-uuid", masterId: "00000000-0000-4000-8000-000000000000" }] }, "allocations[0].referralId"],
    [{ allocations: [{ referralId: "00000000-0000-4000-8000-000000000001" }] }, "allocations[0].masterId"]
  ])("should refuse the body %j with a 400 naming %s", async (body, field) => {
    // Arrange
    await clockAt(MORNING);

    // Act
    const refused = await call("POST", "/caseworker/referral-queue/sends", body, TEAM_LEADER);

    // Assert
    expect(refused.status).toBe(400);
    expect(refused.json.errors.map((error) => error.field)).toEqual([field]);
  });

  it("should refuse a referral named twice on its second entry", async () => {
    // Arrange
    const id = "00000000-0000-4000-8000-000000000001";
    const masterId = "00000000-0000-4000-8000-000000000002";

    // Act
    const refused = await send([
      { referralId: id, masterId },
      { referralId: id, masterId }
    ]);

    // Assert
    expect(refused.json.errors).toEqual([{ field: "allocations[1].referralId", message: "This referral is in the send more than once" }]);
  });

  it("should refuse more than a hundred referrals at once", async () => {
    // Arrange
    const allocations = Array.from({ length: 101 }, (_, i) => ({
      referralId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      masterId: "00000000-0000-4000-8000-000000000999"
    }));

    // Act
    const refused = await send(allocations);

    // Assert
    expect(refused.json.errors).toEqual([{ field: "allocations", message: "Send at most 100 referrals at once" }]);
  });

  it.each([
    ["before the morning's opens", "2026-10-28T06:00:00Z", "The next one opens at 07:00 today."],
    ["between the windows", BETWEEN, "The next one opens at 14:00 today."],
    ["after the afternoon's closes", "2026-10-28T15:00:00Z", "The next one opens at 07:00 tomorrow."],
    ["on a Friday evening", "2026-10-30T15:00:00Z", "The next one opens at 07:00 on Monday 2 November 2026."]
  ])("should refuse a send %s with a 409 naming when the next window opens, and write nothing", async (_, at, sentence) => {
    // Arrange
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    const caseId = newCase();
    const referralId = (await raise(caseId, REASONS)).json.id;
    await clockAt(at);

    // Act
    const refused = await send([{ referralId, masterId: sullivan }]);

    // Assert
    expect(refused.status).toBe(409);
    expect(refused.json.error).toBe(`Referrals can only be sent during a referral window. ${sentence}`);
    expect(caseState(caseId)).toBe("Open");
    expect(noteTexts(caseId)).toHaveLength(1);
  });

  it("should refuse a referral no longer waiting on its own entry, sending none of the others", async () => {
    // Arrange
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    const waitingCase = newCase();
    const waiting = (await raise(waitingCase, REASONS)).json.id;
    const withdrawnCase = newCase();
    const withdrawn = (await raise(withdrawnCase, REASONS)).json.id;
    await call("POST", `/caseworker/cases/${withdrawnCase}/referrals/${withdrawn}/withdrawal`, undefined, CASEWORKER);
    await clockAt(MORNING);

    // Act
    const refused = await send([
      { referralId: waiting, masterId: sullivan },
      { referralId: withdrawn, masterId: sullivan },
      { referralId: "00000000-0000-4000-8000-000000000001", masterId: sullivan }
    ]);

    // Assert
    expect(refused.status).toBe(409);
    expect(refused.json.errors).toEqual([
      { field: "allocations[1].referralId", message: NO_LONGER_WAITING },
      { field: "allocations[2].referralId", message: NO_LONGER_WAITING }
    ]);
    expect(caseState(waitingCase)).toBe("Open");
  });

  it("should refuse a referral already sent to another Master as no longer waiting", async () => {
    // Arrange
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    const wren = await master("Master Wren", "wren@example.test");
    const referralId = (await raise(newCase(), REASONS)).json.id;
    await clockAt(MORNING);
    await sendAll([{ referralId, masterId: sullivan }]);

    // Act
    const refused = await send([{ referralId, masterId: wren }]);

    // Assert
    expect(refused.status).toBe(409);
    expect(refused.json.errors).toEqual([{ field: "allocations[0].referralId", message: NO_LONGER_WAITING }]);
  });

  it("should treat the same send again in the same window as a replay that writes nothing", async () => {
    // Arrange
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    const caseId = newCase();
    const referralId = (await raise(caseId, REASONS)).json.id;
    await clockAt(MORNING);
    const first = await send([{ referralId, masterId: sullivan }]);

    // Act
    const again = await send([{ referralId, masterId: sullivan }]);

    // Assert
    expect(again.status).toBe(200);
    expect(again.json.referrals[0].assignedAt).toBe(first.json.referrals[0].assignedAt);
    expect(again.json.window.sent).toBe(1);
    expect(noteTexts(caseId)).toHaveLength(2);
  });

  it("should not treat the same send in a later window as a replay", async () => {
    // Arrange
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    const referralId = (await raise(newCase(), REASONS)).json.id;
    await clockAt(MORNING);
    await sendAll([{ referralId, masterId: sullivan }]);
    await clockAt("2026-10-28T14:10:00Z");

    // Act
    const refused = await send([{ referralId, masterId: sullivan }]);

    // Assert
    expect(refused.status).toBe(409);
  });

  it("should refuse an unknown or unavailable Master on that entry's masterId, sending nothing", async () => {
    // Arrange
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    const away = await master("Master Away", "away@example.test", false);
    const firstCase = newCase();
    const first = (await raise(firstCase, REASONS)).json.id;
    const second = (await raise(newCase(), REASONS)).json.id;
    const third = (await raise(newCase(), REASONS)).json.id;
    await clockAt(MORNING);

    // Act
    const refused = await send([
      { referralId: first, masterId: sullivan },
      { referralId: second, masterId: away },
      { referralId: third, masterId: "00000000-0000-4000-8000-000000000000" }
    ]);

    // Assert
    expect(refused.status).toBe(400);
    expect(refused.json.errors).toEqual([
      { field: "allocations[1].masterId", message: SELECT_A_MASTER },
      { field: "allocations[2].masterId", message: SELECT_A_MASTER }
    ]);
    expect(caseState(firstCase)).toBe("Open");
  });

  it("should send up to the cap across all Masters exactly, and refuse one past it, saying how many more fit", async () => {
    // Arrange
    await setCap(3);
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    const wren = await master("Master Wren", "wren@example.test");
    const ids = [];
    for (let i = 0; i < 4; i++) ids.push((await raise(newCase(), REASONS)).json.id);
    await clockAt(MORNING);
    await sendAll([{ referralId: ids[0], masterId: sullivan }]);

    // Act
    const over = await send([
      { referralId: ids[1], masterId: sullivan },
      { referralId: ids[2], masterId: wren },
      { referralId: ids[3], masterId: wren }
    ]);
    const exactly = await send([
      { referralId: ids[1], masterId: sullivan },
      { referralId: ids[2], masterId: wren }
    ]);
    const full = await send([{ referralId: ids[3], masterId: wren }]);

    // Assert
    expect(over.status).toBe(409);
    expect(over.json.error).toBe("Only 2 more referrals can be sent this morning. Remove 1 and try again.");
    expect(over.json.errors).toBeUndefined();
    expect(exactly.status).toBe(200);
    expect(full.json.error).toBe("No more referrals can be sent this morning.");
  });

  it("should say one more referral in the singular", async () => {
    // Arrange
    await setCap(1);
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    const one = (await raise(newCase(), REASONS)).json.id;
    const two = (await raise(newCase(), REASONS)).json.id;
    await clockAt(MORNING);

    // Act
    const refused = await send([
      { referralId: one, masterId: sullivan },
      { referralId: two, masterId: sullivan }
    ]);

    // Assert
    expect(refused.json.error).toBe("Only 1 more referral can be sent this morning. Remove 1 and try again.");
  });

  it("should count a referral sent and then withdrawn against the window, giving no place back (A-2)", async () => {
    // Arrange
    await setCap(1);
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    const caseId = newCase();
    const first = (await raise(caseId, REASONS)).json.id;
    const second = (await raise(newCase(), REASONS)).json.id;
    await clockAt(MORNING);
    await sendAll([{ referralId: first, masterId: sullivan }]);
    await call("POST", `/caseworker/cases/${caseId}/referrals/${first}/withdrawal`, undefined, CASEWORKER);

    // Act
    const refused = await send([{ referralId: second, masterId: sullivan }]);

    // Assert
    expect(refused.json.error).toBe("No more referrals can be sent this morning.");
    expect((await queue("")).json.window.sent).toBe(1);
  });

  it("should count an urgent referral towards the cap like any other", async () => {
    // Arrange
    await setCap(1);
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    const urgent = (await raise(newCase(), { ...REASONS, urgency: "Urgent", urgencyReason: "Hearing" })).json.id;
    const normal = (await raise(newCase(), REASONS)).json.id;
    await clockAt(MORNING);
    await sendAll([{ referralId: urgent, masterId: sullivan }]);

    // Act
    const refused = await send([{ referralId: normal, masterId: sullivan }]);

    // Assert
    expect(refused.status).toBe(409);
  });
});

describe("PUT …/assignment, reassigning", () => {
  it("should refuse a caseworker with 403 before the case is read", async () => {
    // Act
    const refused = await call("PUT", "/caseworker/cases/no-such-case/referrals/no-such/assignment", { masterId: "x" }, CASEWORKER);

    // Assert
    expect(refused.status).toBe(403);
  });

  it("should move a sent referral to another Master outside any window, past a full cap, keeping its window", async () => {
    // Arrange
    await setCap(1);
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    const wren = await master("Master Wren", "wren@example.test");
    const caseId = newCase();
    const referralId = (await raise(caseId, REASONS)).json.id;
    await clockAt(MORNING);
    const sent = await send([{ referralId, masterId: sullivan }]);
    await clockAt("2026-10-29T20:00:00Z");

    // Act
    const moved = await reassign(caseId, referralId, wren);

    // Assert
    expect(moved.status).toBe(200);
    expect(moved.json).toMatchObject({ state: "Claimed", claimedBy: "Master Wren", assignedMaster: { id: wren }, windowDate: "2026-10-28", windowSlot: "AM" });
    expect(Date.parse(moved.json.assignedAt) - Date.parse(sent.json.referrals[0].assignedAt)).toBeGreaterThan(DAY_MINUTES * 60_000);
    expect(noteTexts(caseId).at(-1)).toMatch(/, reassigned from Master Sullivan to Master Wren\.$/);
  });

  it("should count a reassigned referral under its new Master in its window", async () => {
    // Arrange
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    const wren = await master("Master Wren", "wren@example.test");
    const caseId = newCase();
    const referralId = (await raise(caseId, REASONS)).json.id;
    await clockAt(MORNING);
    await sendAll([{ referralId, masterId: sullivan }]);

    // Act
    await reassign(caseId, referralId, wren);

    // Assert
    const { window } = (await queue("")).json;
    expect(window.sent).toBe(1);
    expect(window.masters.map((entry) => [entry.name, entry.sentInWindow])).toEqual([
      ["Master Sullivan", 0],
      ["Master Wren", 1]
    ]);
  });

  it("should refuse an Open referral, which is sent from the queue", async () => {
    // Arrange
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    const caseId = newCase();
    const referralId = (await raise(caseId, REASONS)).json.id;

    // Act
    const refused = await reassign(caseId, referralId, sullivan);

    // Assert
    expect(refused.status).toBe(409);
    expect(refused.json.error).toBe("Send this referral from the queue: it has not been sent to a Master yet.");
    expect(caseState(caseId)).toBe("Open");
  });

  it("should treat the Master it already has as a no-op that writes nothing", async () => {
    // Arrange
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    const caseId = newCase();
    const referralId = (await raise(caseId, REASONS)).json.id;
    await clockAt(MORNING);
    const sent = await send([{ referralId, masterId: sullivan }]);
    await clockAt(BETWEEN);

    // Act
    const same = await reassign(caseId, referralId, sullivan);

    // Assert
    expect(same.status).toBe(200);
    expect(same.json.assignedAt).toBe(sent.json.referrals[0].assignedAt);
    expect(noteTexts(caseId)).toHaveLength(2);
  });

  it("should refuse a directed referral with a 409, and an unknown Master on masterId", async () => {
    // Arrange
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    const wren = await master("Master Wren", "wren@example.test");
    await link(SULLIVAN);
    const caseId = newCase();
    const referralId = (await raise(caseId, REASONS)).json.id;
    await clockAt(MORNING);
    await sendAll([{ referralId, masterId: sullivan }]);

    // Act
    const unknown = await reassign(caseId, referralId, "00000000-0000-4000-8000-000000000000");
    await direct(referralId, SULLIVAN);
    const directed = await reassign(caseId, referralId, wren);

    // Assert
    expect(unknown.status).toBe(400);
    expect(unknown.json.errors).toEqual([{ field: "masterId", message: SELECT_A_MASTER }]);
    expect(directed.status).toBe(409);
  });
});

describe("the Master's side", () => {
  it("should show a linked Master a sent referral by id and on their list, and nobody else", async () => {
    // Arrange
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    await master("Master Wren", "wren@example.test");
    await link(SULLIVAN);
    await link(WREN);
    const referralId = await sentTo(newCase(), sullivan);

    // Act
    const own = await call("GET", `/judicial/referrals/${referralId}`, undefined, SULLIVAN);
    const other = await call("GET", `/judicial/referrals/${referralId}`, undefined, WREN);

    // Assert
    expect(own.status).toBe(200);
    expect(own.json).toMatchObject({ state: "Claimed", claimedBy: "Master Sullivan" });
    expect(own.json.directionDueBy).toEqual(expect.any(String));
    expect(other.status).toBe(404);
    expect(await mine(SULLIVAN)).toEqual([referralId]);
    expect(await mine(WREN)).toEqual([]);
  });

  it("should show a referral waiting in the queue to no judge, and leave the pool empty", async () => {
    // Arrange
    await master("Master Sullivan", "sullivan@example.test");
    await link(SULLIVAN);
    const referralId = (await raise(newCase(), REASONS)).json.id;

    // Act
    const read = await call("GET", `/judicial/referrals/${referralId}`, undefined, SULLIVAN);
    const pool = await call("GET", "/judicial/referrals", undefined, SULLIVAN);
    const claim = await call("POST", `/judicial/referrals/${referralId}/claim`, undefined, SULLIVAN);

    // Assert
    expect(read.status).toBe(404);
    expect(pool.json).toEqual({ referrals: [], page: 1, size: 10, total: 0, totalPages: 0 });
    expect(claim.status).toBe(404);
  });

  it("should keep a referral sent to a Master who has never signed in from everyone until they are linked", async () => {
    // Arrange
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    const referralId = await sentTo(newCase(), sullivan);
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
    const referralId = await sentTo(newCase(), sullivan);

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

  it("should restart the processing window when a direction is withdrawn, keeping the window it was sent in", async () => {
    // Arrange
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    await link(SULLIVAN);
    const referralId = await sentTo(newCase(), sullivan);
    const sentAt = (await call("GET", `/judicial/referrals/${referralId}`, undefined, SULLIVAN)).json.assignedAt;
    await direct(referralId, SULLIVAN);
    await clockAt("2026-10-29T08:00:00Z");

    // Act
    const withdrawn = await call("POST", `/judicial/referrals/${referralId}/direction/withdraw`, undefined, SULLIVAN);

    // Assert
    expect(withdrawn.json).toMatchObject({ state: "Claimed", claimedBy: "Master Sullivan" });
    expect(Date.parse(withdrawn.json.assignedAt) - Date.parse(sentAt)).toBeGreaterThan(23 * 60 * 60_000);
    const stored = [...records.values()].flatMap((record) => record.referrals).find((referral) => referral.id === referralId);
    expect(stored).toMatchObject({ windowDate: "2026-10-28", windowSlot: "AM" });
  });

  it("should list a Master's referrals undirected first, urgent first among those only, then the oldest sent, then directed", async () => {
    // Arrange
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    await link(SULLIVAN);
    const raised = async (urgent: boolean) => {
      const body = urgent ? { reasons: ["Other"], notes: "x", urgency: "Urgent", urgencyReason: "Hearing" } : { reasons: ["Other"], notes: "x" };
      return (await raise(newCase(), body)).json.id as string;
    };
    // Raised in one order and sent in the opposite one, so only the day sent can produce the expected order.
    const urgentNew = await raised(true);
    const normalNew = await raised(false);
    const urgentOld = await raised(true);
    const normalOld = await raised(false);
    const directedNewUrgent = await raised(true);
    const directedOldNormal = await raised(false);
    const sendAt = async (at: string, referralId: string) => {
      await clockAt(at);
      await sendAll([{ referralId, masterId: sullivan }]);
    };
    await sendAt("2026-10-19T08:00:00Z", directedOldNormal);
    await sendAt("2026-10-20T08:00:00Z", directedNewUrgent);
    await sendAt("2026-10-21T08:00:00Z", normalOld);
    await sendAt("2026-10-22T08:00:00Z", urgentOld);
    await sendAt("2026-10-23T08:00:00Z", normalNew);
    await sendAt("2026-10-26T08:00:00Z", urgentNew);
    await direct(directedNewUrgent, SULLIVAN);
    await direct(directedOldNormal, SULLIVAN);

    // Act
    const order = await mine(SULLIVAN, 20);

    // Assert
    expect(order).toEqual([urgentOld, urgentNew, normalOld, normalNew, directedOldNormal, directedNewUrgent]);
  });
});

describe("the processing window", () => {
  it("should return a sent referral with no direction to the queue once its window has passed, and not before", async () => {
    // Arrange
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    await link(SULLIVAN);
    const caseId = newCase();
    const referralId = (await raise(caseId, REASONS)).json.id;
    await clockAt("2026-10-21T08:00:00Z");
    await sendAll([{ referralId, masterId: sullivan }]);
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
    expect(last?.note).toMatch(
      /^Referral raised on \d{1,2} \w+ \d{4}, reasons: Applicant is a minor: Transgender, returned to the queue to be sent again: no direction from Master Sullivan within 7 days\.$/
    );
    expect(last?.createdBy).toBe("# svc_HMCTS_LCPT_Dev");
    expect(await mine(SULLIVAN)).toEqual([]);
    expect((await queue("")).json.referrals.map((row) => row.id)).toEqual([referralId]);
  });

  it("should sweep on a Master's list read, as api's request-time trigger does", async () => {
    // Arrange
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    await link(SULLIVAN);
    const caseId = newCase();
    const referralId = (await raise(caseId, REASONS)).json.id;
    await clockAt("2026-10-21T08:00:00Z");
    await sendAll([{ referralId, masterId: sullivan }]);
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
    const referralId = (await raise(newCase(), REASONS)).json.id;
    await clockAt("2026-10-01T08:00:00Z");
    await sendAll([{ referralId, masterId: sullivan }]);
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
    const referralId = await sentTo(caseId, sullivan);
    await call("PUT", "/caseworker/process-settings", { referralClaimExpiryMinutes: 2 * DAY_MINUTES, revision: 0 });

    // Act
    const read = await call("GET", `/caseworker/cases/${caseId}/referrals/${referralId}`, undefined, CASEWORKER);

    // Assert
    expect(Date.parse(read.json.directionDueBy) - Date.parse(read.json.assignedAt)).toBe(2 * DAY_MINUTES * 60_000);
  });
});

describe("POST /__mock/clock", () => {
  it("should refuse an offset that is not a whole number of minutes, or an unknown window", async () => {
    // Act
    const refused = await call("POST", "/__mock/clock", { offsetMinutes: "soon" });
    const unknown = await call("POST", "/__mock/clock", { window: "ajar" });

    // Assert
    expect(refused.status).toBe(400);
    expect(unknown.status).toBe(400);
  });

  it("should place the clock inside the next morning window, or just after it", async () => {
    // Act
    const opened = await call("POST", "/__mock/clock", { window: "open" });
    const insideWindow = (await queue("")).json.window.current;
    const closed = await call("POST", "/__mock/clock", { window: "closed" });
    const afterWindow = (await queue("")).json.window.current;

    // Assert
    expect(insideWindow).toMatchObject({ slot: "AM" });
    expect(afterWindow).toBeNull();
    expect(Date.parse(closed.json.now)).toBeGreaterThan(Date.parse(opened.json.now));
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

describe("what the queue and assignment publish", () => {
  it("should never carry the Master's subject or email in a caseworker, queue or judicial response", async () => {
    // Arrange
    const sullivan = await master("Master Sullivan", "sullivan@example.test");
    await link(SULLIVAN);
    const caseId = newCase();
    const referralId = (await raise(caseId, REASONS)).json.id;
    await clockAt(MORNING);
    const sent = await send([{ referralId, masterId: sullivan }]);

    // Act
    const responses = [
      sent.text,
      (await queue("?state=Claimed")).text,
      (await call("GET", `/caseworker/cases/${caseId}/referrals`, undefined, CASEWORKER)).text,
      (await call("GET", `/judicial/referrals/${referralId}`, undefined, SULLIVAN)).text,
      (await call("GET", "/judicial/referrals/mine", undefined, SULLIVAN)).text
    ];

    // Assert
    for (const text of responses) {
      expect(text).not.toContain(SULLIVAN_SUBJECT);
      expect(text).not.toContain("sullivan@example.test");
      expect(text).not.toContain("assignedMasterId");
    }
  });

  it("should list the Masters with no window, cap or count since api F1", async () => {
    // Arrange
    await master("Master Sullivan", "sullivan@example.test");

    // Act
    const listed = await call("GET", "/caseworker/masters", undefined, CASEWORKER);

    // Assert
    expect(Object.keys(listed.json)).toEqual(["masters"]);
    expect(Object.keys(listed.json.masters[0]).sort()).toEqual(["available", "email", "id", "linked", "name", "revision"]);
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
    windowCap: cap,
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

function queue(query: string) {
  return call("GET", `/caseworker/referral-queue${query}`, undefined, TEAM_LEADER);
}

function send(allocations: { referralId: string; masterId: string }[]) {
  return call("POST", "/caseworker/referral-queue/sends", { allocations }, TEAM_LEADER);
}

async function sendAll(allocations: { referralId: string; masterId: string }[]): Promise<void> {
  const sent = await send(allocations);
  if (sent.status !== 200) throw new Error(`Expected a send, got ${sent.status}: ${sent.text}`);
}

/** Raised on the case and sent to the Master in Wednesday's morning window, the clock left there. */
async function sentTo(caseId: string, masterId: string): Promise<string> {
  const referralId = (await raise(caseId, REASONS)).json.id;
  await clockAt(MORNING);
  await sendAll([{ referralId, masterId }]);
  return referralId;
}

function reassign(caseId: string, referralId: string, masterId: string) {
  return call("PUT", `/caseworker/cases/${caseId}/referrals/${referralId}/assignment`, { masterId }, TEAM_LEADER);
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
  referrals: QueueRow[];
  masters: { id: string; name: string }[];
  window: { current: unknown; sent: number; masters: { name: string; sentInWindow: number }[] };
  released: number;
  now: string;
  revision: number;
  referralClaimExpiryMinutes: number;
  0: { assignedMaster: unknown };
}

interface QueueRow {
  id: string;
  state: string;
  assignedAt: string;
  directionDueBy: string;
  assignedMaster: { name: string };
}
