# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is **Classifyre**, a monorepo-based metadata ingestion system for unstructured data sources (Confluence, Jira, SharePoint, etc.). The project uses a **plugin architecture** pattern with three main applications:

1. **Web App** (`apps/web`) - Next.js 16 frontend with React 19
2. **API** (`apps/api`) - NestJS backend with Fastify adapter
3. **CLI** (`apps/cli`) - Python CLI using `uv` for dependency management

Shared code lives in workspace packages (`packages/*`), including JSON schemas and UI components.

## Core Architecture

### Monorepo Structure

- **Package Manager**: bun with turborepo
- **Build System**: Turborepo for coordinated builds across workspace
- **Node Version**: >=20 (specified in package.json engines)
- **Python Version**: >=3.12 (CLI only)

### Plugin System (Future)

The project is designed for a **microkernel pattern** where:

- Core system provides minimal, stable interfaces
- Plugins (connectors, processors, alerts) extend functionality
- Zero coupling between core and plugin implementations
- Plugins self-register via decorator pattern

See `docs/architecture/PLUGIN_SYSTEM.md` for complete plugin interface definitions.

### Key Architectural Decisions

- **Single Database**: PostgreSQL for all data (assets, jobs, secrets with pgcrypto)
- **Job Queue**: PostgreSQL-based (LISTEN/NOTIFY or polling pattern, not Redis)
- **Processing**: Kubernetes Jobs for ephemeral CPU/GPU workers
- **Frontend**: Static export from Next.js (no Node.js runtime needed)

## Development Commands

### Root Level (Turborepo)

```bash
# Build all apps and packages
bun build

# Run all apps in dev mode
bun dev

# Lint all workspaces
bun lint

# Format all code
bun format
```

### Web App (Next.js)

```bash
cd apps/web

# Development server with Turbopack
bun dev

# Production build
bun build

# Start production server
bun start

# Lint with auto-fix
bun lint:fix

# Type check
bun typecheck
```

### API (NestJS)

```bash
cd apps/api

# Development with watch mode
bun dev

# Production build
bun build

# Start production
bun start

# Run tests
bun test
bun test:watch
bun test:cov

# E2E tests
bun test:e2e

# Type check
bun check-types

# Lint
bun lint
```

### CLI (Python)

```bash
cd apps/cli

# Run CLI (installs deps automatically)
bun dev
# or directly:
uv run main.py

# Sync dependencies
bun build  # runs uv sync

# Lint and format
bun lint  # runs ruff check + format

# Type check
bun check-types  # runs mypy
```

### Testing Individual Components

```bash
# Test a single app from root
bun --filter api test
bun --filter web typecheck

# Run specific test file (API)
cd apps/api
bun test -- path/to/test.spec.ts
```

## Important Architectural Details

### TypeScript Configuration

- **Root tsconfig**: Base configuration for all TypeScript projects
- **App-specific**: Each app extends root config with custom paths
- **Strict Mode**: Enabled for type safety
- Workspace packages are referenced via path aliases (e.g., `@workspace/schemas`)

### Workspace Dependencies

The `@workspace/*` prefix indicates internal dependencies:

- `@workspace/schemas` - Shared JSON schemas (Jira, SharePoint)
- `@workspace/ui` - Shared UI components (shadcn/ui based)
- `@workspace/eslint-config` - Shared ESLint rules
- `@workspace/typescript-config` - Shared TypeScript configs

When adding components to the web app, use:

```bash
bun dlx shadcn@latest add button -c apps/web
```

This places components in `packages/ui/src/components` for reuse.

### API Server Details

- **Framework**: NestJS with Fastify (not Express)
- **Port**: 8000 (configurable via `PORT` env var)
- **Listen**: Binds to `0.0.0.0` for Docker compatibility
- **Startup**: Use `void bootstrap()` pattern for top-level async

### CLI Implementation

- **Dependency Manager**: `uv` (fast Python package installer)
- **Linter**: `ruff` with 100-char line length, Python 3.12 target
- **Type Checker**: `mypy` in strict mode
- **Python Package**: Uses `pyproject.toml` with `[tool.uv]` configuration
- **Schema Integration**: Imports from `../../packages/schemas` as editable install

### Database Strategy (from architecture docs)

When implementing database features:

- Use PostgreSQL 16 with extensions: `uuid-ossp`, `pgcrypto`, `pg_trgm`, `btree_gin`
- Store credentials encrypted with `pgcrypto` (no separate Vault in MVP)
- Use JSONB for flexible metadata with GIN indexes
- Asset identity: Hash-based deterministic UUIDs (`uuid5`) for idempotent ingestion
- Job queue: Poll with `FOR UPDATE SKIP LOCKED` or use `LISTEN/NOTIFY`

### Deployment Context

The extensive docs in `docs/architecture/` describe multiple deployment modes:

1. **All-in-One Docker** - Single container for dev/demo (NOT production)
2. **Kubernetes** - Production deployment with separated components
3. **Docker Compose** - Intermediate testing environment

All-in-one uses `s6-overlay` for process supervision (PostgreSQL, FastAPI, Orchestrator, Worker, Caddy).

## Code Style and Patterns

### Frontend (Next.js/React)

- Use React 19 features (no legacy patterns)
- Turbopack for fast dev builds
- Static export for production (`next build` generates static files)
- Import UI components from `@workspace/ui/components/*`
- Use `next-themes` for dark mode

### Backend (NestJS)

- Use Fastify adapter, not Express
- Controllers return domain objects (NestJS handles serialization)
- Use dependency injection via constructors
- Write unit tests alongside implementation (`.spec.ts` files)
- Use async/await, not callbacks

### CLI (Python)

- All functions must have type annotations (`mypy` strict mode)
- Use ruff for consistent formatting
- Prefer async operations for I/O-bound tasks
- Follow naming conventions: snake_case for functions/variables

### Shared Schemas

- JSON schemas in `packages/schemas/src/schemas/*/schema.json`
- Example data in `schemas/*/examples/*.json`
- Both TypeScript and Python can import these (cross-language validation)

## Plugin Development (When Implemented)

To create a new connector plugin:

1. Create directory: `plugins/connectors/<name>/`
2. Implement `BaseConnector` interface from `core/api/connector.py`
3. Use `@register_plugin(plugin_type="connector", name="<name>")` decorator
4. Add `requirements.txt` for plugin-specific dependencies
5. Return `Asset` objects with deterministic `unique_id`

Plugin interfaces are defined in:

- `core/api/connector.py` - Data source connectors
- `core/api/processor.py` - NLP/ML processors
- `core/api/alert.py` - Data quality alerts

## Build and CI/CD

### Turbo Pipeline

The `turbo.json` defines task dependencies:

- `build` depends on `^build` (topological build order)
- Outputs cached: `.next/**`, `dist/**`, `.venv/**`
- `dev` is not cached (persistent mode)

### Docker Context

When building Docker images:

- Multi-stage builds minimize image size
- Frontend builds to static files (no Node.js runtime)
- Backend uses Python 3.11 slim base
- See `docs/architecture/BUILD.md` for complete build process

## Key Documentation Files

- `base-plan.md` - Original architecture vision and competitor analysis
- `README.md` - shadcn/ui monorepo template usage
- `docs/architecture/ARCHITECTURE.md` - System architecture overview
- `docs/architecture/PLUGIN_SYSTEM.md` - Plugin interface specifications
- `docs/architecture/BUILD.md` - Docker build and deployment guide
- `docs/architecture/ALL-IN-ONE-SUMMARY.md` - All-in-one Docker architecture

## Working in This Codebase

### Adding a New Feature

1. Determine which app(s) need changes (web/api/cli)
2. If shared logic, consider adding to `packages/schemas` or new workspace package
3. Update type definitions in TypeScript or add to Python type stubs
4. Write tests alongside implementation
5. Run `bun build` from root to verify all apps compile
6. Use `bun lint` to ensure code style compliance

### Modifying Schemas

1. Update JSON schema in `packages/schemas/src/schemas/<source>/schema.json`
2. Add example data in `examples/` directory
3. Both web app and CLI can import these schemas
4. No build step needed (pure JSON)

### Working with Dependencies

- **Add to app**: `cd apps/<app> && bun add <package>`
- **Add to workspace**: `cd . && bun add -w <package>`
- **Python CLI**: Edit `pyproject.toml` dependencies, run `uv sync`

### Database Migrations (When Implemented)

- Backend will use Alembic for schema versioning
- Migrations stored in `apps/api/migrations/versions/`
- Apply with: `alembic upgrade head`

## Security Considerations

- Never commit credentials or API keys
- Use pgcrypto for encrypting sensitive data in PostgreSQL
- All database connections must use TLS 1.3 (production)
- Worker processes run as non-root in Kubernetes (uid 1000)
- Plugins should be sandboxed (securityContext in K8s)

## Performance Guidelines

- Target: API response < 1s (p95)
- Job processing: 100 documents/minute on CPU
- Use Kubernetes Jobs for processing (scales to zero when idle)
- PostgreSQL connection pooling required for concurrent requests
- Consider read replicas for heavy query workloads (post-MVP)
