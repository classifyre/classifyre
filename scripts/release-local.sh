#!/usr/bin/env bash
# Run the release pipeline locally.
#
# Mirrors .github/workflows/release.yml but skips the 'build-main-images' job
# (which just waits for GitHub-hosted CI to finish). Run ci-local.sh first to
# build and push :main images, then call this script to cut the release.
#
# Prerequisites:
#   ./scripts/ci-local.sh       (validates + builds :main images in GHCR)
#   brew install kubectl helm
#   gh auth login
#   Docker Desktop running and logged in to GHCR
#   KUBECONFIG env var or file at ~/.kube/config pointing at the k3s cluster
#
# Usage:
#   ./scripts/release-local.sh 0.0.5
#   KUBECONFIG=/path/to/config ./scripts/release-local.sh 0.0.5

set -euo pipefail

VERSION="${1:-}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

# ── Validate version arg ──────────────────────────────────────────────────────
if [[ -z "${VERSION}" ]]; then
  echo "Usage: $0 <major.minor.patch>" >&2
  exit 1
fi
VERSION="${VERSION#v}"   # strip leading 'v' if present
if ! [[ "${VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: version must be major.minor.patch (got '${VERSION}')" >&2
  exit 1
fi
TAG="v${VERSION}"
GHCR_REPO="ghcr.io/classifyre/unstructured"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  Local release: ${TAG}                   "
echo "╚══════════════════════════════════════════╝"

# ── Guard: working tree must be clean ────────────────────────────────────────
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Error: working tree has uncommitted changes. Commit or stash first." >&2
  git status --short >&2
  exit 1
fi

# ── Guard: tag must not already exist ────────────────────────────────────────
if git rev-parse "${TAG}" >/dev/null 2>&1; then
  echo "Error: tag ${TAG} already exists locally." >&2
  exit 1
fi
if git ls-remote --tags origin "${TAG}" 2>/dev/null | grep -q "${TAG}$"; then
  echo "Error: tag ${TAG} already exists on origin." >&2
  exit 1
fi

# ── Step 1: Bump package versions ────────────────────────────────────────────
echo ""
echo "==> [1/5] Bumping version to ${VERSION}..."
node scripts/set-release-version.mjs "${VERSION}"

# Update uv lockfiles to reflect the new package versions
(cd apps/cli && uv lock)
(cd packages/schemas && uv lock)

# Verify something actually changed
if git diff --quiet -- \
    package.json \
    apps/api/package.json \
    apps/blog/package.json \
    apps/docs/package.json \
    apps/web/package.json \
    apps/cli/package.json \
    apps/cli/pyproject.toml \
    packages/api-client/package.json \
    packages/devops/package.json \
    packages/schemas/package.json \
    packages/schemas/pyproject.toml \
    helm/classifyre/Chart.yaml; then
  echo "Error: version ${VERSION} is already applied (no diff after bump)." >&2
  exit 1
fi

# ── Step 2: Commit and tag ────────────────────────────────────────────────────
echo ""
echo "==> [2/5] Committing release commit and tagging ${TAG}..."
git add \
  package.json \
  apps/api/package.json \
  apps/blog/package.json \
  apps/docs/package.json \
  apps/web/package.json \
  apps/cli/package.json \
  apps/cli/pyproject.toml \
  apps/cli/uv.lock \
  packages/api-client/package.json \
  packages/devops/package.json \
  packages/schemas/package.json \
  packages/schemas/pyproject.toml \
  packages/schemas/uv.lock \
  helm/classifyre/Chart.yaml

git commit -m "chore(release): ${TAG}"
git tag "${TAG}"

# ── Step 3: Push to GitHub ────────────────────────────────────────────────────
echo ""
echo "==> [3/5] Pushing commit and tag to origin/main..."
git push origin HEAD:main
git push origin "${TAG}"

# ── Step 4: Retag GHCR images :main → version tags ───────────────────────────
echo ""
echo "==> [4/5] Retagging Docker images ${GHCR_REPO}:main → ${VERSION}..."

# Log in to GHCR with the PAT (required for imagetools create to push new tags)
GHCR_PAT="${GHCR_PAT:-${GITHUB_TOKEN:-}}"
if [[ -z "${GHCR_PAT}" ]]; then
  if command -v gh >/dev/null 2>&1; then
    GHCR_PAT="$(gh auth token 2>/dev/null || true)"
  fi
fi
if [[ -z "${GHCR_PAT}" ]]; then
  echo "Error: GHCR_PAT not set. Export a classic PAT with write:packages scope." >&2
  exit 1
fi
GHCR_USER="${GHCR_REPO#ghcr.io/}"
GHCR_USER="${GHCR_USER%%/*}"
if [[ -z "${GHCR_USER}" || "${GHCR_USER}" == "${GHCR_REPO}" ]]; then
  echo "Error: could not derive GHCR owner from ${GHCR_REPO}" >&2
  exit 1
fi
echo "${GHCR_PAT}" | docker login ghcr.io -u "${GHCR_USER}" --password-stdin

MAJOR="${VERSION%%.*}"
REMAINDER="${VERSION#${MAJOR}.}"
MINOR="${REMAINDER%%.*}"

retag() {
  local image="$1"
  echo "    ${image}:main → :${VERSION}, :${MAJOR}.${MINOR}, :${MAJOR}, :latest"
  docker buildx imagetools create \
    --tag "${image}:${VERSION}" \
    --tag "${image}:${MAJOR}.${MINOR}" \
    --tag "${image}:${MAJOR}" \
    --tag "${image}:latest" \
    "${image}:main"
}

retag "${GHCR_REPO}"
retag "${GHCR_REPO}/web"
retag "${GHCR_REPO}/api"
retag "${GHCR_REPO}/cli"

# ── Step 5a: Publish Python packages to PyPI ─────────────────────────────────
echo ""
echo "==> [5a/6] Publishing classifyre-schemas and classifyre-cli to PyPI..."

PYPI_TOKEN="${PYPI_TOKEN:-}"
if [[ -z "${PYPI_TOKEN}" ]]; then
  echo "⚠️  PYPI_TOKEN not set — skipping PyPI publish."
  echo "   Export PYPI_TOKEN=pypi-... and re-run to publish."
else
  # Build and publish classifyre-schemas first (CLI depends on it)
  (cd "${REPO_ROOT}/packages/schemas" && uv build && uv publish --token "${PYPI_TOKEN}")
  # Build and publish classifyre-cli
  (cd "${REPO_ROOT}/apps/cli" && uv build && uv publish --token "${PYPI_TOKEN}")
  echo "    Published classifyre-schemas@${VERSION} and classifyre-cli@${VERSION} to PyPI"
fi

# ── Step 5b: Create GitHub release ───────────────────────────────────────────
echo ""
echo "==> [5b/6] Creating GitHub release ${TAG}..."
gh release create "${TAG}" \
  --repo classifyre/unstructured \
  --generate-notes \
  --title "${TAG}"

# ── Step 5b: Deploy to k3s (optional) ────────────────────────────────────────
# Auto-detect kubeconfig: explicit KUBECONFIG > config-classifyre-vps > default
if [[ -z "${KUBECONFIG:-}" ]]; then
  if [[ -f "${HOME}/.kube/config-classifyre-vps" ]]; then
    export KUBECONFIG="${HOME}/.kube/config-classifyre-vps"
    echo "    Using kubeconfig: ${KUBECONFIG}"
  elif [[ -f "${HOME}/.kube/config" ]]; then
    export KUBECONFIG="${HOME}/.kube/config"
    echo "    Using kubeconfig: ${KUBECONFIG}"
  fi
fi

if [[ -z "${KUBECONFIG:-}" ]]; then
  echo ""
  echo "⚠️  No KUBECONFIG found — skipping k3s deploy."
  echo "   Set KUBECONFIG=/path/to/config and re-run to deploy."
else
  echo ""
  echo "==> [5c/6] Deploying ${TAG} to k3s with Helm..."
  helm upgrade --install classifyre ./helm/classifyre \
    --namespace classifyre \
    --create-namespace \
    -f ./helm/classifyre/values-vps.yaml \
    --set api.image.tag="${VERSION}" \
    --set api.cliJobs.image.tag="${VERSION}" \
    --set frontend.image.tag="${VERSION}" \
    --wait \
    --timeout 15m

  echo ""
  kubectl -n classifyre get deploy,pods,svc
  helm status classifyre -n classifyre
fi

echo ""
echo "✅  Release ${TAG} complete!"
