# Kestrel & Finch Journeys — governed customer data across three CRMs

A European tour operator built from mergers: **Kestrel Reisen** (Innsbruck, DACH,
a HubSpot-style CRM in PostgreSQL) merged with **Finch Tours** (Edinburgh, UK and
the Nordics, a Salesforce export as Delta tables in S3), runs the **Wayfarer Club**
loyalty programme (Iceberg through an Apache Polaris catalog), a **support desk**
(DuckLake) and a **legacy billing system** that only an ODBC driver reaches.
The same traveller lives in several of them, spelt differently. One of them,
Margarethe Albrecht, is in all five.

The workspace shows the whole governed-access chain: scan → classify columns →
owners and stewards → masks (redact, last four, hash, empty, hidden) → row filters
(region, marketing consent) → grants to groups → access requests → a shared dataset
for an outside agency → SQL connections for Metabase, Excel and Power BI over ODBC
and psql → every read in the audit trail.

## The people (organization `kestrel-finch`, password `Kestrel-Demo-2026`)

| Person | Group | Sees |
| --- | --- | --- |
| Ines Kovač | `/admins` (tenant admin) | Everything in clear, but row-filtered tables show her nothing unless a rule names her group |
| Tomasz Wierzbicki | `/data-platform` (workspace admin, owner of every source) | Every row in clear; publishes `shared.marketing.traveller_360` |
| Henrike Sauer | `/privacy-office` (steward of every source, Data reader) | Every row in clear; sets column classifications and masks |
| Lukas Brandner | `/sales/sales-dach` | Kestrel contacts and deals, DACH rows only, in clear — except the restricted `svnr` |
| Sigrid Halvorsen | `/sales/sales-nordics` | Finch contacts and opportunities, Nordic rows only, in clear |
| Amélie Fontaine | `/marketing` | Contacts of both CRMs and loyalty members, opted-in only; e-mail hashed (joins across CRMs, ignoring case), phone last four, birthday empty, national IDs and passports hidden; findings with their values hidden |
| Kwame Mensah | `/customer-care` | Support tickets, bodies with keys and numbers scrubbed out; loyalty members after an approved access request |
| Olga Lindqvist | `/finance` | Billing over ODBC: IBAN and card number last four |
| Ravi Iyer | `/bi-analysts` | Deals, opportunities and the shared dataset; Metabase admin |
| Jonas Eklund | `/agency-northlight` (Data consumer) | Only `shared.marketing.traveller_360`; no findings, assets or sources |

## Rebuild (local dev stack)

Needs the skaffold dev stack and the lakehouse lab (`development/lakehouse-lab/README.md`:
storage, catalogs, ducklake and the search-graph compose with `shop-pg`).

```bash
# 1. data into the lab services (rerunnable)
cd development/lakehouse-lab && docker compose --profile tools run --rm -T \
  -v "$PWD/../../development/kestrel-finch/seed:/kf" tools python /kf/load.py && cd -
# 2. organization, groups, people
development/kestrel-finch/setup/iam.sh
# 3. workspace, five sources, scans (~10 min)
development/kestrel-finch/run.sh workspace.py --scan
# 4. owners/stewards, column policies, grants, row filters
development/kestrel-finch/run.sh govern.py
# 5. the shared dataset, an access request, SQL connections
development/kestrel-finch/run.sh dataset.py
development/kestrel-finch/run.sh access_request.py
development/kestrel-finch/run.sh connections.py
# 6. checks: 38 persona checks, 11 ODBC checks, Metabase
development/kestrel-finch/run.sh battle.py
docker run --rm -v "$PWD/development/kestrel-finch:/kf:ro" --entrypoint python3 \
  classifyre/bi-smoke-drivers:dev /kf/clients/odbc_checks.py
kubectl -n classifyre-dev apply -f development/kestrel-finch/clients/metabase.yaml
kubectl -n classifyre-dev create configmap kf-gateway-ca --from-file=ca.crt=development/kestrel-finch/.runs/ca.crt
kubectl -n classifyre-dev port-forward svc/kf-metabase 3031:3000 &
uv run --with httpx python development/kestrel-finch/clients/metabase_setup.py
```

`.runs/` (gitignored) keeps the connection passwords,
the gateway CA, screenshots and every check's JSON evidence.

## Things a demo will hit

- The tenant admin (Ines) sees **zero rows** of row-filtered tables: filters fail closed and bind admins too. Demo filters as Lukas or Amélie, or as Tomasz (owner).
- Restarting the showcase Metabase wipes it (H2 on `emptyDir`); `metabase_setup.py` rebuilds it in a minute.
- One SQL connection allows 4 sessions; Metabase's pool takes all four, so give psql/Excel their own connection.
- Viewers see findings with their values hidden (`••••`) unless they read the table in clear; outsiders get **Data consumer**, which shows no findings at all.
- After changing `apps/cli/src/query/**`, restart the query worker (`kubectl -n classifyre-dev rollout restart deploy/classifyre-query-worker`).

The story for the blog and video is `SCENARIO.md`. The full findings are in `docs/reviews/2026-11-23-battle-test-kestrel-finch.md`.
