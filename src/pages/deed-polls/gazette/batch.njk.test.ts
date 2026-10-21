import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ForbiddenError,
  findDeedPoll,
  findGazetteReadyCases,
  GAZETTE_CHECKS,
  GazetteOutcomeUnknownError,
  GazetteRefusalError,
  gazetteReviewsCurrent,
  previewGazetteSelection,
  sendGazetteSelection,
  UnauthorizedError
} from "@hmcts/deed-poll";
import nunjucks from "nunjucks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "../../../express-doubles.js";
import { GET, POST } from "./batch.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPoll: vi.fn(),
  findGazetteReadyCases: vi.fn(),
  gazetteReviewsCurrent: vi.fn(),
  previewGazetteSelection: vi.fn(),
  sendGazetteSelection: vi.fn()
}));

const STARTER_VIEWS = path.join(fileURLToPath(import.meta.url), "../../../../../libs/express-govuk-starter/src");
const environment = nunjucks.configure(
  [
    path.join(fileURLToPath(import.meta.resolve("govuk-frontend")), "..", ".."),
    path.join(STARTER_VIEWS, "govuk-frontend/views"),
    path.join(STARTER_VIEWS, "cookies/views"),
    path.join(fileURLToPath(import.meta.url), "../../../..", "pages")
  ],
  { autoescape: true }
);

const ID = "case-1";
const BATCH_ID = "00000000-0000-4000-8000-000000000001";
const RECORD = {
  id: ID,
  displayReference: "FROZEN-001",
  state: "Enroled",
  type: "Adult",
  newForename: "Ada",
  newMiddleName: "New middle",
  newSurname: "New",
  oldForename: "Former",
  oldMiddleName: "Old middle",
  oldSurname: "Name",
  notes: [],
  witnesses: [],
  documents: []
};
const PREVIEW = {
  caseCount: 1,
  adultCount: 1,
  minorCount: 0,
  recipientEmail: "gazette@example.com",
  recipientRevision: 2,
  selectionFingerprint: "original-fingerprint",
  expiresAt: new Date("2030-01-01"),
  cases: [{ caseId: ID, referenceNumber: "FROZEN-001" }]
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(findGazetteReadyCases).mockResolvedValue({ cases: [RECORD], page: 1, size: 25, total: 26, totalPages: 2 } as never);
  vi.mocked(findDeedPoll).mockResolvedValue(RECORD as never);
  vi.mocked(gazetteReviewsCurrent).mockResolvedValue(true);
  vi.mocked(previewGazetteSelection).mockResolvedValue(PREVIEW);
  vi.mocked(sendGazetteSelection).mockResolvedValue({ batchId: BATCH_ID, state: "Sent", caseCount: 1 });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

async function render(body?: Record<string, unknown>, locale = "en", sessionID = "admin-session", spentMs = 0) {
  const req = Object.assign(pageRequest({ body, teamLeader: true, accessToken: "token" }), { sessionID });
  const res = pageResponse();
  res.locals.locale = locale;
  res.locals.receivedAt = performance.now() - spentMs;
  await (body ? POST : GET)(req, res);
  if (!res.render.mock.calls.length) return { res, model: null, markup: "", journey: "" };
  const model = res.render.mock.calls[0][1];
  return { res, model, journey: model.journey as string, markup: environment.render("deed-polls/gazette/batch.njk", { ...model[locale], ...model }) };
}
async function reviewed() {
  const list = await render();
  const review = await render({ journey: list.journey, action: `review:${ID}` });
  return render({ journey: review.journey, action: "save", checks: [...GAZETTE_CHECKS] });
}
async function confirmation() {
  const list = await reviewed();
  return render({ journey: list.journey, action: "preview", caseIds: ID });
}

it("should require all five checks, preserve incomplete input and only enable selection after review", async () => {
  const list = await render();
  expect(list.markup).toMatch(/type="checkbox"[^>]*disabled/s);
  const forged = await render({ journey: list.journey, action: "preview", caseIds: ID });
  expect(forged.markup).toContain("Only applications with a completed checklist can be selected");
  expect(previewGazetteSelection).not.toHaveBeenCalled();
  const review = await render({ journey: list.journey, action: `review:${ID}` });
  expect(review.markup).toContain("Former Old middle Name");
  expect(review.markup).toContain("Ada New middle New");
  const partial = await render({ journey: review.journey, action: "save", checks: "enrolled" });
  expect(partial.markup).toContain("Complete all five checks");
  expect(partial.markup).toMatch(/value="enrolled"[^>]*checked/s);
  const complete = await render({ journey: partial.journey, action: "save", checks: [...GAZETTE_CHECKS] });
  expect(complete.model?.phase).toBe("select");
  expect(complete.markup).not.toMatch(/type="checkbox"[^>]*disabled/s);
  expect(sendGazetteSelection).not.toHaveBeenCalled();
});

it("should present the actual recipient and group counts, require explicit confirmation, and redirect to the returned status", async () => {
  const check = await confirmation();
  expect(check.markup).toContain("gazette@example.com");
  expect(check.markup).toContain("FROZEN-001");
  expect(check.markup).toContain("One email will contain download links");
  const missing = await render({ journey: check.journey, action: "send" });
  expect(missing.markup).toContain("Confirm the recipient and applications before sending");
  expect(sendGazetteSelection).not.toHaveBeenCalled();
  const sent = await render({ journey: check.journey, action: "send", confirmed: "yes" });
  expect(sent.res.redirect).toHaveBeenCalledWith(303, `/deed-polls/gazette/requests/${BATCH_ID}`);
  expect(sendGazetteSelection).toHaveBeenCalledWith(
    { caseIds: [ID], recipientRevision: 2, selectionFingerprint: "original-fingerprint" },
    expect.any(String),
    { accessToken: "token" },
    { timeoutMs: expect.any(Number) }
  );
});

describe("the send's deadline, counted from the request's arrival", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: Date.now(), toFake: ["Date", "performance"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    { spent: 0, timeoutMs: 25_000 },
    { spent: 12_000, timeoutMs: 13_000 },
    { spent: 20_000, timeoutMs: 5_000 }
  ])("should give the send what is left of the budget after $spent ms, and redirect as before", async ({ spent, timeoutMs }) => {
    const check = await confirmation();

    const sent = await render({ journey: check.journey, action: "send", confirmed: "yes" }, "en", "admin-session", spent);

    expect(vi.mocked(sendGazetteSelection).mock.calls[0][3]).toEqual({ timeoutMs });
    expect(sent.res.redirect).toHaveBeenCalledWith(303, `/deed-polls/gazette/requests/${BATCH_ID}`);
  });

  it("should count the time the review re-check spent", async () => {
    const check = await confirmation();
    vi.mocked(gazetteReviewsCurrent).mockImplementationOnce(async () => {
      vi.advanceTimersByTime(9_000);
      return true;
    });

    await render({ journey: check.journey, action: "send", confirmed: "yes" }, "en", "admin-session", 3_000);

    expect(vi.mocked(sendGazetteSelection).mock.calls[0][3]).toEqual({ timeoutMs: 13_000 });
  });

  it("should send nothing when the review re-check itself spends the time down past the floor", async () => {
    const check = await confirmation();
    vi.mocked(gazetteReviewsCurrent).mockImplementationOnce(async () => {
      vi.advanceTimersByTime(6_000);
      return true;
    });

    const late = await render({ journey: check.journey, action: "send", confirmed: "yes" }, "en", "admin-session", 15_000);

    expect(sendGazetteSelection).not.toHaveBeenCalled();
    expect(late.res.status).toHaveBeenCalledWith(503);
    expect(late.model?.errorList).toEqual([{ text: late.model?.en.notSent, href: "#confirmed" }]);
  });

  it.each(["en", "cy"])("should send nothing under the floor and re-render the %s confirm step with the same key", async (locale) => {
    const check = await confirmation();

    const late = await render({ journey: check.journey, action: "send", confirmed: "yes" }, locale, "admin-session", 21_000);

    expect(sendGazetteSelection).not.toHaveBeenCalled();
    expect(late.res.status).toHaveBeenCalledWith(503);
    expect(late.model?.phase).toBe("confirm");
    expect(late.model?.confirmation).toEqual(check.model?.confirmation);
    expect(late.model?.errorList).toEqual([{ text: late.model?.[locale].notSent, href: "#confirmed" }]);
    expect(late.markup).toContain('value="send"');
    expect(late.markup).not.toContain('value="check"');
    const resent = await render({ journey: late.journey, action: "send", confirmed: "yes" }, locale);
    expect(sendGazetteSelection).toHaveBeenCalledExactlyOnceWith(expect.anything(), check.model?.confirmation.key, expect.anything(), expect.anything());
    expect(resent.res.redirect).toHaveBeenCalledWith(303, `/deed-polls/gazette/requests/${BATCH_ID}`);
  });

  it.each(["en", "cy"])("should make no status check under the floor and re-render the %s recovery page with the original key and body", async (locale) => {
    const check = await confirmation();
    vi.mocked(sendGazetteSelection).mockRejectedValueOnce(new GazetteOutcomeUnknownError());
    const lost = await render({ journey: check.journey, action: "send", confirmed: "yes" });
    const original = vi.mocked(sendGazetteSelection).mock.calls[0];
    vi.mocked(sendGazetteSelection).mockClear();

    const late = await render({ journey: lost.journey, action: "check" }, locale, "admin-session", 20_500);

    expect(sendGazetteSelection).not.toHaveBeenCalled();
    expect(late.res.status).toHaveBeenCalledWith(503);
    expect(late.model?.phase).toBe("recover");
    expect(late.model?.confirmation).toEqual(lost.model?.confirmation);
    expect(late.markup).toContain(late.model?.[locale].notChecked);
    expect(late.markup).toContain('value="check"');
    expect(late.markup).not.toContain('value="send"');
    await render({ journey: late.journey, action: "check" }, locale);
    expect(vi.mocked(sendGazetteSelection).mock.calls[0].slice(0, 3)).toEqual(original.slice(0, 3));
  });
});

it("should preserve the exact payload and key after a lost response, even if data has changed or the confirmation has expired", async () => {
  const check = await confirmation();
  vi.mocked(sendGazetteSelection).mockRejectedValueOnce(new GazetteOutcomeUnknownError());
  const lost = await render({ journey: check.journey, action: "send", confirmed: "yes" });
  expect(lost.res.status).toHaveBeenCalledWith(503);
  expect(lost.markup).toContain("Check request status");
  expect(lost.markup).not.toContain('value="send"');
  expect(lost.markup).not.toContain('value="back"');
  const original = vi.mocked(sendGazetteSelection).mock.calls[0];
  vi.mocked(gazetteReviewsCurrent).mockClear().mockResolvedValue(false);
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 3 * 60 * 60_000);
  try {
    await render({ journey: lost.journey, action: "check" });
  } finally {
    clock.mockRestore();
  }
  expect(sendGazetteSelection).toHaveBeenLastCalledWith(...original);
  expect(gazetteReviewsCurrent).not.toHaveBeenCalled();
});

it("should use the same key after back navigation and a fresh preview, preventing an old form from creating a second identity", async () => {
  const check = await confirmation();
  const back = await render({ journey: check.journey, action: "back" });
  vi.mocked(previewGazetteSelection).mockResolvedValue({ ...PREVIEW, selectionFingerprint: "new-fingerprint" });
  const refreshed = await render({ journey: back.journey, action: "preview", caseIds: ID });
  expect(refreshed.model?.confirmation.key).toBe(check.model?.confirmation.key);
  expect(refreshed.model?.confirmation.selectionFingerprint).toBe("new-fingerprint");
  const other = await confirmation();
  expect(other.model?.confirmation.key).not.toBe(check.model?.confirmation.key);
});

it("should invalidate a checklist changed during review and reject stale reviews before preview or sending", async () => {
  const list = await render();
  const review = await render({ journey: list.journey, action: `review:${ID}` });
  vi.mocked(findDeedPoll).mockResolvedValue({ ...RECORD, newSurname: "Changed" } as never);
  const changed = await render({ journey: review.journey, action: "save", checks: [...GAZETTE_CHECKS] });
  expect(changed.markup).toContain("has changed since it was reviewed");
  expect(changed.model?.phase).toBe("review");
  expect(changed.markup).not.toMatch(/value="signOff"[^>]*checked/s);
  const check = await confirmation();
  vi.mocked(gazetteReviewsCurrent).mockResolvedValue(false);
  const stale = await render({ journey: check.journey, action: "send", confirmed: "yes" });
  expect(stale.markup).toContain("has changed since it was reviewed");
  expect(stale.markup).not.toContain('value="send"');
  expect(sendGazetteSelection).not.toHaveBeenCalled();
  const complete = await reviewed();
  await render({ journey: complete.journey, action: "preview", caseIds: ID });
  expect(previewGazetteSelection).toHaveBeenCalledTimes(1);
});

it.each([
  "RECIPIENT_NOT_CONFIGURED",
  "RECIPIENT_CHANGED",
  "SELECTION_CHANGED",
  "CASE_NOT_READY",
  "CASE_TYPE_UNSUPPORTED",
  "CASE_RESERVED",
  "REQUEST_KEY_REUSED",
  "CONFIRMATION_EXPIRED",
  "GAZETTE_UNAVAILABLE"
] as const)("should show localised %s and never silently retry", async (code) => {
  const check = await confirmation();
  vi.mocked(sendGazetteSelection).mockRejectedValue(new GazetteRefusalError({ kind: "gazette-refusal", code, conflicts: [] }));
  const result = await render({ journey: check.journey, action: "send", confirmed: "yes" });
  expect(result.markup).not.toContain('value="send"');
  expect(result.markup).not.toContain('value="check"');
  expect(result.markup.includes('value="again"')).toBe(code !== "REQUEST_KEY_REUSED");
  expect(sendGazetteSelection).toHaveBeenCalledTimes(1);
  expect(result.markup).toContain("/deed-polls/gazette/requests");
});

it("should preserve off-page selections when navigating and reviewing another application", async () => {
  const list = await reviewed();
  vi.mocked(findGazetteReadyCases).mockResolvedValue({ cases: [], page: 2, size: 25, total: 26, totalPages: 2 } as never);
  const next = await render({ journey: list.journey, action: "page:2", caseIds: ID });
  expect(next.model?.offPage).toEqual([ID]);
  expect(next.markup).toContain('name="caseIds" value="case-1"');
  expect(findGazetteReadyCases).toHaveBeenLastCalledWith({ page: 2 }, { accessToken: "token" });
});

it("should reject copied session state or a direct send without valid confirmation", async () => {
  const check = await confirmation();
  const wrongSession = await render({ journey: check.journey, action: "send", confirmed: "yes" }, "en", "other-session");
  expect(wrongSession.markup).toContain("This review form is no longer valid");
  const missing = await render({ action: "send", confirmed: "yes" });
  expect(missing.markup).not.toContain('value="send"');
  expect(sendGazetteSelection).not.toHaveBeenCalled();
});

it("should render Welsh checklist and confirmation copy and escape names and preview references", async () => {
  vi.mocked(findDeedPoll).mockResolvedValue({ ...RECORD, oldForename: "<b>Former</b>" } as never);
  const list = await render(undefined, "cy");
  const review = await render({ journey: list.journey, action: `review:${ID}` }, "cy");
  expect(review.markup).toContain("Cwblhau rhestr wirio’r cais");
  expect(review.markup).toContain("&lt;b&gt;Former&lt;/b&gt;");
  vi.mocked(previewGazetteSelection).mockResolvedValue({ ...PREVIEW, cases: [{ caseId: ID, referenceNumber: "<script>reference</script>" }] });
  const complete = await render({ journey: review.journey, action: "save", checks: [...GAZETTE_CHECKS] }, "cy");
  const check = await render({ journey: complete.journey, action: "preview", caseIds: ID }, "cy");
  expect(check.markup).toContain("Cadarnhau ac anfon yr e-bost");
  expect(check.markup).toContain("&lt;script&gt;reference&lt;/script&gt;");
  expect(check.markup).not.toContain("<script>reference");
});

it.each([
  {
    locale: "en",
    selection: "Review applications for the London Gazette",
    review: "Complete the application checklist",
    confirmation: "Check the Gazette email"
  },
  {
    locale: "cy",
    selection: "Adolygu ceisiadau ar gyfer y London Gazette",
    review: "Cwblhau rhestr wirio’r cais",
    confirmation: "Gwirio e-bost y Gazette"
  }
])("should preserve headings, error targets and status throughout the $locale journey", async ({ locale, selection, review, confirmation }) => {
  const list = await render(undefined, locale);
  const empty = await render({ journey: list.journey, action: "preview" }, locale);
  const checklist = await render({ journey: list.journey, action: `review:${ID}` }, locale);
  const incomplete = await render({ journey: checklist.journey, action: "save" }, locale);
  const complete = await render({ journey: checklist.journey, action: "save", checks: [...GAZETTE_CHECKS] }, locale);
  const check = await render({ journey: complete.journey, action: "preview", caseIds: ID }, locale);
  const unconfirmed = await render({ journey: check.journey, action: "send" }, locale);
  vi.mocked(sendGazetteSelection).mockRejectedValueOnce(new GazetteOutcomeUnknownError());
  const recovery = await render({ journey: check.journey, action: "send", confirmed: "yes" }, locale);
  vi.mocked(sendGazetteSelection).mockRejectedValueOnce(new GazetteRefusalError({ kind: "gazette-refusal", code: "CASE_NOT_READY", conflicts: [] }));
  const refused = await render({ journey: recovery.journey, action: "check" }, locale);
  const invalid = await render({ action: "send" }, locale);
  vi.mocked(previewGazetteSelection).mockRejectedValueOnce(new Error("Unavailable"));
  const unavailable = await render({ journey: complete.journey, action: "preview", caseIds: ID }, locale);

  const pages = [
    { result: list, phase: "select", heading: selection, errorId: "selection", status: 200 },
    { result: empty, phase: "select", heading: selection, errorId: "selection", status: 400 },
    { result: checklist, phase: "review", heading: review, errorId: "checks", status: 200 },
    { result: incomplete, phase: "review", heading: review, errorId: "checks", status: 400 },
    { result: check, phase: "confirm", heading: confirmation, errorId: "confirmed", status: 200 },
    { result: unconfirmed, phase: "confirm", heading: confirmation, errorId: "confirmed", status: 400 },
    { result: recovery, phase: "recover", heading: confirmation, errorId: "selection", status: 503 },
    { result: refused, phase: "refused", heading: selection, errorId: "selection", status: 400 },
    { result: invalid, phase: undefined, heading: selection, errorId: "selection", status: 400 },
    { result: unavailable, phase: undefined, heading: selection, errorId: "selection", status: 503 }
  ];
  for (const { result, phase, heading, errorId, status } of pages) {
    expect(result.model).toMatchObject({ phase, title: heading, heading, errorId });
    expect(result.res.status).toHaveBeenCalledWith(status);
    expect(result.markup).toContain(`<h1 class="govuk-heading-xl">${heading}</h1>`);
    if (status === 200) expect(result.model?.errorList).toEqual([]);
    else expect(result.model?.errorList).toEqual([{ text: expect.any(String), href: `#${errorId}` }]);
  }
});

// Each extracted step must preserve the distinction between loss of access, a known refusal and an outage.
it.each(
  (["review", "save", "preview", "send"] as const).flatMap((action) =>
    (["forbidden", "unauthorized", "refused", "unavailable"] as const).map((failure) => ({ action, failure }))
  )
)("should preserve a $failure failure during $action", async ({ action, failure }) => {
  const body = await actionBody(action);
  const error =
    failure === "forbidden"
      ? new ForbiddenError("Forbidden")
      : failure === "unauthorized"
        ? new UnauthorizedError("Unauthorized")
        : failure === "refused"
          ? new GazetteRefusalError({ kind: "gazette-refusal", code: "CASE_NOT_READY", conflicts: [] })
          : new Error("Unavailable");
  vi.mocked(findDeedPoll).mockRejectedValue(error);
  vi.mocked(gazetteReviewsCurrent).mockRejectedValue(error);

  if (failure === "forbidden" || failure === "unauthorized") {
    await expect(render(body)).rejects.toBe(error);
  } else {
    const result = await render(body);
    expect(result.res.status).toHaveBeenCalledWith(failure === "refused" ? 400 : 503);
    expect(result.model?.phase).toBe(failure === "refused" ? "refused" : undefined);
    expect(result.markup).toContain(failure === "refused" ? "An application is no longer ready" : "The applications could not be checked");
  }
  expect(sendGazetteSelection).not.toHaveBeenCalled();
});

it("should retain the posted selection when preview is refused and selection is reopened", async () => {
  const list = await reviewed();
  vi.mocked(previewGazetteSelection).mockRejectedValue(new GazetteRefusalError({ kind: "gazette-refusal", code: "RECIPIENT_NOT_CONFIGURED", conflicts: [] }));

  const refused = await render({ journey: list.journey, action: "preview", caseIds: ID });
  const reopened = await render({ journey: refused.journey, action: "again" });

  expect(refused.model?.phase).toBe("refused");
  expect(reopened.model?.selectedCount).toBe("1 applications selected");
  expect(reopened.model?.cases[0].isSelected).toBe(true);
  expect(previewGazetteSelection).toHaveBeenCalledTimes(1);
  expect(sendGazetteSelection).not.toHaveBeenCalled();
});

it("should discard reviews if the application changes while preview is being obtained", async () => {
  const list = await reviewed();
  vi.mocked(gazetteReviewsCurrent).mockResolvedValueOnce(true).mockResolvedValueOnce(false);

  const result = await render({ journey: list.journey, action: "preview", caseIds: ID });

  expect(gazetteReviewsCurrent).toHaveBeenCalledTimes(2);
  expect(previewGazetteSelection).toHaveBeenCalledTimes(1);
  expect(result.model?.phase).toBe("select");
  expect(result.model?.selectedCount).toBe("0 applications selected");
  expect(result.model?.cases[0].isReviewed).toBe(false);
  expect(result.model?.confirmation).toBeUndefined();
  expect(result.markup).toContain("has changed since it was reviewed");
  expect(sendGazetteSelection).not.toHaveBeenCalled();
});

it("should propagate a selection-render failure without classifying it as a review refusal", async () => {
  const body = await actionBody("save");
  const error = new GazetteRefusalError({ kind: "gazette-refusal", code: "CASE_NOT_READY", conflicts: [] });
  vi.mocked(findGazetteReadyCases).mockRejectedValue(error);

  await expect(render(body)).rejects.toBe(error);

  expect(console.error).not.toHaveBeenCalled();
  expect(sendGazetteSelection).not.toHaveBeenCalled();
});

it.each([
  { action: "page:2", setup: "preview" },
  { action: "preview", setup: "preview" },
  { action: "back", setup: "send" },
  { action: "save", setup: "save" }
] as const)("should propagate a rendering failure during $action without handling it twice", async ({ action, setup }) => {
  const body = { ...(await actionBody(setup)), action };
  const req = Object.assign(pageRequest({ body, teamLeader: true, accessToken: "token" }), { sessionID: "admin-session" });
  const res = pageResponse();
  const error = new GazetteRefusalError({ kind: "gazette-refusal", code: "CASE_NOT_READY", conflicts: [] });
  res.render.mockImplementationOnce(() => {
    throw error;
  });
  vi.mocked(console.error).mockClear();

  await expect(POST(req, res)).rejects.toBe(error);

  expect(res.render).toHaveBeenCalledTimes(1);
  expect(console.error).not.toHaveBeenCalled();
  expect(sendGazetteSelection).not.toHaveBeenCalled();
});

async function actionBody(action: "review" | "save" | "preview" | "send"): Promise<Record<string, unknown>> {
  if (action === "review") {
    const list = await render();
    return { journey: list.journey, action: `review:${ID}` };
  }
  if (action === "save") {
    const list = await render();
    const review = await render({ journey: list.journey, action: `review:${ID}` });
    return { journey: review.journey, action, checks: [...GAZETTE_CHECKS] };
  }
  if (action === "preview") {
    const list = await reviewed();
    return { journey: list.journey, action, caseIds: ID };
  }
  const check = await confirmation();
  return { journey: check.journey, action, confirmed: "yes" };
}
