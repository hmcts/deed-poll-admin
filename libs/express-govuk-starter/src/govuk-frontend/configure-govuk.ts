import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Express, NextFunction, Request, Response } from "express";
import nunjucks from "nunjucks";
import type { AssetOptions } from "../assets/assets.js";
import { configureAssets } from "../assets/configure-assets.js";
import { localeMiddleware, renderInterceptorMiddleware, translationMiddleware } from "../i18n/locale-middleware.js";
import { loadTranslationsFromMultiplePaths } from "../i18n/translation-loader.js";
import { currencyFilter, dateFilter, govukErrorSummaryFilter, kebabCaseFilter, timeFilter } from "./filters/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function configureGovuk(app: Express, paths: string[], options: GovukSetupOptions): Promise<nunjucks.Environment> {
  const { mergedViewPaths, mergedI18nPaths } = mergeConfigs(paths);
  const govukFrontendPath = path.join(fileURLToPath(import.meta.resolve("govuk-frontend")), "..", "..");
  // Views ship under dist/ for npm-installed consumers. The template's own dev
  // mode runs tsc --watch without copying .njk files, so dist/views may be
  // missing — fall back to src/ in that case.
  const viewsBaseDir = existsSync(path.join(__dirname, "./views")) ? __dirname : __dirname.replace("/dist/", "/src/");
  const govukSetupViews = path.join(viewsBaseDir, "./views");
  const cookieViews = path.join(viewsBaseDir, "../cookies/views");
  const allViewPaths = [govukFrontendPath, govukSetupViews, cookieViews, ...mergedViewPaths];

  const env = nunjucks.configure(allViewPaths, {
    autoescape: true,
    express: app,
    watch: process.env.NODE_ENV !== "production",
    noCache: process.env.NODE_ENV !== "production"
  });

  app.set("view engine", "njk");
  app.set("nunjucksEnv", env);

  addFilters(env);
  addGlobals(env, options.nunjucksGlobals);

  if (mergedI18nPaths.length > 0) {
    const translations = await loadTranslationsFromMultiplePaths(mergedI18nPaths);
    app.use(localeMiddleware());
    app.use(renderInterceptorMiddleware());
    app.use(translationMiddleware(translations));
  }

  await configureAssets(app, env, options.assetOptions);

  app.use((req: Request, res: Response, next: NextFunction) => {
    res.locals.pageUrl = req.path;
    res.locals.serviceUrl = `${req.protocol}://${req.get("host")}`;
    next();
  });

  return env;
}

function addFilters(env: nunjucks.Environment): void {
  env.addFilter("date", dateFilter);
  env.addFilter("time", timeFilter);
  env.addFilter("currency", currencyFilter);
  env.addFilter("kebabCase", kebabCaseFilter);
  env.addFilter("govukErrorSummary", govukErrorSummaryFilter);
}

function addGlobals(env: nunjucks.Environment, globals: Record<string, unknown> = {}): void {
  env.addGlobal("isProduction", process.env.NODE_ENV === "production");

  Object.entries(globals).forEach(([key, value]) => {
    env.addGlobal(key, value);
  });
}

function collectViewPaths(dir: string): string[] {
  const subdirs = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
  const routeGroups = subdirs.filter((e) => /^\(.+\)$/.test(e.name));
  const regularDirs = subdirs.filter((e) => !/^\(.+\)$/.test(e.name));

  const groupPaths = routeGroups.flatMap((e) => collectViewPaths(path.join(dir, e.name)));
  const nestedPaths = regularDirs.flatMap((e) => collectViewPaths(path.join(dir, e.name)));

  return [dir, ...groupPaths, ...nestedPaths];
}

function mergeConfigs(paths: string[]): {
  mergedViewPaths: string[];
  mergedI18nPaths: string[];
} {
  const mergedViewPaths: string[] = [];
  const mergedI18nPaths: string[] = [];

  for (const modulePath of paths) {
    const actualModulePath = process.env.NODE_ENV !== "production" ? modulePath : modulePath.replace("/src", "/dist");

    const pagesPath = path.join(actualModulePath, "pages");
    if (existsSync(pagesPath)) {
      mergedViewPaths.push(...collectViewPaths(pagesPath));
    }
    if (existsSync(path.join(actualModulePath, "locales"))) {
      mergedI18nPaths.push(`${actualModulePath}/locales`);
    }
  }

  return { mergedViewPaths, mergedI18nPaths };
}

export interface GovukSetupOptions {
  nunjucksGlobals?: Record<string, unknown>;
  assetOptions: AssetOptions;
}
