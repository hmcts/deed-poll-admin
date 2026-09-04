#!/usr/bin/env node
// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: IDAM_SIMULATOR_SRC is this script's own knob,
// not something either app reads. Declaring it in turbo.json would imply it affects a build task.

/**
 * Builds the local IDAM simulator image that `docker-compose.yml` expects.
 *
 * Why a script rather than a `build:` stanza in the compose file: the source is a separate HMCTS repo,
 * not part of this one, so there is nothing in-tree for Docker to build from. This clones it on demand
 * and builds it, so `yarn dev:up` has an image to run.
 *
 * Why not just pull the published image: the current
 * `hmctsprod.azurecr.io/hmcts/rse/rse-idam-simulator:latest` predates the commits that make an
 * authorization-code flow work — `/o/token` requires a `username` (it is built for the password
 * grant), `/o/authorize` allows POST only so a browser redirect 405s, and it does not echo `state`.
 * Master fixes all three. Once a current image is published this script can be deleted and the compose
 * file can pull it instead.
 *
 * Why the jar is built in a container: the project's Gradle toolchain pins Java 17, and the
 * devcontainer has 21. Building inside `gradle:8.14-jdk17` avoids either installing another JDK or
 * patching a clone of someone else's repo.
 *
 *   yarn idam:build              # clone if needed, build the jar, build the image
 *   IDAM_SIMULATOR_SRC=<path>    # use an existing clone instead of the default location
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Defaults to the cft-workspace's own location for this repo, since that is where it will already be
 * if anyone has run the workspace bootstrap — but it is only a default, and the override exists so
 * this does not assume the workspace layout.
 */
const SRC = resolve(process.env.IDAM_SIMULATOR_SRC ?? join(ROOT, "../libs/rse-idam-simulator"));
const IMAGE = "rse-idam-simulator:local";

const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: "inherit" });

if (!existsSync(SRC)) {
  console.log(`Cloning hmcts/rse-idam-simulator into ${SRC}`);
  run("git", ["clone", "--depth", "1", "https://github.com/hmcts/rse-idam-simulator", SRC], ROOT);
}

console.log(`Building the jar in a JDK 17 container (the project's toolchain pins 17)`);
run(
  "docker",
  ["run", "--rm", "-v", `${SRC}:/app`, "-w", "/app", "gradle:8.14-jdk17", "gradle", "bootJar", "-x", "test", "--console=plain", "--no-daemon"],
  ROOT
);

console.log(`Building ${IMAGE}`);
run("docker", ["build", "-t", IMAGE, "."], SRC);

console.log(`\nDone. \`yarn dev:up\` will now start it, or:\n  docker compose up -d idam`);
