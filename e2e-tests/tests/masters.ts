/**
 * Masters and sending, arranged through the mock api for the journeys that need a referral in a Master's hands
 * (plans Db1 and Fa1).
 *
 * Since api F1 a referral is raised into the queue (`Open`, visible to no judge) and reaches a Master only when a
 * Team leader or Delivery Manager sends it, inside a referral window. So a journey that needs a judge to see or
 * direct a referral raises it, then sends it with `sendToMaster`, which is what this file does.
 *
 * **The window and its cap are the whole service's, and the mock's clock is global.** `openWindowWithRoom` therefore
 * only ever moves the clock *into* an open window, never out of one, so journeys in parallel workers never undo each
 * other's window; and when this run's window is full (the cap is across all Masters, and the store outlives a run
 * under `reuseExistingServer`) it moves a week on, to the same morning window, until one has room. The journeys that
 * close the window or lower the cap run on a mock of their own (`referral-queue.spec.ts`, `yarn test:referrals`).
 *
 * `newMaster` mints a unique entry and a unique judge linked to it. `judgePersonaMaster` is the one shared entry,
 * because only the signed-in `judge@example.com` can read a referral in a browser.
 *
 * The tokens are hand-built, as every spec's `bearer` is: the mock decodes the middle segment and verifies no
 * signature. The roles are carried in the token because the mock reads them from it, and only the Masters writes
 * and the judicial link need them.
 */
import { type APIRequestContext, expect } from "@playwright/test";
import { JUDGE_EMAIL } from "./idam-session.js";

/**
 * The mock api, which `playwright.config.ts` starts on 3200 beside the app on 3000. A spec whose config starts its
 * own mock passes that one's address instead.
 */
const MOCK_API_URL = process.env.DEED_POLL_API_URL ?? "http://localhost:3200";

/** The only role that may add or change a Master. */
const DELIVERY_MANAGER = { sub: "e2e.masters.delivery-manager", roles: ["caseworker-deedpoll-delivery-manager"] };

/** One of the two roles holding `ALLOCATE_REFERRALS`, which reading and sending from the queue need. */
const TEAM_LEADER = { sub: "e2e.masters.team-leader", roles: ["caseworker-deedpoll-team-leader"] };

const JUDICIAL_ROLE = "caseworker-deedpoll-judicial";

/** How far to move on when a window is full or a bank holiday: a week keeps the same weekday's morning window. */
const A_WEEK_IN_MINUTES = 7 * 24 * 60;

/** How many weeks on `openWindowWithRoom` looks before giving up, which only a store sent to its cap 12 times hits. */
const WEEKS_TO_TRY = 12;

/** The name `yarn mock:seed` gives the judge persona's entry, reused so a seeded mock and a fresh one agree. */
const JUDGE_PERSONA_MASTER_NAME = "Master Judge";

/**
 * The judge persona's Masters-list entry, added if the mock has none, made available if it is not, and linked to
 * `judge@example.com`'s subject (the simulator's token carries the email as its subject).
 */
export async function judgePersonaMaster(request: APIRequestContext, mock = MOCK_API_URL): Promise<Master> {
  return listedAndLinked(request, mock, { name: JUDGE_PERSONA_MASTER_NAME, email: JUDGE_EMAIL, subject: JUDGE_EMAIL });
}

/**
 * A Master nobody else uses, and the judge linked to it. `label` goes into the name, so a journey that picks a
 * Master on a form can tell its own apart from every other run's.
 */
export async function newMaster(request: APIRequestContext, label: string, mock = MOCK_API_URL): Promise<Master> {
  const token = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const email = `e2e.master.${token}@example.com`;

  return listedAndLinked(request, mock, { name: `Master ${label} ${token}`, email, subject: email });
}

/**
 * Send a queued referral to a Master through the contract route, as the Referrals screen does. Retried once a window
 * with room is found again, because another worker may take the last place between the check and the send.
 */
export async function sendToMaster(request: APIRequestContext, referralId: string, masterId: string, mock = MOCK_API_URL): Promise<void> {
  let refusal = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    await openWindowWithRoom(request, 1, mock);
    const response = await request.post(`${mock}/caseworker/referral-queue/sends`, {
      headers: bearer(TEAM_LEADER),
      data: { allocations: [{ referralId, masterId }] }
    });
    if (response.status() === 200) return;
    refusal = `${response.status()} ${await response.text()}`;
    if (response.status() !== 409) break;
  }
  throw new Error(`could not send referral ${referralId}: ${refusal}`);
}

/**
 * Leave the mock's referral clock inside an open window with room for `room` more sends: as it is if it already is,
 * otherwise just inside the next morning window, or the same window a week on, and so on.
 */
export async function openWindowWithRoom(request: APIRequestContext, room: number, mock = MOCK_API_URL): Promise<void> {
  if (await hasRoom(request, mock, room)) return;
  const opened = await request.post(`${mock}/__mock/clock`, { data: { window: "open" } });
  expect(opened.status(), await opened.text()).toBe(200);
  const morning: number = (await opened.json()).offsetMinutes;

  for (let week = 0; week < WEEKS_TO_TRY; week++) {
    if (week > 0) {
      const moved = await request.post(`${mock}/__mock/clock`, { data: { offsetMinutes: morning + week * A_WEEK_IN_MINUTES } });
      expect(moved.status(), await moved.text()).toBe(200);
    }
    if (await hasRoom(request, mock, room)) return;
  }
  throw new Error(`no referral window with room for ${room} in the next ${WEEKS_TO_TRY} weeks`);
}

/**
 * A bearer token for a claim set. Exported for the journeys whose judge is a `Master`: `master.judge` is the
 * subject a direction must be posted as, since api shows an assigned referral to its Master's linked subject only.
 */
export function bearer(claims: Record<string, unknown>): Record<string, string> {
  return { authorization: `Bearer x.${Buffer.from(JSON.stringify(claims), "utf8").toString("base64url")}.signature` };
}

async function listedAndLinked(request: APIRequestContext, mock: string, wanted: { name: string; email: string; subject: string }): Promise<Master> {
  const listed = (await mastersList(request, mock)).masters.find((master) => master.email.toLowerCase() === wanted.email.toLowerCase());
  const master = listed ?? (await addMaster(request, mock, wanted));
  if (!master.available) {
    const changed = await request.patch(`${mock}/caseworker/masters/${master.id}`, {
      headers: bearer(DELIVERY_MANAGER),
      data: { available: true, revision: master.revision }
    });
    expect(changed.status(), await changed.text()).toBe(200);
  }

  // api links a judge to the entry holding their email on their first judicial request (`MasterLinking`), so
  // asking for their own list is the link. A no-op when it is already linked to them.
  const linked = await request.get(`${mock}/judicial/referrals/mine?size=1`, {
    headers: bearer({ sub: wanted.subject, email: wanted.email, roles: [JUDICIAL_ROLE] })
  });
  expect(linked.status(), await linked.text()).toBe(200);

  return { id: master.id, name: master.name, judge: wanted.subject };
}

async function hasRoom(request: APIRequestContext, mock: string, room: number): Promise<boolean> {
  const response = await request.get(`${mock}/caseworker/referral-queue?size=1`, { headers: bearer(TEAM_LEADER) });
  expect(response.status(), await response.text()).toBe(200);
  const { window } = (await response.json()) as { window: { current: unknown; cap: number; sent: number } };

  return window.current !== null && window.sent + room <= window.cap;
}

async function mastersList(request: APIRequestContext, mock: string): Promise<{ masters: ListedMaster[] }> {
  const response = await request.get(`${mock}/caseworker/masters`, { headers: bearer(DELIVERY_MANAGER) });
  expect(response.status(), await response.text()).toBe(200);

  return response.json();
}

async function addMaster(request: APIRequestContext, mock: string, wanted: { name: string; email: string }): Promise<ListedMaster> {
  const response = await request.post(`${mock}/caseworker/masters`, {
    headers: bearer(DELIVERY_MANAGER),
    data: { name: wanted.name, email: wanted.email }
  });
  expect(response.status(), await response.text()).toBe(201);

  return response.json();
}

/** A Masters-list entry, and the subject of the judge linked to it. */
export interface Master {
  id: string;
  name: string;
  judge: string;
}

interface ListedMaster {
  id: string;
  name: string;
  email: string;
  available: boolean;
  revision: number;
}
