import { prisma as prismaClient } from "@hmcts/postgres-prisma";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundError } from "../errors.js";
import { createWitness, findWitness, removeWitness } from "./service.js";

// Partial mock: only the client is replaced. The Prisma enums (DocumentDirection,
// DeedPollType, …) are real values the source modules import, so they must pass through.
vi.mock("@hmcts/postgres-prisma", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/postgres-prisma")>()),
  prisma: {
    deedPoll: { findUnique: vi.fn() },
    deedPollWitness: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn()
    }
  }
}));

// Aliased back to `prisma` so the assertions below read exactly as they did under Nest DI;
// `deep: true` keeps the mock methods typed so .mockResolvedValue is available on them.
const prisma = vi.mocked(prismaClient, { deep: true });

describe("witnesses/service", () => {
  const witness = {
    witnessName: "Sam Doe",
    witnessAddress: "1 High St",
    witnessOccupation: "Teacher",
    declarant: false
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a witness scoped to its parent", async () => {
    prisma.deedPoll.findUnique.mockResolvedValue({ id: "case1" });
    prisma.deedPollWitness.create.mockResolvedValue({ id: "w1" });
    await createWitness("case1", witness);
    expect(prisma.deedPollWitness.create).toHaveBeenCalledWith({
      data: { ...witness, deedPollId: "case1" }
    });
  });

  it("404s creating a witness on a missing case", async () => {
    prisma.deedPoll.findUnique.mockResolvedValue(null);
    await expect(createWitness("nope", witness)).rejects.toBeInstanceOf(NotFoundError);
    expect(prisma.deedPollWitness.create).not.toHaveBeenCalled();
  });

  it("findOne 404s across parents", async () => {
    prisma.deedPollWitness.findFirst.mockResolvedValue(null);
    await expect(findWitness("case1", "w1")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("removes after an existence check", async () => {
    prisma.deedPollWitness.findFirst.mockResolvedValue({ id: "w1" });
    prisma.deedPollWitness.delete.mockResolvedValue({ id: "w1" });
    await removeWitness("case1", "w1");
    expect(prisma.deedPollWitness.delete).toHaveBeenCalledWith({
      where: { id: "w1" }
    });
  });
});
