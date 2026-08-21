import { createErrorSummary, formatZodErrors, getPreviousPage, getSessionDataForPage, processAddressSubmission } from "@hmcts/onboarding";
import type { Request, Response } from "express";
import { ZodError } from "zod";

const en = {
  title: "What is your address?",
  heading: "What is your address?",
  line1Label: "Address line 1",
  line2Label: "Address line 2 (optional)",
  townLabel: "Town or city",
  postcodeLabel: "Postcode",
  back: "Back",
  continue: "Continue"
};

const cy = {
  title: "Beth yw eich cyfeiriad?",
  heading: "Beth yw eich cyfeiriad?",
  line1Label: "Llinell cyfeiriad 1",
  line2Label: "Llinell cyfeiriad 2 (dewisol)",
  townLabel: "Tref neu ddinas",
  postcodeLabel: "Cod post",
  back: "Yn ôl",
  continue: "Parhau"
};

export const GET = async (req: Request, res: Response) => {
  const data = getSessionDataForPage(req.session, "address");
  const backLink = getPreviousPage("address");

  res.render("address", {
    data,
    backLink,
    en,
    cy
  });
};

export const POST = async (req: Request, res: Response) => {
  try {
    processAddressSubmission(req.session, req.body);

    // Handle return parameter for change links
    const returnTo = req.query.return;
    if (returnTo === "summary") {
      res.redirect("/onboarding/summary");
    } else {
      res.redirect("/onboarding/role");
    }
  } catch (error) {
    if (error instanceof ZodError) {
      const errors = formatZodErrors(error);
      const errorSummary = createErrorSummary(errors);
      const backLink = getPreviousPage("address");

      res.render("address", {
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
