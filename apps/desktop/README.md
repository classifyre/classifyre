# Classifyre Desktop

Electron app that bundles the full Classifyre stack (API, Web, CLI, PostgreSQL) into a single installable desktop application.

## Architecture

The desktop app runs an **embedded PostgreSQL** instance and spawns per-workspace API servers. Each workspace (called a "namespace") gets its own database schema and API process.

```
┌─────────────────────────────────────────┐
│  Electron Main Process                  │
│  ├─ PostgresManager   (embedded PG)     │
│  ├─ NamespaceManager  (workspace CRUD)  │
│  ├─ ProcessManager    (API child procs) │
│  └─ NamespaceRuntime  (tab/view mgmt)  │
├─────────────────────────────────────────┤
│  Tab Bar View    (WebContentsView)      │
├─────────────────────────────────────────┤
│  Content Views   (one per open tab)     │
│  ├─ Local: static Next.js + API proxy   │
│  └─ Remote: external URL in sandboxed   │
│            webview                       │
└─────────────────────────────────────────┘
```

### Key components

| File | Purpose |
|------|---------|
| `src/main/index.ts` | App entry point, window creation, lifecycle |
| `src/main/postgres-manager.ts` | Embedded PostgreSQL lifecycle (start/stop/schema) |
| `src/main/process-manager.ts` | Spawn/kill per-namespace NestJS API processes |
| `src/main/namespace-manager.ts` | Workspace CRUD, persisted to `namespaces.json` |
| `src/main/namespace-runtime.ts` | Tab management, view layout, IPC coordination |
| `src/main/auto-updater.ts` | GitHub Releases-based auto-update via electron-updater |
| `src/main/protocol-handler.ts` | Custom `app://` protocol for serving static web files |
| `src/preload/preload.ts` | Context bridge exposing `electronAPI` to renderers |
| `src/renderer/namespace-selector/` | Workspace picker UI |
| `src/renderer/tab-bar/` | Browser-style tab strip |

### Data storage

All data is stored under the Electron `userData` directory (or `CLASSIFYRE_DATA_DIR` if set):

- `pgdata/` — PostgreSQL data directory
- `namespaces.json` — workspace definitions
- `.pg-password` — auto-generated PostgreSQL password (mode 0600)

## Development

### Prerequisites

- Node.js >= 22
- Bun (package manager)
- The API and Web apps must be buildable from the monorepo root

### Running in dev mode

```bash
# From monorepo root — install all dependencies
bun install

# Start the web dev server (separate terminal)
cd apps/web && bun dev

# Start the desktop app
cd apps/desktop && bun dev
```

In dev mode:
- The namespace selector is served by Vite HMR
- Local namespaces connect to `http://localhost:3000` (Next.js dev server)
- The API is spawned from `apps/api/dist/` (run `bun --filter api build` first)

### Building

```bash
# Package the app (no installer)
bun run build

# Create platform-specific installers
bun run make
```

### Testing

```bash
# Unit/integration tests
bun test

# E2E tests (requires Playwright)
bun test:e2e
```

## Release workflow

The GitHub Actions workflow `.github/workflows/release-desktop.yml` builds platform artifacts automatically.

### Triggers

- **GitHub Release**: creating a release triggers builds for all platforms
- **Manual dispatch**: run with a tag name for ad-hoc builds

### Build matrix

| Platform | Runner | Artifact |
|----------|--------|----------|
| macOS arm64 | `macos-latest` | `.dmg` |
| macOS x64 | `macos-13` | `.dmg` |
| Windows x64 | `windows-latest` | `.exe` (Squirrel) |
| Linux x64 | `ubuntu-latest` | `.deb` |

### Build steps (CI)

1. Install dependencies (`bun install --frozen-lockfile`)
2. Run postinstall (dylib symlinks for embedded-postgres)
3. Generate Prisma client
4. Build API (`apps/api/dist/`)
5. Build web as static export (`apps/web/out/`)
6. Stage resources into `apps/desktop/resources/`
7. Run `electron-forge make`
8. Upload artifacts to the GitHub Release

### Auto-updates

The app uses `electron-updater` with GitHub Releases as the update source. Configuration is in `dev-app-update.yml`. Updates are checked on launch and surfaced via a badge in the tab bar.

## Bundled resources

The packaged app includes these in `extraResource`:

| Directory | Contents |
|-----------|----------|
| `resources/api/` | NestJS API dist + package.json |
| `resources/web/` | Next.js static export |
| `resources/cli/` | Python CLI source + pyproject.toml |
| `resources/prisma/` | Prisma schema + migrations |
