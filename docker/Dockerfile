# syntax=docker/dockerfile:1.7
#
# Classifyre all-in-one — the whole product in one container.
#
# For trying Classifyre out on a laptop, and for small single-investigator
# installs. It is NOT the production path: for that, use the Helm chart, which
# runs this same code as separate api / worker / web / CLI-Job workloads.
#
# ── Nothing is built here ─────────────────────────────────────────────────────
# This file only assembles. Every artifact it needs is produced outside it, by
# the GitHub Actions workflow (or by hand — see docker/README.md):
#
#   <ns>/api:<tag>   → /app          the compiled API, its node_modules, Prisma
#   <ns>/web:<tag>   → /app/web      the built Next.js standalone server
#   <ns>/cli:<tag>   → /app/apps/cli the Python venv and sources
#   build-context `models` → the pre-fetched embedding model
#
# Composing the three published service images, rather than re-building from
# source, is what keeps this image and the Kubernetes ones provably identical:
# there is exactly one build of the application, and both distributions ship it.
#
# All three are bookworm/glibc 2.36 — api and web are node:24-bookworm-slim, cli
# is python:3.12-slim-bookworm — so the Prisma engines (debian-openssl-3.0.x)
# and the native Python wheels move across unchanged.
#
# ── Versions ──────────────────────────────────────────────────────────────────
# Base images are pinned as literal `FROM` tags so Dependabot can see and bump
# them (see .github/dependabot.yml — they are grouped with the root Dockerfile's
# into a single PR). Two pins it cannot reach are ARGs below.
#
# The Python and Node majors are NOT free choices: the CLI's virtualenv is built
# against Python 3.12, and the API's native addons (Prisma's query engine,
# onnxruntime) are compiled for Node 24's ABI. Track patch releases within those
# majors; changing a major means changing the service images first.

ARG BASE_TAG=latest
ARG IMAGE_NS=classifyre

# Not Dependabot-updatable: a GitHub release tarball fetched by curl, and an apt
# repository. Check them when touching this file.
#   s6-overlay https://github.com/just-containers/s6-overlay/releases
#   postgres   https://www.postgresql.org/support/versioning/
ARG S6_OVERLAY_VERSION=3.2.3.2
ARG PG_MAJOR=18

# ── Sources of binaries (Dependabot keeps these current) ──────────────────────
FROM ghcr.io/astral-sh/uv:0.12.11 AS uv-bin
FROM caddy:2.11.4 AS caddy-bin
FROM node:24.20.0-bookworm-slim AS node-bin

# ── The application, already built ────────────────────────────────────────────
FROM ${IMAGE_NS}/api:${BASE_TAG} AS api-image
FROM ${IMAGE_NS}/web:${BASE_TAG} AS web-image
FROM ${IMAGE_NS}/cli:${BASE_TAG} AS cli-image

# The embedding model, fetched outside this build and injected as a context:
#   --build-context models=<dir>
# Baking it is what lets EMBEDDING_ALLOW_REMOTE_MODELS default to false: the
# first scan embeds immediately, offline, instead of blocking on a download.
FROM models AS models-source

# ── runtime ───────────────────────────────────────────────────────────────────
# Based on the same image the CLI is, so the virtualenv's interpreter, its
# symlinks and every native wheel it carries are the ones they were built for.
FROM python:3.12.14-slim-bookworm AS runtime

ARG TARGETARCH
ARG PG_MAJOR
ARG S6_OVERLAY_VERSION

ENV DEBIAN_FRONTEND=noninteractive \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PATH=/command:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    PG_MAJOR=${PG_MAJOR}

# ── System packages ───────────────────────────────────────────────────────────
# One third-party apt repository, not three: Node and Caddy are copied as
# binaries from their official images above, which both removes two repos and
# puts their versions where Dependabot can see them. PostgreSQL has to come from
# PGDG — a server is not a binary you can copy, it needs its extension
# directory, locales and initdb scaffolding.
#
# `create_main_cluster = false` stops the postgresql package's postinst from
# initialising a cluster during the build: PGDATA is a volume, and the cluster
# is created on first boot instead.
#
# The X/GTK libraries are Playwright's, for the browser-driven sources.
# libgl1 + libglib2.0-0 are opencv's, pulled in by the OCR path. git and
# openssh-client are the Git source, which speaks the wire protocol through the
# binary rather than a REST API — without openssh-client, only http(s) remotes
# can be scanned. libstdc++6/libgcc/libatomic1 are what the copied Node binary
# links against.
#
# The libreoffice-*-nogui packages (+397 MB) are what make legacy .doc/.xls/.ppt
# readable, via `soffice --headless` (apps/cli/src/utils/legacy_office.py). They
# are unconditional, not optional: the CLI's on-demand installer handles
# *Python* dependency groups only, so a build without them turns those formats
# into an ENGINE_UNAVAILABLE finding that the person running the container has
# no way to fix. -core carries the conversion engine; writer/calc/impress carry
# the .doc / .xls / .ppt import filters — dropping any one of them silently
# turns that format back into an empty asset.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      bash ca-certificates curl gnupg procps xz-utils openssl; \
    install -d -m 0755 /etc/apt/keyrings; \
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      | gpg --dearmor -o /etc/apt/keyrings/postgresql.gpg; \
    echo "deb [signed-by=/etc/apt/keyrings/postgresql.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list; \
    mkdir -p /etc/postgresql-common; \
    echo "create_main_cluster = false" > /etc/postgresql-common/createcluster.conf; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
      postgresql-${PG_MAJOR} \
      postgresql-client-${PG_MAJOR} \
      postgresql-${PG_MAJOR}-pgvector \
      git openssh-client \
      libstdc++6 libgcc-s1 libatomic1 \
      libgl1 libglib2.0-0 \
      fonts-dejavu-core fonts-liberation \
      libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 libcairo2 \
      libcups2 libdbus-1-3 libdrm2 libgbm1 libnspr4 libnss3 libpango-1.0-0 \
      libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxdamage1 libxext6 \
      libxfixes3 libxkbcommon0 libxrandr2 libxshmfence1 libxtst6 \
      libreoffice-core-nogui libreoffice-writer-nogui \
      libreoffice-calc-nogui libreoffice-impress-nogui; \
    rm -rf /var/lib/apt/lists/*; \
    ls /usr/share/postgresql/${PG_MAJOR}/extension/vector.control; \
    HOME=/tmp/soffice-check soffice --version; rm -rf /tmp/soffice-check

# Node and Caddy as single binaries from their official images. Node needs
# nothing but the C++ runtime installed above; Caddy is a static Go binary.
COPY --from=node-bin  /usr/local/bin/node  /usr/local/bin/node
COPY --from=caddy-bin /usr/bin/caddy       /usr/local/bin/caddy

# `uv` is not optional: the API launches every scan as
# `uv run --locked --no-dev --python <venv>/bin/python -m src.main extract …`
# (apps/api/src/cli-runner/cli-runner.service.ts), and uv is also what installs
# the optional Python dependency groups on first use.
COPY --from=uv-bin /uv /uvx /usr/local/bin/

RUN set -eux; node --version; caddy version; uv --version; git --version; ssh -V

# ── s6-overlay ────────────────────────────────────────────────────────────────
# One container, five processes: postgres, api, web, caddy, and a one-shot
# first-run bootstrap. s6 supervises them, restarts what dies, and forwards
# signals — which is what makes `docker stop` and `docker restart` behave.
RUN set -eux; \
    case "${TARGETARCH}" in \
      amd64) s6_arch="x86_64" ;; \
      arm64) s6_arch="aarch64" ;; \
      *) echo "Unsupported TARGETARCH: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    base="https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}"; \
    curl -fsSL "${base}/s6-overlay-noarch.tar.xz" -o /tmp/s6-noarch.tar.xz; \
    curl -fsSL "${base}/s6-overlay-${s6_arch}.tar.xz" -o /tmp/s6-arch.tar.xz; \
    tar -C / -Jxpf /tmp/s6-noarch.tar.xz; \
    tar -C / -Jxpf /tmp/s6-arch.tar.xz; \
    rm -f /tmp/s6-noarch.tar.xz /tmp/s6-arch.tar.xz

# ── Application payload ───────────────────────────────────────────────────────
# Order matters: the api image owns /app (node_modules + api/ + packages/), the
# web image nests under /app/web, and the CLI slots into /app/apps/cli, which
# the api image does not use.
COPY --from=api-image /app /app
COPY --from=web-image /app /app/web
COPY --from=cli-image /app/apps/cli /app/apps/cli

ENV HOME=/home/classifyre \
    PGDATA=/var/lib/postgresql/data \
    UV_LINK_MODE=copy \
    UV_CACHE_DIR=/cache/uv \
    EMBEDDING_CACHE_DIR=/opt/classifyre/models \
    RUNNER_LOG_DIR=/var/lib/classifyre/runner-logs \
    PLAYWRIGHT_BROWSERS_PATH=/var/lib/classifyre/playwright

# Immutable image content, deliberately outside every declared VOLUME below: a
# bind mount over /var/lib/classifyre would otherwise hide the model, and with
# EMBEDDING_ALLOW_REMOTE_MODELS=false there would be no way to fetch it back.
COPY --from=models-source / /opt/classifyre/models
COPY rootfs/ /
COPY entrypoint.sh /entrypoint.sh

# ── Users, directories, permissions ───────────────────────────────────────────
# uid 10001 matches all three service images and the chart's podSecurityContext,
# so the Prisma engines and the Python venv copied above are already owned
# correctly. s6 itself runs as root and drops to the right user per service.
#
# api-final creates /node_modules and /packages symlinks at the filesystem root,
# outside /app, so COPY did not bring them; Node's resolver and the Python
# schemas package both depend on them.
#
# HOME must be a directory uid 10001 owns, and must NOT be /tmp: LibreOffice,
# fontconfig and tldextract all resolve a cache directory from it, and a
# root-owned $HOME/.cache silently makes tldextract refetch the Public Suffix
# List over HTTP on every start.
RUN set -eux; \
    ln -sfn /app/node_modules /node_modules; \
    ln -sfn /app/packages /packages; \
    groupadd -g 10001 classifyre; \
    useradd -u 10001 -g 10001 -r -m -d /home/classifyre classifyre; \
    mkdir -p \
      "${PGDATA}" /var/run/postgresql \
      "${UV_CACHE_DIR}" "${EMBEDDING_CACHE_DIR}" "${RUNNER_LOG_DIR}" \
      "${PLAYWRIGHT_BROWSERS_PATH}" \
      /data /var/lib/classifyre/tmp; \
    chown -R postgres:postgres /var/lib/postgresql /var/run/postgresql; \
    chmod 700 "${PGDATA}"; \
    chown -R 10001:10001 \
      /app/apps/cli /app/packages "${UV_CACHE_DIR}" "${EMBEDDING_CACHE_DIR}" \
      "${RUNNER_LOG_DIR}" "${PLAYWRIGHT_BROWSERS_PATH}" /home/classifyre \
      /var/lib/classifyre/tmp; \
    chmod +x /entrypoint.sh /opt/classifyre/*.sh; \
    find /etc/s6-overlay/s6-rc.d -type f \( -name run -o -name up -o -name finish \) -exec chmod +x {} +

# ── Runtime configuration ─────────────────────────────────────────────────────
# Every value here is a default the operator can override with `docker run -e`.
# entrypoint.sh fills in the resource-dependent ones (Node heap, Postgres
# buffers, concurrency) from the container's actual limits, and never overwrites
# something already set. See README.md for the full reference.
ENV PORT_HTTP=3000 \
    API_PORT=8000 \
    WEB_PORT=3100 \
    PGPORT=5432 \
    POSTGRES_USER=postgres \
    POSTGRES_DB=classifyre \
    ENVIRONMENT=docker \
    SERVICE_ROLE=all \
    CLI_PATH=/app/apps/cli \
    VENV_PATH=/app/apps/cli/.venv \
    UV_PROJECT_ENVIRONMENT=/app/apps/cli/.venv \
    TEMP_DIR=/var/lib/classifyre/tmp \
    NEXT_PUBLIC_API_URL=/api \
    EMBEDDING_ALLOW_REMOTE_MODELS=false \
    CLASSIFYRE_CLI_AUTO_INSTALL_OPTIONAL_DEPS=1 \
    CLASSIFYRE_PLAYWRIGHT_INSTALL_WITH_DEPS=0 \
    CLASSIFYRE_BOOTSTRAP_NAMESPACE=default \
    CLASSIFYRE_ALLINONE=1

EXPOSE 3000

# start-period is generous on purpose: a first boot initialises the database
# cluster, applies every migration, and provisions the bootstrap workspace's
# ~1,100 tables. On a slow laptop disk that is minutes, and a shorter window
# would report a perfectly healthy container as unhealthy while it works.
HEALTHCHECK --interval=30s --timeout=10s --start-period=300s --retries=5 \
  CMD curl -fsS "http://127.0.0.1:${PORT_HTTP}/api/ping" >/dev/null || exit 1

VOLUME ["/var/lib/postgresql/data", "/cache/uv", "/var/lib/classifyre"]

ENTRYPOINT ["/entrypoint.sh"]
