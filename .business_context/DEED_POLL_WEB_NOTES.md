# `deed-poll-web` — the citizen-facing service

Split out of [`DEED_POLL_API_PLAN.md`](DEED_POLL_API_PLAN.md) on 2026-09-04, because it had grown into
that document and did not belong there. The API plan is about re-platforming the backend; this is about
the public service that will later be built on it.

**This is not a plan.** `deed-poll-web` has not been specified, and there is nothing to plan against.
What follows is the set of decisions already taken and the constraints already discovered, recorded so
they are not rediscovered or contradicted when the project starts.

## The three applications, so the names are unambiguous

| Name | What it is | State |
|---|---|---|
| `deed-poll-admin` | **internal staff app.** Caseworkers manage applications. Express + Nunjucks, IDAM `HMCTS_ACCESS` | exists — Phases 0–6 done |
| `deed-poll-api` | **the backend.** Spring Boot, owns persistence, CCD and CDAM. Serves both frontends | to be built — see the API plan |
| `deed-poll-web` | **citizen-facing service.** Public, anonymous in release 1, takes a payment | not started |

## What the API must not preclude

Everything in this document is a requirement on `deed-poll-api`'s *shape*, not work to do now. Three
things the API plan carries so that this project does not need rework:

1. **Two endpoint namespaces from the outset** — `/caseworker/**` and, later, `/citizen/**`. Never one
   endpoint whose behaviour varies by role.
2. **No caseworker assumption in the domain layer.** A service method must not assume the caller is a
   caseworker, or that a request carries a named user at all.
3. **A system-user token path.** `deed-poll-web` submits on behalf of someone with no account, so
   something has to act for them. The API needs the capability; it does not need to be built until
   `deed-poll-web` is.

---

## Release 1 is anonymous, and that changes the design

An earlier draft of this plan designed an elaborate citizen access-control model — IDAM citizen client,
RAS case roles, `[CREATOR]`, per-audience read authorisation. **That is the portal release, not release
1.** Recorded as a correction rather than quietly deleted, because the elaborate version is what someone
will otherwise reinvent.

For release 1 the citizen is never authenticated, so there is nothing to authorise:

| Concern | Release 1 | The later portal |
|---|---|---|
| Citizen IDAM client | **not needed** | needed, separate from `HMCTS_ACCESS` |
| Citizen login / session | **none** | OIDC, as `apps/web` already does |
| Citizen case-level access (RAS, `[CREATOR]`) | **not needed** — nobody comes back | the mechanism the whole portal rests on |
| `/citizen/**` read endpoints | **none** — there is nothing to read | the bulk of the portal |
| `/citizen/**` write endpoints | **one**: submit an application | plus amend, withdraw, respond |

### What replaces citizen authentication

The citizen frontend has no user token to forward, because there is no user. Two things fill the gap,
and both are established patterns rather than inventions:

- **The citizen frontend authenticates as a service.** Its calls to `deed-poll-api` carry S2S only. So
  the citizen frontend **does** need its own S2S identity — which answers what was open question 9. Do
  not instead let `deed-poll-api` accept unauthenticated calls on `/citizen/**` and rely on network
  topology.
- **A system user creates the case.** CCD events need a user, and payments need an IDAM user JWT, so
  `deed-poll-api` obtains a system-user token. PCS does exactly this: `SYSTEM_USER("pcs-system-update",
  CRU, IDAM)` in its `UserRole` enum, `CcdRoleConfig("pcs-system-update", "PUBLIC")` in its CCD setup,
  and an `IdamTokenProvider` bean qualified `systemUpdateUserTokenProvider`. We need the equivalent
  IDAM account and CCD role — call it `deed-poll-system-update`.

**The honest consequence: an unauthenticated public endpoint creates cases and initiates payments.**
That wants rate limiting and a deliberate look at abuse before go-live. The fee is a partial gate — an
abandoned journey costs the abuser nothing but produces no completed application — but it does not stop
someone filling the database with unpaid drafts. Not solved here; flagged as
[open question 11](#open-questions-the-citizen-app-raises).

### Documents, which work out neatly

Worth noting because it looks like a problem and is not. **CDAM upload is S2S-only**, so a citizen
uploading evidence works with a service identity and no user token. **CDAM download requires a user
JWT**, so a citizen could never re-download their own document — which is exactly consistent with
having no portal. Caseworkers download with their own tokens. Nothing needs designing around.

---

## Access control, for when the portal arrives

Not release 1 work. Kept because the model is the reason one API for both audiences is safe, and
because getting it wrong later leaks another person's name-change case.

### Roles are declared, not coded

The SDK's `HasRole` model is the mechanism, and `pcs-api`'s `UserRole` enum is the worked example. Each
role carries a name, a permission set, and — crucially — **where the role comes from**:

```java
public enum UserRole implements HasRole {
    CITIZEN("citizen", CRU, IDAM),            // an IDAM role: "any citizen"
    CREATOR("[CREATOR]", CRU, RAS),           // a CCD case role: "this case, this person"
    PCS_CASE_WORKER("caseworker-pcs", Set.of(R), IDAM),
    ...
}
```

Two things to take from that:

- **`RoleType.IDAM` versus `RoleType.RAS`.** IDAM roles say what kind of user someone is. RAS roles —
  the ones in `[SQUARE_BRACKETS]` — come from AM / Role Assignment Service and say *which cases* this
  particular user may touch. **A citizen's access to their own case is a RAS case role, not an IDAM
  role.** `CITIZEN` alone must never be enough to read a case.
- **Permissions are per role**: `CRU` for a party who may edit, `Set.of(R)` for a caseworker who may
  only read. Event-level grants (`.grant(Set.of(CREATE, READ, UPDATE), UserRole.CASEWORKER)`) and
  field-level access profiles then express, declaratively, that a caseworker note is invisible to a
  citizen.

So the citizen/caseworker split belongs in `deed-poll-api`'s CCD configuration. Do not write it as `if`
statements in controllers.

### The gap this does not close, and it is a real one

**CCD's access control governs the CCD path only** — events submitted through data-store, and the
`CaseView` projection CCD asks for. It does **not** police bespoke REST endpoints we write on the same
service. Every one of the direct `frontend → deed-poll-api` reads is ours to authorise, and CCD is not
in that path at all.

Three disciplines, and the plan recommends all three rather than picking one:

1. **Separate endpoint namespaces — `/caseworker/**` and `/citizen/**`** — with separate controllers.
   Never one endpoint that behaves differently by role.
2. **Never share a response DTO between audiences.** A caseworker DTO that gains a field is then
   incapable of leaking it to a citizen, because the citizen DTO is a different class. This is the single
   cheapest guardrail available and it survives people who have not read this document.
3. **Authorise citizen reads against case access explicitly.** A citizen may see a case because they are
   a party to it — so check that, in our own data, on every citizen read. Do not infer it from the fact
   that a valid citizen token arrived. CDAM already works this way: it asks data-store whether the user
   may read the field holding the document rather than trusting the caller.

### The two auth relationships, which are easy to conflate

| Hop | Credential | Notes |
|---|---|---|
| `apps/web` → `deed-poll-api` | ours to choose; simplest is forwarding the user's IDAM token | `apps/api` already does exactly this — it mounts `authenticate()` globally and reads bearer tokens |
| `deed-poll-api` → CCD and CDAM | **S2S is mandatory** — a `microservicekey-*` secret — plus an IDAM user or system token | This is what onboarding row 1 requests. **Nothing about the web↔api handshake produces it** |

PCS puts **both** `pcs_frontend` and `pcs_api` in `CASE_DOCUMENT_S2S_AUTHORISED_SERVICES`, so their
frontend holds its own S2S identity and reaches CDAM directly. That is a legitimate alternative for
downloads — it avoids streaming binaries through Java twice — at the cost of two services knowing about
CDAM and two S2S secrets. The diagram above shows the simpler shape; decide it deliberately rather than
by accident.


## Payment: Fees and Pay, and where GOV.UK Pay sits

Steve asked where GOV.UK Pay fits. **We never call it.** The layering, from
`apps/payment/CLAUDE.md`:

```
  deed-poll-api
       │  IDAM user JWT (system user) + S2S      ← both required on every call
       ▼
  ccpay-payment-app         "Fees and Pay" — the hub, port 8080
       │  modules: payment-api, gov-pay-client, payment-reference-data, …
       ├──────► GOV.UK Pay public API        card processing
       ├──────► the Fees Register            fee codes and amounts
       ├──────► Liberata                     PBA account validation (not us)
       └──────► PCI-PAL Antenna / Kerv       telephony payments (not us)

  payment status comes back via Azure Service Bus
  (ASB_CONNECTION_STRING / ccpay-service-callback-topic)
```

So "Fee and Pay" is `apps/payment` — the workspace labels it *Fees & Pay* — and **GOV.UK Pay is an
implementation detail behind `ccpay-payment-app`'s `gov-pay-client` module.** We integrate with
`ccpay-payment-app` and nothing else.

Four things that follow, each of which shapes the journey:

1. **Every payment-app call needs an IDAM user JWT *and* an S2S JWT.** An anonymous citizen supplies
   neither, so both come from `deed-poll-api`: the system-user token and our own S2S identity. This is
   the main reason the system user is not optional.
2. **`deed_poll_api` must be added to `ccpay-payment-app`'s trusted service list.** It currently covers
   about twenty CFT services — `cmc`, `ccd_gw`, `xui_webapp`, `pcs_api`, `civil_service`,
   `nfdiv_case_api` and so on. That is an onboarding request to the payments team, and it is a *separate*
   list from CDAM's `CASE_DOCUMENT_S2S_AUTHORISED_SERVICES`.
3. **Payment status arrives asynchronously, over Azure Service Bus.** Do not treat the browser's return
   from GOV.UK Pay as proof of payment — it tells you the user came back, not that the money moved. The
   `ccpay-service-callback-topic` subscription is the authoritative signal, which means the citizen
   journey needs a state that means "submitted, payment not yet confirmed".
4. **There is already a citizen-facing payment outcome page in the estate** —
   `ccpay-paymentoutcome-web`, an Express/TypeScript app on port 3100. Worth looking at before building
   our own success page; it may be reusable or at least a pattern to copy.

### The ordering question, which needs deciding before the citizen surface is designed

"Payment before the success message" leaves one genuine choice: is the case created before or after the
payment succeeds?

| | Before payment | After payment |
|---|---|---|
| Abandoned journeys | leave unpaid cases in the data | leave nothing |
| Where form data lives during payment | the case | a session or draft store |
| Payment reference attaches to | an existing case — simple | something that does not exist yet |

**Settled 2026-09-04 — create the case first.** Not a preference: **payment reconciliation needs a case
reference before a payment can be processed**, so the case has to exist. Steve's decision, and the
sequence is:

```
  1  create the case                 state: awaiting payment
  2  create the payment against it   case reference is the link
  3  Service Bus callback confirms   state: submitted
  4  only now does it appear in the caseworker list
```

Step 4 is the important one for the admin app: **the caseworker case list must exclude
awaiting-payment cases by default**, or every abandoned journey becomes work for staff. That is a
change to `findDeedPolls`' default filter, not just a UI tab.

The cost this accepts is that unpaid cases accumulate. CCD's `resolvedTTL` and the retain-and-dispose
cron are the wrong tool — they work in years. Unpaid drafts want their own reaper on a much shorter
clock; see [Protecting the public submission endpoint](#protecting-the-public-submission-endpoint).

`feeReference`, `refundAmount`, `dateOfRefund` and `refundReference` already exist in the schema, so the
refund path is anticipated by the domain model even though release 1 may not exercise it.

---

## Protecting the public submission endpoint

Release 1 exposes a public, unauthenticated journey that creates a case and initiates a payment. Layers
below, most valuable first. **The first two are architectural and nearly free; the reflex answer — add a
CAPTCHA — is the one to avoid.**

### 0. Frame it correctly: the public surface is the frontend, not the API

`deed-poll-api` must have **no public ingress**. It is reachable only from the two frontends, inside the
cluster, and it accepts S2S from known services only. So this is not "harden a public API" — it is
"harden a public GOV.UK form journey", which is a far better-understood problem. Getting this wrong, by
giving the API its own public hostname the way `apps/api` has one today, undoes every layer below it.

### 1. Make submission require a walked, server-side session journey

**The single most effective control, and it costs nothing because it is how GOV.UK forms work anyway.**
A multi-page journey accumulates answers in the existing Postgres session store. Submission then requires
a valid session cookie, session state proving the journey was actually walked in order, and a CSRF token.
A bot must hold cookies and traverse every page to submit once.

**Do not build a single stateless `POST` that accepts a complete application.** That is the shape that is
hard to protect, and it is the shape an API-first instinct produces.

### 2. CSRF, which does not currently exist

**No CSRF middleware is installed** — not in `apps/web`, not in `libs/express-govuk-starter`. The only
CSRF in the codebase is the OIDC `state` check in `auth/idam.ts`, which protects the login callback and
nothing else. Note `apps/web/src/assets/js/index.ts` already lists `_csrf` among essential cookies, so
this was expected and never wired.

For a public form that creates a case and takes a payment this is not optional. `csrf-csrf`
(double-submit) suits a session-backed Express app. **This is a template-level gap** — the same argument
as loose ends 1, 11 and 15 in `PROGRESS.md`: fix it in `hmcts/expressjs-monorepo-template` so every
service on it benefits, rather than only here.

### 3. Rate limiting, with the two things that make it actually work

Nothing is installed today. Two details matter more than the library choice:

- **Key on session first, IP second.** Per-IP alone is weak in both directions: CGNAT and mobile networks
  share addresses, so one limit can throttle a whole library or office, while a botnet walks past it.
- **It must be shared across replicas.** In-memory `express-rate-limit` across N pods grants N times the
  intended allowance — a limit that silently does not hold. Either **Redis** (the conventional answer;
  `pt-shared-infrastructure` and `pcs-shared-infrastructure` both ship a `redis.tf`, so the new
  infrastructure repo can too) or the **existing Postgres session store**, which adds no infrastructure
  but costs a write per request. Redis is the right tool; Postgres is the cheaper start.

Rate-limit **payment creation more tightly than form submission** — see layer 5.

### 4. WAF at the edge, which is where volume abuse should die

App-level limits protect the database; they do not protect the ingress. Public HMCTS services sit behind
**Azure Front Door with WAF**, which gives rate-limiting rules and bot management before traffic reaches
the cluster — and it is already a path-to-live item in `MIGRATION_PLAN.md` alongside the shutter and
public DNS. Treat it as the primary volume control, not an afterthought.

`nginx.ingress.kubernetes.io/limit-rps` and `limit-connections` annotations are a cheap in-cluster
backstop for the days before Front Door exists.

### 5. Card testing, which is the abuse people forget

A public payment page is a target for testing stolen cards. Card details never touch us — GOV.UK Pay
hosts them — so the exposure is reputational and reconciliation noise rather than PCI scope. Mitigations:
a tighter limit on payment creation than on form submission, an alert on a high failed-payment ratio, and
**a conversation with the payments team, who will have seen this before.** `ccpay-payment-app` also has a
`feature.duplicate.payment.check` LaunchDarkly flag, which is worth understanding rather than
rediscovering.

### 6. Reap unpaid drafts on a short clock

This is the direct answer to "someone fills the database with unpaid drafts", and it is needed by design
now that the case is created before payment. A scheduled job in `deed-poll-api` deleting
awaiting-payment cases after **hours or days, not years** — explicitly *not* CCD's retain-and-dispose,
which is a retention mechanism operating on a completely different timescale. Pick the window with the
service team: long enough that a genuine applicant who steps away can come back, short enough that abuse
does not accumulate.

### 7. Idempotency on submit

A double-clicked submit must not produce two cases and two payments. Key it on something session-derived
so a retry is recognised. The SDK gives `ccd.case_event.idempotency_key`; the discipline is ours.

### 8. Do not let the sequential case reference become a credential

`KBDP2026-00001` is **sequential** — `ReferenceCounter` holds `year` and `lastSerial`. Release 1 has no
citizen read endpoint so nothing is exposed, but when the portal arrives, "knows the reference" must
never mean "may see the case". Stating it now because it is free now and a redesign later.

### 9. Decide whether citizens upload documents in release 1 at all

If the MoJ form being replaced takes no attachments, do not build citizen upload. Every upload is storage
to pay for and a malware vector, and the type check is declared-MIME-only and always will be until real
inspection arrives. A scope question rather than a security control, but the cheapest possible mitigation
is not having the feature.

### Monitoring

App Insights is already wired via `libs/cloud-native-platform`. Alert on submission rate and on
awaiting-payment case growth — the second is the leading indicator that any of the above has failed.


## Open questions the citizen app raises

New with the two-frontend decision. None blocks Stage 2, but 7 and 8 shape what gets built and are
worth asking early.

7. ~~**Does the citizen journey take a payment?**~~ **Answered 2026-09-04 — yes, before the success
   message.** Via Fees and Pay, which is `ccpay-payment-app`; GOV.UK Pay sits behind it and we never call
   it directly. See [Payment](#payment-fees-and-pay-and-where-govuk-pay-sits). Four onboarding rows and
   one design decision came out of it.
8. ~~**What is the citizen's relationship to the case, in AM terms?**~~ **Not a release 1 question.**
   Release 1 has no citizen account, so nobody returns to read a case. Deferred with the portal.
9. ~~**Do the two frontends each need their own S2S identity?**~~ **Answered: the citizen frontend does.**
   It has no user token to forward in release 1, so its calls to `deed-poll-api` carry S2S only.
   `apps/web` still forwards a real caseworker token and needs none unless it ever talks to CDAM directly.
10. **Is the same case type right for both audiences?** Still open. One case type with role-scoped events
    is the normal answer and what this plan assumes. Worth confirming with `dcd_ccd` that nothing about an
    anonymous citizen-initiated application argues for a separate one, because splitting later is
    expensive — a second `service_config.json` entry and another CDAM release.
11. ~~**What stops abuse of an unauthenticated public submission endpoint?**~~ **Designed 2026-09-04** —
    see [Protecting the public submission endpoint](#protecting-the-public-submission-endpoint). Two
    decisions inside it still need an owner: whether the rate-limit store is Redis or the existing
    Postgres session store, and the reaping window for unpaid drafts.
12. ~~**Create the case before or after payment?**~~ **Settled 2026-09-04 — before.** Payment
    reconciliation needs a case reference, so the case must exist first. The consequence to build for is
    that the caseworker list must exclude awaiting-payment cases by default.
13. **Does the MoJ form being replaced accept attachments?** If not, do not build citizen document
    upload in release 1 — see layer 9 of the protection design.

---

## Onboarding `deed-poll-web` will need

Moved out of the API plan on 2026-09-04, because none of it is needed to build `deed-poll-api`. Row
numbers are kept as they were so the API plan’s history reads consistently.

| # | What | Where | Owner | Notes |
|---|---|---|---|---|
| 12 | **An IDAM system user, `deed-poll-system-update`**, plus the matching CCD role | `hmcts/idam-access-config` + our `CCDConfig` | IDAM | **Release 1 depends on this.** It is what creates a case and calls payments on behalf of an anonymous applicant. PCS's equivalent is `pcs-system-update`, registered as `CcdRoleConfig("pcs-system-update", "PUBLIC")`. Not the same thing as the caseworker client already awaiting IDAM |
| 13 | **An S2S identity for the citizen frontend** | service-auth-provider | IDAM / S2S | Its calls to `deed-poll-api` carry S2S only, because there is no user token in release 1. Same request route as row 1 |
| 14 | **Add `deed_poll_api` to `ccpay-payment-app`'s trusted service list** | `hmcts/ccpay-payment-app` | payments team | A **separate** list from CDAM's. Currently covers ~20 CFT services (`pcs_api`, `nfdiv_case_api`, `civil_service`, …). Needed before any payment call works |
| 15 | Fee code and amount for a deed poll application, from the Fees Register | the Fees Register | payments / service team | `ccpay-payment-app` calls the register; we need the fee code the journey should quote. The register's repo is not in this workspace and I could not confirm its name, so ask rather than guess |
| 16 | Azure Service Bus subscription to `ccpay-service-callback-topic` | `cnp-flux-config` / payments | **`@hmcts/platform-operations`** + payments | The authoritative payment-status signal. Not the browser redirect |
| — | ~~A citizen IDAM client~~ | | | **Deferred to the portal release.** Release 1 has no citizen login, so there is nothing to register yet |
| — | ~~Citizen case access via AM / Role Assignment~~ | | | **Deferred to the portal release.** Nobody returns to read a case in release 1 |
