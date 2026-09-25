import { findCaseEmails, findDeedPoll, NotFoundError, previewCaseEmail, sendCaseEmail } from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../../../express-doubles.js";
import { GET, POST } from "./compose.js";

// The view models are the domain's and run for real: what the form offers, what it pre-populates and which
// templates it will open at all are `buildComposeView`'s answers, and a stub would make these assertions about
// the stub. The two write functions are replaced only so this file can assert the form costs neither.
vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPoll: vi.fn(),
  findCaseEmails: vi.fn(),
  previewCaseEmail: vi.fn(),
  sendCaseEmail: vi.fn()
}));

const found = { id: "case-1", displayReference: "KBDP2026-00001", notes: [], witnesses: [], documents: [] };

/** api's slot metadata, `snake_case` names and all — see `slot-validation.ts` for why they stay that way. */
const SLOTS = [
  { name: "judges_reason", required: true, maxLength: 4000 },
  { name: "additional_notes", required: false, maxLength: 1000 }
];

const AVAILABLE = { template: "application-rejected", applicable: true, reason: null, provisioned: true, slots: SLOTS };

const CASE_EMAILS = {
  availability: [AVAILABLE],
  history: [],
  slotDefaults: [{ template: "application-rejected", fields: { judges_reason: "The evidence does not establish identity.", additional_notes: "" } }]
};

function request(body?: Record<string, unknown>, template = "application-rejected") {
  return pageRequest({ params: { id: "case-1", template }, body, accessToken: "session-token" });
}

const response = pageResponse;

describe("email compose page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "test";
    vi.mocked(findDeedPoll).mockResolvedValue(found as never);
    vi.mocked(findCaseEmails).mockResolvedValue(CASE_EMAILS as never);
  });

  it("should render the form for the template in the path, against the case's reference", async () => {
    const res = response();

    await GET(request(), res);

    expect(res.render.mock.calls[0][0]).toBe("deed-polls/email-compose");
    expect(res.render.mock.calls[0][1].case.displayReference).toBe("KBDP2026-00001");
    expect(res.render.mock.calls[0][1].compose.name).toBe("Application rejected");
  });

  it("should open the slots pre-populated from api's defaults rather than empty", async () => {
    // Decision 8: the judge's own words reach the form out of the tab's payload, so opening it costs no preview
    // — and a preview costs one of Notify's rate-limited calls, shared with real sends (decision 9).
    const res = response();

    await GET(request(), res);

    const fields = res.render.mock.calls[0][1].compose.fields;
    expect(fields[0]).toMatchObject({ name: "judges_reason", value: "The evidence does not establish identity.", required: true, maxLength: 4000 });
    expect(fields[1]).toMatchObject({ name: "additional_notes", value: "", required: false });
  });

  it("should name the controls with api's snake_case placeholder names", async () => {
    // The mistake no other test catches: these are GOV.UK Notify placeholder names, so each is the
    // personalisation key, the body key and the control name at once. A camelCase version here would make Notify
    // substitute nothing and send the template with an empty quotation in it, with every other test still green.
    const res = response();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].compose.fields.map((field: { name: string }) => field.name)).toEqual(["judges_reason", "additional_notes"]);
  });

  it("should read the case and its emails once each, and neither preview nor send anything", async () => {
    await GET(request(), response());

    expect(findDeedPoll).toHaveBeenCalledWith("case-1", { accessToken: "session-token" });
    expect(findCaseEmails).toHaveBeenCalledTimes(1);
    expect(findCaseEmails).toHaveBeenCalledWith("case-1", { accessToken: "session-token" });
    expect(previewCaseEmail).not.toHaveBeenCalled();
    expect(sendCaseEmail).not.toHaveBeenCalled();
  });

  it("should mint no journey key of its own when the form is opened from the tab", async () => {
    // The key is minted by the check page, not here — `preview.ts` is where the send begins. A form opened from
    // the tab has no journey to identify yet, and minting one here would make every abandoned form a key.
    const res = response();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].journeyKey).toBeNull();
  });

  it("should carry a posted journey key back out, so a return to the wording stays one journey", async () => {
    // This is the form the check page comes back to. Dropping the key here would send the caseworker forward to a
    // check page that minted a second one, and their corrected resubmit would be a second send rather than the
    // same one arriving again.
    const key = "6f1b8c2e-9d4a-4f7b-8c1d-2e3f4a5b6c7d";
    const res = response();

    await POST(request({ idempotencyKey: key, judges_reason: "Shortened" }), res);

    expect(res.render.mock.calls[0][1].journeyKey).toBe(key);
    expect(res.render.mock.calls[0][1].journeyKeyField).toBe("idempotencyKey");
  });

  it("should carry no posted key that api could not parse, rather than passing it on", async () => {
    // The control is user input and api binds the header as a UUID, so an unparseable value is dropped and the
    // check page mints a usable one. Nothing in this repo may put a value on the wire that api's 400 names.
    const res = response();

    await POST(request({ idempotencyKey: "not-a-uuid", judges_reason: "Shortened" }), res);

    expect(res.render.mock.calls[0][1].journeyKey).toBeNull();
  });

  it("should never send the journey key to api as a slot", async () => {
    // It is not a slot, and both write bodies set `additionalProperties: false`. The form's own controls are api's
    // published slot metadata, which is why an extra key in the body cannot become one.
    const res = response();

    await POST(request({ idempotencyKey: "6f1b8c2e-9d4a-4f7b-8c1d-2e3f4a5b6c7d", judges_reason: "Shortened" }), res);

    expect(res.render.mock.calls[0][1].compose.fields.map((field: { name: string }) => field.name)).toEqual(["judges_reason", "additional_notes"]);
  });

  it("should return the caseworker's own text untrimmed, not api's default, when the form comes back", async () => {
    // Somebody who has been told their wording is too long must get their words back to shorten, not the
    // pre-populated ones they replaced.
    const res = response();

    await POST(request({ judges_reason: "  The applicant's evidence was insufficient.  " }), res);

    expect(res.render.mock.calls[0][1].compose.fields[0].value).toBe("  The applicant's evidence was insufficient.  ");
  });

  it("should render no errors and no error summary when nothing has been submitted", async () => {
    const res = response();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].errors).toEqual({});
    expect(res.render.mock.calls[0][1].errorList).toEqual([]);
  });

  it("should 404 for a template key api does not publish", async () => {
    // The template is a route parameter and therefore user input.
    await expect(GET(request(undefined, "chase-missing-documents"), response())).rejects.toThrow(NotFoundError);
  });

  it("should 404 for a template api says is not applicable to this case", async () => {
    vi.mocked(findCaseEmails).mockResolvedValue({
      ...CASE_EMAILS,
      availability: [{ ...AVAILABLE, applicable: false, reason: "This case has no referral that a Master has refused" }]
    } as never);

    await expect(GET(request(), response())).rejects.toThrow(NotFoundError);
  });

  it("should 404 for a template this environment has not provisioned in Notify", async () => {
    // Offering the form would lead to a preview api answers 502 to — an `unavailable`, and therefore the 500
    // page — for a reason the payload already carried.
    vi.mocked(findCaseEmails).mockResolvedValue({ ...CASE_EMAILS, availability: [{ ...AVAILABLE, provisioned: false }] } as never);

    await expect(GET(request(), response())).rejects.toThrow(NotFoundError);
  });

  it("should let a missing case 404 rather than rendering a form under no reference", async () => {
    vi.mocked(findDeedPoll).mockRejectedValue(new NotFoundError("DeedPoll nope not found"));

    await expect(GET(request(), response())).rejects.toThrow(NotFoundError);
  });

  it("should let a failed emails read reach the page, because this page is the email", async () => {
    // The opposite of the case detail page, where the emails read is one panel out of several and degrades.
    vi.mocked(findCaseEmails).mockRejectedValue(new Error("deed-poll-api call failed (unavailable)"));

    await expect(GET(request(), response())).rejects.toThrow("deed-poll-api call failed (unavailable)");
  });

  it("should provide the cy content in the en shape, so no key renders blank in Welsh", async () => {
    const res = response();

    await GET(request(), res);

    const { en, cy } = res.render.mock.calls[0][1];
    expect(Object.keys(cy)).toEqual(Object.keys(en));
  });
});
