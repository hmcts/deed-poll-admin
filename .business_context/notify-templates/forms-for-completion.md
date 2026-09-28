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

**`additional_notes` was added to api by notify-4c Task 2 (Steve's decision, 2026-09-26; api #54), and the
template and api must change together.** Notify ignores a key a template has no placeholder for, so a template
without `((additional_notes))` drops the caseworker's note and nothing fails. A template with the placeholder
is refused as missing personalisation by any api that does not send the key. Keep the blank line
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

**The whole body, ready to paste.** It was re-read from `doc_templates/Deed Poll - forms for completion - minor.docx`
on 2026-09-26, because an earlier version of this section listed only the differences from ①. That list missed
the child-specific wording in five places ("on behalf of a child", "the child's final change of name deed", "you
or your child", "knows you and the child", "proof of the child's name change"), and it dropped the affidavit's
"Please note" line. The source is followed verbatim, with the same three Notify changes as ① and with
`((additional_notes))` in the same place.

```
Regarding the application to enrol a deed poll change of name for ((old_forename)) ((old_surname))

Thank you for your application to enrol a deed poll with the High Court on behalf of a child.

To progress your application, we need you to download and complete four forms and return them to us by post. Instructions on how to complete each form and links to more detailed guidance are below:

# Change of name deed (LOC022)

((deed_document))

This form contains the information you provided in your online application and will become the child's final change of name deed once you and your witnesses have signed it and it has been sealed in the High Court.

You need to print and sign this form in front of 2 witnesses. The witnesses will also need to sign the form. The witnesses can have known you for any length of time and must not be related to you or your child by birth or marriage.

You need to post your completed form back to the Deed Poll office along with your completed affidavit of best interest (LOC023), statutory declaration (LOC024) and exhibit cover sheets (LOC028).

# Affidavit of best interest (LOC023)

[attached in Notify: LOC023]

Please note that the Court requires that a solicitor or commissioner of oaths signs this form.

You need to complete an affidavit of best interest to demonstrate to the judge that changing the child's name is in the child's best interest.

As the parent, or person with parental responsibility, you must print and complete the affidavit and swear it is true in the presence of someone authorised to witness the signing of important legal documents. This can be the same person who authorises the swearing to the truth of the statutory declaration.

For more information, read our guidance on completing the affidavit of best interest.

# Statutory declaration for a child (LOC024)

[attached in Notify: LOC024]

Please note that the Court requires that a solicitor or commissioner of oaths signs this form.

A statutory declaration is a document that must be completed by a person that knows you and the child. They must declare that you are who your application says you are. They are referred to as the 'declarant'.

You need to print the statutory declaration (LOC024) for your declarant to complete. The statutory declaration must be printed single-sided.

Once the declarant has completed the statutory declaration, they must swear it is true in the presence of someone authorised to witness the signing of important legal documents.

For more information, read detailed guidance on how to complete the statutory declaration.

# Exhibit cover sheets (LOC028)

[attached in Notify: LOC028]

Please note that the Court requires that a solicitor or commissioner of oaths signs this form.

An 'exhibit' is a document used in court as evidence. The court needs exhibits as proof of who your application says you are.

When your declarant takes the statutory declaration to be verified by the authorised witness, include a cover sheet alongside each exhibit referenced:

* Exhibit A – a photocopy of the change of name deed (LOC022)
* Exhibit B – a copy of the child's birth certificate

When you return your forms to us, you do not need to include the exhibits as we have these on record from your online application. Only include the cover sheet for each exhibit.

For more information, read detailed guidance on exhibits.

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

Once your application has been approved, the Deed Poll office will seal the deed and send it back to you by post. This is proof of the child's name change. ((publish_to_london_gazette??You will also receive a PDF copy of The Gazette notice via email.))

If you have any questions relating to your application you can reply to this email or call the Deed Poll office on 020 3936 8957 (select option 6), Monday to Friday, 9am to 5pm.

Kind regards,
King's Bench Division
```

**How ② differs from ①**, for checking rather than for building. Everything is already in the body above:
four forms rather than three; LOC022, LOC023, LOC024 and LOC028 in place of LOC020, LOC021 and LOC027; a new
affidavit section; the child-specific wording in the five places listed above; Exhibit B is the child's birth
certificate; and there is **no Exhibit C**, so do not carry the adult's marriage/divorce line across. Two small
wording differences are the source's and are kept: "read detailed guidance" (① says "read *our* detailed
guidance"), and the Gazette sentence, whose "if the child's name change is being published" hedge becomes the
conditional exactly as in ①.

## Building ② in the Notify portal, step by step

This is how ① was built. Do it the same way so that the read-back in notify-4a Task 3 has the same shape to
check.

1. **Create an email template named `forms_for_completion_minor`.** Paste the subject from *Subject lines*,
   which is the same for both emails.
2. **Paste the body above.** Everything in `((double brackets))` is a placeholder that api fills. Leave these
   exactly as written, because a misspelt one fails every send: `((old_forename))`, `((old_surname))`,
   `((deed_document))`, `((additional_notes))` and `((publish_to_london_gazette??…))`. The subject also has
   `((reference_number))` and `((online_application_reference))`.
3. **Attach the three static forms: LOC023, LOC024 and LOC028, and nothing else.** Each attached file becomes a
   placeholder named after the file, like ①'s `((LOC021_0226.pdf))`. **Put each one in place of its
   `[attached in Notify: LOC0xx]` marker**, so the link sits under its own heading, and delete the marker line.
   No marker text should be left in the saved template.
4. **Do not attach LOC022.** The deed is per applicant, and api supplies it through `((deed_document))`.
5. **Keep the blank lines** either side of `((additional_notes))`. Without them, Notify runs the note on from
   the paragraph before.
6. **There is no reply-to to set.** Notify takes it per send from api.
7. **Send the template id**, which is `NOTIFY_TEMPLATE_FORMS_FOR_COMPLETION_MINOR`. notify-4a Task 3 then reads
   it back and checks the placeholders and attachments.

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
  `publish_to_london_gazette` and `deed_document` all match. **`((additional_notes))` added in version 8**
  (checked 2026-09-26, after api #54 merged): on its own line between the exhibits guidance and *What happens
  next*, with a blank line either side, as the body above shows.
- **Attachments: LOC021 and LOC027, and nothing else**, as the table requires. In the template they appear as
  `((LOC021_0226.pdf))` and `((LOC027 blank.pdf))`: **a template attachment is a placeholder named after its
  file**, so the name changes if the file is replaced. api sends no value for either. A real send fills both in as
  download links (checked with a send on 2026-09-26), but Notify's *preview* refuses a request that lacks them.
  api answers that with a stand-in for each (`AttachmentStandIns`, notify-4c Task 1, api #54), so admin's check
  page renders.
- **Reply-to:** nothing to set on the template. Notify takes it per send, and api sends
  `NOTIFY_EMAIL_REPLY_TO_ID`.

### ② `forms_for_completion_minor`: authored 2026-09-26, LOC024 attached 2026-09-28

- **Non-prod template UUID:** `a2500c11-b282-48c3-a196-9f5700d13c91` (`NOTIFY_TEMPLATE_FORMS_FOR_COMPLETION_MINOR`),
  version 5 read back on 2026-09-26 and version 9 on 2026-09-28.
- **Subject and placeholders:** `reference_number`, `online_application_reference`, `old_forename`,
  `old_surname`, `publish_to_london_gazette`, `deed_document` and `additional_notes` all match
  character-for-character, in both versions. Every body line of version 5 matches "Body — ② minor" above; version
  9's body was not re-compared line by line.
- **Static forms:** exactly three are attached, as `((LOC023.pdf))`, `((LOC024.pdf))` and `((LOC028.pdf))`. LOC024
  was attached on 2026-09-28, replacing the typed `((LOC024))` that had no file behind it and made Notify refuse
  every send of ②. Now that the key is file-shaped, api's stand-in should cover it and admin's check page for a
  minor should render, but that page has not been run against version 9.
- **Reply-to:** nothing to set on the template.
- **Wording:** unchanged from the draft. The one difference is an extra blank line between "Kind regards," and
  "King's Bench Division", which is cosmetic.


Record here, as `application-rejected.md` and `chase-missing-documents.md` do:

- the two **non-prod template UUIDs**, which are `NOTIFY_TEMPLATE_FORMS_FOR_COMPLETION_ADULT` and
  `…_MINOR`;
- confirmation that the placeholder names match **character-for-character**, including `deed_document`;
- which static forms are attached, by LOC code, so that a check against the table at the top is possible;
- the **reply-to**: nothing to set on the template, since Notify takes it per send from api's
  `NOTIFY_EMAIL_REPLY_TO_ID`;
- any wording the court changed, so `notify-4b`'s Task 4 can be checked against evidence.
