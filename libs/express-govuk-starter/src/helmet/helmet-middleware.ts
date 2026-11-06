import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import helmet from "helmet";

export interface SecurityOptions {
  enableGoogleTagManager?: boolean;
  isDevelopment?: boolean;
  /** Origins a form's submission may be redirected to beyond `'self'`, such as the identity provider a POST sign-out ends at. */
  formActionSources?: string[];
}

export function configureNonce() {
  return (_req: Request, res: Response, next: NextFunction) => {
    res.locals.cspNonce = crypto.randomBytes(16).toString("base64");
    next();
  };
}

export function configureHelmet(options: SecurityOptions = {}) {
  const { enableGoogleTagManager = true, isDevelopment = process.env.NODE_ENV !== "production", formActionSources = [] } = options;

  const scriptSources = [
    "'self'",
    (_req: any, res: any) => `'nonce-${res.locals.cspNonce}'`,
    ...(enableGoogleTagManager ? ["https://*.googletagmanager.com"] : []),
    ...(isDevelopment ? ["ws://localhost:5173"] : [])
  ];

  const connectSources = [
    "'self'",
    ...(enableGoogleTagManager ? ["https://*.google-analytics.com", "https://*.googletagmanager.com"] : []),
    ...(isDevelopment ? ["ws://localhost:5173", "ws://localhost:24678"] : [])
  ];

  const imageSources = ["'self'", "data:", ...(enableGoogleTagManager ? ["https://*.google-analytics.com", "https://*.googletagmanager.com"] : [])];

  const frameSources = [...(enableGoogleTagManager ? ["https://*.googletagmanager.com"] : [])];

  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: scriptSources,
        imgSrc: imageSources,
        fontSrc: ["'self'", "data:"],
        connectSrc: connectSources,
        // helmet's own default is `'self'` alone; a browser checks this on every redirect a form submission follows.
        formAction: ["'self'", ...formActionSources],
        ...(frameSources.length > 0 && { frameSrc: frameSources })
      }
    },
    // The CSP's `frame-ancestors 'self'` (helmet's default directive) already governs framing (ITHC; deed-poll-admin's
    // plan 20261106 D7). An app edit to the template-provided starter, recorded in deed-poll-admin's CLAUDE.md.
    xFrameOptions: false
  });
}
