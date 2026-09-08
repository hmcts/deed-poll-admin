/**
 * The health server is the only thing this pod publishes on its ingress, so what it does with a
 * non-health path is a security property rather than a detail: Prisma Studio is an unauthenticated
 * read/write browser over applicant PII, and the default must be that nothing reaches it.
 *
 * Driven as a child process because the server binds port 5555 at import — spawning is what lets one
 * test file exercise both the default and the opted-in configuration.
 */

import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const SERVER_PATH = fileURLToPath(new URL("./health-server.mjs", import.meta.url));
const PORT = 5555;
const NOT_FOUND_BODY = "Not found";

const portFree = await isPortFree();

describe.skipIf(!portFree)("health server", () => {
  let child;

  afterEach(async () => {
    await stopServer(child);
    child = undefined;
  });

  it("answers the Kubernetes probes when Prisma Studio is disabled", async () => {
    child = await startServer({});

    const liveness = await get("/health/liveness");
    const readiness = await get("/health/readiness");

    expect(liveness).toEqual({ status: 200, body: "OK" });
    expect(readiness).toEqual({ status: 200, body: "OK" });
  });

  it("does not expose Prisma Studio by default", async () => {
    child = await startServer({});

    const root = await get("/");

    expect(root).toEqual({ status: 404, body: NOT_FOUND_BODY });
  });

  it("does not expose Prisma Studio when the flag is set to anything other than true", async () => {
    child = await startServer({ ENABLE_PRISMA_STUDIO: "1" });

    const root = await get("/");

    expect(root).toEqual({ status: 404, body: NOT_FOUND_BODY });
  });

  // Asserted as "not answered here" rather than as a specific status, because what 5556 does with the
  // forwarded request depends on the machine: nothing is listening on a bare agent (502 from the proxy's
  // error handler), while locally the docker-compose IDAM simulator holds that port and replies itself.
  // Either way, a response that is not this server's own 404 is proof the gate is open.
  it("forwards to Prisma Studio when explicitly enabled", async () => {
    child = await startServer({ ENABLE_PRISMA_STUDIO: "true" });

    const root = await get("/");

    expect(root.body).not.toBe(NOT_FOUND_BODY);
  });
});

function startServer(env) {
  const spawned = spawn(process.execPath, [SERVER_PATH], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"]
  });

  return new Promise((resolve, reject) => {
    let stderr = "";
    spawned.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    spawned.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("listening on port 5555")) {
        resolve(spawned);
      }
    });
    spawned.once("error", reject);
    spawned.once("exit", (code) => {
      reject(new Error(`health server exited early with code ${code}: ${stderr}`));
    });
  });
}

// Awaiting `exit` matters as much as the signal: the process has to have released 5555 before the next
// test spawns, and `kill` only delivers the signal rather than waiting for it to take effect.
async function stopServer(spawned) {
  if (!spawned || spawned.exitCode !== null) {
    return;
  }
  const exited = new Promise((resolve) => spawned.once("exit", resolve));
  spawned.kill("SIGKILL");
  await exited;
}

function get(path) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: "127.0.0.1", port: PORT, path }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => resolve({ status: response.statusCode, body }));
    });
    request.on("error", reject);
  });
}

function isPortFree() {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(PORT, "127.0.0.1");
  });
}
