# ① `forms-for-completion-adult` and ② `forms-for-completion-minor` — draft Notify templates

**Two templates, one file**, because the differences between them are the point and a reader needs them side by
side. Written 2026-09-25 from the supplied `Deed Poll - forms for completion - adult.docx` and
`… - minor.docx` — so unlike ⑤ these are **ports of real court wording**, not new copy. The wording below is the
source's, changed only where Notify forces a change; every such change is called out.

## Which email, which forms

| | ① `forms-for-completion-adult` | ② `forms-for-completion-minor` |
|---|---|---|
| Sent when | `type` is `Adult` or `AdultTransgender` | `type` is `Minor` or `MinorTransgender` |
| Says | *"three forms"* | *"four forms"* |
| Deed — **generated per case** | **LOC020** change of name deed | **LOC022** change of name deed |
| Static | **LOC021** statutory declaration | **LOC023** affidavit of best interest |
| Static | — | **LOC024** statutory declaration for a child |
| Static | **LOC027** exhibit cover sheets | **LOC028** exhibit cover sheets |
| Exhibit B is | evidence of citizenship | a copy of the child's birth certificate |
| Exhibit C | marriage/civil partnership certificate, divorce decree or spouse's death certificate | *(not in the minor text)* |

**Only the deed is personalised.** LOC021/023/024/027/028 are the same bytes for every applicant, so they are
**attached to the template in GOV.UK Notify** and api never touches them. LOC020/LOC022 carry the applicant's data
and are produced per case, which is `notify-4b`'s job (merged 2026-09-26, api #52).

## How the right forms reach the right email

**Two mechanisms, split by whether the document changes per applicant.** Corrected 2026-09-26: an earlier version
of this section had api supply all four documents as placeholders, before it was found on 2026-09-25 that Notify
lets a file be attached to the template itself.

| Document | How it reaches the email |
|---|---|
| **The deed, LOC020 / LOC022** | The `((deed_document))` placeholder. api generates the deed once per case, and immediately before sending replaces the value with `prepareUpload(bytes, filename, true, retention)`, so Notify renders a download link where the placeholder sits |
| **The static forms**, LOC021 / LOC023 / LOC024 / LOC027 / LOC028 | **Attached to the template in the Notify portal.** api sends no value for them and has no key for them |

**`deed_document` is the only document key api sends**, for both templates. Do not add `statutory_declaration`,
`affidavit_of_best_interest` or `exhibit_cover_sheets` placeholders expecting api to fill them: api does not send
those keys, and Notify refuses a send whose template has a placeholder with no value.

**Which static forms go on which template is the table above, and getting it wrong cannot be caught by api.**
api only decides which *template* a case gets (adult types get ①, minor types get ②). What files are attached to
each template is Notify's configuration, so the minor forms on ① would reach every adult applicant with nothing
failing. Check the attachments against the table when authoring, and again whenever one is replaced.

**Put each form's link where the source names that form.** The source has a heading per form (*"Statutory
declaration (LOC021)"*) followed by instructions; the link belongs immediately under the heading, so an applicant
reads what the form is and then downloads it. The bodies below mark each position: `((deed_document))` is the api
placeholder, and `[attached in Notify: LOC0xx]` marks where a template attachment's link goes.

## The personalisation keys that are not documents

| Key | Column | Where |
|---|---|---|
| `reference_number` | the case reference | subject |
| `online_application_reference` | `onlineApplicationReference` — **nullable, resolves to empty** | subject |
| `old_forename` | `oldForename` | opening line |
| `old_surname` | `oldSurname` | opening line |
| `publish_to_london_gazette` | `publishToLondonGazette` — boolean | the Gazette sentence, conditional |
| `additional_notes` | **caseworker**, optional, may be empty | its own paragraph before *What happens next* |

**`additional_notes` is being added to api by notify-4a Task 5 (Steve's decision, 2026-09-26), and the template
and api must change together.** Notify ignores a key a template has no placeholder for, so if api sends a note
before `((additional_notes))` is in the template, the note is dropped and nothing fails. If the placeholder
arrives first, every send is refused as missing personalisation until api sends the key. Keep the blank line
above it: without one, Notify's markdown runs the note on from the paragraph before (the lesson from ③).

**It addresses the applicant by their OLD name, deliberately** — the new name is not theirs until the deed is
sealed, and this email carries the instrument that does it. Do not change this to the new name.

## Three changes Notify forces on the source wording

**1. "attached" must become "download".** The source says *"we have attached three forms"*. Notify's *send a file
by email* produces a **link**, not a MIME attachment. An email promising an attachment and delivering a link is a
support call. Suggested: *"we need you to download and complete three forms"*.

**2. The Gazette sentence becomes a conditional.** The source hedges — *"You will also receive a PDF copy of The
Gazette notice via email, if your name change is being published in The Gazette"* — because a Word document
cannot branch. A template can:

```
((publish_to_london_gazette??You will also receive a PDF copy of The Gazette notice via email.))
```

**3. The sign-off needs completing.** The source ends `Kind regards,` with nothing after it — a caseworker typed
it. Use **`King's Bench Division`**, matching ③ and ⑤.

## Subject lines

```
Your deed poll application ((reference_number)) (online application reference: ((online_application_reference))) – forms for completion
```

Identical for both, and identical in shape to ③ and ⑤ so the service reads as one thing in an inbox.

## Body — ① adult

The source verbatim except the three changes above. `((deed_document))` is the api placeholder; each `[attached in Notify: …]` is where that attachment's link goes.

```
Regarding the application to enrol a deed poll change of name for ((old_forename)) ((old_surname))

Thank you for applying to enrol a deed poll with the High Court.

To progress your application, we need you to download and complete three forms and return them to us by post. Instructions on how to complete each form and links to more detailed guidance are below:

# Change of name deed (LOC020)

((deed_document))

This form contains the information you provided in your online application and will become your final change of name deed once you and your witnesses have signed it and it has been sealed in the High Court.

You need to print and sign this form in front of 2 witnesses. The witnesses will also need to sign the form. The witnesses can have known you for any length of time and must not be related to you by birth or marriage.

You need to post your completed form back to the Deed Poll office along with your completed statutory declaration (LOC021) and exhibit cover sheets (LOC027).

# Statutory declaration (LOC021)

[attached in Notify: LOC021]

Please note that the Court requires that a solicitor or commissioner of oaths signs this form.

A statutory declaration is a document that must be completed by a person that knows you. They must declare that you are who your application says you are. They are referred to as the 'declarant'.

You need to print the statutory declaration (LOC021) for your declarant to complete. The statutory declaration must be printed single-sided.

Once the declarant has completed the statutory declaration, they must swear it is true in the presence of someone authorised to witness the signing of important legal documents.

For more information, read our detailed guidance on how to complete the statutory declaration.

# Exhibit cover sheets (LOC027)

[attached in Notify: LOC027]

Please note that the Court requires that a solicitor or commissioner of oaths signs this form.

An 'exhibit' is a document used in court as evidence. The court needs exhibits as proof of who your application says you are.

When your declarant takes the statutory declaration to be verified by the authorised witness, include a cover sheet alongside each exhibit referenced:

* Exhibit A – a photocopy of the change of name deed (LOC020)
* Exhibit B – evidence of citizenship
* Exhibit C – marriage or civil partnership certificate (if married or in a civil partnership) or divorce decree (if divorced) or spouse's death certificate (if widowed)

When you return your forms to us, you do not need to include the exhibits as we have these on record from your online application. Only include the cover sheet for each exhibit.

For more information, read our detailed guidance on exhibits.

((additional_notes))

# What happens next

Once you have completed the relevant forms, post your forms to the Deed Poll office:

Deed Poll office
King's Bench Division
Room E15
The Royal Courts of Justice
Strand
London
WC2A 2LL

Once your application has been approved, the Deed Poll office will seal your deed and send it back to you by post. This is proof of your name change. ((publish_to_london_gazette??You will also receive a PDF copy of The Gazette notice via email.))

If you have any questions relating to your application you can reply to this email or call the Deed Poll office on 020 3936 8957 (select option 6), Monday to Friday, 9am to 5pm.

Kind regards,
King's Bench Division
```

## Body — ② minor

Same shape. The differences, all from the source:

- *"four forms"* rather than three.
- **LOC022** rather than LOC020, and the post-back sentence names *"affidavit of best interest (LOC023), statutory declaration (LOC024) and exhibit cover sheets (LOC028)"*.
- Its template attachments are **LOC023, LOC024 and LOC028**; the LOC023 section below marks its link, and the
  LOC024 and LOC028 links sit under their sections the same way.
- A new section between the deed and the statutory declaration:

```
# Affidavit of best interest (LOC023)

[attached in Notify: LOC023]

You need to complete an affidavit of best interest to demonstrate to the judge that changing the child's name is in the child's best interest.

As the parent, or person with parental responsibility, you must print and complete the affidavit and swear it is true in the presence of someone authorised to witness the signing of important legal documents. This can be the same person who authorises the swearing to the truth of the statutory declaration.

For more information, read our guidance on completing the affidavit of best interest.
```

- The statutory declaration section is headed **"Statutory declaration for a child (LOC024)"**.
- Exhibit cover sheets are **LOC028**, and **Exhibit B is "a copy of the child's birth certificate"**. The source
  lists no Exhibit C for a minor — do not carry the adult's marriage/divorce line across.
- Everything else — the deed instructions, *What happens next*, the address, the phone line, the sign-off — is the
  same.

## ⚠️ Both these emails invite a reply, which the plan had not noticed

Both sources end *"you can reply to this email or call the Deed Poll office…"*. So ① and ② need
`invitesReply = true` and therefore the **reply-to id** — `aabceef1-63e4-4414-9554-a24b0be967d7` for
`KBDEEDSPOLL@justice.gov.uk`, which already exists. Without it Notify **silently drops** the reply-to and sends
from no-reply, so *"you can reply to this email"* would point nowhere while the email still went out.

`notify-4`'s decisions treated reply-to as ④ and ⑤'s concern. It is these two as well, and it costs nothing
because the id is already configured — it just has to be set on these templates when authoring.

## Also worth knowing: the real postal address is here

⑤ `chase-missing-documents` currently says *"by post, to the address on the forms we sent you"* because the
address was not to hand. It is: **Deed Poll office, King's Bench Division, Room E15, The Royal Courts of Justice,
Strand, London WC2A 2LL**, and the phone line is **020 3936 8957 (select option 6), Monday to Friday, 9am to
5pm**. Worth putting both into ⑤ when it is next edited — an applicant chasing a missing document should not have
to find an older email.

## After they are authored

### ① `forms_for_completion_adult`: authored 2026-09-25, checked 2026-09-26

- **Non-prod id `91a89945-bfa6-4423-86f5-be6f1c782aa5`**, which is `NOTIFY_TEMPLATE_FORMS_FOR_COMPLETION_ADULT`. It
  is **not yet in api's chart**, deliberately: see notify-4a decision 7.
- **Placeholders checked against api character for character** on version 7, via `GET /v2/template/{id}`: the
  subject, `reference_number`, `online_application_reference`, `old_forename`, `old_surname`,
  `publish_to_london_gazette` and `deed_document` all match. `((additional_notes))` is **not in it yet**; add it
  when notify-4a Task 5 lands, where the body above shows.
- **Attachments: LOC021 and LOC027, and nothing else**, as the table requires. In the template they appear as
  `((LOC021_0226.pdf))` and `((LOC027 blank.pdf))`: **a template attachment is a placeholder named after its
  file**, so the name changes if the file is replaced. api sends no value for either. A real send fills both in as
  download links (checked with a send on 2026-09-26), but Notify's *preview* refuses a request that lacks them,
  which is notify-4a Task 4.
- **Reply-to:** nothing to set on the template. Notify takes it per send, and api sends
  `NOTIFY_EMAIL_REPLY_TO_ID`.

### ② `forms_for_completion_minor`: not yet authored


Record here, as `application-rejected.md` and `chase-missing-documents.md` do:

- the two **non-prod template UUIDs**, which are `NOTIFY_TEMPLATE_FORMS_FOR_COMPLETION_ADULT` and
  `…_MINOR`;
- confirmation that the placeholder names match **character-for-character**, including `deed_document`;
- which static forms are attached, by LOC code, so that a check against the table at the top is possible;
- that the **reply-to is set** on both;
- any wording the court changed, so `notify-4b`'s Task 4 can be checked against evidence.
