import {
  addressSchema,
  createOnboardingSubmission,
  dobSchema,
  formatZodErrors,
  nameSchema,
  type OnboardingSubmission,
  onboardingSubmissionSchema,
  roleSchema
} from "@hmcts/onboarding";
import type { Request, Response } from "express";
import { ZodError, z } from "zod";

// Combined schema for full API submission
const apiOnboardingSchema = z.object({
  name: nameSchema,
  dateOfBirth: dobSchema,
  address: addressSchema,
  role: roleSchema
});

type ApiOnboardingData = z.infer<typeof apiOnboardingSchema>;

function transformToSubmission(data: ApiOnboardingData): OnboardingSubmission {
  // Convert date parts to Date object
  const dateOfBirth = new Date(data.dateOfBirth.year, data.dateOfBirth.month - 1, data.dateOfBirth.day);

  return {
    firstName: data.name.firstName,
    lastName: data.name.lastName,
    dateOfBirth,
    addressLine1: data.address.addressLine1,
    addressLine2: data.address.addressLine2,
    town: data.address.town,
    postcode: data.address.postcode,
    roleType: data.role.roleType,
    roleOther: data.role.roleType === "other" ? data.role.roleOther : undefined
  };
}

export const POST = async (req: Request, res: Response) => {
  try {
    // Validate using the same schemas as frontend
    const validatedData = apiOnboardingSchema.parse(req.body);

    // Transform to submission format
    const submissionData = transformToSubmission(validatedData);

    // Validate the final submission data
    const validatedSubmission = onboardingSubmissionSchema.parse(submissionData);

    // Create the submission in database
    const result = await createOnboardingSubmission(validatedSubmission);

    res.status(201).json({
      success: true,
      id: result.id,
      reference: result.id,
      data: result
    });
  } catch (error) {
    if (error instanceof ZodError) {
      const errors = formatZodErrors(error);
      return res.status(400).json({
        error: "Validation failed",
        errors
      });
    }

    console.error("Onboarding API error:", error);
    res.status(500).json({
      error: "Failed to process onboarding request"
    });
  }
};
