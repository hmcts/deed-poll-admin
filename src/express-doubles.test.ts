import { describe, expect, it } from "vitest";
import type { RefreshClaim } from "./auth/guarded-session-store.js";
import { refreshCoordinatorDouble } from "./express-doubles.js";

describe("refreshCoordinatorDouble", () => {
  it.each([
    ["omitted", () => refreshCoordinatorDouble()],
    ["undefined", () => refreshCoordinatorDouble(undefined)]
  ] as const)("should grant the default lease when the claim is %s", async (_description, create) => {
    const coordinator = create();

    await expect(coordinator.claimRefresh()).resolves.toEqual({ outcome: "acquired", lease: "a-lease" });
  });

  it.each<RefreshClaim>([{ outcome: "acquired", lease: "custom-lease" }, { outcome: "missing" }, { outcome: "conflict" }, { outcome: "busy" }])(
    "should preserve the supplied $outcome claim",
    async (claim) => {
      const coordinator = refreshCoordinatorDouble(claim);

      await expect(coordinator.claimRefresh()).resolves.toBe(claim);
    }
  );

  it("should keep default claims isolated between doubles", async () => {
    const first = refreshCoordinatorDouble();
    const second = refreshCoordinatorDouble();
    const claim = (await first.claimRefresh()) as Extract<RefreshClaim, { outcome: "acquired" }>;

    claim.lease = "changed-in-one-test";

    await expect(first.claimRefresh()).resolves.toBe(claim);
    await expect(second.claimRefresh()).resolves.toEqual({ outcome: "acquired", lease: "a-lease" });
  });
});
