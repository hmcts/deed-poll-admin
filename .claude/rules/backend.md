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
| `forbidden` | `ForbiddenError` | 403, on the 404 template — a caseworker learns no more from it than that the case is not theirs |
| `unauthorized` | `UnauthorizedError` | **500**, deliberately unmapped. `requireAuth` and `refreshMiddleware` own re-authentication; a redirect to `/login` from an error handler loops when the session is valid and only api rejected the token |
| `conflict` | `ConflictError` | 500. Nothing in the UI can currently provoke one — the document-type delete that could went with `apps/api` — so it is a fault rather than a state to render |
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
