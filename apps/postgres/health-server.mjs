import http from "node:http";
import httpProxy from "http-proxy";

const proxy = httpProxy.createProxyServer({ target: "http://localhost:5556" });

// Without this, a failed proxy attempt emits an unhandled 'error' event and crashes the process.
//
// The error is logged rather than discarded, which is also why `err` is named at all: a bare 502
// with nothing on stdout leaves whoever ran `yarn db:studio` unable to tell whether Studio failed to
// start, died, or is listening elsewhere. Logged whole rather than as `err.message`, which is empty
// for the ECONNREFUSED AggregateError this raises most of the time.
//
// `res` is safely a ServerResponse only because this server proxies web requests and never calls
// `proxy.ws`. If a websocket upgrade is ever forwarded, http-proxy emits ('error', err, req, socket)
// with a Socket that has no writeHead, and this would throw inside the error handler — the very
// crash it exists to prevent. Guard it at that point, not speculatively now.
proxy.on("error", (err, _req, res) => {
  console.error("Prisma Studio proxy error:", err);
  res.writeHead(502, { "Content-Type": "text/plain" });
  res.end("Prisma Studio unavailable");
});

const server = http.createServer((req, res) => {
  if (req.url === "/health/liveness" || req.url === "/health/readiness") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK");
  } else {
    proxy.web(req, res);
  }
});

server.listen(5555, "0.0.0.0", () => {
  console.log("Health proxy listening on port 5555, forwarding to Prisma Studio on 5556.");
});
