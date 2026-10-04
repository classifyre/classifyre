# Nova Manufacturing showcase

A fictional pump maker (three plants, twenty machines, six suppliers and foundries, four customers) and **one bad Friday**:
a delivery slips, a discount is not one, a machine is quietly failing, and the numbers disagree about all of it.

The namespace answers six business questions. Each is a *case* that tests competing explanations as hypotheses:

| Case | The question | The obvious answer that is wrong |
|---|---|---|
| Supply | The delayed housing delivery: who gets hurt, and what can we do? | "Hamburg's stock covers it", "the cheap lot fits", "we are dual-sourced" |
| Costing | Is the cheaper option really cheaper? | The 9% steel discount, the €4.00 resin deal, the higher-margin pump |
| Machines | Which machine should maintenance visit first? | The loud machine, the 190 °C alarm, the highest failure probability |
| Quality | Why are pumps leaking: the batch, the machine, or the product mix? | "It's M001", "quality collapsed in September" |
| Inventory | Plenty of stock on paper: why do we still run short? | Physical stock, an emergency purchase, a retried approval |
| Data trust | Which of our numbers can we trust? | A 380-piece shortage, a 340-unit demand, a 185° breach |

All data is synthetic. Every figure in the cases is **computed by a detector from the rows** it reads; nothing is looked up from an answer key.

## What is in the namespace

* **7 sources**, all self-contained (uploaded files, no external database or bucket): Company master data, Supply & orders,
  Purchasing & costing, Machines & maintenance, Quality & traceability, Inventory control, Data integration feeds.
* **8 detectors**: one *checks* detector per desk (Python), a *references* detector (names and codes → entity mentions) and a
  *memo statements* detector (quotes the sentences in memos that change what is allowed).
* **A glossary** of 65 concepts in 8 schemes, with a concept tree and 56 bindings that give every detector output its meaning (9 more deliberately mark plain references "no meaning");
  status codes are read through a lookup binding; connectors declare meaning with `means()`.
* **44 entities** declared by the master-data source (suppliers, foundries, customers, plants, machines, parts, pumps).
  Names and codes in any source resolve to them.
* **12 standing questions** defined by glossary concepts, **6 cases** with 4–5 hypotheses each, a dated chronology, and
  evidence linked for and against.

## Layout

```
data/            curated CSVs and memos (prepare_data.py derives them from the story pack)
connectors/      one connector per source (+ _common.py, prepended at build time)
detectors/       one code detector per desk
build/           glossary_spec, detector_spec, sources_spec, investigations, steps, run (CLI)
harness.py       runs a connector + detector locally with a stub SDK (no platform needed)
```

## Rebuild

```bash
# the API must be reachable (local dev: skaffold port-forward on 8811)
NS=nova-manufacturing python3 showcases/nova-manufacturing/build/run.py all --yes        # wipe, glossary, detectors, sources, entities, bindings, scan
NS=nova-manufacturing python3 showcases/nova-manufacturing/build/run.py investigations   # standing questions + cases
```

`wipe` empties the target namespace. Use `API_BASE` to target another server. A rehearsal in a scratch namespace is the
recommended first step (`NS=nova-lab`).

## Try the logic without the platform

```bash
python3 showcases/nova-manufacturing/harness.py supply -v
python3 showcases/nova-manufacturing/harness.py machines -v
```

## Honest limits

* Scenarios in the original story pack were independent experiments; where two of them reused the same plant and part with
  conflicting stock, one was given its own part (bearing kits, gasket sets, impellers) so the company stays self-consistent.
* No hypothetical probability is presented as a prediction, no exposure as a loss, and no proposal as an executed action.

## Shipping it to showcase.classifyre.com

The namespace is defined by configuration plus self-contained data, so there are two ways to move it:

1. **Rebuild** on the target (what the Firmenbuch showcase does): point `API_BASE` at the server, create the namespace, run
   `build/run.py all --yes` then `build/run.py investigations`. No credentials or external systems are involved.
2. **Import an archive**: `dump_files/nova-manufacturing-showcase-2026-10-04.cfyre` (git-ignored) holds sources with their uploaded files,
   assets, findings, detectors, glossary and investigations. Import it with the *Data transfer* screen or
   `POST /data-transfer/imports`.

Notes for the target instance:

* Entities must be on (the build turns them on); duplicates and embeddings are deliberately off for this namespace.
* No AI provider is needed: every detector is deterministic.
* Set the namespace's display name, description and category on the target; the build does this through `build/run.py metadata`.
