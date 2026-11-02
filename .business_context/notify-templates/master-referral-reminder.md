# `master-referral-reminder` — draft Notify template

**Paste-ready draft for the Notify UI.** The wording is the business's (Steve, 2026-11-02); engineering only placed
the placeholder. The authoritative placeholder contract is `deed-poll-api`'s `MasterEmailPersonalisation`: if this
file and that class disagree, the class wins.

**When it is sent:** every reminder interval (a Delivery Manager setting, 48 hours by default) from a referral's
being sent to a Master, while it still waits for that Master's direction. Reminders go on working days, 07:00 to
before 18:00, and all of a Master's reminders due in one run go as **one** email. It goes to the Master's address on
the Masters list and names nothing about a case.

## The contract: the same five keys as `master-referral-sent`

The api sends both Master emails the same five keys, `master_name`, `referral_count`, `my_referrals_link`,
`processing_window` and `reminder_interval`; see [`master-referral-sent.md`](master-referral-sent.md) for what each
holds. This template uses **only `my_referrals_link`**. Notify ignores a key a template does not use, but **refuses
every send if the template uses a placeholder the api does not send**, so add no other name.

---

## Subject

```
Reminder: Deed Poll referrals awaiting your consideration
```

## Body

```
Dear Judge,

This is a courtesy notification to advise that you have Deed Poll referrals allocated to you that are awaiting your consideration:

((my_referrals_link))

Kind Regards,
Deed Poll Team
```

Changes from the wording as supplied, agreed with Steve on 2026-11-02:

- `((my_referrals_link))` added on its own line, so the Master can go straight to the referrals.
- "a Deed Poll referral has been allocated to you and is awaiting" became "you have Deed Poll referrals allocated to
  you that are awaiting", because one reminder covers every referral still waiting for that Master.
- The subject is new: none was supplied.

## Building it in the Notify portal

1. **Templates → New template → Email.** Name it `master_referral_reminder`.
2. Paste the **Subject** and **Body** above exactly, including the blank lines, with `((my_referrals_link))` on a
   line of its own.
3. **No attachments, and no reply-to.**
4. Save, and send the template id back so it can be read back and checked.

## ✅ Authored and verified — 2026-11-02

`784396ee-1184-49d5-9910-b135ef289bda`, version 1, named `master_referral_reminder`, read back with `GET /v2/template/{id}`: the subject and body are
identical to the draft above, and the placeholders are `my_referrals_link` only, all of which api sends.

## After it is authored

| Service | Template UUID |
|---|---|
| **non-prod** | `784396ee-1184-49d5-9910-b135ef289bda` |
| prod | not yet: prod's Notify service needs its own copy |

The id is set, by deed-poll-api#164 (chart 0.0.32), in `deed-poll-api/charts/deed-poll-api/values.yaml` as `NOTIFY_TEMPLATE_MASTER_REFERRAL_REMINDER`,
with a chart version bump.
