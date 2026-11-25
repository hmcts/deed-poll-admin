import {
  ConflictError,
  DeletionOutcomeUnknownError,
  ForbiddenError,
  findDeedPoll,
  findProcessSettings,
  InvalidInputError,
  NotFoundError,
  requestDeletion
} from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type DeletionJourney, newDeletionJourney, sealDeletionJourney } from "../../../application-deletion/journey.js";
import { pageRequest, pageResponse } from "../../../express-doubles.js";
import { GET, POST } from "./delete.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPoll: vi.fn(),
  findProcessSettings: vi.fn(),
  requestDeletion: vi.fn()
}));

const LAST_CHANGED_ON = "2026-11-20T10:15:30.123";
const REQUEST_ID = "6f1c1f4e-2b1a-4d8e-9f3a-1c2b3d4e5f60";
const NOTE = "Entered twice by mistake on intake";
const CASE = {
  id: "case-1",
  displayReference: "KBDP2026-00001",
  type: "Adult",
  state: "Received",
  privacy: "Normal",
  newForename: "Ada",
  newSurname: "Lovelace",
  dateReceived: new Date("2026-03-01T00:00:00.000Z"),
  lastChangedOn: LAST_CHANGED_ON
};

function request(body?: Record<string, unknown>, params: Record<string, string> = { id: "case-1" }, sessionID = "session-a") {
  return Object.assign(pageRequest({ params, body, accessToken: "session-token" }), { sessionID });
}

async function posted(fields: Record<string, unknown>, journey: DeletionJourney = newDeletionJourney("case-1", LAST_CHANGED_ON)) {
  return request({ journey: await sealDeletionJourney(request(), journey), ...fields });
}

describe("application deletion confirmation page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findDeedPoll).mockResolvedValue(CASE as never);
    vi.mocked(findProcessSettings).mockResolvedValue({ deletionGraceDays: 14 } as never);
    vi.mocked(requestDeletion).mockResolvedValue({ requestId: REQUEST_ID, status: "Pending", restorableUntil: new Date() } as never);
  });

  describe("GET", () => {
    it("should ask both questions with neither reason chosen, write nothing and bind a fresh key to what was reviewed", async () => {
      // Arrange
      const res = pageResponse();

      // Act
      await GET(request(), res);

      // Assert
      const [view, model] = res.render.mock.calls[0];
      expect(view).toBe("deed-polls/application-delete");
      expect(res.status).toHaveBeenCalledWith(200);
      expect(model.state).toBe("form");
      expect(model.reasonItems).toEqual([
        { value: "CREATED_IN_ERROR", text: "Created in error", checked: false },
        { value: "DUPLICATE", text: "Duplicate application", checked: false }
      ]);
      expect(model.journey).toMatch(/^[\w-]+\.[a-f0-9]{64}$/);
      expect(model.actionPath).toBe("/deed-polls/case-1/delete");
      expect(model.applicationPath).toBe("/deed-polls/case-1");
      expect(requestDeletion).not.toHaveBeenCalled();
    });

    it("should identify the application by the details every caseworker sees on the list", async () => {
      const res = pageResponse();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].summaryRows).toEqual([
        { key: "Reference", value: "KBDP2026-00001" },
        { key: "New forename", value: "Ada" },
        { key: "New surname", value: "Lovelace" },
        { key: "Type", value: "Adult" },
        { key: "Status", value: "Received" },
        { key: "Date received", value: expect.stringContaining("2026") }
      ]);
    });

    it("should say how long the application can be restored for from the process settings", async () => {
      const res = pageResponse();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].restoreSentence).toBe("A Delivery Manager can restore it for 14 days after you delete it.");
    });

    it("should still offer the form, naming no number, when the process settings cannot be read", async () => {
      vi.mocked(findProcessSettings).mockRejectedValue(new Error("deed-poll-api call failed (unavailable)"));
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const res = pageResponse();

      await GET(request(), res);

      const model = res.render.mock.calls[0][1];
      expect(model.state).toBe("form");
      expect(model.restoreSentence).toBe("A Delivery Manager can restore it for a set number of days after you delete it.");
    });

    it("should offer no form when the case detail carries no lastChangedOn to confirm against", async () => {
      vi.mocked(findDeedPoll).mockResolvedValue({ ...CASE, lastChangedOn: null } as never);
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const res = pageResponse();

      await GET(request(), res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.render.mock.calls[0][1].state).toBe("stopped");
      expect(res.render.mock.calls[0][1].journey).toBeUndefined();
    });

    it("should leave an unknown application to the not-found page", async () => {
      vi.mocked(findDeedPoll).mockRejectedValue(new NotFoundError("Case case-9 not found"));

      await expect(GET(request(), pageResponse())).rejects.toBeInstanceOf(NotFoundError);
    });

    it("should refuse a dot segment before anything is read", async () => {
      await expect(GET(request(undefined, { id: ".." }), pageResponse())).rejects.toBeInstanceOf(NotFoundError);
      expect(findDeedPoll).not.toHaveBeenCalled();
    });
  });

  describe("POST", () => {
    it("should send the reviewed lastChangedOn, the answers and the rendered key, then 303 to the request's status", async () => {
      // Arrange
      const journey = newDeletionJourney("case-1", LAST_CHANGED_ON);
      const res = pageResponse();

      // Act
      await POST(await posted({ action: "delete", reason: "DUPLICATE", note: `  ${NOTE}  ` }, journey), res);

      // Assert
      expect(requestDeletion).toHaveBeenCalledWith("case-1", { reason: "DUPLICATE", note: NOTE, expectedLastChangedOn: LAST_CHANGED_ON }, journey.key, {
        accessToken: "session-token"
      });
      expect(res.redirect).toHaveBeenCalledWith(303, `/deed-polls/deletions/${REQUEST_ID}`);
    });

    it("should send the same key for a double submit of one rendered form", async () => {
      const journey = newDeletionJourney("case-1", LAST_CHANGED_ON);
      const fields = { action: "delete", reason: "CREATED_IN_ERROR", note: NOTE };

      await POST(await posted(fields, journey), pageResponse());
      await POST(await posted(fields, journey), pageResponse());

      expect(vi.mocked(requestDeletion).mock.calls.map((call) => call[2])).toEqual([journey.key, journey.key]);
    });

    it.each([{}, { action: "cancel" }, { action: ["delete", "delete"] }])("should write nothing and go back to the application for %j", async (fields) => {
      const res = pageResponse();

      await POST(await posted({ reason: "DUPLICATE", note: NOTE, ...fields }), res);

      expect(requestDeletion).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(303, "/deed-polls/case-1");
    });

    it.each([
      ["a missing journey", () => Promise.resolve(request({ action: "delete", reason: "DUPLICATE", note: NOTE }))],
      ["a forged journey", () => Promise.resolve(request({ action: "delete", reason: "DUPLICATE", note: NOTE, journey: `e30.${"0".repeat(64)}` }))],
      [
        "another application's journey",
        async () =>
          request({
            action: "delete",
            reason: "DUPLICATE",
            note: NOTE,
            journey: await sealDeletionJourney(request(), newDeletionJourney("case-2", LAST_CHANGED_ON))
          })
      ],
      [
        "another session's journey",
        async () =>
          request(
            { action: "delete", reason: "DUPLICATE", note: NOTE, journey: await sealDeletionJourney(request(), newDeletionJourney("case-1", LAST_CHANGED_ON)) },
            { id: "case-1" },
            "session-b"
          )
      ]
    ])("should refuse %s with no write", async (_name, build) => {
      const res = pageResponse();

      await POST(await build(), res);

      expect(requestDeletion).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][1]).toMatchObject({ state: "stopped", heading: "This confirmation can no longer be used" });
    });

    it("should refuse an expired journey with no write", async () => {
      const res = pageResponse();

      await POST(
        await posted({ action: "delete", reason: "DUPLICATE", note: NOTE }, newDeletionJourney("case-1", LAST_CHANGED_ON, Date.now() - 9 * 60 * 60 * 1000)),
        res
      );

      expect(requestDeletion).not.toHaveBeenCalled();
      expect(res.render.mock.calls[0][1].heading).toBe("This confirmation has expired");
    });

    it("should redraw the answers with each error on its control and keep the same key when the form is incomplete", async () => {
      // Arrange
      const journey = newDeletionJourney("case-1", LAST_CHANGED_ON);
      const res = pageResponse();

      // Act
      await POST(await posted({ action: "delete", note: "too short" }, journey), res);

      // Assert
      const model = res.render.mock.calls[0][1];
      expect(requestDeletion).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(model.errorList).toEqual([
        { text: "Select why this application is being deleted", href: "#reason" },
        { text: "Why you are deleting this application must be 10 characters or more", href: "#note" }
      ]);
      expect(model.values).toEqual({ reason: "", note: "too short" });
      expect(model.journey).toBe(await sealDeletionJourney(request(), journey));
    });

    it("should refuse a repeated or bracketed control rather than stringify it", async () => {
      const res = pageResponse();

      await POST(await posted({ action: "delete", reason: ["DUPLICATE", "CREATED_IN_ERROR"], note: { text: NOTE } }), res);

      const model = res.render.mock.calls[0][1];
      expect(requestDeletion).not.toHaveBeenCalled();
      expect(Object.keys(model.errors)).toEqual(["reason", "note"]);
      expect(model.values).toEqual({ reason: "", note: "" });
    });

    it("should keep a chosen reason checked on a redraw", async () => {
      const res = pageResponse();

      await POST(await posted({ action: "delete", reason: "DUPLICATE", note: "" }), res);

      expect(res.render.mock.calls[0][1].reasonItems.map((item: { checked: boolean }) => item.checked)).toEqual([false, true]);
    });

    describe("when api's answer never comes", () => {
      beforeEach(() => {
        vi.mocked(requestDeletion).mockRejectedValue(new DeletionOutcomeUnknownError());
        vi.spyOn(console, "error").mockImplementation(() => undefined);
      });

      it("should say the outcome is unknown, without reading the case to guess", async () => {
        const res = pageResponse();

        await POST(await posted({ action: "delete", reason: "DUPLICATE", note: NOTE }), res);

        expect(res.status).toHaveBeenCalledWith(503);
        expect(res.render.mock.calls[0][1]).toMatchObject({ state: "unknown", heading: "We do not know whether the application has been deleted" });
        expect(findDeedPoll).not.toHaveBeenCalled();
      });

      it("should replay exactly the original request and key from the recovery page, whatever else is posted", async () => {
        // Arrange
        const journey = newDeletionJourney("case-1", LAST_CHANGED_ON);
        const first = pageResponse();
        await POST(await posted({ action: "delete", reason: "DUPLICATE", note: NOTE }, journey), first);
        const recoveryToken = first.render.mock.calls[0][1].journey;
        vi.mocked(requestDeletion).mockResolvedValue({ requestId: REQUEST_ID, status: "Pending", restorableUntil: new Date() } as never);
        const res = pageResponse();

        // Act
        await POST(request({ journey: recoveryToken, action: "check", reason: "CREATED_IN_ERROR", note: "A different note entirely" }), res);

        // Assert
        expect(vi.mocked(requestDeletion).mock.calls[1]).toEqual([
          "case-1",
          { reason: "DUPLICATE", note: NOTE, expectedLastChangedOn: LAST_CHANGED_ON },
          journey.key,
          { accessToken: "session-token" }
        ]);
        expect(res.redirect).toHaveBeenCalledWith(303, `/deed-polls/deletions/${REQUEST_ID}`);
      });

      it("should not let the recovery token start a deletion with new answers", async () => {
        const first = pageResponse();
        await POST(await posted({ action: "delete", reason: "DUPLICATE", note: NOTE }), first);
        const res = pageResponse();

        await POST(request({ journey: first.render.mock.calls[0][1].journey, action: "delete", reason: "CREATED_IN_ERROR", note: NOTE }), res);

        expect(requestDeletion).toHaveBeenCalledTimes(1);
        expect(res.redirect).toHaveBeenCalledWith(303, "/deed-polls/case-1");
      });

      it("should keep the recovery page, with the same sealed request, when checking fails again", async () => {
        const first = pageResponse();
        await POST(await posted({ action: "delete", reason: "DUPLICATE", note: NOTE }), first);
        const token = first.render.mock.calls[0][1].journey;
        const res = pageResponse();

        await POST(request({ journey: token, action: "check" }), res);

        expect(res.render.mock.calls[0][1]).toMatchObject({ state: "unknown", journey: token });
      });
    });

    it.each([
      ["STALE_CONFIRMATION", "The application has changed", "The application has changed since you reviewed it."],
      ["RETAINED_PERMANENTLY", "The application cannot be deleted", "marked to be kept permanently"],
      ["GAZETTE_EVIDENCE", "The application cannot be deleted", "London Gazette"],
      ["KEY_REUSED", "The application cannot be deleted", "already been requested with different answers"],
      ["CONFLICTING_REASON", "The application cannot be deleted", "with the other reason"],
      ["RESTORE_WINDOW_CLOSED", "The application cannot be deleted", "Return to the application to check its details."],
      [null, "The application cannot be deleted", "Return to the application to check its details."]
    ])("should explain a %s refusal in this page's words and offer no resubmit", async (code, heading, sentence) => {
      vi.mocked(requestDeletion).mockRejectedValue(new ConflictError("api's own words <script>", [], code as never));
      const res = pageResponse();

      await POST(await posted({ action: "delete", reason: "DUPLICATE", note: NOTE }), res);

      const model = res.render.mock.calls[0][1];
      expect(res.status).toHaveBeenCalledWith(409);
      expect(model).toMatchObject({ state: "stopped", heading, applicationPath: "/deed-polls/case-1" });
      expect(model.sentence).toContain(sentence);
      expect(model.sentence).not.toContain("api's own words");
      expect(model.journey).toBeUndefined();
      expect(requestDeletion).toHaveBeenCalledTimes(1);
    });

    it("should redraw api's 400 on its fields in this page's words, with the same key unsealed so the answers can change", async () => {
      // Arrange
      vi.mocked(requestDeletion).mockRejectedValueOnce(new InvalidInputError("bad", [{ field: "note", message: "api prose" }]));
      const journey = newDeletionJourney("case-1", LAST_CHANGED_ON);
      const res = pageResponse();

      // Act
      await POST(await posted({ action: "delete", reason: "DUPLICATE", note: NOTE }, journey), res);
      const corrected = pageResponse();
      await POST(request({ journey: res.render.mock.calls[0][1].journey, action: "delete", reason: "DUPLICATE", note: `${NOTE}, corrected` }), corrected);

      // Assert
      const model = res.render.mock.calls[0][1];
      expect(res.status).toHaveBeenCalledWith(400);
      expect(model.errors).toEqual({ note: "Enter why you are deleting this application in 10 to 500 characters, on one line" });
      expect(model.values).toEqual({ reason: "DUPLICATE", note: NOTE });
      expect(vi.mocked(requestDeletion).mock.calls[1][1].note).toBe(`${NOTE}, corrected`);
      expect(vi.mocked(requestDeletion).mock.calls[1][2]).toBe(journey.key);
    });

    it("should put an unplaceable 400 on the form in this page's words", async () => {
      vi.mocked(requestDeletion).mockRejectedValue(new InvalidInputError("bad", [{ field: "expectedLastChangedOn", message: "api prose" }]));
      const res = pageResponse();

      await POST(await posted({ action: "delete", reason: "DUPLICATE", note: NOTE }), res);

      expect(res.render.mock.calls[0][1].errorList).toEqual([{ text: "The deletion was not requested. Check your answers and try again.", href: "#reason" }]);
    });

    it("should leave a 403 to the forbidden flow", async () => {
      vi.mocked(requestDeletion).mockRejectedValue(new ForbiddenError("refused"));

      await expect(POST(await posted({ action: "delete", reason: "DUPLICATE", note: NOTE }), pageResponse())).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("should use the Welsh content when the locale is cy", async () => {
      const res = pageResponse();
      res.locals.locale = "cy";

      await POST(await posted({ action: "delete" }), res);

      expect(res.render.mock.calls[0][1].cy).toBeDefined();
      expect(res.render.mock.calls[0][1].errors.reason).toBe(res.render.mock.calls[0][1].cy.reasonRequired);
    });
  });
});
