import { describe, expect, it } from "vitest";
import { buildEditView, buildErrorSummary, editableFieldNames, tabFor } from "./edit-view.js";
import { FORM_TABS } from "./form-fields.js";
import { readNumericInput } from "./numeric-input.js";

const ADMIN = { isAdmin: true };
const CASEWORKER = { isAdmin: false };

/** The Application tab, which carries `privacy` and `type` — the two fields with special rules. */
const applicationTab = FORM_TABS[0];

function fieldsOf(view: ReturnType<typeof buildEditView>) {
  return view.sections.flatMap((section) => section.fields);
}

function field(view: ReturnType<typeof buildEditView>, name: string) {
  return fieldsOf(view).find((f) => f.name === name);
}

describe("deed-poll/edit-view", () => {
  describe("tabFor", () => {
    it("resolves a known tab id", () => {
      expect(tabFor(FORM_TABS[1].id).id).toBe(FORM_TABS[1].id);
    });

    it("falls back to the first tab for an unrecognised id, since the id comes from a URL", () => {
      expect(tabFor("nonsense").id).toBe(FORM_TABS[0].id);
      expect(tabFor(undefined).id).toBe(FORM_TABS[0].id);
    });
  });

  describe("buildEditView", () => {
    it.each([1e-7, 1.5e-7, 1e21, -1.25e22, 25.5])("should render stored %s so the unchanged form resubmits as the same number", (stored) => {
      const refundTab = FORM_TABS.find((tab) => tab.sections.some((section) => section.fields.some((f) => f.name === "refundAmount")));
      if (!refundTab) throw new Error("no tab carries refundAmount");

      const rendered = field(buildEditView({ refundAmount: stored }, refundTab, ADMIN), "refundAmount")?.value;

      expect(readNumericInput(rendered, "decimal")).toEqual({ kind: "valid", value: stored });
    });

    it.each([1e-101, 1.2345678901234566e-90])("should never render stored %s as a different number an unchanged save would write", (stored) => {
      const refundTab = FORM_TABS.find((tab) => tab.sections.some((section) => section.fields.some((f) => f.name === "refundAmount")));
      if (!refundTab) throw new Error("no tab carries refundAmount");

      const rendered = field(buildEditView({ refundAmount: stored }, refundTab, ADMIN), "refundAmount")?.value;
      const reread = readNumericInput(rendered, "decimal");

      // Refusing an unchanged save is acceptable; silently saving an altered value is not.
      expect(reread.kind === "valid" ? reread.value : "refused").toEqual(reread.kind === "valid" ? stored : "refused");
    });

    it("decorates every field with a value taken from the record", () => {
      const view = buildEditView({ type: "Adult", newSurname: "Lovelace" }, applicationTab, ADMIN);

      expect(field(view, "newSurname")?.value).toBe("Lovelace");
    });

    it("uses null rather than undefined for an absent value, so the template has one empty case", () => {
      const view = buildEditView({}, applicationTab, ADMIN);

      for (const f of fieldsOf(view)) {
        expect(f.value).not.toBeUndefined();
      }
    });

    it("attaches enum options only to enum fields", () => {
      const view = buildEditView({ type: "Adult" }, applicationTab, ADMIN);

      for (const f of fieldsOf(view)) {
        if (f.enumSet) expect(f.options.length).toBeGreaterThan(0);
        else expect(f.options).toEqual([]);
      }
    });

    it("attaches date parts only to date fields", () => {
      const view = buildEditView({ type: "Adult" }, applicationTab, ADMIN);

      for (const f of fieldsOf(view)) {
        if (f.kind === "date") expect(f.dateParts).not.toBeNull();
        else expect(f.dateParts).toBeNull();
      }
    });

    it("splits a stored date into parts for pre-filling", () => {
      const tab = FORM_TABS.find((t) => t.sections.some((s) => s.fields.some((f) => f.kind === "date")));
      const dateField = tab?.sections.flatMap((s) => s.fields).find((f) => f.kind === "date");
      if (!tab || !dateField) throw new Error("expected at least one date field in FORM_TABS");

      const view = buildEditView({ [dateField.name]: "2026-03-01T00:00:00.000Z" }, tab, ADMIN);

      expect(field(view, dateField.name)?.dateParts).toEqual({ day: "1", month: "3", year: "2026" });
    });

    it("locks privacy for a non-admin on an existing record", () => {
      const view = buildEditView({ type: "Adult" }, applicationTab, CASEWORKER);

      expect(field(view, "privacy")?.locked).toBe(true);
    });

    it("does not lock privacy for an admin", () => {
      const view = buildEditView({ type: "Adult" }, applicationTab, ADMIN);

      expect(field(view, "privacy")?.locked).toBe(false);
    });

    it("locks nothing except privacy, which is the only role-gated field", () => {
      const view = buildEditView({ type: "Adult" }, applicationTab, CASEWORKER);

      for (const f of fieldsOf(view)) {
        if (f.name !== "privacy") expect(f.locked).toBe(false);
      }
    });

    it("carries the full tab list so the form can render its own navigation", () => {
      const view = buildEditView({}, applicationTab, ADMIN);

      expect(view.tabs.map((t) => t.id)).toEqual(FORM_TABS.map((t) => t.id));
    });

    describe("replaying a rejected submission", () => {
      it("shows what was submitted rather than what is stored", () => {
        // Showing stored values would discard the caseworker's work and leave them looking at an
        // error against a field that now appears fine.
        const view = buildEditView({ newSurname: "Stored" }, applicationTab, ADMIN, { newSurname: "Typed" });

        expect(field(view, "newSurname")?.value).toBe("Typed");
      });

      it("keeps the offending date parts verbatim, not normalised", () => {
        const tab = FORM_TABS.find((t) => t.sections.some((s) => s.fields.some((f) => f.kind === "date" && !f.readOnly)));
        const dateField = tab?.sections.flatMap((s) => s.fields).find((f) => f.kind === "date" && !f.readOnly);
        if (!tab || !dateField) throw new Error("expected an editable date field in FORM_TABS");

        const view = buildEditView({ [dateField.name]: "2026-03-01T00:00:00.000Z" }, tab, ADMIN, {
          [`${dateField.name}-day`]: "99",
          [`${dateField.name}-month`]: "13",
          [`${dateField.name}-year`]: "abcd"
        });

        expect(field(view, dateField.name)?.dateParts).toEqual({ day: "99", month: "13", year: "abcd" });
      });

      it("still reads read-only fields from the record, since the body cannot speak for them", () => {
        const tab = FORM_TABS.find((t) => t.sections.some((s) => s.fields.some((f) => f.readOnly)));
        const readOnly = tab?.sections.flatMap((s) => s.fields).find((f) => f.readOnly);
        if (!tab || !readOnly) throw new Error("expected a read-only field in FORM_TABS");

        const view = buildEditView({ [readOnly.name]: "Stored" }, tab, ADMIN, { [readOnly.name]: "Injected" });

        expect(field(view, readOnly.name)?.value).toBe("Stored");
      });

      it("should redraw a field submitted empty as blank rather than repopulating it from storage", () => {
        const view = buildEditView({ newSurname: "Stored" }, applicationTab, ADMIN, { newSurname: "" });

        expect(field(view, "newSurname")?.value).toBe("");
      });

      it("should redraw a field the body does not carry from the stored record, since it was never rendered", () => {
        // Its rule can change between render and redraw. Drawn empty, the corrected resubmit would clear it (R02).
        const view = buildEditView(
          { type: "Minor", parents: "Stored Parents", ageOfMinor: 9, minorDateOfBirth: "2017-01-01T00:00:00.000Z" },
          applicationTab,
          ADMIN,
          {
            newSurname: "Typed"
          }
        );

        expect(field(view, "parents")?.value).toBe("Stored Parents");
        expect(field(view, "ageOfMinor")?.value).toBe("9");
        expect(field(view, "minorDateOfBirth")?.dateParts).toEqual({ day: "1", month: "1", year: "2017" });
      });

      it("should redraw a locked privacy select from the stored record, since a disabled control is never submitted", () => {
        const view = buildEditView({ type: "Adult", privacy: "Private" }, applicationTab, CASEWORKER, { newSurname: "Typed" });

        expect(field(view, "privacy")?.locked).toBe(true);
        expect(field(view, "privacy")?.value).toBe("Private");
      });

      it("should still replay privacy for a caller who may edit it", () => {
        const view = buildEditView({ type: "Adult", privacy: "Private" }, applicationTab, ADMIN, { privacy: "Normal" });

        expect(field(view, "privacy")?.value).toBe("Normal");
      });
    });

    describe("checked state (review finding R01)", () => {
      const STORED = { type: "Minor", inPerson: true, retainPermanently: true, iShall: [1, 4], iHaveSubscribed: [1, 3], andAlsoMyOld: [1, 2] };

      function ticked(view: ReturnType<typeof buildEditView>, name: string): string[] {
        return (field(view, name)?.options ?? []).filter((option) => option.checked).map((option) => option.value);
      }

      it("should tick stored true booleans and stored multiselect numbers on a normal render", () => {
        const view = buildEditView(STORED, applicationTab, ADMIN);

        expect(field(view, "retainPermanently")?.checked).toBe(true);
        expect(ticked(view, "iShall")).toEqual(["1", "4"]);
        expect(ticked(view, "iHaveSubscribed")).toEqual(["1", "3"]);
        expect(ticked(view, "andAlsoMyOld")).toEqual(["1", "2"]);
      });

      it("should leave stored false booleans and empty multiselects unticked on a normal render", () => {
        const view = buildEditView({ type: "Minor", retainPermanently: false, iShall: [] }, applicationTab, ADMIN);

        expect(field(view, "retainPermanently")?.checked).toBe(false);
        expect(ticked(view, "iShall")).toEqual([]);
        expect(ticked(view, "andAlsoMyOld")).toEqual([]);
      });

      it.each(["true", "on"])("should tick a boolean replayed as %s", (submittedValue) => {
        const view = buildEditView({ type: "Minor" }, applicationTab, ADMIN, { retainPermanently: submittedValue });

        expect(field(view, "retainPermanently")?.checked).toBe(true);
      });

      it("should tick every replayed multiselect value when two or more were submitted", () => {
        const view = buildEditView({ type: "Minor" }, applicationTab, ADMIN, {
          iShall: ["1", "4"],
          iHaveSubscribed: ["1", "3"],
          andAlsoMyOld: ["1", "2"]
        });

        expect(ticked(view, "iShall")).toEqual(["1", "4"]);
        expect(ticked(view, "iHaveSubscribed")).toEqual(["1", "3"]);
        expect(ticked(view, "andAlsoMyOld")).toEqual(["1", "2"]);
      });

      it("should tick a single replayed multiselect value, which arrives as a string rather than an array", () => {
        const view = buildEditView({ type: "Minor" }, applicationTab, ADMIN, { iShall: "4" });

        expect(ticked(view, "iShall")).toEqual(["4"]);
      });

      it("should untick what the stored record held when the replayed body has no ticks, since an unticked box is absent", () => {
        const view = buildEditView(STORED, applicationTab, ADMIN, {});

        expect(field(view, "retainPermanently")?.checked).toBe(false);
        expect(ticked(view, "iShall")).toEqual([]);
      });
    });

    describe("a nullable boolean's answer (review finding R07)", () => {
      it.each([true, false, null])("should carry a stored %s as the answer, ticking no checkbox", (stored) => {
        const view = buildEditView({ type: "Minor", inPerson: stored }, applicationTab, ADMIN);

        expect(field(view, "inPerson")?.answer).toBe(stored);
        expect(field(view, "inPerson")?.checked).toBe(false);
      });

      it.each([
        ["true", true],
        ["false", false]
      ])("should carry a replayed %s as the answer over the stored one", (submitted, expected) => {
        const view = buildEditView({ type: "Minor", inPerson: !expected }, applicationTab, ADMIN, { inPerson: submitted });

        expect(field(view, "inPerson")?.answer).toBe(expected);
      });

      it("should keep the stored answer when the replayed body selected nothing, which only an unanswered question sends", () => {
        const view = buildEditView({ type: "Minor", inPerson: null }, applicationTab, ADMIN, {});

        expect(field(view, "inPerson")?.answer).toBeNull();
      });

      it("should give every other field no answer", () => {
        const view = buildEditView({ type: "Minor", retainPermanently: true }, applicationTab, ADMIN);

        expect(field(view, "retainPermanently")?.answer).toBeNull();
      });
    });
  });

  describe("buildErrorSummary", () => {
    it("links an entry whose field is on the submitted tab", () => {
      const onTab = [...editableFieldNames(applicationTab)][0];

      expect(buildErrorSummary([{ field: onTab, message: "Bad" }], applicationTab)).toEqual([{ text: "Bad", href: `#${onTab}` }]);
    });

    it("omits the link when the field is not on this tab, rather than emitting a dead anchor", () => {
      // The cross-field date rules can be addressed to a field on another tab -- the
      // Enroled+Returned rule targets `state`, on the Application tab. A dead #state link from the
      // Return tab is worse than no link: the message reads fine on its own.
      const summary = buildErrorSummary([{ field: "notOnThisTab", message: "Dates are inconsistent" }], applicationTab);

      expect(summary).toEqual([{ text: "Dates are inconsistent", href: undefined }]);
    });

    it("keeps the message text regardless of whether it links", () => {
      const summary = buildErrorSummary([{ field: "nope", message: "Still shown" }], applicationTab);

      expect(summary[0].text).toBe("Still shown");
    });

    it("returns an empty summary for no errors", () => {
      expect(buildErrorSummary([], applicationTab)).toEqual([]);
    });
  });

  describe("editableFieldNames", () => {
    it("excludes read-only fields, which an error summary must not link to", () => {
      for (const tab of FORM_TABS) {
        const names = editableFieldNames(tab);
        const readOnly = tab.sections.flatMap((s) => s.fields).filter((f) => f.readOnly);

        for (const f of readOnly) expect(names.has(f.name)).toBe(false);
      }
    });
  });
});
