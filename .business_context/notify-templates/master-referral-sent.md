# `master-referral-sent` — draft Notify template

**Paste-ready draft for the Notify UI.** The wording is the business's (Steve, 2026-11-02); engineering only placed
the placeholders. The authoritative placeholder contract is `deed-poll-api`'s `MasterEmailPersonalisation`: if this
file and that class disagree, the class wins.

**When it is sent:** a Team leader or Delivery Manager sends referrals from the queue during a referral window (plan
F1). Each Master in that send gets **one** of these, however many referrals it holds. A Master who is given a referral
by reassignment gets one too. It goes to the Master's address on the Delivery Manager's Masters list, never to an
applicant, and it names nothing about a case: the Master signs in to see the referrals.

## The contract: five keys, any of which the template may use

Names must match character for character. **A placeholder the api does not send makes Notify refuse every send**,
and a key the api sends that the template does not use is ignored. So the template may leave some keys out (it does
not use `master_name` or `referral_count`), but must not add any.

| Placeholder | Filled with | Used here |
|---|---|---|
| `master_name` | the Masters-list name | no ("Dear Judge") |
| `referral_count` | how many referrals the email is about, as digits | no |
| `my_referrals_link` | `{ADMIN_BASE_URL}/judicial/referrals/mine`, e.g. `https://deed-poll-admin.aat.platform.hmcts.net/judicial/referrals/mine` | **yes** |
| `processing_window` | the Delivery Manager's processing window **at send time**, in words: `7 days`, `1 day` | **yes** |
| `reminder_interval` | the Delivery Manager's reminder interval at send time, in hours: `48 hours`, `1 hour` | **yes** |

The two settings are placeholders, not fixed words (Steve, 2026-11-02), so the email never states a period a Delivery
Manager has since changed. **They need api with `processing_window` and `reminder_interval` deployed before this
template's id goes into the chart.** Until then api reads the template as unprovisioned and sends nothing, so
authoring the template early is safe.

---

## Subject

```
Deed Poll referrals allocated to you
```

## Body

```
Dear Judge,

Please follow the link below to access the Deed Poll referrals allocated to you for consideration:

((my_referrals_link))

Referrals will remain allocated to you for a period of ((processing_window)) from the date of assignment. To assist with timely processing, automated reminder notifications will be issued every ((reminder_interval)) in respect of any outstanding referrals that remain pending.

Kind Regards,
Deed Poll Team
```

Changes from the wording as supplied, all agreed with Steve on 2026-11-02:

- `((my_referrals_link))` is placed on its own line under "follow the link below", where the supplied text promised a
  link but did not include one.
- "your allocated Deed Poll referral" became "the Deed Poll referrals allocated to you", because one email can cover
  several referrals.
- "7 days" and "48 hours" became `((processing_window))` and `((reminder_interval))`.
- The subject is new: none was supplied.

## Building it in the Notify portal

1. **Templates → New template → Email.** Name it `master_referral_sent`. The name is only a label.
2. Paste the **Subject** and **Body** above exactly, including the blank lines. `((my_referrals_link))` must stay on
   a line of its own, or Notify runs it into the text around it.
3. **No attachments, and no reply-to.** It does not invite a reply.
4. Save, and send the template id back so it can be read back and checked.

## After it is authored

| Service | Template UUID |
|---|---|
| non-prod | not yet |
| prod | not yet: prod's Notify service needs its own copy |

The id then goes into `deed-poll-api/charts/deed-poll-api/values.yaml` as `NOTIFY_TEMPLATE_MASTER_REFERRAL_SENT`, in
the conditional form the case templates use so prod keeps its placeholder, with a chart version bump.
