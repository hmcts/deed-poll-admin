import { findCaseEmails, findDeedPoll, NotFoundError, previewCaseEmail, sendCaseEmail } from "@hmcts/deed-poll";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../../express-doubles.js";
import { GET } from "./[notificationId].js";

// `buildEmailDetail` is the domain's and runs for real: the labels, the placeholders and the three no-content
// sentences are what this page is made of. The two write functions are stubbed only so the test can assert this
// page never reaches for them — decision 14 is that the content comes out of the tab's own payload.
vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPoll: vi.fn(),
  findCaseEmails: vi.fn(),
  previewCaseEmail: vi.fn(),
  sendCaseEmail: vi.fn()
}));

const found = { id: "case-1", displayReference: "KBDP2026-00001", notes: [], witnesses: [], documents: [] };

const PARAMS = { id: "case-1", notificationId: "email-1" };

const CALLER = { accessToken: "session-token" };

const SENT = {
  id: "email-1",
  template: "application-rejected",
  templateName: "Application refused",
  subject: "Your application has been refused",
  body: "Dear applicant,\n\nThe Master has refused your application.",
  recipient: "applicant@example.com",
  notifyState: "Sent" as const,
  failureReason: null,
  createdBy: "caseworker@example.com",
  createdOn: new Date("2026-03-18T11:05:00Z"),
  documents: []
};

const payload = (history: Record<string, unknown>[] = [SENT]) => ({ availability: [], history, slotDefaults: [] });

function request(notificationId = "email-1") {
  return pageRequest({ params: { ...PARAMS, notificationId }, accessToken: "session-token" });
}

const response = pageResponse;

describe("email view page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NODE_ENV = "test";
    vi.mocked(findDeedPoll).mockResolvedValue(found as never);
    vi.mocked(findCaseEmails).mockResolvedValue(payload() as never);
  });

  it("should render the email against the case's reference", async () => {
    const res = response();

    await GET(request(), res);

    expect(res.render.mock.calls[0][0]).toBe("deed-polls/email-detail");
    expect(res.render.mock.calls[0][1].case.displayReference).toBe("KBDP2026-00001");
    expect(res.render.mock.calls[0][1].email.subject).toBe("Your application has been refused");
    expect(res.render.mock.calls[0][1].email.body).toBe("Dear applicant,\n\nThe Master has refused your application.");
  });

  it("should read the case's emails once and make no call of its own for the content", async () => {
    // Decision 14: api answers the tab, the compose form and this page out of one response, so the content page
    // reads its row from the same payload the table was built from. A second call for one panel's worth of
    // content is the round trip this repo's performance rule refuses.
    await GET(request(), response());

    expect(findCaseEmails).toHaveBeenCalledTimes(1);
    expect(findCaseEmails).toHaveBeenCalledWith("case-1", CALLER);
    expect(previewCaseEmail).not.toHaveBeenCalled();
    expect(sendCaseEmail).not.toHaveBeenCalled();
  });

  it("should 404 for a notification id this case's history does not carry", async () => {
    // The id is a route parameter and therefore user input. api scopes the payload to the case, so another
    // case's email is absent from it rather than filtered out here.
    await expect(GET(request("email-9"), response())).rejects.toThrow(NotFoundError);
  });

  it("should 404 for a case that has had no emails at all", async () => {
    vi.mocked(findCaseEmails).mockResolvedValue(payload([]) as never);

    await expect(GET(request(), response())).rejects.toThrow(NotFoundError);
  });

  it("should let a missing case 404 rather than rendering an email under no reference", async () => {
    vi.mocked(findDeedPoll).mockRejectedValue(new NotFoundError("DeedPoll nope not found"));

    await expect(GET(request(), response())).rejects.toThrow(NotFoundError);
  });

  it("should let a failed emails read reach the page, because this page is the email", async () => {
    // The opposite of the tab's behaviour, and deliberately: on the case detail page the emails read is one
    // panel out of several and degrades, where here there is nothing left to render.
    vi.mocked(findCaseEmails).mockRejectedValue(new Error("deed-poll-api call failed (unavailable)"));

    await expect(GET(request(), response())).rejects.toThrow("deed-poll-api call failed (unavailable)");
  });

  it("should carry the failure reason of a failed email, so a caseworker knows what to do about it", async () => {
    const failed = { ...SENT, notifyState: "Failed" as const, body: null, subject: null, failureReason: "GOV.UK Notify rejected the recipient address" };
    vi.mocked(findCaseEmails).mockResolvedValue(payload([failed]) as never);
    const res = response();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].email.failureReason).toBe("GOV.UK Notify rejected the recipient address");
    expect(res.render.mock.calls[0][1].email.state).toBe("Failed");
  });

  it.each([
    ["Pending", "has not been sent yet"],
    ["Failed", "was not sent"],
    ["Sent", "before the service began keeping the wording"]
  ] as const)("should explain rather than blank the body of a %s email with no wording", async (notifyState, fragment) => {
    vi.mocked(findCaseEmails).mockResolvedValue(payload([{ ...SENT, notifyState, body: null }]) as never);
    const res = response();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].email.body).toBeNull();
    expect(res.render.mock.calls[0][1].email.missingBody).toContain(fragment);
  });

  it("should label the body as the wording that was sent rather than as the email itself", async () => {
    // Decision 13: the applicant received Notify's branded HTML and this is the text rendering of the same
    // template. Calling it a copy of the email invites "that is not what they got".
    const res = response();

    await GET(request(), res);

    expect(res.render.mock.calls[0][1].en.bodyHeading).toBe("The wording that was sent");
  });

  it("should provide the cy content in the en shape, so no key renders blank in Welsh", async () => {
    const res = response();

    await GET(request(), res);

    const { en, cy } = res.render.mock.calls[0][1];
    expect(Object.keys(cy)).toEqual(Object.keys(en));
  });
});
