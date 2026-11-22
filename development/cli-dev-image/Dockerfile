# Local-dev only: the published classifyre/cli:latest plus what the root
# Dockerfile has added since that image was built: the system packages for
# ODBC (unixODBC and the PostgreSQL driver), and the clients of every source a
# query can read, baked and recorded (CLI_BAKED_GROUPS, kept equal to the root
# Dockerfile's; apps/cli/tests/test_query_manifest.py checks both), so the
# query worker runs on its read-only root filesystem with installing off.
# Build and load into k3d with scripts/dev/build-cli-dev-image.sh; production
# images are built from the root Dockerfile and already have all of this.
FROM classifyre/cli:latest
USER root
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends unixodbc odbc-postgresql; \
    rm -rf /var/lib/apt/lists/*
USER 10001
WORKDIR /app/apps/cli
# The checkout's project files (build context `cli`): the dev stack mounts these
# over the image's at runtime, so the groups are synced from the same lock.
COPY --from=cli --chown=10001:10001 pyproject.toml uv.lock /app/apps/cli/
ARG CLI_BAKED_GROUPS="file-processing lineage odbc postgresql mysql databricks iceberg-rest s3-compatible-storage azure-blob-storage google-cloud-storage neo4j"
RUN UV_CACHE_DIR=/tmp/uv-build UV_COMPILE_BYTECODE=1 uv sync --frozen --no-dev $(printf -- '--group %s ' ${CLI_BAKED_GROUPS}) \
    && printf '%s\n' ${CLI_BAKED_GROUPS} | .venv/bin/python -c "import json, sys; json.dump(sorted(sys.stdin.read().split()), open('.venv/.classifyre-uv-sync-groups.json', 'w'))" \
    && rm -rf /tmp/uv-build
