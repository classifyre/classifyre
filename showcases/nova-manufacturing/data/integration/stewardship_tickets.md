# Data stewardship tickets

## MDM-124 — flange gasket set has three identifiers

ERP and WMS describe the same physical stock. The SAP extract predates the receipt; the WMS is authoritative for current stock, with a 60-minute freshness limit. WMS item 124-GS is packed 12 EA per BOX. GS124-A is an incompatible gasket adaptor. Manufacturing (MES) has a demand of 400 EA of GS-124; all other production constraints are met.

## CDC-61 — order feed delivers full-state messages

Order payloads carry the full state of the order. The version increases monotonically within an order_id. Retries keep the event_id. A cancelled latest version consumes no component. The source gateway can deliver an older version after a newer one. Released impeller stock is 100 EA, one component per demanded unit.

## QMS-61 — rolling device upgrade

Devices migrated during a rolling upgrade; schema v1 and v2 stay valid at the same time. Versioned field contracts determine units; do not infer units from the size of a value. Schema v3 was deployed without its registry entry, so the affected lot must stay unresolved until the producer supplies a contract. All local_event_time values in this extract are Europe/Vienna wall time (UTC+02 on these dates). The daily quality report is by plant-local calendar date, not UTC date. QC will only release known lots after the corrected measurements are reviewed; nothing has been released.
