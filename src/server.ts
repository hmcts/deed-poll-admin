import { loadSecrets } from "./secrets.js";

const PORT = process.env.PORT || 3000;

// Secrets first, then the app — and `./app.js` is imported dynamically for exactly that reason. A static
// import is evaluated before any statement here runs, and the first thing that reaches `config` freezes
// the environment it was loaded with for the life of the process. See ./secrets.ts.
await loadSecrets();
// Monitoring next, and before the app for the same reason: Application Insights collects no requests unless it
// starts before express is loaded. See startMonitoring.
const { default: config } = await import("config");
const { startMonitoring } = await import("@hmcts-cft/cloud-native-platform");
startMonitoring(config.get("applicationInsights"));
const { createApp } = await import("./app.js");

async function startServer() {
  const app = await createApp();

  const server = app.listen(PORT, () => {
    console.log(`🌐 Web server running on http://localhost:${PORT}`);
  });

  return () => {
    server.close(() => process.exit(0));

    // force shutdown after 1000 in dev to kill the hmr websocket
    if (process.env.NODE_ENV !== "production") {
      setTimeout(() => process.exit(0), 1000).unref();
    }
  };
}

const shutdown = await startServer();

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
