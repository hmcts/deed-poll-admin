import http from "node:http";
import httpProxy from "http-proxy";

// Prisma Studio is an unauthenticated read/write browser over every table, and this pod's chart gives it
// an ingress host (`apps/postgres/helm/values.yaml`) alongside `deedpoll_deedpoll`, `deedpoll_witness` and
// `onboarding_submission` — applicant names, dates of birth and addresses. Nothing in front of it checks a
// user, in a repo where every other surface goes through IDAM. So it is opt-in and off by default: the
// deployed container migrates and answers probes, and Studio is something you turn on knowingly for one
// environment rather than something every deploy publishes.
//
// Locally, `yarn db:studio` does not come through here at all — it runs the `studio` script in
// apps/postgres/package.json directly.
const isStudioEnabled = process.env.ENABLE_PRISMA_STUDIO === "true";

const proxy = isStudioEnabled ? httpProxy.createProxyServer({ target: "http://localhost:5556" }) : null;

// Without this, a failed proxy attempt emits an unhandled 'error' event and crashes the process.
//
// The error is logged rather than discarded, which is also why `err` is named at all: a bare 502
// with nothing on stdout leaves whoever enabled Studio unable to tell whether it failed to
// start, died, or is listening elsewhere. Logged whole rather than as `err.message`, which is empty
// for the ECONNREFUSED AggregateError this raises most of the time.
//
// `res` is safely a ServerResponse only because this server proxies web requests and never calls
// `proxy.ws`. If a websocket upgrade is ever forwarded, http-proxy emits ('error', err, req, socket)
// with a Socket that has no writeHead, and this would throw inside the error handler — the very
// crash it exists to prevent. Guard it at that point, not speculatively now.
proxy?.on("error", (err, _req, res) => {
  console.error("Prisma Studio proxy error:", err);
  res.writeHead(502, { "Content-Type": "text/plain" });
  res.end("Prisma Studio unavailable");
});

const server = http.createServer((req, res) => {
  if (req.url === "/health/liveness" || req.url === "/health/readiness") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK");
  } else if (proxy) {
    proxy.web(req, res);
  } else {
    // 404 rather than proxying into a closed port: the proxy error path would log a full
    // AggregateError per request, and this host is an ingress that gets scanned.
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
});

server.listen(5555, "0.0.0.0", () => {
  console.log(
    isStudioEnabled
      ? "Health proxy listening on port 5555, forwarding to Prisma Studio on 5556."
      : "Health proxy listening on port 5555. Prisma Studio is disabled (set ENABLE_PRISMA_STUDIO=true to enable)."
  );
});
