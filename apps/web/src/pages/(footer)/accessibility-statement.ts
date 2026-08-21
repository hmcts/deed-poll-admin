import type { Request, Response } from "express";

const en = {
  title: "Accessibility statement",
  sections: {
    intro: {
      content: "This accessibility statement applies to this service.",
      commitment: "We want as many people as possible to be able to use this website. For example, that means you should be able to:",
      features: [
        "change colours, contrast levels and fonts",
        "zoom in up to 300% without the text spilling off the screen",
        "navigate most of the website using just a keyboard",
        "navigate most of the website using speech recognition software",
        "listen to most of the website using a screen reader (including the most recent versions of JAWS, NVDA and VoiceOver)"
      ],
      simpleLanguage: "We've also made the website text as simple as possible to understand.",
      abilityNet: "AbilityNet has advice on making your device easier to use if you have a disability."
    },
    howAccessible: {
      heading: "How accessible this website is",
      content: "We know some parts of this website are not fully accessible:",
      issues: [
        "the text will not reflow in a single column when you change the size of the browser window",
        "you cannot modify the line height or spacing of text",
        "most older PDF documents are not fully accessible to screen reader software",
        "live video streams do not have captions",
        "some of our online forms are difficult to navigate using just a keyboard",
        "you cannot skip to the main content when using a screen reader",
        "there's a limit to how far you can magnify the map on our 'contact us' page"
      ]
    },
    feedback: {
      heading: "Feedback and contact information",
      content: "If you need information on this website in a different format like accessible PDF, large print, easy read, audio recording or braille:",
      contact: {
        email: "Email: enquiries@hmcts.gsi.gov.uk",
        phone: "Telephone: 0300 303 0642",
        hours: "Monday to Friday, 9am to 5pm"
      },
      response: "We'll consider your request and get back to you in 5 working days."
    },
    reporting: {
      heading: "Reporting accessibility problems with this website",
      content:
        "We're always looking to improve the accessibility of this website. If you find any problems not listed on this page or think we're not meeting accessibility requirements, contact:",
      contact: {
        email: "Email: enquiries@hmcts.gsi.gov.uk",
        phone: "Telephone: 0300 303 0642"
      }
    },
    enforcement: {
      heading: "Enforcement procedure",
      content: [
        "The Equality and Human Rights Commission (EHRC) is responsible for enforcing the Public Sector Bodies (Websites and Mobile Applications) (No. 2) Accessibility Regulations 2018 (the 'accessibility regulations').",
        "If you're not happy with how we respond to your complaint, contact the Equality Advisory and Support Service (EASS)."
      ]
    },
    technical: {
      heading: "Technical information about this website's accessibility",
      content:
        "HMCTS is committed to making its website accessible, in accordance with the Public Sector Bodies (Websites and Mobile Applications) (No. 2) Accessibility Regulations 2018."
    },
    compliance: {
      heading: "Compliance status",
      content:
        "This website is partially compliant with the Web Content Accessibility Guidelines version 2.1 AA standard, due to the non-compliances listed below."
    },
    nonAccessible: {
      heading: "Non-accessible content",
      intro: "The content listed below is non-accessible for the following reasons.",
      nonCompliance: {
        heading: "Non-compliance with the accessibility regulations",
        issues: [
          "Some images do not have a text alternative, so people using a screen reader cannot access the information. This fails WCAG 2.1 success criterion 1.1.1 (non-text content).",
          "Some of our online forms are difficult to navigate using a keyboard. For example, because some form controls are missing a 'label' tag. This fails WCAG 2.1 success criterion 2.4.6 (headings and labels).",
          "Some of our online forms have fields where the purpose is not identified. This means the information cannot be filled in automatically. This fails WCAG 2.1 success criterion 1.3.5 (identify input purpose).",
          "Some heading elements are not consistent, or skip heading levels. This fails WCAG 2.1 success criterion 1.3.1 (info and relationships).",
          "Some of our interactive forms are not compatible with screen readers. This fails WCAG 2.1 success criterion 4.1.2 (name, role value).",
          "Our forms are not always compatible with browser auto-complete functions. This fails WCAG 2.1 success criterion 1.3.5 (identify input purpose)."
        ],
        fixing: "We're working to fix these issues."
      },
      disproportionateBurden: {
        heading: "Disproportionate burden",
        content: "Not applicable"
      },
      outsideScope: {
        heading: "Content that's not within the scope of the accessibility regulations",
        pdfs: {
          heading: "PDFs and other documents",
          content: [
            "Many of our older PDFs and Word documents do not meet accessibility standards - for example, they may not be structured so they're accessible to a screen reader. This does not apply to PDFs or other documents published from September 2018.",
            "Some of our PDFs and Word documents are essential to providing our services. For example, we have PDFs with information on how users can access our services, and forms published as Word documents. By September 2020, we plan to either fix these or replace them with accessible HTML pages."
          ]
        }
      }
    },
    testing: {
      heading: "What we're doing to improve accessibility",
      content: "We're currently working on fixing the accessibility issues listed in this statement."
    },
    preparation: {
      heading: "Preparation of this accessibility statement",
      content: [
        "This statement was prepared on 23 September 2019. It was last reviewed on 23 September 2024.",
        "This website was last tested on 1 September 2024. The test was carried out by the Digital Accessibility Centre (DAC).",
        "We tested all pages of the website."
      ]
    }
  }
};

const cy = {
  title: "Datganiad hygyrchedd",
  sections: {
    intro: {
      content: "Mae'r datganiad hygyrchedd hwn yn berthnasol i'r gwasanaeth hwn.",
      commitment: "Rydym eisiau i gymaint o bobl â phosibl allu defnyddio'r wefan hon. Er enghraifft, mae hynny'n golygu y dylech allu:",
      features: [
        "newid lliwiau, lefelau cyferbyniad a ffontiau",
        "chwyddo i mewn hyd at 300% heb i'r testun ddisgyn oddi ar y sgrin",
        "llywio'r rhan fwyaf o'r wefan gan ddefnyddio bysellfwrdd yn unig",
        "llywio'r rhan fwyaf o'r wefan gan ddefnyddio meddalwedd adnabod llais",
        "gwrando ar y rhan fwyaf o'r wefan gan ddefnyddio darllenydd sgrin (gan gynnwys fersiynau diweddaraf JAWS, NVDA a VoiceOver)"
      ],
      simpleLanguage: "Rydym hefyd wedi gwneud testun y wefan mor syml â phosibl i'w ddeall.",
      abilityNet: "Mae gan AbilityNet gyngor ar wneud eich dyfais yn haws i'w defnyddio os oes gennych anabledd."
    },
    howAccessible: {
      heading: "Pa mor hygyrch yw'r wefan hon",
      content: "Rydym yn gwybod nad yw rhai rhannau o'r wefan hon yn gwbl hygyrch:",
      issues: [
        "ni fydd y testun yn ail-lifo mewn colofn sengl pan fyddwch yn newid maint ffenestr y porwr",
        "ni allwch addasu uchder llinell na bylchu testun",
        "nid yw'r rhan fwyaf o ddogfennau PDF hŷn yn gwbl hygyrch i feddalwedd darllenydd sgrin",
        "nid oes ganddynt gapsiynau ar ffrydiau fideo byw",
        "mae rhai o'n ffurflenni ar-lein yn anodd eu llywio gan ddefnyddio bysellfwrdd yn unig",
        "ni allwch neidio i'r prif gynnwys wrth ddefnyddio darllenydd sgrin",
        "mae terfyn i ba mor bell y gallwch chwyddo'r map ar ein tudalen 'cysylltu â ni'"
      ]
    },
    feedback: {
      heading: "Adborth a gwybodaeth gyswllt",
      content:
        "Os oes angen gwybodaeth ar y wefan hon arnoch mewn fformat gwahanol fel PDF hygyrch, print bras, hawdd ei ddarllen, recordiad sain neu braille:",
      contact: {
        email: "E-bost: enquiries@hmcts.gsi.gov.uk",
        phone: "Ffôn: 0300 303 0642",
        hours: "Dydd Llun i ddydd Gwener, 9am i 5pm"
      },
      response: "Byddwn yn ystyried eich cais ac yn ymateb o fewn 5 diwrnod gwaith."
    },
    reporting: {
      heading: "Riportio problemau hygyrchedd gyda'r wefan hon",
      content:
        "Rydym bob amser yn ceisio gwella hygyrchedd y wefan hon. Os ydych yn dod o hyd i unrhyw broblemau nad ydynt wedi'u rhestru ar y dudalen hon neu'n credu nad ydym yn bodloni gofynion hygyrchedd, cysylltwch â:",
      contact: {
        email: "E-bost: enquiries@hmcts.gsi.gov.uk",
        phone: "Ffôn: 0300 303 0642"
      }
    },
    enforcement: {
      heading: "Gweithdrefn orfodi",
      content: [
        "Y Comisiwn Cydraddoldeb a Hawliau Dynol (EHRC) sy'n gyfrifol am orfodi Rheoliadau Hygyrchedd Cyrff Sector Cyhoeddus (Gwefannau a Chymwysiadau Symudol) (Rhif 2) 2018 (y 'rheoliadau hygyrchedd').",
        "Os nad ydych yn hapus â sut rydym yn ymateb i'ch cwyn, cysylltwch â'r Gwasanaeth Cynghori a Chymorth Cydraddoldeb (EASS)."
      ]
    },
    technical: {
      heading: "Gwybodaeth dechnegol am hygyrchedd y wefan hon",
      content:
        "Mae GLlTEF wedi ymrwymo i wneud ei wefan yn hygyrch, yn unol â Rheoliadau Hygyrchedd Cyrff Sector Cyhoeddus (Gwefannau a Chymwysiadau Symudol) (Rhif 2) 2018."
    },
    compliance: {
      heading: "Statws cydymffurfio",
      content:
        "Mae'r wefan hon yn cydymffurfio'n rhannol â Chanllawiau Hygyrchedd Cynnwys Gwe fersiwn 2.1 safon AA, oherwydd y diffyg cydymffurfio a restrir isod."
    },
    nonAccessible: {
      heading: "Cynnwys nad yw'n hygyrch",
      intro: "Mae'r cynnwys a restrir isod yn anhygyrch am y rhesymau canlynol.",
      nonCompliance: {
        heading: "Diffyg cydymffurfio â rheoliadau hygyrchedd",
        issues: [
          "Nid oes gan rai delweddau destun amgen, felly ni all pobl sy'n defnyddio darllenydd sgrin gael mynediad at y wybodaeth. Mae hyn yn methu maen prawf llwyddiant WCAG 2.1 1.1.1 (cynnwys nad yw'n destun).",
          "Mae rhai o'n ffurflenni ar-lein yn anodd eu llywio gan ddefnyddio bysellfwrdd. Er enghraifft, oherwydd bod rhai rheolyddion ffurflen ar goll tag 'label'. Mae hyn yn methu maen prawf llwyddiant WCAG 2.1 2.4.6 (penawdau a labeli).",
          "Mae gan rai o'n ffurflenni ar-lein feysydd lle nad yw'r pwrpas wedi'i nodi. Mae hyn yn golygu na ellir llenwi'r wybodaeth yn awtomatig. Mae hyn yn methu maen prawf llwyddiant WCAG 2.1 1.3.5 (nodi pwrpas mewnbwn).",
          "Nid yw rhai elfennau pennawd yn gyson, neu'n neidio lefelau pennawd. Mae hyn yn methu maen prawf llwyddiant WCAG 2.1 1.3.1 (gwybodaeth a pherthnasoedd).",
          "Nid yw rhai o'n ffurflenni rhyngweithiol yn gydnaws â darllenwyr sgrin. Mae hyn yn methu maen prawf llwyddiant WCAG 2.1 4.1.2 (enw, rôl gwerth).",
          "Nid yw ein ffurflenni bob amser yn gydnaws â swyddogaethau awto-gwblhau porwr. Mae hyn yn methu maen prawf llwyddiant WCAG 2.1 1.3.5 (nodi pwrpas mewnbwn)."
        ],
        fixing: "Rydym yn gweithio i drwsio'r materion hyn."
      },
      disproportionateBurden: {
        heading: "Baich anghymesur",
        content: "Ddim yn berthnasol"
      },
      outsideScope: {
        heading: "Cynnwys nad yw o fewn cwmpas y rheoliadau hygyrchedd",
        pdfs: {
          heading: "PDFs a dogfennau eraill",
          content: [
            "Nid yw llawer o'n PDFs a dogfennau Word hŷn yn bodloni safonau hygyrchedd - er enghraifft, efallai nad ydynt wedi'u strwythuro fel eu bod yn hygyrch i ddarllenydd sgrin. Nid yw hyn yn berthnasol i PDFs neu ddogfennau eraill a gyhoeddwyd o fis Medi 2018.",
            "Mae rhai o'n PDFs a dogfennau Word yn hanfodol i ddarparu ein gwasanaethau. Er enghraifft, mae gennym PDFs gyda gwybodaeth ar sut y gall defnyddwyr gael mynediad at ein gwasanaethau, a ffurflenni a gyhoeddwyd fel dogfennau Word. Erbyn mis Medi 2020, rydym yn bwriadu naill ai trwsio'r rhain neu eu disodli gyda thudalennau HTML hygyrch."
          ]
        }
      }
    },
    testing: {
      heading: "Beth rydym yn ei wneud i wella hygyrchedd",
      content: "Ar hyn o bryd rydym yn gweithio ar drwsio'r materion hygyrchedd a restrir yn y datganiad hwn."
    },
    preparation: {
      heading: "Paratoi'r datganiad hygyrchedd hwn",
      content: [
        "Paratowyd y datganiad hwn ar 23 Medi 2019. Cafodd ei adolygu ddiwethaf ar 23 Medi 2024.",
        "Profwyd y wefan hon ddiwethaf ar 1 Medi 2024. Cynhaliwyd y prawf gan y Ganolfan Hygyrchedd Digidol (DAC).",
        "Fe wnaethom brofi holl dudalennau'r wefan."
      ]
    }
  }
};

export const GET = async (_req: Request, res: Response) => {
  res.render("accessibility-statement", { backLink: "/", en, cy });
};
