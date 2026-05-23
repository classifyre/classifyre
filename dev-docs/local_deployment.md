# Local CI/CD Guide

## Overview

The CI pipeline (`.github/workflows/ci.yml`) has two jobs:

1. **validate** — installs deps, generates code, lints, typechecks, builds, tests, and uploads
   pre-built artifacts (api-dist, codegen, web-dist) to the artifact server.
2. **docker** — downloads those artifacts and runs `docker buildx build --push` for each of the
   four images: `all-in-one`, `web`, `api`, `cli`.

Images are pushed to GHCR with a tag derived from the branch name (slashes replaced with `-`):

| Image                                    | Example tag |
| ---------------------------------------- | ----------- |
| `ghcr.io/andrebanandre/unstructured`     | `:main`     |
| `ghcr.io/andrebanandre/unstructured/web` | `:main`     |
| `ghcr.io/andrebanandre/unstructured/api` | `:main`     |
| `ghcr.io/andrebanandre/unstructured/cli` | `:main`     |

For a branch named `feat/my-feature` the tag would be `feat-my-feature`.

> **Build cache**: Docker BuildKit also pushes layer cache to
> `ghcr.io/andrebanandre/unstructured:build-cache-{name}`. This is expected — it's separate from
> the actual image and speeds up subsequent builds.

---

## Prerequisites

```bash
brew install act          # local GitHub Actions runner
gh auth login             # authenticate with GitHub
# Docker Desktop must be running
```

You also need a **classic GitHub PAT** with `write:packages` scope to push to GHCR. The token is
stored in `.secrets` at the repo root (gitignored). Source it before running any script:

```bash
source .secrets   # exports GHCR_PAT (and GITHUB_TOKEN)
```

If you ever need to rotate or create a new token, go to
<https://github.com/settings/tokens/new>, select **classic**, tick `write:packages`, then update
the `GHCR_PAT` line in `.secrets`.

> The `gh auth login` OAuth token (`gho_*`) typically lacks `write:packages` and cannot push
> Docker images. A dedicated classic PAT is required.

---

## Run the full CI pipeline locally

```bash
# From repo root
source .secrets
./scripts/ci-local.sh
```

This runs validate + all four docker builds in a single `act` invocation.

**Useful flags** (assumes you've already run `source .secrets`):

```bash
# Only the validate job (no docker build) — fast feedback loop
./scripts/ci-local.sh -j validate

# Only docker builds (reuses artifacts cached from a previous validate run)
./scripts/ci-local.sh -j docker

# Dry run — see what would execute
./scripts/ci-local.sh --dryrun

# Verbose output
./scripts/ci-local.sh -v
```

First run will pull the `catthehacker/ubuntu:act-22.04` runner image (~1.5 GB). Subsequent runs
use the cache.

---

## How it works (architecture)

### Why the web is pre-built in validate, not in Docker

Next.js uses the SWC compiler (`@next/swc-linux-x64-gnu` / `@next/swc-linux-arm64-gnu`), which
is a native Rust binary. On Apple M-series Macs, cross-compiling a `linux/amd64` Docker image
requires QEMU x86_64 emulation. Bun (used to run `next build`) crashes under QEMU with SIGSEGV.

**Fix**: the validate job builds the web on the native arm64 runner (no QEMU), then uploads the
`.next/standalone`, `.next/static`, and `public/` directories as a `web-dist` artifact. The docker
job downloads this artifact and passes it to Docker BuildKit via `--build-context web-dist=...`.
The `web-builder` Dockerfile stage is a `busybox` image that simply COPYs from the artifact —
no bun required inside Docker.

The standalone output is arch-agnostic JavaScript (the SWC binary is only needed during the
build itself, not in the output).

### Why `cp -rL` is used when staging the web-dist artifact

Bun stores packages in `node_modules/.bun/<pkg@ver>/node_modules/<pkg>/` with a top-level symlink
at `node_modules/<pkg>`. Next.js NFT (node file tracer) copies the files from the `.bun/` target
but does **not** recreate the top-level symlink in the standalone output.

`actions/upload-artifact@v4` excludes dotfile directories (`.bun/`) by default. Without the
symlink fix, the artifact contains dangling symlinks and the web server fails at runtime with
"Cannot find module 'styled-jsx'" (and potentially others).

**Fix**: `cp -rL` (follow symlinks) is run on `standalone/` before upload. This converts
every `node_modules/<pkg>` symlink into a real directory, so `.bun/` is no longer needed at
runtime and its exclusion from the artifact is harmless.

### Artifact flow

```
validate job (arm64 native runner)
  bun run build → apps/api/dist/ + apps/web/.next/ + packages/api-client/src/generated/
  → uploads: api-build, codegen, web-dist

docker job (arm64 runner, Docker BuildKit targets linux/amd64)
  downloads: api-build → api-dist/
             codegen   → codegen/
             web-dist  → web-dist/
  docker buildx build
    --build-context api-dist=./api-dist
    --build-context codegen=./codegen
    --build-context web-dist=./web-dist
    --push ghcr.io/andrebanandre/unstructured/{web,api,cli}:<branch-tag>
```

### Apple M-series note

The `.actrc` intentionally does **not** set `--container-architecture linux/amd64`. That flag
forces all containers (including the validate runner) to use QEMU x86_64, which crashes bun and
uv. Instead:

- The validate job runs in a native arm64 container.
- Docker BuildKit cross-compiles to `linux/amd64` via Docker Desktop's Rosetta 2, which is much
  more stable than software QEMU for full-stack builds.

---

## Develop environment

### Branch → environment mapping

| Branch        | Image tag                      | Namespace            | Port  | How deployed                                              |
| ------------- | ------------------------------ | -------------------- | ----- | --------------------------------------------------------- |
| any PR branch | `:feat-my-branch`              | —                    | —     | Images built on-demand via `ci-local.sh`; no k3s deploy   |
| `develop`     | `:develop`                     | `classifyre-develop` | 30101 | Auto-deployed by GitHub Actions after CI passes           |
| `main`        | `:main` → `:x.y.z` / `:latest` | `classifyre`         | 30100 | Manual release via `release-local.sh` or Release workflow |

### Workflow

1. **Work in a PR branch** — push whenever, no deployment happens.
2. **Merge PR to `develop`** — CI builds `:develop` images and pushes them to GHCR.
   The `develop.yml` GitHub Actions workflow triggers after CI succeeds and deploys to
   `classifyre-develop` namespace on the VPS.
3. **Merge `develop` to `main`** — run `release-local.sh` (or trigger the Release workflow
   in GitHub) to cut a versioned release and deploy to the `classifyre` namespace.

### Deploy develop locally

```bash
# From repo root (defaults to ~/.kube/config-classifyre-vps)
./scripts/deploy-develop.sh                         # deploys :develop with DEMO_MODE=true
./scripts/deploy-develop.sh feat-x                  # deploys a specific image tag
./scripts/deploy-develop.sh --demo-mode false       # override DEMO_MODE
./scripts/deploy-develop.sh --namespace other-ns \
  --values /tmp/override.yaml                       # override namespace and merge extra values
```

The script always runs Helm with `helm/classifyre/values-vps-develop.yaml`, layers any
extra `--values` files on top, then forces a rollout restart for every deployment in the
release so mutable tags like `:develop` are re-pulled.

### Test develop via port-forward (before VPS port 30101 is open)

```bash
kubectl -n classifyre-develop --kubeconfig ~/.kube/config-classifyre-vps \
  port-forward svc/classifyre-develop-web 3101:3100
curl http://127.0.0.1:3101/api/ping  # should return "pong"
```

### GitHub Actions secrets required for develop auto-deploy

The `develop.yml` workflow needs the same `KUBECONFIG` repository secret used by
production. No additional secrets are required.

---

## Run a local release

```bash
# From repo root (run ci-local.sh first to push :main images)
source .secrets
./scripts/ci-local.sh
./scripts/release-local.sh 0.0.5
```

The release script:

1. Bumps versions in all `package.json` files, `pyproject.toml` files, and `helm/Chart.yaml`
2. Commits (`chore(release): v0.0.5`) and tags (`v0.0.5`)
3. Pushes commit + tag to `origin/main`
4. Retags `:main` images in GHCR → `:0.0.5`, `:0.5`, `:0`, `:latest`
5. Publishes `classifyre-schemas` and `classifyre-cli` to PyPI (if `PYPI_TOKEN` is set)
6. Creates a GitHub release with auto-generated notes
7. Deploys to k3s via Helm (if `KUBECONFIG` is set)

**For k3s deploy:**

```bash
export KUBECONFIG=~/.kube/config-classifyre-vps
./scripts/release-local.sh 0.0.5
```

**For PyPI publish:**

```bash
export PYPI_TOKEN=pypi-...
./scripts/release-local.sh 0.0.5
```

Both can be combined:

```bash
export KUBECONFIG=~/.kube/config-classifyre-vps
export PYPI_TOKEN=pypi-...
./scripts/release-local.sh 0.0.5
```

If `PYPI_TOKEN` is not set, the PyPI step is skipped with a warning and the rest of the release continues normally.

---

## PyPI packages

Two Python packages are published to PyPI on every release, versioned identically to the rest of the monorepo:

| PyPI package         | Source             | Install                          |
| -------------------- | ------------------ | -------------------------------- |
| `classifyre-schemas` | `packages/schemas` | `pip install classifyre-schemas` |
| `classifyre-cli`     | `apps/cli`         | `pip install classifyre-cli`     |

After installing `classifyre-cli`, users can run:

```bash
classifyre --help
```

### GitHub Actions secret

Add your PyPI API token as a repository secret so the Release workflow can publish automatically:

```bash
gh secret set PYPI_TOKEN --body "pypi-..."
```

Create a token at <https://pypi.org/manage/account/token/> with scope limited to the `classifyre-cli` and `classifyre-schemas` projects (or "Entire account" for the first upload when the projects don't exist yet).

### First-time publish

PyPI creates the project on the first upload. Before the first release, verify the package names are available:

- <https://pypi.org/project/classifyre-cli/>
- <https://pypi.org/project/classifyre-schemas/>

If either name is taken, update `name` in the respective `pyproject.toml` and adjust the `[tool.uv.sources]` key in `apps/cli/pyproject.toml` to match.
