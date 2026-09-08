import { loadSecrets } from "./secrets.js";

const PORT = process.env.API_PORT || 3001;

// Secrets first, then the app — and `./app.js` is imported dynamically for exactly that reason. A static
// import is evaluated before any statement here runs, and the first thing that reaches `config` freezes
// the environment it was loaded with for the life of the process. See ./secrets.ts.
await loadSecrets();
const { createApp } = await import("./app.js");

async function startServer() {
  const app = await createApp();

  const server = app.listen(PORT, () => {
    console.log(`🚀 API server running on http://localhost:${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    console.log(`📊 Readiness check: http://localhost:${PORT}/health/readiness`);
    console.log(`📊 Liveness check: http://localhost:${PORT}/health/liveness`);
  });

  return () => server.close(() => process.exit(0));
}

const shutdown = await startServer();

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
