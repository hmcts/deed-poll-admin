# ④ `request-confirmation-to-proceed` — draft Notify template

**Paste-ready draft for the Notify UI.** Content is transcribed from
[`doc_templates/Deed Poll - Request confirmation to proceed.docx`](../doc_templates/Deed%20Poll%20-%20Request%20confirmation%20to%20proceed.docx)
with the manual markers replaced by placeholders. **Wording is not engineering's to decide** — this is the
existing wording made machine-fillable, not new copy.

Written 2026-09-26. The authoritative placeholder contract is `deed-poll-api`'s
`RequestConfirmationToProceedPersonalisation` — if this file and that class disagree, the class wins.

**When it is sent:** a judge has refused a request *not* to publish in The Gazette, but the deed can still be
enrolled. The email asks the applicant to reply saying whether they want to go ahead or be refunded. api only
offers it off a `Rejected` referral raised for `NonPublication`, and it is one of a pair with ③: a referral
gets one or the other, never both.

## The contract: exactly ten placeholders

Names must match character-for-character. **A placeholder the api doesn't send makes Notify refuse every send**,
and a key the api sends that the template doesn't use is silently dropped — so a misspelt `((judges_reason))`
would lose the judge's words with nothing failing.

| Placeholder | Type | Filled by | Source |
|---|---|---|---|
| `reference_number` | text | resolved | the case reference |
| `online_application_reference` | text | resolved | `onlineApplicationReference` |
| `old_forename` | text | resolved | old-name column |
| `old_surname` | text | resolved | old-name column |
| `applied_online` | **boolean** | resolved | `postCounter` |
| `applied_on_paper` | **boolean** | resolved | the negation of `applied_online` |
| `is_minor` | **boolean** | resolved | `type` (`Minor`, `MinorTransgender`) |
| `decision_date` | text | resolved | `Referral.decisionDate`, as e.g. `26 September 2026` |
| `judges_reason` | text | **caseworker** — pre-populated, editable | `Referral.directionsText` |
| `additional_notes` | text | **caseworker** — optional, may be empty | — |

Every key is always sent, even when blank. `decision_date` is stamped when the judge decides the referral, so
for this email it is always present.

## How the source's manual markers became placeholders

| Source document | Template |
|---|---|
| `deedpoll_referencenumber`, `deedpoll_onlineapplicationreference`, `deedpoll_oldforename`, `deedpoll_oldsurname` | `((reference_number))` and the rest, as ③ and ① use |
| `To: deedpoll_applicantemail` | nothing — api sends to the applicant's address |
| `your [child's] [delete if an adult application] details` (twice) | `your ((is_minor??child's ))details` |
| `On XX/YY/ZZZZ we received instructions` | `On ((decision_date)) we received instructions` |
| `"…" [Enter judge's comments]` | `((judges_reason))` on its own paragraph, without the quotation marks — as ③ |
| `[If the applicant applied online …]` / `[If the applicant applied on paper …]` | `((applied_online??…))` and `((applied_on_paper??…))`, since Notify's conditional has no `else` |
| `Kind regards,` with nothing after it | `Kind regards,` then `King's Bench Division`, as ③ and ① sign off |

**The paper refund list is ③'s wording, as authored**: a colon after the lead-in and each bullet starting in
lower case. The source document is otherwise identical to ③'s source here, so ④ follows what ③ settled on
rather than reopening it.

---

## Subject

```
Your deed poll application ((reference_number)) (online application reference: ((online_application_reference)))
```

As in the source document, with no suffix. Unlike ③, it doesn't say what the email is about. Whether to add
one (say, "– please confirm how you want to proceed") is a content decision, not a defect.

## Body

```
Regarding the application to enrol a deed poll change of name for ((old_forename)) ((old_surname))

Thank you for applying to enrol a deed poll with the High Court.

Your application was referred to a judge for a decision as you provided us with a statement requesting for your ((is_minor??child's ))details not to be published in The Gazette.

On ((decision_date)) we received instructions from the judge on this matter. They have rejected your request. They have stated the following:

((judges_reason))

If you still wish to enrol the deed poll then let us know by replying to this email so we can pass on your ((is_minor??child's ))change of name for enrolment.

((applied_online??If you no longer wish to enrol your deed poll, then let us know by replying to this email so we can cancel your application and process your refund. We will issue your refund to the same account you used to pay for the application.))

((applied_on_paper??If you no longer wish to enrol your deed poll, then please provide us with the information below so we can cancel your application and process your refund:

* the old name and new name on the application
* how payment was made, for example by cheque, postal order or card payment
* if payment was made by cheque, we would need to know the name of the account holder
* if the payment was made by postal order, the court will need to know who to make the postal order to
* what address you would like the refund sent to. We will also return your forms to this address.))

((additional_notes))

Kind regards,

King's Bench Division
```

## Building it in the Notify portal

1. **Templates → New template → Email.** Name it `request_confirmation_to_proceed`. The name is only a
   label, but it matches the others.
2. Paste the **Subject** and **Body** above exactly, including the blank lines. Each free-text placeholder
   (`judges_reason`, `additional_notes`) must sit on its own paragraph, or Notify runs it into the text
   around it.
3. **No attachments.** Unlike ① and ②, this email carries no forms.
4. **No reply-to on the template.** It invites a reply, but Notify takes the reply-to per send and api sends
   `NOTIFY_EMAIL_REPLY_TO_ID` (`KBDEEDSPOLL@justice.gov.uk`), which is already in the chart. Without it, api
   reports this template unprovisioned, which is on purpose: a reply to the no-reply sender would lose the one
   thing this email is for.
5. Save, and send the template id back so it can be read back and checked.

## ✅ Authored and verified — 2026-09-26

`a58c5a8c-7727-4d1f-af08-4953d9f3d33e`, version 1, named `request_confirmation_to_proceed`, read back with
`GET /v2/template/{id}`:

- **Subject:** identical to the draft.
- **Placeholders:** exactly the ten in the table, no more and no fewer.
- **Body:** identical line for line, except that there's no blank line between "Kind regards," and "King's
  Bench Division". The preview renders that as a line break (`Kind regards,<br>King’s Bench Division`), which
  reads fine, so it has been left as it is.
- **Previews** (which send nothing): an adult who applied online got "your details" and "your change of name",
  the online refund paragraph and no paper list. A minor who applied on paper got "your child's details" and
  "your child's change of name", the paper list and no online paragraph. So Notify keeps the trailing space
  inside `((is_minor??child's ))`, and `is_minor` works as a JSON boolean. Both 🔴 checks below are settled.

## What the read-back checks, and one thing only a preview can settle

After you send the id, I'll read the template back with `GET /v2/template/{id}` and check it against the table
above, character for character. Then I'll run **two previews** (they send nothing), because the read-back can't
settle one thing:

- **✅ (settled above) Does the `child's ` conditional leave a double space for an adult?** `((is_minor??child's ))details`
  puts the space inside the conditional, so an adult's email should read "your details" and a minor's "your
  child's details". That only holds if Notify keeps the trailing space inside a conditional. If it trims it, a
  minor's email reads "your child'sdetails", and the fix is `((is_minor??child's)) details` instead, at the cost
  of a double space for adults. Previewing once with `is_minor: true` and once with `false` settles it.
- **✅ (settled above) `is_minor` as a JSON boolean.** Measured for `applied_online` on ③ (2026-09-23), but this is a new
  placeholder in a new template. The api flags it as unverified here (`toMap`), so the same two previews check
  it rather than assuming ③'s result carries over.

## Known, and not blocking

- **A paper applicant's subject ends `(online application reference: )`**, the same as ③ and ①. It's already
  on the list of non-blockers in api's notify-4a plan.

## After it is authored

| Service | Template UUID |
|---|---|
| **non-prod** | `a58c5a8c-7727-4d1f-af08-4953d9f3d33e` |
| prod | not yet — the prod service does not exist |

The id is set, as of deed-poll-api's chart change on 2026-09-26, in `deed-poll-api/charts/deed-poll-api/values.yaml` as `NOTIFY_TEMPLATE_REQUEST_CONFIRMATION_TO_PROCEED`,
which is the only change needed to make admin offer it. As with every email, nothing actually sends in AAT until the AAT Notify key exists
(azure-access#8111).
