# @hmcts/postgres-prisma

Database layer library using Prisma ORM with PostgreSQL. Provides schema collation and Prisma client exports.

## Schema Collation System

This package provides schema collation that combines Prisma schema fragments from multiple modules into a single schema file.

### How it works

1. **Base schema**: `apps/postgres/prisma/base.prisma` contains only the generator and datasource configuration
2. **Module fragments**: Each module can have Prisma schema fragments in `libs/*/prisma/*.prisma`
3. **Collation**: The `yarn collate` command combines the base schema with all fragments into `dist/schema.prisma`
4. **Migrations**: Managed by the `apps/postgres` application (see apps/postgres for migration commands)

### Adding schema to a module

Create a Prisma fragment in your module:

```prisma
// libs/my-module/prisma/models.prisma
model MyModel {
  id        String   @id @default(cuid())
  name      String
  createdAt DateTime @default(now()) @map("created_at")

  @@map("my_model")
}

enum MyEnum {
  OPTION_ONE
  OPTION_TWO
}
```

The collation script will automatically discover and include your models and enums.

### Commands

```bash
# Generate Prisma Client (runs collation first)
yarn workspace @hmcts/postgres-prisma generate

# Just collate schemas
yarn workspace @hmcts/postgres-prisma collate
```

### Generated Client

The Prisma client is generated to `generated/prisma/` (gitignored). This uses the Prisma 7 driver adapter pattern with `@prisma/adapter-pg` for PostgreSQL connections.

### Migration Commands

Migrations are managed by the `apps/postgres` application. See `apps/postgres` for migration workflows.

### Important Notes

- The `dist/` directory is gitignored - it's generated on demand
- Models can reference each other across modules (Prisma will validate relationships)
- Enums are shared globally across all models
- Each fragment should be valid Prisma syntax but doesn't need to be a complete schema