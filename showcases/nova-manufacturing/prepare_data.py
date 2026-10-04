#!/usr/bin/env python3
"""One-off curation of the Nova Manufacturing story data into a showcase package.

The story was authored as 18 independent puzzles, each tagged with a ``case_id``
and kept in per-puzzle folders. A showcase needs one company, so this script:

* splits and renames every table by what it *is* (``truck_slots.csv``), not by
  which puzzle it belonged to (``01_supplier_disruption/data/lanes.csv``);
* drops ``case_id`` and ``row_id`` (puzzle bookkeeping that means nothing to a
  planner);
* gives the few puzzles that reused the same plant/component with conflicting
  stock their own component, so two desks never disagree about one shelf.

Facilitator material (answer keys, SQL, validators) is never read.
Run once; the output under ``data/`` is committed and is the package of record.
"""
from __future__ import annotations

import csv
import shutil
import sys
from pathlib import Path

SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(
    "/Users/andrii.fedorenko/development/onedata/metadata-management-server/demo_cases/nova_manufacturing"
)
OUT = Path(__file__).parent / "data"


def read(rel: str, case: str | None = None) -> list[dict[str, str]]:
    with open(SRC / rel, newline="") as fh:
        rows = list(csv.DictReader(fh))
    if case is not None:
        rows = [r for r in rows if r.get("case_id") == case]
    return rows


def write(desk: str, name: str, rows: list[dict[str, str]], cols: list[str] | None = None) -> None:
    d = OUT / desk
    d.mkdir(parents=True, exist_ok=True)
    cols = cols or [c for c in rows[0].keys() if c not in ("case_id", "row_id")]
    with open(d / name, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore", lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    print(f"{desk}/{name}: {len(rows)} rows")


def remap(rows, col, old, new):
    for r in rows:
        if r.get(col) == old:
            r[col] = new
    return rows


# ───────────────────────────── master data ─────────────────────────────
for f in ("suppliers", "customers", "plants", "machines", "products", "bill_of_materials"):
    write("master", f"{f}.csv", read(f"shared/data/{f}.csv"))

components = read("shared/data/components.csv")
for c in components:
    if c["component_id"] == "C999":
        c["description"] = "Gasket adaptor (looks alike, not interchangeable)"
    if c["component_id"] == "C100":
        c["description"] = "Seal cartridge"
components += [
    {"component_id": "CGSK", "description": "Flange gasket set (packed 12 per box)", "base_uom": "EA"},
    {"component_id": "CIMP", "description": "Pump impeller", "base_uom": "EA"},
]
write("master", "components.csv", components)

# ───────────────────────────── supply & orders ─────────────────────────
wo = {r["sales_order_id"]: r for r in read("01_supplier_disruption/data/work_orders.csv", "S01-A")}
orders = []
for so in read("01_supplier_disruption/data/sales_orders.csv", "S01-A"):
    w = wo[so["sales_order_id"]]
    orders.append({
        "sales_order_id": so["sales_order_id"], "work_order_id": w["work_order_id"],
        "customer_id": so["customer_id"], "plant_id": w["plant_id"], "product_id": w["product_id"],
        "units": w["quantity"], "material_need_date": w["material_need_date"],
        "priority": w["priority"], "revenue_eur": so["revenue_eur"],
    })
write("supply", "orders.csv", orders)
write("supply", "housing_stock.csv", read("01_supplier_disruption/data/inventory.csv", "S01-A"))
write("supply", "inbound_orders.csv", read("01_supplier_disruption/data/purchase_orders.csv", "S01-A"))
write("supply", "truck_slots.csv", read("01_supplier_disruption/data/lanes.csv", "S01-A"))
write("supply", "sanitary_requirement.csv", read("01_supplier_disruption/data/urgent_demand.csv", "S01-B"))
write("supply", "supplier_offers.csv", read("01_supplier_disruption/data/offers.csv", "S01-B"))
booked = read("01_supplier_disruption/data/sourcing_plan.csv", "S01-C")
for r in booked:  # due dates are stated in the supplier note (booked 8 Oct; Nord's lot deliverable by 7 Oct)
    r["due_date"] = "2026-10-08" if r["status"] == "BOOKED" else "2026-10-07"
write("supply", "booked_supply.csv", booked)
write("supply", "casting_sources.csv", read("01_supplier_disruption/data/supplier_dependencies.csv", "S01-C"))
write("supply", "outage_notices.csv", read("01_supplier_disruption/data/disruptions.csv", "S01-C"))
for f, n in (("recovery_offer", "recovery_offer"), ("engineering_release", "engineering_release"),
             ("recovery_transport", "recovery_transport")):
    write("supply", f"{n}.csv", read(f"01_supplier_disruption/continuation/data/{f}.csv", "S01-A"))

# ───────────────────────────── purchasing & costing ────────────────────
write("costing", "steel_quotes.csv", read("02_material_optimization/data/material_quotes.csv", "S02-A"))
resin = read("02_material_optimization/data/bulk_offers.csv", "S02-B")
for r in resin:  # both offers arrive on 3 October (commercial notes)
    r["arrival_date"] = "2026-10-03"
write("costing", "resin_offers.csv", resin)
write("costing", "resin_forecast.csv", read("02_material_optimization/data/forecast.csv", "S02-B"))
write("costing", "pump_options.csv", read("02_material_optimization/data/production_options.csv", "S02-C"))
write("costing", "finishing_capacity.csv", read("02_material_optimization/data/capacity.csv", "S02-C"))
write("costing", "process_trials.csv", read("02_material_optimization/continuation/data/process_trials.csv", "S02-A"))
write("costing", "process_release.csv", read("02_material_optimization/continuation/data/process_release.csv", "S02-A"))

# ───────────────────────────── machines & maintenance ──────────────────
write("machines", "telemetry.csv", read("03_asset_health/data/telemetry.csv", "S03-A"))
write("machines", "maintenance_history.csv", read("03_asset_health/data/maintenance_history.csv", "S03-A"))
write("machines", "open_orders.csv", read("03_asset_health/data/production_exposure.csv", "S03-A"))
write("machines", "sensor_packets.csv", read("03_asset_health/data/sensor_packets.csv", "S03-B"))
write("machines", "sensor_registry.csv", read("03_asset_health/data/sensor_registry.csv", "S03-B"))
write("machines", "maintenance_options.csv", read("03_asset_health/data/maintenance_options.csv", "S03-C"))
write("machines", "crew_capacity.csv", read("03_asset_health/data/crew_capacity.csv", "S03-C"))
write("machines", "service_records.csv", read("03_asset_health/continuation/data/service_records.csv", "S03-A"))
write("machines", "post_service_telemetry.csv", read("03_asset_health/continuation/data/post_service_telemetry.csv", "S03-A"))

# ───────────────────────────── quality & traceability ──────────────────
write("quality", "batches.csv", read("04_quality_investigation/data/batches.csv", "S04-A"))
write("quality", "inspections.csv", read("04_quality_investigation/data/inspections.csv", "S04-A"))
write("quality", "shipments.csv", read("04_quality_investigation/data/shipments.csv", "S04-A"))
write("quality", "mix_inspections.csv", read("04_quality_investigation/data/mix_inspections.csv", "S04-B"))
write("quality", "finished_lots.csv", read("04_quality_investigation/data/traceability.csv", "S04-C"))
write("quality", "recovered_serial_genealogy.csv",
      read("04_quality_investigation/continuation/data/recovered_serial_genealogy.csv", "S04-C"))

# ───────────────────────────── inventory control ───────────────────────
write("inventory", "seal_stock.csv", read("05_inventory_balancing/data/stock.csv", "S05-A"))
write("inventory", "seal_demand.csv", read("05_inventory_balancing/data/demand.csv", "S05-A"))
write("inventory", "seal_lanes.csv", read("05_inventory_balancing/data/lanes.csv", "S05-A"))
# Purchasing's emergency quote lives in the policy note; the table carries it too.
write("inventory", "emergency_quotes.csv", [{"component_id": "C100", "price_eur": "46", "earliest_arrival": "2026-10-23"}])
write("inventory", "resin_lots.csv", read("05_inventory_balancing/data/lots.csv", "S05-B"))
write("inventory", "resin_demand.csv", read("05_inventory_balancing/data/demand.csv", "S05-B"))
write("inventory", "resin_lanes.csv", read("05_inventory_balancing/data/lanes.csv", "S05-B"))
# Hamburg reservation puzzle: bearing kits, not seal cartridges (Hamburg's seal stock is the other desk's).
props = remap(read("05_inventory_balancing/data/proposed_transfers.csv", "S05-C"), "component_id", "C100", "CBRG")
write("inventory", "transfer_proposals.csv", props)
write("inventory", "bearing_stock.csv", remap(read("05_inventory_balancing/data/stock.csv", "S05-C"), "component_id", "C100", "CBRG"))
write("inventory", "bearing_demand.csv", remap(read("05_inventory_balancing/data/demand.csv", "S05-C"), "component_id", "C100", "CBRG"))
write("inventory", "bearing_lanes.csv", read("05_inventory_balancing/data/lanes.csv", "S05-C"))
write("inventory", "reservation_requests.csv", read("05_inventory_balancing/continuation/data/reservation_requests.csv", "S05-C"))
write("inventory", "reservation_responses.csv", read("05_inventory_balancing/continuation/data/reservation_responses.csv", "S05-C"))
write("inventory", "later_stock.csv", remap(read("05_inventory_balancing/continuation/data/later_stock.csv", "S05-C"), "component_id", "C100", "CBRG"))

# ───────────────────────────── data integration ────────────────────────
# The "same item, three identifiers" puzzle becomes the flange gasket set (C431 stays the housing).
aliases = read("06_data_quality/data/material_aliases.csv", "S06-A")
snap = read("06_data_quality/data/stock_snapshots.csv", "S06-A")
rename_ids = {"00000124": "00000124", "MH-124": "GS-124", "124-MH": "124-GS", "MH124-A": "GS124-A"}
for r in aliases:
    r["source_material_id"] = rename_ids[r["source_material_id"]]
    if r["component_id"] == "C431":
        r["component_id"] = "CGSK"
for r in snap:
    r["source_material_id"] = rename_ids[r["source_material_id"]]
    r["description"] = {"MOTOR-HOUSING": "GASKET-SET-FLANGE", "Housing Motor": "Flange Gasket Set",
                        "Motor Housing Adaptor": "Gasket Adaptor"}[r["description"]]
write("integration", "material_aliases.csv", aliases)
write("integration", "stock_snapshots.csv", snap)
# Manufacturing's demand for the gasket set is stated in the stewardship ticket; the table carries it too.
write("integration", "mes_demand.csv", [{"source_system": "MES", "source_material_id": "GS-124", "quantity": "400", "unit": "PIECE"}])
write("integration", "system_authority.csv", read("06_data_quality/data/system_authority.csv", "S06-A"))
write("integration", "order_events.csv", read("06_data_quality/data/order_events.csv", "S06-B"))
write("integration", "event_stock.csv", remap(read("06_data_quality/data/event_stock.csv", "S06-B"), "component_id", "C100", "CIMP"))
write("integration", "inspection_payloads.csv", read("06_data_quality/data/inspection_payloads.csv", "S06-C"))
write("integration", "field_contracts.csv", read("06_data_quality/data/field_contracts.csv", "S06-C"))
for f in ("recovered_contracts", "additional_measurements", "required_checks"):
    write("integration", f"{f}.csv", read(f"06_data_quality/continuation/data/{f}.csv", "S06-C"))
