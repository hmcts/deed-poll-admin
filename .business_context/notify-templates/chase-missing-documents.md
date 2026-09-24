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
| `documents_required` | text | **caseworker — required, never empty** | — |

**Four resolved, one caseworker slot, and no conditionals.** That is the whole contract, and it is simpler than
③'s seven: there is no refund branch here, so no boolean flag and no `((flag??…))` blocks. `additional_notes`
is deliberately **absent** — ③ has one because a rejection may need softening; a chase is a list, and a second
free-text box would invite the caseworker to split one message across two fields.

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

Please send these to us as soon as you can. Your application will stay open while we wait, and we will continue
as soon as everything has reached us.

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
- **"reply to this email" is load-bearing and is why the reply-to matters.** `CHASE_MISSING_DOCUMENTS` has
  `invitesReply = true`, so `NotifyProperties.isProvisioned` reports it unprovisioned until `emailReplyToId` is
  configured — and Notify **silently drops a blank reply-to and sends from no-reply**, which would leave this
  sentence inviting a reply nobody receives. That is the specific failure the provisioning check exists to stop.
- **It says the application stays open**, because the applicant's reasonable fear on receiving this is that it
  has been cancelled. ③ tells people their application is being cancelled; this one must not be mistaken for it.
- No branding markup, no logo: HMCTS branding is a **service-level** Notify setting and is already selected on
  the non-prod service, so it applies to every template without appearing in the content.

## Questions for the business — none of these is engineering's to answer

1. **Is the wording right at all?** This is the only template with no supplied source, so unlike ③ there is no
   original to diverge from. It needs reading as new copy, not as a port.
2. **The documents come back by post, so why invite a reply?** notify-6 asserts `invitesReply = true`, and the
   draft honours it — but Notify cannot receive an attachment, so a reply can only be a question or "I have
   already posted it". Worth confirming that is the intent, because if the monitored inbox is meant to receive
   *documents* then the sentence is actively misleading and the reply-to is the wrong mechanism.
3. **Should it name a deadline or a consequence?** See the layout note. Today the honest answer is that nothing
   expires, and the draft says so.
4. **Does the caseworker need example prompts?** `documents_required` is free text with no guidance behind it, so
   two caseworkers will phrase the same gap differently. If consistency matters, the answer is a set of
   suggested phrasings in the admin UI rather than anything in the template.
5. **One template for adult and minor, or two?** ① and ② are split by `type`; this draft is not, on the grounds
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
