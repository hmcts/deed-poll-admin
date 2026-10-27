/**
 * The two Fortify-reported case redirects, over HTTP — `14866335BEE273FA5B5E940E5044A8BA` (edit) and
 * `250FCCE3CA8D832C8F3F69CF2AE609E4` (confirmation). See `docs/plans/completed/20261019-case-id-redirect-encoding.md`, Task 6.
 *
 * The page tests beside each handler pin the same behaviour against response doubles. This file sends
 * percent-encoded request paths through a real Express app, so Express's own decoding of the route parameter and
 * the `Location` header Node actually writes are both under test. Neither reported redirect could leave this
 * origin — both have a fixed `/deed-polls/` prefix — so this is internal URL-construction hardening: the
 * assertions are that the case id stays one path segment, not merely that the origin holds, because a same-origin
 * check alone passed before the fix.
 *
 * Domain I/O is mocked and there is no session store, authentication or CSRF gate: those are `app.ts`'s and are
 * pinned there. A dot-only id is refused at the handler boundary, not over HTTP: a URL-parsing client resolves
 * `.`, `..` and their `%2E` spellings as dot segments before sending, so such a request never reaches a case route.
 */
import {
  ConflictError,
  findDeedPoll,
  findReferral,
  InvalidInputError,
  LEGACY_REFERRAL_TAB,
  NotFoundError,
  recordConfirmation,
  updateDeedPoll
} from "@hmcts/deed-poll";
import express, { type NextFunction, type Request, type Response } from "express";
import supertest from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pageRequest, pageResponse } from "./express-doubles.js";
import { GET as editGet, POST as editPost } from "./pages/deed-polls/[id]/edit/[tab].js";
import { GET as confirmationGet, POST as confirmationPost } from "./pages/deed-polls/[id]/referrals/[referralId]/confirmation.js";

vi.mock("@hmcts/deed-poll", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hmcts/deed-poll")>()),
  findDeedPoll: vi.fn(),
  findReferral: vi.fn(),
  recordConfirmation: vi.fn(),
  updateDeedPoll: vi.fn()
}));

const ORIGIN = "https://deed-poll-admin.example";
const CALLER = { accessToken: "session-token" };
const SUBGRID_TAB = "notes";

/** Request-path form, Express-decoded form, and the `Location` path the redirect must carry. */
const PAYLOADS = [
  { name: "slash, query and fragment delimiters", sent: "a%2Fb%3Fc%23d", raw: "a/b?c#d", location: "/deed-polls/a%2Fb%3Fc%23d" },
  { name: "a backslash", sent: "a%5Cb", raw: "a\\b", location: "/deed-polls/a%5Cb" },
  { name: "protocol-relative URL text", sent: "%2F%2Fevil.example", raw: "//evil.example", location: "/deed-polls/%2F%2Fevil.example" },
  { name: "absolute URL text", sent: "https%3A%2F%2Fevil.example", raw: "https://evil.example", location: "/deed-polls/https%3A%2F%2Fevil.example" },
  { name: "traversal containing slashes", sent: "..%2F..%2Fadmin", raw: "../../admin", location: "/deed-polls/..%2F..%2Fadmin" },
  { name: "CR and LF", sent: "a%0D%0ALocation%3A%20x", raw: "a\r\nLocation: x", location: "/deed-polls/a%0D%0ALocation%3A%20x" },
  // A literal percent sequence arrives decoded once and is encoded once, so it stays literal rather than being
  // decoded a second time into the delimiter it spells.
  { name: "a literal %2F", sent: "a%252Fb", raw: "a%2Fb", location: "/deed-polls/a%252Fb" },
  { name: "a literal %2e%2e", sent: "%252e%252e", raw: "%2e%2e", location: "/deed-polls/%252e%252e" }
] as const;

const AWAITING = {
  id: "ref-1",
  state: "Decided",
  reasons: ["Minor"],
  notes: null,
  urgency: "Normal",
  urgencyReason: null,
  migrated: false,
  claimedBy: "A Judge",
  claimedAt: new Date("2026-05-14T09:00:00Z"),
  decision: "Approved",
  directionsText: null,
  changesToStandardPublication: false,
  decisionDate: new Date("2026-05-15T10:30:00Z"),
  decidedBy: "A Judge",
  createdBy: "A Caseworker",
  modifiedBy: "A Caseworker",
  createdOn: new Date("2026-05-13T08:44:00Z"),
  modifiedOn: new Date("2026-05-15T10:30:00Z"),
  confirmationRequestedAt: new Date("2026-05-20T08:00:00Z"),
  confirmationOutcome: null,
  confirmationReceivedAt: null,
  confirmationRecordedBy: null
};

/** The same referral once answered, which is what sends the confirmation guard to the referral. */
const RECORDED = {
  ...AWAITING,
  confirmationOutcome: "Confirmed",
  confirmationReceivedAt: new Date("2026-05-22T09:30:00Z"),
  confirmationRecordedBy: "A Caseworker"
};

const found = { id: "case", displayReference: "KBDP2026-00001", notes: [], witnesses: [], documents: [] };

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use((req: Request, _res: Response, next: NextFunction) => {
  (req as unknown as { session: unknown }).session = { deedPoll: CALLER };
  next();
});
app.get("/deed-polls/:id/edit/:tab", editGet);
app.post("/deed-polls/:id/edit/:tab", editPost);
app.get("/deed-polls/:id/referrals/:referralId/confirmation", confirmationGet);
app.post("/deed-polls/:id/referrals/:referralId/confirmation", confirmationPost);
app.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof NotFoundError) {
    res.status(404).send("Page not found");
    return;
  }
  next(err);
});

describe("case redirects over HTTP", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findDeedPoll).mockResolvedValue(found as never);
    vi.mocked(findReferral).mockResolvedValue(AWAITING as never);
    vi.mocked(recordConfirmation).mockResolvedValue(RECORDED as never);
    vi.mocked(updateDeedPoll).mockResolvedValue(found as never);
  });

  describe("the payloads", () => {
    // Without this the hardening would be unproven: a payload whose raw interpolation already resolved to the
    // intended segment would pass every assertion below on the baseline too.
    it.each(PAYLOADS)("should move a raw interpolation of $name off the case's segment, which is what the fix prevents", ({ raw, location }) => {
      const resolvedRaw = new URL(`/deed-polls/${raw}#referrals`, ORIGIN);
      const resolvedFixed = new URL(`${location}#referrals`, ORIGIN);

      expect(`${resolvedRaw.pathname}${resolvedRaw.search}${resolvedRaw.hash}`).not.toBe(
        `${resolvedFixed.pathname}${resolvedFixed.search}${resolvedFixed.hash}`
      );
    });
  });

  describe("edit (Fortify 14866335)", () => {
    it.each(PAYLOADS)("should send a bookmarked referral tab under $name to that one case's referrals panel", async ({ sent, location }) => {
      const answer = await supertest(app).get(`/deed-polls/${sent}/edit/${LEGACY_REFERRAL_TAB.id}`);

      expect(answer.status).toBe(302);
      expectOneSegment(answer.headers.location, location, "", "#referrals");
    });

    it.each(PAYLOADS)("should save under the raw id carrying $name and redirect to the encoded case at the tab", async ({ sent, raw, location }) => {
      const answer = await supertest(app).post(`/deed-polls/${sent}/edit/${SUBGRID_TAB}`).type("form").send({});

      expect(answer.status).toBe(302);
      expectOneSegment(answer.headers.location, location, "", `#${SUBGRID_TAB}`);
      expect(updateDeedPoll).toHaveBeenCalledTimes(1);
      expect(updateDeedPoll).toHaveBeenCalledWith(raw, expect.anything(), CALLER);
    });

    it("should keep a normal id's destination exactly as it was", async () => {
      const answer = await supertest(app).post(`/deed-polls/case-1/edit/${SUBGRID_TAB}`).type("form").send({});

      expect(answer.headers.location).toBe(`/deed-polls/case-1#${SUBGRID_TAB}`);
    });
  });

  describe("confirmation (Fortify 250FCCE3)", () => {
    const referral = (location: string) => `${location}/referrals/ref%2F1`;

    it.each(PAYLOADS)("should send the form's guard under $name back to that one case's referral", async ({ sent, raw, location }) => {
      vi.mocked(findReferral).mockResolvedValue(RECORDED as never);

      const answer = await supertest(app).get(`/deed-polls/${sent}/referrals/ref%2F1/confirmation`);

      expect(answer.status).toBe(302);
      expectOneSegment(answer.headers.location, referral(location), "", "");
      expect(findReferral).toHaveBeenCalledWith(raw, "ref/1", CALLER);
    });

    it.each(PAYLOADS)("should record under the raw ids carrying $name and redirect to the encoded referral", async ({ sent, raw, location }) => {
      const answer = await supertest(app).post(`/deed-polls/${sent}/referrals/ref%2F1/confirmation`).type("form").send({ outcome: "Confirmed" });

      expect(answer.status).toBe(302);
      expectOneSegment(answer.headers.location, referral(location), "?confirmation=recorded", "");
      expect(recordConfirmation).toHaveBeenCalledTimes(1);
      expect(recordConfirmation).toHaveBeenCalledWith(raw, "ref/1", { outcome: "Confirmed" }, CALLER);
    });

    it.each(PAYLOADS)("should redirect a conflict under $name to the encoded referral", async ({ sent, location }) => {
      vi.mocked(recordConfirmation).mockRejectedValue(new ConflictError("already has a confirmation outcome"));

      const answer = await supertest(app).post(`/deed-polls/${sent}/referrals/ref%2F1/confirmation`).type("form").send({ outcome: "Confirmed" });

      expect(answer.status).toBe(302);
      expectOneSegment(answer.headers.location, referral(location), "?confirmation=conflict", "");
    });

    // The reported sink: `awaiting()`'s redirect, reached from POST through `rerender()` when the fresh read finds
    // the referral no longer waiting for an answer.
    it.each(PAYLOADS)("should keep $name in one segment when an invalid body's re-render finds the referral answered", async ({ sent, location }) => {
      vi.mocked(findReferral).mockResolvedValue(RECORDED as never);

      const answer = await supertest(app).post(`/deed-polls/${sent}/referrals/ref%2F1/confirmation`).type("form").send({});

      expect(answer.status).toBe(302);
      expectOneSegment(answer.headers.location, referral(location), "", "");
      expect(recordConfirmation).not.toHaveBeenCalled();
    });

    it.each(PAYLOADS)("should keep $name in one segment when api's rejection's re-render finds the referral answered", async ({ sent, location }) => {
      vi.mocked(recordConfirmation).mockRejectedValue(new InvalidInputError("Validation failed", [{ field: "note", message: "The note is too long" }]));
      vi.mocked(findReferral).mockResolvedValue(RECORDED as never);

      const answer = await supertest(app).post(`/deed-polls/${sent}/referrals/ref%2F1/confirmation`).type("form").send({ outcome: "Confirmed" });

      expect(answer.status).toBe(302);
      expectOneSegment(answer.headers.location, referral(location), "", "");
      expect(recordConfirmation).toHaveBeenCalledTimes(1);
    });

    it("should keep a normal id's destination exactly as it was", async () => {
      const answer = await supertest(app).post("/deed-polls/case-1/referrals/ref-1/confirmation").type("form").send({ outcome: "Confirmed" });

      expect(answer.headers.location).toBe("/deed-polls/case-1/referrals/ref-1?confirmation=recorded");
    });
  });

  describe("a dot-only case id", () => {
    // The limitation, pinned rather than papered over: the WHATWG URL parser treats `%2E` as a dot segment too, so
    // the client resolves these before sending and no case route matches. This passes on the baseline as well and
    // proves nothing about the handlers — the boundary test below is what does.
    it.each(["%2E", "%2E%2E"])("should never reach a handler with %s over HTTP, because the client resolves it as a dot segment", async (sent) => {
      const edit = await supertest(app).post(`/deed-polls/${sent}/edit/${SUBGRID_TAB}`).type("form").send({});
      const confirmation = await supertest(app).post(`/deed-polls/${sent}/referrals/ref-1/confirmation`).type("form").send({ outcome: "Confirmed" });

      expect(edit.status).toBe(404);
      expect(confirmation.status).toBe(404);
      expect(edit.headers.location).toBeUndefined();
      expect(confirmation.headers.location).toBeUndefined();
      expect(updateDeedPoll).not.toHaveBeenCalled();
      expect(recordConfirmation).not.toHaveBeenCalled();
      expect(findReferral).not.toHaveBeenCalled();
    });

    it.each(["", ".", ".."])("should refuse %j at both handlers' boundary before any read or write", async (id) => {
      const res = pageResponse();

      await expect(editPost(pageRequest({ params: { id, tab: SUBGRID_TAB }, body: {}, accessToken: CALLER.accessToken }), res)).rejects.toThrow(NotFoundError);
      await expect(confirmationPost(pageRequest({ params: { id, referralId: "ref-1" }, body: {}, accessToken: CALLER.accessToken }), res)).rejects.toThrow(
        NotFoundError
      );
      await expect(confirmationGet(pageRequest({ params: { id, referralId: "ref-1" }, accessToken: CALLER.accessToken }), res)).rejects.toThrow(NotFoundError);

      expect(updateDeedPoll).not.toHaveBeenCalled();
      expect(recordConfirmation).not.toHaveBeenCalled();
      expect(findReferral).not.toHaveBeenCalled();
      expect(res.redirect).not.toHaveBeenCalled();
    });
  });
});

/** The literal `Location`, free of header controls, resolving on this origin to one encoded case segment. */
function expectOneSegment(header: string, path: string, search: string, hash: string) {
  expect(header).toBe(`${path}${search}${hash}`);
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the controls are what is being asserted absent
  expect(header).not.toMatch(/[\u0000-\u001f\u007f]/);

  const resolved = new URL(header, ORIGIN);
  expect(resolved.origin).toBe(ORIGIN);
  expect(resolved.pathname).toBe(path);
  expect(resolved.search).toBe(search);
  expect(resolved.hash).toBe(hash);
}
