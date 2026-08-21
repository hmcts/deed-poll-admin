import { z } from "zod";

// Current year for date validation
const CURRENT_YEAR = new Date().getFullYear();
const MINIMUM_AGE = 16;

// Name page schema
export const nameSchema = z.object({
  firstName: z
    .string()
    .min(1, "Enter your first name")
    .max(50, "First name must be 50 characters or less")
    .regex(/^[a-zA-Z\s\-']+$/, "First name must only include letters a to z, hyphens, spaces and apostrophes"),
  lastName: z
    .string()
    .min(1, "Enter your last name")
    .max(50, "Last name must be 50 characters or less")
    .regex(/^[a-zA-Z\s\-']+$/, "Last name must only include letters a to z, hyphens, spaces and apostrophes")
});

// Date of birth schema with age validation
export const dobSchema = z
  .object({
    day: z
      .string()
      .min(1, "Enter a day")
      .regex(/^\d{1,2}$/, "Day must be a number")
      .transform(Number)
      .pipe(z.number().min(1, "Day must be between 1 and 31").max(31, "Day must be between 1 and 31")),
    month: z
      .string()
      .min(1, "Enter a month")
      .regex(/^\d{1,2}$/, "Month must be a number")
      .transform(Number)
      .pipe(z.number().min(1, "Month must be between 1 and 12").max(12, "Month must be between 1 and 12")),
    year: z
      .string()
      .min(1, "Enter a year")
      .regex(/^\d{4}$/, "Year must be 4 digits")
      .transform(Number)
      .pipe(z.number().min(1900, "Enter a valid year").max(CURRENT_YEAR, `Year must be ${CURRENT_YEAR} or earlier`))
  })
  .refine(
    (data) => {
      // Check if the date is valid
      const date = new Date(data.year, data.month - 1, data.day);
      return date.getDate() === data.day && date.getMonth() === data.month - 1 && date.getFullYear() === data.year;
    },
    { message: "Enter a real date", path: ["day"] }
  )
  .refine(
    (data) => {
      // Check minimum age
      const birthDate = new Date(data.year, data.month - 1, data.day);
      const today = new Date();
      const age = Math.floor((today.getTime() - birthDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
      return age >= MINIMUM_AGE;
    },
    { message: "You must be at least 16 years old", path: ["day"] }
  );

// Address schema with UK postcode validation
export const addressSchema = z.object({
  addressLine1: z.string().min(1, "Enter address line 1").max(100, "Address line 1 must be 100 characters or less"),
  addressLine2: z.string().max(100, "Address line 2 must be 100 characters or less").optional(),
  town: z.string().min(1, "Enter a town or city").max(50, "Town or city must be 50 characters or less"),
  postcode: z
    .string()
    .min(1, "Enter a postcode")
    .regex(/^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i, "Enter a real postcode")
    .transform((val) => {
      const cleaned = val.toUpperCase().replace(/\s/g, "");
      // Add space before last 3 characters if not already present
      if (cleaned.length >= 3) {
        return `${cleaned.slice(0, -3)} ${cleaned.slice(-3)}`;
      }
      return cleaned;
    })
});

// Role schema with conditional validation
export const roleSchema = z.discriminatedUnion("roleType", [
  z.object({
    roleType: z.literal("frontend-developer")
  }),
  z.object({
    roleType: z.literal("backend-developer")
  }),
  z.object({
    roleType: z.literal("test-engineer")
  }),
  z.object({
    roleType: z.literal("other"),
    roleOther: z.string().min(1, "Enter your role").max(100, "Role must be 100 characters or less")
  })
]);

// Complete form schema for database submission
export const onboardingSubmissionSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  dateOfBirth: z.date(),
  addressLine1: z.string(),
  addressLine2: z.string().optional(),
  town: z.string(),
  postcode: z.string(),
  roleType: z.string(),
  roleOther: z.string().optional()
});

// Type exports
export type NameData = z.infer<typeof nameSchema>;
export type DobData = z.infer<typeof dobSchema>;
export type AddressData = z.infer<typeof addressSchema>;
export type RoleData = z.infer<typeof roleSchema>;
export type OnboardingSubmission = z.infer<typeof onboardingSubmissionSchema>;

// Error display interface
export interface ValidationError {
  field: string;
  text: string;
  href: string;
}

// Error formatter for GOV.UK components
export function formatZodErrors(error: z.ZodError): NestedErrors {
  return error.issues.reduce((acc, curr) => {
    return recursiveSet(acc, curr.path as (string | number)[], {
      field: curr.path.join("."),
      text: curr.message,
      href: `#${curr.path.join("-")}`
    });
  }, {} as NestedErrors);
}

function recursiveSet(obj: NestedErrors, path: (string | number)[], value: unknown): NestedErrors {
  if (path.length === 0) {
    return value as NestedErrors;
  }
  const [head, ...rest] = path;

  return {
    ...obj,
    [head]: obj[head] ?? recursiveSet((obj[head] as NestedErrors) || {}, rest, value)
  };
}

// Create error summary for GOV.UK error summary component
export function createErrorSummary(errors: NestedErrors) {
  return {
    titleText: "There is a problem",
    errorList: flattenErrors(errors)
  };
}

function flattenErrors(nested: NestedErrors): ValidationError[] {
  const result: ValidationError[] = [];
  for (const key in nested) {
    const value = nested[key];
    if ("field" in value && "text" in value && "href" in value) {
      result.push(value as ValidationError);
    } else {
      result.push(...flattenErrors(value));
    }
  }
  return result;
}

interface NestedErrors {
  [key: string]: ValidationError | NestedErrors;
}
