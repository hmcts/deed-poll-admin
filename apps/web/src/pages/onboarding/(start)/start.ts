import type { Request, Response } from "express";

const en = {
  title: "Onboarding form example",
  heading: "Onboarding form example",
  description: "Use this form to see how we collect information for onboarding.",
  beforeYouStart: "Before you start",
  youWillNeed: "You will need:",
  requirements: ["your personal details (name and date of birth)", "your address", "information about your role"],
  duration: "It takes around 5 minutes to complete.",
  startButton: "Start now"
};

const cy = {
  title: "Enghraifft ffurflen ymuno",
  heading: "Enghraifft ffurflen ymuno",
  description: "Defnyddiwch y ffurflen hon i weld sut rydym yn casglu gwybodaeth ar gyfer ymuno.",
  beforeYouStart: "Cyn i chi ddechrau",
  youWillNeed: "Bydd angen:",
  requirements: ["eich manylion personol (enw a dyddiad geni)", "eich cyfeiriad", "gwybodaeth am eich rôl"],
  duration: "Mae'n cymryd tua 5 munud i'w gwblhau.",
  startButton: "Dechrau nawr"
};

export const GET = async (_req: Request, res: Response) => {
  res.render("start", { en, cy });
};
