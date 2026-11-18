# Local-dev only: the published classifyre/cli:latest plus the system packages
# that image was built before (unixODBC and the PostgreSQL driver, see the root
# Dockerfile). Build and load into k3d with scripts/dev/build-cli-dev-image.sh;
# production images are built from the root Dockerfile and already have them.
FROM classifyre/cli:latest
USER root
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends unixodbc odbc-postgresql; \
    rm -rf /var/lib/apt/lists/*
USER 10001
