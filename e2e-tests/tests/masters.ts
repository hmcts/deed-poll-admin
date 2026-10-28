/**
 * Masters and assignment, arranged through the mock api for the journeys that need a referral in a Master's hands
 * (plan Db1).
 *
 * Since api D2 a referral reaches a judge only by assignment: there is no pool and no claim, and an `Open` referral
 * is visible to no judge. So a journey that needs a judge to see or direct a referral has to put a Masters-list
 * entry behind that judge and assign the referral to it, which is what this file does.
 *
 * **A Master of its own per referral, unless the journey needs the judge persona.** api caps how many referrals a
 * Master takes per referral window (`GET /caseworker/masters`' `cap`, 10 by default), and the mock's store outlives a
 * run (`reuseExistingServer`), so a fixed Master shared by every journey would be full after a few runs in one
 * window and refuse the raise with a 409 that reads as an application bug. `newMaster` mints a unique entry and a
 * unique judge linked to it, so it never fills. `judgePersonaMaster` is the one shared entry, because only the
 * signed-in `judge@example.com` can read a referral in a browser; the journeys assigning to it raise a handful a
 * run, well under the cap on a fresh mock.
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

const JUDICIAL_ROLE = "caseworker-deedpoll-judicial";

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

/** Assign a referral to a Master through the contract route, as the assign page does. */
export async function assignReferral(request: APIRequestContext, caseId: string, referralId: string, masterId: string, mock = MOCK_API_URL): Promise<void> {
  const response = await request.put(`${mock}/caseworker/cases/${caseId}/referrals/${referralId}/assignment`, {
    headers: bearer({ sub: "e2e.masters.caseworker" }),
    data: { masterId }
  });
  expect(response.status(), await response.text()).toBe(200);
}

/** api's per-Master cap for the current referral window, as the raise form reads it. */
export async function referralCap(request: APIRequestContext, mock = MOCK_API_URL): Promise<number> {
  return (await mastersList(request, mock)).cap;
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

async function mastersList(request: APIRequestContext, mock: string): Promise<{ masters: ListedMaster[]; cap: number }> {
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
