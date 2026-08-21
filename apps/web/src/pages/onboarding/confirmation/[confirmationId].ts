import type { Request, Response } from "express";

const en = {
  title: "Onboarding complete",
  heading: "Onboarding complete",
  panelTitle: "Onboarding complete",
  referenceLabel: "Your reference number",
  whatHappensNext: "What happens next",
  nextSteps: "We will process your information and you will be able to access the service.",
  returnButton: "Return to homepage"
};

const cy = {
  title: "Ymgymryd wedi'i gwblhau",
  heading: "Ymgymrwd wedi'i gwblhau",
  panelTitle: "Ymgymrwd wedi'i gwblhau",
  referenceLabel: "Eich rhif cyfeirnod",
  whatHappensNext: "Beth sy'n digwydd nesaf",
  nextSteps: "Byddwn yn prosesu eich gwybodaeth a byddwch yn gallu cael mynediad at y gwasanaeth.",
  returnButton: "Dychwelyd i'r hafan"
};

export const GET = async (req: Request, res: Response) => {
  const confirmationId = req.params?.confirmationId;

  if (!confirmationId) {
    return res.redirect("/onboarding/start");
  }

  res.render("[confirmationId]", {
    confirmationId,
    en,
    cy
  });
};
