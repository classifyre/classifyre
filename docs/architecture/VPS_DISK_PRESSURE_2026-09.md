# VPS disk pressure, 2026-09-19 — correlation fan-out and temp-file spill

> Status: mitigated on the showcase VPS (`~/.kube/config-classifyre-vps`,
> namespace `classifyre`). The code-level cap is still open — see
> [What is still open](#what-is-still-open).
> Earlier incident on the same node (pg-boss job history): see the
> `scripts/vps-disk-cleanup.sh` header and [STORAGE_RECLAIM.md](STORAGE_RECLAIM.md).

## Symptom

The single-node k3s VPS (99 GB root disk) flipped between `DiskPressure` and
normal **130 times in 46 hours**. Every flip evicted whatever was running:
Postgres, API, web, worker and CLI extract jobs. The `classifyre` namespace had
accumulated **281 dead pods** (Evicted / Error / ContainerStatusUnknown, plus
"Completed" Postgres replicas left behind by the ReplicaSet).

`df` never looked critical in a snapshot (13 GB free, 87%). The kubelet hard
eviction threshold is 5% of the disk (`5273399784` bytes). The pressure came
from **short bursts of more than 7 GB**, and each burst cleared itself as soon
as the eviction killed the process that caused it.

## Root cause

Two things combined.

### 1. The duplicate engine paired every holder of a category value

`firmenbuch-austria` (`ns_1ed62d27c51e4a96b13a4331e3ed9bd2`) had grown to 37 GB of
the 42 GB database:

| table | size | rows |
|---|---|---|
| `edges` (`related` + `likely_duplicate`) | 17 GB | 23.5M |
| `correlation_pair_signatures` | 11 GB | 19.1M |
| `asset_chunks` | 4.8 GB | 2.6M |

The scorer skips a value only when more than `FANOUT_CAP = 2000` assets hold it
(`hubValuesCte`, `correlation.service.ts`). Below that, every holder is paired
with every other: C(n, 2) pairs, so a value on 2,000 assets alone gives about 2M pairs.

The LLM `tag_*` labels in this workspace are **categorical**, not identifiers:
registry court, NACE industry code, register status, legal form, officer role,
capitalisation band. Distribution of implied pairs, by how many assets share a
value:

| assets per value | values | implied pairs |
|---|---|---|
| 2–10 | 27,552 | 72k |
| 11–200 | 399 | 624k |
| 201–500 | 39 | 2.1M |
| **501–2000** | **31** | **20.1M** |
| > 2000 (excluded as hubs) | 26 | — |

**70 values out of about 42,000 produced 22M of the 23.5M pairs.**
`tag_registry_court` alone (18 values, e.g. "Landesgericht Innsbruck" on 1,933
companies) produced 10.6M. The one real identifier in the corpus,
`regex_at_firmenbuchnummer`, produced 171k.

A single shared category scored 0.36–0.85 under the default label weight of 1,
comfortably above `RELATED_MIN = 0.3`. So "both registered in Innsbruck" became
a `related` edge.

### 2. Every recompute spilled that pair set to disk

The pairwise aggregation runs as one `INSERT … SELECT` in Postgres, and
`temp_file_limit` was unset (`-1`). `pg_stat_database.temp_bytes` stood at **5.6 TB
written** since the stats were last reset. The temp files live in
`$PGDATA/base/pgsql_tmp`, on the local-path PV, and that PV is the node's root filesystem.
So each recompute pushed free space below the 5% line. The kubelet then evicted Postgres,
which deleted the temp files and cleared the pressure. The correlation job was
retried, and the cycle repeated. About 14 correlation jobs sat "active" in pg-boss
at any time, each claimed by a worker that had since been killed.

Each recompute also deleted and rewrote the 23.5M edges (51M inserts and 28M
deletes on `edges` overall), so dead tuples and WAL made it worse.

## What was done

All steps ran against the live showcase. Order matters: the tables were emptied
**before** the exclusions were saved. Otherwise the recompute would have had to
delete 23.5M rows (more WAL and dead tuples) to reach the same end state.

1. **Deleted the dead pods**: Failed-phase pods, plus Succeeded pods owned by a
   ReplicaSet. Job pods were left alone, since Job TTL handles them.
2. **Rewrote the correlation tables** in one transaction, keeping everything
   except the scored relation types:
   ```sql
   SET search_path = ns_1ed62d27c51e4a96b13a4331e3ed9bd2;
   BEGIN;
   LOCK TABLE edges, correlation_pair_signatures IN ACCESS EXCLUSIVE MODE;
   CREATE TEMP TABLE keep_edges AS
     SELECT * FROM edges WHERE relation_type NOT IN ('related', 'likely_duplicate');
   TRUNCATE edges, correlation_pair_signatures;
   INSERT INTO edges SELECT * FROM keep_edges;   -- 143,058 lineage edges
   COMMIT;
   ```
   Neither table has incoming foreign keys or triggers. This took 18 s, compared with an estimated
   `VACUUM FULL` of a 17 GB table on a disk that did not have 17 GB free.
   **Database: 43 GB → 14 GB. Disk: 13 GB → 40 GB free.**
3. **Excluded the categorical labels** in `correlation_config.exclusions`
   (mode `label`, ids `cat-*`). The workspace had no config row before this.
   Excluded: `tag_accounts_filing_gap`, `tag_adverse_register_status`,
   `tag_balance_sheet_size_class`, `tag_company_age`, `tag_document_kind`,
   `tag_industry_nace`, `tag_legal_form`, `tag_mandate_concentration`,
   `tag_officer_role`, `tag_register_churn`, `tag_register_status`,
   `tag_registry_court`, `tag_regulated_institution`,
   `tag_representation_power`, `tag_shell_company_risk`,
   `tag_thin_capitalisation`, `tag_trade_category`, `tag_trade_licence_access`.
   Kept: the identifiers (`regex_at_firmenbuchnummer`, `regex_at_uid`,
   `regex_lei`) and the tags whose values are nearly unique per company
   (`tag_financial_distress`, `tag_growth_signal`, `tag_operating_scale`, the
   rating labels). Saving the config queues a full recompute.
   The showcase runs in demo mode, so the write went over REST with
   `X-Bypass-Demo`, through a `kubectl port-forward` to `svc/classifyre-api`.
   Anonymous `PUT` was re-checked afterwards and still returns 403.
4. **Capped Postgres temp files**:
   `ALTER SYSTEM SET temp_file_limit = '8GB'; ALTER SYSTEM SET log_temp_files = '1GB';`
   A runaway query now fails with an error instead of evicting the whole node,
   and anything over 1 GB is logged. This is stored in `postgresql.auto.conf`
   on the PV, so it survives restarts but is **not** in the Helm chart.
5. Ran `scripts/vps-disk-cleanup.sh`, which cleans pods, containerd, Docker,
   journald and pg-boss history older than 7 days. It found only about 200 MB more; pg-boss
   was already clean after the 2026-09-12 retention fix.

## Result after the recompute

The full recompute under the new exclusions took about 65 minutes (11:45–12:50 UTC).
The worker was competing with extract jobs for CPU.

| | before | after |
|---|---|---|
| `likely_duplicate` + `related` edges | 23.5M (17 GB) | 186,809 (edges table 254 MB incl. lineage) |
| `correlation_pair_signatures` | 19.1M (11 GB) | 186,809 in 670 patterns |
| `asset_correlation_values` | 341,788 rows | 97,901 rows (318 MB) |
| database | 43 GB | 14 GB |
| root disk | 87% (13 GB free) | 59% (40 GB free) |
| temp written by the recompute | several GB per run, until eviction | about 2 GB, no eviction |
| DiskPressure transitions | 130 in 46 h | 0 since 11:41 UTC |

The top match is now two shared Firmenbuchnummern, which is the identifier the
Duplicate Review queue is meant to surface.

## What each cleanable dataset costs you

Everything below is derived data. Wiping it never touches findings, assets,
sources, cases, inquiries or the glossary. The real cost is how long features stay empty
and how much work the rebuild takes.

| dataset | what goes empty until rebuilt | rebuilt by | notes |
|---|---|---|---|
| Duplicates (`correlation_*`, `asset_correlation_values`, clusters, `related`/`likely_duplicate` edges) | Duplicate Review queue and portfolio, similar-asset links in the graph, autopilot duplicates finder, fingerprint MCP tools | next correlation scan / recompute | `correlation_pair_verdicts` (human decisions) is kept and re-applies by pair. **Regrows to the same size unless the tuning changes.** |
| Embeddings (`content_embeddings`, `asset_chunks`) | semantic finding search, case leads, glossary matching, autopilot semantic search | async re-embed of every chunk | hours of worker CPU on this node, with an OOM history. Not worth it here: 5.7 GB of real content that is not growing |
| Lineage edges (`REFERENCES`, `SAME_AS`, `TRANSFORM`, `CONTAINS`, `ACCESSED`) | asset lineage | **only a source rescan** | never `TRUNCATE edges`. Filter by `relation_type` |

**Gap in the Cleanup tab — closed 2026-09-19.** The `duplicates` key in
`apps/api/src/maintenance/maintenance.datasets.ts` did not list `edges`,
because `edges` is registered as protected under `assets`. So the 17 GB of
scored edges was exactly the part the Cleanup tab could not remove. It now
carries `sharedRows` (`relation_type IN ('related', 'likely_duplicate',
'identical_content')`), the overview splits the table's size between Assets
(lineage) and Duplicate artefacts (scored) using `pg_stats`, and the wipe
either rewrites the table keeping lineage — the runbook's step 2, when the
scored rows dominate — or deletes them by `ctid` block range. The table is
never truncated whole.

## Switching the engines off (shipped 2026-09-19)

The operator lever this incident asked for: **Settings → Cleanup › Features**
now carries an on/off switch for the two engines that produce this storage —
**duplicate detection** and **embeddings** — and turning one off asks whether
to keep its data (a pause) or delete it.

- `correlation_config.enabled` / `embedding_settings.enabled` (+ `disabled_mode`,
  `enabled_changed_at`), read everywhere with a five-second cache, so an API
  pod and a worker pod converge without a restart.
- The feature's queues are **held** in `public.worker_queue_pauses`
  (`feature` column): every replica stops fetching within one flush, the
  Workers tab shows *Held · &lt;feature&gt; off*, and a manual resume is refused
  with 409 until the switch goes back on.
- `correlation.scan` also carried the post-scan hand-off to the autopilot, so
  the hand-off moved to its own queue (`autopilot.handoff`) for the off case;
  jobs already waiting are re-routed when the switch flips. A running full
  recompute stops at its next page and is logged as skipped.
- "Delete" runs as a normal cleanup run: duplicates wipe their tables plus the
  scored `edges` rows under the correlation lock; embeddings drop each space's
  HNSW index and pg-boss queues, truncate vectors/analyses/chunks/spaces and
  reset `findings.importance_score` (TRUNCATE fires no row trigger).
- Turning back on catches up: one full recompute for duplicates, a backfill
  for embeddings. Embeddings off keeps collecting text chunks (the scan cache
  never re-sends them); off **and deleted** stops collecting, and the docs say
  a full rescan is the way back.

Smoke-tested end to end on `classifyre-dev` in a throwaway workspace
(`feature-switch-smoke`): off/keep, scan while off (hand-off still ran, no
duplicate work), delete (66 scored edges gone, the lineage edge kept, findings
untouched), on (recompute rebuilt 66 pairs), embeddings on from the
deployment default of off (worker pod bound and embedded within 20 s),
delete (vectors/chunks/analyses/indexes gone, 24 importance scores reset),
on again, and a full rescan restoring the chunks.

Docs: `apps/docs/app/settings/cleanup`, `.../settings/embeddings`,
`.../settings/workers`, `.../duplicates`.

## What is still open

- **The switch is a lever, not the fix.** A workspace that wants duplicate
  review still gets this corpus's fan-out; the items below are what make the
  engine affordable rather than optional.
- **`FANOUT_CAP = 2000` bounds nothing that matters.** It is an owner count, and
  the cost is that count squared. At 200 (the value of `CANDIDATE_CAP`,
  which is defined in `correlation.constants.ts` as a "cap on candidate assets
  scored against one asset" but referenced nowhere), this corpus's implied
  pairs fall from about 23M to about 0.7M before any exclusions. Alternatives: a
  per-value pair budget, or treating a label whose values are shared by a large
  fraction of its holders as categorical automatically. Any change needs the
  review-queue before/after that
  [STORAGE_RECLAIM.md](STORAGE_RECLAIM.md#reconciled-still-hypotheses-the-two-too-common-caps)
  asks for.
- **Every new workspace with LLM tag detectors will do this again.** The
  exclusions above are per namespace. Nothing marks a custom label as
  categorical when it is defined.
- **`temp_file_limit` belongs in the chart**, not only in `postgresql.auto.conf`.
  A fresh PV loses it.
- **Postgres gets evicted with everything else.** It is Guaranteed for CPU and
  memory (2 CPU / 4Gi), but no pod declares an ephemeral-storage request. Its
  temp files sit on the PV, where the kubelet does not charge them to the pod.
  Under DiskPressure the kubelet ranks pods by ephemeral usage over their request, then by
  priority, and all pods share `classifyre-service-standard`. So the database
  that fills the disk is evicted as readily as a CLI job, and the eviction is
  what "fixes" the pressure.
- **Zombie pg-boss jobs.** Jobs claimed by a worker that was killed stay `active`
  until `expire_seconds` (10,800 s for per-source correlation scans), then
  retry.

## Runbook

```bash
export KUBECONFIG=~/.kube/config-classifyre-vps

# Is it flapping? (count of transitions is the tell, not a single df)
kubectl describe node | grep -E "DiskPressure"
kubectl get events -A | grep -c NodeHasDiskPressure

# Standard cleanup (pods, jobs, images, logs, pg-boss history)
./scripts/vps-disk-cleanup.sh --dry-run
./scripts/vps-disk-cleanup.sh

# Host shell when pods cannot schedule under DiskPressure
ssh -p 47819 debian@144.217.166.247
```

What to look at inside Postgres, in this order:

```sql
-- 1. temp spill (cumulative; a TB-scale number means a query is spilling per run)
SELECT temp_files, pg_size_pretty(temp_bytes) FROM pg_stat_database WHERE datname = current_database();

-- 2. which schema, then which table
SELECT n.nspname, pg_size_pretty(sum(pg_total_relation_size(c.oid)))
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r','m') GROUP BY 1 ORDER BY sum(pg_total_relation_size(c.oid)) DESC;

-- 3. if edges / correlation_pair_signatures dominate: which values fan out
WITH g AS (SELECT label, value_hash, count(*) n FROM asset_correlation_values GROUP BY 1, 2)
SELECT label, count(*) values, max(n) max_owners,
       sum(n*(n-1)/2) FILTER (WHERE n <= 2000) implied_pairs
FROM g GROUP BY 1 ORDER BY 4 DESC NULLS LAST LIMIT 25;
```

A label with few distinct values and hundreds of holders per value is a
category. Exclude it in the workspace's correlation settings (mode `label`),
empty the scored edges as in step 2 above, and let the recompute rebuild them.
