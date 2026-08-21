import { prisma } from "@hmcts/postgres-prisma";
import type { OnboardingSubmission } from "./validation.js";

// Submit onboarding data to database
export async function createOnboardingSubmission(data: OnboardingSubmission) {
  return prisma.onboardingSubmission.create({
    data: {
      firstName: data.firstName,
      lastName: data.lastName,
      dateOfBirth: data.dateOfBirth,
      addressLine1: data.addressLine1,
      addressLine2: data.addressLine2,
      town: data.town,
      postcode: data.postcode,
      roleType: data.roleType,
      roleOther: data.roleOther
    }
  });
}

// Get submission by ID (for confirmation/verification)
export async function getSubmissionById(id: string) {
  return prisma.onboardingSubmission.findUnique({
    where: { id }
  });
}

// Get recent submissions (for admin/monitoring)
export async function getRecentSubmissions(limit = 10) {
  return prisma.onboardingSubmission.findMany({
    orderBy: { submittedAt: "desc" },
    take: limit,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      submittedAt: true,
      roleType: true
    }
  });
}
