import { getSubmissionById } from "@hmcts/onboarding";
import type { Request, Response } from "express";

export const GET = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        error: "Missing submission ID"
      });
    }

    const submission = await getSubmissionById(id);

    if (!submission) {
      return res.status(404).json({
        error: "Submission not found"
      });
    }

    res.json({
      reference: submission.id,
      id: submission.id,
      firstName: submission.firstName,
      lastName: submission.lastName,
      dateOfBirth: submission.dateOfBirth,
      address: {
        line1: submission.addressLine1,
        line2: submission.addressLine2,
        town: submission.town,
        postcode: submission.postcode
      },
      role: {
        type: submission.roleType,
        other: submission.roleOther
      },
      submittedAt: submission.submittedAt
    });
  } catch (error) {
    console.error("Error fetching onboarding submission:", error);
    res.status(500).json({
      error: "Failed to retrieve submission"
    });
  }
};
