# notify-0 — GOV.UK Notify provisioning

The external half of the email feature. **Not a ralphex plan** — every item needs somebody outside
engineering, and most cannot be done by writing code. `deed-poll-api/docs/plans/notify-1-email-plumbing.md`
builds against a WireMock double and is fully testable without any of this; it cannot send a real email until
the items marked **blocking** are done.

Written 2026-09-18. Companion to
[`NOTIFY_TEMPLATE_TAXONOMY.md`](NOTIFY_TEMPLATE_TAXONOMY.md), which has the template analysis.

## Current state

Nothing exists. Verified across all four deed-poll repos on 2026-09-18: no Notify client, no configuration, and
`deed-poll-infra/key-vault.tf` holds secrets for app-insights, postgres and redis only. The two `notify` grep
hits in `deed-poll-api` are `inotify` and Postgres `LISTEN`/`NOTIFY`.

**Planning update, 2026-09-20:** Steve asked engineering to assume the missing-documents chase template is in
place and requires caseworker text. That assumption unblocks writing notify-6; it does not mark any checklist
item below complete or supersede the last operational verification. notify-6 Task 0 records the real template
evidence before implementation.

**Update 2026-09-23 — "nothing exists" is no longer true.** A **non-prod Notify service has been created** and
HMCTS branding selected. Two consequences: the service section below is restructured for a **two-service**
model, and the 2026-09-20 assumption is now unnecessary for notify-6 as soon as the template is authored —
Task 0 can verify against real evidence, which is what it asks for. Task 0 needs **no live service and no
send**: it reads template metadata in the UI.

## ✅ The first real email has been sent — 2026-09-23

**This service has now sent an email to a real inbox, end to end.** It is the headline this file was missing,
and it retires a line in the daily update that had run for days: *"five built features depend on Notify and none
can be demonstrated"*. One of them now can.

| | |
|---|---|
| Template | ③ `application-rejected` |
| Recipient | a team member's real inbox, delivered |
| Stored state | `Sent`, with a `providerNotificationId` from Notify |
| Route | admin UI → api → outbox → drain → Notify → inbox |
| Environment | **local only** — api on `bootRun`, admin pointed at it, non-prod Notify service |

**What it proves beyond "an email arrived":**

- **Notify reads a JSON boolean for conditionals.** Settled by calling `generateTemplatePreview` through the
  service, not by the send — Notify's UI takes yes/no, so a UI test proves the template and says nothing about
  the value type a client sends. Had it been wrong, no refund paragraph would have rendered and nothing would
  have errored.
- **The seven-key personalisation contract matches the authored template exactly** — a mismatch is a 400.
- **The outbox drains off caseworker traffic with no scheduler**, so a send is attempted immediately.
- **`providerNotificationId` is stored**, which keeps delivery callbacks additive later rather than a rework.

**What it does not prove.** Nothing is deployed: this was a local api against the non-prod Notify service, so
the vault secret, the chart's secret mapping and any deployed environment remain untouched. And the **next two
templates both invite a reply**, so they are blocked on a verified reply-to rather than on anything ③ proved.

**One trap this cost an hour to find, worth knowing before the next local test.** `deed-poll-admin`'s
`turbo.json` declares no `env`/`passThroughEnv`/`globalEnv`, and Turbo filters environment variables — so
`DEED_POLL_API_URL=… yarn dev` silently does **not** reach the app, which falls back to its in-memory mock. The
mock accepts a send and delivers nothing, so the admin UI reported success while the api's database held zero
cases and zero notifications. Run `yarn dev:app` directly to bypass Turbo, or fix `turbo.json`. Deployed pods
are unaffected: they run `node dist/server.js` with no Turbo involved.

## Checklist

### GOV.UK Notify services — **blocking**

**Two services, not one — changed 2026-09-23.** This section originally assumed a single service moved live,
with the environment distinction carried entirely by the key type. A **non-prod service has been created
instead**, so the split is now per *service* as well as per key. That is a normal Notify pattern and is kept
deliberately: a trial-mode non-prod service **cannot** email anyone off the team and guest list, so it cannot
accidentally email a real applicant — and `DeedPollType` has `AdultTransgender` and `MinorTransgender`
members, which makes an accidental send from a test environment worse than a little guest-list admin.

**Trial-vs-live and the key kinds are independent controls**, and conflating them is the easy mistake: the
mode decides who the *service* may email at all and what its allowance is, the key kind decides what a
*given key* may do inside that mode.

- [x] A Notify service created for deed poll, on the **central government** organisation so it inherits
      HMCTS's agreement rather than a trial account's limits — **non-prod created 2026-09-23**
- [ ] Team members added, with at least two people holding the permission to manage API keys, so a single
      leaver does not lock the service
- [ ] **Non-prod: left in trial mode deliberately.** Guest-list every address AAT will actually send to. The
      original warning still applies and is the thing to watch — a send to an address that is *not*
      guest-listed fails in a way that looks like a code bug, so when an AAT send fails, check the guest list
      before reading any stack trace
- [ ] **Non-prod: the trial daily allowance read off the UI and recorded here.** Not quoted in this file
      because `docs.notifications.service.gov.uk` is blocked from the devcontainer — do not trust a figure
      that has not been read off the service
- [ ] **Non-prod: confirm whether previews consume that allowance.** The Email tab previews *through* Notify
      (`generateTemplatePreview`), so this matters far more on a trial allowance than a live one. See the rate
      limit section, where it is also unresolved
- [ ] **A separate prod service, moved live**, with the Live key. Not needed until there is something to
      deploy to prod
- [ ] Sending limits confirmed against expected volume, and the daily limit noted here once known

**What the split duplicates.** Each of these is per service, so it is done twice and can drift:

| Per service | Consequence |
|---|---|
| Template UUIDs | Already anticipated — `notify.templates.*` is per environment |
| HMCTS branding | Requested separately on each |
| Reply-to addresses | Registered **and verified** separately; Notify emails a confirmation link to each |
| Rate and daily limits | Measured separately |
| Template content | The same wording authored twice, and free to diverge |

### API keys — **blocking**

Notify issues three kinds and the distinction matters:

| Kind | Sends? | Use |
|---|---|---|
| **Live** | Yes, really | `prod` only |
| **Team and guest list** | Only to team/guest-list addresses | `aat`, `demo`, `ithc` |
| **Test** | No — returns a realistic response, sends nothing | Smoke tests, and useful in `perftest` |

- [ ] A key per environment, never one shared. **Under the two-service split (2026-09-23):** a **Team and
      guest list** key on the non-prod service for `aat`/`demo`/`ithc`, a **Test** key on the same service for
      smoke tests and `perftest`, and the **Live** key only ever on the prod service. A Live key cannot exist
      on a trial-mode service at all, which is the split doing its job rather than an obstacle
      **Partly done 2026-09-23:** a Team-and-guest-list key and a Test key both exist on the non-prod service.
      Neither is per-environment yet and neither is in a vault — they have only been used locally. **The Test key
      is the trap worth remembering: it returns a realistic success and sends nothing**, so a send through it
      looks like a working feature and delivers no email.
- [ ] Each key stored as a key vault secret in `deed-poll-infra` — a **manually-seeded** secret, since the
      value comes from the Notify UI and cannot be Terraformed
- [ ] `charts/deed-poll-api` maps the secret to `NOTIFY_API_KEY` — the chart names no Notify **secret** yet,
      though it does now set the template id, which is not a secret
- [ ] Confirm the secret name matches what `application.yaml` expects, and that nothing logs it.
      **Half-verified 2026-09-23: nothing logs it today**, checked by grep. But `NotifyProperties` is a
      `record` with no `toString()` override, and a record's default `toString()` prints every component —
      including `apiKey`. So the guarantee rests on nobody ever writing `log.info("{}", properties)` or letting
      the object reach an exception message. **A `toString()` override would make it safe by construction rather
      than by vigilance**, and is worth doing before a real key is in a deployed environment

### Templates — **blocking for the template it belongs to**

Template IDs are UUIDs minted in the Notify UI by whoever authors the content. Engineering cannot generate
them, and notify-1 carries a placeholder until they exist.

- [x] `application-rejected` authored — **the only one notify-1 needs.** Done 2026-09-23 on the non-prod
      service, `b2cb5754-591d-40c0-b961-b2823a5792eb`. Draft, placeholder contract and the corrections applied
      are in [`notify-templates/application-rejected.md`](notify-templates/application-rejected.md)
- [ ] `request-confirmation-to-proceed` authored (notify-3) — **needs a verified reply-to, see below**
- [ ] `chase-missing-documents` authored (notify-6; assumed available for planning, verify in its Task 0) —
      **needs a verified reply-to, see below.** This is the one that unblocks the next plan
- [ ] `forms-for-completion-adult` authored (notify-4; also needs the five static forms sourced, and *send a
      file by email* enabled below)
- [ ] `forms-for-completion-minor` authored (notify-4, same)
- [ ] Each template's UUID recorded per environment. **Corrected 2026-09-23: NOT in `application.yaml`.** That
      file deliberately keeps `${NOTIFY_TEMPLATE_*:DEED_POLL_PLACEHOLDER}`, so one grep still lists every
      external identifier the service is waiting on. The real value is an **environment variable per
      environment**, set in `charts/deed-poll-api`. Still correct that these are **not secrets** — config, not
      key vault. ③'s is set; prod must override in its own Flux HelmRelease rather than inherit the non-prod id

Content notes for whoever authors them, from the taxonomy:

- **`application-rejected` needs a conditional** for the online-vs-paper refund text. Notify's syntax is
  `((applied_online??text shown when true))`; the api supplies `applied_online` from `postCounter`.
- **`request-confirmation-to-proceed` needs a conditional** for `[child's]`, supplied from the case `type`, and
  its `XX/YY/ZZZZ` literal becomes a real placeholder fed from the referral's `decisionDate`.
- **`chase-missing-documents` needs one required caseworker placeholder**, `documents_required`, capped at
  4,000 characters. Its other placeholders are `reference_number`, `online_application_reference`,
  `old_forename` and `old_surname`. notify-6 Task 0 verifies these names against the real template.
- **The forms emails must be reworded.** They currently say *"we have attached three forms"*. Notify does not
  attach files; it inserts a time-limited secure link. Confirmed approach (Steve, 2026-09-18): reword to a
  download. **The wording should also say the link expires**, rather than leaving an applicant to find out.
- **①② have no caseworker slots** (taxonomy §6, corrected 2026-09-19). Neither supplied document has an
  `[Enter …]` marker, so unlike ③ and ④ there is nothing to curate. If the business wants a notes box, the
  template has to gain a placeholder **before** the api gains a slot — a slot with no placeholder makes
  Notify refuse the send.
- **`type` has four members**, so `[child's]` in ④ is `Minor || MinorTransgender`, not a two-way test. The
  same distinction picks *which template* for ①②, where getting it wrong sends an applicant an email about
  their child.
- Placeholder names must match the api's personalisation keys exactly, or Notify rejects the send with a 400.
  The api's keys are the contract; list them alongside each template once written.

### Send a file by email — **blocking for templates ① ②**

The two forms emails carry documents, and Notify's *send a file by email* is how they get there: the api
calls `NotificationClient.prepareUpload(...)` and puts the result in the personalisation, and Notify hosts
the file and renders a link. **This is a per-service setting and may not be on by default** — if it is off,
every send fails in a way that looks like an api bug.

- [ ] *Send a file by email* enabled on the service
- [ ] **Retention period chosen and recorded.** The api passes `RetentionPeriodDuration(int, ChronoUnit)`.
      Choose it deliberately and generously: this email starts a slow process — print, sign in front of two
      witnesses, find a commissioner of oaths, post back — so a short expiry guarantees calls to the Deed
      Poll office number in the email's own footer. **The platform default was not verified from here**
      (`docs.notifications.service.gov.uk` is blocked from the devcontainer), so read it off the Notify docs
      or UI rather than trusting any figure in this file
- [ ] **Confirm whether recipients must confirm their email address before downloading.** notify-4's decision
      10 sets `confirm_email_before_download` to `true` for every document, on the grounds that deed poll
      data is sensitive — `DeedPollType` has `AdultTransgender` and `MinorTransgender` members — and an
      unconfirmed link is retrievable by anyone the email is forwarded to. Worth the business confirming,
      since it costs the applicant a screen
- [ ] Note the **2 MB per-file limit** — enforced client-side by the Notify Java client, which throws rather
      than sending. A two-page deed will not come close, but the five static forms have not been sourced yet
      and have not been measured

**The contract for `application-rejected`, which notify-1 implements.** Two of these are filled by the
caseworker in the Email tab; the rest are resolved from case data and cannot be edited.

| Placeholder | Filled by | From |
|---|---|---|
| `judges_reason` | **Caseworker** (pre-populated, editable) | `Referral.directionsText` |
| `additional_notes` | **Caseworker** (optional) | — |
| `reference_number` | Resolved | the case reference |
| `online_application_reference` | Resolved | `onlineApplicationReference` |
| `old_forename`, `old_surname` | Resolved | the old-name columns |
| `applied_online` | Resolved — drives the conditional | `postCounter` |

The template author needs to know which two are free text, because those are the ones that arrive as
unformatted prose and need to sit somewhere the surrounding wording still reads correctly.

### Email branding — **blocking for the "official .gov email" requirement**

The requirement that these look like official GOV.UK correspondence is met by **Notify's branding**, not by
styling a body in our code. Notify renders the email; a service's brand decides the header and logo.

- [x] HMCTS email branding applied to the service. Notify holds pre-approved government brands and HMCTS is
      one of them — requested on the service rather than uploading a logo, so it stays consistent with every
      other HMCTS service. **Done 2026-09-23**, and the assets in `branding/` were deliberately *not* uploaded
      for this reason — they are for notify-4's generated documents, which Notify never renders
- [ ] A sent test email checked on a phone as well as a desktop client — the first real send landed on
      2026-09-23 but was not checked on a phone
- [ ] Confirm the branding applies to **all** templates on the service, so a later template does not need it
      re-requested — **cannot be confirmed yet: there is only one template.** Re-check when ④ or ⑤ is authored,
      because a brand that turned out to be per-template is far cheaper to discover on the second one than the
      fifth

> **⚠️ When you tick the first box, the caseworker Email tab's preview will still look unbranded. That is a
> known Content-Security-Policy effect in `deed-poll-admin`, not a sign the branding failed — do not go looking
> for it in Notify.**
>
> The preview on `/deed-polls/{id}/emails/{template}/preview` renders Notify's HTML inside a sandboxed `iframe`
> with `srcdoc`. A `srcdoc` document **inherits the embedder's CSP**, and `configureHelmet()` sends
> `img-src 'self' data:` plus the analytics hosts — so the crest and any other remote image are refused, with
> only a browser console message. `sandbox=""` compounds it: with no `allow-same-origin` the frame has an opaque
> origin, and `'self'` can never match an opaque origin, so even a same-origin image would be blocked. `data:`
> URIs would still render.
>
> **The wording in the preview is exact; only the appearance is not**, and the page's caption says so rather
> than promising fidelity it cannot keep. Nothing in the test suite can detect this — the in-memory mock's
> rendered HTML contains no images at all — so it was found by reading the policy and verified in Chromium
> under the app's real header.
>
> **If a branded preview is wanted, it is a deliberate trade rather than a bug fix.** The `img-src` directive
> lives in `libs/express-govuk-starter`, which is template-provided: editing it there is lost at the next
> re-scaffold with nothing failing. It needs an app-owned CSP override, widening `img-src` on every page of a
> caseworker application for a cosmetic gain on one — and Notify's real static-image host, which nothing in
> this repo currently references. **The honest moment to decide is right after this box is ticked**, because
> that is the first time anyone can look at a real branded rendering and see what is actually missing.
>
> Full reasoning at decision 3 of `docs/plans/completed/notify-2-caseworker-email-tab.md` and in the docblock
> of `src/pages/deed-polls/[id]/emails/[template]/preview.ts`.

**Why this is the mechanism and not a choice:** Notify email templates accept no HTML, and personalisation
values are inserted as plain text — Notify does not render Markdown inside a placeholder. So the structure and
the look have to live in the template, with our code supplying values. See decision 11 of
`deed-poll-api/docs/plans/notify-1-email-plumbing.md`.

### Rate limit — **needed before the Email tab ships**

The Email tab previews through Notify (`generateTemplatePreview`), so previews consume the same allowance as
sends.

- [ ] The service's actual rate limit recorded here once known
- [ ] Confirm preview requests count against it, and at what cost
- [ ] Sanity-check it against the worst case: a caseworker editing a long judge's reason and re-previewing

### A reply-to address — **blocking for templates ① ② ④ ⑤** · **now the single bottleneck**

**Promoted 2026-09-23.** ③ needed no reply-to, which is why it was the right first slice and why it is done.
Every remaining near-term template invites a reply, so this one item gates all of them —
`NotifyProperties.isProvisioned` refuses to send a reply-inviting template while `emailReplyToId` is blank, and
it refuses *deliberately*: Notify drops a blank reply-to and sends from no-reply, which loses the applicant's
answer and says nothing about why.

Concretely, it blocks: **⑤**, and therefore notify-6, the next plan queued to run; and **④**, and therefore
notify-3 and notify-3b — both **merged and unusable** today, exactly where notify-1 was before ③ was authored.

Note the verification step needs access to the inbox itself, not just to Notify: the confirmation link is
emailed to the address being registered.

The two forms emails, request-confirmation email and assumed missing-documents chase invite a reply.
Notify sends from a no-reply address unless a reply-to is registered and verified.

- [ ] A monitored Deed Poll office inbox identified
- [ ] Registered in Notify and **verified** (Notify emails it a confirmation link)
- [ ] Its `emailReplyToId` recorded and configured per template that needs it

### Not needed yet

- **Delivery callbacks.** Notify can POST status updates to a callback URL. notify-1 stores
  `providerNotificationId` so this is additive later; it would need a public endpoint and a bearer token.
- **Letters.** Notify sends post as well as email. The sealed deed goes back by post today, so this is worth
  knowing about but is not in scope.
- **Welsh templates.** `welsh-draft.csv` in this folder suggests bilingual content is coming. In Notify that is
  a second template per language, not a second service.

## Open questions for the business

1. **What is the expected daily volume?** It decides whether the Notify sending limit needs raising and whether
   the outbox drain's batch size matters.
2. **Is there an existing HMCTS Notify service this should join rather than a new one?** Several CFT products
   already send through Notify; sharing a service shares limits and team access, which may be better or worse.
3. **Who owns the content?** Template wording is not engineering's, and three of the four need editing before
   they can be authored — the conditionals, the `XX/YY/ZZZZ` date, and the attachment rewording.
4. **Answered for planning on 2026-09-20:** assume `chase-missing-documents` exists and requires caseworker
   text. notify-6 Task 0 still verifies its real placeholders and reply-to before implementation.
5. **Is there a template for the Gazette notice email?** Deferred. Two of the supplied templates promise the applicant
   one.
6. **Where do the five blank forms come from?** The forms emails name LOC021, LOC023, LOC024, LOC027 and
   LOC028, and **none of them is in `doc_templates/`** — only the two change-of-name deeds are. They carry no
   case data, so they are files to be sourced and stored rather than generated, but notify-4 cannot ship
   without them. Presumably published HMCTS forms; somebody needs to confirm which version is current.
7. **Should sending ① or ② set `signatureRequestedDate`?** That column is what `CaseState.deriveState` reads
   to produce `AwaitingSignature`, so the send and the state change are the same event in everything but
   code. Setting it automatically is tidy, but it couples a communication to a case-state transition, a
   failed send would leave the case claiming otherwise, and a re-send would need a date cleared that a
   caseworker can also edit by hand. **A business decision**, and it should be taken together with the
   equivalent question in `notify-3b` about what an applicant's confirmation does to the case dates.
