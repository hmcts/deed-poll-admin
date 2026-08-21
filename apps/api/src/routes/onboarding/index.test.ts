import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./index.js";

vi.mock("@hmcts/postgres-prisma", () => ({
  prisma: {
    onboardingSubmission: { create: vi.fn(), findUnique: vi.fn() }
  }
}));

vi.mock("@hmcts/onboarding", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hmcts/onboarding")>();
  return {
    ...actual,
    createOnboardingSubmission: vi.fn()
  };
});

import { createOnboardingSubmission } from "@hmcts/onboarding";

describe("POST /onboarding", () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let jsonMock: ReturnType<typeof vi.fn>;
  let statusMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    jsonMock = vi.fn();
    statusMock = vi.fn().mockReturnValue({ json: jsonMock });

    mockReq = {
      body: {}
    };

    mockRes = {
      status: statusMock,
      json: jsonMock
    } as Partial<Response>;

    vi.clearAllMocks();
  });

  it("should successfully create an onboarding submission with valid data", async () => {
    const mockSubmission = {
      id: "test-id-123",
      firstName: "John",
      lastName: "Doe",
      dateOfBirth: new Date("1990-06-15"),
      addressLine1: "123 Main St",
      addressLine2: null,
      town: "London",
      postcode: "SW1A 1AA",
      roleType: "frontend-developer",
      roleOther: null,
      submittedAt: new Date()
    };

    vi.mocked(createOnboardingSubmission).mockResolvedValue(mockSubmission);

    mockReq.body = {
      name: {
        firstName: "John",
        lastName: "Doe"
      },
      dateOfBirth: {
        day: "15",
        month: "6",
        year: "1990"
      },
      address: {
        addressLine1: "123 Main St",
        town: "London",
        postcode: "SW1A 1AA"
      },
      role: {
        roleType: "frontend-developer"
      }
    };

    await POST(mockReq as Request, mockRes as Response);

    expect(statusMock).toHaveBeenCalledWith(201);
    expect(jsonMock).toHaveBeenCalledWith({
      success: true,
      id: "test-id-123",
      reference: "test-id-123",
      data: expect.objectContaining({
        id: "test-id-123",
        firstName: "John",
        lastName: "Doe"
      })
    });

    expect(createOnboardingSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: "John",
        lastName: "Doe",
        addressLine1: "123 Main St",
        town: "London",
        postcode: "SW1A 1AA",
        roleType: "frontend-developer"
      })
    );
  });

  it("should handle 'other' role type correctly", async () => {
    const mockSubmission = {
      id: "test-id-456",
      firstName: "Jane",
      lastName: "Smith",
      dateOfBirth: new Date("1985-03-20"),
      addressLine1: "456 High St",
      addressLine2: "Flat 2B",
      town: "Manchester",
      postcode: "M1 2AB",
      roleType: "other",
      roleOther: "DevOps Engineer",
      submittedAt: new Date()
    };

    vi.mocked(createOnboardingSubmission).mockResolvedValue(mockSubmission);

    mockReq.body = {
      name: {
        firstName: "Jane",
        lastName: "Smith"
      },
      dateOfBirth: {
        day: "20",
        month: "3",
        year: "1985"
      },
      address: {
        addressLine1: "456 High St",
        addressLine2: "Flat 2B",
        town: "Manchester",
        postcode: "M1 2AB"
      },
      role: {
        roleType: "other",
        roleOther: "DevOps Engineer"
      }
    };

    await POST(mockReq as Request, mockRes as Response);

    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          roleOther: "DevOps Engineer"
        })
      })
    );
  });

  it("should return 400 for invalid name data", async () => {
    mockReq.body = {
      name: {
        firstName: "", // Empty first name
        lastName: "Doe"
      },
      dateOfBirth: {
        day: "15",
        month: "6",
        year: "1990"
      },
      address: {
        addressLine1: "123 Main St",
        town: "London",
        postcode: "SW1A 1AA"
      },
      role: {
        roleType: "frontend-developer"
      }
    };

    await POST(mockReq as Request, mockRes as Response);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({
      error: "Validation failed",
      errors: expect.any(Object)
    });

    expect(createOnboardingSubmission).not.toHaveBeenCalled();
  });

  it("should return 400 for invalid date of birth", async () => {
    mockReq.body = {
      name: {
        firstName: "John",
        lastName: "Doe"
      },
      dateOfBirth: {
        day: "32", // Invalid day
        month: "6",
        year: "1990"
      },
      address: {
        addressLine1: "123 Main St",
        town: "London",
        postcode: "SW1A 1AA"
      },
      role: {
        roleType: "frontend-developer"
      }
    };

    await POST(mockReq as Request, mockRes as Response);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "Validation failed"
      })
    );
    expect(createOnboardingSubmission).not.toHaveBeenCalled();
  });

  it("should return 400 for underage submission", async () => {
    const currentYear = new Date().getFullYear();
    mockReq.body = {
      name: {
        firstName: "Young",
        lastName: "Person"
      },
      dateOfBirth: {
        day: "1",
        month: "1",
        year: String(currentYear - 10) // 10 years old
      },
      address: {
        addressLine1: "123 Main St",
        town: "London",
        postcode: "SW1A 1AA"
      },
      role: {
        roleType: "frontend-developer"
      }
    };

    await POST(mockReq as Request, mockRes as Response);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(createOnboardingSubmission).not.toHaveBeenCalled();
  });

  it("should return 400 for invalid UK postcode", async () => {
    mockReq.body = {
      name: {
        firstName: "John",
        lastName: "Doe"
      },
      dateOfBirth: {
        day: "15",
        month: "6",
        year: "1990"
      },
      address: {
        addressLine1: "123 Main St",
        town: "London",
        postcode: "INVALID" // Invalid postcode
      },
      role: {
        roleType: "frontend-developer"
      }
    };

    await POST(mockReq as Request, mockRes as Response);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(createOnboardingSubmission).not.toHaveBeenCalled();
  });

  it("should return 400 when 'other' role is missing roleOther field", async () => {
    mockReq.body = {
      name: {
        firstName: "John",
        lastName: "Doe"
      },
      dateOfBirth: {
        day: "15",
        month: "6",
        year: "1990"
      },
      address: {
        addressLine1: "123 Main St",
        town: "London",
        postcode: "SW1A 1AA"
      },
      role: {
        roleType: "other"
        // Missing roleOther field
      }
    };

    await POST(mockReq as Request, mockRes as Response);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(createOnboardingSubmission).not.toHaveBeenCalled();
  });

  it("should handle database errors gracefully", async () => {
    vi.mocked(createOnboardingSubmission).mockRejectedValue(new Error("Database connection failed"));

    mockReq.body = {
      name: {
        firstName: "John",
        lastName: "Doe"
      },
      dateOfBirth: {
        day: "15",
        month: "6",
        year: "1990"
      },
      address: {
        addressLine1: "123 Main St",
        town: "London",
        postcode: "SW1A 1AA"
      },
      role: {
        roleType: "frontend-developer"
      }
    };

    await POST(mockReq as Request, mockRes as Response);

    expect(statusMock).toHaveBeenCalledWith(500);
    expect(jsonMock).toHaveBeenCalledWith({
      error: "Failed to process onboarding request"
    });
  });

  it("should format postcodes correctly", async () => {
    const mockSubmission = {
      id: "test-id-789",
      firstName: "John",
      lastName: "Doe",
      dateOfBirth: new Date("1990-06-15"),
      addressLine1: "123 Main St",
      addressLine2: null,
      town: "London",
      postcode: "SW1A 1AA",
      roleType: "frontend-developer",
      roleOther: null,
      submittedAt: new Date()
    };

    vi.mocked(createOnboardingSubmission).mockResolvedValue(mockSubmission);

    mockReq.body = {
      name: {
        firstName: "John",
        lastName: "Doe"
      },
      dateOfBirth: {
        day: "15",
        month: "6",
        year: "1990"
      },
      address: {
        addressLine1: "123 Main St",
        town: "London",
        postcode: "sw1a1aa" // Lowercase, no space
      },
      role: {
        roleType: "frontend-developer"
      }
    };

    await POST(mockReq as Request, mockRes as Response);

    // Check that the postcode was formatted correctly
    expect(createOnboardingSubmission).toHaveBeenCalledWith(
      expect.objectContaining({
        postcode: "SW1A 1AA" // Should be uppercase with space
      })
    );
  });
});
