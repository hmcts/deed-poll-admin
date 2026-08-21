import http from "node:http";
import httpProxy from "http-proxy";

const proxy = httpProxy.createProxyServer({ target: "http://localhost:5556" });

// Without this, a failed proxy attempt emits an unhandled 'error' event and crashes the process
proxy.on("error", (err, req, res) => {
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
