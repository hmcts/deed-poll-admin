import { ConflictError, findCaseEmails, findDeedPoll, InvalidInputError, NotFoundError, previewCaseEmail, sendCaseEmail } from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../../../express-doubles.js";
import { POST } from "./send.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPoll: vi.fn(),
  findCaseEmails: vi.fn(),
  previewCaseEmail: vi.fn(),
  sendCaseEmail: vi.fn()
}));

const found = { id: "case-1", displayReference: "KBDP2026-00001", notes: [], witnesses: [], documents: [] };

const SLOTS = [
  { name: "judges_reason", required: true, maxLength: 40 },
  { name: "additional_notes", required: false, maxLength: 20 }
];

const CASE_EMAILS = {
  availability: [{ template: "application-rejected", applicable: true, reason: null, provisioned: true, slots: SLOTS }],
  history: [],
  slotDefaults: [{ template: "application-rejected", fields: { judges_reason: "Identity not established." } }]
};

const TOKEN = "6f1b8c2e-9d4a-4f7b-8c1d-2e3f4a5b6c7d";

const body = (overrides: Record<string, unknown> = {}) => ({ journey: TOKEN, judges_reason: "Identity not established.", ...overrides });

function request(posted: Record<string, unknown> = body(), template = "application-rejected") {
  return pageRequest({ params: { id: "case-1", template }, body: posted, accessToken: "session-token" });
}

const response = pageResponse;

describe("email send route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "test";
    vi.mocked(findDeedPoll).mockResolvedValue(found as never);
    vi.mocked(findCaseEmails).mockResolvedValue(CASE_EMAILS as never);
    vi.mocked(sendCaseEmail).mockResolvedValue({ id: "email-9", recipient: "applicant@example.com", enqueued: true } as never);
  });

  it("should send the checked wording and come back to the tab with the email named", async () => {
    const res = response();

    await POST(request(), res);

    expect(sendCaseEmail).toHaveBeenCalledWith(
      "case-1",
      "application-rejected",
      { judges_reason: "Identity not established." },
      { accessToken: "session-token" }
    );
    expect(res.redirect).toHaveBeenCalledWith("/deed-polls/case-1?email=sent&emailId=email-9#emails");
  });

  it("should send the slots and nothing else, so the journey's token never reaches api", async () => {
    // Decision 16 as corrected: there is no `Idempotency-Key` in api's contract, and `SendEmailRequest` is one of
    // two bodies with `additionalProperties: false` — so smuggling the token in would be a 400 that names it.
    await POST(request(body({ additional_notes: "Ring us" })), response());

    expect(sendCaseEmail).toHaveBeenCalledWith(
      "case-1",
      "application-rejected",
      { judges_reason: "Identity not established.", additional_notes: "Ring us" },
      expect.anything()
    );
  });

  it("should tell the caseworker a redundant send had already gone, as a success", async () => {
    // api's insert is `ON CONFLICT DO NOTHING`, so a double-click or a browser resubmit answers 200 with the first
    // row's id and `enqueued: false`. Reporting a failure would invite a third attempt.
    vi.mocked(sendCaseEmail).mockResolvedValue({ id: "email-1", recipient: "applicant@example.com", enqueued: false } as never);
    const res = response();

    await POST(request(), res);

    expect(res.redirect).toHaveBeenCalledWith("/deed-polls/case-1?email=already-sent&emailId=email-1#emails");
  });

  it("should render a 409 as its own state on the check page, with api's reason", async () => {
    // Not "somebody else has sent it" — that is the 200 above. A 409 says the case is in no state to send this
    // email at all, which the referral being withdrawn or re-decided since the tab was rendered produces.
    vi.mocked(sendCaseEmail).mockRejectedValue(new ConflictError("This case has no referral that a Master has refused"));
    const res = response();

    await POST(request(), res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.render.mock.calls[0][0]).toBe("deed-polls/email-preview");
    expect(res.render.mock.calls[0][1].refusal).toBe("This email cannot be sent for this case. This case has no referral that a Master has refused");
    expect(res.render.mock.calls[0][1].canSend).toBe(false);
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it("should keep the wording through a refused send, so nothing has to be retyped", async () => {
    vi.mocked(sendCaseEmail).mockRejectedValue(new ConflictError("This case has no referral that a Master has refused"));
    const res = response();

    await POST(request(body({ additional_notes: "Ring us" })), res);

    expect(res.render.mock.calls[0][1].slots).toEqual([
      { name: "judges_reason", value: "Identity not established." },
      { name: "additional_notes", value: "Ring us" }
    ]);
    // The token this also asserted is gone: it compared against nothing, so it kept no guarantee to lose.
    expect(res.render.mock.calls[0][1]).not.toHaveProperty("token");
  });

  it("should still refuse with its own sentence when api's 409 carried no message of its own", async () => {
    // A gateway answering 409 with no body leaves the adapter with `deed-poll-api answered 409` at best, which is
    // why the meaning is this page's sentence rather than api's.
    vi.mocked(sendCaseEmail).mockRejectedValue(new ConflictError(""));
    const res = response();

    await POST(request(), res);

    expect(res.render.mock.calls[0][1].refusal).toBe("This email cannot be sent for this case.");
  });

  it("should send a rejected wording back to the form rather than sending anything", async () => {
    const res = response();

    await POST(request(body({ judges_reason: "" })), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.render.mock.calls[0][0]).toBe("deed-polls/email-compose");
    expect(res.render.mock.calls[0][1].errors.judges_reason).toContain("Enter the Master's reason");
    expect(sendCaseEmail).not.toHaveBeenCalled();
  });

  it("should put api's own content rejection against the control it names, with the typing preserved", async () => {
    vi.mocked(sendCaseEmail).mockRejectedValue(
      new InvalidInputError("Email content is not valid", [{ field: "judges_reason", message: "judges_reason must be 40 characters or fewer" }])
    );
    const res = response();

    await POST(request(body({ judges_reason: "Identity not established." })), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.render.mock.calls[0][0]).toBe("deed-polls/email-compose");
    expect(res.render.mock.calls[0][1].errors.judges_reason).toBe("judges_reason must be 40 characters or fewer");
    expect(res.render.mock.calls[0][1].compose.fields[0].value).toBe("Identity not established.");
  });

  it("should show a refusal about the case itself on the check page, where the message can be read", async () => {
    vi.mocked(sendCaseEmail).mockRejectedValue(
      new InvalidInputError("This applicant has no email address, so this email cannot be sent", [
        { field: "applicantEmail", message: "is empty on this case, and is where this email would be sent" }
      ])
    );
    const res = response();

    await POST(request(), res);

    expect(res.render.mock.calls[0][0]).toBe("deed-polls/email-preview");
    expect(res.render.mock.calls[0][1].refusal).toContain("This applicant has no email address");
    expect(res.render.mock.calls[0][1].canSend).toBe(false);
  });

  it("should 404 for a template this case cannot send, rather than sending it", async () => {
    await expect(POST(request(body(), "chase-missing-documents"), response())).rejects.toThrow(NotFoundError);
    expect(sendCaseEmail).not.toHaveBeenCalled();
  });

  it("should let an unreachable api reach the page rather than reporting a send that did not happen", async () => {
    vi.mocked(sendCaseEmail).mockRejectedValue(new Error("deed-poll-api call failed (unavailable)"));

    await expect(POST(request(), response())).rejects.toThrow("deed-poll-api call failed (unavailable)");
  });

  it("should never preview on the way to sending, because a preview costs a Notify call", async () => {
    await POST(request(), response());

    expect(previewCaseEmail).not.toHaveBeenCalled();
  });
});
