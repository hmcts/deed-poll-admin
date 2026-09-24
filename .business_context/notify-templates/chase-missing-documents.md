# ⑤ `chase-missing-documents` — draft Notify template

**Status: DRAFT, needs business sign-off before it is authored in the Notify UI.** Written 2026-09-24,
modelled on [`application-rejected.md`](application-rejected.md).

**This one is different from the other four, and the difference is the point.** ③ and ④ were drafted *from*
a supplied `.docx`; ⑤ has none. `NOTIFY_TEMPLATE_TAXONOMY.md` records it as *"a planning assumption agreed
2026-09-20 rather than one of the six source `.docx` files"*, with confidence **"Assumed 2026-09-20 —
required caseworker text"**. So every sentence below is **engineering's proposal**, not the court's wording,
and the questions at the bottom are real questions rather than ceremony.

It exists now because `deed-poll-api`'s notify-6 **Task 0 cannot start without it** — that task verifies the
provisioned template's placeholders against the UI and amends the plan on any mismatch. Nothing can be verified
against a template nobody has authored, which is what currently blocks the plan.

## When it is sent

The applicant has been sent the forms (① or ②), has posted the signed deed, statutory declaration and exhibit
cover sheets back, and **something is missing**. The case sits in **`AwaitingFurtherDocs`**, derived from its
dates. A caseworker identifies what is outstanding and sends this, writing the list themselves.

Unlike ③ and ④ this is **not** triggered by a judicial direction, and it is **repeatable** — a second chase is
an ordinary thing to need, which is why notify-6 makes sends idempotent on a key rather than one-per-referral.

## The contract: exactly five placeholders

Names must match character-for-character or **Notify rejects the send with a 400**.

| Placeholder | Type | Filled by | Source |
|---|---|---|---|
| `reference_number` | text | resolved | the case reference |
| `online_application_reference` | text | resolved | `onlineApplicationReference` |
| `old_forename` | text | resolved | old-name column |
| `old_surname` | text | resolved | old-name column |
| `documents_required` | text | **caseworker — required, never empty, typed from scratch** | — |

**Four resolved, one caseworker slot, and no conditionals.** That is the whole contract, and it is simpler than
③'s seven: there is no refund branch here, so no boolean flag and no `((flag??…))` blocks. `additional_notes`
is deliberately **absent** — ③ has one because a rejection may need softening; a chase is a list, and a second
free-text box would invite the caseworker to split one message across two fields.

**Confirmed by Steve 2026-09-24: one free-text box, and it carries the required detail.** So the api's
`EmailSlot.DOCUMENTS_REQUIRED` is the whole of the caseworker's input. If a second optional box is wanted later,
that is an api change (a new `EmailSlot`) and a sixth placeholder here — not something this template can absorb.

**Unlike ③'s slot, this one cannot be pre-populated, and that is a fact about the data rather than a choice.**
`judges_reason` arrives filled from `Referral.directionsText`, so a caseworker usually sends ③ unedited. There is
no equivalent source here: `awaitingFurtherDocsInfo` — the field whose presence *derives* the
`AwaitingFurtherDocs` state — is a **`timestamp(3)`**, not text. It records *when* the case began waiting and
says nothing about *what* is outstanding. Nothing else on the case holds that either. So the box starts empty
every time, every chase is typed fresh, and the admin UI should expect a genuinely blank field rather than a
prefill that failed.

**`documents_required` is required and capped at 4,000 characters by the api** (`EmailSlot.DOCUMENTS_REQUIRED`).
The cap is the api's, not Notify's, so the template wording must stay readable with a long list in it — which is
why the placeholder sits on its own line with nothing wrapped around it.

**A slot with no matching placeholder makes Notify refuse the send**, so do not add a caseworker box here
without the api gaining the slot, and do not drop one without the api losing it.

## Subject

```
Your deed poll application ((reference_number)) (online application reference: ((online_application_reference))) – documents needed
```

Matching ③'s shape exactly, including the en dash and the lower-case trailing phrase, so the two read as one
service in an inbox. "documents needed" rather than "missing documents" because the applicant has not lost
anything — the court needs something further.

## Body

```
Regarding the application to enrol a deed poll change of name for ((old_forename)) ((old_surname))

Thank you for applying to enrol a deed poll with the High Court.

We cannot continue with your application yet, because we still need the following from you:

((documents_required))

You can send these to us either by post, to the address on the forms we sent you, or by email to
KBDEEDSPOLL@justice.gov.uk.

Your application will stay open while we wait, and we will continue as soon as everything has reached us.

If anything above is unclear, or you have already sent these to us, reply to this email and we will help.

Kind regards,
King's Bench
```

## Notes on the layout

- **`((documents_required))` stands alone on its own line**, with the colon-introduced sentence above it doing
  the grammatical work. So a caseworker can write either a single sentence or a Markdown bullet list —
  `* one per line`, which Notify renders — and the paragraph before it reads correctly either way. A placeholder
  embedded mid-sentence would break the moment somebody pasted a list into it.
- **No "within 14 days" and no deadline.** Nothing in the case model holds a chase deadline, there is no timer
  that acts on one, and a date the service does not enforce is a promise it cannot keep. If the business wants a
  deadline it needs a field and a rule, not a sentence — flagged below.
- **The address is written into the body as well as configured as the reply-to, and both are deliberate.**
  `KBDEEDSPOLL@justice.gov.uk` appears in the wording so an applicant can send documents from a different account,
  forward the email, or write the address down — none of which a reply-to header supports. The reply-to then makes
  "reply to this email" work for the applicant who just hits reply. Two routes to one inbox, not a duplication.
- **"reply to this email" is load-bearing and is why the reply-to still matters.** `CHASE_MISSING_DOCUMENTS` has
  `invitesReply = true`, so `NotifyProperties.isProvisioned` reports it unprovisioned until `emailReplyToId` is
  configured — and Notify **silently drops a blank reply-to and sends from no-reply**, which would leave that
  sentence inviting a reply nobody receives. That is the specific failure the provisioning check exists to stop.
  **Note what is and is not now known:** Steve confirmed 2026-09-24 that `KBDEEDSPOLL@justice.gov.uk` is
  registered and verified in Notify. That is the *address*; `isProvisioned` needs its **`emailReplyToId`**, which
  is a UUID only readable from the Notify UI. So the inbox is no longer the blocker, but the id still has to be
  fetched and configured before a send will work.
- **"the address on the forms we sent you" rather than a postal address here.** The court's address is already on
  ① / ②, which this applicant has by definition — they were sent the forms and posted them back. Repeating it
  creates a second place for it to go stale, and this template has no `postal_address` placeholder to carry it.
- **It says the application stays open**, because the applicant's reasonable fear on receiving this is that it
  has been cancelled. ③ tells people their application is being cancelled; this one must not be mistaken for it.
- No branding markup, no logo: HMCTS branding is a **service-level** Notify setting and is already selected on
  the non-prod service, so it applies to every template without appearing in the content.

## ✅ Resolved 2026-09-24 by Steve

**① The return route is post *or* email, and that settles the reply question.** The instruction was "words to
this effect: send by post or to KBDEEDSPOLL@justice.gov.uk". So the monitored inbox **is** meant to receive
documents, not only questions — which retires the sharpest objection in the first draft of this file. That draft
argued the reply-to might be the wrong mechanism because Notify cannot receive an attachment; it cannot, but the
*inbox* can, and an applicant emailing `KBDEEDSPOLL@justice.gov.uk` directly is not constrained by Notify at all.
The body therefore names both routes, and the reply-to exists so that hitting reply reaches the same place.

**② One free-text box, carrying the required detail.** Confirmed, so `documents_required` stands as the whole of
the caseworker's input. See the contract table for what that means for pre-population — there is no source field,
so it is always typed from scratch.

**③ `KBDEEDSPOLL@justice.gov.uk` is registered and verified in Notify.** Taken as given. The residual task is
mechanical rather than a decision: read its **`emailReplyToId`** out of the Notify UI and configure it, because
that id and not the address is what `isProvisioned` checks.

## Questions still open — none of these is engineering's to answer

1. **Is the wording right?** Steve supplied the return-route sentence; the rest is still engineering's proposal
   and has no supplied original to be checked against, so it needs reading as new copy rather than as a port.
2. **Should it name a deadline or a consequence?** See the layout note. Today the honest answer is that nothing
   expires, and the draft says so — a date here would be a promise the service does not keep.
3. **Does the caseworker need example prompts?** `documents_required` is free text with no guidance behind it, so
   two caseworkers will phrase the same gap differently. If consistency matters, the answer is a set of
   suggested phrasings in the admin UI rather than anything in the template.
4. **One template for adult and minor, or two?** ① and ② are split by `type`; this draft is not, on the grounds
   that the missing-document list is the caseworker's text either way and nothing else in the wording differs.
   Splitting it later means a second UUID and a `type` branch in applicability.

## After it is authored

Whoever authors it in the Notify UI should record here, exactly as `application-rejected.md` does:

- the **non-prod template UUID**, which is the value
  `NOTIFY_TEMPLATE_CHASE_MISSING_DOCUMENTS` takes (it is configuration, not a secret, and differs per service);
- confirmation that the five placeholder names match **character-for-character**;
- that the configured **reply-to** is the monitored office inbox, verified — Notify emails it a confirmation
  link, and an unverified address cannot be used;
- any wording the court changed, so notify-6's Task 0 can be ticked from evidence rather than assumption.

Then tick the `chase-missing-documents` line in
[`NOTIFY_PROVISIONING_REQUEST.md`](../NOTIFY_PROVISIONING_REQUEST.md), which names itself as *"the one that
unblocks the next plan"*.
