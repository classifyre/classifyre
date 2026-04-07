# E2E Tests

Playwright end-to-end tests for Classifyre. Tests run against any live instance — local dev, staging, or production.

## Prerequisites

- Node.js ≥ 20 (or bun)
- Playwright browsers installed (one-time setup)

```bash
cd apps/e2e
npx playwright install chromium
```

## Configuration

Copy the example below into `apps/e2e/.env` (this file is gitignored):

```env
# URL of the Classifyre web app to test against
BASE_URL=http://localhost:3000

# URL of the Classifyre API
API_BASE_URL=http://localhost:8000

# PostgreSQL source used in connection tests
PG_HOST=your-db-host.example.com
PG_PORT=5432
PG_USERNAME=your_username
PG_DATABASE=postgres
PG_PASSWORD=your_password
```

### Pointing to a different instance

| Variable | Purpose | Example |
|---|---|---|
| `BASE_URL` | Web app URL | `https://staging.classifyre.com` |
| `API_BASE_URL` | API URL | `https://api.staging.classifyre.com` |
| `PG_HOST` | PostgreSQL host for test source | `db.example.com` |
| `PG_PORT` | PostgreSQL port | `5432` |
| `PG_USERNAME` | PostgreSQL username | `postgres.projectid` |
| `PG_PASSWORD` | PostgreSQL password | `secret` |
| `PG_DATABASE` | PostgreSQL database name | `postgres` |

Variables can also be passed inline without a `.env` file:

```bash
BASE_URL=https://staging.classifyre.com API_BASE_URL=https://api.staging.classifyre.com npx playwright test
```

## Running tests

```bash
cd apps/e2e

# Run all tests (headless)
npx playwright test
# or via turbo (from monorepo root)
bun --filter @classifyre/e2e test:e2e

# Run a single test file
npx playwright test tests/postgresql-source.spec.ts

# Run a specific test by name
npx playwright test --grep "successful connection"

# Run with browser visible
npx playwright test --headed

# Open interactive UI mode
npx playwright test --ui

# Show the last HTML report
npx playwright show-report
```

From the monorepo root (runs the turbo `test:e2e` task):

```bash
bun --filter @classifyre/e2e test:e2e
```

## Test suites

### `postgresql-source.spec.ts`

Tests the full PostgreSQL source lifecycle:

1. **Happy-path connection** — creates a source with a nightly cron schedule and verifies the connection test succeeds.
2. **Wrong password** — verifies that an auth failure surfaces a meaningful error message (not a generic one).
3. **PII scan + delete** — enables the PII detector, runs a scan, verifies findings appear, then deletes the source and confirms assets are cleaned up.

## CI

Set the same environment variables as secrets/env vars in your CI environment. The config automatically enables 1 retry and disables the HTML reporter from opening a browser.

```yaml
# Example GitHub Actions step
- name: Run E2E tests
  env:
    BASE_URL: ${{ vars.STAGING_URL }}
    API_BASE_URL: ${{ vars.STAGING_API_URL }}
    PG_HOST: ${{ secrets.PG_HOST }}
    PG_PASSWORD: ${{ secrets.PG_PASSWORD }}
    PG_USERNAME: ${{ secrets.PG_USERNAME }}
    PG_DATABASE: postgres
    PG_PORT: 5432
    CI: true
  run: npx playwright test
  working-directory: apps/e2e
```
