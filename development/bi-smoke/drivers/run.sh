#!/usr/bin/env bash
# Runs every driver check against the SQL gateway; one __BI_SMOKE__ line per
# check (BIC §5.2–5.4). The spec (connection, tables, queries) and the CA come
# from the Secret bi_smoke.py writes, mounted at /spec.
set -uo pipefail
cd /opt/bi-smoke
SPEC=${1:-/spec/spec.json}

python3 - "$SPEC" > /tmp/spec.properties <<'PY'
import json, sys
s = json.load(open(sys.argv[1]))
def esc(v): return str(v).replace("\\", "\\\\").replace("\n", " ")
print(f"host={esc(s['host'])}\nport={s['port']}\ndatabase={esc(s['database'])}\nca={esc(s['ca'])}")
print(f"user={esc(s['user'])}\npassword={esc(s['password'])}")
print("tables=" + ";".join(f"{t['schema']}|{t['table']}" for t in s["tables"]))
for key, q in s["queries"].items():
    print(f"q.{key}.sql={esc(q['sql'])}")
    if q.get("params"):
        print(f"q.{key}.params=" + ",".join(str(p) for p in q["params"]))
PY

echo "== psqlODBC $(dpkg-query -W -f='${Version}' odbc-postgresql)"
python3 odbc_checks.py "$SPEC"
echo "== pgJDBC $PGJDBC_VERSION"
java -cp postgresql.jar JdbcChecks.java /tmp/spec.properties
echo "== $(psql --version)"
python3 psql_checks.py "$SPEC"
echo "== done"
