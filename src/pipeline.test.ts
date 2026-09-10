/**
 * What the Jenkins CNP pipeline requires of this repo that nothing else checks.
 *
 * The same reasoning as `deployment-chart.test.ts`: every assertion here fails only on a real Jenkins run,
 * and most of them only on the *first run that gets as far as a deploy* — which is the most expensive place
 * to discover a one-word mistake. `YarnBuilder.runYarn` ends with
 * `if (status != 0 && !task.contains('install')) steps.error(...)`, and yarn exits non-zero on
 * `Couldn't find a script named ...`, so a missing script fails the stage rather than being skipped.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SPEC_DIR = "e2e-tests/tests";

/**
 * Every `yarn` script `YarnBuilder` invokes, and the stage that invokes it. Read off
 * `src/uk/gov/hmcts/contino/YarnBuilder.groovy` and `vars/sectionDeployToAKS.groovy` in
 * `hmcts/cnp-jenkins-library`, not inferred from other repos.
 */
const REQUIRED_SCRIPTS = {
  lint: "build(), the build stage",
  test: "test(), the test stage",
  "test:coverage": "test(), the test stage",
  "test:a11y": "test(), the test stage",
  // Unconditional after every deploy, so its absence fails the run the first time a deploy succeeds.
  "test:smoke": "smokeTest(), after every AKS deploy",
  // `Environment.functionalTestEnvironments` is `[aat, preview, idam-aat, idam-preview]` — so this runs on
  // every pull request, not only on a release to AAT.
  "test:functional": "functionalTest(), on aat and on every preview"
};

describe("Jenkinsfile_CNP", () => {
  it("should declare the product and component the shared vault, chart and hostname were all written against", () => {
    const jenkinsfile = readRoot("Jenkinsfile_CNP");

    // `helmInstall` builds `${product}-${component}` into the release name, the AKS service name and
    // therefore `SERVICE_FQDN`, and `hmcts/deed-poll-infra` names the vault `deed-poll-${env}` with this
    // app's secrets prefixed `admin-`. Changing either half here silently re-points all of that.
    expect(jenkinsfile).toContain('def product = "deed-poll"');
    expect(jenkinsfile).toContain('def component = "admin"');
    expect(jenkinsfile).toContain('def type = "nodejs"');
  });

  it("should pin the shared library to a version, so the product's two pipelines move together", () => {
    // A floating `@master` would let a library release change this deploy with no change from us, and
    // `hmcts/deed-poll-infra` pins the same version on purpose — checked against its own `Jenkinsfile_CNP`,
    // not assumed. Bump both or neither.
    expect(readRoot("Jenkinsfile_CNP")).toMatch(/@Library\("Infrastructure@\d+\.\d+\.\d+"\)/);
  });
});

describe("the yarn scripts the pipeline invokes", () => {
  it.each(Object.entries(REQUIRED_SCRIPTS))("should define %s, which the library calls from %s", (script) => {
    expect(readRootPackage().scripts).toHaveProperty(script);
  });

  it("should point test:smoke at the @smoke subset and report where smokeTest collects it", () => {
    // `smokeTest()` does `junit testResults: 'smoke-output/**/*result.xml'` and
    // `archiveArtifacts artifacts: 'smoke-output/**'`, both relative to the repo root and both with empty
    // results allowed — so a report written anywhere else is not a failure, it is a silently unpublished
    // one. The reporters are set on the command line because `playwright.config.ts` gates its junit
    // reporter on `CI`, which Jenkins does not set.
    const smoke = readWorkspacePackage("e2e-tests").scripts["test:smoke"];

    expect(smoke).toContain("--grep @smoke");
    expect(smoke).toContain("--reporter=list,junit");
    expect(smoke).toContain("../smoke-output/smoke-result.xml");
  });

  it("should tag exactly one spec @smoke, since a deployed environment has no IDAM client and no api mock", () => {
    // The journeys are not tagged deliberately: they need a session from the local simulator and fixtures
    // from the in-memory api mock on :3200. A second `@smoke` tag is how the post-deploy gate quietly
    // acquires a dependency on the local stack, so it is asserted rather than left to review.
    const specs = readdirSync(path.join(ROOT, SPEC_DIR)).filter((entry) => entry.endsWith(".spec.ts"));

    const tagged = specs.filter((spec) => readRoot(path.join(SPEC_DIR, spec)).includes("@smoke"));

    expect(tagged).toEqual(["smoke.spec.ts"]);
  });
});

function readRoot(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function readRootPackage(): PackageJson {
  return JSON.parse(readRoot("package.json"));
}

function readWorkspacePackage(name: string): PackageJson {
  return JSON.parse(readRoot(path.join(name, "package.json")));
}

interface PackageJson {
  scripts: Record<string, string>;
}
