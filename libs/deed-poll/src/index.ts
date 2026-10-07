// Deed-poll domain logic, ported from the power_app_nest prototype.
//
// Framework-agnostic by design: no Express, no HTTP concerns, no Nest DI. The app's pages
// import named functions from here.
//
// The prototype expressed these as Nest @Injectable() classes. They held no state, so
// per this repo's conventions they are plain exported functions here.

// Named, not `export *`, because `callApi` must NOT be on this package's public surface: it hands its
// caller an `ApiConfig` and lets it invoke any adapter function directly, which is the seam
// `.claude/rules/backend.md` states nothing outside `api/deed-poll-api.ts` crosses. A page that reached
// api through it would bypass the domain layer and its error mapping. `Caller` is public because
// the app's `callerFromRequest` returns one, and `deedPollApiStatus` because `app.ts` mounts it as a
// readiness check.
export { type Caller, deedPollApiStatus } from "./api/deed-poll-api.js";
export * from "./auth/current-user.js";
export * from "./auth/idam-claims.js";
export * from "./auth/plain-http.js";
export * from "./auth/roles.js";
export * from "./deed-poll/card-layout.js";
export * from "./deed-poll/case-header.js";
export * from "./deed-poll/case-query.js";
export * from "./deed-poll/case-state.js";
export * from "./deed-poll/date-parts.js";
export * from "./deed-poll/deed-poll-validation.js";
export * from "./deed-poll/detail-view.js";
export * from "./deed-poll/edit-view.js";
export * from "./deed-poll/enums/dynamics-values.js";
export * from "./deed-poll/enums/option-sets.js";
export * from "./deed-poll/form-fields.js";
export * from "./deed-poll/form-payload.js";
export * from "./deed-poll/form-presentation.js";
export * from "./deed-poll/form-validation.js";
export * from "./deed-poll/list-filters.js";
export * from "./deed-poll/list-paging.js";
export * from "./deed-poll/list-sort.js";
export * from "./deed-poll/list-view.js";
export * from "./deed-poll/query-builder.js";
export * from "./deed-poll/query-fields.js";
export * from "./deed-poll/schemas.js";
export * from "./deed-poll/service.js";
export * from "./documents/document-types.js";
export * from "./documents/documents-view.js";
export * from "./documents/schemas.js";
export * from "./documents/service.js";
export * from "./documents/upload-policy.js";
export * from "./emails/emails-view.js";
export * from "./emails/service.js";
export * from "./emails/slot-validation.js";
export * from "./errors.js";
export * from "./gazette/service.js";
export * from "./gazette/view.js";
export * from "./judicial/schemas.js";
export * from "./judicial/service.js";
export * from "./judicial/view.js";
export * from "./notes/delete-policy.js";
export * from "./notes/note-form.js";
export * from "./notes/notes-view.js";
export * from "./notes/schemas.js";
export * from "./notes/service.js";
export * from "./referrals/awaiting-confirmation.js";
export * from "./referrals/legacy-referral-view.js";
export * from "./referrals/referrals-view.js";
export * from "./referrals/returned-for-action.js";
export * from "./referrals/schemas.js";
export * from "./referrals/service.js";
export * from "./saved-queries/schemas.js";
export * from "./saved-queries/service.js";
export * from "./saved-queries/view.js";
export * from "./schema-primitives.js";
export * from "./witnesses/delete-policy.js";
export * from "./witnesses/enrolment-requirement.js";
export * from "./witnesses/schemas.js";
export * from "./witnesses/service.js";
