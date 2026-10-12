import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { DELIVERY_MANAGER_STORAGE_STATE, DEPLOYED_STACK_SKIP_REASON, RUNS_AGAINST_DEPLOYED_STACK, TEAM_LEADER_STORAGE_STATE } from "./idam-session.js";

const MOCK_API_URL = process.env.DEED_POLL_API_URL ?? "http://localhost:3200";

test.skip(RUNS_AGAINST_DEPLOYED_STACK, DEPLOYED_STACK_SKIP_REASON);

for (const [role, storageState] of [
  ["Team leader", TEAM_LEADER_STORAGE_STATE],
  ["Delivery Manager", DELIVERY_MANAGER_STORAGE_STATE]
] as const) {
  test.describe(role, () => {
    test.use({ storageState });

    test("keeps casework controls without gaining judicial access", async ({ page, request }) => {
      const suffix = `${role.replaceAll(" ", "")}${Date.now()}`;
      const created = await request.post(`${MOCK_API_URL}/__mock/cases`, {
        data: { type: "Adult", state: "Received", newForename: "Staff", newSurname: suffix, displayReference: "KBDP2026-09123", privacy: "Private" }
      });
      expect(created.status(), await created.text()).toBe(201);
      const casePath = `/deed-polls/${(await created.json()).id}`;

      await page.goto(`${casePath}/edit/application`);
      await expect(page.getByLabel("Privacy", { exact: true })).toBeEnabled();
      await expect(page.getByLabel("Privacy", { exact: true })).toHaveValue("Private");
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

      await page.goto(`${casePath}/notes/new`);
      await page.getByLabel("Note").fill(`Role journey ${suffix}`);
      await page.getByRole("button", { name: "Add note", exact: true }).click();
      await page.getByRole("link", { name: /amend this note/ }).click();
      await expect(page.getByRole("button", { name: "Delete note" })).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.getByRole("button", { name: "Delete note" }).click();
      await expect(page).toHaveURL(`${casePath}#notes`);
      await expect(page.locator("#notes")).toContainText("None recorded.");

      await page.goto(`/deed-polls/queries/new?where=newSurname%3Ais%3A${suffix}`);
      await expect(page.getByLabel("Add this query to the library, so colleagues can find it")).toBeEnabled();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

      for (const path of ["/judicial/referrals", "/judicial/referrals/00000000-0000-4000-8000-000000000001"]) {
        expect((await page.goto(path))?.status()).toBe(403);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
      }
    });
  });
}
