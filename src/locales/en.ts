export const content = {
  welcome: "Welcome to Deed poll admin",
  // Reaches `page-title.njk` as `{{ title }} - {{ serviceName }} - {{ govUk }}`, so this is in the
  // browser tab and every bookmark on every page. It was still the re-scaffold's
  // "Express Monorepo Template" until Steve settled the name on 2026-09-03; `deed-poll-admin` matches
  // the repo, the product code, the vault names and the image path, so the service reads as one thing.
  serviceName: "Deed poll admin",
  headerTitle: "Deed Poll",
  hmctsLogoAlt: "HM Courts & Tribunals Service",
  phase: "beta",
  govUk: "GOV.UK",
  back: "Back",
  signOut: "Sign out",
  accountNavigation: "Account",
  // The timeout warning on every signed-in page (OWASP plan 03, Task 7). `{time}` is filled in by the script.
  sessionTimeout: {
    idleHeading: "You’re about to be signed out",
    idleBody: "For your security, you will be signed out in 2 minutes if you do not do anything. Any changes you have not saved will be lost.",
    staySignedIn: "Stay signed in",
    signOutNow: "Sign out",
    absoluteHeading: "You will need to sign in again soon",
    absoluteBody: "For your security, you will be signed out at {time}. Save your work now. You will need to sign in again.",
    continue: "Continue"
  },
  // The 429 page (`src/pages/errors/429.njk`): an abuse limit, api's or this app's, asking the caseworker to wait.
  tooManyRequests: {
    heading: "You have made too many requests",
    explanation: "To protect the service, there is a limit on how often this can be done.",
    tryAgainInOneMinute: "Try again in 1 minute.",
    tryAgainInMinutes: "Try again in {minutes} minutes.",
    tryAgainLater: "Try again later."
  },
  navigation: {
    home: "Home",
    about: "About",
    contact: "Contact us"
  },
  footer: {
    cookies: "Cookies",
    privacyPolicy: "Privacy policy",
    accessibility: "Accessibility statement",
    termsAndConditions: "Terms and conditions",
    contactUs: "Contact us"
  },
  language: {
    switch: "Cymraeg",
    current: "English",
    ariaLabel: "Change language to Welsh"
  },
  feedback: {
    part1: "This is a new service – ",
    part2: "give feedback",
    part3: " to help us improve it.",
    ariaLabel: "Give feedback about this page",
    link: "/feedback?page="
  },
  common: {
    email: "Email",
    telephone: "Telephone",
    post: "Post",
    warning: "Warning",
    findOutAboutCallCharges: "Find out about call charges",
    callChargesLink: "https://www.gov.uk/call-charges"
  },
  serviceConfig: {
    contactEmail: "enquiries@hmcts.gsi.gov.uk",
    contactPhone: "0300 303 0642",
    openingHours: "Monday to Friday, 10am to 6pm",
    postalAddress: ["CTSC (Courts and Tribunal Service Centre)", "C/o HMCTS Digital Services", "PO Box 13226", "Harlow", "CM20 9UG"],
    dataRetentionPeriod: "90 days",
    temporaryDataPeriod: "1 month",
    contactFormUrl: "https://contact-us.form.service.justice.gov.uk/"
  }
};
