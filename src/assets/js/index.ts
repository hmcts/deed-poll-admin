import cookieManager from "@hmcts/cookie-manager";
import { initAll } from "govuk-frontend";

initAll();

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
      cookies: ["connect.sid", "_csrf", "cookie_policy", "cookies_preferences_set", "locale"]
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
