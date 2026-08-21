import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import helmet from "helmet";

export interface SecurityOptions {
  enableGoogleTagManager?: boolean;
  isDevelopment?: boolean;
}

export function configureNonce() {
  return (_req: Request, res: Response, next: NextFunction) => {
    res.locals.cspNonce = crypto.randomBytes(16).toString("base64");
    next();
  };
}

export function configureHelmet(options: SecurityOptions = {}) {
  const { enableGoogleTagManager = true, isDevelopment = process.env.NODE_ENV !== "production" } = options;

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
        ...(frameSources.length > 0 && { frameSrc: frameSources })
      }
    }
  });
}
