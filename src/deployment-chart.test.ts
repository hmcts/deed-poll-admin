// biome-ignore-all lint/suspicious/noTemplateCurlyInString: `${IMAGE_NAME}`, `${SERVICE_FQDN}` and
// `values.${environment}.template.yaml` are what `envsubst` and `helmInstall` read out of the chart, so the
// literal `${…}` in a plain string is the value under test rather than a template literal written by mistake.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { load as yamlLoad } from "js-yaml";
import { describe, expect, it } from "vitest";
import { PERSONA_SWITCHER_ENVIRONMENTS } from "./auth/persona-switcher.js";

// `src/secrets.ts` resolves this path relative to its own directory, and `getPropertiesVolumeSecrets`
// swallows a missing or unparseable chart: the aliases below are silently dropped and every secret arrives
// under its Key Vault name instead, which shows up only as a missing environment variable in a deployed
// environment. So the chart is asserted from the same relative path the application reads it from.
const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const CHART_DIR = path.join(APP_DIR, "../charts/deed-poll-admin");
const VAULT = "deed-poll";
const TEMPLATES = ["values.aat.template.yaml", "values.preview.template.yaml"];
const PERSONA_SWITCHER_FLAG = "PERSONA_SWITCHER_ENABLED";

describe("charts/deed-poll-admin", () => {
  it("should live at the path helmInstall requires, since it throws before it does anything else", () => {
    // `Helm.HELM_RESOURCES_DIR` in `hmcts/cnp-jenkins-library` is the literal `charts`, and `helmInstall`
    // throws `No Helm charts directory found at charts` and then requires
    // `charts/${product}-${component}/values.yaml`. The chart was at `helm/deed-poll-admin/` with no
    // `values.yaml` at all until plan 03 task 4.
    expect(existsSync(path.join(CHART_DIR, "values.yaml"))).toBe(true);
    expect(existsSync(path.join(APP_DIR, "../helm")), "helm/ is not the directory helmInstall reads").toBe(false);
  });

  it("should read exactly the four secrets the shared vault in hmcts/deed-poll-infra creates", () => {
    const values = readValues("values.yaml");

    expect(values.nodejs.keyVaults).toEqual({
      // The vault name the cnp-module-key-vault default resolves to, `{product}-{env}` — a product, not a
      // component.
      [VAULT]: {
        secrets: [
          { name: "app-insights-connection-string", alias: "APPLICATION_INSIGHTS_CONNECTION_STRING" },
          { name: "redis-url", alias: "REDIS_URL" },
          // Prefixed `admin-` because the vault is shared with `deed-poll-web`, which reads
          // `web-session-secret`: one signing key across a caseworker service and a public one would make a
          // forged cookie portable between them.
          { name: "admin-idam-client-secret", alias: "IDAM_CLIENT_SECRET" },
          { name: "admin-session-secret", alias: "SESSION_SECRET" }
        ]
      }
    });
  });

  it("should name no database secret, since the data access layer moved to deed-poll-api", () => {
    // The chart fails on a missing secret, so naming one this app does not need would make deployment
    // depend on a resource it must not open. `postgres-url` was here until plan 02.
    const chart = TEMPLATES.concat("values.yaml").map(readUncommented).join("\n");

    expect(chart).not.toContain("postgres-url");
    expect(chart).not.toContain("DATABASE_URL");
  });

  it("should alias every secret to an environment variable the application actually reads", () => {
    const secrets = readValues("values.yaml").nodejs.keyVaults?.[VAULT].secrets ?? [];
    const readByConfig = readFileSync(path.join(APP_DIR, "../config/custom-environment-variables.json"), "utf8");

    expect(secrets).toHaveLength(4);
    for (const { alias } of secrets) {
      expect(readByConfig).toContain(`"${alias}"`);
    }
  });

  it("should resolve the chart from the path the application reads it from", () => {
    // The path below is a module-scoped const in `src/secrets.ts`, so this file can only recompute it — and
    // a test that recomputes a path asserts nothing about the application. Reading it out of the source is
    // what makes the two move together: if `secrets.ts` points somewhere else, the aliases asserted here are
    // not the ones the deployed app applies.
    expect(readFileSync(path.join(APP_DIR, "secrets.ts"), "utf8")).toContain('"../charts/deed-poll-admin/values.yaml"');
  });

  it("should not mount redis-url in preview, where the ephemeral cache is set as an environment variable", () => {
    // `getPropertiesVolumeSecrets` writes every mounted secret to `process.env` under its chart alias and
    // consults its `omit` list only on the local Azure-vault path, so a mounted `redis-url` overwrites the
    // `REDIS_URL` the preview template sets and points the PR at AAT's shared cache. Helm replaces a list
    // rather than merging it, so the preview list has to be spelled out in full, minus that one entry.
    const previewSecrets = readValues("values.preview.template.yaml").nodejs.keyVaults?.[VAULT].secrets ?? [];

    // Derived from `values.yaml` rather than spelled out again, so a secret added there and not to the
    // preview list fails here instead of going silently unmounted in every PR environment.
    const expected = (readValues("values.yaml").nodejs.keyVaults?.[VAULT].secrets ?? []).filter(({ name }) => name !== "redis-url");

    expect(previewSecrets).toEqual(expected);
    expect(previewSecrets.map(({ name }) => name)).not.toContain("redis-url");
  });

  it("should override values.yaml from per-environment templates, which helmInstall appends rather than renders over it", () => {
    // `helmInstall` does `envsubst < values.template.yaml > values.yaml`, so a file with that exact name
    // *replaces* the shared defaults instead of layering on them: the vault list, `useWorkloadIdentity` and
    // `saEnabled`, `applicationPort`, both probe paths, every `IDAM_*` variable and `redis.enabled: false` would all be
    // gone from every non-preview deploy. No mounted secrets means `getPropertiesVolumeSecrets` returns an
    // empty alias map without throwing, `REDIS_URL` falls back to `config/default.json`'s localhost and
    // `assertRedisUrl` refuses to start — and `redis.enabled` going missing enables the ephemeral subchart in
    // AAT and prod. A `values.${environment}.template.yaml` renders to its own file and is appended, which is
    // the shape every override here has to keep. This fails only on a real Jenkins run, hence the test.
    expect(
      existsSync(path.join(CHART_DIR, "values.template.yaml")),
      "values.template.yaml overwrites values.yaml — name it values.${environment}.template.yaml"
    ).toBe(false);

    for (const template of TEMPLATES) {
      expect(existsSync(path.join(CHART_DIR, template)), `no override template for ${template}`).toBe(true);
    }
  });

  it("should not set global.environment, which helmInstall passes with --set and a values file cannot win", () => {
    // The vault name is `{product}-{env}` and `hmcts/deed-poll-infra` creates no `deed-poll-preview`, so a
    // value that did take effect would point the SecretProviderClass at a vault that does not exist and
    // leave pods in ContainerCreating.
    for (const template of TEMPLATES) {
      expect(readValues(template).global?.environment, `${template} sets global.environment`).toBeUndefined();
    }
  });

  it("should use only the substitutions envsubst can expand", () => {
    // `helmInstall` runs the templates through `envsubst`, which expands `$VAR` and `${VAR}` and nothing
    // else. A `${VAR:-default}` reaches Helm as that literal string — the old `values.template.yaml` had
    // `environment: ${ENVIRONMENT:-aat}` — and a literal in the vault name or the ingress host fails at
    // deploy time rather than here.
    for (const template of TEMPLATES) {
      expect(readUncommented(template), `${template} uses a substitution envsubst leaves as a literal`).not.toMatch(/\$\{[A-Za-z_][A-Za-z0-9_]*[:\-+?]/);
    }
  });

  it("should take the image and the ingress host from the variables helmInstall exports", () => {
    // `helmInstall` exports exactly five: `NAMESPACE`, `SERVICE_NAME`, `IMAGE_NAME`, `SERVICE_FQDN` and
    // `INGRESS_IP`. `${WEB_IMAGE}` and `${CRONS_IMAGE}` were set by the deleted GitHub Actions build job and
    // by nothing since, so `envsubst` would have produced untagged image references.
    for (const template of TEMPLATES) {
      const contents = readFileSync(path.join(CHART_DIR, template), "utf8");

      expect(contents).toContain("image: ${IMAGE_NAME}");
      expect(contents).toContain("ingressHost: ${SERVICE_FQDN}");
    }
  });

  it("should build no hostname from TEAM_NAME or ENVIRONMENT, neither of which is exported to a template", () => {
    // `ENVIRONMENT` is unset, and `envsubst` replaces an unset variable with the empty string, so
    // `…-web.${ENVIRONMENT}.platform.hmcts.net` rendered with a doubled dot. `TEAM_NAME` is
    // `TeamConfig.getName(product)` — a team *display* name from `cnp-jenkins-config/team-config.yml`, which
    // returns the constant `pleaseTagMe` for a product it does not list, and `deed-poll` is not listed.
    for (const file of TEMPLATES.concat("values.yaml")) {
      const contents = readUncommented(file);

      expect(contents, `${file} interpolates TEAM_NAME`).not.toContain("TEAM_NAME");
      expect(contents, `${file} interpolates ENVIRONMENT`).not.toContain("${ENVIRONMENT");
    }
  });

  it("should point IDAM_REDIRECT_URI at its own ingress host in every environment", () => {
    // IDAM refuses a `redirect_uri` it does not hold exactly, and the refusal renders on IDAM's own page
    // *after* a successful login — so no request reaches this app, nothing here logs, and login is broken in
    // one environment only. `assertIdamSettings` catches an unset or localhost value and cannot catch a
    // wrong host. The pair therefore has to be decided in one file, which is what this asserts: the previous
    // arrangement set the host in the root template and the redirect URI in a subchart, and the subchart's
    // value applied nowhere it was deployed.
    const stableHost = "deed-poll-admin.{{ .Values.global.environment }}.platform.hmcts.net";
    const values = readValues("values.yaml");

    expect(values.nodejs.ingressHost).toBe(stableHost);
    expect(values.nodejs.environment?.IDAM_REDIRECT_URI).toBe(`https://${stableHost}/oauth2/callback`);

    for (const template of TEMPLATES) {
      expect(readValues(template).nodejs.environment?.IDAM_REDIRECT_URI, `${template} derives the redirect URI from something else`).toBe(
        "https://${SERVICE_FQDN}/oauth2/callback"
      );
    }
  });

  it("should point both probes at the paths the healthcheck middleware answers on", () => {
    const values = readValues("values.yaml");

    expect(values.nodejs.readinessPath).toBe("/health/readiness");
    expect(values.nodejs.livenessPath).toBe("/health/liveness");
  });

  it("should name deed-poll-api in every environment, since no page renders without it", () => {
    // The adapter falls back to `http://localhost:3200`, the in-repo mock — right for `yarn dev` and wrong
    // everywhere else, so an unset value is a pod whose every case page 500s.
    expect(readValues("values.yaml").nodejs.environment?.DEED_POLL_API_URL).toContain("deed-poll-api-");
    // Preview points at AAT's api on purpose: `global.environment` is `preview` and no
    // `deed-poll-api-preview.service.core-compute-preview.internal` exists.
    expect(readValues("values.preview.template.yaml").nodejs.environment?.DEED_POLL_API_URL).toBe("http://deed-poll-api-aat.service.core-compute-aat.internal");
  });

  it("should depend on nodejs and redis, and on none of the deleted template applications", () => {
    const chart = yamlLoad(readFileSync(path.join(CHART_DIR, "Chart.yaml"), "utf8")) as Chart;

    // Redis survives the collapse deliberately: a preview environment needs a cache of its own.
    expect(chart.dependencies.map(({ name }) => name)).toEqual(["nodejs", "redis"]);
    // A `file://` dependency on a directory that no longer exists fails `helm dependency build`, and every
    // one this chart had — `deed-poll-admin-{web,api,crons,postgres}` — pointed at a deleted directory or an
    // image nothing builds.
    expect(chart.dependencies.every(({ repository }) => !repository.startsWith("file://"))).toBe(true);
  });

  it("should enable redis only for preview, where it is ephemeral and unauthenticated", () => {
    expect(readValues("values.yaml").redis?.enabled).toBe(false);

    const preview = readValues("values.preview.template.yaml");
    expect(preview.redis?.enabled).toBe(true);
    expect(preview.redis?.master?.persistence?.enabled).toBe(false);
    expect(preview.nodejs.environment?.REDIS_URL).toBe("redis://{{ .Release.Name }}-redis-master:6379");
  });

  it("should leave the persona switcher off in values.yaml, which is what a production deploy inherits", () => {
    // The switcher signs a tester in as another persona's real IDAM user, so it is a privilege-escalation
    // mechanism by design. `NODE_ENV` cannot keep it out of production — `package.json`'s `start` sets
    // `NODE_ENV=production` in *every* deployed pod, aat and preview included — so this file being off, and
    // only the aat and preview templates turning it on, is the whole control. A future production deploy
    // gets `values.yaml` plus no template, which must mean off.
    const base = readValues("values.yaml").nodejs.environment?.[PERSONA_SWITCHER_FLAG];

    expect(base ?? "false", "values.yaml enables the persona switcher, so production would inherit it").toBe("false");
  });

  it("should enable the persona switcher only in environments the runtime allowlist also permits", () => {
    // Both halves of the gate, asserted against each other rather than restated: a template enabling the flag
    // for an environment `PERSONA_SWITCHER_ENVIRONMENTS` does not name would ship a control that silently
    // does nothing, and a template for `prod` enabling it fails here rather than at a deploy. Read off the
    // directory rather than from `TEMPLATES`, so a values file added later is covered without an edit.
    const templates = readdirSync(CHART_DIR).filter((file) => /^values\..+\.template\.yaml$/.test(file));
    const enabled = templates.filter((file) => readValues(file).nodejs.environment?.[PERSONA_SWITCHER_FLAG] === "true");

    expect(enabled.sort()).toEqual(["values.aat.template.yaml", "values.preview.template.yaml"]);
    for (const file of enabled) {
      const environment = file.replace(/^values\.(.+)\.template\.yaml$/, "$1");

      expect(PERSONA_SWITCHER_ENVIRONMENTS.has(environment), `${file} enables the persona switcher for an environment persona-switcher.ts refuses`).toBe(true);
    }
  });

  it("should tell the application which environment it is, since NODE_ENV says production in all of them", () => {
    // `ENVIRONMENT_NAME` is resolved here, from the `global.environment` `helmInstall` passes with `--set`,
    // and read through `config`. The mapping is asserted by *structure* and not by searching the file for the
    // variable names: a mis-nested or renamed key leaves every name present while `config.get` silently falls
    // back to `config/default.json`, and the symptom — no strip — is indistinguishable from the gate working.
    const mapping = readMapping();

    expect(readValues("values.yaml").nodejs.environment?.ENVIRONMENT_NAME).toBe("{{ .Values.global.environment }}");
    expect(mapping.environmentName).toBe("ENVIRONMENT_NAME");
    // `__format: "json"` is what makes the flag arrive as a boolean. Without it config hands back the string
    // `"false"`, which is truthy.
    expect(mapping.personaSwitcher?.enabled).toEqual({ __name: PERSONA_SWITCHER_FLAG, __format: "json" });
  });

  it("should leave the persona switcher's allowlist no environment to match when ENVIRONMENT_NAME is unset", () => {
    // The other half of the gate failing closed, and the reason this is asserted rather than left to the
    // chart: `config/default.json` applies wherever the variable does not arrive, so a default that named a
    // permitted environment — `development`, as this held until the review of the switcher — would reduce two
    // independent conditions to the flag alone on any deploy path that does not render `ENVIRONMENT_NAME`.
    const fallback = (JSON.parse(readFileSync(path.join(APP_DIR, "../config/default.json"), "utf8")) as { environmentName: string }).environmentName;

    expect(PERSONA_SWITCHER_ENVIRONMENTS.has(fallback), `config/default.json's environmentName "${fallback}" opens the persona switcher's allowlist`).toBe(
      false
    );
  });

  it("should give the preview redis a probe budget that survives Dynatrace instrumentation", () => {
    // HDPI-8155: the chart-default 2s exec-probe budget leaves redis Running-but-not-Ready on preview
    // (`apps/pcs/pcs-frontend` measured 3.4-4.1s), and a master missing from its Service endpoints leaves
    // `redisStatus` reporting DOWN for ever — so the web pod never joins its own Service either.
    const master = readValues("values.preview.template.yaml").redis?.master;

    expect(master?.readinessProbe?.timeoutSeconds).toBeGreaterThanOrEqual(10);
    expect(master?.livenessProbe?.timeoutSeconds).toBeGreaterThanOrEqual(10);
  });
});

function readValues(file: string): Values {
  return yamlLoad(readFileSync(path.join(CHART_DIR, file), "utf8")) as Values;
}

/** The env-var map `config` reads, parsed rather than searched — see the assertion that uses it. */
function readMapping(): EnvironmentMapping {
  return JSON.parse(readFileSync(path.join(APP_DIR, "../config/custom-environment-variables.json"), "utf8")) as EnvironmentMapping;
}

/**
 * The chart's text with its comments stripped, for the assertions that hunt for a string rather than read a
 * key.
 *
 * Necessary rather than tidy: the comments in these files quote the variables and secret names the
 * assertions forbid — that is what they are for — so a raw `toContain` fails on the explanation of the rule
 * it is enforcing. Comments are safe to drop because `envsubst` mangling one deploys perfectly well.
 */
function readUncommented(file: string): string {
  return readFileSync(path.join(CHART_DIR, file), "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}

interface Values {
  global?: { environment?: string };
  nodejs: {
    ingressHost?: string;
    readinessPath?: string;
    livenessPath?: string;
    environment?: Record<string, string>;
    keyVaults?: Record<string, { secrets: { name: string; alias?: string }[] }>;
  };
  redis?: {
    enabled?: boolean;
    master?: {
      persistence?: { enabled?: boolean };
      readinessProbe?: { timeoutSeconds?: number };
      livenessProbe?: { timeoutSeconds?: number };
    };
  };
}

interface Chart {
  dependencies: { name: string; repository: string }[];
}

interface EnvironmentMapping {
  environmentName?: string;
  personaSwitcher?: { enabled?: unknown };
}
