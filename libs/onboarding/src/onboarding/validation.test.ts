import { describe, it, expect } from "vitest";
import { nameSchema, dobSchema, addressSchema, roleSchema, formatZodErrors, createErrorSummary } from "./validation.js";

describe("nameSchema", () => {
  it("should validate valid name data", () => {
    const validData = {
      firstName: "John",
      lastName: "Smith"
    };

    const result = nameSchema.safeParse(validData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validData);
    }
  });

  it("should reject empty first name", () => {
    const invalidData = {
      firstName: "",
      lastName: "Smith"
    };

    const result = nameSchema.safeParse(invalidData);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("Enter your first name");
    }
  });

  it("should reject names with invalid characters", () => {
    const invalidData = {
      firstName: "John123",
      lastName: "Smith"
    };

    const result = nameSchema.safeParse(invalidData);
    expect(result.success).toBe(false);
  });

  it("should accept names with valid special characters", () => {
    const validData = {
      firstName: "Mary-Jane",
      lastName: "O'Connor"
    };

    const result = nameSchema.safeParse(validData);
    expect(result.success).toBe(true);
  });
});

describe("dobSchema", () => {
  it("should validate valid date of birth", () => {
    const validData = {
      day: "15",
      month: "6",
      year: "1990"
    };

    const result = dobSchema.safeParse(validData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.day).toBe(15);
      expect(result.data.month).toBe(6);
      expect(result.data.year).toBe(1990);
    }
  });

  it("should reject invalid dates", () => {
    const invalidData = {
      day: "31",
      month: "2",
      year: "1990"
    };

    const result = dobSchema.safeParse(invalidData);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("Enter a real date");
    }
  });

  it("should reject age under 16", () => {
    const currentYear = new Date().getFullYear();
    const recentYear = currentYear - 10; // 10 years old

    const underage = {
      day: "1",
      month: "1",
      year: recentYear.toString()
    };

    const result = dobSchema.safeParse(underage);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("You must be at least 16 years old");
    }
  });

  it("should accept age 16 and above", () => {
    const currentYear = new Date().getFullYear();
    const validYear = currentYear - 20; // 20 years old

    const validAge = {
      day: "1",
      month: "1",
      year: validYear.toString()
    };

    const result = dobSchema.safeParse(validAge);
    expect(result.success).toBe(true);
  });
});

describe("addressSchema", () => {
  it("should validate complete address", () => {
    const validData = {
      addressLine1: "123 Main Street",
      addressLine2: "Flat 2",
      town: "London",
      postcode: "SW1A 1AA"
    };

    const result = addressSchema.safeParse(validData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.postcode).toBe("SW1A 1AA");
    }
  });

  it("should accept address without line 2", () => {
    const validData = {
      addressLine1: "123 Main Street",
      town: "London",
      postcode: "SW1A1AA"
    };

    const result = addressSchema.safeParse(validData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.postcode).toBe("SW1A 1AA"); // Should add space
    }
  });

  it("should reject invalid postcode", () => {
    const invalidData = {
      addressLine1: "123 Main Street",
      town: "London",
      postcode: "INVALID"
    };

    const result = addressSchema.safeParse(invalidData);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe("Enter a real postcode");
    }
  });
});

describe("roleSchema", () => {
  it("should validate predefined roles", () => {
    const validData = {
      roleType: "frontend-developer"
    };

    const result = roleSchema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  it("should validate other role with specification", () => {
    const validData = {
      roleType: "other",
      roleOther: "Product Manager"
    };

    const result = roleSchema.safeParse(validData);
    expect(result.success).toBe(true);
    if (result.success && result.data.roleType === "other") {
      expect(result.data.roleOther).toBe("Product Manager");
    }
  });

  it("should reject other role without specification", () => {
    const invalidData = {
      roleType: "other"
    };

    const result = roleSchema.safeParse(invalidData);
    expect(result.success).toBe(false);
  });
});

describe("formatZodErrors", () => {
  it("should format Zod errors correctly", () => {
    const invalidData = {
      firstName: "",
      lastName: "Smith"
    };

    const result = nameSchema.safeParse(invalidData);
    if (!result.success) {
      const formattedErrors = formatZodErrors(result.error);

      // Check that the formatted errors have the firstName error
      expect(formattedErrors.firstName).toBeDefined();
      expect(formattedErrors.firstName).toEqual({
        field: "firstName",
        text: "Enter your first name",
        href: "#firstName"
      });
    }
  });
});

describe("createErrorSummary", () => {
  it("should create GOV.UK error summary", () => {
    const errors = {
      firstName: {
        field: "firstName",
        text: "Enter your first name",
        href: "#firstName"
      }
    };

    const summary = createErrorSummary(errors);
    expect(summary.titleText).toBe("There is a problem");
    expect(summary.errorList).toHaveLength(1);
    expect(summary.errorList[0]).toEqual({
      field: "firstName",
      text: "Enter your first name",
      href: "#firstName"
    });
  });
});

describe("addressSchema - short postcode", () => {
  it("should return postcode as-is when shorter than 3 characters", () => {
    const result = addressSchema.safeParse({
      addressLine1: "123 Main Street",
      town: "London",
      postcode: "AB"
    });
    expect(result.success).toBe(false);
  });
});

describe("createErrorSummary - nested errors", () => {
  it("should flatten nested error objects", () => {
    const errors = {
      dateOfBirth: {
        day: { field: "day", text: "Enter a day", href: "#day" },
        month: { field: "month", text: "Enter a month", href: "#month" }
      }
    };

    const summary = createErrorSummary(errors as any);
    expect(summary.errorList).toHaveLength(2);
  });
});
