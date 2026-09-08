# HMCTS Monorepo AI Development Guide

## Core Development Commands

```bash
# Development
yarn dev                        # Start all services concurrently

# Testing
yarn test                       # Run all tests across workspaces
yarn test:e2e                   # Playwright E2E tests
yarn test:coverage              # Generate coverage report

# Code Quality
yarn lint:fix                    # Run Biome linter
yarn format                     # Format code with Biome

# Database Operations
yarn db:migrate                 # Apply migrations  
yarn db:migrate:dev             # Auto apply migrations, add new migrations if necessary
yarn db:generate                # Generate the Prisma client
yarn db:studio                  # Open Prisma Studio
yarn db:drop                    # Drop all tables and reset the database
```

## Project Structure

```
deed-poll-admin/
├── apps/                       # Deployable applications
│   ├── api/                    # REST API server (Express 5.x)
│   ├── crons/                  # Cron jobs
│   ├── postgres/               # Migration runner + Prisma S
│   └── web/                    # Web frontend (Express 5.x + Nunjucks)
├── libs/                       # Modular packages (explicitly registered)
│   ├── cloud-native-platform/  # Cloud Native Platform features
│   ├── express-govuk-starter/  # GOV.UK Frontend integration
│   ├── postgres-prisma/        # Database client (Prisma)
│   ├── simple-router/          # Simple Router features
│   └── [your-module]/          # Your feature modules
│       └── src/
│           └── [domain]/       # Reusable functions consumed by apps
├── e2e-tests/                  # End-to-end tests (Playwright)
├── docs/                       # Documentation and ADRs
├── helm/                       # Helm charts for Kubernetes deployment
└── package.json                # Root configuration
```

## Deployment and sessions

Two facts that are easy to get wrong from the code alone, and expensive to get wrong:

- **CI/CD is the Jenkins CNP pipeline**, `Jenkinsfile_CNP` at the root — `withPipeline("nodejs", "deed-poll",
  "admin")`. There are **no GitHub Actions workflows and none should be added**: `.github/workflows/` was
  deleted in full and `.github/renovate.json` is all that is left under `.github/` that the platform reads.
  The pipeline's test stage runs `yarn test`, `yarn test:coverage` **and** `yarn test:a11y`, and fails on a
  missing script — so do not delete any of the three. See `docs/PIPELINES.md`, which also lists the four
  things still blocking a green deploy.
- **This repo owns no Terraform.** The resource group, Key Vault, App Insights, Redis and Postgres are all in
  [`hmcts/deed-poll-infra`](https://github.com/hmcts/deed-poll-infra). **Do not create an `infrastructure/`
  directory here.**
- **Sessions are in Redis**, via `@hmcts-cft/express-session-redis` and `REDIS_URL`. Postgres/Prisma is case
  data only, until the `deed-poll-api` cutover. Local Redis comes from `docker compose`, so `yarn dev` needs
  Docker running. `libs/express-session-postgres` is still on disk and still a dependency of `apps/web`
  deliberately — it is template-provided and unwiring it invites a re-scaffold conflict — but nothing imports
  it, and a change that puts sessions back on Postgres is a regression, not a refactor.

# Agent instructions

Claude must follow these instructions strictly when contributing code. Rules and conventions are mandatory and must be adhered to without exception. After implementing code, Claude must review it to ensure full compliance with these guidelines.

## Rules

- **TypeScript**: Strict mode enabled, no `any` types
- **Formatting**: Use Biome (`yarn format` before commits)
- **Linting**: Fix all Biome warnings (`yarn lint` or `yarn lint:fix`)
- **Module System**: Use ES modules exclusively - `"type": "module"` is set in package.json
- **Hooks**: If hooks report failures, Claude must investigate and resolve them immediately
- **No CommonJS**: Use `import`/`export`, never `require()`/`module.exports`
- **Pinned dependencies**: Specific versions only (`"express": "5.1.0"`) - except peer dependencies
- **Tests**: Write tests for all new features and bug fixes. Aim for >90% code coverage
- **Colocate tests** with the code they test (e.g. `libs/onboarding/src/routes/index.test.ts` next to `libs/onboarding/src/routes/index.ts`)
- **Encapsulation**: Do not expose internal functions in order to test them

## Conventions

**Module Ordering**:
- consts outside the scope of a function should be at the top (e.g. `const COOKIE_NAME = "cookie_name";`)
- Exported functions should next
- Other functions should be ordered in the order they are used
- Interfaces and types should be at the bottom

**Domain driven folder structure**:
- Group by feature (e.g. `merge-request/`, `data-sources/`)
- Do not group by type (e.g. `models/`, `controllers/`, `services/`)
- Do not create generic folders (e.g. `utils/`, `helpers/`)

**Keep types with the code that uses them**:
- Do not create a types.ts file
- Types should be in the same file as the code that uses them

**Comments**:
- Use comments to explain why code exists, not what it does
- Keep comments minimal and reference documentation or specifications when possible

**Tests**:
- Use descriptive test names that explain the behavior being tested
- Follow Arrange-Act-Assert pattern in tests for clarity
- Write Playwright tests for user journeys in the `e2e-tests/tests/` folder

### Naming Conventions

Follow these strict naming conventions throughout the project:

### 1. Database Tables and Fields
- **MUST be singular and snake_case**: `user`, `case`, `created_at`
- Use Prisma `@@map` and `@map` for aliases
```prisma
model Case {
  id         String   @id @default(cuid())
  caseNumber String   @unique @map("case_number")
  createdAt  DateTime @default(now()) @map("created_at")
  
  @@map("case")
}
```

### 2. TypeScript Variables
- Use camelCase: `userId`, `caseDetails`, `documentId`
- Booleans with `is/has/can`: `isActive`, `hasAccess`, `canEdit`

### 3. Classes and Interfaces
- Use PascalCase: `UserService`, `CaseRepository`
- NO `I` prefix: `UserRepository` not `IUserRepository`

### 4. Constants
- Use SCREAMING_SNAKE_CASE: `MAX_FILE_SIZE`, `DEFAULT_TIMEOUT`

### 5. Files and Directories
- Use kebab-case: `user-service.ts`, `case-management/`

### 6. API Endpoints
- Plural for collections: `/api/cases`, `/api/users`
- Singular for specific: `/api/case/:id`
- Singular for creation: `POST /api/case`

### 7. Package Names
- Use @hmcts scope: `@hmcts/auth`, `@hmcts/case-management`

### 8. Module Ordering
- consts outside the scope of a function should be at the top (e.g. `const COOKIE_NAME = "cookie_name";`)
- Exported functions should next
- Other functions should be ordered in the order they are used
- Interfaces and types should be at the bottom

## Principles

* **YAGNI**: You Aren't Gonna Need It - Don't add speculative functionality or features. Always take the simplest approach. 
* **Functional style** favour a simple functional approach. Don't use a class unless you have shared state
* **KISS**: Keep It Simple, Stupid - Avoid unnecessary complexity. Write code that is easy to understand and maintain.
* **Immutable**: Data should be immutable by default. Use const and avoid mutations to ensure predictable state.
* **Side Effects**: Functions should have no side effects. Avoid modifying external state or relying on mutable data.

## Performance Considerations

- Use database indexes for frequently queried fields
- Implement pagination for list endpoints
- Use incremental data collection in data sources
- Consider caching for expensive computations
- Monitor query performance with Prisma logging

## Security Best Practices

- Validate all user inputs
- Use parameterized queries (Prisma handles this)
- Implement proper authentication/authorization
- Store sensitive data encrypted
- Follow OWASP guidelines for web security

## Debugging Tips

1. **Module Loading**: Check imports in apps/*/src/app.ts
2. **Database Issues**: Enable Prisma logging with `DEBUG=prisma:query`
3. **Run commands from the root directory**: Run yarn test etc from the root directory

## Communication Style

Be direct and straightforward. No cheerleading phrases like "that's absolutely right" or "great question." Tell the user when ideas are flawed, incomplete, or poorly thought through. Focus on practical problems and realistic solutions rather than being overly positive or encouraging.

Challenge assumptions, point out potential issues, and ask questions about implementation, scalability, and real-world viability. If something won't work, say so directly and explain why it has problems rather than just dismissing it.