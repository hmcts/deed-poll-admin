# Seed representative cases in a non-production environment

`yarn seed:cases` creates 30 synthetic cases through the real deed-poll API contract. It works against local development, AAT, demo, preview, ITHC, performance-test, sandbox and other explicitly named non-production environments. It never writes SQL or uses `/__mock/*` endpoints. The existing `yarn mock:seed` remains a separate local mock tool.

## Preview and apply

Run from the admin repository root after `yarn install`. No library build is needed: the command uses `tsx` against the API client's source.

```bash
yarn seed:cases --environment demo \
  --api-url https://deed-poll-api.demo.platform.hmcts.net \
  --batch manual-testing-01
```

Without `--apply`, this only prints the dataset. It makes no network requests. The URL is an example: supply the actual API origin for your environment, not the admin web address.

To create the cases, supply two real IDAM **user access tokens** through `SEED_CASEWORKER_TOKEN` and `SEED_JUDGE_TOKEN`, then repeat the same command with `--apply`. The caseworker token should have `caseworker-deedpoll-team-leader` so the private scenarios are preserved. The judicial token needs `caseworker-deedpoll-judicial`. A client-credentials token cannot substitute for either user. Tokens are never printed or written to the journal.

```bash
yarn seed:cases --environment demo \
  --api-url https://deed-poll-api.demo.platform.hmcts.net \
  --batch manual-testing-01 --apply
```

For a local Java API, prefix the command with `NODE_ENV=development` and use `--environment local --api-url http://127.0.0.1:4550` and tokens from its configured IDAM simulator. The in-memory mock can also be targeted on port 3200, using its test credentials. Alternatively, the `--create-test-users` option below provisions and authenticates two temporary IDAM fixtures.

Use the environment that **owns the API's data**. A preview admin configured to call AAT's API still writes AAT data: select `--environment aat`, not preview. HTTPS is required for all remote hosts, including internal services. HTTP is permitted only for loopback with `NODE_ENV=development` or `test`. The private endpoint must first meet the TLS prerequisites in [DEPLOYMENT.md](DEPLOYMENT.md#api-transport-rollout).

Production names and hostnames are refused, including `prod`, `production`, `live` and public `*.service.gov.uk` hosts. A remote hostname must contain the selected environment. There is no production override. A hostname check cannot identify the destination behind a local port-forward or a misleading DNS alias: only forward a verified non-production service.

## Create the temporary users automatically

On a VPN-connected machine with Azure CLI already signed in, add `--create-test-users --apply`. This reads `admin-idam-client-secret` from the selected environment's `deed-poll-<environment>` vault and normally provisions two IDAM fixtures: a Team leader and a judge. With `--defer-judicial`, it provisions only the Team leader. Their user tokens are held in memory. It checks API reachability before creating users.

For the verified AAT API ingress, run from the repository root:

```bash
yarn seed:cases --environment aat \
  --api-url https://deed-poll-api-aat.service.core-compute-aat.internal \
  --batch manual-testing-20261002 \
  --journal "$PWD/data/seed-aat-manual-testing-20261002.json" \
  --create-test-users --apply
```

Optional `--client-id`, `--vault` and `--secret-name` select another environment's registration; the vault must still match the selected non-production environment. The issuer is `https://hmcts-access.<environment>.platform.hmcts.net/o`, and testing support is `https://idam-testing-support-api.<environment>.platform.hmcts.net`. Use supplied tokens for a local simulator or a different identity provider.

Fixture UUIDs and random login credentials are stored in a separate `<journal>.accounts.json` file with owner-only permissions. Keep it private alongside the journal (under gitignored `data/` by default). No client secret or access token is stored. Repeated runs use the same fixture UUIDs, including after AAT's temporary-user cleanup, so a resumed judicial action uses the same identity. This uses testing support's idempotent fixture PUT operation. It creates no roles or service registrations; the client needs `client_credentials` and `password` grants and both persona roles must already exist.

## Seed for caseworkers while holding the judge account

Add `--defer-judicial` to the same preview/apply command to create all 30 cases, witnesses, notes and milestone dates using only the caseworker/admin token. With `--create-test-users`, the judge identity stays reserved in the private accounts file but is not created or authenticated in IDAM.

This mode creates six Open referrals and one Withdrawn referral. It defers judicial claims and directions and the subsequent caseworker closures. The returned-for-action worklist therefore remains unpopulated by this batch until judicial actions run. All eight application states are still represented.

The journal records `caseworkerComplete: true`, five `deferredJudicial` case markers and `complete: false`. To complete the referral scenarios later, reuse the same journal and batch without `--defer-judicial`, supplying the judicial token or `--create-test-users`. Completed case writes are skipped and existing manual edits are never reset.

## What is created

| Application state | Cases |
|---|---:|
| Received | 6 |
| Awaiting further documents/information | 4 |
| Ready for Master | 3 |
| Referred to Master | 4 |
| Awaiting signature | 4 |
| Awaiting enrolment | 3 |
| Enroled | 4 |
| Returned | 2 |

All six application types are represented, with Unknown limited to a newly received case. The set includes private and public cases, normal and urgent work, online/post/counter channels, representatives, minor/parent details, cases aged 1–120 days, and zero/one/two-witness examples. Cases awaiting enrolment or already enrolled have two witnesses added **before** their milestone dates are patched.

Seven cases have real referral histories: one Open, one Claimed, two Decided (one approved and one rejected), two Closed and one Withdrawn. The Decided pair populates the returned-for-action worklist independently of the case state. Claimed and decided referrals belong to the supplied judicial token's user; another judge cannot see them on **My referrals**. Temporary AAT IDAM users expire, and inactive claims can lapse, so this state can change after seeding.

Names end in `-Test`, notes explicitly identify synthetic data, and email addresses use `example.invalid`. `onlineApplicationReference` stores a unique `SEED-<batch>-<number>` marker on every row, including the synthetic post/counter examples, so duplicates can be detected using an exact API query. References and audit authors are assigned by the API. Historical milestone dates are simulated; creation, note and referral audit timestamps reflect the actual run.

No email-send endpoints are called, no payments are made, and no documents are uploaded. Awaiting-applicant-confirmation is a separate worklist, not a ninth application state; creating it requires an explicit Notify email test. The seeder does not fabricate that history. Ordinary API list reads can run the service's existing outbox drain or CCD sweep if configured, just as the admin UI does.

## Verification and reruns

Every case is read back and checked for its planned state, type, seed marker, witnesses, notes and referral state. A mismatch fails the command. Existing unrelated cases are preserved.

The default journal is `data/seed-<environment>-<batch>.json` in the repository root, whichever directory Yarn runs the script from. `data/` is gitignored. `--journal` names a `.json` file inside that directory, either relative to it (`--journal batch.json`) or as an absolute path within it; anything outside `data/` is refused, and `--batch` must be lowercase letters, digits and hyphens. Both are confined because the journal sits beside a credentials file and these arguments may come from an agent. The journal contains created IDs, references and successful API responses, but no credentials. `--as-of YYYY-MM-DD` fixes the historical scenario dates; otherwise the first run uses today's UTC date and the journal preserves it.

Keep the journal. Repeating the same command with the same journal verifies the records and skips completed writes. It does not reset manual edits: changes to the checked fields are reported as a mismatch. A new journal with an already-used batch is refused if its marker exists.

Each write is recorded as pending before transmission. If a timeout, server error or lost response leaves its outcome uncertain, rerunning stops rather than issuing a duplicate write. Reconcile that operation through the API and repair the journal using the verified response before continuing. A definite 4xx refusal (except timeout) can be retried after correcting the cause, using the same journal. A process crash may leave a `.lock` file; remove it only after confirming the original process has stopped. Run one writer per batch; the API does not enforce uniqueness of seed markers across different journals or machines.

Refresh expired tokens before resuming. Reuse the same judicial identity for a partly completed claim/direction sequence, because the API enforces ownership.
