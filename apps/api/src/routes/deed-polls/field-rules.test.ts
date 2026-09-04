import { getCaseFieldRules } from "@hmcts/deed-poll";
import { DeedPollType } from "@hmcts/postgres-prisma";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { requestDouble, responseDouble } from "../../express-doubles.js";
import { GET } from "./field-rules.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  getCaseFieldRules: vi.fn()
}));

describe("GET /deed-polls/field-rules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCaseFieldRules).mockReturnValue({} as never);
  });

  it("should return the rules for the requested type", async () => {
    const rules = { visible: ["ageOfMinor"], required: ["ageOfMinor"] };
    vi.mocked(getCaseFieldRules).mockReturnValue(rules as never);
    const res = responseDouble();

    await GET(requestDouble({ query: { type: DeedPollType.Minor } }), res);

    expect(getCaseFieldRules).toHaveBeenCalledWith(DeedPollType.Minor);
    expect(res.json).toHaveBeenCalledWith(rules);
  });

  it("should pass null when no type is supplied, so the caller gets the typeless matrix", async () => {
    await GET(requestDouble({ query: {} }), responseDouble());

    expect(getCaseFieldRules).toHaveBeenCalledWith(null);
  });

  it("should reject an unrecognised type instead of silently answering with the typeless rules", async () => {
    await expect(GET(requestDouble({ query: { type: "NotAType" } }), responseDouble())).rejects.toThrow(ZodError);

    expect(getCaseFieldRules).not.toHaveBeenCalled();
  });

  it("should reject a repeated type parameter, which Express parses as an array", async () => {
    await expect(GET(requestDouble({ query: { type: [DeedPollType.Minor, DeedPollType.Adult] } }), responseDouble())).rejects.toThrow(ZodError);

    expect(getCaseFieldRules).not.toHaveBeenCalled();
  });

  it("should reject an empty type parameter rather than treating it as absent", async () => {
    await expect(GET(requestDouble({ query: { type: "" } }), responseDouble())).rejects.toThrow(ZodError);

    expect(getCaseFieldRules).not.toHaveBeenCalled();
  });

  it("should ignore query parameters it does not model, so migrated cannot be forced over HTTP", async () => {
    await expect(GET(requestDouble({ query: { type: DeedPollType.Minor, migrated: "true" } }), responseDouble())).resolves.toBeUndefined();

    expect(getCaseFieldRules).toHaveBeenCalledWith(DeedPollType.Minor);
  });
});
