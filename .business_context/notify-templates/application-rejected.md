# ③ `application-rejected` — draft Notify template

**Paste-ready draft for the Notify UI.** Content is transcribed from
[`doc_templates/Deed Poll - Application Rejected.docx`](../doc_templates/Deed%20Poll%20-%20Application%20Rejected.docx)
with the manual markers replaced by placeholders. **Wording is not engineering's to decide** — this is the
existing wording made machine-fillable, not new copy. Anything marked 🔴 needs a decision before it can be
authored as-is.

Written 2026-09-23 for notify-0. The authoritative placeholder contract is
`deed-poll-api`'s `ApplicationRejectedPersonalisation` — if this file and that class disagree, the class wins.

## The contract: exactly seven placeholders

Names must match character-for-character or **Notify rejects the send with a 400**.

| Placeholder | Type | Filled by | Source |
|---|---|---|---|
| `reference_number` | text | resolved | the case reference |
| `online_application_reference` | text | resolved | `onlineApplicationReference` |
| `old_forename` | text | resolved | old-name column |
| `old_surname` | text | resolved | old-name column |
| `applied_online` | **boolean** | resolved | `postCounter` |
| `judges_reason` | text | **caseworker** — pre-populated, editable | `Referral.directionsText` |
| `additional_notes` | text | **caseworker** — optional, may be empty | — |

**A slot with no matching placeholder makes Notify refuse the send**, so do not add a caseworker box here
without the api gaining the slot, and do not drop one without the api losing it.

## ✅ Resolved: the two-way refund branch needs a second flag

**Done 2026-09-23.** `applied_on_paper` is now sent by the api, derived as the negation of `applied_online` in
`ApplicationRejectedPersonalisation.toMap()` — a second record component could be set inconsistently with the
first, where a negation cannot. Applied to `RequestConfirmationToProceedPersonalisation` at the same time, since
④ carries the same two refund paragraphs; doing it then is what stops the defect being rediscovered when ④ is
authored. Original reasoning kept below.

### The original finding

The source document has two mutually exclusive paragraphs — one for applicants who paid online, one for
paper. **Notify's conditional has no `else`**: `((applied_online??…))` shows text when true and there is no
inverse form. With only `applied_online`, the paper paragraph either always renders or never does — and
always-render means telling an online applicant to post their bank details for a refund they are getting
automatically.

**Recommended fix:** the api supplies a second boolean `applied_on_paper`, the negation of `applied_online`,
so each paragraph gets its own conditional. Small change in `ApplicationRejectedPersonalisation` and its
`EmailSlots` exclusion list. The draft below assumes it.

Rejected alternative: having the api resolve the whole refund paragraph as a text value. That puts content in
code, which notify-1's decision 11 rules out — structure and wording live in the template, the api supplies
values.

## Verified in the Notify UI — 2026-09-23

1. **A conditional may span multiple paragraphs and a bullet list.** ✅ The template saved with the paper branch
   wrapping a paragraph and five list items, and a test send rendered it. So **one template with a switch** is
   the shape, and the two-template fallback is not needed — no api-side template selection, and the shared ~90%
   of the wording is not maintained twice.
2. **🔴 How Notify treats a JSON boolean is STILL UNVERIFIED, and it fails silently.** The test sends entered
   `yes`/`no` through Notify's own UI. The api sends a **JSON boolean**. If Notify's API wants the strings,
   *neither* conditional fires on a real send: the applicant gets no refund paragraph at all and nothing errors.
   One real send once `NOTIFY_API_KEY` exists settles it — do that before anything reaches an applicant. The
   note lives at the call site in `ApplicationRejectedPersonalisation.toMap()` as well, so it is not only here.

### Original wording of the two unknowns

Neither could be checked from the devcontainer (`docs.notifications.service.gov.uk` is blocked), so read them
off Notify rather than trusting this file:

1. **Whether a conditional may span multiple paragraphs and a bullet list.** The paper branch below does. If
   Notify only allows a single block, the paper text needs restructuring or its own template.
2. **How Notify treats a JSON boolean `false` in a conditional.** The api sends a real boolean, not the string
   `"no"`. If Notify expects `yes`/`no`, the api must send strings instead — which is a code change, so worth
   knowing before the first send rather than after.

## 🔴 The sign-off is missing

The source document ends `Kind regards,` with **nothing after it** — today a caseworker types it. The template
needs a real sign-off, and it is a business decision what it says (team name, office, contact line).

---

## Subject

```
Your deed poll application ((reference_number)) (online application reference: ((online_application_reference))) – application rejected
```

## Body

```
Regarding the application to enrol a deed poll change of name for ((old_forename)) ((old_surname))

Thank you for applying to enrol a deed poll with the High Court.

The court has been unable to enrol the deed poll. We received the judge's instructions regarding your application and they have stated the following:

((judges_reason))

((applied_online??Your application will be cancelled and we will issue your refund to the same account you used to pay for the application.))

((applied_on_paper??Please provide us with the information below so we can cancel your application and process your refund.

* The old name and new name on the application
* How payment was made, for example by cheque, postal order or card payment
* If payment was made by cheque, we would need to know the name of the account holder
* If the payment was made by postal order, the court will need to know who to make the postal order to
* What address you would like the refund sent to. We will also return your forms to this address.))

((additional_notes))

Kind regards,
King's Bench
```

## Three corrections to apply in the Notify portal — 2026-09-23

Read off the saved template. All three are cosmetic in the sense that nothing errors, which is why they are
worth writing down: none of them would fail a test or a send.

1. **The five refund lines have lost their `*` bullet markers.** Without them Notify renders five separate
   paragraphs rather than a list. For an instruction an applicant has to work through item by item, the list
   is materially easier to act on. (It is possible the markers are present and were lost copying out of a
   rendered preview rather than the editor — worth confirming in the edit view.)

2. **`((additional_notes))` needs a blank line above it.** As saved it sits directly after the conditional's
   closing `))`, and Notify's markdown treats consecutive lines as one paragraph — so a caseworker's note runs
   on from the last refund line instead of starting its own.

3. **The sign-off reads `Kings Bench`; it should be `King's Bench`.** The division is the King's Bench
   Division, which is what the `KBDP` reference prefix stands for. A missing apostrophe in the court's own name
   in applicant-facing correspondence is the kind of thing that gets noticed. Whether the sign-off should be
   fuller — "King's Bench Division", an office name, a contact line — is still a content decision.

## Notes on the layout

- **`judges_reason` and `additional_notes` are the only free text**, and they arrive as *unformatted prose*
  from the Email tab. Both sit on their own paragraph deliberately, so a long judge's reason cannot break a
  sentence around it. Do not move either mid-sentence.
- The source wraps the judge's quote as `“…” {insert judge's reason for refusal}`. The curly quotes are
  dropped here: the caseworker's text is inserted verbatim, so quoting it in the template would double up on
  any quotation marks the judge used. Add them back only if the business wants the quote visually marked.
- `additional_notes` renders as nothing when the caseworker leaves it empty, which is the normal case. It is
  **not** wrapped in a conditional — a Notify conditional expects a yes/no field, and this is free text.
- No reply-to is needed for this template. ③ does not invite a reply; reply-to is blocking for ①②④⑤ only.

## Authored 2026-09-23 — the non-prod template id

| Service | Template UUID |
|---|---|
| **non-prod** | `b2cb5754-591d-40c0-b961-b2823a5792eb` |
| prod | not yet — the prod service does not exist |

**It saved with both conditionals**, including the paper branch wrapping a paragraph *and* a bullet list, so
the one-template-with-a-switch shape is confirmed viable and the two-template fallback is not needed.

**Where this id goes, and it is not `application.yaml`.** That file reads
`application-rejected: ${NOTIFY_TEMPLATE_APPLICATION_REJECTED:DEED_POLL_PLACEHOLDER}` — the default stays the
placeholder deliberately, so one grep still lists every external identifier the service is waiting on. The real
value is an **environment variable per environment**, set in `charts/deed-poll-api`, which today sets no
`NOTIFY_*` variables at all. Adding it is a chart change, and it is safe to make before the API key exists:
`NotifyProperties.isProvisioned` gates the send, so a real template id with no key sends nothing rather than
half-sending.

## After it is authored

- Record the **template UUID per environment** — see the table above. These are **not secrets**: config and
  environment variables, not key vault.
- Branding is a **service** setting and applies to every template automatically; nothing to do per template.
- The caseworker Email tab's preview **will still render unbranded**. That is a known
  Content-Security-Policy effect in `deed-poll-admin`, not a branding failure. The wording is exact; only the
  appearance is not.
