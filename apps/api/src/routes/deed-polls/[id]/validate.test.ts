import { InvalidInputError, NotFoundError, validateCaseForSubmit } from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestDouble, responseDouble } from "../../../express-doubles.js";
import { POST } from "./validate.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  validateCaseForSubmit: vi.fn()
}));

describe("POST /deed-polls/:id/validate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should respond 200 with the case when it is valid for submission, not 201", async () => {
    const record = { id: "case-1", notes: [], witnesses: [], documents: [] };
    vi.mocked(validateCaseForSubmit).mockResolvedValue(record as never);
    const res = responseDouble();

    await POST(requestDouble({ params: { id: "case-1" } }), res);

    expect(validateCaseForSubmit).toHaveBeenCalledWith("case-1");
    expect(res.json).toHaveBeenCalledWith(record);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("should let an InvalidInputError propagate with its field errors intact, since the forms render them per input", async () => {
    const violations = [{ field: "newSurname", message: "New surname is required" }];
    vi.mocked(validateCaseForSubmit).mockRejectedValue(new InvalidInputError("Case is not valid for submission", violations));

    await expect(POST(requestDouble({ params: { id: "case-1" } }), responseDouble())).rejects.toMatchObject({
      errors: violations
    });
  });

  it("should let a NotFoundError propagate for a case that does not exist", async () => {
    vi.mocked(validateCaseForSubmit).mockRejectedValue(new NotFoundError("DeedPoll missing not found"));

    await expect(POST(requestDouble({ params: { id: "missing" } }), responseDouble())).rejects.toThrow(NotFoundError);
  });

  it("should ignore any request body, because the case being checked is the persisted one", async () => {
    vi.mocked(validateCaseForSubmit).mockResolvedValue({ id: "case-1" } as never);

    await POST(requestDouble({ params: { id: "case-1" }, body: { newSurname: "Lovelace" } }), responseDouble());

    expect(validateCaseForSubmit).toHaveBeenCalledWith("case-1");
  });
});
