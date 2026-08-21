import type { Request, Response } from "express";

// GET /api/users/:id
export const GET = async (req: Request, res: Response) => {
  const { id } = req.params;

  // Example response - replace with actual implementation
  res.json({
    id: Number.parseInt(id, 10),
    name: "John Doe",
    email: "john@example.com"
  });
};

// PUT /api/users/:id
export const PUT = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, email } = req.body;

  if (!name || !email) {
    return res.status(400).json({ error: "Name and email are required" });
  }

  // Example response - replace with actual implementation
  res.json({
    id: Number.parseInt(id, 10),
    name,
    email
  });
};

// DELETE /api/users/:id
export const DELETE = async (req: Request, res: Response) => {
  const { id } = req.params;

  // Example response - replace with actual implementation
  res.json({
    message: `User ${id} deleted successfully`
  });
};
