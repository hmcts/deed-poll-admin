/**
 * A case edit save must not clear fields the caseworker did not touch — review findings R01 and R02,
 * `docs/plans/completed/20261020-r01-r02-edit-form-untouched-fields.md` — and must refuse input the rendered form
 * could not have sent rather than coerce it — R07 and R08, `docs/plans/20261020-r07-r08-edit-form-input-shapes.md`.
 *
 * Same harness as `case-edit-numeric.test.ts`: real `express.urlencoded({ extended: true })`, the real edit
 * handler (GET and POST) and the real `deed-polls/edit.njk`, with `findDeedPoll` and `updateDeedPoll` mocked.
 * "A browser resubmits the page" is `serialise()`, which reads the rendered form the way a browser builds a
 * submission: enabled controls only, ticked checkboxes and selected radios only, each select's selected option. This proves the
 * outgoing patch, not a live save. The session carries no `/me` answer unless a test gives it one, so the
 * caller is not an admin and privacy renders locked.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findDeedPoll, InvalidInputError, NotFoundError, updateDeedPoll } from "@hmcts/deed-poll";
import express, { type NextFunction, type Request, type Response } from "express";
import nunjucks from "nunjucks";
import supertest from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./pages/deed-polls/[id]/edit/[tab].js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPoll: vi.fn(),
  updateDeedPoll: vi.fn()
}));

const CALLER = { accessToken: "session-token" };
const STARTER_VIEWS = path.join(fileURLToPath(import.meta.url), "../../libs/express-govuk-starter/src");
const environment = nunjucks.configure(
  [
    path.join(fileURLToPath(import.meta.resolve("govuk-frontend")), "..", ".."),
    path.join(STARTER_VIEWS, "govuk-frontend/views"),
    path.join(STARTER_VIEWS, "cookies/views"),
    path.join(fileURLToPath(import.meta.url), "..", "pages")
  ],
  { autoescape: true }
);

// A Minor case, so every Application field renders, with both Application booleans and three declarations set.
const STORED = {
  id: "case-1",
  displayReference: "KBDP2026-00001",
  type: "Minor",
  privacy: "Private",
  urgency: "Normal",
  state: "Received",
  migratedRecord: false,
  publishToLondonGazette: true,
  dateReceived: "2026-03-01T00:00:00.000Z",
  dateOfApplication: "2026-02-20T00:00:00.000Z",
  newForename: "Synthetic",
  newSurname: "Applicant",
  maritalStatus: "Single",
  ageOfMinor: 9,
  ageOfMinorMonths: 4,
  parents: "Synthetic Parents",
  inPerson: true,
  retainPermanently: true,
  iShall: [1, 4],
  iHaveSubscribed: [1, 3],
  andAlsoMyOld: [1, 2],
  notes: [],
  witnesses: [],
  documents: []
};

const TICKED = { inPerson: true, retainPermanently: true, iShall: [1, 4], iHaveSubscribed: [1, 3], andAlsoMyOld: [1, 2] };
const TEAM_LEADER = { staff: true, judicial: false, capabilities: ["OVERRIDE_PRIVACY"], name: "A Team Leader" };

let sessionUser: unknown;

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use((req: Request, res: Response, next: NextFunction) => {
  (req as unknown as { session: unknown }).session = { deedPoll: { ...CALLER, user: sessionUser } };
  // `renderInterceptorMiddleware`'s order: the content pair first, the handler's own values over it.
  res.render = ((view: string, model: Record<string, unknown>) => {
    res.send(environment.render(`${view}.njk`, { ...(model.en as object), ...model }));
  }) as Response["render"];
  next();
});
app.get("/deed-polls/:id/edit/:tab", GET);
app.post("/deed-polls/:id/edit/:tab", POST);
app.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof NotFoundError) {
    res.status(404).send("Page not found");
    return;
  }
  next(err);
});

describe("case edit saves leave untouched fields alone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionUser = undefined;
    vi.mocked(findDeedPoll).mockResolvedValue(STORED as never);
    vi.mocked(updateDeedPoll).mockResolvedValue(STORED as never);
  });

  describe("a refused save redraws what was submitted (R01)", () => {
    it("should keep every boolean and multiselect value through a date error and the corrected resubmit", async () => {
      // Arrange
      const shown = serialise((await supertest(app).get("/deed-polls/case-1/edit/application")).text);
      shown.set("dateOfApplication-year", "20x6");

      // Act
      const refused = await supertest(app).post("/deed-polls/case-1/edit/application").type("form").send(shown.toString());
      const corrected = serialise(refused.text);
      corrected.set("dateOfApplication-year", "2026");
      const saved = await supertest(app).post("/deed-polls/case-1/edit/application").type("form").send(corrected.toString());

      // Assert
      expect(refused.status).toBe(400);
      expect(saved.status).toBe(302);
      expect(updateDeedPoll).toHaveBeenCalledTimes(1);
      expect(vi.mocked(updateDeedPoll).mock.calls[0][1]).toMatchObject(TICKED);
    });

    it("should keep them through api's own 400 and the resubmit", async () => {
      // Arrange
      vi.mocked(updateDeedPoll).mockRejectedValueOnce(new InvalidInputError("refused", [{ field: "newSurname", message: "Enter a new surname" }]));
      const shown = serialise((await supertest(app).get("/deed-polls/case-1/edit/application")).text);

      // Act
      const refused = await supertest(app).post("/deed-polls/case-1/edit/application").type("form").send(shown.toString());
      const saved = await supertest(app).post("/deed-polls/case-1/edit/application").type("form").send(serialise(refused.text).toString());

      // Assert
      expect(refused.status).toBe(400);
      expect(saved.status).toBe(302);
      expect(updateDeedPoll).toHaveBeenCalledTimes(2);
      expect(vi.mocked(updateDeedPoll).mock.calls[1][1]).toMatchObject(TICKED);
    });

    it("should redraw a multiselect with one tick as submitted", async () => {
      // Arrange
      vi.mocked(findDeedPoll).mockResolvedValue({ ...STORED, iShall: [4] } as never);
      const shown = serialise((await supertest(app).get("/deed-polls/case-1/edit/application")).text);
      shown.set("dateOfApplication-year", "20x6");

      // Act
      const refused = await supertest(app).post("/deed-polls/case-1/edit/application").type("form").send(shown.toString());

      // Assert
      expect(serialise(refused.text).getAll("iShall")).toEqual(["4"]);
    });

    it("should redraw a box the caseworker unticked before the refused save as unticked", async () => {
      // Arrange
      const shown = serialise((await supertest(app).get("/deed-polls/case-1/edit/application")).text);
      shown.delete("iShall");
      shown.append("iShall", "4");
      shown.set("dateOfApplication-year", "20x6");

      // Act
      const refused = await supertest(app).post("/deed-polls/case-1/edit/application").type("form").send(shown.toString());

      // Assert
      expect(serialise(refused.text).getAll("iShall")).toEqual(["4"]);
    });

    it("should keep an admin's changed privacy through a date error and the corrected resubmit", async () => {
      // Arrange
      sessionUser = TEAM_LEADER;
      const shown = serialise((await supertest(app).get("/deed-polls/case-1/edit/application")).text);
      expect(shown.get("privacy")).toBe("Private");
      shown.set("privacy", "Normal");
      shown.set("dateOfApplication-year", "20x6");

      // Act
      const refused = await supertest(app).post("/deed-polls/case-1/edit/application").type("form").send(shown.toString());
      const corrected = serialise(refused.text);
      corrected.set("dateOfApplication-year", "2026");
      const saved = await supertest(app).post("/deed-polls/case-1/edit/application").type("form").send(corrected.toString());

      // Assert
      expect(selectedOption(refused.text, "privacy")).toBe("Normal");
      expect(saved.status).toBe(302);
      expect(vi.mocked(updateDeedPoll).mock.calls[0][1]).toMatchObject({ privacy: "Normal" });
    });

    it("should redraw a non-admin's locked privacy select with the stored value", async () => {
      // Arrange
      const shown = serialise((await supertest(app).get("/deed-polls/case-1/edit/application")).text);
      shown.set("dateOfApplication-year", "20x6");

      // Act
      const refused = await supertest(app).post("/deed-polls/case-1/edit/application").type("form").send(shown.toString());

      // Assert
      expect(selectedOption(refused.text, "privacy")).toBe("Private");
    });
  });

  describe("a save writes nothing for a field its rules hid (R02)", () => {
    const MINOR_ONLY = ["minorDateOfBirth", "ageOfMinor", "ageOfMinorMonths", "parents"];
    const RELINQUISHMENT_HIDDEN = [
      "oldForename",
      "oldMiddleName",
      "oldSurname",
      "maritalStatus",
      "nationality",
      "nationalitySection",
      "nationalitySectionOther"
    ];
    const STORED_HIDDEN = {
      oldForename: "Former",
      oldMiddleName: "Middle",
      oldSurname: "Name",
      maritalStatus: "Widowed",
      nationality: "BritishCitizen",
      nationalitySection: "Section1",
      nationalitySectionOther: "Other",
      minorDateOfBirth: "2017-01-01T00:00:00.000Z",
      dateNoticeSentToLondonGazette: "2026-03-10T00:00:00.000Z"
    };

    it.each([
      ["a Deed of Relinquishment", "DeedOfRelinquishment", [...RELINQUISHMENT_HIDDEN, ...MINOR_ONLY]],
      ["an Adult case", "Adult", MINOR_ONLY]
    ])("should send no key for a hidden Application field on an unchanged save of %s", async (_name, type, hidden) => {
      // Arrange
      vi.mocked(findDeedPoll).mockResolvedValue({ ...STORED, ...STORED_HIDDEN, type } as never);
      const shown = serialise((await supertest(app).get("/deed-polls/case-1/edit/application")).text);

      // Act
      const saved = await supertest(app).post("/deed-polls/case-1/edit/application").type("form").send(shown.toString());

      // Assert
      expect(saved.status).toBe(302);
      const patch = vi.mocked(updateDeedPoll).mock.calls[0][1] as Record<string, unknown>;
      expect(hidden.filter((name) => name in patch)).toEqual([]);
      expect(patch).toMatchObject({ newForename: "Synthetic", inPerson: true, iShall: [1, 4] });
    });

    it("should send no Gazette notice date on an unchanged Enrolment save when the case is not published", async () => {
      // Arrange
      vi.mocked(findDeedPoll).mockResolvedValue({ ...STORED, ...STORED_HIDDEN, publishToLondonGazette: false } as never);
      const shown = serialise((await supertest(app).get("/deed-polls/case-1/edit/enrolment")).text);

      // Act
      const saved = await supertest(app).post("/deed-polls/case-1/edit/enrolment").type("form").send(shown.toString());

      // Assert
      expect(saved.status).toBe(302);
      expect(vi.mocked(updateDeedPoll).mock.calls[0][1]).not.toHaveProperty("dateNoticeSentToLondonGazette");
    });

    it("should still send a shown field the caseworker cleared", async () => {
      // Arrange
      vi.mocked(findDeedPoll).mockResolvedValue({ ...STORED, ...STORED_HIDDEN, type: "Adult" } as never);
      const shown = serialise((await supertest(app).get("/deed-polls/case-1/edit/application")).text);
      shown.set("oldForename", "");

      // Act
      await supertest(app).post("/deed-polls/case-1/edit/application").type("form").send(shown.toString());

      // Assert
      expect(vi.mocked(updateDeedPoll).mock.calls[0][1]).toMatchObject({ oldForename: null, maritalStatus: "Widowed" });
    });
  });
  describe("an unanswered In person survives a save (R07)", () => {
    it("should send no inPerson key when only the fee reference changed on a case with no answer", async () => {
      // Arrange
      vi.mocked(findDeedPoll).mockResolvedValue({ ...STORED, inPerson: null } as never);
      const shown = serialise((await supertest(app).get("/deed-polls/case-1/edit/application")).text);
      shown.set("feeReference", "FEE-123");

      // Act
      const saved = await supertest(app).post("/deed-polls/case-1/edit/application").type("form").send(shown.toString());

      // Assert
      expect(saved.status).toBe(302);
      const patch = vi.mocked(updateDeedPoll).mock.calls[0][1] as Record<string, unknown>;
      expect(patch).toMatchObject({ feeReference: "FEE-123", retainPermanently: true });
      expect(patch).not.toHaveProperty("inPerson");
    });

    it.each([
      ["true", true],
      ["false", false]
    ])("should send the chosen answer when the caseworker picks %s", async (choice, expected) => {
      // Arrange
      vi.mocked(findDeedPoll).mockResolvedValue({ ...STORED, inPerson: null } as never);
      const shown = serialise((await supertest(app).get("/deed-polls/case-1/edit/application")).text);
      shown.set("inPerson", choice);

      // Act
      await supertest(app).post("/deed-polls/case-1/edit/application").type("form").send(shown.toString());

      // Assert
      expect(vi.mocked(updateDeedPoll).mock.calls[0][1]).toMatchObject({ inPerson: expected });
    });

    it.each([
      [true, "true"],
      [false, "false"],
      [null, null]
    ])("should render a stored %s with its radio selected", async (stored, selected) => {
      // Arrange
      vi.mocked(findDeedPoll).mockResolvedValue({ ...STORED, inPerson: stored } as never);

      // Act
      const shown = await supertest(app).get("/deed-polls/case-1/edit/application");

      // Assert
      expect(radioValues(shown.text, "inPerson")).toEqual(["true", "false"]);
      expect(serialise(shown.text).get("inPerson")).toBe(selected);
    });

    it.each([
      ["a submitted Yes", true, "true"],
      ["a submitted No", true, "false"],
      ["no choice", null, null]
    ])("should redraw %s after a refused save", async (_name, stored, submitted) => {
      // Arrange
      vi.mocked(findDeedPoll).mockResolvedValue({ ...STORED, inPerson: stored } as never);
      const shown = serialise((await supertest(app).get("/deed-polls/case-1/edit/application")).text);
      if (submitted === null) shown.delete("inPerson");
      else shown.set("inPerson", submitted);
      shown.set("dateOfApplication-year", "20x6");

      // Act
      const refused = await supertest(app).post("/deed-polls/case-1/edit/application").type("form").send(shown.toString());

      // Assert
      expect(refused.status).toBe(400);
      expect(serialise(refused.text).get("inPerson")).toBe(submitted);
    });
  });
});

describe("a save refuses input the rendered form could not have sent (R08)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionUser = undefined;
    vi.mocked(findDeedPoll).mockResolvedValue(STORED as never);
    vi.mocked(updateDeedPoll).mockResolvedValue(STORED as never);
  });

  it.each([
    ["a repeated text field", "newForename", ["newForename=Ada", "newForename=Eve"], "Enter a single value for New forename"],
    ["a bracketed text field", "newForename", ["newForename%5Bfirst%5D=Ada"], "Enter a single value for New forename"],
    ["a repeated select", "maritalStatus", ["maritalStatus=Single", "maritalStatus=Married"], "Enter a single value for Marital status"],
    ["a bracketed date part", "dateOfApplication-day", ["dateOfApplication-day%5Bx%5D=1"], "Enter a single value for Date of application"],
    ["a checkbox of TRUE", "retainPermanently", ["retainPermanently=TRUE"], "Select a valid answer for Retain permanently"],
    ["a repeated checkbox", "retainPermanently", ["retainPermanently=true", "retainPermanently=true"], "Select a valid answer for Retain permanently"],
    ["a Yes / No answer of yes", "inPerson", ["inPerson=yes"], "Select a valid answer for In person"],
    ...["1e0", "0x2", "%203%20", "", "2.5", "abc", "99"].map(
      (member) =>
        [
          `a multiselect member of "${decodeURIComponent(member)}"`,
          "iShall",
          ["iShall=1", `iShall=${member}`],
          "Select only options from the list for I shall"
        ] as const
    )
  ])("should refuse %s with a field error and no write", async (_name, control, replacement, message) => {
    // Arrange
    const shown = serialise((await supertest(app).get("/deed-polls/case-1/edit/application")).text);
    shown.delete(control);
    const body = [shown.toString(), ...replacement].join("&");

    // Act
    const refused = await supertest(app).post("/deed-polls/case-1/edit/application").type("form").send(body);

    // Assert
    expect(refused.status).toBe(400);
    expect(updateDeedPoll).not.toHaveBeenCalled();
    const field = control.replace(/-day$/, "");
    expect(refused.text).toContain(`<a href="#${field}">${message}</a>`);
    expect(refused.text).toMatch(
      new RegExp(`id="${field}-error" class="govuk-error-message">\\s*<span class="govuk-visually-hidden">Error:</span> ${message}`)
    );
  });

  it("should redraw a refused field from the stored record, so the corrected resubmit leaves it as it was", async () => {
    // Arrange
    const shown = serialise((await supertest(app).get("/deed-polls/case-1/edit/application")).text);
    shown.delete("iShall");
    const body = [shown.toString(), "iShall=1e0", "iShall=0x2"].join("&");

    // Act
    const refused = await supertest(app).post("/deed-polls/case-1/edit/application").type("form").send(body);
    const saved = await supertest(app).post("/deed-polls/case-1/edit/application").type("form").send(serialise(refused.text).toString());

    // Assert
    expect(saved.status).toBe(302);
    expect(vi.mocked(updateDeedPoll).mock.calls[0][1]).toMatchObject(TICKED);
  });

  it("should still clear a multiselect with nothing ticked", async () => {
    // Arrange
    const shown = serialise((await supertest(app).get("/deed-polls/case-1/edit/application")).text);
    shown.delete("iShall");

    // Act
    const saved = await supertest(app).post("/deed-polls/case-1/edit/application").type("form").send(shown.toString());

    // Assert
    expect(saved.status).toBe(302);
    expect(vi.mocked(updateDeedPoll).mock.calls[0][1]).toMatchObject({ iShall: [], iHaveSubscribed: [1, 3] });
  });
});

function radioValues(html: string, name: string): string[] {
  return [...html.matchAll(/<input\b([^>]*)>/g)]
    .map((input) => attributes(input[1]))
    .filter((attrs) => attrs.type === "radio" && attrs.name === name)
    .map((attrs) => attrs.value);
}

function serialise(html: string): URLSearchParams {
  const start = html.indexOf('<form method="post"');
  const form = html.slice(start, html.indexOf("</form>", start));
  const body = new URLSearchParams();
  const controls = /<input\b([^>]*)>|<select\b([^>]*)>([\s\S]*?)<\/select>|<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/g;
  for (const [, inputAttrs, selectAttrs, options, textareaAttrs, text] of form.matchAll(controls)) {
    const attrs = attributes(inputAttrs ?? selectAttrs ?? textareaAttrs ?? "");
    if (!attrs.name || "disabled" in attrs) continue;
    if (inputAttrs !== undefined) {
      if ((attrs.type === "checkbox" || attrs.type === "radio") && !("checked" in attrs)) continue;
      body.append(attrs.name, attrs.value ?? "");
    } else if (selectAttrs !== undefined) {
      body.append(attrs.name, chosenOption(options ?? "") ?? "");
    } else {
      body.append(attrs.name, decodeEntities((text ?? "").replace(/^\n/, "")));
    }
  }
  return body;
}

function attributes(source: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const [, name, value] of source.matchAll(/([a-zA-Z-]+)(?:="([^"]*)")?/g)) found[name] = decodeEntities(value ?? "");
  return found;
}

function decodeEntities(text: string): string {
  return text.replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

/** The selected option's value, or the first option's, which is what a browser submits and shows. */
function chosenOption(options: string): string | undefined {
  const all = [...options.matchAll(/<option\b([^>]*)>/g)].map((option) => attributes(option[1]));
  return (all.find((option) => "selected" in option) ?? all[0])?.value;
}

function selectedOption(html: string, name: string): string | undefined {
  const select = new RegExp(`<select\\b[^>]*name="${name}"[^>]*>([\\s\\S]*?)</select>`).exec(html);
  return chosenOption(select?.[1] ?? "");
}
