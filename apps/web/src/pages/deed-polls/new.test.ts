import { createDeedPoll, InvalidInputError } from "@hmcts/deed-poll";
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

    it("shows api's message when its rejection names no field, rather than an empty error summary", async () => {
      // api omits `errors` when it has none, and an unparseable failure body — a proxy's HTML 400 — leaves
      // none either. The template hides an empty summary, so without this the caseworker gets a 400 and no
      // indication of what failed.
      vi.mocked(createDeedPoll).mockRejectedValue(new InvalidInputError("deed-poll-api answered 400"));
      const res = response();

      await POST(request(validBody), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][1].errorSummary).toEqual([{ text: "deed-poll-api answered 400" }]);
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
  });
});
