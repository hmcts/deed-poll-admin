import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { localeMiddleware, renderInterceptorMiddleware, translationMiddleware } from "./locale-middleware.js";

describe("localeMiddleware", () => {
  it("should set locale from query parameter", () => {
    const middleware = localeMiddleware();
    const req = {
      query: { lng: "cy" },
      session: {},
      cookies: {}
    } as unknown as Request;
    const res = {
      locals: {},
      cookie: vi.fn()
    } as unknown as Response;
    const next = vi.fn();

    middleware(req, res, next);

    expect(req.session.locale).toBe("cy");
    expect(res.locals.locale).toBe("cy");
    expect(res.locals.otherLocale).toBe("en");
    expect(next).toHaveBeenCalled();
  });

  it("should use session locale when no query param", () => {
    const middleware = localeMiddleware();
    const req = {
      query: {},
      session: { locale: "cy" },
      cookies: {}
    } as unknown as Request;
    const res = {
      locals: {},
      cookie: vi.fn()
    } as unknown as Response;
    const next = vi.fn();

    middleware(req, res, next);

    expect(res.locals.locale).toBe("cy");
    expect(res.locals.otherLocale).toBe("en");
    expect(next).toHaveBeenCalled();
  });

  it("should use cookie locale when no query or session", () => {
    const middleware = localeMiddleware();
    const req = {
      query: {},
      session: {},
      cookies: { locale: "cy" }
    } as unknown as Request;
    const res = {
      locals: {},
      cookie: vi.fn()
    } as unknown as Response;
    const next = vi.fn();

    middleware(req, res, next);

    expect(res.locals.locale).toBe("cy");
    expect(res.locals.otherLocale).toBe("en");
    expect(next).toHaveBeenCalled();
  });

  it("should default to en when no locale specified", () => {
    const middleware = localeMiddleware();
    const req = {
      query: {},
      session: {},
      cookies: {}
    } as unknown as Request;
    const res = {
      locals: {},
      cookie: vi.fn()
    } as unknown as Response;
    const next = vi.fn();

    middleware(req, res, next);

    expect(res.locals.locale).toBe("en");
    expect(res.locals.otherLocale).toBe("cy");
    expect(next).toHaveBeenCalled();
  });

  it("should reject unsupported locales", () => {
    const middleware = localeMiddleware();
    const req = {
      query: { lng: "fr" },
      session: {},
      cookies: {}
    } as unknown as Request;
    const res = {
      locals: {},
      cookie: vi.fn()
    } as unknown as Response;
    const next = vi.fn();

    middleware(req, res, next);

    expect(res.locals.locale).toBe("en");
    expect(next).toHaveBeenCalled();
  });
});

describe("translationMiddleware", () => {
  const translations = {
    en: {
      welcome: "Welcome",
      navigation: {
        home: "Home"
      },
      language: {
        switch: "Cymraeg"
      }
    },
    cy: {
      welcome: "Croeso",
      navigation: {
        home: "Hafan"
      },
      language: {
        switch: "English"
      }
    }
  };

  it("should inject English translations into res.locals", () => {
    const middleware = translationMiddleware(translations);
    const req = {} as Request;
    const res = {
      locals: { locale: "en" }
    } as Response;
    const next = vi.fn();

    middleware(req, res, next);

    expect(res.locals.welcome).toBe("Welcome");
    expect(res.locals.navigation.home).toBe("Home");
    expect(res.locals.languageToggle.link).toBe("?lng=cy");
    expect(res.locals.languageToggle.text).toBe("Cymraeg");
    expect(next).toHaveBeenCalled();
  });

  it("should inject Welsh translations into res.locals", () => {
    const middleware = translationMiddleware(translations);
    const req = {} as Request;
    const res = {
      locals: { locale: "cy" }
    } as Response;
    const next = vi.fn();

    middleware(req, res, next);

    expect(res.locals.welcome).toBe("Croeso");
    expect(res.locals.navigation.home).toBe("Hafan");
    expect(res.locals.languageToggle.link).toBe("?lng=en");
    expect(res.locals.languageToggle.text).toBe("English");
    expect(next).toHaveBeenCalled();
  });

  it("should handle missing locale gracefully", () => {
    const middleware = translationMiddleware(translations);
    const req = {} as Request;
    const res = {
      locals: {}
    } as Response;
    const next = vi.fn();

    middleware(req, res, next);

    expect(res.locals.welcome).toBe("Welcome");
    expect(res.locals.languageToggle.link).toBe("?lng=cy");
    expect(next).toHaveBeenCalled();
  });
});

describe("renderInterceptorMiddleware", () => {
  it("should intercept render and select English content when locale is en", () => {
    const middleware = renderInterceptorMiddleware();
    const originalRender = vi.fn();
    const req = {} as Request;
    const res = {
      locals: { locale: "en", serviceName: "Test Service" },
      render: originalRender
    } as unknown as Response;
    const next = vi.fn();

    middleware(req, res, next);

    // Call the intercepted render with language-specific content
    res.render("test-view", {
      en: { title: "English Title", description: "English Description" },
      cy: { title: "Welsh Title", description: "Welsh Description" }
    });

    expect(originalRender).toHaveBeenCalledWith(
      "test-view",
      {
        locale: "en",
        serviceName: "Test Service",
        title: "English Title",
        description: "English Description"
      },
      undefined
    );
    expect(next).toHaveBeenCalled();
  });

  it("should intercept render and select Welsh content when locale is cy", () => {
    const middleware = renderInterceptorMiddleware();
    const originalRender = vi.fn();
    const req = {} as Request;
    const res = {
      locals: { locale: "cy", serviceName: "Test Service" },
      render: originalRender
    } as unknown as Response;
    const next = vi.fn();

    middleware(req, res, next);

    // Call the intercepted render with language-specific content
    res.render("test-view", {
      en: { title: "English Title", description: "English Description" },
      cy: { title: "Welsh Title", description: "Welsh Description" }
    });

    expect(originalRender).toHaveBeenCalledWith(
      "test-view",
      {
        locale: "cy",
        serviceName: "Test Service",
        title: "Welsh Title",
        description: "Welsh Description"
      },
      undefined
    );
    expect(next).toHaveBeenCalled();
  });

  it("should pass through non-language content unchanged", () => {
    const middleware = renderInterceptorMiddleware();
    const originalRender = vi.fn();
    const req = {} as Request;
    const res = {
      locals: { locale: "en", serviceName: "Test Service" },
      render: originalRender
    } as unknown as Response;
    const next = vi.fn();

    middleware(req, res, next);

    // Call the intercepted render with regular content (no language keys)
    res.render("test-view", {
      title: "Regular Title",
      description: "Regular Description"
    });

    expect(originalRender).toHaveBeenCalledWith(
      "test-view",
      {
        locale: "en",
        serviceName: "Test Service",
        title: "Regular Title",
        description: "Regular Description"
      },
      undefined
    );
    expect(next).toHaveBeenCalled();
  });

  it("should handle render with callback function", () => {
    const middleware = renderInterceptorMiddleware();
    const originalRender = vi.fn();
    const req = {} as Request;
    const res = {
      locals: { locale: "en", serviceName: "Test Service" },
      render: originalRender
    } as unknown as Response;
    const next = vi.fn();
    const callback = vi.fn();

    middleware(req, res, next);

    // Call the intercepted render with language content and callback
    res.render(
      "test-view",
      {
        en: { title: "English Title" },
        cy: { title: "Welsh Title" }
      },
      callback
    );

    expect(originalRender).toHaveBeenCalledWith(
      "test-view",
      {
        locale: "en",
        serviceName: "Test Service",
        title: "English Title"
      },
      callback
    );
    expect(next).toHaveBeenCalled();
  });

  it("should handle render with callback as second parameter", () => {
    const middleware = renderInterceptorMiddleware();
    const originalRender = vi.fn();
    const req = {} as Request;
    const res = {
      locals: { locale: "en", serviceName: "Test Service" },
      render: originalRender
    } as unknown as Response;
    const next = vi.fn();
    const callback = vi.fn();

    middleware(req, res, next);

    // Call the intercepted render with callback as second parameter
    res.render("test-view", callback);

    expect(originalRender).toHaveBeenCalledWith(
      "test-view",
      {
        locale: "en",
        serviceName: "Test Service"
      },
      callback
    );
    expect(next).toHaveBeenCalled();
  });

  it("should handle render with no options", () => {
    const middleware = renderInterceptorMiddleware();
    const originalRender = vi.fn();
    const req = {} as Request;
    const res = {
      locals: { locale: "en", serviceName: "Test Service" },
      render: originalRender
    } as unknown as Response;
    const next = vi.fn();

    middleware(req, res, next);

    // Call the intercepted render with just view name
    res.render("test-view");

    expect(originalRender).toHaveBeenCalledWith(
      "test-view",
      {
        locale: "en",
        serviceName: "Test Service"
      },
      undefined
    );
    expect(next).toHaveBeenCalled();
  });

  it("should fallback to English when locale not found", () => {
    const middleware = renderInterceptorMiddleware();
    const originalRender = vi.fn();
    const req = {} as Request;
    const res = {
      locals: { locale: "fr", serviceName: "Test Service" },
      render: originalRender
    } as unknown as Response;
    const next = vi.fn();

    middleware(req, res, next);

    // Call the intercepted render with language content
    res.render("test-view", {
      en: { title: "English Title" },
      cy: { title: "Welsh Title" }
    });

    expect(originalRender).toHaveBeenCalledWith(
      "test-view",
      {
        locale: "fr",
        serviceName: "Test Service",
        title: "English Title"
      },
      undefined
    );
    expect(next).toHaveBeenCalled();
  });

  it("should handle missing locale in res.locals", () => {
    const middleware = renderInterceptorMiddleware();
    const originalRender = vi.fn();
    const req = {} as Request;
    const res = {
      locals: { serviceName: "Test Service" },
      render: originalRender
    } as unknown as Response;
    const next = vi.fn();

    middleware(req, res, next);

    // Call the intercepted render with language content
    res.render("test-view", {
      en: { title: "English Title" },
      cy: { title: "Welsh Title" }
    });

    expect(originalRender).toHaveBeenCalledWith(
      "test-view",
      {
        serviceName: "Test Service",
        title: "English Title"
      },
      undefined
    );
    expect(next).toHaveBeenCalled();
  });

  it("should handle null options", () => {
    const middleware = renderInterceptorMiddleware();
    const originalRender = vi.fn();
    const req = {} as Request;
    const res = {
      locals: { locale: "en", serviceName: "Test Service" },
      render: originalRender
    } as unknown as Response;
    const next = vi.fn();

    middleware(req, res, next);

    // Call the intercepted render with null options
    res.render("test-view", null);

    expect(originalRender).toHaveBeenCalledWith(
      "test-view",
      {
        locale: "en",
        serviceName: "Test Service"
      },
      undefined
    );
    expect(next).toHaveBeenCalled();
  });

  it("should call function content with the view model as interpolation context", () => {
    const middleware = renderInterceptorMiddleware();
    const originalRender = vi.fn();
    const req = {} as Request;
    const res = {
      locals: { locale: "en", serviceName: "Test Service" },
      render: originalRender
    } as unknown as Response;
    const next = vi.fn();

    middleware(req, res, next);

    res.render("test-view", {
      en: (model: { firstName: string }) => ({ greeting: `Hello ${model.firstName}` }),
      cy: (model: { firstName: string }) => ({ greeting: `Helo ${model.firstName}` }),
      firstName: "Ada"
    });

    expect(originalRender).toHaveBeenCalledWith(
      "test-view",
      {
        locale: "en",
        serviceName: "Test Service",
        greeting: "Hello Ada",
        firstName: "Ada"
      },
      undefined
    );
    expect(next).toHaveBeenCalled();
  });

  it("should call the Welsh function when locale is cy", () => {
    const middleware = renderInterceptorMiddleware();
    const originalRender = vi.fn();
    const req = {} as Request;
    const res = {
      locals: { locale: "cy" },
      render: originalRender
    } as unknown as Response;
    const next = vi.fn();

    middleware(req, res, next);

    res.render("test-view", {
      en: (model: { count: number }) => ({ message: `${model.count} items` }),
      cy: (model: { count: number }) => ({ message: `${model.count} eitem` }),
      count: 3
    });

    expect(originalRender).toHaveBeenCalledWith(
      "test-view",
      {
        locale: "cy",
        message: "3 eitem",
        count: 3
      },
      undefined
    );
    expect(next).toHaveBeenCalled();
  });

  it("should support mixing a function locale with a plain-object locale", () => {
    const middleware = renderInterceptorMiddleware();
    const originalRender = vi.fn();
    const req = {} as Request;
    const res = {
      locals: { locale: "en" },
      render: originalRender
    } as unknown as Response;
    const next = vi.fn();

    middleware(req, res, next);

    res.render("test-view", {
      en: (model: { name: string }) => ({ title: `Welcome ${model.name}` }),
      cy: { title: "Croeso" },
      name: "Sam"
    });

    expect(originalRender).toHaveBeenCalledWith(
      "test-view",
      {
        locale: "en",
        title: "Welcome Sam",
        name: "Sam"
      },
      undefined
    );
    expect(next).toHaveBeenCalled();
  });

  it("should preserve this context when calling original render", () => {
    const middleware = renderInterceptorMiddleware();
    const originalRender = vi.fn();
    const req = {} as Request;
    const res = {
      locals: { locale: "en" },
      render: originalRender,
      statusCode: 200
    } as unknown as Response;
    const next = vi.fn();

    middleware(req, res, next);

    // Call the intercepted render
    res.render("test-view", { title: "Test" });

    // Verify the original render was called with correct context
    expect(originalRender).toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});
