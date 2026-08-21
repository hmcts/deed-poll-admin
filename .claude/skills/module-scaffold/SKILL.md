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

Modules in `libs/` contain reusable business logic — services, validation, navigation, queries — consumed by `apps/web` and `apps/api` via direct imports. Pages, routes, and templates live in the apps, not in libs.

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

### Step 5: Verify Setup

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
