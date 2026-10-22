import { createWitness, findDeedPoll, InvalidInputError, NotFoundError } from "@hmcts/deed-poll";
import type { Request } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../../express-doubles.js";
import { GET, POST } from "./new.js";

// createWitnessSchema is the domain's, so it runs for real here — the caps and "declarant is a boolean"
// are as much the behaviour under test as the handler is.
vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPoll: vi.fn(),
  createWitness: vi.fn()
}));

const found = { id: "case-1", displayReference: "KBDP2026-00001", notes: [], witnesses: [], documents: [] };

const PARAMS = { id: "case-1" };

/** The session's access token, which is the whole of what this page passes to the domain. */
const CALLER = { accessToken: "session-token" };

const COMPLETE = {
  witnessName: "Sam Doe",
  witnessAddress: "1 High Street, Leeds",
  witnessOccupation: "Teacher",
  declarant: "false"
};

function request(body: Record<string, unknown> = {}): Request {
  return pageRequest({ params: PARAMS, body, accessToken: "session-token" });
}

const response = pageResponse;

describe("add a witness page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "test";
    vi.mocked(findDeedPoll).mockResolvedValue(found as never);
    vi.mocked(createWitness).mockResolvedValue({ id: "witness-1" } as never);
  });

  describe("GET", () => {
    it("should render an empty form against the case in the path", async () => {
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][0]).toBe("deed-polls/witness-form");
      expect(res.render.mock.calls[0][1].values).toEqual({});
      expect(res.render.mock.calls[0][1].case.displayReference).toBe("KBDP2026-00001");
    });

    it("should leave both declarant radios unselected, so the question is not answered for the caseworker", async () => {
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].values.declarant).toBeUndefined();
    });

    it("should render no errors and an empty summary before anything is submitted", async () => {
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].errors).toEqual({});
      expect(res.render.mock.calls[0][1].errorList).toEqual([]);
    });

    it("should 404 for a missing case rather than rendering a form against nothing", async () => {
      vi.mocked(findDeedPoll).mockRejectedValue(new NotFoundError("DeedPoll nope not found"));

      await expect(GET(request(), response())).rejects.toThrow(NotFoundError);
    });
  });

  describe("POST", () => {
    it("should create the witness and redirect to the witnesses tab", async () => {
      const res = response();

      await POST(request(COMPLETE), res);

      expect(createWitness).toHaveBeenCalledWith(
        "case-1",
        { witnessName: "Sam Doe", witnessAddress: "1 High Street, Leeds", witnessOccupation: "Teacher", declarant: false },
        CALLER
      );
      expect(res.redirect).toHaveBeenCalledWith("/deed-polls/case-1#witnesses");
    });

    it("should send the session's token and nothing else, because a witness records no author", async () => {
      await POST(pageRequest({ params: PARAMS, body: COMPLETE, name: "A Caseworker", accessToken: "session-token" }), response());

      expect(createWitness).toHaveBeenCalledWith("case-1", expect.anything(), CALLER);
    });

    it("should send declarant as true when yes was chosen", async () => {
      await POST(request({ ...COMPLETE, declarant: "true" }), response());

      expect(createWitness).toHaveBeenCalledWith("case-1", expect.objectContaining({ declarant: true }), CALLER);
    });

    it("should re-render with the error against declarant when the question was left unanswered", async () => {
      // The failure the radios exist for: an unchecked checkbox would have posted nothing and been read as
      // "ordinary witness", answering it on the caseworker's behalf.
      const res = response();

      await POST(request({ ...COMPLETE, declarant: undefined }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(createWitness).not.toHaveBeenCalled();
      expect(res.render.mock.calls[0][1].errors.declarant).toBe("Select yes if this person is the declarant");
      expect(res.render.mock.calls[0][1].errorList).toEqual([{ text: "Select yes if this person is the declarant", href: "#declarant" }]);
    });

    it('should treat the string "false" as no rather than as a truthy declarant', async () => {
      // `Boolean("false")` is true, so a coercion here would make every witness a declarant.
      await POST(request({ ...COMPLETE, declarant: "false" }), response());

      expect(createWitness).toHaveBeenCalledWith("case-1", expect.objectContaining({ declarant: false }), CALLER);
    });

    it("should keep an over-long address on screen instead of discarding it", async () => {
      const tooLong = "x".repeat(251);
      const res = response();

      await POST(request({ ...COMPLETE, witnessAddress: tooLong }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(createWitness).not.toHaveBeenCalled();
      expect(res.render.mock.calls[0][1].values.witnessAddress).toBe(tooLong);
      expect(res.render.mock.calls[0][1].errors.witnessAddress).toBe("Address must be 250 characters or fewer");
    });

    it("should accept each field exactly at its limit, so no boundary is off by one", async () => {
      await POST(
        request({
          witnessName: "n".repeat(100),
          witnessAddress: "a".repeat(250),
          witnessOccupation: "o".repeat(100),
          declarant: "true"
        }),
        response()
      );

      expect(createWitness).toHaveBeenCalled();
    });

    it("should list every failing field in the error summary, in the order the controls appear", async () => {
      const res = response();

      await POST(request({ witnessName: "n".repeat(101), witnessOccupation: "o".repeat(101), witnessAddress: "1 High Street" }), res);

      expect(res.render.mock.calls[0][1].errorList.map((row: { href: string }) => row.href)).toEqual(["#witnessName", "#witnessOccupation", "#declarant"]);
    });

    // Review finding R15: a blank witness was created and counted towards the enrolment-witness threshold.
    it.each([
      ["witnessName", "Enter the witness's name"],
      ["witnessAddress", "Enter the witness's address"],
      ["witnessOccupation", "Enter the witness's occupation"]
    ])("should refuse a blank or whitespace-only %s with no api call and the input redrawn", async (field, message) => {
      for (const blank of ["", "   "]) {
        vi.mocked(createWitness).mockClear();
        const res = response();

        await POST(request({ ...COMPLETE, [field]: blank }), res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(createWitness).not.toHaveBeenCalled();
        expect(res.render.mock.calls[0][1].values[field]).toBe(blank);
        expect(res.render.mock.calls[0][1].errors[field]).toBe(message);
        expect(res.render.mock.calls[0][1].errorList).toEqual([{ text: message, href: `#${field}` }]);
      }
    });

    it("should refuse an absent field as blank rather than as too long", async () => {
      const res = response();

      await POST(request({ ...COMPLETE, witnessOccupation: undefined }), res);

      expect(createWitness).not.toHaveBeenCalled();
      expect(res.render.mock.calls[0][1].errors.witnessOccupation).toBe("Enter the witness's occupation");
    });

    it("should send padded values trimmed", async () => {
      await POST(request({ ...COMPLETE, witnessName: "  Sam Doe  ", witnessAddress: " 1 High Street, Leeds\n", witnessOccupation: "\tTeacher " }), response());

      expect(createWitness).toHaveBeenCalledWith(
        "case-1",
        { witnessName: "Sam Doe", witnessAddress: "1 High Street, Leeds", witnessOccupation: "Teacher", declarant: false },
        CALLER
      );
    });

    it("should measure the maximum after trimming, so padding a value that fits does not refuse it", async () => {
      await POST(request({ ...COMPLETE, witnessName: `  ${"n".repeat(100)}  ` }), response());

      expect(createWitness).toHaveBeenCalledWith("case-1", expect.objectContaining({ witnessName: "n".repeat(100) }), CALLER);
    });

    it("should keep the typed details on screen when api rejects them for a rule this form does not mirror", async () => {
      vi.mocked(createWitness).mockRejectedValue(
        new InvalidInputError("Request body is not valid", [{ field: "witnessName", message: "A witness cannot share the applicant's name" }])
      );
      const res = response();

      await POST(request(COMPLETE), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][1].errors.witnessName).toBe("A witness cannot share the applicant's name");
      expect(res.render.mock.calls[0][1].values.witnessName).toBe("Sam Doe");
      expect(res.redirect).not.toHaveBeenCalled();
    });

    it("should show the page's own copy, not api's wording, when its rejection names no field", async () => {
      vi.mocked(createWitness).mockRejectedValue(new InvalidInputError("deed-poll-api answered 400"));
      const res = response();

      await POST(request(COMPLETE), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][1].errorList[0].text).toBe("The witness could not be saved. Check the details and try again.");
      expect(res.render.mock.calls[0][1].errorList[0].text).not.toContain("deed-poll-api");
      expect(res.render.mock.calls[0][1].values.witnessName).toBe("Sam Doe");
    });

    it("should let an unreachable api reach the error handler rather than blaming the caseworker for it", async () => {
      vi.mocked(createWitness).mockRejectedValue(new Error("deed-poll-api call failed (unavailable): deed-poll-api could not be reached"));

      await expect(POST(request(COMPLETE), response())).rejects.toThrow(/unavailable/);
    });
  });

  // `../../../../case-path.test.ts` holds the full payload matrix; this pins the destination.
  describe("a case id carrying URL delimiters", () => {
    const RAW_ID = "a/b?c#d";

    function delimited(id: string) {
      return pageRequest({ params: { id }, body: COMPLETE, accessToken: "session-token" });
    }

    it("should create under the raw id and return to the encoded case's witnesses tab", async () => {
      const res = response();

      await POST(delimited(RAW_ID), res);

      expect(createWitness).toHaveBeenCalledTimes(1);
      expect(createWitness).toHaveBeenCalledWith(RAW_ID, expect.objectContaining({ witnessName: "Sam Doe" }), CALLER);
      expect(res.redirect).toHaveBeenCalledWith("/deed-polls/a%2Fb%3Fc%23d#witnesses");
    });

    it.each(["", ".", ".."])("should 404 a witness under case %j before anything is written", async (id) => {
      const res = response();

      await expect(POST(delimited(id), res)).rejects.toThrow(NotFoundError);

      expect(createWitness).not.toHaveBeenCalled();
      expect(res.redirect).not.toHaveBeenCalled();
    });
  });
});
