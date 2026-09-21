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

**Mock the adapter, not `fetch`.** There is no database to mock: a domain service calls
`@hmcts/deed-poll-api-client`, so that package is the seam. Return its `ApiResult<T>` union — `{ ok: true,
data }` or `{ ok: false, error }` — because the thing worth pinning is that a classified failure becomes
the right domain error.

```typescript
// service.test.ts (co-located with service.ts)
import { getNote, patchNote } from '@hmcts/deed-poll-api-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '../errors.js';
import { findNote, updateNote } from './service.js';

// Spread the original so only the operations under test are stubbed: the client also publishes the enum
// member arrays the view models build on, and replacing the whole module takes those with it.
vi.mock('@hmcts/deed-poll-api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@hmcts/deed-poll-api-client')>()),
  getNote: vi.fn(),
  patchNote: vi.fn()
}));

const CALLER = { accessToken: 'caseworker-token' };
const ok = <T>(data: T) => ({ ok: true as const, data });

describe('notes/service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DEED_POLL_API_URL = 'http://api.test';
  });

  describe('findNote', () => {
    it('should ask for the note under its own case', async () => {
      vi.mocked(getNote).mockResolvedValue(ok({ id: 'note-9' }) as never);

      const result = await findNote('case-1', 'note-9', CALLER);

      expect(result).toEqual({ id: 'note-9' });
      expect(getNote).toHaveBeenCalledWith('case-1', 'note-9', expect.anything());
    });

    it('should throw NotFoundError when api answers 404', async () => {
      vi.mocked(getNote).mockResolvedValue({ ok: false, error: { kind: 'not-found', status: 404, message: 'Note note-9 not found' } } as never);

      await expect(findNote('other-case', 'note-9', CALLER)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe('updateNote', () => {
    it('should send the text and no author, because api stamps the audit names from the token', async () => {
      vi.mocked(patchNote).mockResolvedValue(ok({ id: 'note-1', note: 'Amended' }) as never);

      await updateNote('case-1', 'note-1', { note: 'Amended' }, CALLER);

      expect(patchNote).toHaveBeenCalledWith('case-1', 'note-1', { note: 'Amended' }, expect.anything());
    });
  });
});
```

The adapter itself is tested a layer down and differently: `libs/deed-poll-api-client/src/api/client.test.ts`
runs against the in-memory mock, and `contract.test.ts` fails if the adapter and `openapi.json` disagree.
Do not stub `fetch` to test an adapter function — the mock is the contract.

## Template Test Pattern

A `*.njk.test.ts` drives the real handler, then renders the model it passed to `res.render`. **Spread the
content pair first and the handler's own values over it**, because that is
`renderInterceptorMiddleware`'s order (`libs/express-govuk-starter/src/i18n/locale-middleware.ts` merges
`...selectedContent` then `...otherContent`):

```typescript
const html = (model: Record<string, unknown>): string =>
  environment.render("deed-polls/referral-detail.njk", { ...(model.en as object), ...model });
```

The other way round is a trap rather than a preference. A handler that **resolves a sentence itself** from
the same `en` the template also receives — `directionActioned`, `gazetteAnswer`, `withdrawRefused` — has the
resolved value win in the app, so an empty one means "no banner". Spread `en` last and the unresolved entry
wins instead: every conditional the handler owns renders unconditionally in the test while behaving
correctly in the app, so the test passes and pins nothing. All eleven template tests use the order above;
a new one that does not will mislead the first time its handler resolves a string named like its `en` key.

## Test Naming Conventions

- Use descriptive names that explain the behavior being tested
- Format: `should [expected behavior] when [condition]`
- Group related tests with nested `describe` blocks

## E2E Testing

E2E tests live in `e2e-tests/` and use Playwright. 

Write E2E tests when adding a new page or user journey. Test the happy path only.

For detailed E2E testing patterns and guidelines, see `.claude/rules/e2e-testing.md`.
