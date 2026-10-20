import { enumOptions, type FieldDef, FORM_TABS, findDeedPoll, InvalidInputError, NotFoundError, updateDeedPoll } from "@hmcts/deed-poll";
import type { Request } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../../express-doubles.js";
import { GET, POST } from "./[tab].js";

// Only persistence is replaced. buildEditView, buildUpdatePatch and collectFormErrors are the
// domain's and tested there, so this runs the page against the real ones — which matters here more
// than anywhere, because the destructive case is a real patch built from a real field list.
vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPoll: vi.fn(),
  updateDeedPoll: vi.fn()
}));

const APPLICATION = FORM_TABS[0].id;
const SUBGRID = FORM_TABS.find((t) => t.subgrid)?.id ?? "notes";
const EMPTY_REFUND_DATE = { "dateOfRefund-day": "", "dateOfRefund-month": "", "dateOfRefund-year": "" };

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

function request(tab: string, body: Record<string, unknown> = {}, teamLeader = false): Request {
  return pageRequest({ params: { id: "case-1", tab }, body, teamLeader, name: "A Caseworker", accessToken: "caseworker-token" });
}

const response = pageResponse;

/** A body that fills every editable field on a tab, so a patch is not confused with a blanking. */
function bodyFor(tabId: string): Record<string, string> {
  const tab = FORM_TABS.find((t) => t.id === tabId);
  const body: Record<string, string> = {};
  for (const field of tab?.sections.flatMap((s) => s.fields) ?? []) {
    if (field.readOnly) continue;
    // A rendered date always submits its three parts, empty or not.
    if (field.kind === "date") {
      for (const part of ["day", "month", "year"]) body[`${field.name}-${part}`] = "";
      continue;
    }
    body[field.name] = valueFor(field);
  }
  return body;
}

/** What the rendered control sends: anything else is refused before any write (review finding R08). */
function valueFor(field: FieldDef): string {
  if (field.kind === "number") return "1";
  if (field.kind === "boolean") return "true";
  if (field.kind === "multiselect" && field.enumSet) return enumOptions(field.enumSet)[0].value;
  return "value";
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

    it("sends a bookmarked referral tab to the case's referrals panel, where its values now live", async () => {
      // `referrals-admin-4` decision 2 retires the "Referral to Master" form. The fallback above would answer
      // this URL with the Application tab — 46 editable fields under a heading nobody asked for — so the slug
      // is redirected to the panel that holds the values read-only, rather than 404'd: the record still exists.
      const res = response();

      await GET(request("referral"), res);

      expect(res.redirect).toHaveBeenCalledWith("/deed-polls/case-1#referrals");
      expect(res.render).not.toHaveBeenCalled();
    });

    it("does not read the case to answer that redirect, the destination being the same for every case", async () => {
      await GET(request("referral"), response());

      expect(findDeedPoll).not.toHaveBeenCalled();
    });

    it("pre-fills fields from the stored record", async () => {
      const res = response();

      await GET(request(APPLICATION), res);

      const field = res.render.mock.calls[0][1].sections
        .flatMap((s: { fields: { name: string; value: unknown }[] }) => s.fields)
        .find((f: { name: string }) => f.name === "newSurname");
      expect(field.value).toBe("Stored");
    });

    it.each([
      ["teamLeader", false],
      ["deliveryManager", false],
      ["legacyAdmin", false],
      ["caseworker", true],
      ["judge", true],
      ["none", true]
    ] as const)("decides the privacy lock for %s from the stored answer (locked %s)", async (persona, locked) => {
      const res = response();

      await GET(pageRequest({ params: { id: "case-1", tab: APPLICATION }, persona }), res);

      expect(privacyField(res).locked).toBe(locked);
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
      // tabFor falls back to the first tab, which has 46 editable fields, and buildUpdatePatch reads
      // an absent checkbox as unticked. Falling back on a write would untick every Application box
      // and declaration from a body that never mentioned them. This is the guard against that.
      await expect(POST(request("nonsense", {}), response())).rejects.toThrow(NotFoundError);

      expect(updateDeedPoll).not.toHaveBeenCalled();
    });

    it("refuses a post to the retired referral tab rather than writing its body onto the Application tab", async () => {
      // The other half of the retirement. GET redirects, but a form posted from a page loaded before the
      // retirement must not be accepted: falling back would untick every Application box, and nothing accepts
      // the retired fields any more — they are out of `FORM_TABS`, so out of `EDITABLE_FIELDS`.
      await expect(POST(request("referral", { masterName: "Master Smith" }), response())).rejects.toThrow(NotFoundError);

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

    it("shows this page's own copy when api's rejection names no field, and does not leak api's wording", async () => {
      // The template hides an empty summary, so a 400 with no field errors would re-render the tab looking
      // as though nothing had happened. It must not be api's message that fills it: that is developer-facing
      // text, which `.claude/rules/backend.md` keeps away from caseworkers — so it is logged instead.
      vi.mocked(updateDeedPoll).mockRejectedValue(new InvalidInputError("deed-poll-api answered 400"));
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      const res = response();

      await POST(request(APPLICATION, bodyFor(APPLICATION)), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][1].errorSummary).toEqual([{ text: "The case could not be saved. Check the details and try again.", href: undefined }]);
      expect(logged).toHaveBeenCalledWith(expect.stringContaining("deed-poll-api answered 400"));
      logged.mockRestore();
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

  describe("numeric input (review finding E04)", () => {
    it.each([
      ["refund", "refundAmount", "12x", "Refund amount must be a number"],
      ["refund", "refundAmount", "£25.00", "Refund amount must be a number"],
      ["refund", "refundAmount", "1e999", "Refund amount must be a number"],
      [APPLICATION, "ageOfMinor", "7.5", "Age of minor years must be a whole number"],
      [APPLICATION, "ageOfMinorMonths", "NaN", "Age of minor months must be a whole number"]
    ])("should re-render %s with a field error and write nothing when %s is %s", async (tabId, name, typed, message) => {
      const res = response();

      await POST(request(tabId, { ...bodyFor(tabId), [name]: typed }), res);

      expect(updateDeedPoll).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      const model = res.render.mock.calls[0][1];
      expect(model.errors).toEqual([{ field: name, message }]);
      expect(model.errorSummary).toEqual([{ text: message, href: `#${name}` }]);
      expect(renderedField(res, name).value).toBe(typed);
    });

    it("should show the raw invalid amount back rather than a formatted substitute", async () => {
      const res = response();

      await POST(request("refund", { refundAmount: "£25.00" }), res);

      expect(renderedField(res, "refundAmount").value).toBe("£25.00");
    });

    it("should report date and numeric errors together in one re-render, writing nothing", async () => {
      const res = response();

      await POST(request("refund", { refundAmount: "12x", "dateOfRefund-day": "31", "dateOfRefund-month": "2", "dateOfRefund-year": "2026" }), res);

      expect(updateDeedPoll).not.toHaveBeenCalled();
      expect(res.render.mock.calls[0][1].errors).toEqual([
        { field: "refundAmount", message: "Refund amount must be a number" },
        { field: "dateOfRefund", message: "Date of refund must be a real date" }
      ]);
    });

    it("should keep the other submitted values when a number is refused", async () => {
      const res = response();

      await POST(request(APPLICATION, { ...bodyFor(APPLICATION), newSurname: "Typed", ageOfMinor: "seven" }), res);

      expect(renderedField(res, "newSurname").value).toBe("Typed");
      expect(res.render.mock.calls[0][1].tab.id).toBe(APPLICATION);
    });

    it.each([
      ["a deliberate blank, which clears", "", null],
      ["zero", "0", 0],
      ["a decimal amount", "25.50", 25.5],
      ["a padded amount", " 10 ", 10]
    ])("should write the refund amount once for %s", async (_label, typed, expected) => {
      const res = response();

      await POST(request("refund", { refundAmount: typed, refundReference: "Ref-1", ...EMPTY_REFUND_DATE }), res);

      expect(updateDeedPoll).toHaveBeenCalledTimes(1);
      expect(updateDeedPoll).toHaveBeenCalledWith(
        "case-1",
        { refundAmount: expected, refundReference: "Ref-1", dateOfRefund: null },
        { accessToken: "caseworker-token" }
      );
      expect(res.redirect).toHaveBeenCalledWith("/deed-polls/case-1#refund");
    });

    it("should write valid integer ages, zero included, as numbers", async () => {
      await POST(request(APPLICATION, { ...bodyFor(APPLICATION), ageOfMinor: "12", ageOfMinorMonths: "0" }), response());

      expect(updateDeedPoll).toHaveBeenCalledTimes(1);
      const patch = vi.mocked(updateDeedPoll).mock.calls[0][1];
      expect(patch.ageOfMinor).toBe(12);
      expect(patch.ageOfMinorMonths).toBe(0);
    });

    it("should omit a numeric field the body does not carry rather than clearing it", async () => {
      const body = bodyFor(APPLICATION);
      delete body.ageOfMinorMonths;

      await POST(request(APPLICATION, body), response());

      expect(vi.mocked(updateDeedPoll).mock.calls[0][1]).not.toHaveProperty("ageOfMinorMonths");
    });
  });

  describe("witness shortfall banner", () => {
    it("warns on the signature tab when the case is short of witnesses", async () => {
      vi.mocked(findDeedPoll).mockResolvedValue({ ...found, witnesses: [{ id: "witness-1" }] } as never);
      const res = response();

      await GET(request("signature"), res);

      expect(res.render.mock.calls[0][1].witnessWarning).toContain("1 of 2 witnesses recorded");
    });

    it("warns on the enrolment tab when the case is short of witnesses", async () => {
      vi.mocked(findDeedPoll).mockResolvedValue({ ...found, witnesses: [{ id: "witness-1" }] } as never);
      const res = response();

      await GET(request("enrolment"), res);

      expect(res.render.mock.calls[0][1].witnessWarning).toContain("Add 1 more witness");
    });

    it("does not warn once the requirement is met, on either tab", async () => {
      vi.mocked(findDeedPoll).mockResolvedValue({ ...found, witnesses: [{ id: "witness-1" }, { id: "witness-2" }] } as never);

      for (const tab of ["signature", "enrolment"]) {
        const res = response();
        await GET(request(tab), res);
        expect(res.render.mock.calls[0][1].witnessWarning, tab).toBeNull();
      }
    });

    it("does not warn on the tabs that carry no enrolment date, however short the case is", async () => {
      // A banner shown on every tab is read on none, and on the Application tab it answers a question the
      // caseworker is not asking.
      for (const tab of [APPLICATION, "return", "refund"]) {
        const res = response();
        await GET(request(tab), res);
        expect(res.render.mock.calls[0][1].witnessWarning, tab).toBeNull();
      }
    });

    it("keeps the banner on a rejected save, where it explains the refusal the caseworker just met", async () => {
      vi.mocked(findDeedPoll).mockResolvedValue({ ...found, witnesses: [{ id: "witness-1" }] } as never);
      vi.mocked(updateDeedPoll).mockRejectedValue(
        new InvalidInputError("Case cannot be sent for enrolment", [
          { field: "dateEnroled", message: "A Deed Poll cannot be sent for enrolment until two witnesses have been recorded." }
        ])
      );
      const res = response();

      await POST(request("enrolment", bodyFor("enrolment")), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][1].witnessWarning).toContain("1 of 2 witnesses recorded");
    });

    /**
     * The reactive half, which this plan deliberately did not build — task 1 of
     * `docs/plans/07-witness-count-feedback.md` proved it already worked. These are its regression guard:
     * api's refusal is addressed to a date, and both dates are editable fields on their tabs, so the
     * message must render against the field with a summary link that resolves.
     */
    it.each([
      ["signature", "signatureReceivedDate"],
      ["enrolment", "dateEnroled"]
    ])("renders api's refusal against %s's own date field, with a summary link that resolves", async (tab, field) => {
      const message = "A Deed Poll cannot be sent for enrolment until two witnesses have been recorded. This case has one; please add one more witness.";
      vi.mocked(findDeedPoll).mockResolvedValue({ ...found, witnesses: [{ id: "witness-1" }] } as never);
      vi.mocked(updateDeedPoll).mockRejectedValue(new InvalidInputError("Case cannot be sent for enrolment", [{ field, message }]));
      const res = response();

      await POST(request(tab, bodyFor(tab)), res);

      expect(res.status).toHaveBeenCalledWith(400);
      // api's field error unchanged — not re-worded here, because the proactive banner is the only place
      // this app states the rule and two wordings of one refusal would drift apart.
      expect(res.render.mock.calls[0][1].errors).toEqual([{ field, message }]);
      // The link, which is the half that breaks silently: an unmappable field name renders the message
      // with `href: undefined` and no styling difference to give it away.
      expect(res.render.mock.calls[0][1].errorSummary).toEqual([{ text: message, href: `#${field}` }]);
    });

    it("explains an unrelated edit that api refuses, because the shortfall reaches a case that carries a date", async () => {
      // The case everyone forgets: nothing about this submission is an enrolment — it is a surname on the
      // Application tab — but the rule is checked against the merged record, so api refuses it and names
      // the date the case already carries. That field has no control here, so the summary link is dead and
      // the banner is the caseworker's only route to the witnesses.
      vi.mocked(findDeedPoll).mockResolvedValue({ ...found, witnesses: [{ id: "witness-1" }] } as never);
      vi.mocked(updateDeedPoll).mockRejectedValue(
        new InvalidInputError("Case cannot be sent for enrolment", [
          {
            field: "dateEnroled",
            message: "A Deed Poll cannot be sent for enrolment until two witnesses have been recorded. This case has one; please add one more witness."
          }
        ])
      );
      const res = response();

      await POST(request(APPLICATION, { ...bodyFor(APPLICATION), newSurname: "Amended" }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.render.mock.calls[0][1].errorSummary[0].href).toBeUndefined();
      expect(res.render.mock.calls[0][1].witnessWarning).toContain("1 of 2 witnesses recorded");
      // And the typed surname survives, since the caseworker's way out is to add a witness and come back.
      const field = res.render.mock.calls[0][1].sections
        .flatMap((s: { fields: { name: string; value: unknown }[] }) => s.fields)
        .find((f: { name: string }) => f.name === "newSurname");
      expect(field.value).toBe("Amended");
    });

    it("carries the banner's title and its link text, since a missing one is an untitled banner or an empty link", async () => {
      const res = response();

      await GET(request("signature"), res);

      const { en } = res.render.mock.calls[0][1];
      expect(en.bannerTitle).toBeTruthy();
      expect(en.witnessWarningLink).toBeTruthy();
    });
  });

  // `../../../../case-path.test.ts` holds the full payload matrix; this pins that both redirects use it.
  describe("a case id carrying URL delimiters", () => {
    const RAW_ID = "a/b?c#d";
    const CASE_PATH = "/deed-polls/a%2Fb%3Fc%23d";

    function delimited(tab: string, id = RAW_ID, body: Record<string, unknown> = {}): Request {
      return pageRequest({ params: { id, tab }, body, accessToken: "caseworker-token" });
    }

    it("should keep the id as one segment when sending a bookmarked referral tab to the referrals panel", async () => {
      const res = response();

      await GET(delimited("referral"), res);

      expect(res.redirect).toHaveBeenCalledWith(`${CASE_PATH}#referrals`);
    });

    it("should save under the raw id and redirect to the encoded case, anchored at the tab", async () => {
      const res = response();

      await POST(delimited(APPLICATION, RAW_ID, bodyFor(APPLICATION)), res);

      expect(updateDeedPoll).toHaveBeenCalledWith(RAW_ID, expect.anything(), { accessToken: "caseworker-token" });
      expect(res.redirect).toHaveBeenCalledWith(`${CASE_PATH}#${APPLICATION}`);
    });

    it.each(["", ".", ".."])("should 404 a legacy referral tab under %j without redirecting", async (id) => {
      const res = response();

      await expect(GET(delimited("referral", id), res)).rejects.toThrow(NotFoundError);

      expect(res.redirect).not.toHaveBeenCalled();
    });

    it.each(["", ".", ".."])("should 404 a save under %j before anything is written", async (id) => {
      const res = response();

      await expect(POST(delimited(APPLICATION, id, bodyFor(APPLICATION)), res)).rejects.toThrow(NotFoundError);

      expect(updateDeedPoll).not.toHaveBeenCalled();
      expect(res.redirect).not.toHaveBeenCalled();
    });
  });
});

function renderedField(res: { render: ReturnType<typeof vi.fn> }, name: string) {
  return res.render.mock.calls[0][1].sections
    .flatMap((s: { fields: { name: string; value: unknown }[] }) => s.fields)
    .find((f: { name: string }) => f.name === name);
}

function privacyField(res: { render: ReturnType<typeof vi.fn> }) {
  return res.render.mock.calls[0][1].sections
    .flatMap((s: { fields: { name: string; locked: boolean }[] }) => s.fields)
    .find((f: { name: string }) => f.name === "privacy");
}
