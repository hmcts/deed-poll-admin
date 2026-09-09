# Performance Optimization Guide for HMCTS Monorepo

## Overview
This comprehensive guide provides detailed checklists and best practices for optimizing performance across the Node.js/Express/Nunjucks stack with Yarn workspaces. **This repo owns no database** — the data half of performance here is about calls to `deed-poll-api`, not about queries.

## Quick Analysis Command
To quickly analyze code for performance issues, provide the specific file or module:

## 🚀 Node.js & Express Optimization Checklist

### Compression & Data Transfer
- [ ] **Enable Gzip compression** - Use `compression` middleware
  ```typescript
  import compression from 'compression';
  app.use(compression({ threshold: 1024 })); // Compress responses > 1KB
  ```
- [ ] **Implement Brotli compression** for static assets (better than gzip)
- [ ] **Use HTTP/2** - Configure via Nginx reverse proxy
- [ ] **Optimize response size** - Send only required fields in API responses

### Middleware Optimization
- [ ] **Audit middleware stack** - Remove unused middleware
- [ ] **Order middleware correctly**:
  1. Lightweight middleware first (e.g., helmet, cors)
  2. Static file serving
  3. Body parsers
  4. Session handling
  5. Authentication
  6. Route handlers
- [ ] **Use route-specific middleware** - Don't apply globally if not needed
- [ ] **Implement conditional middleware loading**
  ```typescript
  if (process.env.NODE_ENV !== 'production') {
    app.use(morgan('dev'));
  }
  ```

### Asynchronous Code Patterns
- [ ] **No synchronous operations** - Replace all sync methods:
  - ❌ `fs.readFileSync()` → ✅ `fs.promises.readFile()`
  - ❌ `crypto.pbkdf2Sync()` → ✅ `crypto.pbkdf2()` with promisify
- [ ] **Use async/await consistently** - Avoid callback hell
- [ ] **Implement proper error handling** - Use try/catch blocks
- [ ] **Use streams for large data** - Process data in chunks
  ```typescript
  import { pipeline } from 'stream/promises';
  await pipeline(readStream, transformStream, writeStream);
  ```

### Caching Strategies
- [ ] **In-memory caching** - Use Redis for session and frequently accessed data
- [ ] **HTTP caching headers** - Set appropriate Cache-Control headers
- [ ] **Static asset caching** - Use CDN or Nginx for static files
- [ ] **API response caching** - Cache expensive computations
  ```typescript
  const cache = new Map();
  const CACHE_TTL = 60000; // 1 minute
  ```

## 🌐 deed-poll-api Call Optimization Checklist

**There is no database and no ORM in this repo.** Prisma, the pg pool and the migrations were deleted; every
read and write of case data is an HTTP call to `deed-poll-api` through `libs/deed-poll-api-client`. See
`docs/plans/02-dal-cutover-to-api.md`. So the questions worth asking are about round trips, not queries.

### Round trips
- [ ] **One call per thing a page needs, and no more.** A case's notes, witnesses and documents all arrive
      inside `GET /caseworker/cases/{id}` — re-reading any of them is a second round trip for an answer
      already held
- [ ] **No scoping pre-read.** api answers 404 for a note that is not under the case in the path, so a read
      whose only purpose is to check the parent is a call that learns nothing
- [ ] **Parallelise independent calls.** A page needing a case and the document types should `Promise.all`
      them rather than awaiting in sequence — see `deed-polls/[id]/documents/upload.ts`
- [ ] **Nothing recomputed that api publishes.** `daysReceivedToEnroled`, `daysReceivedToReturned` and the
      reference number are api's; a second implementation is a correctness bug as well as wasted work

### Let api do the work
- [ ] **Ask api to filter, sort and page.** It resolves a filter KEY — `?filter=open` — so fetching a list
      and narrowing it here moves a whole table over the wire to discard most of it
- [ ] **Do not restate api's rules to avoid a call.** The exception is the local matrices that exist on
      purpose (`upload-policy.ts`, `deed-poll-validation.ts`); both ends carrying a rule is deliberate

### Failing fast
- [ ] **Every call carries an `AbortSignal.timeout`** (`DEED_POLL_API_TIMEOUT_MS`, default 10s), so a slow
      api degrades a page rather than hanging it. Nothing should reach `fetch` without one
- [ ] **The readiness probe uses its own 2s budget** and deliberately does not inherit the application
      timeout — a probe slower than Kubernetes' patience reports nothing at all
- [ ] **Reject before the wire where the error is better.** `upload-policy.ts` refuses an over-large file
      locally rather than paying 25MB of upload to be told 400
- [ ] **A streaming download's timeout covers the answer, not the body.** Bounding the whole exchange
      truncates a large file after the response has already gone out as a 200

### Caching
- [ ] **Cache only what is genuinely static.** The document-type reference list is the one plausible
      candidate; a case is not, and a stale case on a caseworker's screen is worse than a slow one
- [ ] **Never cache a response across callers.** api derives the audit author and the admin flag from the
      caller's token, so a shared cache would serve one caseworker another's authorisation

## 📦 Yarn Workspaces & Monorepo Optimization

### Dependency Management
- [ ] **Hoist common dependencies** - Reduce duplication
  ```json
  {
    "workspaces": {
      "packages": ["apps/*", "libs/*"],
      "nohoist": ["**/react-native", "**/react-native/**"]
    }
  }
  ```
- [ ] **Use workspace protocol** - For internal dependencies
  ```json
  {
    "dependencies": {
      "@hmcts/auth": "workspace:*"
    }
  }
  ```
- [ ] **Dedupe dependencies regularly** - `yarn dedupe`

### Build Optimization
- [ ] **Implement selective builds** - Only build changed packages
  ```bash
  yarn workspaces focus @hmcts/api --production
  ```
- [ ] **Use Turborepo or Nx** for build caching
- [ ] **Parallelize builds** - Configure concurrent builds
- [ ] **Implement incremental TypeScript builds**
  ```json
  {
    "compilerOptions": {
      "incremental": true,
      "tsBuildInfoFile": ".tsbuildinfo"
    }
  }
  ```

## 🔍 General Performance Monitoring

### Application Monitoring
- [ ] **Implement APM** - Use tools like New Relic, DataDog, or Raygun
- [ ] **Track key metrics**:
  - Response time (p50, p95, p99)
  - Throughput (requests/second)
  - Error rate
  - CPU and memory usage
- [ ] **Set up alerting** - For performance degradation
- [ ] **Implement custom metrics** - Business-specific KPIs

### Profiling & Debugging
- [ ] **Use Node.js built-in profiler**
  ```bash
  node --inspect-brk dist/index.js
  ```
- [ ] **Memory leak detection** - Use heapdump and Chrome DevTools
- [ ] **CPU profiling** - Identify hot paths with clinic.js
- [ ] **Trace slow requests** - Implement request ID tracking

## 🎯 Quick Wins (Implement First)

1. **Collapse duplicate api calls** - one `GET /caseworker/cases/{id}` already carries the children
2. **Parallelise independent api calls** - `Promise.all`, not sequential awaits
3. **Push filtering and paging to api** - it resolves a filter key
4. **Remove synchronous operations** - prevent blocking
5. **Optimize middleware order** - reduce processing overhead
6. **Enable HTTP/2** - improve loading times

## 🔧 Debugging Slow Performance

When analyzing performance issues:

1. **Profile the application** - Identify bottlenecks
2. **Count the api calls a page makes** - a repeated read is the commonest cause here
3. **Review network calls** - Look for waterfall effects
4. **Analyze memory usage** - Check for leaks
5. **Monitor CPU usage** - Identify hot paths
6. **Review logs** - Look for errors and warnings
7. **Load test** - Simulate production traffic
8. **Compare metrics** - Before and after changes

## 📝 Code Review Checklist

Before merging performance-related changes:

- [ ] No synchronous I/O operations
- [ ] Proper error handling with try/catch
- [ ] No repeated api call for data an earlier call already carried
- [ ] Appropriate caching implemented
- [ ] Memory leaks prevented (cleanup listeners/timers)
- [ ] Connection pools properly configured
- [ ] Indexes added for new query patterns
- [ ] Load tested with realistic data
- [ ] Monitoring/metrics added
- [ ] Documentation updated

## 🏃 Runtime Optimization Tips

### Memory Management
- [ ] **Avoid memory leaks** - Clean up event listeners, timers, closures
- [ ] **Use WeakMap/WeakSet** - For object references that can be garbage collected
- [ ] **Monitor heap usage** - Set --max-old-space-size appropriately
- [ ] **Stream large datasets** - Don't load everything into memory

### CPU Optimization
- [ ] **Avoid blocking the event loop** - Move heavy computation to workers
- [ ] **Use native methods** - They're optimized in C++
- [ ] **Minimize JSON parsing** - Cache parsed results
- [ ] **Optimize loops** - Use for loops over array methods for performance-critical code

### Network Optimization
- [ ] **Use keep-alive connections** - Reduce TCP handshake overhead
- [ ] **Implement request batching** - Combine multiple API calls
- [ ] **Use WebSockets** - For real-time bidirectional communication
- [ ] **Optimize DNS lookups** - Use DNS caching

## 🔒 Security & Performance Balance

- [ ] **Rate limiting** - Prevent abuse without impacting legitimate users
- [ ] **Input validation** - Fast-fail on invalid input
- [ ] **Authentication caching** - Cache JWT validation results
- [ ] **HTTPS optimization** - Use session resumption and OCSP stapling

## 📈 Continuous Improvement

1. **Establish baseline metrics** - Know your current performance
2. **Set performance budgets** - Define acceptable thresholds
3. **Automate performance testing** - Include in CI/CD pipeline
4. **Regular performance audits** - Monthly or quarterly reviews
5. **Track improvements** - Document what worked and what didn't