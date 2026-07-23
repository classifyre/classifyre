# Classifyre Desktop

Electron app that bundles the full Classifyre stack (API, Web, CLI, PostgreSQL, Python, Java) into a single installable desktop application with **zero external dependencies** — users install one artifact and run.

## Architecture

The desktop app runs an **embedded PostgreSQL** instance and one shared, namespace-aware API. The API owns the namespace registry in PostgreSQL, provisions one schema per local namespace, and scopes requests through `/<slug>/...`. The web app owns namespace CRUD and routing. Child processes run on Electron's own Node (`ELECTRON_RUN_AS_NODE`) and the bundled Python venv — nothing from the user's machine is required.

```
┌─────────────────────────────────────────┐
│  Electron Main Process                  │
│  ├─ PostgresManager   (embedded PG)     │
│  ├─ SettingsManager   (global settings) │
│  ├─ ProcessManager    (shared API)       │
│  ├─ NamespaceStore    (menu API mirror) │
│  └─ python-env        (venv relocation) │
├─────────────────────────────────────────┤
│  BrowserWindow                          │
│  └─ Namespace-aware Next.js web app     │
├─────────────────────────────────────────┤
│  Shared NestJS API                      │
│  └─ PostgreSQL namespace registry       │
│     + per-namespace schemas             │
└─────────────────────────────────────────┘
```

### Key components

| File | Purpose |
|------|---------|
| `src/main/index.ts` | App entry point, window creation, lifecycle |
| `src/main/postgres-manager.ts` | Embedded PostgreSQL lifecycle (start/stop/schema) |
| `src/main/process-manager.ts` | Spawn, monitor, and stop the shared NestJS API |
| `src/main/namespace-store.ts` | Read-only API namespace snapshot for native menus |
| `src/main/settings-manager.ts` | App-wide settings (database port), persisted to `settings.json` |
| `src/main/python-env.ts` | Makes the bundled Python venv relocatable on first launch |
| `src/main/update-checker.ts` | GitHub Releases version check + in-app download/install |
| `src/main/tray.ts` | System tray / menu-bar item (API workspaces, updates, background mode) |
| `src/main/menu.ts` | Application menu (Workspaces, Logs, Check for Updates) + dock menu |
| `src/main/protocol-handler.ts` | Custom `app://` protocol for serving static web files |
| `src/preload/preload.ts` | Context bridge exposing `electronAPI` to renderers |

### Data storage

All data is stored under the Electron `userData` directory (or `CLASSIFYRE_DATA_DIR` if set):

- `pgdata/` — PostgreSQL data directory
- `settings.json` — app-wide settings (preferred database port)
- `python-runtime/` — relocated Python venv (only when the install dir is read-only)

Namespace definitions and settings are stored in the embedded database's
`public.namespaces` registry and exposed through the shared API.

## Development

### Prerequisites (development only)

- Node.js >= 22, Bun, `uv` (for Python staging), `make` optional
- End users need none of these — everything is bundled.

### Running in dev mode

```bash
# From monorepo root — install all dependencies
bun install

# Start the web dev server (separate terminal)
cd apps/web && bun dev

# Start the desktop app
cd apps/desktop && bun dev   # or: make dev
```

In dev mode:
- The desktop window loads `http://localhost:3000` (Next.js dev server)
- The API is spawned from `apps/api/dist/` (run `bun --filter @classifyre/api build` first)

## Building installers

```bash
cd apps/desktop

make all        # full from-scratch build: deps + stage + installers
make stage      # build API/web + stage resources (python, venv, …)
make dist       # create installers from staged resources
make package    # package app only (no installers)
make clean      # remove build output and staged resources

# Fast iteration — skip the slow bits you don't need:
SKIP_PYTHON=1 make stage
```

Installers land in `out/make/`:

| Platform | Artifact |
|----------|----------|
| macOS (arm64 / x64) | `.dmg` |
| Windows x64 | `Classifyre-win32-x64-<version>.zip` (portable) |
| Linux (amd64 / arm64) | `.deb` + `.rpm` |

### What gets bundled (`resources/`, staged by `scripts/stage-resources.sh`)

| Directory | Contents |
|-----------|----------|
| `api/` | NestJS API dist + standalone production node_modules (npm install; includes the Prisma CLI, generated client, schema + migrations, and a compiled `@workspace/schemas`) |
| `web/` | Next.js static export |
| `cli/` | Python CLI source + pyproject.toml + uv.lock |
| `python/` | Standalone CPython (python-build-standalone via uv) |
| `venv/` | Pre-baked venv — re-pointed to the bundled CPython on first app launch |

## macOS signing & notarization

### Local/unsigned builds (no Apple Developer account)

`make all` produces an **unsigned** `.dmg`. This is fine for local testing:

- An app you built on the same machine launches normally (no quarantine flag).
- A **downloaded** unsigned build triggers Gatekeeper. Users can bypass with right-click → Open, or:

```bash
xattr -cr /Applications/Classifyre.app
```

CI additionally ad-hoc signs (`codesign --sign -`), which Apple Silicon requires for the binary to launch at all.

### Signed builds (Developer ID + notarization)

Signing and notarization are wired in `forge.config.ts` and activate from env vars — no config changes needed. Requires the "Developer ID Application" certificate in the keychain and an App Store Connect API key (`.p8`):

```bash
export MACOS_SIGN=1                                   # sign with the keychain's Developer ID identity
export APPLE_API_KEY="$HOME/apple-csr/AuthKey_XXXXXXXXXX.p8"   # \
export APPLE_API_KEY_ID="XXXXXXXXXX"                           #  > notarization (App Store Connect API key)
export APPLE_API_ISSUER_ID="00000000-0000-0000-0000-000000000000"  # /
make stage   # required: packaging fails if resources aren't staged
make dist
```

Optionally pin the identity with `APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"` (implies `MACOS_SIGN=1`). Verify the result:

```bash
codesign --verify --deep --strict Classifyre.app
spctl --assess --type execute --verbose=2 Classifyre.app   # "accepted, source=Notarized Developer ID"
```

### CI secrets

`release-desktop.yml` signs + notarizes automatically when these repository secrets exist (mac jobs fall back to ad-hoc signing when they don't, e.g. on forks):

| Secret | Contents |
|--------|----------|
| `APPLE_CERTIFICATE_BASE64` | base64 of the Developer ID Application `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | password for the `.p12` |
| `APPLE_TEAM_ID` | Apple Developer team id |
| `APPLE_API_KEY_BASE64` | base64 of the App Store Connect `AuthKey_*.p8` |
| `APPLE_API_KEY_ID` | the API key id |
| `APPLE_API_ISSUER_ID` | the API issuer id |

## Testing

```bash
make test    # namespace lifecycle test
make e2e     # Playwright end-to-end tests (needs web dev server on :3000)

# Smoke-test a packaged build (used by CI on all platforms):
CLASSIFYRE_APP_PATH=out/Classifyre-darwin-arm64/Classifyre.app/Contents/MacOS/classifyre-desktop \
  npx tsx test/smoke.ts
```

## Release workflow

`.github/workflows/release-desktop.yml` builds all platforms and uploads artifacts to the GitHub release for the given tag.

| Platform | Runner | Artifact |
|----------|--------|----------|
| macOS arm64 | `macos-latest` | `.dmg` |
| macOS x64 | `macos-15-intel` | `.dmg` |
| Windows x64 | `windows-latest` | `.zip` (portable) |
| Linux amd64 | `ubuntu-latest` | `.deb` + `.rpm` |
| Linux arm64 | `ubuntu-24.04-arm` | `.deb` + `.rpm` |

Each job stages resources with the same `stage-resources.sh` as local builds, packages, ad-hoc signs (macOS), **smoke-tests the packaged binary** (boots the app and waits for the API-backed workspace directory), then creates and uploads installers.

## Updates

The app checks GitHub Releases on launch and every 6 hours. Available updates are exposed through the application and tray menus:

- **macOS (signed builds)**: the release's darwin zip is handed to Electron's built-in Squirrel.Mac updater via a loopback JSON feed; when downloaded the badge becomes "Restart to update", which installs in place and relaunches. Unsigned/dev builds fall back to a plain DMG download.
- **Windows/Linux**: the matching zip/deb/rpm is downloaded to `~/Downloads` with progress; the badge then reveals the archive (zip) or opens the system package installer (deb/rpm).

The same actions are available from the tray menu and "Check for Updates…" in the application menu.

## Background mode & tray

A system-tray (macOS menu-bar) item lists namespaces fetched from the shared API and can open them, trigger updates, and quit. There is no desktop-level active/inactive state: the shared API serves every local namespace for the lifetime of the app. With "Keep Running in Background" enabled (default, persisted in `settings.json` as `runInBackground`), closing the window hides it while the shared services keep running; the tray, dock, or relaunching the app brings it back.
