# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=24
ARG PYTHON_VERSION=3.12-slim-bookworm
ARG S6_OVERLAY_VERSION=3.2.2.0
ARG PG_MAJOR=18
ARG UV_VERSION=0.10.2
ARG BUN_VERSION=1.3.10
FROM ghcr.io/astral-sh/uv:${UV_VERSION} AS uv-bin

# ── Pre-built artifacts injected from CI via --build-context ──────────────────
# api-dist:  compiled apps/api/dist  (arch-agnostic TypeScript→JS)
# codegen:   packages/api-client/src/generated  (arch-agnostic TypeScript)
# web-dist:  Next.js standalone + static + public (pre-built on native runner)
#
# Build locally: bun run codegen && bun run build in the repo root/, then pass:
#   --build-context api-dist=apps/api/dist
#   --build-context codegen=packages/api-client/src/generated
#   --build-context web-dist=<staged-web-dist-dir>  (see local_deployment.md)
FROM api-dist AS api-source
FROM codegen AS codegen-source
FROM web-dist AS web-source

# ── web-builder: inject pre-built Next.js standalone from CI artifact ─────────
# The web is built in the validate CI job on a native runner and uploaded as the
# web-dist artifact. This avoids bun SIGSEGV under QEMU x86_64 on Apple M-series.
# The CI staging step resolves bun's .bun/ symlinks via `cp -rL` so that
# standalone/node_modules/ contains real directories instead of dangling symlinks.
FROM busybox AS web-builder
COPY --from=web-source /standalone /repo/apps/web/.next/standalone
COPY --from=web-source /static /repo/apps/web/.next/static
COPY --from=web-source /public /repo/apps/web/public
RUN rm -f /repo/apps/web/public/_ci_dir_marker
# Bun stores packages in node_modules/.bun/<pkg@ver>/node_modules/<dep>/ but
# Node.js does not know to look there. Next.js NFT only traces static imports,
# so dynamically-required packages (styled-jsx, @swc/helpers, etc.) end up only
# in .bun/ with no top-level entry. Create top-level entries for all .bun/
# packages that are missing, then delete .bun/ to avoid duplicate files.
#
# When a package has multiple versions in .bun/ (e.g. @next/env is pinned to
# 16.2.10 by apps/web but 16.1.7 by apps/blog+docs), one of them can be an
# incomplete stub — only package.json, with its code files pruned as dangling
# symlinks by scripts/stage-docker-artifacts.sh. .bun/ dirs iterate in version
# order, so a stub copied first would block the real package ("skip if dst
# exists"), leaving e.g. @next/env with no dist/index.js and crashing the server.
# So treat a dir with no JS/native file as incomplete: a complete source always
# replaces an incomplete destination, regardless of iteration order.
RUN NM="/repo/apps/web/.next/standalone/node_modules" && \
  is_complete() { \
    find "$1" -type f 2>/dev/null | grep -qE '\.(js|cjs|mjs|node)$'; \
  }; \
  install_pkg() { \
    src="$1" dst="$2"; \
    [ -d "$src" ] || return 0; \
    if [ -e "$dst" ]; then \
      is_complete "$dst" && return 0; \
      is_complete "$src" || return 0; \
      rm -rf "$dst"; \
    fi; \
    cp -r "$src" "$dst"; \
  }; \
  install_scope() { \
    scope_src="$1" scope_dst="$2"; \
    [ -d "$scope_src" ] || return 0; \
    mkdir -p "$scope_dst"; \
    for pkg in "$scope_src"/*/; do \
      [ -d "$pkg" ] || continue; \
      install_pkg "$pkg" "${scope_dst}/$(basename "$pkg")"; \
    done; \
  }; \
  process_inner_nm() { \
    inner="$1"; \
    [ -d "$inner" ] || return 0; \
    for entry in "$inner"/*/; do \
      [ -d "$entry" ] || continue; \
      name="$(basename "$entry")"; \
      case "$name" in \
        @*) install_scope "$entry" "${NM}/${name}" ;; \
        *)  install_pkg  "$entry" "${NM}/${name}"  ;; \
      esac; \
    done; \
  }; \
  if [ -d "${NM}/.bun" ]; then \
    for ver_dir in "${NM}/.bun"/*/; do \
      [ -d "$ver_dir" ] || continue; \
      process_inner_nm "${ver_dir}node_modules"; \
    done; \
    rm -rf "${NM}/.bun"; \
  fi

# ── api-builder: install deps + generate Prisma client ────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS api-builder
ARG BUN_VERSION
WORKDIR /repo
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl unzip ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://bun.sh/install | bash -s -- bun-v${BUN_VERSION}
ENV PATH="/root/.bun/bin:${PATH}" \
    HUSKY=0
COPY . .
RUN bun install --frozen-lockfile
# Remove frontend workspace source after installing — web/blog/docs are injected
# as pre-built artifacts (--build-context web-dist=…) and their source isn't
# needed here. Installed packages in node_modules are kept.
RUN rm -rf apps/web apps/blog apps/docs
RUN cd apps/api && bun run prisma:generate
COPY --from=api-source / /repo/apps/api/dist/

# ── cli-builder: install base Python dependencies (slim) ─────────────────────
# Ships only base deps (~150-230 MB). Optional detector/source groups install on
# demand at runtime (CLASSIFYRE_CLI_AUTO_INSTALL_OPTIONAL_DEPS=1), cached via the
# uv cache. Concurrent/interrupted runtime syncs are made safe by the file lock +
# cross-process group accumulation + self-heal in src/utils/uv_sync.py, and the
# parent process warms the run's groups before spawning the detector worker pool.
# torch is CPU-only on Linux (pyproject [tool.uv.sources]) so runtime torch
# installs pull ~0.5 GB instead of the ~6 GB NVIDIA CUDA stack.
FROM python:${PYTHON_VERSION} AS cli-builder
COPY --from=uv-bin /uv /uvx /usr/local/bin/
WORKDIR /app
COPY apps/cli /app/apps/cli
COPY packages/schemas /app/packages/schemas
WORKDIR /app/apps/cli
ENV UV_LINK_MODE=copy \
    UV_PYTHON_PREFERENCE=only-system
RUN uv venv --python /usr/local/bin/python3 .venv \
    && uv sync --locked --no-dev

# ── web-final: standalone Next.js server ──────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS web-final
COPY --from=web-builder /repo/apps/web/.next/standalone /app
COPY --from=web-builder /repo/apps/web/.next/static /app/apps/web/.next/static
COPY --from=web-builder /repo/apps/web/public /app/apps/web/public
# Match uid 10001 from helm podSecurityContext so the container runs non-root.
# Pre-create .next/cache so Next.js image optimisation works even when
# readOnlyRootFilesystem is later enabled (pair with an emptyDir volume mount).
RUN groupadd -g 10001 classifyre && useradd -u 10001 -g 10001 -r classifyre \
    && mkdir -p /app/apps/web/.next/cache \
    && chown -R 10001:10001 /app
EXPOSE 3000
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0
USER 10001
CMD ["node", "/app/apps/web/server.js"]

# ── api-final: NestJS API server ──────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS api-final
# Bun workspace hoisting places shared packages in /repo/node_modules.
# Copy both levels so Node's module resolution finds everything.
COPY --from=api-builder /repo/node_modules /app/node_modules
COPY --from=api-builder /repo/apps/api/node_modules /app/api/node_modules
COPY --from=api-builder /repo/apps/api/dist /app/api/dist
COPY --from=api-builder /repo/apps/api/package.json /app/api/package.json
COPY --from=api-builder /repo/apps/api/prisma /app/api/prisma
COPY --from=api-builder /repo/apps/api/prisma.config.ts /app/api/prisma.config.ts
COPY --from=api-builder /repo/packages/schemas /app/packages/schemas
COPY --from=api-builder /repo/packages/schemas/node_modules /app/packages/schemas/node_modules
# Match uid 10001 from helm podSecurityContext so Prisma engine files are accessible non-root.
RUN groupadd -g 10001 classifyre && useradd -u 10001 -g 10001 -r classifyre \
    && ln -s /app/node_modules /node_modules \
    && ln -sfn /app/packages /packages \
    && chown -R 10001:10001 /app
WORKDIR /app/api
USER 10001
EXPOSE 8000
ENV NODE_ENV=production \
    PORT=8000
CMD ["node", "dist/src/main.js"]

# ── cli-final: Python CLI ─────────────────────────────────────────────────────
FROM python:${PYTHON_VERSION} AS cli-final
ARG TARGETARCH
COPY --from=uv-bin /uv /uvx /usr/local/bin/
COPY --from=cli-builder /app/apps/cli/.venv /app/apps/cli/.venv
COPY --from=cli-builder /app/apps/cli/src /app/apps/cli/src
COPY --from=cli-builder /app/apps/cli/pyproject.toml /app/apps/cli/pyproject.toml
COPY --from=cli-builder /app/apps/cli/uv.lock /app/apps/cli/uv.lock
COPY --from=cli-builder /app/apps/cli/README.md /app/apps/cli/README.md
COPY --from=cli-builder /app/packages/schemas /app/packages/schemas
COPY --from=api-builder /repo/packages/schemas/node_modules /app/packages/schemas/node_modules
ENV UV_LINK_MODE=copy \
    UV_CACHE_DIR=/cache/uv \
    CLASSIFYRE_CLI_AUTO_INSTALL_OPTIONAL_DEPS=1 \
    PATH="/app/apps/cli/.venv/bin:${PATH}"
# libgl1 + libglib2.0-0 required by opencv-python (pulled in by rapidocr-onnxruntime for docling OCR).
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends libgl1 libglib2.0-0 ca-certificates; \
    rm -rf /var/lib/apt/lists/*
# Match uid 10001 from helm podSecurityContext so uv sync can modify the venv at runtime
RUN groupadd -g 10001 classifyre && useradd -u 10001 -g 10001 -r classifyre \
    && chown -R 10001:10001 /app
WORKDIR /app/apps/cli
USER 10001
ENTRYPOINT ["/app/apps/cli/.venv/bin/python", "-m", "src.main"]
