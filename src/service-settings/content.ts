/**
 * The Delivery Manager settings page's words, shared by its two routes because both render one template.
 *
 * The London Gazette strings moved here with the recipient form and keep their Welsh. Everything else is new copy
 * awaiting translation, so `cy` mirrors it and `yarn welsh:check` counts it.
 */

export const en = {
  title: "Service settings",
  heading: "Service settings",
  intro: "Change how the service works for every case. Save each section before you change another.",
  successTitle: "Success",
  errorSummaryTitle: "There is a problem",
  lastChanged: "Last changed",
  by: "by",
  processHeading: "Referral claim window",
  processHint: "How long a judge can hold a claimed referral without working on it. Enter between 30 minutes and 24 hours.",
  hoursLabel: "Hours",
  minutesLabel: "Minutes",
  processWarning:
    "Changes take effect immediately for every case. A judge’s claim that has been untouched for longer than the new window returns to the shared pool the next time any judge opens the referral pool or their own referrals, or claims a referral. A longer window does not return claims that have already gone back to the pool.",
  warningIcon: "Warning",
  processNeverChanged: "The claim window has not been changed since the service started.",
  processSave: "Save claim window",
  processSaved: "Claim window saved.",
  processUnavailable: "The claim window could not be loaded. Try again later.",
  processHours: "Enter hours as a whole number from 0 to 24",
  processMinutes: "Enter minutes as a whole number from 0 to 59",
  processRequired: "Enter how long a judge can hold a claimed referral",
  processRange: "The claim window must be between 30 minutes and 24 hours",
  processReload: "Reload the settings before saving",
  processConflict: "The claim window has changed since you opened this page. Reload the settings and check the current value before saving again.",
  processReloadLink: "Reload claim window settings",
  processRefused: "The claim window could not be saved. Reload the settings and try again.",
  gazetteHeading: "London Gazette recipient",
  gazetteIntro: "Set the email address at The London Gazette that should receive publication requests and spreadsheet download links.",
  gazetteHint: "Use the Gazette recipient’s address, not the court’s contact or reply-to address.",
  gazetteEmailLabel: "Recipient email address",
  gazetteNotSet: "The recipient email address has not been set.",
  gazetteSave: "Save recipient",
  gazetteBack: "Applications ready for the London Gazette",
  gazetteSaved: "Recipient email address saved.",
  gazetteUnavailable: "The London Gazette recipient could not be loaded. Try again later.",
  gazetteRequired: "Enter the London Gazette recipient email address",
  gazetteInvalid: "Enter a valid email address, like name@example.com",
  gazetteReload: "Reload the settings before saving",
  gazetteConflict: "The recipient has changed since you opened this page. Reload the settings and check the current address before saving again.",
  gazetteReloadLink: "Reload recipient settings",
  gazetteRefused: "The recipient could not be saved. Reload the settings and try again.",
  staffHeading: "Staff and access",
  staffIntro: "Add staff and change their access in Manage Case. You need staff-admin access in Manage Case to do this.",
  staffLink: "Manage staff in Manage Case (opens in new tab)"
};

export const cy = {
  ...en,
  successTitle: "Llwyddiant",
  errorSummaryTitle: "Mae problem wedi codi",
  lastChanged: "Newidiwyd ddiwethaf",
  by: "gan",
  gazetteHeading: "Derbynnydd y London Gazette",
  gazetteIntro: "Gosodwch gyfeiriad e-bost y London Gazette a ddylai dderbyn ceisiadau cyhoeddi a dolenni i lawrlwytho taenlenni.",
  gazetteHint: "Defnyddiwch gyfeiriad y derbynnydd yn y Gazette, nid cyfeiriad cyswllt neu ateb y llys.",
  gazetteEmailLabel: "Cyfeiriad e-bost y derbynnydd",
  gazetteNotSet: "Nid yw cyfeiriad e-bost y derbynnydd wedi’i osod.",
  gazetteSave: "Cadw’r derbynnydd",
  gazetteBack: "Ceisiadau sy’n barod ar gyfer y London Gazette",
  gazetteSaved: "Mae cyfeiriad e-bost y derbynnydd wedi’i gadw.",
  gazetteRequired: "Rhowch gyfeiriad e-bost derbynnydd y London Gazette",
  gazetteInvalid: "Rhowch gyfeiriad e-bost dilys, fel enw@enghraifft.com",
  gazetteReload: "Ail-lwythwch y gosodiadau cyn cadw",
  gazetteConflict: "Mae’r derbynnydd wedi newid ers i chi agor y dudalen hon. Ail-lwythwch y gosodiadau a gwiriwch y cyfeiriad presennol cyn cadw eto.",
  gazetteReloadLink: "Ail-lwytho gosodiadau’r derbynnydd",
  gazetteRefused: "Ni ellid cadw’r derbynnydd. Ail-lwythwch y gosodiadau a rhowch gynnig arall arni."
};
