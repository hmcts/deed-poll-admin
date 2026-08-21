import { createErrorSummary, formatZodErrors, getPreviousPage, getSessionDataForPage, processNameSubmission } from "@hmcts/onboarding";
import type { Request, Response } from "express";
import { ZodError } from "zod";

const en = {
  title: "What is your name?",
  heading: "What is your name?",
  firstNameLabel: "First name",
  lastNameLabel: "Last name",
  back: "Back",
  continue: "Continue"
};

const cy = {
  title: "Beth yw eich enw?",
  heading: "Beth yw eich enw?",
  firstNameLabel: "Enw cyntaf",
  lastNameLabel: "Cyfenw",
  back: "Yn ôl",
  continue: "Parhau"
};

export const GET = async (req: Request, res: Response) => {
  const data = getSessionDataForPage(req.session, "name");
  const backLink = getPreviousPage("name");

  res.render("name", {
    data,
    backLink,
    en,
    cy
  });
};

export const POST = async (req: Request, res: Response) => {
  try {
    processNameSubmission(req.session, req.body);

    // Handle return parameter for change links
    const returnTo = req.query.return;
    if (returnTo === "summary") {
      res.redirect("/onboarding/summary");
    } else {
      res.redirect("/onboarding/date-of-birth");
    }
  } catch (error) {
    if (error instanceof ZodError) {
      const errors = formatZodErrors(error);
      const errorSummary = createErrorSummary(errors);
      const backLink = getPreviousPage("name");

      res.render("name", {
        errors,
        errorSummary,
        data: req.body,
        backLink,
        en,
        cy
      });
    } else {
      throw error;
    }
  }
};
