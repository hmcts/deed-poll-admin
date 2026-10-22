---
paths: [libs/**/src/**/*.ts, src/pages/**/*.ts]
---

# Domain Layer Rules

**There is no database and no JSON API in this repo.** Case data lives in
[`hmcts/deed-poll-api`](https://github.com/hmcts/deed-poll-api); this app renders pages against it.
`apps/api`, `apps/postgres`, `libs/postgres-prisma` and the Prisma schema were deleted — see
`docs/plans/completed/02-dal-cutover-to-api.md`. If you are about to write a query, a migration, a `prisma.*` call
or an Express JSON route, stop: the operation either exists in `libs/deed-poll-api-client` or it is a
change in api's repo first.

## The three layers, and what each is allowed to know

| Layer | Where | Knows about |
|---|---|---|
| Adapter | `libs/deed-poll-api-client/src/api/` | HTTP, the wire shape, `openapi.json`. Returns `ApiResult<T>` and **never throws** |
| Domain | `libs/deed-poll/src/` | Cases, notes, witnesses, documents, the field rules, the view models. Reaches api only through `callApi` |
| Pages | `src/pages/` | Requests, sessions, Nunjucks. Calls domain functions, renders their errors |

Nothing above the adapter imports the wire types or the mock — they are deliberately not exported from
the package index. Nothing outside `libs/deed-poll/src/api/deed-poll-api.ts` builds an `ApiConfig` or
branches on an `ApiResult`, and no page sees a base URL.

## Service Layer Pattern

A service function takes the ids it needs, an **already-validated** DTO, and a `Caller`. It returns domain
data or throws a domain error, and it is usually one line: the page handler validates with
`schema.safeParse` so it can re-render the form with the errors, and the service's parameter type is the
schema's inferred type.

```typescript
// libs/deed-poll/src/notes/service.ts
import { getNote, type Note, patchNote } from "@hmcts/deed-poll-api-client";
import { type Caller, callApi } from "../api/deed-poll-api.js";
import type { UpdateNoteInput } from "./schemas.js";

export function findNote(deedPollId: string, id: string, caller: Caller): Promise<Note> {
  return callApi(caller, (config) => getNote(deedPollId, id, config));
}

export function updateNote(deedPollId: string, id: string, dto: UpdateNoteInput, caller: Caller): Promise<Note> {
  return callApi(caller, (config) => patchNote(deedPollId, id, dto.note, config));
}
```

### Rules

- **`Caller` is `{ accessToken }` and nothing else.** api authenticates every call and derives both the
  audit author and the admin status from the token. Sending a user name or an `isAdmin` flag alongside it
  would assert an identity api never verified. The app reads the token from the session
  (`callerFromRequest`)
- **A required request header is the one thing beside the ids, the DTO and the `Caller` a service may take — and
  it is never generated here.** `sendCaseEmail` takes the compose journey's `idempotencyKey` and passes it to the
  adapter, which sets api's required `Idempotency-Key`. The key identifies the *caller's journey*, so a service
  that minted one would make every retry a new send, which is the behaviour the header exists to prevent. It is
  not part of the DTO either: both email write bodies set `additionalProperties: false`, so a key in the body is a
  400 naming it. Do not fold one into the DTO and do not default one
- **Never re-check what api has already answered.** A child entity is nested under its case — api answers
  404 for a note that is not under the case in the path, and witnesses and documents arrive *inside*
  `GET /caseworker/cases/{id}`. A scoping pre-read is a second round trip for a fact the first call
  already carried
- **Do not recompute what api publishes.** `daysReceivedToEnroled`, `daysReceivedToReturned` and the
  reference number are api's. A second implementation of a counter or a derived field is a correctness
  bug, not duplication
- **Pure functions preferred**, no HTTP concerns, one service per domain concept
- **The local rule matrices stay** — `deed-poll-validation.ts`, `case-state.ts`, `upload-policy.ts`. api
  enforces the same rules; a rule applied at both ends is pinned at both ends, and the conformance
  harness pins these against the Dataverse exports
- **Case fields are two lists, and picking the wrong one fails silently.** `form-fields.ts` publishes
  `CASE_FIELD_TABS` — every field the app knows how to format or query — and `FORM_TABS`, that list filtered
  to the tabs a caseworker navigates and edits. `FIELD_BY_NAME` and `query-fields.ts` read the catalogue;
  `EDITABLE_FIELDS`, `detail-view.ts` and `edit-view.ts` read the form. That split is what lets a **retired**
  field (the legacy `referral` tab) still format with its own label and still resolve a saved query while
  nothing can write to it. Deriving everything from one list is the trap: delete a tab and its fields quietly
  leave formatting and query metadata too, with no failure anywhere. `form-fields.test.ts` pins each
  derivation to the right list
- **Option sets are built, never restated.** `deed-poll/enums/option-sets.ts` turns the client's exported
  member ARRAYS (`DEED_POLL_STATE`, `URGENCY`, …) into `{ Member: "Member" }` objects, so the rules can go on
  reading `DeedPollState.Returned` and a member added at api's end reaches the Dynamics label maps without an
  edit here. Add a new option set by importing its array and calling `members()`, not by typing the members
  out. The local type names deliberately differ from api's — `DeedPollType` is an alias of `CaseType` —
  because they keep the Dynamics vocabulary the rules were written in

## Reaching api

`callApi` is the only door. It resolves the config from `DEED_POLL_API_URL` (defaulting to the mock at
`http://localhost:3200`) and turns a classified failure into the error the pages already render:

| `ApiError.kind` | Becomes | Renders as |
|---|---|---|
| `not-found` | `NotFoundError` | 404 page |
| `validation` | `InvalidInputError`, carrying api's field errors | the page handler catches it and re-renders its form with the errors against the fields. Reaching `domainErrorHandler` means a handler did not, which is a bug in that handler |
| `forbidden` | `ForbiddenError` | 403, on the 404 template — a caseworker learns no more from it than that the case is not theirs. Also raised **locally** by `requireJudicial` for an authenticated non-judge, which is the second reason for the 404 view: it says nothing about what was refused, and the gate fires before anything is looked up, so a guessed judicial URL never reveals whether that resource exists. The 403 **status** still tells the caller that `/judicial/**` exists and is closed to them — deliberate, and pinned by the e2e specs (review finding R14, `docs/plans/completed/20261021-r10-r14-error-disclosure.md`). `src/errors.ts` logs the message before rendering, because that render is the end of the chain |
| `unauthorized` | `UnauthorizedError` | **401**: the session is ended and `errors/401` renders a *Sign in again* link. **Never a redirect** — a redirect to `/login` from an error handler loops when IDAM's session silently re-issues a token api refuses again. `refreshMiddleware` still ends an expired session before it gets this far. Was an unmapped 500 until 2026-10-07, which stranded AAT testers whose persona user had been swept |
| `conflict` | `ConflictError` | the page handler's own message, not the 500 page. api answers 409 for a referral raised while the case already has a live one, for a withdraw of anything but `Open`/`Claimed` (**`Decided` is not withdrawable and is not terminal either** — api's `canBeWithdrawn()` is a second predicate beside `isTerminal()`, and narrowing the latter would let a case raise a second referral beside a decided one), and for a closure of anything but `Decided` — states two caseworkers can reach between them. So `referrals/new.ts` re-renders at 409 with a link to the live referral, `referrals/[referralId]/withdraw.ts` redirects to the referral view with `?withdraw=conflict`, and `referrals/[referralId]/close.ts` with `?close=conflict`; the referral page then picks the sentence from the **fresh** read, because each 409 has more than one meaning. An **email send** has two of its own — the case is in no state to send this email, or this journey's `Idempotency-Key` was already used on it for *different* content — and `emails/[template]/send.ts` renders api's own sentence on the check page for both, because the two are distinguishable only by prose. Reaching `domainErrorHandler` means a handler did not catch it, which is a bug in that handler |
| `rate-limited` (429) | `TooManyRequestsError`, carrying `retryAfterSeconds` from `Retry-After` (`null` when absent or not whole seconds) | **429** on `errors/429`, with `Retry-After` when known, saying how many minutes to wait. **Except on Gazette writes**: `callGazetteApi` treats a 429 as an unknown outcome, because only a published Gazette refusal proves nothing was admitted |
| `unavailable`, `timeout`, `invalid-response`, `unknown` | plain `Error` | 500 page, the same as a database outage did before |

Adding an operation: it must exist in `openapi.json` first. Add it to `client.ts`, let `contract.test.ts`
pin it, add it to the mock, then call it from a service. An operation api does not have is not something
to work around here — `apps/api`'s routes for the nine missing writes were deleted because a route that
can only fail is worse than a 404.

## Input Validation

Zod schemas, colocated with the domain they validate (`deed-poll/schemas.ts`, `notes/schemas.ts`,
`documents/schemas.ts`), built from the shared primitives in `schema-primitives.ts`.

- **A schema is a shape and format guard, not a business rule.** Type-conditional mandatoriness lives in
  `deed-poll-validation.ts`, which knows which fields a given Type demands
- **Parse in the page handler, with `safeParse`.** A form has errors to render against its fields; a
  service that threw on bad input would give the handler nothing to render. The service's DTO type is the
  schema's inferred type, so an unvalidated object does not type-check as one
- **Reject early where the error is better.** `upload-policy.ts` refuses an over-large file before it goes
  on the wire, and `schema-primitives.ts` rejects `null` where api would answer 400 — a local message
  beats a round trip to learn the same thing
- **Do not accept fields api allocates.** `referencenumber` and `displayReference` are absent from the
  create schema on purpose

## Error Handling

Throw the domain errors in `libs/deed-poll/src/errors.ts`; never throw an HTTP concern from a library.
`src/errors.ts` maps them to status codes and pages — that mapping is the only place that knows
about transport.

```typescript
// libs/[module]/src/errors.ts — framework-free, one vocabulary of failure
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}
```

## Middleware Pattern

Factory functions returning a `RequestHandler`, mounted once in `src/app.ts`:

```typescript
export function requireAuth(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => { /* … */ };
}
```

`requireAuth` is the pattern to copy and the rule not to invert: it is mounted **globally with an
allowlist**, so a new page is protected unless it asks to be public. A denylist makes a forgotten page
silently anonymous. Read the docblock in `src/auth/require-auth.ts` before changing either it or
`plain-http.ts`.

A **role** gate is the other shape, and it is deliberately not global. `requireRole(role)` / `requireJudicial()`
(`src/auth/require-role.ts`) is mounted on an area prefix in `app.ts` — `app.use("/judicial", requireJudicial())`
— and **after** `requireAuth`, so an anonymous visitor is sent to log in rather than refused. Area-mounted rather
than per-page for the same reason `requireAuth` is global: a page added under that prefix is gated by where it
lives, and `src/app.test.ts` reads `src/pages/judicial/` off the filesystem and fails if the mount stops covering
one. It refuses with `next(new ForbiddenError(...))` and renders nothing, so the status and the disclosure
decision both stay in `src/errors.ts`.

`requireSameOrigin()` (`src/auth/same-origin.ts`) is the third shape and is global like `requireAuth`, mounted
**before** it: a `POST`/`PUT`/`PATCH`/`DELETE` must come from one of this app's own pages. It exists because
**`SameSite=Lax` is not CSRF protection in this estate** — `SameSite` is decided on the registrable domain, so
any page on any `*.platform.hmcts.net` host posts here with the session cookie attached, and an XSS in a sibling
service is otherwise a way to make a signed-in caseworker's browser write through this app.

It gates on **`Sec-Fetch-Site`, not `Origin`**, and that is measured rather than chosen: `configureHelmet()`
sends `Referrer-Policy: no-referrer`, and under that Chromium sends `Origin: null` for this app's own form posts
*and* for a sibling's forged one — identical values, so an `Origin` gate either refuses every form in the service
or admits every sibling. The measurement table is in the file's docblock; **do not "simplify" this to an `Origin`
check**, and if you are tempted, re-run the probe first. A request carrying neither header is allowed (a
non-browser client, which the e2e suite has), which is the one way this differs from `requireAuth`'s fail-closed
polarity and is argued at the call site. It refuses with `ForbiddenError` like the role gate. **Do not add a
state-changing `GET`** — the gate does not cover one, and covering one would hide the real bug.

## File Organization

```
libs/deed-poll/src/
├── index.ts                    # Public exports
├── api/deed-poll-api.ts        # The only place that knows where api is
├── errors.ts                   # Domain errors
└── notes/                      # One directory per domain concept
    ├── service.ts              # Adapter calls
    ├── service.test.ts
    └── schemas.ts

src/pages/deed-polls/          # Page handlers — GET/POST exports, discovered by simple-router
```

Group by feature, never by type. No `utils/`, no `models/`, no `types.ts`.

## Testing

See `.claude/rules/testing.md`. In short: mock `@hmcts/deed-poll-api-client` at the domain layer, spreading
the original module so the enum arrays survive; test the adapter itself against the in-memory mock, not
against a stubbed `fetch`.

## Anti-Patterns to Avoid

- ❌ A `prisma.*` call, a migration, a connection string, or a second data access layer of any kind
- ❌ Importing `wire.ts` or the mock outside `libs/deed-poll-api-client`
- ❌ Reading `DEED_POLL_API_URL` anywhere but `libs/deed-poll/src/api/deed-poll-api.ts`
- ❌ Passing a user name or an admin flag to api alongside the token
- ❌ A pre-read whose only purpose is to check scoping api already enforces
- ❌ Recomputing a value api publishes
- ❌ Catching an `ApiResult` failure and rendering it as the caseworker's mistake
- ❌ Business logic in a page handler, or HTTP concerns in a library
- ❌ Logging tokens, or exposing api's internal error text to a caseworker
