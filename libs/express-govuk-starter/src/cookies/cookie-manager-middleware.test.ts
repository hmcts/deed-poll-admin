import type { NextFunction, Request, Response } from "express";
import express from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { configureCookieManager } from "./cookie-manager-middleware.js";

describe("configureCookieManager", () => {
  let app: express.Express;
  let req: Partial<Request>;
  let res: Partial<Response>;
  let next: NextFunction;

  beforeEach(() => {
    app = express();
    req = {
      cookies: {},
      body: {},
      headers: {},
      path: "/test",
      query: {}
    };
    res = {
      locals: {},
      cookie: vi.fn(),
      redirect: vi.fn(),
      render: vi.fn()
    };
    next = vi.fn();
  });

  describe("middleware behavior", () => {
    it("should set up middleware and routes", async () => {
      const useSpy = vi.spyOn(app, "use");
      const postSpy = vi.spyOn(app, "post");
      const getSpy = vi.spyOn(app, "get");

      await configureCookieManager(app, {
        categories: { analytics: ["_ga"] }
      });

      // Should register middleware
      expect(useSpy).toHaveBeenCalledTimes(1);

      // Should register POST route for save-preferences
      expect(postSpy).toHaveBeenCalledTimes(1);
      expect(postSpy).toHaveBeenCalledWith("/cookies/save-preferences", expect.any(Function));

      // Should register GET route for preferences page
      expect(getSpy).toHaveBeenCalledTimes(1);
      expect(getSpy).toHaveBeenCalledWith("/cookies", expect.any(Function));
    });

    it("should use custom preferences path", async () => {
      const getSpy = vi.spyOn(app, "get");

      await configureCookieManager(app, {
        categories: { analytics: ["_ga"] },
        preferencesPath: "/custom-cookies"
      });

      expect(getSpy).toHaveBeenCalledWith("/custom-cookies", expect.any(Function));
    });
  });

  describe("middleware state management", () => {
    it("should set cookieManager state in res.locals", async () => {
      const useSpy = vi.spyOn(app, "use");

      await configureCookieManager(app, {
        categories: { analytics: ["_ga"] }
      });

      // Get the middleware function that was registered
      const middleware = useSpy.mock.calls[0][0] as any;

      // Call the middleware
      middleware(req, res, next);

      expect(res.locals?.cookieManager).toEqual({
        cookiesAccepted: false,
        cookiePreferences: {},
        showBanner: true
      });
      expect(res.locals?.cookieConfig).toEqual({
        categories: { analytics: ["_ga"] }
      });
      expect(next).toHaveBeenCalled();
    });

    it("should not show banner on /cookies page", async () => {
      const useSpy = vi.spyOn(app, "use");

      await configureCookieManager(app, {
        categories: { analytics: ["_ga"] }
      });

      const middleware = useSpy.mock.calls[0][0] as any;
      req = { ...req, path: "/cookies" };

      middleware(req, res, next);

      expect(res.locals?.cookieManager?.showBanner).toBe(false);
    });

    it("should not show banner when cookies have been accepted", async () => {
      const useSpy = vi.spyOn(app, "use");

      await configureCookieManager(app, {
        categories: { analytics: ["_ga"] }
      });

      const middleware = useSpy.mock.calls[0][0] as any;
      req.cookies = { cookie_policy: "%7B%22analytics%22%3Atrue%7D" };

      middleware(req, res, next);

      expect(res.locals?.cookieManager?.showBanner).toBe(false);
      expect(res.locals?.cookieManager?.cookiesAccepted).toBe(true);
      expect(res.locals?.cookieManager?.cookiePreferences).toEqual({ analytics: true });
    });

    it("should not show banner when banner has been seen", async () => {
      const useSpy = vi.spyOn(app, "use");

      await configureCookieManager(app, {
        categories: { analytics: ["_ga"] }
      });

      const middleware = useSpy.mock.calls[0][0] as any;
      req.cookies = { cookies_preferences_set: "true" };

      middleware(req, res, next);

      expect(res.locals?.cookieManager?.showBanner).toBe(false);
    });

    it("should handle malformed cookie values", async () => {
      const useSpy = vi.spyOn(app, "use");

      await configureCookieManager(app, {
        categories: { analytics: ["_ga"] }
      });

      const middleware = useSpy.mock.calls[0][0] as any;
      req.cookies = { cookie_policy: "invalid%7Bjson" };

      middleware(req, res, next);

      expect(res.locals?.cookieManager?.cookiePreferences).toEqual({});
    });
  });

  describe("save preferences handler", () => {
    it("should save selected preferences", async () => {
      const postSpy = vi.spyOn(app, "post");

      await configureCookieManager(app, {
        categories: {
          analytics: ["_ga"],
          preferences: ["lang"]
        }
      });

      // Get the save preferences handler (first post call)
      const saveHandler = postSpy.mock.calls[0][1] as any;
      req.body = {
        analytics: "on",
        preferences: "off"
      };

      saveHandler(req, res);

      expect(res.cookie).toHaveBeenCalledWith("cookie_policy", "%7B%22analytics%22%3Atrue%2C%22preferences%22%3Afalse%7D", expect.any(Object));
      expect(res.redirect).toHaveBeenCalledWith("/cookies?saved=true");
    });

    it("should redirect to custom preferences path", async () => {
      const postSpy = vi.spyOn(app, "post");

      await configureCookieManager(app, {
        categories: { analytics: ["_ga"] },
        preferencesPath: "/custom-cookies"
      });

      const saveHandler = postSpy.mock.calls[0][1] as any;
      req.body = { analytics: "on" };

      saveHandler(req, res);

      expect(res.redirect).toHaveBeenCalledWith("/custom-cookies?saved=true");
    });
  });

  describe("preferences page", () => {
    it("should render the preferences page", async () => {
      const getSpy = vi.spyOn(app, "get");

      await configureCookieManager(app, {
        categories: {
          analytics: ["_ga"],
          preferences: ["lang"]
        }
      });

      // Get the preferences page handler
      const preferencesHandler = getSpy.mock.calls[0][1] as any;
      req.cookies = { cookie_policy: "%7B%22analytics%22%3Atrue%2C%22preferences%22%3Afalse%7D" };
      req.query = { saved: "true" };

      preferencesHandler(req, res);

      expect(res.render).toHaveBeenCalledWith("cookie-preferences", {
        en: expect.objectContaining({
          title: "Cookie preferences",
          analyticsTitle: "Analytics cookies"
        }),
        cy: expect.objectContaining({
          title: "Dewisiadau cwcis",
          analyticsTitle: "Cwcis dadansoddi"
        }),
        cookiePreferences: { analytics: true, preferences: false },
        categories: { analytics: ["_ga"], preferences: ["lang"] },
        saved: true
      });
    });
  });

  describe("edge cases", () => {
    it("should work with minimal configuration", async () => {
      const useSpy = vi.spyOn(app, "use");

      await configureCookieManager(app, {});

      const middleware = useSpy.mock.calls[0][0] as any;

      middleware(req, res, next);

      expect(res.locals?.cookieManager).toEqual({
        cookiesAccepted: false,
        cookiePreferences: {},
        showBanner: true
      });
    });
  });
});
