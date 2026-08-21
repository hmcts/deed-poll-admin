import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./[id].js";

vi.mock("@hmcts/onboarding", () => ({
  getSubmissionById: vi.fn()
}));

import { getSubmissionById } from "@hmcts/onboarding";

describe("GET /onboarding/[id]", () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let jsonMock: ReturnType<typeof vi.fn>;
  let statusMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    jsonMock = vi.fn();
    statusMock = vi.fn().mockReturnValue({ json: jsonMock });

    mockReq = {
      params: {}
    };

    mockRes = {
      status: statusMock,
      json: jsonMock
    } as Partial<Response>;

    vi.clearAllMocks();
  });

  it("should retrieve a submission by ID", async () => {
    const mockSubmission = {
      id: "cltest123456789",
      firstName: "John",
      lastName: "Doe",
      dateOfBirth: new Date("1990-06-15"),
      addressLine1: "123 Main St",
      addressLine2: null,
      town: "London",
      postcode: "SW1A 1AA",
      roleType: "frontend-developer",
      roleOther: null,
      submittedAt: new Date("2024-01-15T10:30:00Z")
    };

    vi.mocked(getSubmissionById).mockResolvedValue(mockSubmission);

    mockReq.params = { id: "cltest123456789" };

    await GET(mockReq as Request, mockRes as Response);

    expect(jsonMock).toHaveBeenCalledWith({
      reference: "cltest123456789",
      id: "cltest123456789",
      firstName: "John",
      lastName: "Doe",
      dateOfBirth: mockSubmission.dateOfBirth,
      address: {
        line1: "123 Main St",
        line2: null,
        town: "London",
        postcode: "SW1A 1AA"
      },
      role: {
        type: "frontend-developer",
        other: null
      },
      submittedAt: mockSubmission.submittedAt
    });

    expect(getSubmissionById).toHaveBeenCalledWith("cltest123456789");
  });

  it("should handle different ID formats", async () => {
    const mockSubmission = {
      id: "CLTE-ST12-3456-7890",
      firstName: "Jane",
      lastName: "Smith",
      dateOfBirth: new Date("1985-03-20"),
      addressLine1: "456 High St",
      addressLine2: "Flat 2B",
      town: "Manchester",
      postcode: "M1 2AB",
      roleType: "other",
      roleOther: "DevOps Engineer",
      submittedAt: new Date("2024-02-20T14:45:00Z")
    };

    vi.mocked(getSubmissionById).mockResolvedValue(mockSubmission);

    mockReq.params = { id: "CLTE-ST12-3456-7890" };

    await GET(mockReq as Request, mockRes as Response);

    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        reference: "CLTE-ST12-3456-7890",
        id: "CLTE-ST12-3456-7890",
        firstName: "Jane",
        lastName: "Smith",
        role: {
          type: "other",
          other: "DevOps Engineer"
        }
      })
    );

    // Should pass the ID as-is
    expect(getSubmissionById).toHaveBeenCalledWith("CLTE-ST12-3456-7890");
  });

  it("should handle short IDs correctly", async () => {
    const mockSubmission = {
      id: "abc123",
      firstName: "Bob",
      lastName: "Wilson",
      dateOfBirth: new Date("1995-12-25"),
      addressLine1: "789 Oak Avenue",
      addressLine2: null,
      town: "Birmingham",
      postcode: "B1 1AA",
      roleType: "backend-developer",
      roleOther: null,
      submittedAt: new Date()
    };

    vi.mocked(getSubmissionById).mockResolvedValue(mockSubmission);

    mockReq.params = { id: "abc123" };

    await GET(mockReq as Request, mockRes as Response);

    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        reference: "abc123",
        id: "abc123"
      })
    );

    expect(getSubmissionById).toHaveBeenCalledWith("abc123");
  });

  it("should return 404 when submission not found", async () => {
    vi.mocked(getSubmissionById).mockResolvedValue(null);

    mockReq.params = { id: "nonexistent123" };

    await GET(mockReq as Request, mockRes as Response);

    expect(statusMock).toHaveBeenCalledWith(404);
    expect(jsonMock).toHaveBeenCalledWith({
      error: "Submission not found"
    });

    expect(getSubmissionById).toHaveBeenCalledWith("nonexistent123");
  });

  it("should return 400 when no ID provided", async () => {
    mockReq.params = {}; // No ID

    await GET(mockReq as Request, mockRes as Response);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({
      error: "Missing submission ID"
    });

    expect(getSubmissionById).not.toHaveBeenCalled();
  });

  it("should handle database errors gracefully", async () => {
    vi.mocked(getSubmissionById).mockRejectedValue(new Error("Database connection failed"));

    mockReq.params = { id: "test123" };

    await GET(mockReq as Request, mockRes as Response);

    expect(statusMock).toHaveBeenCalledWith(500);
    expect(jsonMock).toHaveBeenCalledWith({
      error: "Failed to retrieve submission"
    });
  });

  it("should handle any ID format", async () => {
    const mockSubmission = {
      id: "INVALID",
      firstName: "Alice",
      lastName: "Johnson",
      dateOfBirth: new Date("1992-07-10"),
      addressLine1: "321 Park Lane",
      addressLine2: null,
      town: "Leeds",
      postcode: "LS1 1AA",
      roleType: "test-engineer",
      roleOther: null,
      submittedAt: new Date()
    };

    vi.mocked(getSubmissionById).mockResolvedValue(mockSubmission);

    mockReq.params = { id: "INVALID" };

    await GET(mockReq as Request, mockRes as Response);

    // Should pass ID as-is
    expect(getSubmissionById).toHaveBeenCalledWith("INVALID");
  });

  it("should return IDs as-is for reference", async () => {
    const testCases = ["a", "ab12", "abcd1234", "abcd12345678", "abcd123456789012", "abcd1234567890123456"];

    for (const id of testCases) {
      const mockSubmission = {
        id,
        firstName: "Test",
        lastName: "User",
        dateOfBirth: new Date("1990-01-01"),
        addressLine1: "Test St",
        addressLine2: null,
        town: "Test Town",
        postcode: "TE1 1ST",
        roleType: "frontend-developer",
        roleOther: null,
        submittedAt: new Date()
      };

      vi.mocked(getSubmissionById).mockResolvedValue(mockSubmission);
      vi.clearAllMocks();

      mockReq.params = { id };

      await GET(mockReq as Request, mockRes as Response);

      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          reference: id,
          id
        })
      );
    }
  });

  it("should return ISO format dates in response", async () => {
    const dateOfBirth = new Date("1990-06-15T00:00:00.000Z");
    const submittedAt = new Date("2024-01-15T10:30:45.123Z");

    const mockSubmission = {
      id: "test123",
      firstName: "John",
      lastName: "Doe",
      dateOfBirth,
      addressLine1: "123 Main St",
      addressLine2: null,
      town: "London",
      postcode: "SW1A 1AA",
      roleType: "frontend-developer",
      roleOther: null,
      submittedAt
    };

    vi.mocked(getSubmissionById).mockResolvedValue(mockSubmission);

    mockReq.params = { id: "test123" };

    await GET(mockReq as Request, mockRes as Response);

    // Check dates are included in response
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        dateOfBirth,
        submittedAt
      })
    );
  });
});
