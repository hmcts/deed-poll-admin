import { describe, expect, it, vi } from "vitest";
import { GET } from "./index.js";

describe("GET /", () => {
  it("should return welcome message with API information", async () => {
    const mockReq = {} as any;
    const mockRes = {
      json: vi.fn()
    } as any;

    await GET(mockReq, mockRes);

    expect(mockRes.json).toHaveBeenCalledWith({
      message: "Welcome to HMCTS API",
      endpoints: {
        health: "/health",
        liveness: "/health/liveness",
        readiness: "/health/readiness"
      }
    });
  });
});
