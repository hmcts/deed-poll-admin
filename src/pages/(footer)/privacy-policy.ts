import type { Request, Response } from "express";

const en = {
  title: "Privacy policy",
  intro: `This privacy policy explains why we collect your personal data and what we do with it. It also explains your rights and how to enforce them.`,
  sections: {
    whoManages: {
      heading: "Who manages this service",
      content: [
        "This service is managed by HM Courts and Tribunals Service (HMCTS), which is an executive agency of the Ministry of Justice (MoJ).",
        "The MoJ is known as the data controller for data protection purposes. The MoJ personal information charter explains how the MoJ processes personal data.",
        "As part of the MoJ, HMCTS is responsible for deciding how your personal data is used and for protecting the personal data you provide.",
        "More information about using this service is in the terms and conditions."
      ]
    },
    personalData: {
      heading: "The personal data we need",
      intro: "When you use the", // serviceName will be inserted by template
      list: ["your name, address and contact details", "your email address", "other personal information relevant to your application"],
      extra: "We collect this personal data when you use this service."
    },
    notifications: {
      heading: "Receiving notifications"
      // serviceName will be inserted by template
    },
    storingData: {
      heading: "Storing your data",
      content: [
        "When you use this service you'll be asked to use your email address to set up an account. You can use this account to save the forms you're working on and return to them later."
        // dataRetentionPeriod will be inserted by template
      ]
    },
    afterSubmission: {
      heading: "After you submit your application",
      content: `The information you submit for your application will be saved and stored securely.`
    },
    whyWeCollect: {
      heading: "Why we collect your personal data",
      content: "We collect your personal data to:",
      list: ["process your application", "meet legal requirements", "make improvements to this service"],
      extra: "Our staff use your personal data to process your application. They work in the UK and your data is stored in the UK."
    },
    usingData: {
      heading: "Using your data",
      subsections: {
        emails: {
          heading: "How we use your email address",
          content: [
            "We'll send you emails to update you on the progress of your application. You'll be asked if you want to use notifications as part of the application process.",
            "We'll also send confirmation emails so you can be sure that you've sent us the right information."
          ]
        },
        cookies: {
          heading: "How we use non-personal information",
          content: `We collect non-personal information about how you use our services, through cookies and page-tagging techniques.`,
          extra: `Find out more in the cookies policy.`
        }
      }
    },
    sharingData: {
      heading: "Sharing your data",
      content: [
        "While processing your application, another government department, agency or organisation might be involved and we may share your data with them.",
        "If you contact us and ask for help with a service you're using, we may need to share your personal data with that service.",
        "In some circumstances we may share your data. For example, to prevent or detect crime, or to produce anonymised statistics.",
        "We use Google Analytics to collect data about how a website is used. This anonymous data is shared with Google. Find out about this in our terms and conditions."
      ]
    },
    international: {
      heading: "Storing and sharing your data internationally",
      content: [
        "Sometimes we need to send your personal information outside of the UK. When we do this we comply with data protection law.",
        "Your data may be stored in a secure cloud storage solution which can be based outside of the UK while being used to provide this service."
      ]
    },
    yourRights: {
      heading: "Your rights",
      content: "You can ask:",
      list: [
        "to see the personal data that we hold on you",
        "to have the personal data corrected",
        "to have the personal data removed or deleted (this will depend on the circumstances, for example if you decide not to continue your application)",
        "that access to the personal data is restricted (for example, you can ask to have your data stored for longer and not automatically deleted)"
      ],
      extra: "If you want to see the personal data that we hold on you, you can make a subject access request. Write to us at:"
    },
    contactDetails: {
      heading: "Contact details",
      email: "Email: data.compliance@justice.gov.uk",
      address: ["Disclosure Team", "Post point 10.38", "102 Petty France", "London", "SW1H 9AJ"]
    },
    complaints: {
      heading: "How to complain",
      content: ["See our complaints procedure if you want to complain about how we've handled your personal data.", "Write to:"],
      address: ["The Data Protection Officer", "Ministry of Justice", "3rd Floor, Post Point 3.20", "10 South Colonnades", "Canary Wharf", "London", "E14 4PU"],
      email: "Email: data.compliance@justice.gov.uk",
      ico: "You can also complain to the Information Commissioner's Office (ICO) if you're not satisfied with our response or believe we are not processing your personal data lawfully."
    }
  }
};

const cy = {
  title: "Polisi preifatrwydd",
  intro: `Mae'r polisi preifatrwydd hwn yn esbonio pam rydym yn casglu eich data personol a beth rydym yn ei wneud ag ef. Mae hefyd yn esbonio eich hawliau a sut i'w gorfodi.`,
  sections: {
    whoManages: {
      heading: "Pwy sy'n rheoli'r gwasanaeth hwn",
      content: [
        `Mae'r gwasanaeth hwn yn cael ei reoli gan Wasanaeth Llysoedd a Thribiwnlysoedd Ei Fawrhydi (GLlTEF), sy'n asiantaeth weithredol y Weinyddiaeth Gyfiawnder (MoJ).`,
        `Mae'r MoJ yn cael ei adnabod fel y rheolydd data at ddibenion diogelu data. Mae siarter gwybodaeth bersonol y MoJ yn esbonio sut mae'r MoJ yn prosesu data personol.`,
        `Fel rhan o'r MoJ, mae GLlTEF yn gyfrifol am benderfynu sut mae'ch data personol yn cael ei ddefnyddio ac am ddiogelu'r data personol rydych yn ei ddarparu.`,
        `Mae mwy o wybodaeth am ddefnyddio'r gwasanaeth hwn yn y telerau ac amodau.`
      ]
    },
    personalData: {
      heading: "Y data personol sydd ei angen arnom",
      intro: "Pan fyddwch yn defnyddio gwasanaeth", // serviceName will be inserted by template
      list: ["eich enw, cyfeiriad a'ch manylion cyswllt", "eich cyfeiriad e-bost", "gwybodaeth bersonol arall sy'n berthnasol i'ch cais"],
      extra: "Rydym yn casglu'r data personol hwn pan fyddwch yn defnyddio'r gwasanaeth hwn."
    },
    notifications: {
      heading: "Derbyn hysbysiadau"
      // serviceName will be inserted by template
    },
    storingData: {
      heading: "Storio eich data",
      content: [
        `Pan fyddwch yn defnyddio'r gwasanaeth hwn bydd gofyn i chi ddefnyddio'ch cyfeiriad e-bost i sefydlu cyfrif. Gallwch ddefnyddio'r cyfrif hwn i gadw'r ffurflenni rydych yn gweithio arnynt a dychwelyd atynt yn ddiweddarach.`
        // dataRetentionPeriod will be inserted by template
      ]
    },
    afterSubmission: {
      heading: "Ar ôl i chi gyflwyno'ch cais",
      content: `Bydd y wybodaeth rydych yn ei chyflwyno ar gyfer eich cais yn cael ei chadw a'i storio'n ddiogel.`
    },
    whyWeCollect: {
      heading: "Pam rydym yn casglu eich data personol",
      content: "Rydym yn casglu eich data personol i:",
      list: ["prosesu eich cais", "bodloni gofynion cyfreithiol", "gwneud gwelliannau i'r gwasanaeth hwn"],
      extra: "Mae ein staff yn defnyddio'ch data personol i brosesu'ch cais. Maent yn gweithio yn y DU ac mae'ch data'n cael ei storio yn y DU."
    },
    usingData: {
      heading: "Defnyddio'ch data",
      subsections: {
        emails: {
          heading: "Sut rydym yn defnyddio'ch cyfeiriad e-bost",
          content: [
            `Byddwn yn anfon e-byst atoch i'ch diweddaru ar gynnydd eich cais. Gofynnir i chi a ydych am ddefnyddio hysbysiadau fel rhan o'r broses ymgeisio.`,
            `Byddwn hefyd yn anfon e-byst cadarnhau fel y gallwch fod yn siŵr eich bod wedi anfon y wybodaeth gywir atom.`
          ]
        },
        cookies: {
          heading: "Sut rydym yn defnyddio gwybodaeth nad yw'n bersonol",
          content: `Rydym yn casglu gwybodaeth nad yw'n bersonol am sut rydych yn defnyddio ein gwasanaethau, trwy gwcis a thechnegau tagio tudalennau.`,
          extra: `Darganfyddwch fwy yn y polisi cwcis.`
        }
      }
    },
    sharingData: {
      heading: "Rhannu eich data",
      content: [
        `Wrth brosesu'ch cais, efallai y bydd adran, asiantaeth neu sefydliad arall y llywodraeth yn ymwneud â'r broses ac efallai y byddwn yn rhannu'ch data gyda nhw.`,
        `Os byddwch yn cysylltu â ni ac yn gofyn am help gyda gwasanaeth rydych yn ei ddefnyddio, efallai y bydd angen i ni rannu'ch data personol gyda'r gwasanaeth hwnnw.`,
        `Mewn rhai amgylchiadau efallai y byddwn yn rhannu'ch data. Er enghraifft, i atal neu ganfod trosedd, neu i gynhyrchu ystadegau anhysbys.`,
        `Rydym yn defnyddio Google Analytics i gasglu data am sut mae gwefan yn cael ei defnyddio. Mae'r data anhysbys hwn yn cael ei rannu gyda Google. Darganfyddwch am hyn yn ein telerau ac amodau.`
      ]
    },
    international: {
      heading: "Storio a rhannu'ch data'n rhyngwladol",
      content: [
        `Weithiau mae angen i ni anfon eich gwybodaeth bersonol y tu allan i'r DU. Pan fyddwn yn gwneud hyn rydym yn cydymffurfio â chyfraith diogelu data.`,
        `Gall eich data gael ei storio mewn ateb storio cwmwl diogel a all fod wedi'i leoli y tu allan i'r DU tra'n cael ei ddefnyddio i ddarparu'r gwasanaeth hwn.`
      ]
    },
    yourRights: {
      heading: "Eich hawliau",
      content: "Gallwch ofyn:",
      list: [
        "i weld y data personol rydym yn ei gadw amdanoch",
        "i gael y data personol wedi'i gywiro",
        "i gael y data personol wedi'i dynnu neu ei ddileu (bydd hyn yn dibynnu ar yr amgylchiadau, er enghraifft os byddwch yn penderfynu peidio â pharhau â'ch cais)",
        "bod mynediad at y data personol yn cael ei gyfyngu (er enghraifft, gallwch ofyn i'ch data gael ei storio am gyfnod hirach a pheidio â'i ddileu'n awtomatig)"
      ],
      extra: "Os ydych am weld y data personol rydym yn ei gadw amdanoch, gallwch wneud cais mynediad gwrthrych. Ysgrifennwch atom yn:"
    },
    contactDetails: {
      heading: "Manylion cyswllt",
      email: "E-bost: data.compliance@justice.gov.uk",
      address: ["Tîm Datgelu", "Pwynt post 10.38", "102 Petty France", "Llundain", "SW1H 9AJ"]
    },
    complaints: {
      heading: "Sut i gwyno",
      content: ["Gweler ein gweithdrefn gwyno os ydych am gwyno am sut rydym wedi trin eich data personol.", "Ysgrifennwch at:"],
      address: [
        "Y Swyddog Diogelu Data",
        "Y Weinyddiaeth Gyfiawnder",
        "3ydd Llawr, Pwynt Post 3.20",
        "10 South Colonnades",
        "Canary Wharf",
        "Llundain",
        "E14 4PU"
      ],
      email: "E-bost: data.compliance@justice.gov.uk",
      ico: "Gallwch hefyd gwyno i Swyddfa'r Comisiynydd Gwybodaeth (ICO) os nad ydych yn fodlon â'n hymateb neu'n credu nad ydym yn prosesu'ch data personol yn gyfreithlon."
    }
  }
};

export const GET = async (_req: Request, res: Response) => {
  res.render("privacy-policy", { backLink: "/", en, cy });
};
