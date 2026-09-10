// Use the definition of the English translations to ensure the Welsh has the same structure
type Translations = typeof import("./en.js").content;

export const content: Translations = {
  // `i` triggers soft mutation, so `Gweinyddu` loses its G — the same rule as `Cymru` → `i Gymru`. The
  // first version of this line read "i Gweinyddu" and was wrong, which is the concrete argument for not
  // shipping machine-drafted Welsh unreviewed: mutation errors are subtle, confident and easy to miss.
  welcome: "Croeso i Weinyddu gweithred newid enw",
  // NOT professionally translated — see the Welsh note in .business_context/PROGRESS.md. A placeholder
  // pending the commissioned translation, and a service name is exactly the kind of string a translator
  // should settle rather than a developer: `gweithred newid enw` is a descriptive rendering of "deed
  // poll" and is **not** verified against the official HMCTS term. It is at least Welsh rather than
  // English, which the rest of this service's `cy` values are not.
  serviceName: "Gweinyddu gweithred newid enw",
  phase: "beta",
  govUk: "GOV.UK",
  back: "Yn ôl",
  navigation: {
    home: "Hafan",
    about: "Amdanom",
    contact: "Cysylltu â ni"
  },
  footer: {
    cookies: "Cwcis",
    privacyPolicy: "Polisi preifatrwydd",
    accessibility: "Datganiad hygyrchedd",
    termsAndConditions: "Telerau ac amodau",
    contactUs: "Cysylltu â ni"
  },
  language: {
    switch: "English",
    current: "Cymraeg",
    ariaLabel: "Newid iaith i Saesneg"
  },
  feedback: {
    part1: "Mae hwn yn wasanaeth newydd – ",
    part2: "rhowch adborth",
    part3: " i'n helpu i'w wella.",
    ariaLabel: "Rhoi adborth am y dudalen hon",
    link: "/feedback?page="
  },
  common: {
    email: "E-bost",
    telephone: "Ffôn",
    post: "Post",
    warning: "Rhybudd",
    findOutAboutCallCharges: "Darganfyddwch am gostau galwadau",
    callChargesLink: "https://www.gov.uk/call-charges"
  },
  serviceConfig: {
    contactEmail: "enquiries@hmcts.gsi.gov.uk",
    contactPhone: "0300 303 0642",
    openingHours: "Dydd Llun i ddydd Gwener, 10am i 6pm",
    postalAddress: ["CTSC (Canolfan Wasanaeth Llysoedd a Thribiwnlysoedd)", "C/o Gwasanaethau Digidol GLlTEF", "PO Box 13226", "Harlow", "CM20 9UG"],
    dataRetentionPeriod: "90 diwrnod",
    temporaryDataPeriod: "1 mis",
    contactFormUrl: "https://contact-us.form.service.justice.gov.uk/"
  }
};
