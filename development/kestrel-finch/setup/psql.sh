#!/usr/bin/env bash
# psql into the Kestrel & Finch workspace schema of the dev Postgres. The
# registry is in classifyre_control; the workspace schema in its tenant database.
#   setup/psql.sh -c "select …"
set -euo pipefail
POD=deploy/classifyre-postgres
q() { kubectl -n classifyre-dev exec $POD -- sh -c "psql -U \"\$POSTGRES_USER\" -d $1 -Atc \"$2\""; }
SCHEMA=$(q classifyre_control "select schema_name from namespaces where slug='kestrel-finch'")
DB=$(q classifyre_control "select 'classifyre_t_' || replace(tenant_id::text, '-', '') from namespaces where slug='kestrel-finch'")
kubectl -n classifyre-dev exec -i $POD -- sh -c "PGOPTIONS='-c search_path=$SCHEMA,public' psql -U \"\$POSTGRES_USER\" -d $DB $(printf '%q ' "$@")"
