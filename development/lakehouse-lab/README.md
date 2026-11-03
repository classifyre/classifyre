# Lakehouse lab (dev)

Open-source lakehouse services to scan against from the local dev stack:
S3-compatible, Azure and GCS storage emulators, two Iceberg REST catalogs, Trino
and a DuckLake, each seeded with small tables that exercise the hard cases.
Those cases are deleted rows, renamed columns, Delta deletion vectors, Iceberg
merge-on-read deletes, and more rows than one sampling window. A
`lakehouse-lab` workspace is created with one source per service.

Every credential here is a local test value, and every name and e-mail in the
data is invented (`<table><n>@lab.example.com`).

```
compose.yaml        the services, in profiles
k8s-services.yaml   cluster names for them, so scan pods can reach them
seed.sh             seeds every running service (safe to rerun)
seed/               the seed scripts, plus a Paimon fixture
sources/            one Classifyre source config per service
workspace.py        creates the workspace and sources; --run scans them
tools/Dockerfile    the image the seeds run in
storage/s3.json     the S3 gateway's static keys
trino/catalog/      Trino's Iceberg (Gravitino, Polaris), Delta and Hive catalogs
```

## How it fits the dev stack

The containers run on the host's Docker, but on the **k3d cluster's own Docker
network** (`k3d-classifyre`), each at a fixed address in `172.19.10.x`.
`k8s-services.yaml` gives each address a Service in `classifyre-dev`, so a scan
pod reaches them as `lab-s3.classifyre-dev.svc:9000` and so on. This is the
same trick as `deploy/dev/ollama.yaml`.

The host can't route to `172.19.x` addresses on Docker Desktop. That's why the
seeds run in the `tools` container on the same network, and why each service
also publishes a host port for poking at it by hand.

| Service | Scan pods use | Seeds use | Host port | Sign-in |
| --- | --- | --- | --- | --- |
| S3 (SeaweedFS) | `http://lab-s3.classifyre-dev.svc:9000` | `172.19.10.10:9000` | 19000 | `lab-access-key` / `lab-secret-key-0123456789` |
| Azure (Azurite) | `http://lab-azurite.classifyre-dev.svc:10000/devstoreaccount1` | `172.19.10.11:10000` | 10000 | Azurite's well-known `devstoreaccount1` key |
| GCS (fake-gcs-server) | `http://lab-fake-gcs.classifyre-dev.svc:4443` | `172.19.10.12:4443` | 14443 | none |
| Gravitino Iceberg REST | `http://lab-gravitino.classifyre-dev.svc:9001/iceberg` | `172.19.10.20:9001` | 19101 | none |
| Polaris Iceberg REST | `http://lab-polaris.classifyre-dev.svc:8181/api/catalog` | `172.19.10.21:8181` | 18181 | OAuth2 `root` / `s3cr3t`, scope `PRINCIPAL_ROLE:ALL` |
| Trino 476 | `lab-trino.classifyre-dev.svc:8080` | `172.19.10.30:8080` | 18080 | user `lab`, no password |
| DuckLake catalog (Postgres) | `lab-ducklake-pg.classifyre-dev.svc:5432` | `172.19.10.40:5432` | 15432 | `lab` / `lab-ducklake`, database `lake` |

The local-folder source reads the copy the bucket seed writes to
`dump_files/lakehouse-lab/` (gitignored). Scan pods see it as
`/mnt/corpora/dumps/lakehouse-lab`.

## Use it

Run everything from this folder.

1. **Dev stack up**, as in [`scripts/dev/README.md`](../../scripts/dev/README.md):

   ```bash
   ../../scripts/dev/create-cluster.sh   # once
   ../../scripts/dev/start.sh            # skaffold dev --profile dev
   ```

   The lab addresses assume the cluster network is `172.19.0.0/16`. Check it
   with `docker network inspect k3d-classifyre`. If yours differs, change the
   `172.19.10.x` addresses in `compose.yaml`, `k8s-services.yaml`, `seed.sh`,
   `seed/` and `trino/catalog/`.

2. **Start the services.** Storage is always needed, and first:

   ```bash
   docker compose --profile storage up -d
   docker compose --profile catalogs --profile engines --profile ducklake up -d
   ```

   Start only what a test needs; the k3d node shares the same Docker memory.
   Trino and Polaris take about 30 s to answer.

3. **Give them cluster names** (once per cluster):

   ```bash
   kubectl --context k3d-classifyre apply -f k8s-services.yaml
   ```

4. **Seed:**

   ```bash
   ./seed.sh
   ```

   It builds the tools image the first time, then seeds whichever services are
   running. The catalogs and DuckLake keep their state in memory or in their
   container, so reseed after restarting them.

5. **Create the workspace and scan:**

   ```bash
   python3 workspace.py          # workspace + sources only
   python3 workspace.py --run    # ... and scan each, printing every asset's format and rows
   python3 workspace.py --run polaris trino   # only these sources
   ```

   Sources are matched by name, so a rerun updates them in place. Scans queue
   behind the dev stack's single scan slot. Then open
   <http://localhost:3000> and switch to **Lakehouse Lab**.

### What a correct scan shows

As measured on 2026-11-03, with the PII detector on every source. "Rows" is
the table's live rows, which is also the number of distinct e-mails found in
it.

| Source | Asset | Format | Rows | What it proves |
| --- | --- | --- | --- | --- |
| S3, Azure, local folder | `delta_orders` | delta | 11 | A deleted row stays deleted |
| S3, Azure, local folder | `iceberg_contacts` | iceberg | 11 | Rename plus delete; one `contact` column |
| S3, Azure, local folder | `lance_people.lance` | lance | 5 | Lance deletion |
| S3, local folder | `people` (`paimon_wh/crm.db/people`) | paimon | 3 | Paimon. Skipped on Azure, with a line in the run log |
| S3, Azure, local folder | `plain.csv` | — | 3 | Plain files beside tables are still files |
| S3 | `customers` (`tables/trino_delta/customers`) | delta | 5 | Trino-written: deletion vector, column mapping, renamed column |
| Gravitino, Polaris | `<catalog>.crm.contacts` | iceberg | 3 | Rename plus delete through a catalog |
| Gravitino, Polaris | `<catalog>.crm.orders` | iceberg | 25 | More rows than one sampling window |
| Gravitino, Polaris | `<catalog>.trino_crm.people` | iceberg | 4 | Trino's merge-on-read positional delete |
| Trino | `delta.crm.customers` | delta | 5 | The engine's view of the same cases |
| Trino | `iceberg.*` and `iceberg_polaris.*` | iceberg | 3 / 25 / 4 | Both catalogs' tables, through the engine |
| Trino | `hive.lab.plain_people` | native | 3 | |
| DuckLake | `lake.crm.people` | ducklake | 11 | Delete and rename in DuckLake |

`<catalog>` is the warehouse name (`lab_polaris`), or the catalog's host when
it has none (Gravitino: `lab-gravitino.classifyre-dev.svc`). The Paimon
fixture's e-mails are `@x.test`, not `@lab.example.com`.

`workspace.py` prints the row count from asset metadata, which stays empty
where the format doesn't state it exactly: catalogs and engines, DuckLake,
Paimon, and Iceberg snapshots with delete files.

To prove no deleted row was read, count findings for the deleted e-mails
table by table. Every count must be 0. Run it in the dev Postgres:
`kubectl --context k3d-classifyre -n classifyre-dev exec -it deploy/classifyre-postgres -- sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'`.

```sql
SET search_path TO <the lakehouse-lab schema from public.namespaces>, public;
WITH deleted(asset_suffix, email) AS (VALUES
  ('delta_orders', 'orders2@lab.example.com'),
  ('iceberg_contacts', 'contacts1@lab.example.com'),
  ('lance_people.lance', 'lance2@lab.example.com'),
  ('crm.contacts', 'contacts3@lab.example.com'),
  ('trino_crm.people', 'people3@lab.example.com'),
  ('customers', 'customers2@lab.example.com'),
  ('crm.people', 'ducklake2@lab.example.com'))
SELECT s.name, a.name, count(f.id) AS findings_of_deleted_row
FROM deleted d
JOIN assets a ON a.name LIKE '%' || d.asset_suffix
JOIN sources s ON s.id = a.source_id
LEFT JOIN findings f ON f.asset_id = a.id AND f.status = 'OPEN' AND f.matched_content = d.email
GROUP BY 1, 2 ORDER BY 1, 2;
```

The `sources/s3-tables.json` and `azure-tables.json` configs scan the `tables/`
prefix. Remove the prefix to scan the whole bucket, including the catalogs' and
Trino's table folders.

To try the readers without a scan, `apps/cli/.venv/bin/python` can call
`describe_table` and `iter_lakehouse_batches` from `src/utils/lakehouse_tables`
on `dump_files/lakehouse-lab/tables` with `local_table_storage`.

## The CLI image

Scan pods take Python dependencies from the CLI image's baked
`pyproject.toml`/`uv.lock`, installing optional groups at run time. The
lakehouse readers and the new sources need the `lakehouse`, `iceberg-rest`,
`trino`, `athena`, `bigquery` and `redshift` groups. A `classifyre/cli` image
built from `develop` at or after `9499fa88` has them.

When you change those dependencies and need scan pods to see it before CI
publishes an image, build one on top of the published image and point the job
template at it:

```bash
cd ../../apps/cli
printf 'FROM classifyre/cli:latest\nCOPY --chown=10001:10001 pyproject.toml uv.lock /app/apps/cli/\n' \
  | docker build -t classifyre/cli:dev-local -f - .
k3d image import classifyre/cli:dev-local -c classifyre
kubectl --context k3d-classifyre -n classifyre-dev get cm classifyre-api-cli-job-template -o json \
  | sed 's#classifyre/cli:latest#classifyre/cli:dev-local#; s#\(imagePullPolicy[^A-Za-z]*\)Always#\1IfNotPresent#' \
  | kubectl --context k3d-classifyre apply -f -
kubectl --context k3d-classifyre -n classifyre-dev rollout restart deploy/classifyre-api deploy/classifyre-worker
```

The template is a JSON string inside the ConfigMap, so its quotes are escaped;
the second `sed` expression matches around them. The API caches the template,
hence the restart. The next `skaffold dev`
deploy puts the template back to `classifyre/cli:latest`. Source edits under
`apps/cli/src` need none of this: scan pods mount them live.

## Not covered here

These need a real cloud service or another writer. Test them separately:

- **GCS:** fake-gcs-server has no XML listing API, which the GCS readers need.
  Test against a real bucket, with an HMAC key for Delta and Iceberg.
- **Hudi:** nothing here writes Hudi tables yet; that needs Spark.
- **Nessie, Lakekeeper, Unity Catalog OSS:** not in the compose file yet. Each
  speaks Iceberg REST, so a service plus a `sources/*.json` is enough to add
  one.
- **Cloud catalogs and engines:** Snowflake Open Catalog, AWS Glue and Athena,
  Amazon S3 Tables, BigLake metastore and BigQuery, Amazon Redshift, Unity
  Catalog on Databricks, Fabric/OneLake, Starburst Galaxy.

The docs page `apps/docs/app/sources/lakehouse/page.mdx` marks each format,
catalog and engine as verified or only supported. Update it when one of these
gets tested.

## Quirks

- **Gravitino is pinned to 1.0.0.** `latest` fails every write with a Jackson
  `NoSuchMethodError`.
- **Gravitino keeps its metadata in memory**, not in the bucket. Its tables can
  be read through the catalog but not by path. A restart forgets them while
  their files stay in S3, so the Trino seed clears those files when the catalog
  no longer knows the table.
- **Polaris needs `polaris.readiness.ignore-severe-issues`** to start with
  in-memory storage and bootstrap credentials. It has no STS here, so it can't
  vend credentials: readers bring the lab's S3 keys, and the Polaris source sets
  access delegation to `none`.
- **The dev stack's Postgres connection budget.** `helm/develop/values-dev.yaml`
  sizes Postgres (`max_connections: 200`) for about 8 workspaces. Every
  unpaused workspace also holds 5 pg-boss connections outside the Prisma pools.
  With about 20 unpaused, scans fail with `P2037` or `sorry, too many clients
  already`, or end as "Runner was orphaned". Pause the workspaces you aren't
  using while you test, with `{"paused": true}` through the same `PATCH` as
  below, which also stops their pg-boss. Then restart the API and worker, and
  `select count(*) from pg_stat_activity` should be near 10.
- **Azurite runs with `--disableProductStyleUrl`.** Scan pods address it by
  DNS name, and Azurite would otherwise read the host's first label as the
  account and answer every request with `ResourceNotFound`.
- **The workspaces you paused** for a lab run stay paused. Resume them with
  `curl -X PATCH -H 'content-type: application/json' -d '{"paused": false}'
  http://127.0.0.1:8811/namespaces/<id>`.
- **SeaweedFS stands in for MinIO**, which no longer publishes community images.
  Its data lives in an anonymous volume that survives `up --force-recreate`.

## Reset

```bash
docker compose --profile storage --profile catalogs --profile engines --profile ducklake down -v
kubectl --context k3d-classifyre delete -f k8s-services.yaml
rm -rf ../../dump_files/lakehouse-lab
```

To remove the workspace too:

```bash
curl -s http://127.0.0.1:8811/namespaces | python3 -c "import json,sys; print(next(n['id'] for n in json.load(sys.stdin) if n['slug']=='lakehouse-lab'))" \
  | xargs -I{} curl -s -X DELETE http://127.0.0.1:8811/namespaces/{}
```
