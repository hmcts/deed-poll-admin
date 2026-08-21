import { describe, it, expect, vi, beforeEach } from "vitest";
import { createOnboardingSubmission, getSubmissionById, getRecentSubmissions } from "./queries.js";
import { prisma } from "@hmcts/postgres-prisma";

vi.mock("@hmcts/postgres-prisma", () => ({
  prisma: {
    onboardingSubmission: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn()
    }
  }
}));

describe("queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createOnboardingSubmission", () => {
    it("should create new onboarding submission", async () => {
      const mockData = {
        firstName: "John",
        lastName: "Doe",
        dateOfBirth: new Date("1990-06-15"),
        addressLine1: "123 Test Street",
        addressLine2: "Flat 4",
        town: "London",
        postcode: "SW1A 1AA",
        roleType: "prosecutor" as const,
        roleOther: undefined
      };

      const mockResult = {
        id: "test-id",
        ...mockData,
        sessionId: "session-123",
        submittedAt: new Date()
      };

      vi.mocked(prisma.onboardingSubmission.create).mockResolvedValue(mockResult as any);

      const result = await createOnboardingSubmission(mockData);

      expect(prisma.onboardingSubmission.create).toHaveBeenCalledWith({
        data: mockData
      });
      expect(result).toEqual(mockResult);
    });

    it("should handle database errors", async () => {
      const mockData = {
        firstName: "John",
        lastName: "Doe",
        dateOfBirth: new Date("1990-06-15"),
        addressLine1: "123 Test Street",
        town: "London",
        postcode: "SW1A 1AA",
        roleType: "prosecutor" as const
      };

      vi.mocked(prisma.onboardingSubmission.create).mockRejectedValue(new Error("Database error"));

      await expect(createOnboardingSubmission(mockData)).rejects.toThrow("Database error");
    });

    it("should include roleOther when provided", async () => {
      const mockData = {
        firstName: "John",
        lastName: "Doe",
        dateOfBirth: new Date("1990-06-15"),
        addressLine1: "123 Test Street",
        town: "London",
        postcode: "SW1A 1AA",
        roleType: "other" as const,
        roleOther: "Legal advisor"
      };

      const mockResult = {
        id: "test-id",
        ...mockData,
        sessionId: null,
        submittedAt: new Date()
      };

      vi.mocked(prisma.onboardingSubmission.create).mockResolvedValue(mockResult as any);

      await createOnboardingSubmission(mockData);

      expect(prisma.onboardingSubmission.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          roleOther: "Legal advisor"
        })
      });
    });
  });

  describe("getSubmissionById", () => {
    it("should get submission by id", async () => {
      const mockResult = {
        id: "test-id",
        firstName: "John",
        lastName: "Doe",
        dateOfBirth: new Date("1990-06-15"),
        addressLine1: "123 Test Street",
        addressLine2: "Flat 4",
        town: "London",
        postcode: "SW1A 1AA",
        roleType: "prosecutor",
        roleOther: null,
        sessionId: "session-123",
        submittedAt: new Date()
      };

      vi.mocked(prisma.onboardingSubmission.findUnique).mockResolvedValue(mockResult);

      const result = await getSubmissionById("test-id");

      expect(prisma.onboardingSubmission.findUnique).toHaveBeenCalledWith({
        where: { id: "test-id" }
      });
      expect(result).toEqual(mockResult);
    });

    it("should return null for non-existent id", async () => {
      vi.mocked(prisma.onboardingSubmission.findUnique).mockResolvedValue(null);

      const result = await getSubmissionById("non-existent");

      expect(prisma.onboardingSubmission.findUnique).toHaveBeenCalledWith({
        where: { id: "non-existent" }
      });
      expect(result).toBeNull();
    });
  });

  describe("getRecentSubmissions", () => {
    it("should get recent submissions with default limit", async () => {
      const mockResults = [
        {
          id: "test-1",
          firstName: "John",
          lastName: "Doe",
          dateOfBirth: new Date("1990-01-01"),
          addressLine1: "1 Test St",
          addressLine2: null,
          town: "London",
          postcode: "SW1A 1AA",
          roleType: "prosecutor",
          roleOther: null,
          submittedAt: new Date("2024-01-15")
        },
        {
          id: "test-2",
          firstName: "Jane",
          lastName: "Smith",
          dateOfBirth: new Date("1985-01-01"),
          addressLine1: "2 Test St",
          addressLine2: null,
          town: "London",
          postcode: "SW1A 1AA",
          roleType: "defendant",
          roleOther: null,
          submittedAt: new Date("2024-01-14")
        }
      ];

      vi.mocked(prisma.onboardingSubmission.findMany).mockResolvedValue(mockResults);

      const result = await getRecentSubmissions();

      expect(prisma.onboardingSubmission.findMany).toHaveBeenCalledWith({
        orderBy: { submittedAt: "desc" },
        take: 10,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          submittedAt: true,
          roleType: true
        }
      });
      expect(result).toEqual(mockResults);
    });

    it("should get recent submissions with custom limit", async () => {
      const mockResults: never[] = [];

      vi.mocked(prisma.onboardingSubmission.findMany).mockResolvedValue(mockResults);

      const result = await getRecentSubmissions(5);

      expect(prisma.onboardingSubmission.findMany).toHaveBeenCalledWith({
        orderBy: { submittedAt: "desc" },
        take: 5,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          submittedAt: true,
          roleType: true
        }
      });
      expect(result).toEqual(mockResults);
    });
  });
});
