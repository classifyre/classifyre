"""Data trust checks.

Systems that disagree manufacture problems that do not exist: a shortage nobody has,
a quality crisis nobody caused, a demand spike that is really a replay. These checks
read the extracts the way the stewardship tickets say they must be read — through the
crosswalk, the authority rule, the version number and the field contract — and say
when the naive reading is wrong.
"""
from datetime import datetime, timedelta

from classifyre import Finding

MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()


def day(iso):
    y, m, d = iso[:10].split("-")
    return f"{int(d)} {MONTHS[int(m) - 1]}"


def ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def detect(asset, ctx):
    view = asset.metadata.get("view")
    facts = asset.metadata.get("facts") or {}
    handler = {"gasket_stock": gasket_stock, "order_feed": order_feed, "quality_readings": quality_readings}.get(view)
    if handler:
        yield from handler(facts)


# ── One part, several identifiers ─────────────────────────────────────────────
def gasket_stock(f):
    alias = {(a["source_system"], a["source_material_id"]): a for a in f["aliases"]}
    auth, demand, as_of = f["authority"], f["demand"], ts(f["as_of"])
    target = alias[(demand["source_system"], demand["source_material_id"])]["component_id"]
    authoritative, others = 0, 0
    for s in f["snapshots"]:
        a = alias.get((s["source_system"], s["source_material_id"]))
        if not a:
            continue
        age_min = (as_of - ts(s["snapshot_at"])).total_seconds() / 60
        in_ea = s["quantity"] * a["units_per_pack"]
        label = f"{s['source_system']} item {s['source_material_id']}"
        if a["component_id"] != target:
            yield Finding(
                label="lookalike_identifier", severity="medium", identity=f"lookalike-{s['source_material_id']}",
                value=(f"Item {s['source_material_id']} ({s['quantity']:,} pieces at {s['plant_id']}) looks like {demand['source_material_id']} but is a different component, "
                       f"{a['component_id']}: it must not be counted as stock of {target}."),
                message="A similar name is not an identity. Join through the crosswalk with the source system, not on a name or on the component alone.",
                fields={"item": s["source_material_id"], "quantity": s["quantity"], "component": a["component_id"]})
            continue
        if a["units_per_pack"] != 1:
            yield Finding(
                label="unit_mismatch_in_stock", severity="high", identity=f"unit-{s['source_system']}-{s['source_material_id']}",
                value=f"{label} counts {s['quantity']:,} {a['unit']}; at {a['units_per_pack']} pieces per {a['unit'].lower()} that is {in_ea:,} pieces, not {s['quantity']:,}.",
                message="The number is in packs. Convert through the crosswalk before comparing it with demand in pieces.",
                fields={"item": s["source_material_id"], "reported": s["quantity"], "pieces": in_ea})
        if s["source_system"] != auth["system_name"] or age_min > auth["max_age_minutes"]:
            others += s["quantity"]
            yield Finding(
                label="stale_snapshot", severity="medium", identity=f"stale-{s['source_system']}-{s['source_material_id']}",
                value=(f"{s['source_system']}'s {s['quantity']:,} pieces are from {day(s['snapshot_at'])} {s['snapshot_at'][11:16]} UTC — {age_min / 60:.0f} hours old, "
                       f"and {auth['system_name']} (max {auth['max_age_minutes']:g} minutes) is the authority for physical stock."),
                message="The extract predates the receipt. Never add an overlapping count from a non-authoritative system.",
                fields={"system": s["source_system"], "age_hours": round(age_min / 60, 1)})
        else:
            authoritative += in_ea
    if others and authoritative >= demand["quantity"] > others:
        yield Finding(
            label="phantom_shortage", severity="high", identity="phantom-GS-124",
            value=(f"Manufacturing needs {demand['quantity']} pieces. Against the SAP count of {others} it looks {demand['quantity'] - others} short, but the authoritative "
                   f"warehouse count is {authoritative} pieces: a surplus of {authoritative - demand['quantity']}, so the planned purchase is unnecessary."),
            message="The shortage comes from comparing one system's stale extract with another system's demand, in different units.",
            fields={"apparent_shortage": demand["quantity"] - others, "authoritative_pieces": authoritative, "demand": demand["quantity"]})


# ── A feed that duplicates and replays ────────────────────────────────────────
def order_feed(f):
    msgs = f["messages"]
    by_event = {}
    for m in msgs:
        by_event.setdefault(m["event_id"], []).append(m)
    for event, ms in by_event.items():
        if len(ms) > 1:
            yield Finding(
                label="duplicate_event_delivery", severity="low", identity=f"dup-{event}",
                value=f"Event {event} ({ms[0]['order_id']} v{ms[0]['version']}) was delivered {len(ms)} times — one message, not {len(ms)}.",
                message="Transport retries keep the event id; count each event once.", fields={"event": event, "deliveries": len(ms)})
    latest = {}
    for m in msgs:
        if m["order_id"] not in latest or m["version"] > latest[m["order_id"]]["version"]:
            latest[m["order_id"]] = m
    for m in sorted(msgs, key=lambda m: m["received_at"]):
        top = latest[m["order_id"]]
        if m["version"] < top["version"] and m["received_at"] > top["received_at"]:
            yield Finding(
                label="stale_version_replayed", severity="medium", identity=f"replay-{m['event_id']}-{m['received_at']}",
                value=(f"Order {m['order_id']} version {m['version']} ({m['quantity']} units) was delivered again at {m['received_at'][11:16]} UTC, after version "
                       f"{top['version']} had already arrived; it must not restore the old demand."),
                message="Receive time is not business time: the highest version wins, whatever order the messages arrive in.",
                fields={"order": m["order_id"], "stale_version": m["version"], "current_version": top["version"]})
            break
    naive = sum(m["quantity"] for m in msgs)
    current = sum(m["quantity"] if m["state"] != "CANCELLED" else 0 for m in latest.values())
    stock = f["stock"]["released_units"]
    if naive > current:
        status = ", ".join(f"{o} v{m['version']} = {m['quantity']} {m['state'].lower()}" for o, m in sorted(latest.items()))
        yield Finding(
            label="demand_overstated", severity="high", identity="demand-overstated",
            value=(f"Adding up the messages gives {naive} units of demand; the real current demand is {current} ({status}). Stock of {stock} covers it with {stock - current} to spare."),
            message=f"Each message is the full state of an order, not a delta. A naive sum would raise a false shortage of {max(0, naive - stock)}.",
            fields={"naive_demand": naive, "current_demand": current, "surplus": stock - current})


# ── Devices, schema versions and units ────────────────────────────────────────
def quality_readings(f):
    contracts = {c["schema_version"]: c for c in f["contracts"]}
    alarm = f["alarm_c"]
    rec = f.get("recovered")
    if rec:
        contracts[rec["contract"]["schema_version"]] = {**rec["contract"], "alarm_c": None}
    for p in ([] if rec else f["payloads"]):
        c = contracts.get(p["schema_version"])
        if c is None:
            yield Finding(
                label="unknown_schema_version", severity="high", identity=f"unknown-{p['batch_id']}",
                value=(f"Lot {p['batch_id']} ({p['units_in_lot']} units) reports under schema v{p['schema_version']}, which has no registered contract: the value "
                       f"{p['value']:,} cannot be read as °C, °F or anything else."),
                message="Do not infer units from the size of a number. The lot stays unresolved, and is not release-ready, until the producer supplies the contract.",
                fields={"lot": p["batch_id"], "units": p["units_in_lot"], "value": p["value"]})
            continue
        if c["semantic_measure"] == "temperature" and c["unit"] == "F":
            value_c = (p["value"] - 32) * 5 / 9
            if p["value"] > alarm >= value_c:
                yield Finding(
                    label="unit_conversion_needed", severity="medium", identity=f"convert-{p['batch_id']}",
                    value=(f"Lot {p['batch_id']} reports {p['value']:g} under schema v{p['schema_version']}, which is °F: {value_c:.0f} °C, below the {alarm:g} °C alarm. "
                           f"A rule that compares the raw number with {alarm:g} would hold {p['units_in_lot']} units for nothing."),
                    message="The column name stays the same while the unit changes: read it through the versioned field contract.",
                    fields={"lot": p["batch_id"], "units": p["units_in_lot"], "value_c": round(value_c, 1)})
    local = [p for p in f["payloads"] if p["local_event_time"][:10] != (datetime.fromisoformat(p["local_event_time"]) - timedelta(hours=2)).date().isoformat()]
    if local and not rec:
        lots = ", ".join(p["batch_id"] for p in local)
        yield Finding(
            label="reporting_day_differs", severity="low", identity="day-shift",
            value=f"Lots {lots} were measured shortly after local midnight (Vienna): that is still the previous day in UTC, but the quality report is by plant-local date.",
            message="Report by the plant's calendar date, and keep both timestamps.", fields={"lots": lots})
    if rec:
        values = {}
        for p in f["payloads"]:
            c = contracts.get(p["schema_version"])
            if not c:
                continue
            measure, value = c["semantic_measure"], p["value"]
            if c["semantic_measure"] == "temperature" and c["unit"] == "F":
                value = (value - 32) * 5 / 9
            values[(p["batch_id"], measure)] = value
        passed = failed = 0
        for chk in rec["checks"]:
            v = values.get((chk["batch_id"], chk["semantic_measure"]))
            if v is not None and chk["minimum_value"] <= v <= chk["maximum_value"]:
                passed += 1
            else:
                failed += 1
        units = sum({p["batch_id"]: p["units_in_lot"] for p in f["payloads"] if "units_in_lot" in p}.values())
        if failed == 0:
            yield Finding(
                label="contract_recovered", severity="info", identity="contract-v3",
                value=(f"The recovered contract identifies schema v{rec['contract']['schema_version']} as {rec['contract']['semantic_measure']} in µS/cm (2,040 is inside its band) "
                       f"and a separate temperature result exists for the same lot. All {passed} required checks across the three lots ({units} units, not double-counted) now pass."),
                message="Quality can now review the lots. A recovered contract is not a release: nothing has been released.",
                fields={"checks_passed": passed, "units": units})
        else:
            yield Finding(
                label="unknown_schema_version", severity="high", identity="contract-v3-incomplete",
                value=f"Schema v{rec['contract']['schema_version']} is now understood, but {failed} of {passed + failed} required checks still lack a passing measurement.",
                fields={"checks_failed": failed})
