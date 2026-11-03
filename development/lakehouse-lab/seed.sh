#!/usr/bin/env bash
# Seed every lab service that is running. Safe to rerun: each seed rewrites its
# own tables. Start the services first (see README.md), storage always first.
set -euo pipefail
cd "$(dirname "$0")"

running() { [ -n "$(docker compose ps -q --status running "$1" 2>/dev/null)" ]; }
tools() { docker compose --profile tools run --rm -T tools python "/seed/$1" "${@:2}"; }

S3_KEYS=(s3.endpoint=http://172.19.10.10:9000 s3.access-key-id=lab-access-key
  s3.secret-access-key=lab-secret-key-0123456789 s3.path-style-access=true s3.region=us-east-1)

running s3 || { echo "storage is not running: docker compose --profile storage up -d" >&2; exit 1; }
mkdir -p ../../dump_files/lakehouse-lab
tools bucket_tables.py

if running gravitino; then
  tools iceberg_rest.py gravitino uri=http://172.19.10.20:9001/iceberg/ auth.type=noop "${S3_KEYS[@]}"
fi
if running polaris; then
  tools polaris_bootstrap.py http://172.19.10.21:8181
  # Polaris here has no STS to vend credentials with; ask for none.
  tools iceberg_rest.py polaris uri=http://172.19.10.21:8181/api/catalog warehouse=lab_polaris \
    credential=root:s3cr3t scope=PRINCIPAL_ROLE:ALL header.X-Iceberg-Access-Delegation= "${S3_KEYS[@]}"
fi
if running trino; then
  if ! running gravitino || ! running polaris; then
    echo "trino seeds Iceberg tables in Gravitino and Polaris: start the catalogs profile too" >&2
    exit 1
  fi
  tools trino_tables.py http://172.19.10.30:8080
fi
if running ducklake-pg; then
  tools ducklake.py
fi
