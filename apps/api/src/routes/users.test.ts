import { describe, expect, it, vi } from "vitest";
import { GET, POST } from "./users.js";

describe("/api/users routes", () => {
  describe("GET /api/users", () => {
    it("should return list of users", async () => {
      const mockReq = {} as any;
      const mockRes = {
        json: vi.fn()
      } as any;

      await GET(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith({
        users: [
          { id: 1, name: "John Doe", email: "john@example.com" },
          { id: 2, name: "Jane Smith", email: "jane@example.com" }
        ]
      });
    });
  });

  describe("POST /api/users", () => {
    it("should create a new user with valid data", async () => {
      const mockReq = {
        body: { name: "Test User", email: "test@example.com" }
      } as any;
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      } as any;

      await POST(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith({
        id: expect.any(Number),
        name: "Test User",
        email: "test@example.com"
      });
    });

    it("should return 400 when name is missing", async () => {
      const mockReq = {
        body: { email: "test@example.com" }
      } as any;
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      } as any;

      await POST(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: "Name and email are required"
      });
    });

    it("should return 400 when email is missing", async () => {
      const mockReq = {
        body: { name: "Test User" }
      } as any;
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      } as any;

      await POST(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: "Name and email are required"
      });
    });

    it("should return 400 when both name and email are missing", async () => {
      const mockReq = {
        body: {}
      } as any;
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      } as any;

      await POST(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: "Name and email are required"
      });
    });

    it("should return 400 when name is empty string", async () => {
      const mockReq = {
        body: { name: "", email: "test@example.com" }
      } as any;
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      } as any;

      await POST(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: "Name and email are required"
      });
    });

    it("should return 400 when email is empty string", async () => {
      const mockReq = {
        body: { name: "Test User", email: "" }
      } as any;
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      } as any;

      await POST(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: "Name and email are required"
      });
    });
  });
});
