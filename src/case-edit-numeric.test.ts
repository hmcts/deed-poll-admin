/**
 * Numeric case-form input over HTTP, from URL-encoded body to the patch `updateDeedPoll` would send — review
 * finding E04, `docs/plans/20261020-e04-numeric-input-validation.md`, Task 3.
 *
 * The page test beside the handler hands it a ready-made `req.body`. This file sends real form posts through
 * `express.urlencoded({ extended: true })`, the parser `app.ts` mounts, so the shapes only a parser produces —
 * a repeated name as an array, a bracketed name as an object — reach the handler as they would in production,
 * and renders the real `deed-polls/edit.njk` so the preserved text and the error summary are what a browser gets.
 * Browser controls are not relied on: these bodies are what any client can post.
 *
 * Domain persistence is mocked (`findDeedPoll`, `updateDeedPoll`), so this proves the payload that would be
 * sent, not a persisted update. There is no session store, authentication or CSRF gate: those are `app.ts`'s.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findDeedPoll, NotFoundError, updateDeedPoll } from "@hmcts/deed-poll";
import express, { type NextFunction, type Request, type Response } from "express";
import nunjucks from "nunjucks";
import supertest from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./pages/deed-polls/[id]/edit/[tab].js";

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

// A Minor case, because the two age fields render only for Type = Minor or Minor Transgender.
const found = {
  id: "case-1",
  displayReference: "KBDP2026-00001",
  type: "Minor",
  privacy: "Normal",
  state: "Received",
  migratedRecord: false,
  ageOfMinor: 9,
  ageOfMinorMonths: 4,
  refundAmount: 42.5,
  refundReference: "Stored reference",
  notes: [],
  witnesses: [],
  documents: []
};

/** The refund tab's three controls, filled with valid values; a test overrides the one it is about. */
const REFUND = {
  refundAmount: "25.50",
  "dateOfRefund-day": "3",
  "dateOfRefund-month": "4",
  "dateOfRefund-year": "2026",
  refundReference: "REF-1"
};

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use((req: Request, res: Response, next: NextFunction) => {
  (req as unknown as { session: unknown }).session = { deedPoll: CALLER };
  // `renderInterceptorMiddleware`'s order: the content pair first, the handler's own values over it.
  res.render = ((view: string, model: Record<string, unknown>) => {
    res.send(environment.render(`${view}.njk`, { ...(model.en as object), ...model }));
  }) as Response["render"];
  next();
});
app.post("/deed-polls/:id/edit/:tab", POST);
app.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof NotFoundError) {
    res.status(404).send("Page not found");
    return;
  }
  next(err);
});

describe("numeric case-form input over HTTP", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findDeedPoll).mockResolvedValue(found as never);
    vi.mocked(updateDeedPoll).mockResolvedValue(found as never);
  });

  describe("an invalid number", () => {
    it.each([
      ["a typo", "refund", "refundAmount", "12x", "Refund amount must be a number"],
      ["a currency symbol", "refund", "refundAmount", "£25.00", "Refund amount must be a number"],
      ["a thousands separator", "refund", "refundAmount", "1,000", "Refund amount must be a number"],
      ["an overflow", "refund", "refundAmount", "1e999", "Refund amount must be a number"],
      ["a decimal with an exponent", "refund", "refundAmount", "2.5e1", "Refund amount must be a number"],
      ["a hex prefix", "refund", "refundAmount", "0x10", "Refund amount must be a number"],
      ["NaN", "refund", "refundAmount", "NaN", "Refund amount must be a number"],
      ["Infinity", "refund", "refundAmount", "Infinity", "Refund amount must be a number"],
      ["a fractional age", "application", "ageOfMinor", "7.5", "Age of minor years must be a whole number"],
      ["an age beyond int32", "application", "ageOfMinor", "2147483648", "Age of minor years must be a whole number"],
      ["a binary-prefixed age", "application", "ageOfMinorMonths", "0b11", "Age of minor months must be a whole number"]
    ])("should refuse %s with a field error, keep the text and write nothing", async (_name, tab, field, typed, message) => {
      const body = tab === "refund" ? { ...REFUND, [field]: typed } : { newSurname: "Typed", [field]: typed };

      const answer = await supertest(app).post(`/deed-polls/case-1/edit/${tab}`).type("form").send(body);

      expect(answer.status).toBe(400);
      expect(updateDeedPoll).not.toHaveBeenCalled();
      expect(answer.text).toContain(`href="#${field}"`);
      expect(answer.text).toContain(message);
      expect(answer.text).toContain(`value="${escapeHtml(typed)}"`);
    });

    it.each([
      ["repeated", "refundAmount=1&refundAmount=2"],
      ["bracketed into an object", "refundAmount%5Ba%5D=1"],
      ["bracketed into an array", "refundAmount%5B%5D=1"]
    ])("should refuse a refund amount %s by the parser rather than write its first element", async (_name, encoded) => {
      const answer = await supertest(app).post("/deed-polls/case-1/edit/refund").type("form").send(`${encoded}&refundReference=REF-1`);

      expect(answer.status).toBe(400);
      expect(updateDeedPoll).not.toHaveBeenCalled();
      expect(answer.text).toContain('href="#refundAmount"');
      expect(answer.text).toContain("Refund amount must be a number");
    });

    it("should report a bad date and a bad number together, keeping both texts and every other value", async () => {
      const answer = await supertest(app)
        .post("/deed-polls/case-1/edit/refund")
        .type("form")
        .send({ ...REFUND, refundAmount: "£25.00", "dateOfRefund-day": "99", "dateOfRefund-year": "abcd" });

      expect(answer.status).toBe(400);
      expect(updateDeedPoll).not.toHaveBeenCalled();
      expect(answer.text).toContain('href="#refundAmount"');
      expect(answer.text).toContain('href="#dateOfRefund"');
      expect(answer.text).toContain('value="£25.00"');
      expect(answer.text).toContain('value="abcd"');
      expect(answer.text).toContain('value="REF-1"');
    });
  });

  describe("a valid or blank number", () => {
    it.each([
      ["a decimal amount", "25.50", 25.5],
      ["zero", "0", 0],
      ["a signed amount, the contract setting no minimum", "-3", -3],
      ["a leading-dot amount", ".5", 0.5],
      ["surrounding whitespace", "  12  ", 12],
      ["a blank, which clears", "", null],
      ["whitespace only, which clears", "   ", null]
    ])("should save %s as exactly %s and redirect to the tab", async (_name, typed, expected) => {
      const answer = await supertest(app)
        .post("/deed-polls/case-1/edit/refund")
        .type("form")
        .send({ ...REFUND, refundAmount: typed });

      expect(answer.status).toBe(302);
      expect(answer.headers.location).toBe("/deed-polls/case-1#refund");
      expect(updateDeedPoll).toHaveBeenCalledTimes(1);
      expect(updateDeedPoll).toHaveBeenCalledWith(
        "case-1",
        { refundAmount: expected, dateOfRefund: "2026-04-03T00:00:00.000Z", refundReference: "REF-1" },
        CALLER
      );
    });

    it("should save whole-number ages, including zero, and a whole-valued decimal as its integer", async () => {
      const answer = await supertest(app)
        .post("/deed-polls/case-1/edit/application")
        .type("form")
        .send({ newSurname: "Typed", ageOfMinor: "7.0", ageOfMinorMonths: "0" });

      expect(answer.status).toBe(302);
      const patch = vi.mocked(updateDeedPoll).mock.calls[0][1] as Record<string, unknown>;
      expect(patch.ageOfMinor).toBe(7);
      expect(patch.ageOfMinorMonths).toBe(0);
      expect(patch.newSurname).toBe("Typed");
    });

    it("should leave an age the form did not submit out of the patch rather than clear it", async () => {
      await supertest(app).post("/deed-polls/case-1/edit/application").type("form").send({ newSurname: "Typed", ageOfMinor: "7" });

      const patch = vi.mocked(updateDeedPoll).mock.calls[0][1] as Record<string, unknown>;
      expect(patch.ageOfMinor).toBe(7);
      expect(patch).not.toHaveProperty("ageOfMinorMonths");
    });

    it("should send only finite numbers, each surviving JSON serialization unchanged", async () => {
      await supertest(app)
        .post("/deed-polls/case-1/edit/application")
        .type("form")
        .send({ newSurname: "Typed", ageOfMinor: "2147483647", ageOfMinorMonths: "-0" });
      await supertest(app)
        .post("/deed-polls/case-1/edit/refund")
        .type("form")
        .send({ ...REFUND, refundAmount: "1234567.89" });

      const numbers = vi
        .mocked(updateDeedPoll)
        .mock.calls.flatMap(([, patch]) => Object.entries(patch as Record<string, unknown>))
        .filter((entry): entry is [string, number] => typeof entry[1] === "number");
      expect(numbers.map(([name]) => name)).toEqual(["ageOfMinor", "ageOfMinorMonths", "refundAmount"]);
      for (const [name, value] of numbers) {
        expect(Number.isFinite(value), name).toBe(true);
        expect(JSON.parse(JSON.stringify({ value })).value, name).toBe(value === 0 ? 0 : value);
      }
    });
  });

  describe("fields the form does not write", () => {
    it.each([
      ["application", "referencenumber"],
      ["enrolment", "daysReceivedToEnroled"],
      ["return", "daysReceivedToReturned"]
    ])("should never put read-only %s's %s into the patch, valid or not", async (tab, field) => {
      for (const typed of ["5", "12x"]) {
        await supertest(app)
          .post(`/deed-polls/case-1/edit/${tab}`)
          .type("form")
          .send({ [field]: typed });
      }

      expect(updateDeedPoll).toHaveBeenCalledTimes(2);
      for (const [, patch] of vi.mocked(updateDeedPoll).mock.calls) {
        expect(patch).not.toHaveProperty(field);
      }
    });

    it("should not let a numeric field from another tab ride along on this one's save", async () => {
      await supertest(app)
        .post("/deed-polls/case-1/edit/refund")
        .type("form")
        .send({ ...REFUND, ageOfMinor: "12x" });

      expect(updateDeedPoll).toHaveBeenCalledTimes(1);
      expect(updateDeedPoll.mock.calls[0][1]).not.toHaveProperty("ageOfMinor");
    });
  });
});

/** What Nunjucks' autoescape makes of the typed text inside a `value` attribute. */
function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("'", "&#39;");
}
