#!/usr/bin/env bash
# Runs one of the showcase's Python scripts with its dependencies.
#   development/kestrel-finch/run.sh setup/workspace.py --scan
cd "$(dirname "$0")/setup"
exec uv run -q --with httpx --with pyarrow --with 'psycopg[binary]' python "${@/#setup\//}"
