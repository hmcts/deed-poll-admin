import cookieManager from "@hmcts/cookie-manager";
import { initAll } from "govuk-frontend";
import { initDocumentTypeAutocomplete } from "./document-type-autocomplete.js";
import { initQueryBuilder } from "./query-builder.js";
import { initSessionTimeout } from "./session-timeout.js";

initAll();

// Loaded through this bundle rather than a `<script>` of its own, because `createAssetHelpers` names a
// nunjucks global after the entry file and `query-builder_js` is not an identifier a template can read.
// `vite.build.ts` makes every `src/assets/js/*.ts` an entry, so it is also emitted as a chunk of its own —
// this import is what pulls that chunk in, not a second copy of it, and nothing else loads it.
//
// After `initAll`, because the controls it swaps in are built to match components that have already
// initialised. A no-op on every page but the case list.
initQueryBuilder();

// The upload form's document-type type-ahead, through this bundle for the query builder's reason, and after `initAll`
// for the same one. A no-op on every page but the upload form.
initDocumentTypeAutocomplete();

// The session timeout warning. A no-op on pages without a signed-in session, which carry no dialog.
initSessionTimeout();

// The document viewer's renderer, imported only where there is a viewer, so PDF.js is its own chunk and no other
// page fetches it. The chunk is same-origin, which is all the CSP's `script-src 'self'` asks of a dynamic import.
const documentViewer = document.querySelector<HTMLElement>('[data-module="app-document-viewer"]');
const viewerModule = documentViewer ? import("./document-viewer/viewer.js") : null;

const config = {
  userPreferences: {
    cookieName: "cookie_policy"
  },
  cookieBanner: {
    class: "govuk-cookie-banner",
    actions: [
      {
        name: "accept",
        buttonClass: "js-cookie-banner-accept",
        confirmationClass: "cookie-banner-accept-message",
        consent: true
      },
      {
        name: "reject",
        buttonClass: "js-cookie-banner-reject",
        confirmationClass: "cookie-banner-reject-message",
        consent: false
      },
      {
        name: "hide",
        buttonClass: "js-cookie-banner-hide"
      }
    ]
  },
  preferencesForm: {
    class: "cookie-preferences-form"
  },
  cookieManifest: [
    {
      categoryName: "essential",
      optional: false,
      matchBy: "exact",
      // Both forms of the session cookie's name, since the browser cannot tell which the server chose. See
      // sessionCookieName in src/auth/session.ts.
      cookies: ["__Host-deed-poll-admin-sid", "deed-poll-admin-sid", "_csrf", "cookie_policy", "cookies_preferences_set", "locale"]
    },
    {
      categoryName: "analytics",
      optional: true,
      cookies: ["_ga", "_gid", "dtCookie", "dtSa", "rxVisitor", "rxvt"]
    },
    {
      categoryName: "preferences",
      optional: true,
      cookies: ["language"]
    }
  ]
};

cookieManager.on("CookieBannerAction", (eventData: any) => {
  const action = typeof eventData === "string" ? eventData : eventData.action;

  // The HMCTS cookie manager will handle showing the confirmation message
  // and the hide button will remove the banner entirely
  if (action === "hide") {
    const banner = document.querySelector(".govuk-cookie-banner");
    if (banner) {
      banner.remove();
    }
  }
});

cookieManager.init(config);

// Cookie controls initialise before a renderer download can suspend this module.
if (viewerModule && documentViewer) {
  const { initDocumentViewer } = await viewerModule;
  initDocumentViewer(documentViewer);
}
