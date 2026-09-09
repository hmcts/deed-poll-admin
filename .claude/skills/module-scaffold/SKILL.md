---
name: module-scaffold
description: Use when creating a new feature module in libs/. Triggers on "create a module", "add a feature module", "scaffold module for X", or "new library for Y"
---

# Module Scaffolding Skill

This skill automates creation of new feature modules in the `libs/` directory, following the project's conventions and patterns.

## When to Use

- User asks to create a new feature/module
- User wants to add a new library to the monorepo
- User needs a new domain area (e.g., "authentication", "payments", "notifications")

## What a Module Is

Modules in `libs/` contain reusable business logic — services, validation, view models — consumed by `apps/web` via direct imports. Pages, routes, and templates live in the app, not in libs.

**A module cannot store anything.** This repo has no database: every read and write of case data is an HTTP
call to [`hmcts/deed-poll-api`](https://github.com/hmcts/deed-poll-api) through `libs/deed-poll-api-client`.
See `.claude/rules/backend.md` and `docs/plans/02-dal-cutover-to-api.md`.

## Step-by-Step Instructions

### Step 1: Gather Requirements

Ask the user for:
1. **Module name** (kebab-case, e.g., `user-management`)
2. **What domain logic it will contain** (to understand the folder structure)

### Step 2: Create Directory Structure

```bash
mkdir -p libs/{name}/src/{domain}
```

Where `{domain}` is the feature area (e.g., `user`, `payment`, `case`).

### Step 3: Generate Files

1. **libs/{name}/package.json** - from `package.json.template`
   - Replace `{{MODULE_NAME}}` with the kebab-case module name

2. **libs/{name}/tsconfig.json** - from `tsconfig.json.template`
   - No modifications needed

3. **libs/{name}/src/index.ts** - from `index.ts.template`
   - Add exports as domain logic is created

### Step 4: Register Module

#### 4a. Root tsconfig.json

Add to `compilerOptions.paths`:

```json
"@hmcts/{name}": ["libs/{name}/src"]
```

#### 4b. apps/web/package.json

Add the lib as a workspace dependency, or nothing can import it:

```json
"@hmcts/{name}": "workspace:*"
```

### Step 5: If the module needs to persist anything

**It cannot persist it here.** The operation goes into `deed-poll-api` first, then:

1. api's `openapi.json` (refresh it per `libs/deed-poll-api-client/SPEC-PROVENANCE.md`)
2. `libs/deed-poll-api-client/src/api/client.ts` — a plain function returning `ApiResult<T>`, never throwing
3. `libs/deed-poll-api-client/src/mock/server.ts` — the mock is what the tests and `yarn dev` run against
4. `contract.test.ts` pins (1) against (2) in both directions
5. A one-line service function in the new module, going through `callApi`

### Step 6: Verify Setup

```bash
yarn                    # Install dependencies
yarn build              # Verify TypeScript compiles
yarn lint               # Check for lint errors
```

## Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Module directory | kebab-case | `libs/user-management/` |
| Package name | @hmcts/{kebab} | `@hmcts/user-management` |
| Import alias | @hmcts/{kebab} | `@hmcts/user-management` |
| File names | kebab-case | `user-service.ts` |

## Template Files

Templates are located in `.claude/skills/module-scaffold/assets/`:

- `package.json.template` - Package configuration
- `tsconfig.json.template` - TypeScript configuration
- `index.ts.template` - Business logic exports

## Example: Creating a `payment` Module

1. **Create directories:**
   ```bash
   mkdir -p libs/payment/src/payment
   ```

2. **Create package.json** with name `@hmcts/payment`

3. **Create tsconfig.json** extending root

4. **Create src/index.ts** placeholder

5. **Register in root tsconfig.json:**
   ```json
   "@hmcts/payment": ["libs/payment/src"]
   ```

6. **Create domain logic** (e.g., `src/payment/payment-service.ts`, `src/payment/payment-validation.ts`)

7. **Export from index.ts:**
   ```typescript
   export * from "./payment/payment-service.js";
   export * from "./payment/payment-validation.js";
   ```

8. **Use from an app:**
   ```typescript
   // apps/web/src/pages/payment/confirm.ts
   import { processPayment } from "@hmcts/payment";
   ```

9. **Run verification:**
   ```bash
   yarn && yarn build && yarn lint
   ```
