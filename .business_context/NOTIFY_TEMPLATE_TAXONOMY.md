# GOV.UK Notify — taxonomy of the existing templates

Analysis of the six `.docx` files in [`doc_templates/`](doc_templates/), written 2026-09-18 as the research
step before the notify plans. Scope of the feature is **the admin system only**, so every send below is
triggered by a caseworker action.

**Read the confidence column.** What each template *is* and what data feeds it comes from the file itself and
is fact. **When** it is sent is inferred from the template's own wording plus `DeedPollState`,
`MasterDecision` and `ReferralReason` in `deed-poll-api` — it is not documented anywhere, and the business
should confirm it before the plans are run.

---

## 1. The six files are two different kinds of artefact

This is the first thing that matters, because only one kind is a Notify template.

**Four are emails.** They begin with literal `To:` and `Subject:` lines and read as correspondence.

**Two are the deed itself** — the legal instrument, mail-merged from case data. They are not emails; they are
the *attachments* to two of the emails above, and later the document that is sealed and posted back.
`Deed Poll Adult Deed.docx` is the LOC020 that the adult forms-for-completion email describes as *"This form
contains the information you provided in your online application"*.

| # | File | Kind | Notify template? |
|---|---|---|---|
| 1 | `Deed Poll - forms for completion - adult.docx` | Email + 3 attachments | ✅ yes |
| 2 | `Deed Poll - forms for completion - minor.docx` | Email + 4 attachments | ✅ yes |
| 3 | `Deed Poll - Application Rejected.docx` | Email | ✅ yes |
| 4 | `Deed Poll - Request confirmation to proceed.docx` | Email | ✅ yes |
| 5 | `Deed Poll Adult Deed.docx` | Document (LOC020), mail-merged | ❌ document generation |
| 6 | `Deed Poll Minor Deed.docx` | Document (LOC022), mail-merged | ❌ document generation |

**Notify cannot produce 5 and 6.** It has no mail-merge for a Word document. Personalised documents are a
separate capability — `pcs-api` uses `doc-assembly-client` against Docmosis for exactly this. So the deeds are
either a second feature or an explicitly-flagged dependency of this one; they are not four more Notify
templates.

### Forms referenced but not supplied

The two forms-for-completion emails name blank forms that are not in `doc_templates/`. These look like static
published PDFs rather than personalised documents, so they are probably fine as fixed links — worth confirming.

| Form | Purpose | Adult | Minor |
|---|---|---|---|
| LOC020 / LOC022 | The change of name deed — **personalised** | ✅ supplied | ✅ supplied |
| LOC021 / LOC024 | Statutory declaration (declarant; needs a solicitor or commissioner of oaths) | ❌ missing | ❌ missing |
| LOC023 | Affidavit of best interest (minor only) | — | ❌ missing |
| LOC027 / LOC028 | Exhibit cover sheets | ❌ missing | ❌ missing |

---

## 2. What data feeds them

Every merge field in all six files resolves against `deed-poll-api`'s existing model. **Nothing needs a new
case column.** Names below are the Dynamics-style merge tokens as they appear in the documents.

### Common to all four emails

| Merge token | Source | Notes |
|---|---|---|
| `deedpoll_applicantemail` | `applicantEmail` (`V2__deed_poll.sql:54`) | The recipient. Nullable → needs the skip-and-log guard |
| `deedpoll_referencenumber` | `referenceNumber` / `displayReference` | Both exist; `displayReference` is the rendered one |
| `deedpoll_onlineapplicationreference` | `onlineApplicationReference` | Quoted in every subject line |
| `deedpoll_oldforename`, `deedpoll_oldsurname` | `oldForename`, `oldSurname` | In the "Regarding…" line |

### Additional, in the two deed documents

| Merge tokens | Source |
|---|---|
| `deedpoll_newforename` / `newmiddlename` / `newsurname`, `oldmiddlename` | The six name columns |
| `deedpoll_applicantbuildingnoname`, `applicantaddress1`, `applicantaddress2`, `applicanttowncity`, `applicantpostcode` | The applicant address columns |
| `deedpoll_status` | `maritalStatus` |
| `deedpoll_nationality`, `deedpoll_section`, `deedpoll_sectionother` | `nationality`, `nationalitySection`, `nationalitySectionOther` |
| `deedpoll_date` | The date the deed is made |
| `deedpoll_parents` *(minor)* | `parents` |
| `deedpoll_ageofminor` *(minor)* | `ageOfMinor`, or derived from `minorDateOfBirth` |

### Fields that come from the referrals feature, not the case

This is the useful overlap: three of the four emails quote the judge, and that data now exists because of the
api-1/2/3 work just merged.

| What the template asks for | Source |
|---|---|
| `"…" {insert judge's reason for refusal}` | `Referral.directionsText` (V8) |
| `On XX/YY/ZZZZ we received instructions from the judge` | `Referral.decisionDate` (V8) — **left as a literal placeholder in the template today** |
| Which rejection this is | `Referral.reasons` + `Referral.decision` — see §4 |

### What a caseworker does by hand today — three different kinds

**These are not mail-merge templates with a few gaps. They are Word documents a caseworker edits and sends
from Outlook.** Only the `deedpoll_*` tokens are merge fields; everything in brackets is an instruction to a
person. The clearest tell is `XX/YY/ZZZZ` in template ④ — a date nobody turned into a merge token, even
though `Referral.decisionDate` would fill it.

**Kind 1 — free text the caseworker composes or transcribes.** Not derivable; needs a human.

| Instruction | Template | Now available as data? |
|---|---|---|
| `"…" {insert judge's reason for refusal}` | ③ | `Referral.directionsText` (api-3) — but see below |
| `"…" [Enter judge's comments]` | ④ | `Referral.directionsText` |
| `On XX/YY/ZZZZ we received instructions from the judge` | ④ | `Referral.decisionDate` |
| `Kind regards,` with nothing after it | ① ② ③ ④ | The sign-off is typed |

**Kind 2 — delete one of two blocks.** Mechanisable; every discriminator exists as data.

| Instruction | Templates | Discriminator |
|---|---|---|
| `[If the applicant applied online … delete if they applied on paper]` | **③ and ④** | `postCounter` |
| `[child's] [delete if an adult application]` (twice in ④) | ④ | `type` (`DeedPollType`) |
| *"if your name change is being published in The Gazette"* | ① ② | `publishToLondonGazette` |

**Kind 3 — strike out, on the deed documents.**

| Instruction | Template |
|---|---|
| `(Strike out if not changing the minor's forename)` on the Re: Parrott clause | ⑥ Minor Deed |

Unexplained asymmetry: the Adult Deed carries the same Re: Parrott sentence as a standalone quoted line with
**no** strike-out instruction. Either it is always included for adults, or the instruction lives in formatting
not visible in the document XML. Worth asking.

### Design decided from this (Steve, 2026-09-18)

The free text is the reason this feature is not "the system sends an email when a state changes".

- **An Email tab in `deed-poll-admin`.** The caseworker picks an email type, is shown the template **populated
  from case and referral data**, adds their text, and sends. The api resolves the data and talks to Notify.
- **Structure lives in the Notify template; the caseworker's text fills named slots.** Notify email templates
  accept no HTML, and personalisation values are inserted as plain text — so passing a whole composed body
  would lose the headings, bullets and links these emails depend on, and would bypass the Notify rendering
  that produces the official GOV.UK look. Instead the template holds the structure and branding, and the
  caseworker's contribution goes into defined placeholders.
- **Defined slots only.** The caseworker fills the judge's reason and an optional notes slot. Resolved merge
  values are not editable, so the applicant always receives approved wording around the variable part.
- **The preview is rendered by Notify, not reproduced by us.** `NotificationClient.generateTemplatePreview`
  returns the real subject and HTML for a given personalisation, so what the caseworker approves is what
  sends — no second copy of the content to drift. `getVersion()` records which template version they approved.
- **Attachments become secure download links.** `prepareUpload` puts a time-limited link in the email rather
  than attaching a file, and `RetentionPeriodDuration` makes the expiry configurable — which matters, because
  an applicant must print, sign in front of two witnesses and post.

**Open question on the judge's text:** whether the caseworker sends `directionsText` verbatim or edits it
first. The design above works either way — the slot is pre-populated from the direction and editable — but if
it is normally edited, the stored personalisation is the only record of what the applicant was actually told,
which is why the outbox stores it rather than recomputing.

---

## 3. When each is sent

Inferred process. `DeedPollState` members are in **bold**.

1. Application arrives — online via `deed-poll-web` or on paper. Case is **Received**; `postCounter` records
   the channel.
2. Caseworker checks it and sends **① or ② forms for completion**, with the generated deed attached.
   Fits **AwaitingSignature** — the email's whole purpose is to get the deed printed and signed in front of
   two witnesses. Adult vs minor is chosen by `type`.
3. Applicant posts the signed deed, statutory declaration and exhibit cover sheets back.
4. Caseworker receives them → **ReadyForMaster**, or **AwaitingFurtherDocs** if something is missing.
   *No template supplied for chasing missing documents — see §5.*
5. Anything needing a judge → **ReferredToMaster**, with `ReferralReason` recording why
   (`NonPublication`, `DomesticAbuse`, `Minor`, `DeclarantRequirementsNotMet`, `SeparatedOrEstranged`, `Other`).
6. The judge directs — `MasterDecision` `Approved` or `Rejected`, plus `directionsText` and `decisionDate`.
7. On the direction, the caseworker sends one of:
   - **③ Application Rejected** — enrolment refused. Quotes the judge, then starts a refund, branching on
     whether the applicant paid online or on paper. Fits **Returned**.
   - **④ Request confirmation to proceed** — the judge refused a *non-publication* request but the deed can
     still be enrolled. Asks the applicant to confirm they still want it. Also fits **Returned**, and the
     case then waits on a reply.
   - Nothing, if approved → **AwaitingEnrolment** → sealed → **Enroled**.
8. Sealed deed is **posted** back, not emailed. If publishing, the applicant *"will also receive a PDF copy of
   The Gazette notice via email"* — **a fifth email with no template supplied.** `dateNoticeSentToLondonGazette`
   exists on the case, so the trigger is modelled; the content is not.

| # | Template | Trigger (caseworker action) | Likely state | Confidence |
|---|---|---|---|---|
| ① | forms for completion — adult | Application checked, `type` is `Adult` or `AdultTransgender` | AwaitingSignature | **High** — `AwaitingSignature` is derived from `signatureRequestedDate`, so this send *is* the signature request |
| ② | forms for completion — minor | Application checked, `type` is `Minor` or `MinorTransgender` | AwaitingSignature | **High** — same derivation |
| ③ | Application Rejected | Judge's direction actioned, enrolment refused | Returned | High |
| ④ | Request confirmation to proceed | Judge's direction actioned, `NonPublication` refused | Returned | High |
| ⑤ | Gazette notice PDF | Notice published | Enroled | **Template missing** |

---

## 4. The modelling problem worth resolving before the plans

**Two different emails hang off the same `Rejected` decision, and the decision alone cannot tell them apart.**

`MasterDecision` is only `Approved | Rejected`. A rejection means "enrolment refused" for ③ but "your
non-publication request is refused, enrolment may still proceed" for ④ — opposite outcomes for the applicant.
The discriminator has to be `ReferralReason`: `NonPublication` present → ④, otherwise → ③.

That works for a single-reason referral. **It does not work for a multi-reason one**, and referrals are
deliberately multi-select: a referral raised for both `NonPublication` *and* `DeclarantRequirementsNotMet`
gets one `Rejected` and one free-text direction covering both, which cannot be decomposed into "which request
was refused".

**Recommendation: the caseworker chooses which email to send.** The scope is admin-only and a caseworker is
already reading the direction to action it, so choosing is work they are doing anyway — and it sidesteps a
derivation that would be wrong in exactly the cases that matter most. Deriving per-reason outcomes would mean
changing the direction model, which is a bigger change than this feature.

---

## 5. Gaps to close before or during the plans

1. **No template for chasing missing documents**, though **AwaitingFurtherDocs** exists as a state.
2. **No template for the Gazette notice email**, though the emails promise one.
3. **The blank forms (LOC021, LOC023, LOC024, LOC027, LOC028) are not here.**
4. **Notify sends files as secure links, not attachments.** `prepareUpload()` puts a time-limited link in the
   email body; it does not attach a file. Every forms-for-completion email says *"we have attached three
   forms"*. That wording has to change, or the documents have to reach the applicant another way. This is a
   content decision, not an engineering one, and it affects two of the four templates.
5. **`XX/YY/ZZZZ` is a literal in template ④** — a date placeholder nobody turned into a merge field. It
   becomes `decisionDate`.
6. **Reply-to matters.** Templates ① ② ④ all invite a reply (*"you can reply to this email"*, *"let us know by
   replying"*), so Notify needs a configured reply-to address and its `emailReplyToId`, not the default
   no-reply.
7. **A caseworker-facing link is quoted as prose**: *"call the Deed Poll office on 020 3936 8957 (select
   option 6)"*. Fine as static content, but it dates — worth a personalisation or a single place to change it.

---

## 6. Proposed Notify template set

Four templates, not six, and the branching mechanised rather than deleted by hand:

| Notify template | Replaces | Conditionals needed | Caseworker slots |
|---|---|---|---|
| `forms-for-completion-adult` | ① | Gazette sentence, from `publishToLondonGazette` | **none** |
| `forms-for-completion-minor` | ② | Gazette sentence | **none** |
| `application-rejected` | ③ | online vs paper refund text, from `postCounter` | judge's reason, notes |
| `request-confirmation-to-proceed` | ④ | online vs paper refund text; `[child's]`, from `type` | judge's reason, notes |

**`type` has four members, not two.** `DeedPollType` is `Adult, AdultTransgender, Minor, MinorTransgender`,
so "adult" means `Adult || AdultTransgender` and "minor" means `Minor || MinorTransgender` everywhere this
document says `type`. It matters differently in each row: in ④ it picks the `[child's]` **wording**, but in
①/② it picks **which template is sent**, so an `AdultTransgender` case falling through to the minor branch
would send an applicant an email about their child.

**①② have no caseworker slots, corrected 2026-09-19.** An earlier version of this table gave both "notes".
Neither supplied `.docx` contains an `[Enter …]` marker anywhere — unlike ③ and ④, which have two each — so
there is nothing for a caseworker to curate: the email is identical for every applicant of a given type.
Adding a slot the template has no placeholder for makes Notify refuse the send, so if the business does want
a notes box it is a **template change first**, not an api change.

Adult and minor stay two templates rather than one conditionalised pair, because they differ in *which* forms
and *which* exhibits, not in a sentence — one template with that much conditional content is harder to
proofread than two, and a content designer owns these.

**`LOC020` and `LOC022` document generation is now decided** — `deed-poll-api/docs/plans/notify-4-forms-for-completion.md`.
In summary: generated **in-process** rather than through `doc-assembly`/Docmosis, because `DocAssemblyResponse`
returns a document-store location rather than bytes and its request needs a `caseTypeId` and `jurisdictionId`
this service does not have; and because the two supplied `.docx` files are **Dynamics 365 Word templates**
(30 `w:sdt` content controls bound by XPath against `urn:microsoft-crm/document-template/deedpoll_deedpoll/10740/`),
so they are machine-readable as supplied but would have to be retyped for Docmosis.

**Only two of the seven documents are generated.** The adult email carries LOC020, LOC021 and LOC027; the
minor email carries LOC022, LOC023, LOC024 and LOC028. Only the two change-of-name deeds carry case data —
*"This form contains the information you provided in your online application"* — and the other five are blank
forms for a declarant and a commissioner of oaths to complete. They are **static files to be sourced and
stored**, and none of them is in `doc_templates/` today.

Still out of scope for Notify and still needing a decision: the missing ⑤ Gazette notice.
