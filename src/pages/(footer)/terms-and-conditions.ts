import type { Request, Response } from "express";

const en = {
  title: "Terms and conditions",
  intro: `This page explains this service's terms of use. They include this website's privacy policy and terms and conditions. By using this service you're agreeing to the privacy policy and terms and conditions.`,
  sections: {
    whoWeAre: {
      heading: "Who we are",
      content: [
        "This service is managed by Her Majesty's Courts and Tribunals Service and will be referred to as 'we' from now on.",
        "We may update these terms and conditions if there is a change in the law or to the way the service works."
      ]
    },
    information: {
      heading: "Information provided by this service",
      content: [
        "This service provides information to support you. We can't give legal advice on individual cases.",
        "You should answer the questions in the service based on your circumstances, and seek legal advice if you need it."
      ]
    },
    dataStorage: {
      heading: "Where your data is stored",
      content: [
        "Your data will be stored in data centres in the UK."
        // Note: temporaryDataPeriod will be inserted by the template
      ]
    },
    applicableLaw: {
      heading: "Applicable law",
      content:
        "Your use of this service and any dispute arising from its use will be governed by and construed in accordance with the laws of England and Wales, including but not limited to the:",
      laws: ["Computer Misuse Act 1990", "Data Protection Act 1998", "Mental Capacity Act 2005"]
    },
    responsibleUse: {
      heading: "Responsible use of this service",
      content: "The service is designed for people who need to use it or by others on their behalf and only with their consent.",
      warning:
        "There are risks in using a shared computer (for example in an internet café) to access this service. It's your responsibility to be aware of these risks and to avoid using any computer which may leave your personal information accessible to others. You're responsible if you choose to leave a computer unprotected while using this service.",
      precautions: "You must take your own precautions to ensure that the way you access this service does not expose you to the risk of:",
      risks: ["viruses", "malicious computer code", "other forms of interference which may damage your computer system"],
      prohibited: [
        "You must not misuse this service by knowingly introducing viruses, trojans, worms, logic bombs or other material which is malicious or technologically harmful. You must not attempt to gain unauthorised access to this service, the system on which it is stored or any server, computer or database connected to it. You must not attack this site via a denial-of-service attack or a distributed denial-of-service attack.",
        "This online service contains several free-text fields in which you will need to enter certain types of information. You should not enter sensitive information into these free-text fields. Sensitive information may include, but is not limited to, details of religious beliefs and financial information. Entering sensitive information is done so at your own risk."
      ]
    },
    changes: {
      heading: "Changes to these terms and conditions",
      content: [
        "Please check these terms and conditions regularly. We can update them at any time without notice.",
        "You'll agree to any changes if you continue to use this service after the terms and conditions have been updated."
      ]
    },
    contactUs: {
      heading: "Contact us",
      helpHeading: "Contact us for help",
      sendMessage: {
        heading: "Send us a message",
        linkText: "Send us a message"
      },
      telephone: {
        heading: "Telephone"
      },
      openingHours: {
        heading: "Opening times (telephone)",
        closed: "Closed on bank holidays"
      }
    }
  }
};

const cy = {
  title: "Telerau ac amodau",
  intro: `Mae'r dudalen hon yn esbonio telerau defnydd y gwasanaeth hwn. Maent yn cynnwys polisi preifatrwydd a thelerau ac amodau'r wefan hon. Drwy ddefnyddio'r gwasanaeth hwn rydych yn cytuno i'r polisi preifatrwydd a'r telerau ac amodau.`,
  sections: {
    whoWeAre: {
      heading: "Pwy ydym ni",
      content: [
        "Mae'r gwasanaeth hwn yn cael ei reoli gan Wasanaeth Llysoedd a Thribiwnlysoedd Ei Fawrhydi a bydd yn cael ei gyfeirio ato fel 'ni' o hyn ymlaen.",
        "Gallwn ddiweddaru'r telerau ac amodau hyn os oes newid yn y gyfraith neu i'r ffordd mae'r gwasanaeth yn gweithio."
      ]
    },
    information: {
      heading: "Gwybodaeth a ddarperir gan y gwasanaeth hwn",
      content: [
        "Mae'r gwasanaeth hwn yn darparu gwybodaeth i'ch cefnogi. Ni allwn roi cyngor cyfreithiol ar achosion unigol.",
        "Dylech ateb y cwestiynau yn y gwasanaeth yn seiliedig ar eich amgylchiadau, a cheisio cyngor cyfreithiol os oes angen."
      ]
    },
    dataStorage: {
      heading: "Lle mae eich data'n cael ei storio",
      content: [
        "Bydd eich data'n cael ei storio mewn canolfannau data yn y DU."
        // Note: temporaryDataPeriod will be inserted by the template
      ]
    },
    applicableLaw: {
      heading: "Cyfraith berthnasol",
      content:
        "Bydd eich defnydd o'r gwasanaeth hwn ac unrhyw anghydfod sy'n deillio o'i ddefnydd yn cael ei lywodraethu a'i ddehongli yn unol â chyfreithiau Cymru a Lloegr, gan gynnwys ond heb fod yn gyfyngedig i:",
      laws: ["Deddf Camddefnyddio Cyfrifiaduron 1990", "Deddf Diogelu Data 1998", "Deddf Galluedd Meddyliol 2005"]
    },
    responsibleUse: {
      heading: "Defnydd cyfrifol o'r gwasanaeth hwn",
      content: "Mae'r gwasanaeth wedi'i gynllunio ar gyfer pobl sydd angen ei ddefnyddio neu gan eraill ar eu rhan a dim ond gyda'u caniatâd.",
      warning:
        "Mae risgiau wrth ddefnyddio cyfrifiadur a rennir (er enghraifft mewn caffi rhyngrwyd) i gael mynediad at y gwasanaeth hwn. Eich cyfrifoldeb chi yw bod yn ymwybodol o'r risgiau hyn ac osgoi defnyddio unrhyw gyfrifiadur a allai adael eich gwybodaeth bersonol yn hygyrch i eraill. Chi sy'n gyfrifol os byddwch yn dewis gadael cyfrifiadur heb ei ddiogelu wrth ddefnyddio'r gwasanaeth hwn.",
      precautions: "Rhaid i chi gymryd eich rhagofalon eich hun i sicrhau nad yw'r ffordd rydych yn cyrchu'r gwasanaeth hwn yn eich gadael yn agored i risg:",
      risks: ["firysau", "cod cyfrifiadurol maleisus", "mathau eraill o ymyrraeth a allai niweidio eich system gyfrifiadurol"],
      prohibited: [
        "Rhaid i chi beidio â chamddefnyddio'r gwasanaeth hwn drwy gyflwyno firysau, trojans, mwydod, bomiau rhesymeg neu ddeunydd arall sy'n faleisus neu'n niweidiol yn dechnolegol yn fwriadol. Rhaid i chi beidio â cheisio cael mynediad heb awdurdod i'r gwasanaeth hwn, y system y mae'n cael ei storio arni nac unrhyw weinydd, cyfrifiadur neu gronfa ddata sy'n gysylltiedig ag ef. Rhaid i chi beidio ag ymosod ar y safle hwn trwy ymosodiad gwrthod gwasanaeth neu ymosodiad gwrthod gwasanaeth gwasgaredig.",
        "Mae'r gwasanaeth ar-lein hwn yn cynnwys sawl maes testun rhydd lle bydd angen i chi nodi mathau penodol o wybodaeth. Ni ddylech nodi gwybodaeth sensitif yn y meysydd testun rhydd hyn. Gall gwybodaeth sensitif gynnwys, ond nid yw'n gyfyngedig i, fanylion credoau crefyddol a gwybodaeth ariannol. Mae nodi gwybodaeth sensitif yn cael ei wneud ar eich risg eich hun."
      ]
    },
    changes: {
      heading: "Newidiadau i'r telerau ac amodau hyn",
      content: [
        "Gwiriwch y telerau ac amodau hyn yn rheolaidd. Gallwn eu diweddaru ar unrhyw adeg heb rybudd.",
        "Byddwch yn cytuno i unrhyw newidiadau os byddwch yn parhau i ddefnyddio'r gwasanaeth hwn ar ôl i'r telerau ac amodau gael eu diweddaru."
      ]
    },
    contactUs: {
      heading: "Cysylltu â ni",
      helpHeading: "Cysylltwch â ni am help",
      sendMessage: {
        heading: "Anfonwch neges atom",
        linkText: "Anfonwch neges atom"
      },
      telephone: {
        heading: "Ffôn"
      },
      openingHours: {
        heading: "Oriau agor (ffôn)",
        closed: "Ar gau ar wyliau banc"
      }
    }
  }
};

export const GET = async (_req: Request, res: Response) => {
  res.render("terms-and-conditions", { backLink: "/", en, cy });
};
