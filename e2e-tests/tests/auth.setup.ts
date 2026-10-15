/** Each role has its own real IDAM login and saved session; no cookie or role rewriting. */
import { test as setup } from "@playwright/test";
import {
  ADMIN_STORAGE_STATE,
  CASEWORKER_STORAGE_STATE,
  DELIVERY_MANAGER_STORAGE_STATE,
  DEPLOYED_STACK_SKIP_REASON,
  JUDGE_STORAGE_STATE,
  RUNS_AGAINST_DEPLOYED_STACK,
  signInAsAdmin,
  signInAsCaseworker,
  signInAsDeliveryManager,
  signInAsJudge,
  signInAsTeamLeader,
  TEAM_LEADER_STORAGE_STATE
} from "./idam-session.js";

for (const [role, signIn, storageState] of [
  ["Team leader", signInAsTeamLeader, TEAM_LEADER_STORAGE_STATE],
  ["Delivery Manager", signInAsDeliveryManager, DELIVERY_MANAGER_STORAGE_STATE],
  ["legacy admin", signInAsAdmin, ADMIN_STORAGE_STATE],
  ["caseworker", signInAsCaseworker, CASEWORKER_STORAGE_STATE],
  ["judge", signInAsJudge, JUDGE_STORAGE_STATE]
] as const) {
  setup(`sign in as a ${role}`, async ({ page }) => {
    setup.skip(RUNS_AGAINST_DEPLOYED_STACK, DEPLOYED_STACK_SKIP_REASON);
    await signIn(page);
    await page.context().storageState({ path: storageState });
  });
}
