import { findCaseEmails, findDeedPoll, InvalidInputError, NotFoundError, previewCaseEmail, sendCaseEmail } from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../../../express-doubles.js";
import { POST } from "./preview.js";

// The domain's validation and view models run for real: which slots exist, what their caps are and which
// rejections a wording earns are api's metadata read through `validateEmailSlots`, and stubbing that would leave
// these assertions about a stub. Only the api calls are replaced.
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

const RENDERED = {
  subject: "Application refused: KBDP2026-00001",
  html: '<html lang="en"><body><p>Dear applicant,</p></body></html>',
  templateVersion: 1
};

const KEY = "6f1b8c2e-9d4a-4f7b-8c1d-2e3f4a5b6c7d";

// The journey key is posted deliberately, because a return to the wording carries it: it must reach neither write
// body, both of which set `additionalProperties: false`, so an unknown property is a 400 naming it. The test below
// that asserts what `previewCaseEmail` was called with is what proves it is dropped rather than forwarded.
const body = (overrides: Record<string, unknown> = {}) => ({
  idempotencyKey: KEY,
  judges_reason: "Identity not established.",
  ...overrides
});

function request(posted: Record<string, unknown> = body(), template = "application-rejected") {
  return pageRequest({ params: { id: "case-1", template }, body: posted, accessToken: "session-token" });
}

const response = pageResponse;

describe("email preview page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "test";
    vi.mocked(findDeedPoll).mockResolvedValue(found as never);
    vi.mocked(findCaseEmails).mockResolvedValue(CASE_EMAILS as never);
    vi.mocked(previewCaseEmail).mockResolvedValue(RENDERED as never);
  });

  it("should render Notify's own HTML with Send offered, on the template that sandboxes it", async () => {
    const res = response();

    await POST(request(), res);

    expect(res.render.mock.calls[0][0]).toBe("deed-polls/email-preview");
    expect(res.render.mock.calls[0][1]).toMatchObject({ html: RENDERED.html, subject: RENDERED.subject, canSend: true, refusal: null });
  });

  it("should ask api to render the trimmed slots the caseworker typed, and nothing else", async () => {
    // **This is the test that pins the journey key cannot leak into a body.** `body()` posts one, and
    // `SendEmailRequest`/`PreviewEmailRequest` both set `additionalProperties: false`, so forwarding it would be a
    // 400 naming the property. It belongs in the send's `Idempotency-Key` header; the preview requires no key at
    // all, because it writes nothing there is anything to make idempotent about.
    await POST(request(body({ judges_reason: "  Identity not established.  ", additional_notes: "Ring us" })), response());

    expect(previewCaseEmail).toHaveBeenCalledWith(
      "case-1",
      "application-rejected",
      { judges_reason: "Identity not established.", additional_notes: "Ring us" },
      { accessToken: "session-token" }
    );
  });

  it("should carry the checked wording forward as the values the send will post", async () => {
    const res = response();

    await POST(request(body({ additional_notes: "Ring us" })), res);

    expect(res.render.mock.calls[0][1].slots).toEqual([
      { name: "judges_reason", value: "Identity not established." },
      { name: "additional_notes", value: "Ring us" }
    ]);
  });

  it("should not promise the caseworker this is what the applicant will see", async () => {
    // The preview is unbranded and cannot be otherwise: a `srcdoc` document inherits this app's CSP, whose
    // `img-src` is `'self' data:`, and `sandbox=""` gives the frame an opaque origin that `'self'` can never
    // match — so no image in Notify's HTML renders. The caption used to say "as the applicant will see it",
    // which was a claim about appearance the page cannot keep. It claims the wording now, and this pins that:
    // nothing in the suite can detect the blocked images themselves, because the mock's HTML has none.
    const res = response();

    await POST(request(), res);

    const caption = res.render.mock.calls[0][1].en.previewCaption;
    expect(caption).not.toMatch(/as the applicant will see it|exactly as|what the applicant will see/i);
    expect(caption).toContain("wording");
    expect(caption).toMatch(/branding and images are not shown/i);
  });

  it("should withhold Send when Notify returned no HTML to check, and say so", async () => {
    // Fail closed, because the preview is mandatory *because* sending is irreversible (decisions 2 and 3).
    vi.mocked(previewCaseEmail).mockResolvedValue({ ...RENDERED, html: null } as never);
    const res = response();

    await POST(request(), res);

    expect(res.render.mock.calls[0][1]).toMatchObject({ html: null, canSend: false });
    expect(res.render.mock.calls[0][1].en.previewUnavailable).toContain("nothing to check");
  });

  it.each([
    ["an empty string", ""],
    ["whitespace", "   \n  "]
  ])("should treat HTML of %s as no preview at all", async (_description, html) => {
    // api's `EmailPreview.from` reads Notify's Optionals with `orElse("")`, so an absent rendering arrives EMPTY
    // and not null — a null check alone would render an empty frame with a Send button beside it.
    vi.mocked(previewCaseEmail).mockResolvedValue({ ...RENDERED, html } as never);
    const res = response();

    await POST(request(), res);

    expect(res.render.mock.calls[0][1]).toMatchObject({ html: null, canSend: false });
  });

  it("should send a blank required slot back to the form with its message and the typing preserved", async () => {
    const res = response();

    await POST(request(body({ judges_reason: "   ", additional_notes: "Ring us" })), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.render.mock.calls[0][0]).toBe("deed-polls/email-compose");
    expect(res.render.mock.calls[0][1].errors.judges_reason).toContain("Enter the Master's reason");
    expect(res.render.mock.calls[0][1].compose.fields[1].value).toBe("Ring us");
    expect(previewCaseEmail).not.toHaveBeenCalled();
  });

  it("should name every offending slot at once rather than the first", async () => {
    const res = response();

    await POST(request(body({ judges_reason: "x".repeat(41), additional_notes: "y".repeat(21) })), res);

    expect(res.render.mock.calls[0][1].errorList).toEqual([
      { text: expect.stringContaining("40 characters or fewer"), href: "#judges_reason" },
      { text: expect.stringContaining("20 characters or fewer"), href: "#additional_notes" }
    ]);
  });

  it("should render no journey token through a validation failure, there being none to keep", async () => {
    // Was "should keep the journey's token through a validation failure". The typing surviving is what mattered and
    // is pinned two tests above; the token itself compared against nothing, so it guaranteed nothing. Kept as an
    // absence rather than deleted, so the reason is on the record where the assertion used to be.
    const res = response();

    await POST(request(body({ judges_reason: "" })), res);

    expect(res.render.mock.calls[0][1]).not.toHaveProperty("token");
  });

  it("should put api's own rejection against the control it names", async () => {
    // api stays the authority and its message is what the caseworker reads where the two disagree (decision 7).
    // Its field names are the slots' placeholder names, which are this form's control names, so they land.
    vi.mocked(previewCaseEmail).mockRejectedValue(
      new InvalidInputError("Email content is not valid", [{ field: "judges_reason", message: "judges_reason must be 40 characters or fewer" }])
    );
    const res = response();

    await POST(request(), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.render.mock.calls[0][0]).toBe("deed-polls/email-compose");
    expect(res.render.mock.calls[0][1].errors.judges_reason).toBe("judges_reason must be 40 characters or fewer");
  });

  it("should log a rejection this form cannot place and still show the one it can", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(previewCaseEmail).mockRejectedValue(
      new InvalidInputError("Email content is not valid", [
        { field: "judges_reason", message: "judges_reason must be 40 characters or fewer" },
        { field: "reference_number", message: "is resolved from the case and cannot be set by the caller" }
      ])
    );
    const res = response();

    await POST(request(), res);

    expect(logged).toHaveBeenCalledWith(expect.stringContaining("reference_number"));
    expect(res.render.mock.calls[0][1].errors.judges_reason).toBeTruthy();
    expect(res.render.mock.calls[0][1].errors.reference_number).toBeUndefined();
    expect(res.render.mock.calls[0][1].errorList[0].text).toBe("The email could not be prepared. Check the wording and try again.");
    logged.mockRestore();
  });

  it("should show a rejection about the case itself on this page, where it can be read in full", async () => {
    // api's 422 for a case with no `applicantEmail` names a column no form here has a control for, and nothing a
    // caseworker types on the compose form would fix it.
    vi.mocked(previewCaseEmail).mockRejectedValue(
      new InvalidInputError("This applicant has no email address, so this email cannot be sent", [
        { field: "applicantEmail", message: "is empty on this case" }
      ])
    );
    const res = response();

    await POST(request(), res);

    expect(res.render.mock.calls[0][0]).toBe("deed-polls/email-preview");
    expect(res.render.mock.calls[0][1].refusal).toContain("This applicant has no email address");
    expect(res.render.mock.calls[0][1].canSend).toBe(false);
    expect(res.render.mock.calls[0][1].slots).toHaveLength(1);
    // A refusal is a 4xx even with nothing to place it against. Without this the 422 rendered at 200 OK, which
    // made a refused preview indistinguishable from an accepted one to logs, monitoring and anything in between —
    // while the three sibling refusal paths all set a status.
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("should never send anything, whatever the outcome", async () => {
    await POST(request(), response());

    expect(sendCaseEmail).not.toHaveBeenCalled();
  });

  it("should 404 for a template this case cannot send, rather than previewing it", async () => {
    await expect(POST(request(body(), "chase-missing-documents"), response())).rejects.toThrow(NotFoundError);
    expect(previewCaseEmail).not.toHaveBeenCalled();
  });

  it("should let an unreachable api reach the page rather than rendering an empty preview", async () => {
    vi.mocked(previewCaseEmail).mockRejectedValue(new Error("deed-poll-api call failed (unavailable)"));

    await expect(POST(request(), response())).rejects.toThrow("deed-poll-api call failed (unavailable)");
  });

  it("should mint the journey's idempotency key when the check page is reached without one", async () => {
    // Minted here rather than at the send, because the key means "this one submission however many times it
    // arrives" and must therefore be older than the click. api parses the header as a UUID.
    const res = response();

    await POST(request({ judges_reason: "Identity not established." }), res);

    expect(res.render.mock.calls[0][1].journeyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(res.render.mock.calls[0][1].journeyKeyField).toBe("idempotencyKey");
  });

  it("should keep the key it was given, so returning from the check page is one journey and not two", async () => {
    const res = response();

    await POST(request(body()), res);

    expect(res.render.mock.calls[0][1].journeyKey).toBe(KEY);
  });

  it("should give a second compose journey a key of its own, so two open tabs cannot refuse each other", async () => {
    // Decision 3's reason for a hidden control over session state: a key stored against the case and template
    // would be shared by both tabs, and the second send would be refused as a reuse with different content.
    const first = response();
    const second = response();

    await POST(request({ judges_reason: "Identity not established." }), first);
    await POST(request({ judges_reason: "Identity not established." }), second);

    expect(second.render.mock.calls[0][1].journeyKey).not.toBe(first.render.mock.calls[0][1].journeyKey);
  });

  it("should mint a fresh key rather than carrying a submitted one api could not parse", async () => {
    // The control is user input. A value that is not a UUID is api's 400 naming the header, so it must not survive
    // as far as the send — and the check page is where a usable one can still be made.
    const res = response();

    await POST(request(body({ idempotencyKey: "not-a-uuid" })), res);

    expect(res.render.mock.calls[0][1].journeyKey).not.toBe("not-a-uuid");
    expect(res.render.mock.calls[0][1].journeyKey).toMatch(/^[0-9a-f]{8}-/);
  });

  it("should provide the cy content in the en shape, so no key renders blank in Welsh", async () => {
    const res = response();

    await POST(request(), res);

    const { en, cy } = res.render.mock.calls[0][1];
    expect(Object.keys(cy)).toEqual(Object.keys(en));
  });
});
