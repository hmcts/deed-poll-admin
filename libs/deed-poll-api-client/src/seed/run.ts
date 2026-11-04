import {
  type ApiConfig,
  type ApiResult,
  closeReferral,
  createCase,
  createNote,
  createReferral,
  createWitness,
  directJudicialReferral,
  getCase,
  getJudicialMyReferrals,
  listCases,
  listReferrals,
  patchCase,
  type ReferralState,
  sendReferrals,
  withdrawReferral
} from "../api/client.js";
import { type SeedCase, seedDataset } from "./dataset.js";
import { seedTarget } from "./target.js";

export async function seedCases(
  journal: SeedJournal,
  credentials: SeedCredentials,
  persist: () => Promise<void>,
  report: (line: string) => void,
  options: { deferJudicial?: boolean } = {}
): Promise<void> {
  const target = seedTarget(journal.environment, journal.baseUrl);
  if (journal.version !== 1) throw new Error("Unsupported seed journal version.");
  if (journal.pending) throw new Error(`Uncertain write ${journal.pending}: reconcile it with the API before resuming; it will not be sent twice.`);
  if (!credentials.caseworkerToken) throw new Error("A caseworker/admin access token is required.");
  if (!options.deferJudicial && !credentials.judgeToken) throw new Error("A judicial access token is required unless judicial actions are deferred.");
  // A judge sees only what is sent to their Masters-list entry, so the judicial actions need it.
  if (!options.deferJudicial && !credentials.masterId) throw new Error("The judge's Masters-list id is required unless judicial actions are deferred.");
  const config: ApiConfig = { baseUrl: target.baseUrl, accessToken: credentials.caseworkerToken };
  const judge: ApiConfig = { ...config, accessToken: credentials.judgeToken };
  const dataset = seedDataset(journal.batch, journal.asOf);
  const deferredJudicial: string[] = [];
  // Authorisation failures must happen before any case is created, including the separate judicial credential. The
  // judicial preflight is also the judge's first judicial request, which links them to their Masters-list entry.
  read(await listCases({ size: 1 }, config), "caseworker preflight");
  if (!options.deferJudicial) read(await getJudicialMyReferrals({ size: 1 }, judge), "judicial preflight");
  for (const item of dataset) await seedCase(item); // NOSONAR typescript:S9382 - case writes share one pending journal; Steve accepted 2026-10-26
  journal.caseworkerComplete = true;
  journal.deferredJudicial = deferredJudicial;
  journal.complete = deferredJudicial.length === 0;
  await persist();
  report(`Verified ${dataset.length} cases across all 8 application states. No email-send or mock-control endpoints were called.`);
  if (deferredJudicial.length) report(`Caseworker seeding is complete; judicial actions remain deferred on ${deferredJudicial.length} referrals.`);

  async function seedCase(item: SeedCase): Promise<void> {
    const key = item.marker;
    const id = await createSeedCase(item);
    for (const [index, witness] of item.witnesses.entries()) {
      await step(`${key}/witness/${index}`, () => createWitness(id, witness, config)); // NOSONAR typescript:S9382 - child writes share one pending journal; Steve accepted 2026-10-26
    }
    for (const [index, note] of item.notes.entries()) await step(`${key}/note/${index}`, () => createNote(id, note, config)); // NOSONAR typescript:S9382 - child writes share one pending journal; Steve accepted 2026-10-26
    if (item.referral) await seedReferral(item.referral, key, id);
    if (Object.keys(item.progress).length) await step(`${key}/progress`, () => patchCase(id, item.progress, config));
    await verifyCase(item, id);
  }

  async function createSeedCase(item: SeedCase): Promise<string> {
    const key = item.marker;
    if (!Object.hasOwn(journal.steps, `${key}/create`)) {
      const found = read(await listCases({ where: [`onlineApplicationReference:is:${key}`], size: 1 }, config), "duplicate check");
      if (found.total !== 0) throw new Error(`${key} already exists. Resume its original journal; no duplicate will be created.`);
    }
    const created = await step(`${key}/create`, () => createCase(item.create, config));
    const id = created.id;
    if (!id) throw new Error(`${key}: create returned no case ID.`);
    journal.cases[key] = { id, reference: created.displayReference ?? "", expectedState: item.state };
    await persist();
    return id;
  }

  async function seedReferral(plan: NonNullable<SeedCase["referral"]>, key: string, id: string): Promise<void> {
    const referral = await step(`${key}/referral`, () => createReferral(id, plan.create, config));
    // Raised into the queue and then sent from it as its own step, so a deferred run leaves it `Open` and the resumed
    // run sends it. Since api F1 that is a send by the Team leader, so it succeeds only inside a referral window, and
    // counts towards the window's cap. The step keeps its `/assign` name so earlier journals still resume; a journal
    // from before api D2 holds `/claim` instead, which `completedReferralState` reads.
    if (!options.deferJudicial && !Object.hasOwn(journal.steps, `${key}/claim`) && ["Claimed", "Decided", "Closed"].includes(plan.state)) {
      await step(`${key}/assign`, () => sendReferrals({ allocations: [{ referralId: referral.id, masterId: credentials.masterId ?? "" }] }, config));
    }
    if (!options.deferJudicial && ["Decided", "Closed"].includes(plan.state)) {
      await step(`${key}/direction`, () => directJudicialReferral(referral.id, plan.direction, judge));
    }
    if (!options.deferJudicial && plan.state === "Closed") await step(`${key}/close`, () => closeReferral(id, referral.id, config));
    if (plan.state === "Withdrawn") await step(`${key}/withdraw`, () => withdrawReferral(id, referral.id, config));
  }

  async function verifyCase(item: SeedCase, id: string): Promise<void> {
    const key = item.marker;
    // Re-read even completed entries: a failed/misclassified seed must not report success based on writes alone.
    const actual = read(await getCase(id, config), `${key} verification`);
    const referrals = read(await listReferrals(id, config), `${key} referral verification`);
    const expectedReferral = expectedReferralState(item, journal, options.deferJudicial);
    if (
      actual.privacy !== item.create.privacy ||
      actual.urgency !== item.create.urgency ||
      actual.state !== item.state ||
      actual.type !== item.create.type ||
      actual.onlineApplicationReference !== key ||
      actual.witnesses.length !== item.witnesses.length ||
      !item.notes.every((note) => actual.notes.some((row) => row.note === note)) ||
      (expectedReferral ? referrals.length !== 1 || referrals[0].state !== expectedReferral : referrals.length !== 0)
    ) {
      throw new Error(`${key}: read-back differs from the planned state, type, marker, witnesses, notes or referrals. Existing data has not been reset.`);
    }
    if (expectedReferral !== item.referral?.state) deferredJudicial.push(key);
    const referralSummary = expectedReferral ? ` / referral ${expectedReferral}` : "";
    report(`${key}  ${actual.displayReference}  ${actual.type}  ${actual.state}${referralSummary}`);
  }

  async function step<T>(name: string, write: () => Promise<ApiResult<T>>): Promise<T> {
    if (Object.hasOwn(journal.steps, name)) return journal.steps[name] as T;
    // A lost response cannot make the next run blindly repeat a non-idempotent create.
    journal.pending = name;
    await persist();
    const result = await write();
    if (!result.ok) {
      if (result.error.status && result.error.status >= 400 && result.error.status < 500 && result.error.status !== 408) {
        delete journal.pending;
        await persist();
      }
      throw new Error(`${name}: API ${result.error.kind} (${result.error.status ?? "no response"}). Inspect the journal before retrying.`);
    }
    journal.steps[name] = result.data;
    delete journal.pending;
    await persist();
    return result.data;
  }
}

function expectedReferralState(item: SeedCase, journal: SeedJournal, deferJudicial: boolean | undefined): ReferralState | undefined {
  if (!item.referral) return undefined;
  return deferJudicial ? completedReferralState(journal, item.marker) : item.referral.state;
}

function completedReferralState(journal: SeedJournal, key: string): ReferralState {
  // A deferred rerun must also verify referrals already advanced by an earlier full run.
  if (Object.hasOwn(journal.steps, `${key}/close`)) return "Closed";
  if (Object.hasOwn(journal.steps, `${key}/withdraw`)) return "Withdrawn";
  if (Object.hasOwn(journal.steps, `${key}/direction`)) return "Decided";
  if (Object.hasOwn(journal.steps, `${key}/assign`) || Object.hasOwn(journal.steps, `${key}/claim`)) return "Claimed";
  return "Open";
}

function read<T>(result: ApiResult<T>, operation: string): T {
  if (result.ok) return result.data;
  throw new Error(`${operation}: API ${result.error.kind} (${result.error.status ?? "no response"}).`);
}

export interface SeedJournal {
  version: 1;
  environment: string;
  baseUrl: string;
  batch: string;
  asOf: string;
  steps: Record<string, unknown>;
  cases: Record<string, { id: string; reference: string; expectedState: string }>;
  pending?: string;
  complete?: boolean;
  caseworkerComplete?: boolean;
  deferredJudicial?: string[];
}
export interface SeedCredentials {
  caseworkerToken: string;
  judgeToken?: string;
  /** The judge's Masters-list entry, which the claimed and directed referrals are sent to (api F1). */
  masterId?: string;
}
