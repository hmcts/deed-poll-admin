# PostgreSQL session store

This private workspace library is retained from the starter template. The admin application uses Redis for sessions.

Initialize the store during application startup, before accepting requests:

```ts
const store = await PostgresStore.create({ pool });
app.use(session({ secret, store, resave: false, saveUninitialized: false }));
```

Alternatively, await the middleware factory:

```ts
app.use(await expressSessionPostgres({ pgConnection: pool, sessionOptions: { secret } }));
```

`PostgresStore.create` replaces direct construction with `new PostgresStore`. Both factories reject if connecting to PostgreSQL, creating the table, or creating its expiry index fails. Callers must await initialization and handle startup failures before starting the HTTP server. An acquired database client is released on either success or failure.

Expiry cleanup starts only after successful initialization and runs every 15 minutes by default. Set `cleanupInterval: 0` to disable it, or supply an interval in milliseconds. When managing a store directly, call `store.stopCleanup()` during shutdown; the caller owns the connection pool and its shutdown.
