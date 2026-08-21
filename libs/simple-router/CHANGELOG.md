# @hmcts-cft/simple-router

## [2.2.0](https://github.com/hmcts/deed-poll-admin/compare/simple-router-v2.1.0...simple-router-v2.2.0) (2026-05-18)


### Features

* replace concurrently+nodemon with tsx watch and Vite dev middleware ([#661](https://github.com/hmcts/deed-poll-admin/issues/661)) ([ecfe1cc](https://github.com/hmcts/deed-poll-admin/commit/ecfe1ccef0f5e0a644f53af0a6da93df90936ed7))

## [2.1.0](https://github.com/hmcts/deed-poll-admin/compare/simple-router-v2.0.0...simple-router-v2.1.0) (2026-05-13)


### Features

* compiled-package libs and turbo dev pipeline ([#617](https://github.com/hmcts/deed-poll-admin/issues/617)) ([523cc67](https://github.com/hmcts/deed-poll-admin/commit/523cc67dc89964df955bd3b232b036bac8344b08))
* publish @hmcts-cft/simple-router to Azure Artifacts ([#639](https://github.com/hmcts/deed-poll-admin/issues/639)) ([cc7a165](https://github.com/hmcts/deed-poll-admin/commit/cc7a165d23c6d75d469b19a53cad9ceea55ddb19))
* publish @hmcts/simple-router to npm via changesets ([#628](https://github.com/hmcts/deed-poll-admin/issues/628)) ([d7fba7a](https://github.com/hmcts/deed-poll-admin/commit/d7fba7aee349ecc7d2f434b34039d3dc658f1dcd))
* refactor routes, assets, and prisma models ([#610](https://github.com/hmcts/deed-poll-admin/issues/610)) ([bfd3d84](https://github.com/hmcts/deed-poll-admin/commit/bfd3d847843831c50a2a30d551add1e286a68c28))
* refactor routes, assets, and prisma models ([#610](https://github.com/hmcts/deed-poll-admin/issues/610)) ([bfd3d84](https://github.com/hmcts/deed-poll-admin/commit/bfd3d847843831c50a2a30d551add1e286a68c28))


### Bug Fixes

* **deps:** update dependency express to v5.2.1 ([#225](https://github.com/hmcts/deed-poll-admin/issues/225)) ([519f668](https://github.com/hmcts/deed-poll-admin/commit/519f66812776bd363a312534a845fc562e41c9d8))

## 2.0.0

### Major Changes

- cc7a165: Rename `@hmcts/simple-router` to `@hmcts-cft/simple-router` and publish to the HMCTS Azure Artifacts `hmcts-lib` feed instead of public npm. The previous `@hmcts` scope on npmjs.org was never successfully populated; the CFT-allocated `@hmcts-cft` scope on Azure Artifacts is the canonical home going forward. Consumers must update their imports and add an `.npmrc` scope-mapping for `@hmcts-cft` to the Azure feed.
