import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "scripts/rate-limit-observe-check.sh");
const PARSER = path.join(ROOT, "scripts/rate-limit-observe-check-parse.py");
const HAS_PYTHON = spawnSync("python3", ["--version"]).status === 0;

const ADMIN = "https://deed-poll-admin.aat.platform.hmcts.net";
const PREVIEW = `${ADMIN}/deed-polls/0b6e1c2a-5d1f-4c1e-9a43-2f0d9c8e7b61/emails/name-change-confirmation/preview`;
const SEND = `${ADMIN}/deed-polls/0b6e1c2a-5d1f-4c1e-9a43-2f0d9c8e7b61/emails/name-change-confirmation/send`;
const COOKIE_MARKER = "cookie-secret-marker-7f3a";
const BODY_MARKER = "body-secret-marker-91c2";
const BODY = `_csrf=tok&applicant_name=Jo+Bloggs&note=${BODY_MARKER}`;

// What Chrome's "Copy as cURL (bash)" writes for the preview POST: destination first, one option per line.
const CHROME_COPY = [
  `curl '${PREVIEW}' \\`,
  "  -H 'accept: text/html,application/xhtml+xml' \\",
  "  -H 'content-type: application/x-www-form-urlencoded' \\",
  `  -b 'admin.sid=s%3A${COOKIE_MARKER}' \\`,
  `  -H 'origin: ${ADMIN}' \\`,
  `  -H 'referer: ${ADMIN}/deed-polls/0b6e1c2a-5d1f-4c1e-9a43-2f0d9c8e7b61/emails/name-change-confirmation' \\`,
  `  -H 'sec-ch-ua: "Chromium";v="141", "Not?A_Brand";v="8"' \\`,
  `  --data-raw '${BODY}'`,
  ""
].join("\n");

/**
 * The script replays a copied request 35 times with a live session cookie, so the only safe way to test it is to
 * never let it reach curl: `--check-only` stops after the parse, and a `curl` stub first on the PATH records any call
 * that gets past that anyway.
 */
describe.skipIf(!HAS_PYTHON)("the abuse-limit observe check", () => {
  let dir: string;
  let curlCalled: string;
  let env: NodeJS.ProcessEnv;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "observe-check-"));
    curlCalled = path.join(dir, "curl-called");
    const stub = path.join(dir, "bin");
    spawnSync("mkdir", [stub]);
    writeFileSync(path.join(stub, "curl"), `#!/bin/sh\ntouch '${curlCalled}'\nexit 1\n`);
    chmodSync(path.join(stub, "curl"), 0o755);
    env = { ...process.env, PATH: `${stub}${path.delimiter}${process.env.PATH ?? ""}` };
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const check = (name: string, text: string) => {
    const file = path.join(dir, name);
    writeFileSync(file, text);
    const run = spawnSync("bash", [SCRIPT, "--check-only", file], { env, encoding: "utf8" });
    return { status: run.status, output: `${run.stdout}${run.stderr}` };
  };

  describe("accepting", () => {
    it("should accept a browser's copy of the preview POST without sending anything", () => {
      const run = check("chrome", CHROME_COPY);

      expect(run.status).toBe(0);
      expect(run.output).toContain("Accepted");
      // The parser's list for this copy holds 17 arguments; the count shows the script's read loop kept every one.
      expect(run.output).toContain("17 arguments");
      expect(run.output).not.toContain(COOKIE_MARKER);
      expect(run.output).not.toContain(BODY_MARKER);
      expect(existsSync(curlCalled)).toBe(false);
    });

    it("should run exactly the copied arguments, with curl's own config file disabled", () => {
      const file = path.join(dir, "argv");
      writeFileSync(file, CHROME_COPY);

      const run = spawnSync("python3", ["-I", PARSER, file], { encoding: "utf8" });

      expect(run.status).toBe(0);
      expect(run.stdout.split("\0").slice(0, -1)).toEqual([
        "curl",
        "--disable",
        PREVIEW,
        "-H",
        "accept: text/html,application/xhtml+xml",
        "-H",
        "content-type: application/x-www-form-urlencoded",
        "-b",
        `admin.sid=s%3A${COOKIE_MARKER}`,
        "-H",
        `origin: ${ADMIN}`,
        "-H",
        `referer: ${ADMIN}/deed-polls/0b6e1c2a-5d1f-4c1e-9a43-2f0d9c8e7b61/emails/name-change-confirmation`,
        "-H",
        'sec-ch-ua: "Chromium";v="141", "Not?A_Brand";v="8"',
        "--data-raw",
        BODY
      ]);
    });

    it("should decode a body the browser wrote in $'…' quoting", () => {
      const file = path.join(dir, "ansi");
      writeFileSync(file, `curl '${PREVIEW}' -X POST --compressed --data-raw $'note=Jo\\'s\\nname\\u00e9'\n`);

      const run = spawnSync("python3", ["-I", PARSER, file], { encoding: "utf8" });

      expect(run.status).toBe(0);
      expect(run.stdout.split("\0").at(-2)).toBe("note=Jo's\nnameé");
    });
  });

  describe("refusing", () => {
    it.each([
      ["a send whose Referer names a preview", `curl -H 'Referer: ${PREVIEW}' '${SEND}' --data-raw '${BODY}'`],
      ["a second URL", `curl '${PREVIEW}' '${SEND}' --data-raw '${BODY}'`],
      ["a second URL given with --url", `curl '${PREVIEW}' --url '${SEND}' --data-raw '${BODY}'`],
      ["a URL outside a Referer or Origin header", `curl '${PREVIEW}' -H 'X-Forward: ${SEND}' --data-raw '${BODY}'`],
      ["a URL in the body", `curl '${PREVIEW}' --data-raw 'next=${SEND}'`],
      ["a method other than POST", `curl '${PREVIEW}' -X GET --data-raw '${BODY}'`],
      ["a config file", `curl '${PREVIEW}' -K other.cfg --data-raw '${BODY}'`],
      ["--config", `curl '${PREVIEW}' --config other.cfg --data-raw '${BODY}'`],
      ["--next", `curl '${PREVIEW}' --data-raw '${BODY}' --next '${SEND}'`],
      ["-:", `curl '${PREVIEW}' --data-raw '${BODY}' -: '${SEND}'`],
      ["an output file", `curl '${PREVIEW}' -o saved.html --data-raw '${BODY}'`],
      ["-O", `curl '${PREVIEW}' -O --data-raw '${BODY}'`],
      ["an upload", `curl '${PREVIEW}' -T secrets.txt --data-raw '${BODY}'`],
      ["--upload-file", `curl '${PREVIEW}' --upload-file secrets.txt --data-raw '${BODY}'`],
      ["a body read from a file", `curl '${PREVIEW}' --data @secrets.txt`],
      ["a -d body read from a file", `curl '${PREVIEW}' -d @secrets.txt`],
      ["a --data-binary body read from a file", `curl '${PREVIEW}' --data-binary @secrets.txt`],
      ["a header read from a file", `curl '${PREVIEW}' -H @headers.txt --data-raw '${BODY}'`],
      ["a Host header", `curl '${PREVIEW}' -H 'Host: other.aat.platform.hmcts.net' --data-raw '${BODY}'`],
      ["a Host header after a line break in another header", `curl '${PREVIEW}' -H $'Accept: */*\\r\\nHost: other' --data-raw '${BODY}'`],
      ["a Host header after a line break in a Referer", `curl '${PREVIEW}' -H $'Referer: ${PREVIEW}\\r\\nHost: other' --data-raw '${BODY}'`],
      ["a header after a line break in a cookie", `curl '${PREVIEW}' -b $'a=b\\r\\nHost: other' --data-raw '${BODY}'`],
      ["an X-Forwarded-Host header", `curl '${PREVIEW}' -H 'X-Forwarded-Host: other' --data-raw '${BODY}'`],
      ["a NUL in a $'…' body", `curl '${PREVIEW}' --data-raw $'a\\x00b'`],
      ["a surrogate $'…' escape", `curl '${PREVIEW}' --data-raw $'a\\uD800b'`],
      ["an escape no browser writes", `curl '${PREVIEW}' --data-raw $'a\\101b'`],
      ["a cookie read from a file", `curl '${PREVIEW}' -b cookies.txt --data-raw '${BODY}'`],
      ["a second command after ;", `curl '${PREVIEW}' --data-raw '${BODY}'; curl '${SEND}'`],
      ["a second command on its own line", `curl '${PREVIEW}' --data-raw '${BODY}'\ncurl '${SEND}'`],
      ["a pipe", `curl '${PREVIEW}' --data-raw '${BODY}' | sh`],
      ["&&", `curl '${PREVIEW}' --data-raw '${BODY}' && curl '${SEND}'`],
      ["command substitution", `curl '${PREVIEW}' --data-raw "$(curl '${SEND}')"`],
      ["a backtick", `curl '${PREVIEW}' --data-raw \`id\``],
      ["a redirection", `curl '${PREVIEW}' --data-raw '${BODY}' > saved.html`],
      ["an unbalanced quote", `curl '${PREVIEW}' --data-raw '${BODY}`],
      ["no form body", `curl '${PREVIEW}' -H 'accept: text/html'`],
      ["a command that is not curl", `wget '${PREVIEW}' --post-data '${BODY}'`],
      ["a preview on another host", `curl 'https://deed-poll-admin.prod.platform.hmcts.net/deed-polls/x/emails/y/preview' --data-raw '${BODY}'`],
      ["a URL that curl would expand into several", `curl '${ADMIN}/deed-polls/{a,b}/emails/y/preview' --data-raw '${BODY}'`]
    ])("should refuse %s, sending nothing and printing no secret", (_reason, command) => {
      const run = check("refused", command.replace(`'${BODY}'`, `'${BODY}' -b 'sid=${COOKIE_MARKER}'`));

      expect(run.status).toBe(3);
      expect(run.output).toContain("Refusing");
      expect(run.output).not.toContain(COOKIE_MARKER);
      expect(run.output).not.toContain(BODY_MARKER);
      expect(existsSync(curlCalled)).toBe(false);
    });
  });
});
