/**
 * The catalogue/form split, which is the whole of this file's behaviour.
 *
 * `referrals-admin-4` decision 2 retires the "Referral to Master" tab from the case form and keeps its fields
 * readable, so there are two lists where there was one: `CASE_FIELD_TABS` is every case field the app knows
 * about, `FORM_TABS` is what a caseworker navigates and edits. Every derived catalogue picks one deliberately,
 * and picking the wrong one fails silently in production — a retired field back on the edit form, or a migrated
 * value that renders as a raw date and drops out of the query chooser. Hence the assertions here.
 */
import { describe, expect, it } from "vitest";
import { CASE_FIELD_TABS, EDITABLE_FIELDS, FIELD_BY_NAME, FORM_TABS, LEGACY_REFERRAL_TAB } from "./form-fields.js";

const LEGACY_FIELD_NAMES = LEGACY_REFERRAL_TAB.sections.flatMap((section) => section.fields).map((field) => field.name);

describe("deed-poll/form-fields", () => {
  describe("the retired referral tab", () => {
    it("should stay in the case-field catalogue, since a migrated case may hold a real record in it", () => {
      expect(CASE_FIELD_TABS).toContain(LEGACY_REFERRAL_TAB);
      expect(LEGACY_FIELD_NAMES).toContain("masterDirections");
    });

    it("should be absent from the tabs a caseworker navigates and edits, so nothing offers the old form", () => {
      // The one edit that retires the tab. `detail-view.ts` and `edit-view.ts` both iterate `FORM_TABS`, so this
      // is what removes it from the case detail page, the edit tab strip and `tabFor`.
      expect(FORM_TABS).not.toContain(LEGACY_REFERRAL_TAB);
      expect(FORM_TABS.map((tab) => tab.id)).not.toContain("referral");
    });

    it("should leave the live referrals subgrid as the only referral tab, the two ids being URL slugs", () => {
      const referralTabs = FORM_TABS.filter((tab) => tab.id.startsWith("referral"));

      expect(referralTabs.map((tab) => tab.id)).toEqual(["referrals"]);
      expect(referralTabs[0].subgrid).toBe("referrals");
    });

    it("should keep every other tab, in source order, so retiring one tab retires only that one", () => {
      expect(FORM_TABS.map((tab) => tab.id)).toEqual(CASE_FIELD_TABS.filter((tab) => tab !== LEGACY_REFERRAL_TAB).map((tab) => tab.id));
    });
  });

  describe("EDITABLE_FIELDS", () => {
    it("should exclude the retired referral fields, so no write reaches them through the generic case form", () => {
      // `buildUpdatePatch` writes what its tab's fields list holds; a field on no editable tab cannot be
      // patched however a body is composed.
      const editable = EDITABLE_FIELDS.map((field) => field.name);

      for (const name of LEGACY_FIELD_NAMES) expect(editable, name).not.toContain(name);
    });

    it("should still exclude the read-only fields and include an ordinary one, the derivation being otherwise unchanged", () => {
      const editable = EDITABLE_FIELDS.map((field) => field.name);

      expect(editable).not.toContain("referencenumber");
      expect(editable).toContain("newSurname");
    });
  });

  describe("FIELD_BY_NAME", () => {
    it("should resolve a retired referral field, so a populated value is formatted by its own label and kind", () => {
      // The formatting half of the split: `../referrals/legacy-referral-view.ts` renders the snapshot from these
      // defs, and the case detail page's `formatValue` needs the kind to turn a stored boolean into Yes/No.
      expect(FIELD_BY_NAME.masterName?.label).toBe("Master name");
      expect(FIELD_BY_NAME.masterDateOfDecision?.kind).toBe("date");
      expect(FIELD_BY_NAME.publishToLondonGazette?.kind).toBe("boolean");
    });

    it("should resolve every field of every catalogue tab, so no case value renders without its metadata", () => {
      const catalogue = CASE_FIELD_TABS.flatMap((tab) => tab.sections.flatMap((section) => section.fields));

      for (const field of catalogue) expect(FIELD_BY_NAME[field.name], field.name).toBe(field);
    });
  });
});
