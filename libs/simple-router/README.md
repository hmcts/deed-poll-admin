# Express File-System Router

A simple, dependency-light file-system router for Express applications, inspired by Next.js routing.

## Features

- ✅ Maps files in directories to Express routes automatically
- ✅ Support for dynamic route parameters using `[param]` syntax
- ✅ Case-insensitive HTTP method exports (GET, post, Delete all work)
- ✅ Support for single handlers or arrays of middleware
- ✅ Multiple mount points with prefixes
- ✅ TypeScript support with strong type inference
- ✅ Zero external dependencies

## Usage

### Basic Setup

```typescript
import { createSimpleRouter } from "@hmcts/express-govuk-starter";
import express from "express";
import path from "path";

const app = express();

// Mount routes from the pages directory
app.use(createSimpleRouter({
  pagesDir: path.join(__dirname, "pages")
}));
```

### Route Module Structure

Create route modules in your pages directory:

```
pages/
  index.js                 → GET /
  about/
    index.js              → GET /about
  posts/
    index.js              → GET /posts
    [id]/
      index.js            → GET /posts/:id
```

### Route Module Exports

Each route module can export HTTP method handlers:

```typescript
// pages/index.js
import type { RequestHandler } from "express";

export const GET: RequestHandler = (req, res) => {
  res.send("Homepage");
};

export const POST: RequestHandler = (req, res) => {
  res.json({ message: "Posted!" });
};

// Case-insensitive - all these work:
export const get = handler;
export const Get = handler;
export const GET = handler;
```

### Middleware Arrays

Support for multiple middleware handlers:

```typescript
// pages/protected/index.js
const authenticate = (req, res, next) => {
  // Check auth
  next();
};

const authorize = (req, res, next) => {
  // Check permissions
  next();
};

export const GET = [authenticate, authorize, (req, res) => {
  res.send("Protected content");
}];
```

### Dynamic Routes

Use `[param]` syntax for dynamic segments:

```typescript
// pages/users/[id]/index.js
export const GET: RequestHandler = (req, res) => {
  const { id } = req.params;
  res.json({ userId: id });
};
```

### Multiple Mount Points

Mount different directories with different prefixes:

```typescript
app.use(createSimpleRouter(
  { pagesDir: path.join(__dirname, "pages") },
  { pagesDir: path.join(__dirname, "admin"), prefix: "/admin" },
  { pagesDir: path.join(__dirname, "api"), prefix: "/api" }
));
```

## API Reference

### `createSimpleRouter(...mounts: MountSpec[]): Router`

Creates an Express router with file-system based routing.

#### MountSpec Options

- `pagesDir` (required): Directory containing route modules
- `prefix`: URL prefix for all routes from this mount (default: "")
- `trailingSlash`: How to handle trailing slashes ("off" | "enforce" | "redirect")

### Supported HTTP Methods

- `GET`, `POST`, `PUT`, `PATCH`, `DELETE` (or `DEL`), `HEAD`, `OPTIONS`, `TRACE`, `CONNECT`, `ALL`

## Rules and Conventions

1. Only `.js` files named `index.js` are considered as route modules
2. Files/folders starting with `.` are ignored
3. Invalid route segments (containing special characters except `-` and `_`) will throw errors
4. Route conflicts (same path + method from different files) throw startup errors
5. Duplicate method exports with different casings throw errors
6. Handler functions must have 2-4 parameters to be valid

## Route Precedence

Routes are sorted by specificity:
1. Static routes before dynamic routes
2. Fewer parameters before more parameters
3. Shorter paths before longer paths
4. Static segments prioritized over dynamic at the same position

Example order:
- `/posts` (static)
- `/posts/new` (static)
- `/posts/:id` (dynamic)
- `/posts/:id/edit` (dynamic, longer)