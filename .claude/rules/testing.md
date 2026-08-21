# Testing Strategy

- **Unit/Integration Tests**: Vitest, co-located with source (`*.test.ts`)
- **E2E Tests**: Playwright in `e2e-tests/`
- **Accessibility Tests**: Axe-core with Playwright
- **Test Scripts**: All packages must use `"test": "vitest run"`
- **Coverage**: Aim for >80% on business logic

## Arrange-Act-Assert Pattern

All tests must follow the AAA pattern for clarity and consistency:

1. **Arrange**: Set up test data, mocks, and preconditions
2. **Act**: Execute the code under test
3. **Assert**: Verify the expected outcome

## Unit Test File Pattern

```typescript
// user-service.test.ts (co-located with user-service.ts)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@hmcts/postgres-prisma';
import { findUserById, createUser } from './user-service';

vi.mock('@hmcts/postgres-prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn()
    }
  }
}));

describe('UserService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('findUserById', () => {
    it('should return user when found', async () => {
      const mockUser = { id: '123', email: 'test@example.com', name: 'Test User' };
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser);

      const result = await findUserById('123');

      expect(result).toEqual(mockUser);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: '123' } });
    });

    it('should return null when user not found', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

      const result = await findUserById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('createUser', () => {
    it('should create and return new user', async () => {
      const userData = { email: 'new@example.com', name: 'New User' };
      const createdUser = { id: '456', ...userData };
      vi.mocked(prisma.user.create).mockResolvedValue(createdUser);

      const result = await createUser(userData);

      expect(result).toEqual(createdUser);
      expect(prisma.user.create).toHaveBeenCalledWith({ data: userData });
    });
  });
});
```

## Test Naming Conventions

- Use descriptive names that explain the behavior being tested
- Format: `should [expected behavior] when [condition]`
- Group related tests with nested `describe` blocks

## E2E Testing

E2E tests live in `e2e-tests/` and use Playwright. 

Write E2E tests when adding a new page or user journey. Test the happy path only.

For detailed E2E testing patterns and guidelines, see `.claude/rules/e2e-testing.md`.
