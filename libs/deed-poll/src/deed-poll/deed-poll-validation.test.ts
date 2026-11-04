import { describe, expect, it } from "vitest";
import { applyCreateDefaults, getFieldRules, validate } from "./deed-poll-validation.js";
import { DeedPollType, MaritalStatus, ReferToMaster } from "./enums/option-sets.js";
import { EDITABLE_FIELDS } from "./form-fields.js";

describe("deed-poll-validation", () => {
  describe("getFieldRules — per-type required/visible matrix", () => {
    it("Adult requires inPerson/maritalStatus/urgency/nationality/section, hides minor fields", () => {
      const r = getFieldRules(DeedPollType.Adult);
      expect(r.inPerson.required).toBe(true);
      expect(r.maritalStatus.required).toBe(true);
      expect(r.urgency.required).toBe(true);
      expect(r.nationality.required).toBe(true);
      expect(r.nationalitySection.required).toBe(true);
      expect(r.ageOfMinor.visible).toBe(false);
      expect(r.ageOfMinor.required).toBe(false);
      expect(r.parents.visible).toBe(false);
    });

    it("Adult Transgender behaves like Adult", () => {
      const r = getFieldRules(DeedPollType.AdultTransgender);
      expect(r.maritalStatus.required).toBe(true);
      expect(r.ageOfMinor.visible).toBe(false);
    });

    it("Minor additionally requires age (years+months) and parents", () => {
      const r = getFieldRules(DeedPollType.Minor);
      expect(r.ageOfMinor.required).toBe(true);
      expect(r.ageOfMinorMonths.required).toBe(true);
      expect(r.parents.required).toBe(true);
      expect(r.maritalStatus.required).toBe(true);
      expect(r.ageOfMinor.visible).toBe(true);
    });

    it("Minor Transgender behaves like Minor", () => {
      const r = getFieldRules(DeedPollType.MinorTransgender);
      expect(r.parents.required).toBe(true);
    });

    it("Relinquishment requires only inPerson+urgency and hides old-name/marital/nationality/section/gazette", () => {
      const r = getFieldRules(DeedPollType.DeedOfRelinquishment);
      expect(r.inPerson.required).toBe(true);
      expect(r.urgency.required).toBe(true);
      expect(r.maritalStatus.required).toBe(false);
      expect(r.oldForename.visible).toBe(false);
      expect(r.oldMiddleName.visible).toBe(false);
      expect(r.oldSurname.visible).toBe(false);
      expect(r.maritalStatus.visible).toBe(false);
      expect(r.nationality.visible).toBe(false);
      expect(r.nationalitySection.visible).toBe(false);
      expect(r.dateNoticeSentToLondonGazette.visible).toBe(false);
    });

    it("Unknown / null impose nothing (all optional, all visible)", () => {
      for (const t of [DeedPollType.Unknown, null]) {
        const r = getFieldRules(t);
        expect(Object.values(r).every((x) => !x.required)).toBe(true);
        expect(Object.values(r).every((x) => x.visible)).toBe(true);
      }
    });
    // A hidden field is never rendered, so it is absent from the body. `buildUpdatePatch` omits an absent text,
    // enum or date, but reads an absent checkbox as unticked (an unticked one is never submitted either), so a rule
    // that hid a boolean or multiselect would clear its stored value on every save (review finding R02).
    it("should never hide a boolean or multiselect field, for any type, migrated or not, published or not", () => {
      const checkboxes = EDITABLE_FIELDS.filter((field) => field.kind === "boolean" || field.kind === "multiselect").map((field) => field.name);
      const hidden: string[] = [];

      for (const type of [...Object.values(DeedPollType), null]) {
        for (const migrated of [false, true]) {
          for (const publishToGazette of [false, true]) {
            const rules = getFieldRules(type, migrated, publishToGazette);
            for (const name of checkboxes) {
              if (rules[name]?.visible === false) hidden.push(`${name} (${type}, migrated ${migrated}, publish ${publishToGazette})`);
            }
          }
        }
      }

      expect(checkboxes.length).toBeGreaterThan(0);
      expect(hidden).toEqual([]);
    });
  });

  describe("applyCreateDefaults", () => {
    it("defaults minor marital status to Single when absent", () => {
      expect(applyCreateDefaults({ type: DeedPollType.Minor }).maritalStatus).toBe(MaritalStatus.Single);
    });

    it("does not override an explicit minor marital status", () => {
      const patch = applyCreateDefaults({
        type: DeedPollType.Minor,
        maritalStatus: MaritalStatus.Widowed
      });
      expect(patch.maritalStatus).toBeUndefined();
    });

    it("does not default marital status for adults", () => {
      expect(applyCreateDefaults({ type: DeedPollType.Adult }).maritalStatus).toBeUndefined();
    });

    it("relinquishment defaults refer-to-master Yes and publish-to-Gazette false", () => {
      const patch = applyCreateDefaults({
        type: DeedPollType.DeedOfRelinquishment
      });
      expect(patch.referToMasterChoice).toBe(ReferToMaster.Yes);
      expect(patch.publishToLondonGazette).toBe(false);
    });

    it("relinquishment does not override explicit refer-to-master", () => {
      const patch = applyCreateDefaults({
        type: DeedPollType.DeedOfRelinquishment,
        referToMasterChoice: ReferToMaster.No
      });
      expect(patch.referToMasterChoice).toBeUndefined();
    });
  });

  describe("validate — per-type required set", () => {
    it("flags every missing required field for an Adult", () => {
      const errs = validate({ type: DeedPollType.Adult });
      const fields = errs.map((e) => e.field);
      expect(fields).toEqual(expect.arrayContaining(["inPerson", "maritalStatus", "urgency", "nationality", "nationalitySection"]));
      // hidden minor fields are never demanded
      expect(fields).not.toContain("ageOfMinor");
      expect(fields).not.toContain("parents");
    });

    it("passes for a fully-populated Adult", () => {
      const errs = validate({
        type: DeedPollType.Adult,
        inPerson: true,
        maritalStatus: MaritalStatus.Single,
        urgency: "Normal",
        nationality: "BritishCitizen",
        nationalitySection: "Section1"
      });
      expect(errs).toEqual([]);
    });

    it("demands age + parents for a Minor", () => {
      const fields = validate({ type: DeedPollType.Minor }).map((e) => e.field);
      expect(fields).toEqual(expect.arrayContaining(["ageOfMinor", "ageOfMinorMonths", "parents"]));
    });

    it("imposes nothing type-driven when type is Unknown/null", () => {
      expect(validate({ type: DeedPollType.Unknown })).toEqual([]);
      expect(validate({})).toEqual([]);
    });
  });

  describe("validate — conditional gates", () => {
    it("requires urgencyreason when urgency = Urgent", () => {
      const errs = validate({ urgency: "Urgent" });
      expect(errs.map((e) => e.field)).toContain("urgencyreason");
    });

    it("accepts urgency = Urgent with a reason", () => {
      const errs = validate({
        urgency: "Urgent",
        urgencyreason: "Court deadline"
      });
      expect(errs.map((e) => e.field)).not.toContain("urgencyreason");
    });

    it("does not require the retired online reference when postcounter = Online", () => {
      const errs = validate({ postCounter: "Online" });
      expect(errs.map((e) => e.field)).not.toContain("onlineApplicationReference");
    });

    it("accepts Online with a reference present", () => {
      const errs = validate({
        postCounter: "Online",
        onlineApplicationReference: "ONL-123"
      });
      expect(errs.map((e) => e.field)).not.toContain("onlineApplicationReference");
    });
  });
});
