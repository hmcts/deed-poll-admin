import type { Request, Response } from "express";

const en = {
  title: "HMCTS Express Monorepo Template",
  subtitle: "Production-ready Node.js starter with cloud-native capabilities",
  intro:
    "A comprehensive monorepo template that demonstrates best practices for building HMCTS digital services using Express.js, TypeScript, and GOV.UK Design System.",

  cloudNativeTitle: "Cloud Native Platform",
  cloudNativeDescription: "Features for cloud deployment and operations:",
  cloudNativeFeatures: [
    {
      name: "Health Checks",
      description: "Configurable health endpoints with readiness and liveness probes for Kubernetes deployments"
    },
    {
      name: "Azure Integration",
      description: "Built-in support for Azure Key Vault secrets management and properties volume mounting"
    },
    {
      name: "Application Insights",
      description: "Comprehensive monitoring with Azure Application Insights including custom metrics and distributed tracing"
    },
    {
      name: "Properties Volume",
      description: "Secure configuration management through mounted volumes with automatic environment variable injection"
    }
  ],

  govukStarterTitle: "GOV.UK Starter",
  govukStarterDescription: "Everything you need to build GDS services:",
  govukStarterFeatures: [
    {
      name: "GOV.UK Design System",
      description: "Fully integrated GOV.UK Frontend with Nunjucks templates and automatic asset compilation"
    },
    {
      name: "Internationalization",
      description: "Welsh language support with locale middleware and translation management system"
    },
    {
      name: "Session Management",
      description: "PostgreSQL-backed session storage for distributed applications"
    },
    {
      name: "Cookie Manager",
      description: "Built-in cookie management with consent tracking and preference handling"
    },
    {
      name: "Security Headers",
      description: "Pre-configured Helmet.js with CSP, HSTS, and nonce-based script protection"
    },
    {
      name: "Asset Pipeline",
      description: "Vite-powered asset compilation with SCSS support and production optimization"
    }
  ],

  simpleRouterTitle: "Simple Router",
  simpleRouterDescription: "Lightweight file-system router inspired by Next.js:",
  simpleRouterFeatures: [
    {
      name: "File-based Routing",
      description: "Maps files in directories to Express routes automatically with zero configuration"
    },
    {
      name: "Dynamic Parameters",
      description: "Support for dynamic route segments using [param] syntax (e.g., /users/[id])"
    },
    {
      name: "HTTP Method Exports",
      description: "Export handlers for any HTTP method (GET, POST, PUT, DELETE, etc.) directly from route files"
    },
    {
      name: "Middleware Support",
      description: "Single handlers or arrays of middleware for complex request pipelines"
    },
    {
      name: "Multiple Mount Points",
      description: "Mount different directories with different URL prefixes for modular applications"
    },
    {
      name: "Zero Dependencies",
      description: "Lightweight implementation with no external dependencies, built for performance"
    }
  ],

  architectureTitle: "Monorepo Architecture",
  architectureDescription: "Organized for scalability and maintainability:",
  architectureFeatures: [
    "Workspace-based structure with Yarn workspaces",
    "Shared libraries for common functionality",
    "Simple Router package for file-based routing",
    "TypeScript with strict mode and ES modules",
    "Comprehensive testing with Vitest and Playwright",
    "Docker multi-stage builds for production",
    "Helm charts for Kubernetes deployment",
    "GitHub Actions CI/CD pipeline",
    "Biome for fast linting and formatting"
  ],

  gettingStartedTitle: "Getting Started",
  gettingStartedSteps: [
    { text: "Install dependencies with", code: "yarn install" },
    { text: "Run development server with", code: "yarn dev" },
    { text: "Access the application at", code: "http://localhost:3000" }
  ],

  learnMoreTitle: "Learn More",
  learnMoreDescription: "Explore the codebase and documentation to understand the full capabilities of this template.",

  exampleFormTitle: "Example Form",
  exampleFormDescription: "See how multi-page forms work with validation and session management.",
  exampleFormLinkText: "See example form"
};

const cy = {
  title: "Templed Monorepo Express HMCTS",
  subtitle: "Dechreuwr Node.js barod i gynhyrchu gyda galluoedd cwmwl-gynhenid",
  intro:
    "Templed monorepo cynhwysfawr sy'n dangos arferion gorau ar gyfer adeiladu gwasanaethau digidol HMCTS gan ddefnyddio Express.js, TypeScript, a System Dylunio GOV.UK.",

  cloudNativeTitle: "Platfform Cwmwl Cynhenid",
  cloudNativeDescription: "Nodweddion ar gyfer defnyddio a gweithrediadau cwmwl:",
  cloudNativeFeatures: [
    {
      name: "Gwiriadau Iechyd",
      description: "Pwyntiau terfyn iechyd y gellir eu ffurfweddu gyda phrofion parodrwydd a bywiogrwydd ar gyfer defnyddiadau Kubernetes"
    },
    {
      name: "Integreiddiad Azure",
      description: "Cefnogaeth adeiledig ar gyfer rheoli cyfrinachau Azure Key Vault a gosod cyfrol eiddo"
    },
    {
      name: "Application Insights",
      description: "Monitro cynhwysfawr gydag Azure Application Insights gan gynnwys metrigau wedi'u haddasu ac olrhain dosbarthedig"
    },
    {
      name: "Cyfrol Eiddo",
      description: "Rheoli ffurfweddiad diogel trwy gyfrolau wedi'u gosod gyda chwistrellu newidyn amgylchedd awtomatig"
    }
  ],

  govukStarterTitle: "Dechreuwr GOV.UK",
  govukStarterDescription: "Popeth sydd ei angen arnoch i adeiladu gwasanaethau GDS hygyrch:",
  govukStarterFeatures: [
    {
      name: "System Dylunio GOV.UK",
      description: "Blaen GOV.UK wedi'i integreiddio'n llawn gyda thempledi Nunjucks a chrynhoad ased awtomatig"
    },
    {
      name: "Rhyngwladoli",
      description: "Cefnogaeth iaith Gymraeg gyda cyfryngwr locale a system rheoli cyfieithu"
    },
    {
      name: "Rheoli Sesiynau",
      description: "Storio sesiynau wedi'i gefnogi gan PostgreSQL ar gyfer cymwysiadau dosbarthedig"
    },
    {
      name: "Rheolwr Cwcis",
      description: "Rheoli cwcis adeiledig gyda thracio cydsyniad a thrin dewisiadau"
    },
    {
      name: "Penawdau Diogelwch",
      description: "Helmet.js wedi'i ffurfweddu ymlaen llaw gyda CSP, HSTS, ac amddiffyniad sgript seiliedig ar nonce"
    },
    {
      name: "Piblinell Asedau",
      description: "Crynhoad ased wedi'i bweru gan Vite gyda chefnogaeth SCSS ac optimeiddio cynhyrchu"
    }
  ],

  simpleRouterTitle: "Llwybrydd Syml",
  simpleRouterDescription: "Llwybrydd system ffeiliau ysgafn wedi'i ysbrydoli gan Next.js:",
  simpleRouterFeatures: [
    {
      name: "Llwybro Seiliedig ar Ffeiliau",
      description: "Mapio ffeiliau mewn cyfeiriaduron i lwybrau Express yn awtomatig heb ffurfweddiad"
    },
    {
      name: "Parametrau Deinamig",
      description: "Cefnogaeth ar gyfer segmentau llwybr deinamig gan ddefnyddio cystrawen [param] (e.e., /users/[id])"
    },
    {
      name: "Allforio Dulliau HTTP",
      description: "Allforio trinwyr ar gyfer unrhyw ddull HTTP (GET, POST, PUT, DELETE, etc.) yn uniongyrchol o ffeiliau llwybr"
    },
    {
      name: "Cefnogaeth Cyfryngwyr",
      description: "Trinwyr sengl neu araeau o gyfryngwyr ar gyfer piblinellau cais cymhleth"
    },
    {
      name: "Pwyntiau Gosod Lluosog",
      description: "Gosod cyfeiriaduron gwahanol gyda rhagddodiaid URL gwahanol ar gyfer cymwysiadau modiwlaidd"
    },
    {
      name: "Dim Dibyniaethau",
      description: "Gweithrediad ysgafn heb ddibyniaethau allanol, wedi'i adeiladu ar gyfer perfformiad"
    }
  ],

  architectureTitle: "Pensaernïaeth Monorepo",
  architectureDescription: "Wedi'i drefnu ar gyfer graddadwyedd a chynhaliwyd:",
  architectureFeatures: [
    "Strwythur seiliedig ar weithle gyda gweithle Yarn",
    "Llyfrgelloedd a rennir ar gyfer ymarferoldeb cyffredin",
    "Pecyn Llwybrydd Syml ar gyfer llwybro seiliedig ar ffeiliau",
    "TypeScript gyda modd llym a modiwlau ES",
    "Profi cynhwysfawr gyda Vitest a Playwright",
    "Adeiladau aml-gam Docker ar gyfer cynhyrchu",
    "Siartiau Helm ar gyfer defnyddio Kubernetes",
    "Piblinell CI/CD GitHub Actions",
    "Biome ar gyfer lintio a fformatio cyflym"
  ],

  gettingStartedTitle: "Dechrau Arni",
  gettingStartedSteps: [
    { text: "Gosod dibyniaethau gyda", code: "yarn install" },
    { text: "Rhedeg gweinydd datblygu gyda", code: "yarn dev" },
    { text: "Cyrchu'r cais yn", code: "http://localhost:3000" }
  ],

  learnMoreTitle: "Dysgu Mwy",
  learnMoreDescription: "Archwiliwch y sylfaen cod a'r dogfennaeth i ddeall galluoedd llawn y templed hwn.",

  exampleFormTitle: "Ffurflen Enghreifftiol",
  exampleFormDescription: "Gweld sut mae ffurflenni aml-dudalen yn gweithio gyda dilysu a rheoli sesiynau.",
  exampleFormLinkText: "Gweld ffurflen enghreifftiol"
};

export const GET = async (_req: Request, res: Response) => {
  res.render("index", { en, cy });
};
