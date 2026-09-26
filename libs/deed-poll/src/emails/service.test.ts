import { getCase, getCaseEmails, previewEmail, sendEmail } from "@hmcts/deed-poll-api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, InvalidInputError, NotFoundError } from "../errors.js";
import { findCaseEmails, previewCaseEmail, sendCaseEmail } from "./service.js";

// The adapter is mocked and nothing else. What is worth pinning at this seam is that each function reaches the
// right operation, that the caller's token travels and nothing else does, and that api's three refusals arrive
// as the errors a page renders — its 409 as a state, its 400 and 422 as field errors, and an unreachable api as
// the fault it is.
vi.mock("@hmcts/deed-poll-api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll-api-client")>()),
  getCaseEmails: vi.fn(),
  previewEmail: vi.fn(),
  sendEmail: vi.fn(),
  getCase: vi.fn()
}));

const CALLER = { accessToken: "caseworker-token" };

const TEMPLATE = "application-rejected";

const SLOTS = { judges_reason: "The evidence does not establish the applicant's identity" };

// The compose journey's key, minted by the page that rendered Send. api requires it as a header on the send.
const KEY = "6f1b8c2e-9d4a-4f7b-8c1d-2e3f4a5b6c7d";

const EMAILS = {
  availability: [{ template: TEMPLATE, applicable: true, reason: null, provisioned: true, slots: [] }],
  history: [{ id: "email-1", template: TEMPLATE, notifyState: "Sent", documents: [] }],
  slotDefaults: [{ template: TEMPLATE, fields: { judges_reason: "As the Master wrote it" } }]
};

const ok = <T>(data: T) => ({ ok: true as const, data });

describe("emails/service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DEED_POLL_API_URL = "http://api.test";
  });

  describe("findCaseEmails", () => {
    it("should return the whole tab payload in one call, carrying the caller's token", async () => {
      vi.mocked(getCaseEmails).mockResolvedValue(ok(EMAILS) as never);

      expect(await findCaseEmails("case-1", CALLER)).toEqual(EMAILS);
      expect(getCaseEmails).toHaveBeenCalledWith("case-1", expect.objectContaining({ baseUrl: "http://api.test", accessToken: "caseworker-token" }));
    });

    it("should not read the case as well, because no email data is on its payload", async () => {
      vi.mocked(getCaseEmails).mockResolvedValue(ok(EMAILS) as never);

      await findCaseEmails("case-1", CALLER);

      expect(getCase).not.toHaveBeenCalled();
    });

    it("should not call preview to discover the slot defaults, because the read already carries them", async () => {
      // Decision 9: a preview costs one of Notify's rate-limited calls, and that allowance is shared with real
      // sends. The compose form opens from `slotDefaults`, which this response carries.
      vi.mocked(getCaseEmails).mockResolvedValue(ok(EMAILS) as never);

      const emails = await findCaseEmails("case-1", CALLER);

      expect(emails.slotDefaults[0]?.fields).toEqual({ judges_reason: "As the Master wrote it" });
      expect(previewEmail).not.toHaveBeenCalled();
    });

    it("should throw NotFoundError for a case that does not exist, rather than answering three empty arrays", async () => {
      vi.mocked(getCaseEmails).mockResolvedValue({ ok: false, error: { kind: "not-found", status: 404, message: "Case case-9 not found" } } as never);

      await expect(findCaseEmails("case-9", CALLER)).rejects.toBeInstanceOf(NotFoundError);
    });

    it("should throw a plain Error naming api when it cannot be reached, which the tab degrades on rather than the page", async () => {
      // The throw is the fault it is; `unavailableEmailsView()` is what the page renders after catching it, so
      // the panel degrades and the rest of the case still loads.
      vi.mocked(getCaseEmails).mockResolvedValue({ ok: false, error: { kind: "unavailable", status: 503, message: "fetch failed" } } as never);

      await expect(findCaseEmails("case-1", CALLER)).rejects.toThrow("deed-poll-api call failed (unavailable): fetch failed");
    });
  });

  describe("previewCaseEmail", () => {
    it("should send the slots unchanged under the template in the path", async () => {
      vi.mocked(previewEmail).mockResolvedValue(ok({ subject: "Refused", html: "<p>Refused</p>", templateVersion: 3 }) as never);

      const preview = await previewCaseEmail("case-1", TEMPLATE, SLOTS, CALLER);

      expect(preview.html).toBe("<p>Refused</p>");
      expect(previewEmail).toHaveBeenCalledWith("case-1", TEMPLATE, SLOTS, expect.anything());
    });

    it("should keep the slot keys snake_case, because they are Notify's placeholder names", async () => {
      // A camelCased key is not a 400 — it is a slot that was never sent, so Notify substitutes nothing and the
      // applicant reads the template with an empty quotation in it.
      vi.mocked(previewEmail).mockResolvedValue(ok({ subject: null, html: null, templateVersion: 1 }) as never);

      await previewCaseEmail("case-1", TEMPLATE, { judges_reason: "Reason", additional_notes: "Notes" }, CALLER);

      expect(previewEmail).toHaveBeenCalledWith("case-1", TEMPLATE, { judges_reason: "Reason", additional_notes: "Notes" }, expect.anything());
    });

    it("should throw InvalidInputError carrying api's field errors when it refuses a slot", async () => {
      vi.mocked(previewEmail).mockResolvedValue({
        ok: false,
        error: {
          kind: "validation",
          status: 400,
          message: "The email content is not valid",
          fieldErrors: [{ field: "judges_reason", message: "judges_reason is required" }]
        }
      } as never);

      const thrown = await previewCaseEmail("case-1", TEMPLATE, {}, CALLER).catch((error: unknown) => error);

      expect(thrown).toBeInstanceOf(InvalidInputError);
      expect((thrown as InvalidInputError).errors).toEqual([{ field: "judges_reason", message: "judges_reason is required" }]);
    });

    it("should throw NotFoundError for a template api does not serve, because the key is a route parameter", async () => {
      vi.mocked(previewEmail).mockResolvedValue({ ok: false, error: { kind: "not-found", status: 404, message: "There is no such email type" } } as never);

      await expect(previewCaseEmail("case-1", "made-up", {}, CALLER)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("sendCaseEmail", () => {
    it("should return the outbox row so a page can render what happened", async () => {
      vi.mocked(sendEmail).mockResolvedValue(ok({ id: "email-9", recipient: "applicant@example.com", enqueued: true }) as never);

      expect(await sendCaseEmail("case-1", TEMPLATE, SLOTS, KEY, CALLER)).toEqual({ id: "email-9", recipient: "applicant@example.com", enqueued: true });
      expect(sendEmail).toHaveBeenCalledWith("case-1", TEMPLATE, SLOTS, KEY, expect.anything());
    });

    it("should return a redundant send as the success it is, not as a failure", async () => {
      // api's insert is `ON CONFLICT DO NOTHING`, so a double-click answers 200 with the first row's id and
      // `enqueued: false`. Telling the caseworker their send failed would invite a third attempt.
      vi.mocked(sendEmail).mockResolvedValue(ok({ id: "email-1", recipient: "applicant@example.com", enqueued: false }) as never);

      const sent = await sendCaseEmail("case-1", TEMPLATE, SLOTS, KEY, CALLER);

      expect(sent).toEqual({ id: "email-1", recipient: "applicant@example.com", enqueued: false });
    });

    it("should pass the caller's key beside the body rather than inside it", async () => {
      // api's notify-6 made `Idempotency-Key` a required header, and `SendEmailRequest` sets
      // `additionalProperties: false` — so the key travels as its own argument and the body stays the slots.
      vi.mocked(sendEmail).mockResolvedValue(ok({ id: "email-9", recipient: "applicant@example.com", enqueued: true }) as never);

      await sendCaseEmail("case-1", TEMPLATE, SLOTS, KEY, CALLER);

      expect(sendEmail).toHaveBeenCalledWith("case-1", TEMPLATE, SLOTS, KEY, expect.anything());
      expect(vi.mocked(sendEmail).mock.calls[0]?.[2]).not.toHaveProperty("idempotencyKey");
    });

    it("should generate no key of its own, because the key identifies the caller's journey", async () => {
      // A service that minted one would make every retry of one submission a new send, which is the behaviour
      // api's header replaced. Whatever the page gives it is what goes on the wire.
      vi.mocked(sendEmail).mockResolvedValue(ok({ id: "email-9", recipient: "applicant@example.com", enqueued: true }) as never);

      await sendCaseEmail("case-1", TEMPLATE, SLOTS, "11111111-2222-4333-8444-555555555555", CALLER);
      await sendCaseEmail("case-1", TEMPLATE, SLOTS, "11111111-2222-4333-8444-555555555555", CALLER);

      expect(vi.mocked(sendEmail).mock.calls.map((call) => call[3])).toEqual(["11111111-2222-4333-8444-555555555555", "11111111-2222-4333-8444-555555555555"]);
    });

    it("should send no author, because api stamps createdBy from the token", async () => {
      vi.mocked(sendEmail).mockResolvedValue(ok({ id: "email-9", recipient: "applicant@example.com", enqueued: true }) as never);

      await sendCaseEmail("case-1", TEMPLATE, SLOTS, KEY, CALLER);

      const [, , body, , config] = vi.mocked(sendEmail).mock.calls[0] ?? [];
      expect(Object.keys(body ?? {})).toEqual(["judges_reason"]);
      expect(config).toEqual(expect.objectContaining({ accessToken: "caseworker-token" }));
    });

    it("should throw ConflictError when the case is in no state to send this email", async () => {
      // Not "already sent" — that is a 200 with `enqueued: false`. A 409 here is the referral having been
      // withdrawn or re-decided since the tab was rendered, which a page renders as its own state.
      vi.mocked(sendEmail).mockResolvedValue({
        ok: false,
        error: { kind: "conflict", status: 409, message: "This case has no referral that a Master has refused" }
      } as never);

      const thrown = await sendCaseEmail("case-1", TEMPLATE, SLOTS, KEY, CALLER).catch((error: unknown) => error);

      expect(thrown).toBeInstanceOf(ConflictError);
      expect((thrown as ConflictError).message).toBe("This case has no referral that a Master has refused");
    });

    it("should throw InvalidInputError naming the missing address when the applicant has no email", async () => {
      // api's 422, classified with its 400 as `validation`, so the page renders the same way for both.
      vi.mocked(sendEmail).mockResolvedValue({
        ok: false,
        error: {
          kind: "validation",
          status: 422,
          message: "This applicant has no email address, so this email cannot be sent",
          fieldErrors: [{ field: "applicantEmail", message: "is empty on this case" }]
        }
      } as never);

      const thrown = await sendCaseEmail("case-1", TEMPLATE, SLOTS, KEY, CALLER).catch((error: unknown) => error);

      expect(thrown).toBeInstanceOf(InvalidInputError);
      expect((thrown as InvalidInputError).errors).toEqual([{ field: "applicantEmail", message: "is empty on this case" }]);
    });
  });
});
