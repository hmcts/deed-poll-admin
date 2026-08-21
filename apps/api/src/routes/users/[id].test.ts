import { describe, expect, it, vi } from "vitest";
import { DELETE, GET, PUT } from "./[id].js";

describe("/api/users/:id routes", () => {
  describe("GET /api/users/:id", () => {
    it("should return user by id", async () => {
      const mockReq = {
        params: { id: "123" }
      } as any;
      const mockRes = {
        json: vi.fn()
      } as any;

      await GET(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith({
        id: 123,
        name: "John Doe",
        email: "john@example.com"
      });
    });

    it("should handle non-numeric id", async () => {
      const mockReq = {
        params: { id: "abc" }
      } as any;
      const mockRes = {
        json: vi.fn()
      } as any;

      await GET(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith({
        id: NaN,
        name: "John Doe",
        email: "john@example.com"
      });
    });
  });

  describe("PUT /api/users/:id", () => {
    it("should update user with valid data", async () => {
      const mockReq = {
        params: { id: "123" },
        body: { name: "Updated User", email: "updated@example.com" }
      } as any;
      const mockRes = {
        json: vi.fn()
      } as any;

      await PUT(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith({
        id: 123,
        name: "Updated User",
        email: "updated@example.com"
      });
    });

    it("should return 400 when name is missing", async () => {
      const mockReq = {
        params: { id: "123" },
        body: { email: "test@example.com" }
      } as any;
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      } as any;

      await PUT(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: "Name and email are required"
      });
    });

    it("should return 400 when email is missing", async () => {
      const mockReq = {
        params: { id: "123" },
        body: { name: "Test User" }
      } as any;
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      } as any;

      await PUT(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: "Name and email are required"
      });
    });

    it("should return 400 when both name and email are missing", async () => {
      const mockReq = {
        params: { id: "123" },
        body: {}
      } as any;
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      } as any;

      await PUT(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: "Name and email are required"
      });
    });

    it("should return 400 when name is empty string", async () => {
      const mockReq = {
        params: { id: "123" },
        body: { name: "", email: "test@example.com" }
      } as any;
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      } as any;

      await PUT(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: "Name and email are required"
      });
    });

    it("should return 400 when email is empty string", async () => {
      const mockReq = {
        params: { id: "123" },
        body: { name: "Test User", email: "" }
      } as any;
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      } as any;

      await PUT(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: "Name and email are required"
      });
    });

    it("should handle non-numeric id in updates", async () => {
      const mockReq = {
        params: { id: "abc" },
        body: { name: "Updated User", email: "updated@example.com" }
      } as any;
      const mockRes = {
        json: vi.fn()
      } as any;

      await PUT(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith({
        id: NaN,
        name: "Updated User",
        email: "updated@example.com"
      });
    });
  });

  describe("DELETE /api/users/:id", () => {
    it("should delete user and return confirmation message", async () => {
      const mockReq = {
        params: { id: "123" }
      } as any;
      const mockRes = {
        json: vi.fn()
      } as any;

      await DELETE(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith({
        message: "User 123 deleted successfully"
      });
    });

    it("should handle deletion with non-numeric id", async () => {
      const mockReq = {
        params: { id: "abc" }
      } as any;
      const mockRes = {
        json: vi.fn()
      } as any;

      await DELETE(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith({
        message: "User abc deleted successfully"
      });
    });

    it("should handle deletion with special characters in id", async () => {
      const mockReq = {
        params: { id: "user-123" }
      } as any;
      const mockRes = {
        json: vi.fn()
      } as any;

      await DELETE(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith({
        message: "User user-123 deleted successfully"
      });
    });
  });
});
