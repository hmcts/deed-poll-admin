import type { Request, Response } from "express";

const support = {
  url: "https://hmcts.haloitsm.com/",
  phone: "0800 917 5148",
  phoneUrl: "tel:08009175148"
};

const en = {
  title: "Contact us",
  sections: {
    sendMessage: {
      heading: "IT support",
      description: "HMCTS staff can use Halo to report a technical problem or request IT support.",
      linkText: "Contact the IT Service Desk through Halo"
    },
    telephone: {
      heading: "Telephone",
      description: "Call the IT Service Desk."
    },
    openingHours: {
      heading: "Opening times (telephone)",
      hours: "8am to 6pm"
    }
  }
};

const cy = {
  title: "Cysylltu â ni",
  sections: {
    sendMessage: {
      heading: "Cymorth TG",
      description: "Gall staff GLlTEF ddefnyddio Halo i roi gwybod am broblem dechnegol neu ofyn am gymorth TG.",
      linkText: "Cysylltu â'r Ddesg Gwasanaeth TG drwy Halo"
    },
    telephone: {
      heading: "Ffôn",
      description: "Ffoniwch y Ddesg Gwasanaeth TG."
    },
    openingHours: {
      heading: "Oriau agor (ffôn)",
      hours: "8am i 6pm"
    }
  }
};

export const GET = async (_req: Request, res: Response) => {
  res.render("contact-us", { backLink: "/", support, en, cy });
};
