import { ConflictError, findGazetteSettings, gazetteSettingsFormSchema, InvalidInputError, saveGazetteSettings } from "@hmcts/deed-poll";
import type { Request, Response } from "express";
import { callerFromRequest } from "../../../auth/current-user.js";

const PATH = "/deed-polls/gazette/settings";
const en = {
  title: "London Gazette recipient",
  heading: "London Gazette recipient",
  intro: "Set the email address at The London Gazette that should receive publication requests and spreadsheet download links.",
  hint: "Use the Gazette recipient’s address, not the court’s contact or reply-to address.",
  emailLabel: "Recipient email address",
  notSet: "The recipient email address has not been set.",
  lastChanged: "Last changed",
  by: "by",
  save: "Save recipient",
  back: "Applications ready for the London Gazette",
  successTitle: "Success",
  saved: "Recipient email address saved.",
  errorSummaryTitle: "There is a problem",
  required: "Enter the London Gazette recipient email address",
  invalid: "Enter a valid email address, like name@example.com",
  reload: "Reload the settings before saving",
  conflict: "The recipient has changed since you opened this page. Reload the settings and check the current address before saving again.",
  reloadLink: "Reload recipient settings",
  refused: "The recipient could not be saved. Reload the settings and try again."
};
const cy = {
  title: "Derbynnydd y London Gazette",
  heading: "Derbynnydd y London Gazette",
  intro: "Gosodwch gyfeiriad e-bost y London Gazette a ddylai dderbyn ceisiadau cyhoeddi a dolenni i lawrlwytho taenlenni.",
  hint: "Defnyddiwch gyfeiriad y derbynnydd yn y Gazette, nid cyfeiriad cyswllt neu ateb y llys.",
  emailLabel: "Cyfeiriad e-bost y derbynnydd",
  notSet: "Nid yw cyfeiriad e-bost y derbynnydd wedi’i osod.",
  lastChanged: "Newidiwyd ddiwethaf",
  by: "gan",
  save: "Cadw’r derbynnydd",
  back: "Ceisiadau sy’n barod ar gyfer y London Gazette",
  successTitle: "Llwyddiant",
  saved: "Mae cyfeiriad e-bost y derbynnydd wedi’i gadw.",
  errorSummaryTitle: "Mae problem wedi codi",
  required: "Rhowch gyfeiriad e-bost derbynnydd y London Gazette",
  invalid: "Rhowch gyfeiriad e-bost dilys, fel enw@enghraifft.com",
  reload: "Ail-lwythwch y gosodiadau cyn cadw",
  conflict: "Mae’r derbynnydd wedi newid ers i chi agor y dudalen hon. Ail-lwythwch y gosodiadau a gwiriwch y cyfeiriad presennol cyn cadw eto.",
  reloadLink: "Ail-lwytho gosodiadau’r derbynnydd",
  refused: "Ni ellid cadw’r derbynnydd. Ail-lwythwch y gosodiadau a rhowch gynnig arall arni."
};

export const GET = async (req: Request, res: Response) => {
  const settings = await findGazetteSettings(callerFromRequest(req));
  const locale = res.locals.locale === "cy" ? "cy-GB" : "en-GB";
  render(
    res,
    { recipientEmail: settings.recipientEmail ?? "", revision: String(settings.revision) },
    {
      isUnset: !settings.recipientEmail,
      isSaved: req.query.saved === "true",
      updatedBy: settings.updatedBy,
      updatedAt: settings.updatedAt?.toLocaleString(locale, { dateStyle: "long", timeStyle: "short", timeZone: "Europe/London" })
    }
  );
};

export const POST = async (req: Request, res: Response) => {
  const content = res.locals.locale === "cy" ? cy : en;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const values = {
    recipientEmail: typeof body.recipientEmail === "string" ? body.recipientEmail : "",
    revision: typeof body.revision === "string" ? body.revision : ""
  };
  const parsed = gazetteSettingsFormSchema(content).safeParse(body);
  if (!parsed.success) {
    const emailError = parsed.error.issues.find((issue) => issue.path[0] === "recipientEmail")?.message;
    const revisionError = parsed.error.issues.some((issue) => issue.path[0] === "revision");
    return render(res.status(400), values, {
      emailError,
      reloadRequired: revisionError,
      errorList: [
        ...(emailError ? [{ text: emailError, href: "#recipientEmail" }] : []),
        ...(revisionError ? [{ text: content.reload, href: "#reload-settings" }] : [])
      ]
    });
  }
  try {
    await saveGazetteSettings(parsed.data, callerFromRequest(req));
  } catch (error) {
    const { status, ...view } = saveErrorView(error, content);
    return render(res.status(status), values, view);
  }
  res.redirect(`${PATH}?saved=true`);
};

function render(res: Response, values: { recipientEmail: string; revision: string }, extra: Record<string, unknown> = {}) {
  res.render("deed-polls/gazette/settings", { en, cy, values, ...extra });
}

function saveErrorView(error: unknown, content: typeof en) {
  if (error instanceof ConflictError) {
    return {
      status: 409,
      reloadRequired: true,
      errorList: [{ text: content.conflict, href: "#reload-settings" }]
    };
  }
  if (error instanceof InvalidInputError) {
    const emailError = error.errors.some((field) => field.field === "recipientEmail") ? content.invalid : undefined;
    return {
      status: 400,
      emailError,
      reloadRequired: !emailError,
      errorList: [{ text: emailError ?? content.refused, href: emailError ? "#recipientEmail" : "#reload-settings" }]
    };
  }
  throw error;
}
