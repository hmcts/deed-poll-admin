# Where `openapi.json` came from

Taken from `deed-poll-api`'s own published document, not hand-written. Task 1 of
`docs/plans/completed/02-dal-cutover-to-api.md`: api exists, so a divergence between this file and api is a bug in
one of them rather than licence to invent.

| | |
|---|---|
| **api source** | **PR head** `5a898004947a852194983cf65f98e0a9c1ae0512` of API PR #154 (item B, the Master's Gazette answer becomes `changesToStandardPublication`; expand step), on master `5f0b278`. Taken from the PR head because this admin change must deploy **after** api#154: today's api requires `publishToGazette` and would refuse the new name. Regenerate from #154's merge commit after it merges and record whether it is byte-identical. The PR's later head `430f268` changes one Java comparison (SonarCloud S4973) and no contract. |
| **Taken on** | 2026-10-27 |
| **How** | `JAVA_TOOL_OPTIONS=-XX:UseSVE=0 TESTCONTAINERS_RYUK_DISABLED=true OPENAPI_OUTPUT_PATH=/tmp/juniper-340/openapi-5a89800.json ./gradlew cleanIntegration integration --tests '*OpenAPIPublisherTest' --no-daemon` in the api worktree at that commit. Raw SHA-256 `5e7a00bf4440d01daa1c4b4ce38f2072816bdcf6f43b802871bf1dac06c5675d`. 2-space JSON, then Biome; parsed equal to the raw artefact. |
| **Delta** | Measured by parsed comparison against the previous copy (api `5f0b278`): **three schemas changed, two operation descriptions changed, nothing added or removed.** `JudicialDirectionRequest` gains `changesToStandardPublication` (boolean) and `required` becomes `[changesToStandardPublication, decision]`; its `publishToGazette` is now `deprecated: true` and described as the inverted alias accepted for one release; `directionsText`'s description says it is required when there are changes. `ReferralResponse` and `JudicialReferralDetail` each gain a nullable `changesToStandardPublication`, and their `publishToGazette` becomes nullable, deprecated and described. The direction `PUT` and withdraw descriptions name the new field. Still 59 operations, 42 paths, 61 schemas. This admin declares the deprecated name for set-equality and never reads or sends it; api's PR 3 removes it. |
| **Previous api source** | Merged master `5f0b278384881442b9b36fd1ec36a34143d69d3a` (API PR #153, the Master's application view, squashed from PR head `bc99748`). Regenerated after the merge as the row below asked: **byte-identical** to the PR-head artefact (same raw SHA-256), so `openapi.json` is unchanged and only this row is new. |
| **Previous taken on** | 2026-10-27 |
| **Previous how** | `JAVA_TOOL_OPTIONS=-XX:UseSVE=0 TESTCONTAINERS_RYUK_DISABLED=true OPENAPI_OUTPUT_PATH=/tmp/juniper-340/openapi-5f0b278.json ./gradlew cleanIntegration integration --tests '*OpenAPIPublisherTest' --no-daemon` in a clean detached api worktree at that commit. Raw SHA-256 `c34562fdde52f7ecf749c28ba30606a216de8a5ee1cd6479c059812aacf975bd`. |
| **Previous delta** | None against the previous copy. Still 59 operations, 42 paths, 61 schemas. |
| **Previous api source** | **PR head** `bc997481462cd37739821d124f75d6ea98a9a86f` of API PR #153 (the Master's application view), on master `98c7137`. Taken from the PR head on purpose: this admin change must deploy **before** api#153, because today's admin pins `witnesses` and `caseNotes` as required and would refuse the narrowed answer. Regenerate from #153's merge commit after it merges and record whether it is byte-identical, as the 10-24/10-25 refresh did. |
| **Previous taken on** | 2026-10-27 |
| **Previous how** | `JAVA_TOOL_OPTIONS=-XX:UseSVE=0 TESTCONTAINERS_RYUK_DISABLED=true OPENAPI_OUTPUT_PATH=/tmp/juniper-spec/openapi-bc99748.json ./gradlew cleanIntegration integration --tests '*OpenAPIPublisherTest' --no-daemon` in the api worktree at that commit. Raw SHA-256 `c34562fdde52f7ecf749c28ba30606a216de8a5ee1cd6479c059812aacf975bd`. 2-space JSON, then Biome; parsed equal to the raw artefact. |
| **Previous delta** | Measured by parsed comparison against the previous copy (api `539da63`): **two schemas removed, two changed, one operation's description changed, nothing added.** `JudicialWitness` and `JudicialCaseNote` are gone. `JudicialApplicationView` keeps only `displayReference`, the new and old names, `type`, `nationality`, `nationalitySection`, `nationalitySectionOther`, `parents` (null unless a minor's application) and `documents`. `JudicialReferralDetail` loses `caseNotes`. `GET /judicial/referrals/{referralId}`'s description says what a Master is sent. Master Sullivan's feedback, Steve, 2026-10-27; api #152 (case-note wording) is in the base with zero contract delta. Now 59 operations, 42 paths, 61 schemas. |
| **Previous api source** | Merged master `539da63019e1432e320f60e4dd6156cb710c7a1a` (API PR #135, Delivery Manager process settings). Carries #130–#134 too, all of which have zero contract delta (charts, a Sonar suppression, a seed migration and document-type data). |
| **Previous taken on** | 2026-10-27 |
| **Previous how** | `JAVA_TOOL_OPTIONS=-XX:UseSVE=0 TESTCONTAINERS_RYUK_DISABLED=true OPENAPI_OUTPUT_PATH=/tmp/dm-settings-spec/openapi-539da63.json ./gradlew integration --tests '*OpenAPIPublisherTest*' --no-watch-fs` in a clean detached api worktree at that commit. Raw SHA-256 `8607a02a3a243d2415a08ca592089f465bb4bd6daa8b8da185902fbde15ebf8a`. 2-space JSON, then Biome; parsed equal to the raw artefact. |
| **Previous delta** | Measured by parsed comparison against the previous copy (api `10a3458`): **two operations and two schemas added, one enum member added, nothing else changed or removed.** `GET /caseworker/process-settings` (`getProcessSettings`) and `PUT /caseworker/process-settings` (`updateProcessSettings`), both answering 200 `ProcessSettingsResponse` (`referralClaimExpiryMinutes` int32 30–1440, `revision` int32, nullable `updatedAt` and `updatedBy`) and the shared 403; the write body `UpdateProcessSettingsRequest` (both required, `additionalProperties: false`, minutes 30–1440, revision ≥ 0). `MANAGE_PROCESS_CONFIG` appended to `CallerAccessResponse.capabilities`' enum, last in declaration order. Now 59 operations, 42 paths, 63 schemas. api's `application.yaml` drops `deedpoll.referrals.claim-expiry` (the window now lives in the settings row); the health base path, probe group, `SecurityConfiguration.PUBLIC_PATHS`, `CaseQuery` and `QueryOperator` are unchanged. `contract.test.ts` pins `PROCESS_SETTINGS_LIMITS` to the write body's bounds. |
| **Previous api source** | Merged master `10a3458a1271592a77b1fbad6eaf0db743b214bb` (API PR #129, document previews). First taken on 2026-10-24 from the PR head `19bb0c2`, because the pipeline was down out of hours (Steve); regenerated on 2026-10-25 in a clean detached api worktree at the merge commit, **byte-identical** (same raw SHA-256 below). |
| **Previous taken on** | 2026-10-24 |
| **Previous how** | `JAVA_TOOL_OPTIONS=-XX:UseSVE=0 TESTCONTAINERS_RYUK_DISABLED=true ./gradlew integration --tests '*OpenAPIPublisherTest*' --no-watch-fs` in a clean api worktree at that commit, saved as `openapi-pr129-19bb0c2.json`. Raw SHA-256 `351b6047e653a7ddad987efcc496e6933e8a5a1672e25b9d10d5fe8143afed45`. 2-space JSON, then Biome; parsed equal to the raw artefact. |
| **Previous delta** | Measured by parsed comparison against the previous copy (api `b335a72`): **two operations and one schema added, nothing else changed or removed.** `GET /caseworker/cases/{id}/documents/{documentId}/preview` (`previewCaseDocument`) and `GET /judicial/referrals/{referralId}/documents/{documentId}/preview`, both answering 200 `application/pdf` (the whole document as one PDF; headers `Accept-Ranges: none`, `Cache-Control: no-store`, `Content-Disposition: inline; filename="document-preview.pdf"`, `Content-Length`, `Content-Security-Policy: default-src 'none'; sandbox`, `X-Content-Type-Options: nosniff`), 403/404/502 as `/file` answers, and `DocumentPreviewError` (`code`, `error`) on 422 (`PREVIEW_INVALID_DOCUMENT`, `PREVIEW_LIMIT_EXCEEDED`), 429 (`PREVIEW_BUSY`, with `Retry-After`) and 503 (`PREVIEW_UNAVAILABLE`). Each carries an `x-document-preview-limits` extension: 25 s request budget, 25 MiB input, 50 MiB output, 100 pages (counted by api only for JPEG, PNG and TIFF; the viewer counts PDF and DOCX), 25 M frame pixels, 3 conversions and 8 previews per instance, 5 s busy retry, no range requests. Now 57 operations, 41 paths, 61 schemas. `contract.test.ts` pins the codes to their statuses, the headers, and `DOCUMENT_PREVIEW_LIMITS` to the extension. api audits a preview as `DOCUMENT_PREVIEWED`, apart from `DOCUMENT_DOWNLOADED`; its behaviour is in api's `README.md` preview section and `docs/DOCUMENT-PREVIEW-SMOKE.md`. |
| **Previous api source** | Merged master `b335a72b7ee4356b0a6e3888dda0a4acf5a312e6` (API PR #124), which caps `returnReason`, `referralNotes` and `masterDirections` at 2,000 characters with a line break counted once, and trims witness name, address and occupation and refuses them blank (review finding R15). |
| **Previous taken on** | 2026-10-22 |
| **Previous how** | `JAVA_TOOL_OPTIONS=-XX:UseSVE=0 TESTCONTAINERS_RYUK_DISABLED=true ./gradlew integration --tests '*OpenAPIPublisherTest*' --no-watch-fs` in a clean detached API worktree at that commit. Raw SHA-256 `8475a0718f991f3431860a8334b60cebdc14d99ac5d7df9815fe91b2690808a8`. 2-space JSON, then Biome. |
| **Previous delta** | Measured by parsed comparison against the previous copy: **25 changes, all on four request bodies, nothing removed.** `CreateCaseRequest` and `UpdateCaseRequest`: `maxLength: 2000` and a description ("A line break counts as one character towards maxLength, whether it is sent as LF, CRLF or CR.") on each of the three narrative fields. `CreateWitnessRequest` and `UpdateWitnessRequest`: `minLength: 1` and a "Trimmed first" description on each of the three text fields, and `CreateWitnessRequest`'s own description now says the fields are trimmed rather than stored as submitted. No operation, path or schema added or removed: still 55 operations, 39 paths, 60 schemas. `form-fields.test.ts` now pins `TEXTAREA_MAX_LENGTH` to the three published `maxLength`s. |
| **Previous api source** | `693c242` on api branch `fix/openapi-forbidden-responses` (base `93c2dd3`), since merged as API PR #120 (`5e84faa`). The branch head `21776eb` (review fixes, tests and docs only) generates the same bytes. Re-check this row if the api PR changes before it merges. |
| **Previous taken on** | 2026-10-20 |
| **Previous how** | `TESTCONTAINERS_RYUK_DISABLED=true JAVA_TOOL_OPTIONS=-XX:UseSVE=0 OPENAPI_OUTPUT_PATH=/tmp/openapi-403/producer-693c242.json ./gradlew cleanIntegration integration --tests '*OpenAPIPublisherTest' --no-daemon` in an api worktree at that commit (20 tests passed). Raw SHA-256 `7af3a4522d6718beac41844208a68cd65301b02929ebbdbf0904611cfda62868`. 2-space JSON, then Biome. That recipe was first shown to reproduce the previous copy byte-for-byte from its own artefact. |
| **Previous delta** | Measured by parsed comparison against a fresh baseline from `93c2dd3`: **56 additions, nothing removed or changed.** 53 are `responses.403` = `{"$ref": "#/components/responses/Forbidden"}`, one on every operation except `GET /` (public, `security: []`) and `GET /me` (any authenticated caller). That is all 45 `/caseworker/**` and 8 `/judicial/**` operations, including the three deferred `ccd-attempts` ones. The other three are the new `components.responses.Forbidden` (`application/json`, schema `ApiError`) and the newly published `components.schemas.ApiError` and `FieldError`. Now 55 operations, 39 paths, 60 schemas. Fortify (low: an operation inherits authentication but omits its 403): **rescan pending**. This copy documents a refusal that already existed; it is not evidence of a fixed leak. |
| **Previous api source** | `93c2dd370cb4d63f51375da155818ea452dcc9da`, api `origin/master` after API PR #118 (judges see the full application, and can revise or withdraw their direction) merged. |
| **Previous taken on** | 2026-10-19 |
| **Previous how** | `./gradlew integration` in an api worktree at that commit, copied from `/tmp/openapi-specs.json` (staged as `/tmp/openapi-specs-api.json`). Raw SHA-256 `dba83e5e6c31f683c76430bb4e631aa865c9c1d659cdc25a3a5bc19d2e1fac4b`. 2-space JSON, then Biome. |
| **Previous delta** | Measured by parsed comparison. Three operations added: `PUT /judicial/referrals/{referralId}/direction` (`reviseDirection`, body `JudicialDirectionRequest`), `POST /judicial/referrals/{referralId}/direction/withdraw` (`withdrawDirection`, no body) and `GET /judicial/referrals/{referralId}/documents/{documentId}/file` (`document`, binary); all three are implemented. `JudicialCaseView` is removed and replaced by `JudicialApplicationView` (46 properties, no payment, refund or fee field), with `JudicialWitness` and `JudicialDocument`. `directionChangedAt`, a nullable date-time, is added to `ReferralResponse` and `JudicialReferralDetail`. Only descriptions changed on `GET /judicial/referrals/{referralId}`, `POST …/direction` and `JudicialDirectionRequest`. `servers` and everything else are identical. Now 55 operations, 39 paths and 58 schemas. |
| **Previous api source** | `34d4bd3` on API PR #117 (`fix/openapi-https`), based on merged master `1bc8bba`. Recheck provenance if that PR changes before merge. |
| **Previous taken on** | 2026-10-19 |
| **Previous how** | Regenerated by API's `OpenAPIPublisherTest`, with all 18 tests passing, using `JAVA_TOOL_OPTIONS=-XX:UseSVE=0 TESTCONTAINERS_RYUK_DISABLED=true OPENAPI_OUTPUT_PATH=/tmp/deed-poll-api-relative-openapi.json ./gradlew integration --tests '*OpenAPIPublisherTest'`. Raw SHA-256 `1e247b765552c47acc9213c88bf8675b3a96cba2143498df1b0d70c6a94f2f8a`. 2-space JSON, then Biome. |
| **Previous delta** | Only `servers`: the relative `/` server replaces generated `http://localhost`. Every other parsed field is identical: 52 operations, 37 paths, 56 schemas and unchanged bearer authentication. It inherits the serving origin and scheme, so does not enforce TLS. Fortify acceptance for instance `3B96C2B66F875E1E836CEAB415F8EA96` is unverified. Admin uses `DEED_POLL_API_URL` independently; this refresh changes no runtime endpoint. |
| **Previous api source** | Merged master `fb6a00a` (API PR #113), which limits each IDAM subject's searches, email previews, email sends, uploads and Gazette sends. |
| **Previous taken on** | 2026-10-16 |
| **Previous how** | Regenerated by api's `OpenAPIPublisherTest` and saved as `/tmp/openapi-fb6a00a-keep.json`. Raw SHA-256 `8ba16665e913b31c8a45ca873e742cae12fa6f8e8d989b37076d14b40f73bf33`. 2-space JSON, then Biome. |
| **Previous delta** | Exactly six `429` responses, measured by parsed comparison: on `GET /caseworker/cases`, `POST /caseworker/cases/{id}/documents`, `POST /caseworker/cases/{id}/emails/{template}`, `POST /caseworker/cases/{id}/emails/{template}/preview`, `POST /caseworker/gazette-notice-previews` and `POST /caseworker/gazette-notices`. Each carries an integer `Retry-After` header. Every other response on those six operations, every other path, operation and schema, the metadata and the deferred CCD entries are identical. Still 52 operations, 37 paths and 56 schemas. |
| **Previous api source** | Merged master `e8907d0` (API PR #105), which publishes `GET /me`, taken 2026-10-15 in a clean detached API worktree with `JAVA_TOOL_OPTIONS=-XX:UseSVE=0 TESTCONTAINERS_RYUK_DISABLED=true ./gradlew integration --tests '*OpenAPIPublisherTest*' --no-watch-fs`. Raw SHA-256 `3ab71b0263c7dced9bbe1d5aecdca07fed0fb218c79bf15dafed8c7279e8a0d7`. Its delta was exactly `GET /me` (`getCallerAccess`) and `CallerAccessResponse`, measured by parsed comparison: every other path, operation, schema, the metadata and the deferred CCD entries are identical. Now 52 operations, 37 paths and 56 schemas. Both additions are registered, so nothing new is deferred. `CallerAccessResponse`'s three properties are all strict: `staff` and `judicial` are Java `boolean`s and `capabilities` is a `List.copyOf` in `Capability` declaration order. Its members are on array items, which the property enum comparison does not reach, so `contract.test.ts` pins `CAPABILITY` against them separately, order included. |
| **Previous api source** | Merged master `be3291a5c3bb6acbef3a189f650a2c1057c4607f` (API PR #100), taken 2026-10-12 by the same command. Raw SHA-256 `647a110a74114db4f1114a469d85240876224becb90be0b3d038121d5fb1e70e`. Its delta was ten descriptions only: eight Gazette operations, the case-list operation and its filter parameter. 51 operations, 36 paths, 55 schemas. |
| **Previous source** | API `742cb5a6a842a6e76b4e98cd59869da889032d50`, recorded below. |
| **Previous api source** | Merged master `742cb5a6a842a6e76b4e98cd59869da889032d50` (API PR #93), including the Gazette ledger, preview, send and recovery contract. |
| **Previous taken on** | 2026-10-09 |
| **Previous how** | Regenerated in a clean detached API worktree with `./gradlew integration --tests "*OpenAPIPublisherTest*"`; copied from `/tmp/openapi-specs.json`, 2-space JSON then Biome. Raw SHA-256 `c5465002de9a57d175cad73a9b33392b22d8e73337cd02df5ece51eec80b86cc`. |
| **Operations** | 45 caseworker operations across 30 paths, 5 judicial operations across 5 paths, plus `GET /`: 51 operations across 36 paths; 55 schemas. Three CCD operations and three CCD schemas remain explicitly deferred. |
| **Previous source** | Recipient settings `c286ffa96150798bfbe279e40bd656bbd45508b5`, subsequently merged in API PR #89. Raw SHA-256 `aacee4f1d3eac6890a4499c2248803ea4328a4623f612df67b22cdfd76b85ec1`; 46 operations, 32 paths, 46 schemas. |
| **Before that** | `b01f8f40f3184af268e20aa2a4fe4ad6b49518a6` — "Merge pull request #50 from hmcts/notify-6-chase-missing-documents", the tip of `origin/master` on 2026-09-25. Generated by Task 0 of `docs/plans/completed/notify-6-admin-idempotent-send.md` and copied here by its Task 1, in the same commit as the registration — `contract.test.ts` is set equality in both directions, so the copy and the registration cannot be split. |
| **Previous refresh taken on** | 2026-09-25 |
| **Previous refresh method** | The `/tmp/openapi-specs.json` artefact, regenerated at this commit by `./gradlew integration --tests "*OpenAPIPublisherTest*"` with `TESTCONTAINERS_RYUK_DISABLED=true`. **The stale artefact already on disk was byte-identical to the regenerated one** (64,323 bytes both times), so this refresh could have been taken from it — but that was established by regenerating, which is the only way to establish it, and the plan is right that the cached file is a fallback and not a source. No local api was running, so `servers[0].url` is springdoc's own `http://localhost` rather than a port. Reformatted (2-space JSON, then Biome) and otherwise unmodified. |
| **Previous refresh counts** | **34 caseworker operations** across 21 paths, **5 judicial** across 5 paths, plus Spring Boot's `GET /` — **40** in total, across 27 paths. **39 schemas.** Every count is unchanged from `83ec959`, and **this is the first refresh here that added no operation and no schema at all**: its whole delta is two changed operations and two changed schemas, accounted for below. So `IMPLEMENTED_OPERATIONS`, `WIRE_SCHEMAS` and `STRICT_RESPONSE_PROPERTIES` needed **no new entry** — which is a finding rather than a shortcut, because a breaking contract change arriving with every count intact is exactly the shape a reviewer checking counts would pass. api's own `OpenAPIPublisherTest` still asserts `isEqualTo(34)` and `isEqualTo(5)` at this commit, so the counts agree with numbers api's build fails on. **It carries notify-6 and nothing else** — the only two merges between `83ec959` and here are PR #49 (`notify-6-validation-gate`) and PR #50 (`notify-6-chase-missing-documents`), measured with `git log --merges`. The plan predicted this refresh would also carry `email-case-notes`; **it does not, because no such change has merged into api.** |
| **Before that** | `83ec959` — the tip of `origin/master` on 2026-09-24, with notify-3 (`7914406`, PR #38) and notify-3b (`1e322e1`, PR #42) behind it. Generated by Task 0 of `docs/plans/notify-3b-admin-confirmation-tracking.md` and copied here by its Task 1. **`1e322e1` would have produced the same document**: no file under `api/caseworker/dto/` changed between it and `83ec959`, and the only controller that did changed javadoc. `83ec959` is recorded because it is what was generated. Taken from the `/tmp/openapi-specs.json` artefact, not `curl`: a **local api was also running on `:4550`** from the same commit, and the two documents differ in exactly one byte-range: `servers[0].url`, which springdoc fills with the port it is actually listening on. Taking the live document would therefore have committed `http://127.0.0.1:4550` as the published server URL — a value no test in this repo reads, so nothing would have failed. **34 caseworker operations** across 21 paths, **5 judicial** across 5 paths, plus Spring Boot's `GET /` — **40** in total, across 27 paths. **39 schemas.** That refresh added one operation and one schema: `POST /caseworker/cases/{id}/referrals/{referralId}/confirmation` (`recordConfirmation`, answering **`200` → `ReferralResponse`**, so the write returns the saved referral) and `RecordConfirmationRequest`. It carried notify-3 and notify-3b and nothing else — PRs #44, #45 and #48 have **zero** contract delta, measured rather than assumed. notify-3's whole delta is the `template` parameter's description on both email operations, which now names `request-confirmation-to-proceed`: api publishes template keys as bare strings inside `EmailTypeResponse` and never as an enum, so a new template arrives as **data** and no test here can pin the set. That is deliberate — see `EmailTypeResponse`'s docblock — and it is why `emailTemplateLabel`'s `humaniseKey` fallback already renders the new key correctly and must not be "fixed" with a map entry. |
| **Before that** | `227b714819d522197b1e1aecd31ab78a5172f292` — "Merge pull request #36 from hmcts/referrals-api-6", then the tip of `origin/master`, taken 2026-09-21 from `GET /v3/api-docs`. Generated by Task 0 of `docs/plans/referrals-admin-6-judicial-my-referrals.md` and copied here by its Task 1, in the same commit as the registration — `contract.test.ts` compares both registries against the document as set equality, so a refreshed document with an unregistered operation is a red suite and the two steps cannot be split. The api source facts re-checked below were read at that commit with `git show <sha>:<path>`, which touches neither that clone's working tree nor its `HEAD` — another agent was working in it at the time. **33 caseworker operations** across 20 paths, **5 judicial** across 5 paths, plus Spring Boot's `GET /` — **39** in total, across 26 paths. **38 schemas.** The refresh added one operation and one schema and nothing else: `GET /judicial/referrals/mine` and `JudicialMyReferralsResponse`, which is `referrals-api-6` — a judge's own `Claimed` and `Decided` referrals, the list that was missing when a successful claim removed a referral from the only judicial page that linked to it. The envelope `$ref`s `JudicialReferralSummary` rather than declaring a second row shape, so the pool and the personal list are the same row type, and it takes `page` and `size` as strings exactly as the pool does. **api-6 also added stable-owner persistence** — `claimedById`/`decidedById`, its `V14__referral_owner_subjects.sql` — and those columns are on **no** DTO, which is the stop condition `referrals-admin-6` set and the reason ownership is unforgeable: whose list `mine` returns comes from the token's subject. `contract.test.ts` now fails if an owner id ever appears on a judicial schema. |
| **Before that** | `09d70e35c86b718b290e9dd693695750df32f468` — "Merge pull request #33 from hmcts/referrals-api-4", 2026-09-21, then the tip of `origin/master`. **33 caseworker operations** across 20 paths, **4 judicial** across 4 paths, plus `GET /` — 38 in total, across 25 paths. 37 schemas. That refresh added the whole email surface and nothing else: `GET /caseworker/cases/{id}/emails`, `POST …/emails/{template}/preview`, `POST …/emails/{template}`, and ten schemas (`CaseEmailsResponse`, `EmailTypeResponse`, `EmailSlotResponse`, `EmailSlotDefaultsResponse`, `EmailHistoryResponse`, `CorrespondenceDocumentResponse`, `EmailPreviewResponse`, `SentEmailResponse`, `PreviewEmailRequest`, `SendEmailRequest`) — **two** api plans in one step, `notify-1` (the plumbing) and `notify-5` (history and slot defaults, which arrived as properties of `CaseEmailsResponse` rather than as operations of their own). `referrals-api-4`, which merged between it and the one before, has **zero contract delta** — measured property-by-property, not taken from its plan's assertion. |
| **Before that** | `ee3717313d3cd841608b05a38f4b9a9598f84a30` — "Merge pull request #24 from hmcts/referrals-api-3", 2026-09-18, then the tip of `origin/master`. Regenerated from a detached worktree rather than by switching the shared clone's branch. **30 caseworker operations** across 17 paths, **4 judicial** across 4 paths, plus Spring Boot's `GET /` — 35 in total, across 22 paths. 27 schemas. The refresh added the whole referrals surface: five `/caseworker/cases/{id}/referrals*` operations, four `/judicial/referrals*` ones, and eight schemas (`CreateReferralRequest`, `ReferralResponse`, `JudicialDirectionRequest`, `JudicialPoolResponse`, `JudicialReferralSummary`, `JudicialReferralDetail`, `JudicialCaseView`, `JudicialCaseNote`). It is four api plans' worth in one step — api-1, api-2, api-2b and api-3 — because admin's spec had not been refreshed since api-1 merged. `#21` between them is documents only, with nothing under `src/main/`. |
| **Before that** | `3b2579ab14e8c073aa27999e0f477d1d6bc4aa92` — "Publish the sortable fields in a fixed order (#18)", 2026-09-17. **Not `19fbb39` (#17)**, though the document was captured before #18 merged: #18 only fixed the order of four names in the `sort` description, and the captured document already carried the fixed order, so `3b2579a` is the commit that reproduced it byte-for-byte and `19fbb39` is not. **25 caseworker operations** across 13 paths, plus `GET /` — 26 in total. 19 schemas. That refresh added the seven `/caseworker/saved-queries*` operations, three schemas (`SavedQueryResponse`, `CreateSavedQueryRequest`, `UpdateSavedQueryRequest`), a `q` parameter on the case list, and two response properties: `CaseListResponse.referenceMatch` and `CaseSummaryResponse.newSurname`. |
| **Before that** | `fd4fe3a61bf33c0cdea7066cf884dc87fd1df71f` — "Field-level case query, sorting and paging (#14)", 2026-09-14. 18 caseworker operations. It added no operation: the query surface **extended** `GET /caseworker/cases` with `where`, `sort`, `page` and `size`, and added `page`, `size`, `total` and `totalPages` to `CaseListResponse`. A `POST .../search` was deliberately not what api built — decision 1 of `deed-poll-api/docs/plans/completed/case-query-and-paging.md`: a query has to be bookmarkable and survive the back button. |
| **Before that** | `051f3b49d101a4e0cefc9477de9ea4f618ad1bf9` — "Allow Administrators to delete a witness (#9)", which added `DELETE /caseworker/cases/{id}/witnesses/{witnessId}`. It carries an **Administrator gate api enforces in the domain** — `WitnessService.removeWitness` calls `requireAnyRole` before it resolves the witness — and the document says nothing about that, because springdoc has no vocabulary for it. api's own tests are its authority; nothing here re-checks a role. |

## Gazette request refresh — 9 October 2026

The entire parsed comparison against the prior committed artifact adds only:

- `POST /caseworker/gazette-notice-previews`, `POST /caseworker/gazette-notices`,
  `GET /caseworker/gazette-notice-requests`, `GET /caseworker/gazette-notices/{batchId}`
  and `GET /caseworker/gazette-notices/{batchId}/cases`.
- Nine schemas: `Conflict`, `GazetteError`, `GazetteMemberResponse`,
  `GazetteMembersResponse`, `GazettePreviewResponse`, `GazetteRequestsResponse`,
  `GazetteStatusResponse`, `PreviewGazetteRequest`, `SubmitGazetteRequest`.
- The public `batchId` property on `GazetteNoticeBatchResponse`.

All unrelated operations, schemas, metadata, servers and deferred CCD definitions
are unchanged. The artifact was regenerated after PR #93 merged; its raw bytes
also match that PR's reviewed artifact. Contract tests retain equality over the
complete consumed-plus-deferred surface, strict writes, response properties and
enums. Gazette refusals have their own result type: a timeout, generic 409 or
unknown code is not proof that no request was admitted. POSTs never follow redirects
or automatically retry. The key is sent only in the header. Springdoc describes the Gazette header as a
required string (unlike the per-case email UUID format); the API parses it as a UUID,
and mock tests enforce that runtime requirement.

Rechecked API `application.yaml`, `SecurityConfiguration.PUBLIC_PATHS`, `CaseQuery`
and `QueryOperator` at this commit: health base path `/`, enabled probes,
`livenessState` and public `/health` / `/health/**` are unchanged; query operators
and sortable fields are unchanged. Changes to configuration only add Gazette
Notify template keys and the disabled-by-default Gazette feature flag. This refresh
does not alter the historical adapter compensations below.

This admin slice exposes request/status/member reads and supplies all five client
operations and mock fixtures. It does not add a send form or domain write journey.
Deploy API PR #93 and its preceding migrations before these pages. The mock's
comparison token is opaque and conservative (whole seeded case), not a reimplementation
of the API's mapped-cell fingerprint; it has no real delivery or recovery engine.

## Gazette recipient settings refresh — 8 October 2026

The complete parsed comparison adds only `/caseworker/gazette-settings` GET/PUT,
`GazetteSettingsResponse` and `UpdateGazetteSettingsRequest`. Existing operation
IDs, paths, schemas, deferred CCD definitions and other metadata are identical.
The request is strict: `recipientEmail` and `revision` are required. The email
constraint and 254-character maximum are pinned against the client in the contract
test. Settings start unset at revision 0; stale updates return 409 and current
unchanged saves are no-ops. The response exposes change time/display name without
any caller subject. API owns validation, revision locking and the persistent audit.

API build passed 3,702 tests and 17 integration tests. The client/mock suite passed
626 tests after the final refresh. Deploy API and V33 before this admin editor.
Health/liveness configuration and query vocabulary are unchanged from the previous
source; this refresh does not change the adapter's compensations below.

## Gazette ready/history refresh: complete measured delta

Compared the entire parsed artifact against the previous committed document, then inspected the formatted
file diff: **285 insertions, 5 deletions**. No paths, operations, schemas or existing properties were removed;
no existing operation IDs changed. Top-level metadata, servers, security and other component definitions
are unchanged.

- Added `GET /caseworker/gazette-notices` and `GazetteNoticeBatchResponse` /
  `GazetteNoticeHistoryResponse`. Consumed by `getGazetteNoticeHistory`; no Gazette POST exists.
- Added `GET /caseworker/ccd-attempts`, `POST /caseworker/ccd-attempts/{attemptId}/reconciliation` and
  `POST /caseworker/ccd-attempts/{attemptId}/retry`, plus `CcdAttemptCountResponse`,
  `CcdAttemptListResponse` and `CcdAttemptResponse`. These belong to CCD recovery, outside plan 16a.
  `src/api/deferred-contract.json` explicitly enumerates their complete operation and schema definitions.
  The contract test compares each in full, including parameters, responses, enum members and properties.
  Its operation/schema inventories remain equality in both directions over consumed plus deferred entries;
  unknown additions and any change to a deferred definition fail. This inventory is not an implementation,
  and is not generated from the live spec during tests. There are no CCD client writes or wire parsers.
  Both added CCD POSTs take only their path parameter and publish no request body; no empty request schema
  has been added to disguise an undocumented keyed write.
- `CreateSavedQueryRequest` and `UpdateSavedQueryRequest` each append `readyForPublication` to the filter
  enum. Their other fields and all 37 other pre-existing schemas are unchanged. `LIST_FILTER` gains the
  same member; the general case-list tabs remain separate from the admin Gazette queue.
- Four pre-existing operations change. `GET /caseworker/cases` changes only the filter description,
  documenting the ready predicate and default `dateEnroled:asc`. Its `where`, `sort`, `q` and paging
  parameters are unchanged (including the sort description's omission of the new default).
  Both email operations' template descriptions gain `forms-for-completion-adult` and
  `forms-for-completion-minor`. The send also documents 409 and 502 responses; document upload documents
  409. These errors already map to conflict/unavailable in the adapter; no response shape changed.
  The required email idempotency header and all write-body property/length checks are retained.

Checked the Gazette DTOs and domain history source in the review worktree: batch `caseCount` and
`referencesTruncated` are Java primitives; references and batches are constructed collections. They and
all paging numbers reject null. `sentAt` and `sentBy` follow this adapter's existing nullable reference
convention. The preview is at most 100 strings, never a substitute for the full `caseCount`; the adapter
preserves order and truncation metadata. History takes only page/size, defaults to 1/25 and caps at 100.
The minimal mock in Task 0 serves empty history, paging, token/role refusals and outage handling; Task 1
adds stored batch fixtures and full ordering semantics. Mock JWT claims are decoded, never verified.

Re-read `application.yaml` and `SecurityConfiguration.java` in the review worktree: management base path
is still `/`, probes remain enabled, liveness includes `livenessState`, and `/health` / `/health/**` remain
public. The published query operators and sortable field list are unchanged.

## Historical refresh notes

Every operation count above is right and none is a bug: api's `OpenAPIPublisherTest` asserts the caseworker
count and the judicial count separately and outright — at both `83ec959` and `b01f8f4`, `isEqualTo(34)` and
`isEqualTo(5)`, with a `doesNotContainAnyElementsOf` between the two lists — and the extra path is the welcome
route. So the counts here are not an independent measurement that happens to agree; they agree with numbers api's
own build fails on. api-6 added two assertions of its own worth knowing about, because they pin things a count
cannot see: that `/judicial/referrals` still carries exactly **one** operation, so `mine` cannot have been
documented by widening the pool's entry, and that `/judicial/referrals/mine` carries exactly `get`.

The actuator facts the document cannot carry were re-checked at this refresh, as the closing section says to, by
reading api at `b01f8f4`: `application.yaml` still has `management.endpoints.web.base-path: /`,
`management.endpoint.health.probes.enabled: true` and the `liveness` group's `include: "livenessState"`;
`SecurityConfiguration.PUBLIC_PATHS` still allowlists `/health` and `/health/**`. **notify-6 edited
`application.yaml`** (15 lines, its outbox-drain settings), which is why that re-read mattered this time rather
than being a formality — none of the four facts above is among the lines it changed. The query vocabulary needed
no reading at this refresh: `GET /caseworker/cases` is byte-identical, so `where`, `sort`, `filter` and `q` all
are.

## What the notify-6 refresh changed, which is *only* things that were not additions

**This is the first refresh here with no new operation and no new schema**, so the section that has been a
footnote since 2026-09-17 is the whole of the delta. Measured at the three levels the email refresh established:

1. **Two of the 39 schemas changed, and both changes are additive within the schema.** The other 37 are
   byte-identical, compared serialised one at a time. `PreviewEmailRequest` and `SendEmailRequest` each gain
   **`documents_required`** (`string`, `maxLength: 4000`) — ⑤'s slot, capped with the *direction* rather than with
   the notes. Each also carries a longer `description` and a longer one on `judges_reason`, and both of those are
   prose replacing shorter prose. Nothing was removed or retyped.
2. **Two of the 40 operations changed, and not one `operationId` shifted** — nothing was added, so nothing could
   collide. `POST /caseworker/cases/{id}/emails/{template}` gains the **required `Idempotency-Key` header**, and
   both email operations' `template` description now names `chase-missing-documents` beside the other two.
3. **The file diff is additive at the line level**: **26 insertions, 6 deletions** once `npx biome format --write`
   has been run. Every one of the six deletions is a `description` replaced by its longer self — the two
   `template` parameters, the two body descriptions and the two `judges_reason` descriptions — checked line by
   line rather than by counting, which is what the instruction below is for.

**The required header is the substance of this refresh, and it is a breaking change to an operation this app
already calls.** Recorded here rather than only in the plan, because it is the thing a future reader will need:

- `{"in":"header","name":"Idempotency-Key","required":true,"schema":{"type":"string","format":"uuid"}}` — **no
  `required = false` and no default** at api (`CaseworkerEmailController` line 168), so Spring answers **400** when
  it is absent. Until this app sends it, **every** send from the Email tab is a 400, `application-rejected`
  included, which worked before. That is a regression to repair rather than a feature to add.
- **It is the contract's only header parameter, on any operation.** `contract.test.ts` now asserts that as a set
  over the whole document rather than only on the send, so a header api adds to a *second* operation fails here
  rather than going unnoticed — the failure worth catching is the inverse of this one.
- **The preview deliberately has none**, which is consistent rather than an omission: the preview writes nothing,
  so there is nothing to make idempotent.
- **`enqueued: false` now has two causes, not one.** api's `V19__notification_request_id.sql` adds a unique index
  on `("deedPollId", "requestId")` beside V15's per-referral one, and `CaseEmailService.resolveRefusedInsert`
  distinguishes them: the same key with the same content is the first receipt, the same key with **different**
  content is a **409** (one journey's UUID reused for a second email, which api cannot disambiguate), and the same
  email reached from a *second* journey is the older index answering as it always did. `sentEmailSchema`'s
  docblock says all three; its previous version described only the third and would have read as complete.

**Both email write bodies still publish properly**, which is this file's mandatory check: three slots with real
caps rather than `{}`, so `OpenAPIWriteBodies` was extended for the new slot. Both keep
**`additionalProperties: false`** — still the contract's only two — and that is now load-bearing in a way it was
not: it is what makes an idempotency UUID *in the body* a 400 that names it rather than a silently ignored field.
`SendEmailRequest.required` is still **undefined**, and that is not laxity: `documents_required` is required of ⑤
and of neither other template, and conditional mandatoriness is not expressible in one `required` list serving
three templates. api enforces it per template and names the field; this app's schema enforces the caps only.

**The new slot key is `snake_case` like the other two**, for the same reason — it is a GOV.UK Notify
placeholder name, so it is the personalisation key and the body key at once. A rename above this layer breaks
personalisation **silently**. `contract.test.ts` pins all three keys at both ends and pins the absence of
`documentsRequired`.

## What the notify-3b refresh changed that was not an addition

**Three parameter descriptions, and nothing else** — the first refresh here whose non-addition list is not empty,
and all three are prose rather than structure. Measured at the three levels the email refresh established:

1. **All 38 pre-existing schemas but six are byte-identical**, compared serialised one at a time. The six are
   accounted for property-by-property and every change is an addition:
   - `ReferralResponse` — `confirmationRequestedAt`, `confirmationReceivedAt` (both `date-time`),
     `confirmationRecordedBy` (`string`) and `confirmationOutcome` (an **inline** `string` enum of `Confirmed` /
     `Withdrawn`).
   - `CaseDetailResponse` **and `SavedCaseResponse`** — `awaitingConfirmationSince` (`date-time`), identically.
     The second is the one the plan's provisional table missed and a property-by-property account found: this
     feature never reads a `SavedCaseResponse`, so registering it only on the detail would have failed the
     schema comparison on a schema nothing here consumes.
   - `CaseSummaryResponse` — `daysAwaitingConfirmation` (`integer`, `int32`), on **every** row and not only on
     the filter's. It is `null` for a case waiting for nothing and `0` on the day the email was sent, never 1.
   - `CreateSavedQueryRequest` and `UpdateSavedQueryRequest` — `awaitingConfirmation` **appended** to the
     `filter` enum, so the new tab is savable like any other and `LIST_FILTER` keeps api's order.
2. **Every pre-existing operation is structurally byte-identical and not one `operationId` shifted** —
   `CaseworkerReferralController.recordConfirmation` collided with nothing. Three carry a changed
   *description* and no other difference:
   - `GET /caseworker/cases`'s `filter` gains its **first-ever** description, which names the six tabs; its
     `sort` gains `awaitingConfirmationSince` and documents the tab's own default order. The sortable list went
     70 → 71 names, inserted at index 66 directly after `refundReference`, with the 70 shared names in
     byte-identical order and `createdOn, modifiedOn, createdBy, modifiedBy` still the last four — so the
     `List.of` determinism fix from #18 holds and this is not that bug returning. `where` and `q` are identical.
   - Both email operations' `template` parameter now names `request-confirmation-to-proceed` beside
     `application-rejected`. That is the whole of notify-3's contract delta, and it is invisible to
     `contract.test.ts` by design: template keys are bare strings inside `EmailTypeResponse`, never an enum.
3. **The file diff is additive at the line level**: 96 insertions, 3 deletions, once `npx biome format --write`
   has been run — and the three deletions are the `sort` description and the two `filter` enum lines, each
   replaced by its longer self. No `-` line has no `+` counterpart.

**The one keyed write body published properly**, which is this file's mandatory check: `RecordConfirmationRequest`
carries `outcome` (required, an inline enum of two) and `note` (`maxLength: 1000`, optional), not the `{}` of
2026-09-17, so `OpenAPIWriteBodies` was extended for the new resource. It omits `type: object` like every other
hand-registered body here, and it publishes **`additionalProperties: true`** — the opposite of the two email
bodies, which are this contract's only `false`. That is api's deliberate choice and it is a trap worth naming:
`confirmationRecordedBy` and `confirmationReceivedAt` sent from here would be **ignored rather than refused**, so
api derives the recorder from the token and the date from its clock while nothing fails. `contract.test.ts` asserts
their absence from the write schema, and it is the only thing that would catch one.

**Neither new enum is a named schema.** Both member lists are inline — on `RecordConfirmationRequest.outcome` and
on `ReferralResponse.confirmationOutcome` — so `WIRE_SCHEMAS` gains exactly one entry and there is no
`ConfirmationOutcome` to register. `CONFIRMATION_OUTCOME` in `wire.ts` is therefore pinned by the drift test's
per-property enum comparison on each of those two, which is stronger than `REFERRAL_REASON`'s position: that one
is on an array's *items* and the test cannot reach it at all.

## What the api-6 refresh changed that was not an addition

**Nothing** — the same answer as the email refresh below, and stated rather than omitted for the same reason: an
empty list here is a finding. It means the personal list arrived without disturbing anything, and there is nothing
to raise upstream. Measured rather than eyeballed, and at the three levels that refresh established:

1. **All 37 pre-existing schemas are byte-identical** — compared serialised, one at a time, not by count.
2. **Every pre-existing operation is byte-identical**, including its parameters and their descriptions, and **not
   one `operationId` shifted**. springdoc names an operation after its handler method, and
   `JudicialReferralController.mine` collided with nothing — which is luck rather than design, since a handler
   named `pool` or `referral` would have taken a suffix and moved somebody else's.
3. **The file diff is additive at the line level too**: 63 insertions, 0 deletions, once `npx biome format
   --write` has been run on the file as step 1 below insists.

**The stop conditions `referrals-admin-6` set are all clear, and they are the substance of this refresh rather
than its counts.** api-6 moved judicial ownership from the display name to the token's IDAM subject — a real
defect, in which two judges sharing a display name saw and directed each other's referrals — and it did that with
two new **columns**, `claimedById` and `decidedById` (`V14__referral_owner_subjects.sql`):

- **No owner identifier is on the wire.** Neither column appears in any DTO, and `JudicialMyReferralsResponse` is
  `{ page, size, total, totalPages, referrals }` and nothing else. That absence is what makes whose list `mine`
  returns unforgeable — it comes from the token — so `contract.test.ts` now asserts it across every `Judicial*`
  schema rather than leaving it to a reading of this file.
- **No application data reached the list rows.** `JudicialMyReferralsResponse.referrals` `$ref`s
  `JudicialReferralSummary`, so the personal list is literally the pool's row: no case reference, no applicant
  name. A second row shape is what would have let one list grow a field the other has not got, and there is not
  one.
- **`claimedBy`/`decidedBy` remain**, as the attribution a caseworker reads. They authorise nothing at either
  end now — which is the one thing about this refresh that an adapter could get wrong and no schema comparison
  would catch, and it is why the mock holds a subject beside the name and its tests pin the isolation.

## What the email refresh changed that was not an addition

**Nothing.** That is stated rather than omitted, because the two entries below each have a list here and an
empty one is a finding: it means the email surface arrived without disturbing anything, and there is nothing to
raise upstream. Measured rather than eyeballed, and at three levels:

1. **All 27 pre-existing schemas are byte-identical** — compared serialised, one at a time, not by count. The
   2026-09-17 defect is why this is the check that matters: an operation count moving correctly is entirely
   compatible with a body published as `{}`.
2. **Every pre-existing operation is byte-identical**, including its parameters and their descriptions, and
   **not one `operationId` shifted** — against eight in 2026-09-17 and one in 2026-09-18. springdoc names an
   operation after its handler method, and `CaseworkerEmailController`'s three (`emails`, `preview`, `send`)
   collided with nothing.
3. **The file diff is additive at the line level too**: 310 insertions, 0 deletions, once formatted the way the
   committed file is. `JSON.stringify(…, null, 2)` alone reported 1,291 insertions and 221 deletions, all of it
   short-array formatting — **run `npx biome format --write` on the file after copying it**, or the diff hides
   whether anything was removed. That is a step the instructions below did not have and now do.

**Both email write bodies published properly**, which is this file's mandatory check: `PreviewEmailRequest` and
`SendEmailRequest` each carry their two slots with real caps (`judges_reason` 4000, `additional_notes` 1000),
not the `{}` of 2026-09-17, so `OpenAPIWriteBodies` was extended for the new resource. Both omit `type: object`,
matching every other hand-registered write body here, and both carry **`additionalProperties: false`** — alone in
this contract. `contract.test.ts` pins that, because it is what makes an unknown body key a 400 that names it.

**Two things this refresh registered against convention rather than with it**, both recorded in `wire.ts` at the
schemas that carry them and both pinned by the contract test:

- **The slot keys are `snake_case`** — `judges_reason`, `additional_notes`, and the keys inside
  `EmailSlotDefaultsResponse.fields`. They are GOV.UK Notify placeholder names, so they are the personalisation
  keys and the request-body keys at once; api's own source says they "are not renamed to Java style anywhere".
  This is the documented exception to "the wire is camelCase and nothing is renamed at the boundary", and a
  rename made above this layer breaks personalisation **silently** — Notify substitutes nothing and sends the
  template with empty slots.
- **`EmailPreviewResponse.html` and `.subject` are registered nullable although api cannot send null.**
  `EmailPreview.from` reads the Notify client's two `Optional`s with `orElse("")`, so an absent rendering
  arrives as an **empty string**. Registered permissively anyway: a preview that cannot be shown has to become
  a sentence on the page, not an `invalid-response` that takes the journey to the 500 page. A caller checking
  only for null is the bug this note exists to prevent.

## What the 2026-09-18 refresh changed that was not an addition

Three things, each accounted for property by property against `3b2579a`. Nothing was removed on either axis,
and no pre-existing schema was retyped:

1. **`currentReferralState` on three case schemas** — `CaseSummaryResponse`, `CaseDetailResponse` and
   `SavedCaseResponse`, identically: `{"type":"string","enum":["Open","Claimed","Decided","Closed",
   "Withdrawn"]}`. api's denormalisation of "the state of the case's one non-terminal referral, or null". A
   deep diff of all 19 pre-existing schemas found these three properties and nothing else.
2. **One `operationId` shift** — `POST /caseworker/cases/{id}/notes` went `create_3` → `create_4`, because the
   new `POST …/referrals` took `create_3`. The collision-by-shape churn described below; nothing here keys off
   an `operationId`. One moved, against eight last refresh.
3. **`currentReferralState` appended to the `sort` parameter's sortable-field list** on `GET /caseworker/cases`
   — 69 names to 70, inserted at index 15, directly after `state`. **Not the determinism bug returning**, and
   that was checked rather than eyeballed: the 69 shared names are in byte-identical order and
   `createdOn, modifiedOn, createdBy, modifiedBy` are still the last four in #18's pinned order, so the
   `List.of` fix holds. Registering the field as *queryable* in
   `libs/deed-poll/src/deed-poll/query-fields.ts` is a later plan's work; the adapter reads no parameter
   description.

**Both keyed write bodies published properly**, which is the check the 2026-09-17 defect below made mandatory:
`CreateReferralRequest` carries four properties (`reasons` required, `minItems: 1`, an items-level enum of six;
`notes` capped at 1000; `urgency`; `urgencyReason` capped at 500) and `JudicialDirectionRequest` three
(`decision` and `publishToGazette` required, `directionsText` capped at 4000). Neither is `{}`, so
`OpenAPIWriteBodies`'s `describeReferralBody`/`describeDirectionBody` did their job and there is nothing to
raise upstream. One shared quirk, checked rather than assumed new: **every hand-registered write body omits
`type: object`** — `CreateSavedQueryRequest`, `UpdateSavedQueryRequest`, `CreateNoteRequest` and
`CreateCaseRequest` all publish `type: undefined` with their properties present, and the two referral bodies
match them.

**`CreateReferralRequest.reasons` is the one enum the drift test cannot pin**: api publishes the six members on
the array's *items*, and `contract.test.ts` reads `properties[x].enum`. `REFERRAL_REASON` in `wire.ts` is
therefore checked by hand at each refresh — a member added at api's end fails at the wire, not in the suite.

## What the 2026-09-17 refresh changed that was not an addition

The diff is otherwise **byte-identical** once two things are accounted for, both verified rather than assumed:

1. **Eight `operationId` values shifted their suffix** — `create` → `create_1`, `delete` → `delete_1`, and so
   on. That is the collision-by-shape described below, and it is why nothing here keys off an `operationId`.
2. **Nothing else.** The `sort` parameter's field list *appeared* to reorder its last four names, and that was
   a real api bug rather than churn: `CaseSort` held the four audit columns in a `Set.of`, whose iteration
   order Java randomises per JVM, so each regeneration published them differently. Fixed upstream in
   `hmcts/deed-poll-api#18` — `List.of`, with a test pinning the order — and verified by regenerating the
   document three times in separate JVMs. **If a future refresh shows those four moving again, that fix has
   regressed; it is not normal.**

## Two api defects this refresh surfaced

Recorded because both were invisible in the operation counts, which is what a reviewer checks first:

- **`CreateSavedQueryRequest` and `UpdateSavedQueryRequest` published as `{}`.** Every api write body binds as
  a keyed map, so springdoc reflects no fields and `OpenAPIWriteBodies` compensates by hand — and it had not
  been extended for the new resource. `contract.test.ts` would have matched two empty schemas and a client
  built from them would have sent nothing. Fixed in `hmcts/deed-poll-api#17`, which also added a
  classpath-scanning guard so a future keyed body fails api's own build rather than shipping empty.
- The determinism bug above.

**The lesson for the next refresh: read the schemas, not just the paths and counts.** An operation count moving
correctly is compatible with a body that describes nothing.

**The `delete` operation ids are Spring's, and they collide by shape.** springdoc names an operation after
its handler method, so the note delete is `delete_1` and the witness delete is `delete` — the suffix moves
between refreshes as controllers are added, which is why nothing here keys off an `operationId`.
`contract.test.ts` compares `METHOD path`.

## Refreshing it

In the api clone, on a clean `master`:

```bash
export TESTCONTAINERS_RYUK_DISABLED=true      # this devcontainer only; Ryuk is unreachable over IPv6 here
./gradlew integration --tests "*OpenAPIPublisherTest*"
```

That writes `/tmp/openapi-specs.json`. **`--tests`, not `-Dtest.single=…`** — which this file used to say: it
is a Gradle 1.x idiom that is silently ignored rather than refused, so it "works" only by running the whole
integration source set. Harmless here, misleading anywhere else.

The test needs a database container, so Docker must be running.

**Take the artefact from the intended API revision.** Since `34d4bd3`, API explicitly publishes the
relative `/` server, independent of the generating request. Earlier revisions derived a local HTTP
URL from that request. The relative server does not configure TLS or choose admin's runtime endpoint;
do not describe its removal of a literal HTTP URL as proof that transport is encrypted.

Then, in this repo:

1. Reformat as you copy — the file is 2-space JSON and api emits it minified:
   `node -e 'const s=require("/tmp/openapi-specs.json");require("fs").writeFileSync("libs/deed-poll-api-client/openapi.json",JSON.stringify(s,null,2)+"\n")'`
   Then **`npx biome format --write libs/deed-poll-api-client/openapi.json`**, which is not optional: Biome
   collapses short arrays onto one line and the committed file is in its formatting, so skipping it produces
   hundreds of phantom deletions and step 3 can no longer tell an addition from a removal by reading the diff.
2. Update the commit table above, and add a row for what it replaced rather than overwriting it.
3. **Diff the schemas, not only the paths and the operation count.** A count that moves correctly is entirely
   compatible with a request body published as `{}` — that is exactly what happened on 2026-09-17. Compare
   `components.schemas` property-by-property against the previous version, and account for every change:
   expected addition, known `operationId` churn, or a bug to raise upstream.
4. `yarn test` — `src/api/contract.test.ts` compares the document against the wire schemas, so anything api
   added or renamed fails rather than going unnoticed. Note what it cannot see: an **empty** schema matches an
   empty registration silently, which is why step 3 is a human read and not a test.

## Three things the document does not say

The first two are recorded in `src/api/wire.ts` at the code that compensates, and both are pinned by the
contract test so they cannot be quietly forgotten:

1. **Nullability of responses.** springdoc emits none for a response body, so `type: string` there means
   "a string when present" rather than "never null". The schemas treat every response property as nullable
   except the handful that are Java primitives at the source; `STRICT_RESPONSE_PROPERTIES` lists them.
2. **The error body.** api's failures come from a `@RestControllerAdvice`, and springdoc only publishes
   schemas a declared response references. Until api documented its 403 (`OpenAPIForbiddenResponses`, 2026-10-20),
   `ApiError` was absent and lived in an `UNSPECIFIED_SCHEMAS` exemption. It is now published, with `FieldError`, and
   registered in `WIRE_SCHEMAS` like every other schema. Other 4xx responses (400, 404, 409) still carry it without
   declaring it.
3. **The actuator.** springdoc does not document management endpoints, so `GET /health/liveness` — the one
   path `checkApiReachable` and the readiness probe depend on — is absent, and `contract.test.ts` therefore
   cannot pin it. Its authority is api's `application.yaml` (`management.endpoints.web.base-path: /`, plus
   `management.endpoint.health.probes.enabled: true` and the `liveness` group's `include: livenessState`)
   and `SecurityConfiguration.PUBLIC_PATHS`, which allowlists `/health` and `/health/**` unauthenticated.
   **Re-check those two files when refreshing this document**: a change to the base path or to the probe
   group would take this app's readiness down permanently with nothing here failing to warn about it.
4. **The query vocabulary, except as prose.** The operator table, the value arity of each operator and the
   sortable field names arrive only inside the `where` and `sort` parameter *descriptions* — springdoc has
   no schema for "which operators a field's kind admits". So `contract.test.ts` cannot pin
   `libs/deed-poll/src/deed-poll/query-fields.ts` against them, and their authority is api's
   `QueryOperator` and `CaseSort.sortableFields()`. **Read those descriptions when refreshing this
   document**: an operator api adds is a control this app will not offer, and one it removes is a 400 the
   builder can produce.

## Gazette relinquishment exclusion refresh — 8 October 2026

The full structural comparison found exactly one change: the `filter` parameter
description on `GET /caseworker/cases` now documents the Deed of Relinquishment
exclusion and unchanged handling of other/unset types. Operations, paths, schemas
and the deferred CCD definitions are identical. The mock implements the exclusion;
the production UI continues to use the API result and total.

Validation: 607 API-client/mock tests, lint and the client TypeScript build passed.
API validation passed 170 focused filter/controller tests, 14 OpenAPI checks and
main/test Checkstyle. Existing normal case access and frozen history are unchanged.

Previous Gazette foundation provenance:

| Item | Evidence |
|---|---|
| **api source** | Merged master `742cb5a6a842a6e76b4e98cd59869da889032d50` (API PR #93), including the Gazette ledger, preview, send and recovery contract. |
| **Previous taken on** | 2026-10-09 |
| **Previous how** | Regenerated in a clean detached API worktree with `./gradlew integration --tests "*OpenAPIPublisherTest*"`; copied from `/tmp/openapi-specs.json`, 2-space JSON then Biome. Raw SHA-256 `c5465002de9a57d175cad73a9b33392b22d8e73337cd02df5ece51eec80b86cc`. |
