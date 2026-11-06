/**
 * A deny-all `Permissions-Policy` (ITHC finding; plan `docs/plans/completed/20261106-ithc-csrf-and-headers.md`, D6).
 *
 * Admin's browser code uses none of these features, so each is refused to the page and to every frame in it. It is set
 * here rather than in `libs/express-govuk-starter`, which is template-provided, and mounted straight after
 * `configureHelmet` so every response carries it, an error page included.
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";

const DENIED_FEATURES = [
  "accelerometer",
  "autoplay",
  "bluetooth",
  "browsing-topics",
  "camera",
  "display-capture",
  "fullscreen",
  "geolocation",
  "gyroscope",
  "hid",
  "magnetometer",
  "microphone",
  "midi",
  "payment",
  "publickey-credentials-get",
  "screen-wake-lock",
  "serial",
  "usb",
  "xr-spatial-tracking"
];
const PERMISSIONS_POLICY = DENIED_FEATURES.map((feature) => `${feature}=()`).join(", ");

export function permissionsPolicy(): RequestHandler {
  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Permissions-Policy", PERMISSIONS_POLICY);
    next();
  };
}
