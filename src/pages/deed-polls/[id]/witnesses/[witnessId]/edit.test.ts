import { findDeedPoll, findWitness, InvalidInputError, NotFoundError, removeWitness, updateWitness } from "@hmcts/deed-poll";
import type { Request } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../../../express-doubles.js";
import { GET, POST } from "./edit.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPoll: vi.fn(),
  findWitness: vi.fn(),
  updateWitness: vi.fn(),
  removeWitness: vi.fn()
}));

const found = { id: "case-1", displayReference: "KBDP2026-00001", notes: [], witnesses: [], documents: [] };

const stored = {
  id: "witness-1",
  witnessName: "Sam Doe",
  witnessAddress: "1 High Street, Leeds",
  witnessOccupation: "Teacher",
  declarant: true
};

const PARAMS = { id: "case-1", witnessId: "witness-1" };

/** The session's access token, which is the whole of what this page passes to the domain. */
const CALLER = { accessToken: "session-token" };

const SUBMITTED = {
  witnessName: "Sam Doe-Smith",
  witnessAddress: "2 Low Street, Leeds",
  witnessOccupation: "Nurse",
  declarant: "false"
};

function request(body: Record<string, unknown> = {}, { admin = false } = {}): Request {
  return pageRequest({ params: PARAMS, body, admin, accessToken: "session-token" });
}

const response = pageResponse;

describe("amend a witness page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "test";
    vi.mocked(findDeedPoll).mockResolvedValue(found as never);
    vi.mocked(findWitness).mockResolvedValue(stored as never);
    vi.mocked(updateWitness).mockResolvedValue(stored as never);
    vi.mocked(removeWitness).mockResolvedValue(undefined);
  });

  describe("GET", () => {
    it("should render the stored witness in the form", async () => {
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][0]).toBe("deed-polls/witness-edit");
      expect(res.render.mock.calls[0][1].values).toEqual({
        witnessName: "Sam Doe",
        witnessAddress: "1 High Street, Leeds",
        witnessOccupation: "Teacher",
        // The string the radio posts, so one comparison serves this render and every re-render after it.
        declarant: "true"
      });
      expect(res.render.mock.calls[0][1].witnessId).toBe("witness-1");
    });

    it("should ask for the witness under the case in the path, so another case's witness cannot be opened", async () => {
      await GET(request(), response());

      expect(findWitness).toHaveBeenCalledWith("case-1", "witness-1", CALLER);
    });

    it("should render declarant as no for an ordinary witness", async () => {
      vi.mocked(findWitness).mockResolvedValue({ ...stored, declarant: false } as never);
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].values.declarant).toBe("false");
    });

    it("should 404 for a witness id that is not under this case", async () => {
      vi.mocked(findWitness).mockRejectedValue(new NotFoundError("Witness witness-9 not found"));

      await expect(GET(request(), response())).rejects.toThrow(NotFoundError);
    });

    it("should offer the delete button to an administrator", async () => {
      const res = response();

      await GET(request({}, { admin: true }), res);

      expect(res.render.mock.calls[0][1].canDelete).toBe(true);
    });

    it("should not offer the delete button to a caseworker with no admin role", async () => {
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].canDelete).toBe(false);
    });

    it("should still offer a caseworker the amend form, because the business splits amend from delete", async () => {
      // The tidy-minded mistake is to gate the whole form on the same flag. The stored values are what
      // would go with it.
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].values.witnessName).toBe("Sam Doe");
    });
  });

  describe("POST", () => {
    it("should send every field the form showed, then redirect to the witnesses tab", async () => {
      const res = response();

      await POST(request(SUBMITTED), res);

      expect(updateWitness).toHaveBeenCalledWith(
        "case-1",
        "witness-1",
        { witnessName: "Sam Doe-Smith", witnessAddress: "2 Low Street, Leeds", witnessOccupation: "Nurse", declarant: false },
        CALLER
      );
      expect(res.redirect).toHaveBeenCalledWith("/deed-polls/case-1#witnesses");
    });

    it("should send the session's token and nothing else, because a witness records no author", async () => {
      await POST(pageRequest({ params: PARAMS, body: SUBMITTED, name: "A Caseworker", accessToken: "session-token" }), response());

      expect(updateWitness).toHaveBeenCalledWith("case-1", "witness-1", expect.anything(), CALLER);
    });

    it("should turn a declarant into an ordinary witness when no is chosen, rather than dropping a false field", async () => {
      await POST(request({ ...SUBMITTED, declarant: "false" }), response());

      expect(updateWitness).toHaveBeenCalledWith("case-1", "witness-1", expect.objectContaining({ declarant: false }), CALLER);
    });

    it("should keep the submitted values on screen when validation fails, not the stored ones", async () => {
      const tooLong = "n".repeat(101);
      const res = response();

      await POST(request({ ...SUBMITTED, witnessName: tooLong }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(updateWitness).not.toHaveBeenCalled();
      expect(res.render.mock.calls[0][1].values.witnessName).toBe(tooLong);
      expect(res.render.mock.calls[0][1].errors.witnessName).toBe("Name must be 100 characters or fewer");
      expect(res.render.mock.calls[0][1].errorList).toEqual([{ text: "Name must be 100 characters or fewer", href: "#witnessName" }]);
    });

    it("should re-render with the witness id, so the failed form still posts back to the same witness", async () => {
      const res = response();

      await POST(request({ ...SUBMITTED, declarant: undefined }), res);

      expect(res.render.mock.calls[0][1].witnessId).toBe("witness-1");
    });

    it("should still 404 on the re-render path for a witness that is not under this case", async () => {
      // A re-render is its own request: a scoping guarantee that only holds on GET is not one.
      vi.mocked(findWitness).mockRejectedValue(new NotFoundError("Witness witness-9 not found"));

      await expect(POST(request({ ...SUBMITTED, witnessName: "n".repeat(101) }), response())).rejects.toThrow(NotFoundError);
    });

    it("should put api's rejection against the field it names", async () => {
      vi.mocked(updateWitness).mockRejectedValue(
        new InvalidInputError("Request body is not valid", [{ field: "witnessOccupation", message: "Occupation is not recognised" }])
      );
      const res = response();

      await POST(request(SUBMITTED), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][1].errors.witnessOccupation).toBe("Occupation is not recognised");
      expect(res.redirect).not.toHaveBeenCalled();
    });

    it("should show the page's own copy, not api's wording, when its rejection names no field", async () => {
      vi.mocked(updateWitness).mockRejectedValue(new InvalidInputError("deed-poll-api answered 400"));
      const res = response();

      await POST(request(SUBMITTED), res);

      expect(res.render.mock.calls[0][1].errorList[0].text).toBe("The witness could not be saved. Check the details and try again.");
      expect(res.render.mock.calls[0][1].errorList[0].text).not.toContain("deed-poll-api");
    });

    it("should let an unreachable api reach the error handler rather than blaming the caseworker for it", async () => {
      vi.mocked(updateWitness).mockRejectedValue(new Error("deed-poll-api call failed (unavailable): deed-poll-api could not be reached"));

      await expect(POST(request(SUBMITTED), response())).rejects.toThrow(/unavailable/);
    });

    it("should delete the witness and redirect to the witnesses tab", async () => {
      // As an administrator, since they are the only role offered the button.
      const res = response();

      await POST(request({ ...SUBMITTED, action: "delete" }, { admin: true }), res);

      expect(removeWitness).toHaveBeenCalledWith("case-1", "witness-1", CALLER);
      expect(updateWitness).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith("/deed-polls/case-1#witnesses");
    });

    it("should delete a witness whose fields would fail validation, because delete is checked before them", async () => {
      // The reason the branch is first: the four fields are irrelevant to a row about to disappear, so an
      // over-long name must not be able to block the deletion.
      const res = response();

      await POST(request({ ...SUBMITTED, witnessName: "n".repeat(101), action: "delete" }, { admin: true }), res);

      expect(removeWitness).toHaveBeenCalledWith("case-1", "witness-1", CALLER);
      expect(res.status).not.toHaveBeenCalledWith(400);
    });

    it("should save when no action was submitted, so a missing value is never destructive", async () => {
      await POST(request(SUBMITTED), response());

      expect(updateWitness).toHaveBeenCalled();
      expect(removeWitness).not.toHaveBeenCalled();
    });

    it("should not delete for an action other than the literal delete", async () => {
      await POST(request({ ...SUBMITTED, action: "Delete" }), response());

      expect(removeWitness).not.toHaveBeenCalled();
      expect(updateWitness).toHaveBeenCalled();
    });

    it("should 404 a delete of a witness belonging to another case rather than reporting success", async () => {
      vi.mocked(removeWitness).mockRejectedValue(new NotFoundError("Witness witness-9 not found"));

      await expect(POST(request({ action: "delete" }, { admin: true }), response())).rejects.toThrow(NotFoundError);
    });

    it("should leave a caseworker's forged delete to api rather than refusing it here", async () => {
      // Deliberate: with the button hidden, reaching this branch takes a hand-crafted request, and api
      // enforces the rule in its domain. A local refusal as well would put the authority in two places.
      const res = response();

      await POST(request({ ...SUBMITTED, action: "delete" }), res);

      expect(removeWitness).toHaveBeenCalledWith("case-1", "witness-1", CALLER);
      expect(res.status).not.toHaveBeenCalledWith(403);
    });

    it("should keep the delete button hidden from a caseworker when a rejected save re-renders the form", async () => {
      // The path a caseworker reaches by submitting an over-long field. A flag read only in `GET` puts the
      // button back here, and nothing else in this suite would notice.
      const res = response();

      await POST(request({ ...SUBMITTED, witnessName: "n".repeat(101) }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][1].canDelete).toBe(false);
    });

    it("should keep the delete button on an administrator's rejected save, so the re-render reads the session and does not hard-code false", async () => {
      const res = response();

      await POST(request({ ...SUBMITTED, witnessName: "n".repeat(101) }, { admin: true }), res);

      expect(res.render.mock.calls[0][1].canDelete).toBe(true);
    });
  });
});
