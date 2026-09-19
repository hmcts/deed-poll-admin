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

## Checklist

### A GOV.UK Notify service — **blocking**

- [ ] A Notify service created for deed poll, on the **central government** organisation so it inherits
      HMCTS's agreement rather than a trial account's limits
- [ ] Team members added, with at least two people holding the permission to manage API keys, so a single
      leaver does not lock the service
- [ ] The service moved **live**. A trial-mode service can only email team members and guest-list addresses,
      which means AAT testing against real applicant addresses fails in a way that looks like a code bug
- [ ] Sending limits confirmed against expected volume, and the daily limit noted here once known

### API keys — **blocking**

Notify issues three kinds and the distinction matters:

| Kind | Sends? | Use |
|---|---|---|
| **Live** | Yes, really | `prod` only |
| **Team and guest list** | Only to team/guest-list addresses | `aat`, `demo`, `ithc` |
| **Test** | No — returns a realistic response, sends nothing | Smoke tests, and useful in `perftest` |

- [ ] A key per environment, never one shared
- [ ] Each key stored as a key vault secret in `deed-poll-infra` — a **manually-seeded** secret, since the
      value comes from the Notify UI and cannot be Terraformed
- [ ] `charts/deed-poll-api` maps the secret to `NOTIFY_API_KEY`
- [ ] Confirm the secret name matches what `application.yaml` expects, and that nothing logs it

### Templates — **blocking for the template it belongs to**

Template IDs are UUIDs minted in the Notify UI by whoever authors the content. Engineering cannot generate
them, and notify-1 carries a placeholder until they exist.

- [ ] `application-rejected` authored — **the only one notify-1 needs**
- [ ] `request-confirmation-to-proceed` authored (notify-3)
- [ ] `forms-for-completion-adult` authored (notify-4; also needs the five static forms sourced, and *send a
      file by email* enabled below)
- [ ] `forms-for-completion-minor` authored (notify-4, same)
- [ ] Each template's UUID recorded per environment and added to `application.yaml` under `notify.templates.*`
      — these are **not secrets** and belong in config, not the key vault

Content notes for whoever authors them, from the taxonomy:

- **`application-rejected` needs a conditional** for the online-vs-paper refund text. Notify's syntax is
  `((applied_online??text shown when true))`; the api supplies `applied_online` from `postCounter`.
- **`request-confirmation-to-proceed` needs a conditional** for `[child's]`, supplied from the case `type`, and
  its `XX/YY/ZZZZ` literal becomes a real placeholder fed from the referral's `decisionDate`.
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

- [ ] HMCTS email branding applied to the service. Notify holds pre-approved government brands and HMCTS is
      one of them — request it on the service rather than uploading a logo, so it stays consistent with every
      other HMCTS service
- [ ] A sent test email checked on a phone as well as a desktop client
- [ ] Confirm the branding applies to **all** templates on the service, so a later template does not need it
      re-requested

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

### A reply-to address — **blocking for templates ① ② ④**

Three of the four templates invite a reply (*"you can reply to this email"*, *"let us know by replying"*).
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
4. **Is there a template for chasing missing documents?** `AwaitingFurtherDocs` exists as a case state and
   nothing supplied covers it.
5. **Is there a template for the Gazette notice email?** Two of the supplied templates promise the applicant
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
