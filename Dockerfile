# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=24
ARG PYTHON_VERSION=3.12-slim-bookworm
ARG S6_OVERLAY_VERSION=3.2.2.0
ARG PG_MAJOR=18
ARG UV_VERSION=0.10.2
ARG BUN_VERSION=1.3.4

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
RUN NM="/repo/apps/web/.next/standalone/node_modules" && \
  install_pkg() { \
    src="$1" dst="$2"; \
    [ -d "$src" ] || return 0; \
    [ -e "$dst" ] && return 0; \
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
RUN cd apps/api && bun run prisma:generate
COPY --from=api-source / /repo/apps/api/dist/

# ── cli-builder: install Python dependencies ──────────────────────────────────
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
EXPOSE 3000
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0
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
RUN ln -s /app/node_modules /node_modules && \
    ln -sfn /app/packages /packages
WORKDIR /app/api
EXPOSE 8000
ENV NODE_ENV=production \
    PORT=8000
CMD ["node", "dist/src/main.js"]

# ── cli-final: Python CLI ─────────────────────────────────────────────────────
FROM python:${PYTHON_VERSION} AS cli-final
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
# Install Chromium OS-level dependencies (libglib2, libnss3, etc.) at build time as root.
# The browser binary itself is still downloaded on demand by _install_playwright_chromium()
# so the image stays small. System libs require apt-get/root — that's why they must be
# baked in rather than installed at runtime under the non-root uid 10001.
RUN playwright install-deps chromium
# Match uid 10001 from helm podSecurityContext so uv sync can modify the venv at runtime
RUN groupadd -g 10001 classifyre && useradd -u 10001 -g 10001 -r classifyre \
    && chown -R 10001:10001 /app
WORKDIR /app/apps/cli
USER 10001
ENTRYPOINT ["/app/apps/cli/.venv/bin/python", "-m", "src.main"]

# ── runtime: all-in-one for demo/dev ──────────────────────────────────────────
FROM python:${PYTHON_VERSION} AS runtime
ARG TARGETARCH
ARG NODE_VERSION
ARG S6_OVERLAY_VERSION
ARG PG_MAJOR

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOME=/root \
    PATH=/command:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    PG_MAJOR=${PG_MAJOR} \
    PGDATA=/var/lib/postgresql/data \
    PGPORT=5432 \
    POSTGRES_USER=postgres \
    POSTGRES_PASSWORD= \
    POSTGRES_DB=classifyre \
    API_PORT=8000 \
    WEB_PORT=3100 \
    DATABASE_URL=postgresql://postgres@127.0.0.1:5432/classifyre \
    ENVIRONMENT=docker \
    CLI_PATH=/app/apps/cli \
    TEMP_DIR=/tmp \
    RUNNER_LOGS_DIR=/var/lib/classifyre/runner-logs \
    API_URL=http://127.0.0.1:8000 \
    NEXT_PUBLIC_API_URL=/api \
    UV_LINK_MODE=copy \
    UV_CACHE_DIR=/cache/uv \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    CLASSIFYRE_PLAYWRIGHT_INSTALL_WITH_DEPS=0 \
    CLASSIFYRE_CLI_AUTO_INSTALL_OPTIONAL_DEPS=1

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      bash \
      ca-certificates \
      curl \
      gnupg \
      procps \
      xz-utils; \
    install -d -m 0755 /etc/apt/keyrings; \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg; \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_VERSION}.x nodistro main" > /etc/apt/sources.list.d/nodesource.list; \
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /etc/apt/keyrings/postgresql.gpg; \
    echo "deb [signed-by=/etc/apt/keyrings/postgresql.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list; \
    curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /etc/apt/keyrings/caddy-stable.gpg; \
    echo "deb [signed-by=/etc/apt/keyrings/caddy-stable.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main" > /etc/apt/sources.list.d/caddy-stable.list; \
    mkdir -p /etc/postgresql-common; \
    echo "create_main_cluster = false" > /etc/postgresql-common/createcluster.conf; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      caddy \
      fonts-liberation \
      libasound2 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libatspi2.0-0 \
      libcairo2 \
      libcups2 \
      libdbus-1-3 \
      libdrm2 \
      libgbm1 \
      libglib2.0-0 \
      libgtk-3-0 \
      libnspr4 \
      libnss3 \
      libpango-1.0-0 \
      libx11-6 \
      libx11-xcb1 \
      libxcb1 \
      libxcomposite1 \
      libxdamage1 \
      libxext6 \
      libxfixes3 \
      libxkbcommon0 \
      libxrandr2 \
      libxshmfence1 \
      libxss1 \
      libxtst6 \
      nodejs \
      postgresql-${PG_MAJOR} \
      postgresql-client-${PG_MAJOR}; \
    rm -rf /var/lib/apt/lists/*

COPY --from=uv-bin /uv /uvx /usr/local/bin/

RUN set -eux; \
    case "${TARGETARCH}" in \
      amd64) s6_arch="x86_64" ;; \
      arm64) s6_arch="aarch64" ;; \
      *) echo "Unsupported TARGETARCH: ${TARGETARCH}" && exit 1 ;; \
    esac; \
    curl -fsSL "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-noarch.tar.xz" -o /tmp/s6-overlay-noarch.tar.xz; \
    curl -fsSL "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-${s6_arch}.tar.xz" -o /tmp/s6-overlay-arch.tar.xz; \
    tar -C / -Jxpf /tmp/s6-overlay-noarch.tar.xz; \
    tar -C / -Jxpf /tmp/s6-overlay-arch.tar.xz; \
    rm -f /tmp/s6-overlay-noarch.tar.xz /tmp/s6-overlay-arch.tar.xz

WORKDIR /app

COPY --from=web-builder /repo/apps/web/.next/standalone /app/web
COPY --from=web-builder /repo/apps/web/.next/static /app/web/apps/web/.next/static
COPY --from=web-builder /repo/apps/web/public /app/web/apps/web/public

# Bun workspace hoisting places shared packages in /repo/node_modules.
# Copy both levels so Node's module resolution finds everything.
COPY --from=api-builder /repo/node_modules /app/node_modules
COPY --from=api-builder /repo/apps/api/node_modules /app/api/node_modules
COPY --from=api-builder /repo/apps/api/dist /app/api/dist
COPY --from=api-builder /repo/apps/api/package.json /app/api/package.json
COPY --from=api-builder /repo/apps/api/prisma /app/api/prisma
COPY --from=api-builder /repo/apps/api/prisma.config.ts /app/api/prisma.config.ts

COPY --from=cli-builder /app/apps/cli/.venv /app/apps/cli/.venv
COPY --from=cli-builder /app/apps/cli/src /app/apps/cli/src
COPY --from=cli-builder /app/apps/cli/pyproject.toml /app/apps/cli/pyproject.toml
COPY --from=cli-builder /app/apps/cli/uv.lock /app/apps/cli/uv.lock
COPY --from=cli-builder /app/apps/cli/README.md /app/apps/cli/README.md
COPY --from=cli-builder /app/packages/schemas /app/packages/schemas
COPY --from=api-builder /repo/packages/schemas/node_modules /app/packages/schemas/node_modules

RUN set -eux; \
    ln -sfn /app/node_modules /node_modules; \
    ln -sfn /app/packages /packages; \
    mkdir -p /var/lib/postgresql/data /var/run/postgresql /cache/uv /tmp "${PLAYWRIGHT_BROWSERS_PATH}" "${RUNNER_LOGS_DIR}"; \
    chown -R postgres:postgres /var/lib/postgresql /var/run/postgresql; \
    chown -R 10001:10001 /app/apps/cli /app/packages/schemas /cache/uv "${PLAYWRIGHT_BROWSERS_PATH}" "${RUNNER_LOGS_DIR}"; \
    chmod 700 /var/lib/postgresql/data

RUN <<'EOF'
set -eux

mkdir -p \
  /etc/s6-overlay/s6-rc.d/postgresql/dependencies.d \
  /etc/s6-overlay/s6-rc.d/api/dependencies.d \
  /etc/s6-overlay/s6-rc.d/web/dependencies.d \
  /etc/s6-overlay/s6-rc.d/caddy/dependencies.d \
  /etc/s6-overlay/s6-rc.d/user/contents.d

echo "longrun" > /etc/s6-overlay/s6-rc.d/postgresql/type
cat > /etc/s6-overlay/s6-rc.d/postgresql/run <<'SH'
#!/command/with-contenv sh
set -eu

PGDATA="${PGDATA:-/var/lib/postgresql/data}"

mkdir -p "${PGDATA}" /var/run/postgresql
chown -R postgres:postgres "${PGDATA}" /var/run/postgresql
chmod 700 "${PGDATA}"

if [ ! -s "${PGDATA}/PG_VERSION" ]; then
  s6-setuidgid postgres /usr/lib/postgresql/"${PG_MAJOR}"/bin/initdb \
    -D "${PGDATA}" \
    --username=postgres \
    --auth=trust
fi

exec s6-setuidgid postgres /usr/lib/postgresql/"${PG_MAJOR}"/bin/postgres \
  -D "${PGDATA}" \
  -c "listen_addresses=127.0.0.1" \
  -c "port=${PGPORT:-5432}" \
  -c "unix_socket_directories=/tmp"
SH
chmod +x /etc/s6-overlay/s6-rc.d/postgresql/run

echo "longrun" > /etc/s6-overlay/s6-rc.d/api/type
cat > /etc/s6-overlay/s6-rc.d/api/run <<'SH'
#!/command/with-contenv sh
set -eu

for _ in $(seq 1 90); do
  if pg_isready -h 127.0.0.1 -p "${PGPORT:-5432}" -U postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

CLI_DIR="${CLI_PATH:-/app/apps/cli}"
mkdir -p "${UV_CACHE_DIR:-/cache/uv}"

if [ ! -x "${CLI_DIR}/.venv/bin/python" ]; then
  echo "Missing CLI virtualenv at ${CLI_DIR}/.venv/bin/python" >&2
  exit 1
fi

if ! psql -h 127.0.0.1 -p "${PGPORT:-5432}" -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${POSTGRES_DB:-classifyre}'" | grep -q 1; then
  psql -h 127.0.0.1 -p "${PGPORT:-5432}" -U postgres -v ON_ERROR_STOP=1 \
    -c "CREATE DATABASE \"${POSTGRES_DB:-classifyre}\";"
fi

export DATABASE_URL="postgresql://postgres@127.0.0.1:${PGPORT:-5432}/${POSTGRES_DB:-classifyre}"
cd /app/api

prisma_entry=""
if [ -f /app/node_modules/.bun/node_modules/prisma/build/index.js ]; then
  prisma_entry=/app/node_modules/.bun/node_modules/prisma/build/index.js
elif [ -f /app/node_modules/prisma/build/index.js ]; then
  prisma_entry=/app/node_modules/prisma/build/index.js
elif [ -f /app/api/node_modules/prisma/build/index.js ]; then
  prisma_entry=/app/api/node_modules/prisma/build/index.js
else
  echo "Prisma CLI not found in copied workspace dependencies" >&2
  exit 1
fi

node "${prisma_entry}" migrate deploy --schema /app/api/prisma/schema.prisma

if [ -z "${CLASSIFYRE_MASKED_CONFIG_KEY:-}" ]; then
  key_file="${PGDATA}/.classifyre_masked_config_key"
  if [ -s "${key_file}" ]; then
    CLASSIFYRE_MASKED_CONFIG_KEY="$(cat "${key_file}")"
  else
    CLASSIFYRE_MASKED_CONFIG_KEY="$(head -c 32 /dev/urandom | base64 | tr -d '\n')"
    (umask 077 && printf '%s' "${CLASSIFYRE_MASKED_CONFIG_KEY}" > "${key_file}")
  fi
fi

exec env \
  ENVIRONMENT=docker \
  CLI_PATH="${CLI_PATH:-/app/apps/cli}" \
  PORT="${API_PORT:-8000}" \
  DATABASE_URL="${DATABASE_URL}" \
  CLASSIFYRE_MASKED_CONFIG_KEY="${CLASSIFYRE_MASKED_CONFIG_KEY}" \
  node /app/api/dist/src/main.js
SH
chmod +x /etc/s6-overlay/s6-rc.d/api/run
touch /etc/s6-overlay/s6-rc.d/api/dependencies.d/postgresql

echo "longrun" > /etc/s6-overlay/s6-rc.d/web/type
cat > /etc/s6-overlay/s6-rc.d/web/run <<'SH'
#!/command/with-contenv sh
set -eu

exec env \
  NODE_ENV=production \
  HOSTNAME=127.0.0.1 \
  PORT="${WEB_PORT:-3100}" \
  API_URL="${API_URL:-http://127.0.0.1:8000}" \
  NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-/api}" \
  node /app/web/apps/web/server.js
SH
chmod +x /etc/s6-overlay/s6-rc.d/web/run
touch /etc/s6-overlay/s6-rc.d/web/dependencies.d/api

echo "longrun" > /etc/s6-overlay/s6-rc.d/caddy/type
cat > /etc/s6-overlay/s6-rc.d/caddy/run <<'SH'
#!/command/with-contenv sh
set -eu
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
SH
chmod +x /etc/s6-overlay/s6-rc.d/caddy/run
touch /etc/s6-overlay/s6-rc.d/caddy/dependencies.d/web

touch /etc/s6-overlay/s6-rc.d/user/contents.d/postgresql
touch /etc/s6-overlay/s6-rc.d/user/contents.d/api
touch /etc/s6-overlay/s6-rc.d/user/contents.d/web
touch /etc/s6-overlay/s6-rc.d/user/contents.d/caddy
EOF

RUN cat <<'EOF' > /etc/caddy/Caddyfile
:3000 {
  encode zstd gzip

  @mcp path /mcp /mcp/* /api/mcp /api/mcp/*
  handle @mcp {
    uri strip_prefix /api
    reverse_proxy 127.0.0.1:8000
  }

  @api path /api /api/*
  handle @api {
    uri strip_prefix /api
    reverse_proxy 127.0.0.1:8000
  }

  @socketio path /socket.io*
  reverse_proxy @socketio 127.0.0.1:8000

  reverse_proxy 127.0.0.1:3100
}
EOF

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=5 \
  CMD curl -fsS http://127.0.0.1:3000/api/ping >/dev/null || exit 1

VOLUME ["/var/lib/postgresql/data", "/cache/uv", "/var/lib/classifyre/runner-logs"]

ENTRYPOINT ["/init"]
