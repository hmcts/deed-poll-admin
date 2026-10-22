import { createDeedPoll, InvalidInputError, NotFoundError } from "@hmcts/deed-poll";
import type { Request } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../express-doubles.js";
import { GET, POST } from "./new.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  createDeedPoll: vi.fn()
}));

const validBody = {
  type: "Adult",
  newForename: "Ada",
  newSurname: "Lovelace",
  "dateReceived-day": "1",
  "dateReceived-month": "3",
  "dateReceived-year": "2026"
};

function request(body: Record<string, string> = {}): Request {
  return pageRequest({ body, name: "A Caseworker", accessToken: "caseworker-token" });
}

const response = pageResponse;

describe("new deed poll page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET", () => {
    it("renders an empty form with the type options", async () => {
      const res = response();

      await GET(request(), res);

      const model = res.render.mock.calls[0][1];
      expect(res.render.mock.calls[0][0]).toBe("deed-polls/new");
      expect(model.values).toEqual({});
      expect(model.typeOptions.length).toBeGreaterThan(1);
    });

    it("offers an empty first option, so no type is preselected", async () => {
      const res = response();

      await GET(request(), res);

      expect(res.render.mock.calls[0][1].typeOptions[0].value).toBe("");
    });

    it("provides both en and cy content objects with matching keys", async () => {
      const res = response();

      await GET(request(), res);

      const model = res.render.mock.calls[0][1];
      expect(Object.keys(model.en)).toEqual(Object.keys(model.cy));
    });
  });

  describe("POST", () => {
    it("composes the three date parts into one value before creating", async () => {
      vi.mocked(createDeedPoll).mockResolvedValue({ id: "case-1" } as never);

      await POST(request(validBody), response());

      expect(createDeedPoll).toHaveBeenCalledWith(
        expect.objectContaining({ type: "Adult", newForename: "Ada", newSurname: "Lovelace", dateReceived: "2026-03-01T00:00:00.000Z" }),
        expect.anything()
      );
    });

    it("redirects to the created case on success", async () => {
      vi.mocked(createDeedPoll).mockResolvedValue({ id: "case-1" } as never);
      const res = response();

      await POST(request(validBody), res);

      expect(res.redirect).toHaveBeenCalledWith("/deed-polls/case-1");
    });

    it("should keep an api-returned id containing URL delimiters as one path segment", async () => {
      vi.mocked(createDeedPoll).mockResolvedValue({ id: "a/b?c#d" } as never);
      const res = response();

      await POST(request(validBody), res);

      expect(res.redirect).toHaveBeenCalledWith("/deed-polls/a%2Fb%3Fc%23d");
      expect(createDeedPoll).toHaveBeenCalledTimes(1);
    });

    it.each(["", ".", ".."])("should 404 an api-returned id %j without creating a second case", async (id) => {
      vi.mocked(createDeedPoll).mockResolvedValue({ id } as never);
      const res = response();

      await expect(POST(request(validBody), res)).rejects.toThrow(NotFoundError);

      expect(createDeedPoll).toHaveBeenCalledTimes(1);
      expect(res.redirect).not.toHaveBeenCalled();
      expect(res.render).not.toHaveBeenCalled();
    });

    it("reads only the four fields the form offers, so a crafted POST cannot set state", async () => {
      vi.mocked(createDeedPoll).mockResolvedValue({ id: "case-1" } as never);

      await POST(request({ ...validBody, state: "Enroled", privacy: "Private" }), response());

      const payload = vi.mocked(createDeedPoll).mock.calls[0][0];
      expect(payload).not.toHaveProperty("state");
      expect(payload).not.toHaveProperty("privacy");
    });

    it("re-renders with a 400 and the submitted values when the type is not recognised", async () => {
      const res = response();

      await POST(request({ ...validBody, type: "NotAType" }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render).toHaveBeenCalledWith("deed-polls/new", expect.objectContaining({ values: expect.objectContaining({ newForename: "Ada" }) }));
      expect(createDeedPoll).not.toHaveBeenCalled();
    });

    it("keeps the rejected date parts on screen rather than discarding them", async () => {
      // A redirect would throw away everything typed to fix one bad year.
      const res = response();

      await POST(request({ ...validBody, type: "NotAType", "dateReceived-day": "99" }), res);

      expect(res.render.mock.calls[0][1].values["dateReceived-day"]).toBe("99");
    });

    it("rejects a date that does not exist rather than letting it roll over to the next month", async () => {
      // 31 February composes to 3 March, which api would accept as a date. Since the reference number's
      // year is derived from this field once and never again, a rolled-over date is stamped on the case.
      const res = response();

      await POST(request({ ...validBody, "dateReceived-day": "31", "dateReceived-month": "2" }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][1].errorSummary).toEqual([{ text: "Date received must be a real date", href: "#dateReceived" }]);
      expect(createDeedPoll).not.toHaveBeenCalled();
    });

    it("rejects a two-digit year, which Date.UTC would read as the 1900s", async () => {
      const res = response();

      await POST(request({ ...validBody, "dateReceived-year": "26" }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(createDeedPoll).not.toHaveBeenCalled();
    });

    it("names the missing parts when a date is only partly filled in", async () => {
      const res = response();

      await POST(request({ ...validBody, "dateReceived-month": "" }), res);

      expect(res.render.mock.calls[0][1].errorSummary).toEqual([{ text: "Date received must include a month", href: "#dateReceived" }]);
      expect(createDeedPoll).not.toHaveBeenCalled();
    });

    it("leaves a wholly blank date to api, which rejects it as the field it cannot allocate a reference without", async () => {
      // All three parts blank is not a typo, so the date check passes it through — the create then fails
      // at api with an error attributed to `dateReceived`, which is the message the caseworker needs.
      vi.mocked(createDeedPoll).mockResolvedValue({ id: "case-1" } as never);

      await POST(request({ type: "Adult" }), response());

      expect(createDeedPoll).toHaveBeenCalledWith(expect.objectContaining({ dateReceived: undefined }), expect.anything());
    });

    it("creates as the signed-in caseworker, so api attributes the case to them", async () => {
      // Not `{ isAdmin, userName }` any more: api reads both off the token, and a page that sent its
      // own opinion of them would be asserting an identity api never verified.
      vi.mocked(createDeedPoll).mockResolvedValue({ id: "case-1" } as never);

      await POST(request(validBody), response());

      expect(createDeedPoll).toHaveBeenCalledWith(expect.anything(), { accessToken: "caseworker-token" });
    });

    it("surfaces a missing Date Received as a form error, not a 500", async () => {
      // The schema accepts a case with no dates; it is api's reference-number allocation that cannot
      // proceed, so the failure arrives from the domain rather than from safeParse.
      vi.mocked(createDeedPoll).mockRejectedValue(
        new InvalidInputError("Cannot allocate a reference number without a Date Received to derive the year", [
          { field: "dateReceived", message: "Enter the date the application was received" }
        ])
      );
      const res = response();

      await POST(request({ type: "Adult" }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][1].errorSummary).toEqual([{ text: "Enter the date the application was received", href: "#dateReceived" }]);
    });

    it("shows this page's own copy when api's rejection names no field, and does not leak api's wording", async () => {
      // api omits `errors` when it has none, and an unparseable failure body — a proxy's HTML 400 — leaves
      // none either. The template hides an empty summary, so the summary must say something; but api's
      // message is developer-facing ("deed-poll-api answered 400"), and `.claude/rules/backend.md` keeps
      // api's internal error text away from caseworkers. So it is logged and the page's copy is rendered.
      vi.mocked(createDeedPoll).mockRejectedValue(new InvalidInputError("deed-poll-api answered 400"));
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      const res = response();

      await POST(request(validBody), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][1].errorSummary).toEqual([{ text: "The case could not be created. Check the details and try again." }]);
      expect(logged).toHaveBeenCalledWith(expect.stringContaining("deed-poll-api answered 400"));
      logged.mockRestore();
    });

    it("rethrows anything that is not a validation failure, so a real fault is not hidden", async () => {
      vi.mocked(createDeedPoll).mockRejectedValue(new Error("connect ECONNREFUSED"));

      await expect(POST(request(validBody), response())).rejects.toThrow("connect ECONNREFUSED");
    });

    it("links each error summary entry to its field", async () => {
      const res = response();

      await POST(request({ ...validBody, type: "NotAType" }), res);

      expect(res.render.mock.calls[0][1].errorSummary[0].href).toBe("#type");
    });

    it("treats an omitted optional field as absent rather than an empty string", async () => {
      vi.mocked(createDeedPoll).mockResolvedValue({ id: "case-1" } as never);

      await POST(request({ ...validBody, newForename: "" }), response());

      expect(vi.mocked(createDeedPoll).mock.calls[0][0].newForename).toBeUndefined();
    });

    // Review finding R15: the edit tabs trim, so the create had sent names the tabs would not.
    it("sends the names trimmed", async () => {
      vi.mocked(createDeedPoll).mockResolvedValue({ id: "case-1" } as never);

      await POST(request({ ...validBody, newForename: "  Applicant  ", newSurname: "\tLovelace " }), response());

      expect(vi.mocked(createDeedPoll).mock.calls[0][0]).toEqual(expect.objectContaining({ newForename: "Applicant", newSurname: "Lovelace" }));
    });

    it("treats a whitespace-only name as absent, the same as an empty one", async () => {
      vi.mocked(createDeedPoll).mockResolvedValue({ id: "case-1" } as never);

      await POST(request({ ...validBody, newForename: "   ", newSurname: " " }), response());

      const sent = vi.mocked(createDeedPoll).mock.calls[0][0];
      expect(sent.newForename).toBeUndefined();
      expect(sent.newSurname).toBeUndefined();
    });
  });
});
