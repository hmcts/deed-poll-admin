import { FORM_TABS, findDeedPoll, InvalidInputError, NotFoundError, updateDeedPoll } from "@hmcts/deed-poll";
import type { Request } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../../express-doubles.js";
import { GET, POST } from "./[tab].js";

// Only persistence is replaced. buildEditView, buildUpdatePatch and collectDateErrors are the
// domain's and tested there, so this runs the page against the real ones — which matters here more
// than anywhere, because the destructive case is a real patch built from a real field list.
vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPoll: vi.fn(),
  updateDeedPoll: vi.fn()
}));

const APPLICATION = FORM_TABS[0].id;
const SUBGRID = FORM_TABS.find((t) => t.subgrid)?.id ?? "notes";

const found = {
  id: "case-1",
  displayReference: "KBDP2026-00001",
  type: "Adult",
  privacy: "Normal",
  state: "Received",
  migratedRecord: false,
  publishToLondonGazette: true,
  newSurname: "Stored",
  notes: [],
  witnesses: [],
  documents: []
};

function request(tab: string, body: Record<string, unknown> = {}, admin = false): Request {
  return pageRequest({ params: { id: "case-1", tab }, body, admin, name: "A Caseworker", accessToken: "caseworker-token" });
}

const response = pageResponse;

/** A body that fills every editable field on a tab, so a patch is not confused with a blanking. */
function bodyFor(tabId: string): Record<string, string> {
  const tab = FORM_TABS.find((t) => t.id === tabId);
  const body: Record<string, string> = {};
  for (const field of tab?.sections.flatMap((s) => s.fields) ?? []) {
    if (field.readOnly || field.kind === "date") continue;
    body[field.name] = field.kind === "number" ? "1" : "value";
  }
  return body;
}

describe("case edit tab page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "test";
    vi.mocked(findDeedPoll).mockResolvedValue(found as never);
    vi.mocked(updateDeedPoll).mockResolvedValue(found as never);
  });

  describe("GET", () => {
    it("renders its own template, qualified by directory", async () => {
      const res = response();

      await GET(request(APPLICATION), res);

      expect(res.render.mock.calls[0][0]).toBe("deed-polls/edit");
    });

    it("renders the requested tab with its sections", async () => {
      const res = response();

      await GET(request(APPLICATION), res);

      const model = res.render.mock.calls[0][1];
      expect(model.tab.id).toBe(APPLICATION);
      expect(model.sections.length).toBeGreaterThan(0);
    });

    it("falls back to the first tab for an unrecognised id, since a URL may be stale", async () => {
      const res = response();

      await GET(request("nonsense"), res);

      expect(res.render.mock.calls[0][1].tab.id).toBe(FORM_TABS[0].id);
    });

    it("pre-fills fields from the stored record", async () => {
      const res = response();

      await GET(request(APPLICATION), res);

      const field = res.render.mock.calls[0][1].sections
        .flatMap((s: { fields: { name: string; value: unknown }[] }) => s.fields)
        .find((f: { name: string }) => f.name === "newSurname");
      expect(field.value).toBe("Stored");
    });

    it("locks privacy for a non-admin and unlocks it for an admin", async () => {
      const asCaseworker = response();
      await GET(request(APPLICATION), asCaseworker);
      const asAdmin = response();
      await GET(request(APPLICATION, {}, true), asAdmin);

      expect(privacyField(asCaseworker).locked).toBe(true);
      expect(privacyField(asAdmin).locked).toBe(false);
    });

    it("renders no errors on a fresh load", async () => {
      const res = response();

      await GET(request(APPLICATION), res);

      expect(res.render.mock.calls[0][1].errors).toEqual([]);
      expect(res.render.mock.calls[0][1].errorSummary).toEqual([]);
    });

    it("lets a NotFoundError propagate for a missing case", async () => {
      vi.mocked(findDeedPoll).mockRejectedValue(new NotFoundError("DeedPoll nope not found"));

      await expect(GET(request(APPLICATION), response())).rejects.toThrow(NotFoundError);
    });
  });

  describe("POST", () => {
    it("saves the tab and redirects to the detail page anchored at it", async () => {
      const res = response();

      await POST(request(APPLICATION, bodyFor(APPLICATION)), res);

      expect(updateDeedPoll).toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith(`/deed-polls/case-1#${APPLICATION}`);
    });

    it("404s an unrecognised tab rather than falling back, which would blank the Application tab", async () => {
      // tabFor falls back to the first tab, which has 46 editable fields, and buildUpdatePatch
      // writes every field it is given — blanking absent ones. Falling back on a write would null
      // all 46 from a body that never mentioned them. This is the guard against that.
      await expect(POST(request("nonsense", {}), response())).rejects.toThrow(NotFoundError);

      expect(updateDeedPoll).not.toHaveBeenCalled();
    });

    it("patches only the submitted tab's fields, so another tab's data is untouched", async () => {
      await POST(request("refund", bodyFor("refund")), response());

      const patch = vi.mocked(updateDeedPoll).mock.calls[0][1];
      const refundFields = FORM_TABS.find((t) => t.id === "refund")?.sections.flatMap((s) => s.fields.filter((f) => !f.readOnly).map((f) => f.name));
      expect(Object.keys(patch).sort()).toEqual([...(refundFields ?? [])].sort());
    });

    it("passes the caller's own token, since api derives the author and the privacy entitlement from it", async () => {
      await POST(request(APPLICATION, bodyFor(APPLICATION), true), response());

      expect(updateDeedPoll).toHaveBeenCalledWith("case-1", expect.anything(), { accessToken: "caseworker-token" });
    });

    it("re-renders with a 400 when a date part is not a real date, before reaching the domain", async () => {
      const res = response();
      const dateField = FORM_TABS.flatMap((t) => t.sections.flatMap((s) => s.fields)).find((f) => f.kind === "date" && !f.readOnly);
      const tab = FORM_TABS.find((t) => t.sections.some((s) => s.fields.some((f) => f.name === dateField?.name)));
      if (!dateField || !tab) throw new Error("expected an editable date field");

      await POST(request(tab.id, { [`${dateField.name}-day`]: "99", [`${dateField.name}-month`]: "13", [`${dateField.name}-year`]: "abcd" }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(updateDeedPoll).not.toHaveBeenCalled();
    });

    it("shows the rejected date parts back, not the stored date", async () => {
      const res = response();
      const dateField = FORM_TABS.flatMap((t) => t.sections.flatMap((s) => s.fields)).find((f) => f.kind === "date" && !f.readOnly);
      const tab = FORM_TABS.find((t) => t.sections.some((s) => s.fields.some((f) => f.name === dateField?.name)));
      if (!dateField || !tab) throw new Error("expected an editable date field");

      await POST(request(tab.id, { [`${dateField.name}-day`]: "99", [`${dateField.name}-month`]: "13", [`${dateField.name}-year`]: "abcd" }), res);

      const rendered = res.render.mock.calls[0][1].sections
        .flatMap((s: { fields: { name: string; dateParts: unknown }[] }) => s.fields)
        .find((f: { name: string }) => f.name === dateField.name);
      expect(rendered.dateParts).toEqual({ day: "99", month: "13", year: "abcd" });
    });

    it("turns a cross-field rule failure into form errors rather than a JSON 400", async () => {
      vi.mocked(updateDeedPoll).mockRejectedValue(
        new InvalidInputError("Case dates are inconsistent", [{ field: "dateEnroled", message: "Cannot be before received" }])
      );
      const res = response();

      await POST(request(APPLICATION, bodyFor(APPLICATION)), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][1].errors).toEqual([{ field: "dateEnroled", message: "Cannot be before received" }]);
    });

    it("keeps the submitted values on a rejected save, not the stored ones", async () => {
      vi.mocked(updateDeedPoll).mockRejectedValue(new InvalidInputError("Nope", [{ field: "newSurname", message: "Bad" }]));
      const res = response();

      await POST(request(APPLICATION, { ...bodyFor(APPLICATION), newSurname: "Typed" }), res);

      const field = res.render.mock.calls[0][1].sections
        .flatMap((s: { fields: { name: string; value: unknown }[] }) => s.fields)
        .find((f: { name: string }) => f.name === "newSurname");
      expect(field.value).toBe("Typed");
    });

    it("rethrows anything that is not a validation failure, so a real fault is not hidden", async () => {
      vi.mocked(updateDeedPoll).mockRejectedValue(new Error("connect ECONNREFUSED"));

      await expect(POST(request(APPLICATION, bodyFor(APPLICATION)), response())).rejects.toThrow("connect ECONNREFUSED");
    });

    it("is a no-op patch for a subgrid tab, which has no fields of its own", async () => {
      await POST(request(SUBGRID, {}), response());

      expect(vi.mocked(updateDeedPoll).mock.calls[0][1]).toEqual({});
    });
  });
});

function privacyField(res: { render: ReturnType<typeof vi.fn> }) {
  return res.render.mock.calls[0][1].sections
    .flatMap((s: { fields: { name: string; locked: boolean }[] }) => s.fields)
    .find((f: { name: string }) => f.name === "privacy");
}
