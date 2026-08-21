# Performance Optimization Guide for HMCTS Monorepo

## Overview
This comprehensive guide provides detailed checklists and best practices for optimizing performance across the Node.js/Express/Prisma/PostgreSQL stack with Yarn workspaces.

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

## 🗄️ Prisma ORM Optimization Checklist

### Query Optimization
- [ ] **Use select to limit fields** - Only fetch needed columns
  ```typescript
  await prisma.user.findMany({
    select: { id: true, name: true } // Don't fetch all fields
  });
  ```
- [ ] **Implement pagination correctly**:
  - Use cursor-based for large datasets (scales better)
  - Use offset for small, filtered datasets
  ```typescript
  // Cursor-based (recommended)
  await prisma.post.findMany({
    take: 20,
    cursor: { id: lastId },
    orderBy: { id: 'asc' }
  });
  ```

### Batch Operations
- [ ] **Use bulk operations** - createMany, updateMany, deleteMany
  ```typescript
  await prisma.user.createMany({
    data: users,
    skipDuplicates: true
  });
  ```
- [ ] **Batch findUnique queries** - Prisma auto-batches in same tick
- [ ] **Use transactions for related operations**
  ```typescript
  const [posts, totalCount] = await prisma.$transaction([
    prisma.post.findMany({ take: 10 }),
    prisma.post.count()
  ]);
  ```

### Avoiding N+1 Problems
- [ ] **Use include wisely** - Fetch related data in single query
  ```typescript
  const users = await prisma.user.findMany({
    include: { posts: true } // Avoid separate queries per user
  });
  ```
- [ ] **Use findMany with IN clause** instead of multiple findUnique

### Connection Management
- [ ] **Configure connection pool** - Set appropriate pool size
  ```typescript
  datasource db {
    provider = "postgresql"
    url      = env("DATABASE_URL") // Add ?connection_limit=10 to URL
  }
  ```
- [ ] **Enable query logging in development** only
  ```typescript
  const prisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query'] : []
  });
  ```
- [ ] **Use Prisma Accelerate** for edge deployments
- [ ] **Enable Prisma Optimize** for query analysis

### Schema Optimization
- [ ] **Add appropriate indexes** - On frequently queried fields
  ```prisma
  model User {
    email String @unique
    name  String
    @@index([name]) // Add index for frequent name searches
  }
  ```
- [ ] **Use composite indexes** for multi-field queries
- [ ] **Implement soft deletes** with indexes on deletedAt

## 🐘 PostgreSQL Optimization Checklist

### Index Optimization
- [ ] **Audit existing indexes** - Remove unused ones
  ```sql
  SELECT schemaname, tablename, indexname, idx_scan
  FROM pg_stat_user_indexes
  WHERE idx_scan = 0;
  ```
- [ ] **Create appropriate index types**:
  - B-tree: Default, for equality and range
  - Hash: Equality only
  - GIN: Full-text search, arrays
  - GiST: Geometric data
- [ ] **Use partial indexes** for filtered queries
  ```sql
  CREATE INDEX idx_active_users ON users(email)
  WHERE deleted_at IS NULL;
  ```
- [ ] **Monitor index bloat** - Reindex if > 30% bloated

### Query Performance
- [ ] **Use EXPLAIN ANALYZE** - Identify slow queries
- [ ] **Enable pg_stat_statements** - Track query statistics
- [ ] **Implement query timeouts** - Prevent long-running queries
  ```sql
  SET statement_timeout = '30s';
  ```
- [ ] **Optimize JOIN operations** - Ensure foreign keys are indexed

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

1. **Add database indexes** - Can improve query speed 10-100x
2. **Implement Redis caching** - Reduce database load
3. **Use PM2 cluster mode** - Utilize all CPU cores
4. **Configure Prisma select** - Reduce data transfer
5. **Set up connection pooling** - Handle more concurrent users
6. **Remove synchronous operations** - Prevent blocking
7. **Optimize middleware order** - Reduce processing overhead
8. **Enable HTTP/2** - Improve loading times

## 🔧 Debugging Slow Performance

When analyzing performance issues:

1. **Profile the application** - Identify bottlenecks
2. **Check database queries** - Use EXPLAIN ANALYZE
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
- [ ] Efficient database queries (no N+1)
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