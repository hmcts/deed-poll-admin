import { createApp } from "./app.js";

const PORT = process.env.API_PORT || 3001;

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
