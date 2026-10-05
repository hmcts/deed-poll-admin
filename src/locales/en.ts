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
