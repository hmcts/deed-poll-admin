import type { Request, Response } from "express";

// GET /api/users
export const GET = async (_req: Request, res: Response) => {
  // Example endpoint - replace with actual implementation
  res.json({
    users: [
      { id: 1, name: "John Doe", email: "john@example.com" },
      { id: 2, name: "Jane Smith", email: "jane@example.com" }
    ]
  });
};

// POST /api/users
export const POST = async (req: Request, res: Response) => {
  const { name, email } = req.body;

  if (!name || !email) {
    return res.status(400).json({ error: "Name and email are required" });
  }

  // Example response - replace with actual implementation
  res.status(201).json({
    id: Date.now(),
    name,
    email
  });
};
