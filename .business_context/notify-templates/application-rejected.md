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

## 🔴 Blocker: the two-way refund branch needs a second flag

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

## 🔴 Two things to verify in the Notify UI

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
[SIGN-OFF TO BE DECIDED — see above]
```

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

## After it is authored

- Record the **template UUID per environment** into `deed-poll-api`'s `application.yaml` under
  `notify.templates.*`. These are **not secrets** — config, not key vault.
- Branding is a **service** setting and applies to every template automatically; nothing to do per template.
- The caseworker Email tab's preview **will still render unbranded**. That is a known
  Content-Security-Policy effect in `deed-poll-admin`, not a branding failure. The wording is exact; only the
  appearance is not.
