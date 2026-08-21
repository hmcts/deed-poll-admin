import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import helmet from "helmet";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureHelmet, configureNonce } from "./helmet-middleware.js";

vi.mock("node:crypto");
vi.mock("helmet");

describe("helmet-middleware", () => {
  describe("configureNonce", () => {
    let req: Request;
    let res: Response;
    let next: NextFunction;

    beforeEach(() => {
      vi.clearAllMocks();
      req = {} as Request;
      res = {
        locals: {}
      } as Response;
      next = vi.fn();
    });

    it("should generate and set a CSP nonce", () => {
      const mockNonce = "mockBase64Nonce==";
      vi.mocked(crypto.randomBytes).mockReturnValue({
        toString: vi.fn().mockReturnValue(mockNonce)
      } as any);

      const middleware = configureNonce();
      middleware(req, res, next);

      expect(crypto.randomBytes).toHaveBeenCalledWith(16);
      expect(res.locals.cspNonce).toBe(mockNonce);
      expect(next).toHaveBeenCalled();
    });

    it("should generate unique nonces on each call", () => {
      let nonceCounter = 0;
      vi.mocked(crypto.randomBytes).mockImplementation(
        () =>
          ({
            toString: vi.fn().mockReturnValue(`nonce${++nonceCounter}`)
          }) as any
      );

      const middleware = configureNonce();

      // First request
      middleware(req, res, next);
      expect(res.locals.cspNonce).toBe("nonce1");

      // Second request
      const res2 = { locals: {} } as Response;
      middleware(req, res2, next);
      expect(res2.locals.cspNonce).toBe("nonce2");
    });

    it("should not use the request parameter", () => {
      const middleware = configureNonce();
      const reqSpy = {} as Request;

      vi.mocked(crypto.randomBytes).mockReturnValue({
        toString: vi.fn().mockReturnValue("nonce")
      } as any);

      middleware(reqSpy, res, next);

      // The request should not be accessed or modified
      expect(reqSpy).toEqual({});
    });
  });

  describe("configureHelmet", () => {
    const originalEnv = process.env.NODE_ENV;

    beforeEach(() => {
      vi.clearAllMocks();
      vi.mocked(helmet).mockReturnValue("helmet-middleware" as any);
    });

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
    });

    describe("default configuration", () => {
      it("should configure helmet with default options", () => {
        configureHelmet();

        expect(helmet).toHaveBeenCalledWith({
          contentSecurityPolicy: {
            directives: expect.objectContaining({
              defaultSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              scriptSrc: expect.arrayContaining(["'self'", expect.any(Function), "https://*.googletagmanager.com"]),
              imgSrc: expect.arrayContaining(["'self'", "data:", "https://*.google-analytics.com", "https://*.googletagmanager.com"]),
              fontSrc: ["'self'", "data:"],
              connectSrc: expect.arrayContaining(["'self'", "https://*.google-analytics.com", "https://*.googletagmanager.com"]),
              frameSrc: ["https://*.googletagmanager.com"]
            })
          }
        });
      });

      it("should include development sources when not in production", () => {
        process.env.NODE_ENV = "development";
        configureHelmet();

        const helmetCall = vi.mocked(helmet).mock.calls[0][0];
        const directives = helmetCall?.contentSecurityPolicy?.directives;

        expect(directives?.scriptSrc).toContain("ws://localhost:5173");
        expect(directives?.connectSrc).toContain("ws://localhost:5173");
        expect(directives?.connectSrc).toContain("ws://localhost:24678");
      });

      it("should not include development sources in production", () => {
        process.env.NODE_ENV = "production";
        configureHelmet();

        const helmetCall = vi.mocked(helmet).mock.calls[0][0];
        const directives = helmetCall?.contentSecurityPolicy?.directives;

        expect(directives?.scriptSrc).not.toContain("ws://localhost:5173");
        expect(directives?.connectSrc).not.toContain("ws://localhost:5173");
        expect(directives?.connectSrc).not.toContain("ws://localhost:24678");
      });
    });

    describe("Google Tag Manager configuration", () => {
      it("should include GTM sources when enabled", () => {
        configureHelmet({ enableGoogleTagManager: true });

        const helmetCall = vi.mocked(helmet).mock.calls[0][0];
        const directives = helmetCall?.contentSecurityPolicy?.directives;

        expect(directives?.scriptSrc).toContain("https://*.googletagmanager.com");
        expect(directives?.connectSrc).toContain("https://*.google-analytics.com");
        expect(directives?.connectSrc).toContain("https://*.googletagmanager.com");
        expect(directives?.imgSrc).toContain("https://*.google-analytics.com");
        expect(directives?.imgSrc).toContain("https://*.googletagmanager.com");
        expect(directives?.frameSrc).toEqual(["https://*.googletagmanager.com"]);
      });

      it("should exclude GTM sources when disabled", () => {
        configureHelmet({ enableGoogleTagManager: false });

        const helmetCall = vi.mocked(helmet).mock.calls[0][0];
        const directives = helmetCall?.contentSecurityPolicy?.directives;

        expect(directives?.scriptSrc).not.toContain("https://*.googletagmanager.com");
        expect(directives?.connectSrc).not.toContain("https://*.google-analytics.com");
        expect(directives?.connectSrc).not.toContain("https://*.googletagmanager.com");
        expect(directives?.imgSrc).not.toContain("https://*.google-analytics.com");
        expect(directives?.imgSrc).not.toContain("https://*.googletagmanager.com");
        expect(directives?.frameSrc).toBeUndefined();
      });
    });

    describe("nonce function", () => {
      it("should include nonce function in scriptSrc", () => {
        configureHelmet();

        const helmetCall = vi.mocked(helmet).mock.calls[0][0];
        const scriptSrc = helmetCall?.contentSecurityPolicy?.directives?.scriptSrc;

        const nonceFunction = scriptSrc?.find((src: any) => typeof src === "function");
        expect(nonceFunction).toBeDefined();

        // Test the nonce function
        const mockReq = {} as Request;
        const mockRes = { locals: { cspNonce: "testNonce123" } } as Response;
        const result = nonceFunction(mockReq, mockRes);

        expect(result).toBe("'nonce-testNonce123'");
      });

      it("should handle missing nonce in res.locals", () => {
        configureHelmet();

        const helmetCall = vi.mocked(helmet).mock.calls[0][0];
        const scriptSrc = helmetCall?.contentSecurityPolicy?.directives?.scriptSrc;
        const nonceFunction = scriptSrc?.find((src: any) => typeof src === "function");

        const mockReq = {} as Request;
        const mockRes = { locals: {} } as Response;
        const result = nonceFunction(mockReq, mockRes);

        expect(result).toBe("'nonce-undefined'");
      });
    });

    describe("environment configuration", () => {
      it("should use isDevelopment option over NODE_ENV", () => {
        process.env.NODE_ENV = "production";
        configureHelmet({ isDevelopment: true });

        const helmetCall = vi.mocked(helmet).mock.calls[0][0];
        const directives = helmetCall?.contentSecurityPolicy?.directives;

        expect(directives?.scriptSrc).toContain("ws://localhost:5173");
        expect(directives?.connectSrc).toContain("ws://localhost:5173");
      });

      it("should handle explicit production setting", () => {
        process.env.NODE_ENV = "development";
        configureHelmet({ isDevelopment: false });

        const helmetCall = vi.mocked(helmet).mock.calls[0][0];
        const directives = helmetCall?.contentSecurityPolicy?.directives;

        expect(directives?.scriptSrc).not.toContain("ws://localhost:5173");
        expect(directives?.connectSrc).not.toContain("ws://localhost:5173");
      });

      it("should handle missing NODE_ENV", () => {
        delete process.env.NODE_ENV;
        configureHelmet();

        const helmetCall = vi.mocked(helmet).mock.calls[0][0];
        const directives = helmetCall?.contentSecurityPolicy?.directives;

        // Should default to development (not production)
        expect(directives?.scriptSrc).toContain("ws://localhost:5173");
      });
    });

    describe("CSP directive structure", () => {
      it("should always include base directives", () => {
        configureHelmet({ enableGoogleTagManager: false, isDevelopment: false });

        const helmetCall = vi.mocked(helmet).mock.calls[0][0];
        const directives = helmetCall?.contentSecurityPolicy?.directives;

        expect(directives?.defaultSrc).toEqual(["'self'"]);
        expect(directives?.styleSrc).toEqual(["'self'", "'unsafe-inline'"]);
        expect(directives?.fontSrc).toEqual(["'self'", "data:"]);
        expect(directives?.imgSrc).toContain("'self'");
        expect(directives?.imgSrc).toContain("data:");
      });

      it("should conditionally include frameSrc", () => {
        // Without GTM
        configureHelmet({ enableGoogleTagManager: false });
        let helmetCall = vi.mocked(helmet).mock.calls[0][0];
        expect(helmetCall?.contentSecurityPolicy?.directives?.frameSrc).toBeUndefined();

        // With GTM
        vi.clearAllMocks();
        vi.mocked(helmet).mockReturnValue("helmet-middleware" as any);
        configureHelmet({ enableGoogleTagManager: true });
        helmetCall = vi.mocked(helmet).mock.calls[0][0];
        expect(helmetCall?.contentSecurityPolicy?.directives?.frameSrc).toBeDefined();
      });
    });

    describe("return value", () => {
      it("should return the helmet middleware", () => {
        const mockMiddleware = vi.fn();
        vi.mocked(helmet).mockReturnValue(mockMiddleware as any);

        const result = configureHelmet();

        expect(result).toBe(mockMiddleware);
      });
    });
  });
});
