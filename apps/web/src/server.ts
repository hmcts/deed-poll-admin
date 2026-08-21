import { createApp } from "./app.js";

const PORT = process.env.PORT || 3000;

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
