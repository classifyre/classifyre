# Data Integration: the extracts and feeds that reach Nova from SAP, the MES, the
# warehouse system, the order-event gateway and the quality devices, plus the
# data-stewardship tickets that explain their quirks. Each of them can manufacture a
# shortage or a quality crisis that does not exist.

T_TICKETS = "2026-10-02T07:50:00Z"
T_RECOVERY = "2026-10-02T11:00:00Z"
T_UPDATE = "2026-10-02T12:00:00Z"


def extract():
    components = lookup("components.csv", "component_id")

    # ── One gasket set, three identifiers ─────────────────────────────────────
    aliases = [{"source_system": a["source_system"], "source_material_id": a["source_material_id"], "component_id": a["component_id"],
                "unit": a["unit"], "units_per_pack": num(a["units_per_pack"])} for a in table("material_aliases.csv")]
    for a in aliases:
        yield record(
            f"alias-{a['source_system']}-{a['source_material_id']}",
            f"{a['source_system']} item {a['source_material_id']} → {a['component_id']} ({components[a['component_id']]['description']})",
            f"Crosswalk: {a['source_system']} item {a['source_material_id']} is component {a['component_id']} — {components[a['component_id']]['description']}; "
            f"counted in {a['unit']}" + (f", {a['units_per_pack']} pieces per pack." if a["units_per_pack"] != 1 else "."),
            "crosswalk_entry", ("crosswalk", f"{a['source_system']}-{a['source_material_id']}"), facts=a, created_at="2026-01-01T00:00:00Z")
    snaps = [{"source_system": s["source_system"], "source_material_id": s["source_material_id"], "plant_id": s["plant_id"],
              "quantity": num(s["quantity"]), "snapshot_at": s["snapshot_at"], "description": s["description"]} for s in table("stock_snapshots.csv")]
    for s in snaps:
        yield record(
            f"snapshot-{s['source_system']}-{s['source_material_id']}",
            f"{s['source_system']} stock snapshot · {s['source_material_id']} · {s['quantity']:,} · {s['snapshot_at'][5:10].replace('-', '/')} {s['snapshot_at'][11:16]} UTC",
            f"{s['source_system']} reports {s['quantity']:,} of item {s['source_material_id']} ({s['description']}) at {s['plant_id']} as of {s['snapshot_at'][:16].replace('T', ' ')} UTC.",
            "stock_snapshot", ("snapshot", f"{s['source_system']}-{s['source_material_id']}-{s['snapshot_at']}"), facts=s, created_at=s["snapshot_at"])
    auth = table("system_authority.csv")[0]
    auth_f = {"metric": auth["metric"], "system_name": auth["system_name"], "max_age_minutes": num(auth["max_age_minutes"])}
    yield record("authority-physical-stock", f"Source authority · physical stock → {auth_f['system_name']} · max {auth_f['max_age_minutes']:g} minutes old",
                 f"Governance decision: the {auth_f['system_name']} is the authoritative system for current physical stock, valid for {auth_f['max_age_minutes']:g} minutes. Other systems' counts must not be added to it.",
                 "governance_rule", ("authority", auth_f["metric"]), facts=auth_f, created_at="2026-09-01T00:00:00Z")
    d = table("mes_demand.csv")[0]
    demand_f = {"source_system": d["source_system"], "source_material_id": d["source_material_id"], "quantity": num(d["quantity"]), "unit": d["unit"]}
    yield record("demand-mes-GS-124", f"MES demand · {demand_f['quantity']} {demand_f['unit'].lower()} of GS-124",
                 f"The MES asks for {demand_f['quantity']} pieces of item {demand_f['source_material_id']}; all other production constraints are met.",
                 "demand", ("demand", "MES-GS-124"), facts=demand_f, created_at=AS_OF)
    yield record(
        "view-gasket-stock", "Flange gasket set · the same part under four identifiers, three snapshots",
        "Stock reconciliation sheet for the flange gasket set.\n\n" + md_table(aliases, [("source_system", "System"), ("source_material_id", "Item"), ("component_id", "Component"), ("unit", "Unit"), ("units_per_pack", "Per pack")])
        + "\n\n" + md_table(snaps, [("source_system", "System"), ("source_material_id", "Item"), ("quantity", "Reported"), ("snapshot_at", "Snapshot")]),
        "decision_view", view="gasket_stock", created_at=AS_OF,
        facts={"as_of": AS_OF, "aliases": aliases, "snapshots": snaps, "authority": auth_f, "demand": demand_f})

    # ── An order feed that replays ────────────────────────────────────────────
    msgs = []
    for k, e in enumerate(table("order_events.csv")):
        f = {"event_id": e["event_id"], "order_id": e["order_id"], "version": num(e["version"]), "quantity": num(e["quantity"]), "state": e["state"],
             "occurred_at": e["occurred_at"], "received_at": e["received_at"]}
        msgs.append(f)
        yield record(
            f"message-{e['event_id']}-{k + 1}", f"Order message {e['event_id']} · {e['order_id']} v{f['version']} · {f['quantity']} · {e['state'].lower()}",
            f"Order {e['order_id']} version {f['version']}: {f['quantity']} units, {e['state'].lower()}. Event {e['event_id']} occurred {e['occurred_at'][:16].replace('T', ' ')} UTC, received {e['received_at'][:16].replace('T', ' ')} UTC.",
            "order_message", ("order-message", f"{e['event_id']}-{k + 1}"), facts=f, status=e["state"], created_at=e["received_at"])
    es = table("event_stock.csv")[0]
    es_f = {"plant_id": es["plant_id"], "component_id": es["component_id"], "released_units": num(es["released_units"])}
    yield record("stock-impellers-MUC", f"Impellers · Munich · {es_f['released_units']} released",
                 f"Munich holds {es_f['released_units']} released pump impellers (CIMP); one is consumed per demanded unit.", "stock_position",
                 ("stock", "MUC-CIMP"), facts=es_f, created_at=AS_OF)
    yield record(
        "view-order-feed", "Order feed · five messages, two orders, one stock figure",
        "What the order-event gateway delivered, with the warehouse stock for comparison.\n\n" + md_table(msgs, [("event_id", "Event"), ("order_id", "Order"), ("version", "Version"), ("quantity", "Qty"), ("state", "State"), ("occurred_at", "Occurred"), ("received_at", "Received")]),
        "decision_view", view="order_feed", created_at=AS_OF, facts={"as_of": AS_OF, "messages": msgs, "stock": es_f})

    # ── Devices that changed units without telling anyone ─────────────────────
    contracts = [{"schema_version": c["schema_version"], "semantic_measure": c["semantic_measure"], "unit": c["unit"], "valid_from": c["valid_from"],
                  "alarm_c": num(c.get("alarm_c"), None)} for c in table("field_contracts.csv")]
    payloads = [{"inspection_id": p["inspection_id"], "schema_version": p["schema_version"], "batch_id": p["batch_id"], "value": num(p["value"]),
                 "local_event_time": p["local_event_time"], "source_timezone": p["source_timezone"], "units_in_lot": num(p["units_in_lot"])} for p in table("inspection_payloads.csv")]
    for p in payloads:
        yield record(f"reading-{p['batch_id']}", f"Quality reading · lot {p['batch_id']} · {p['units_in_lot']} units · schema v{p['schema_version']} · value {p['value']:,}",
                     f"Inspection {p['inspection_id']} of lot {p['batch_id']} ({p['units_in_lot']} units) under payload schema v{p['schema_version']}: value {p['value']:,}, measured "
                     f"{p['local_event_time'][:16].replace('T', ' ')} {p['source_timezone']} local time.", "quality_reading",
                     ("reading", p["inspection_id"]), facts=p, created_at=p["local_event_time"] + "Z")
    for c in contracts:
        yield record(f"contract-v{c['schema_version']}", f"Field contract · schema v{c['schema_version']} · {c['semantic_measure']} in °{c['unit']}",
                     f"Registered field contract: schema v{c['schema_version']} carries {c['semantic_measure']} in {c['unit']}, valid from {c['valid_from'][:10]}.",
                     "field_contract", ("contract", f"v{c['schema_version']}"), facts=c, created_at=c["valid_from"])
    alarm = max(c["alarm_c"] for c in contracts if c["alarm_c"])
    yield record(
        "view-quality-readings", "Quality devices · three lots, three payload versions",
        "Daily quality sheet: payloads joined with the registered field contracts.\n\n" + md_table(payloads, [("inspection_id", "Inspection"), ("batch_id", "Lot"), ("schema_version", "Schema"), ("value", "Value"), ("units_in_lot", "Units"), ("local_event_time", "Local time")])
        + "\n\n" + md_table(contracts, [("schema_version", "Schema"), ("semantic_measure", "Measure"), ("unit", "Unit")]),
        "decision_view", view="quality_readings", created_at=AS_OF,
        facts={"as_of": AS_OF, "payloads": payloads, "contracts": contracts, "alarm_c": alarm, "recovered": None})
    yield Asset(id="memo-stewardship-tickets", name="Data stewardship tickets · MDM-124, CDC-61, QMS-61 · 2 Oct", kind="document",
                content=ctx.file("stewardship_tickets.md").read_text(), created_at=T_TICKETS, updated_at=T_TICKETS,
                metadata={"object_type": "memo", "written_at": T_TICKETS})

    # ── The producer recovers the missing contract ────────────────────────────
    rc = table("recovered_contracts.csv")[0]
    rc_f = {"schema_version": rc["schema_version"], "semantic_measure": rc["semantic_measure"], "unit": rc["unit"], "valid_from": rc["valid_from"]}
    yield record("contract-v3-recovered", f"Recovered field contract · schema v{rc_f['schema_version']} · {rc_f['semantic_measure']} in {rc_f['unit'].replace('US_CM', 'µS/cm')}",
                 f"The producer recovered the missing contract: schema v{rc_f['schema_version']} carries {rc_f['semantic_measure']} in µS/cm, effective {rc_f['valid_from'][:16].replace('T', ' ')} UTC. "
                 f"It is not temperature.", "field_contract", ("contract", "v3"), facts=rc_f, created_at=T_RECOVERY)
    am = table("additional_measurements.csv")[0]
    am_f = {"inspection_id": am["inspection_id"], "schema_version": am["schema_version"], "batch_id": am["batch_id"], "value": num(am["value"]),
            "local_event_time": am["local_event_time"], "source_timezone": am["source_timezone"]}
    yield record("reading-IQ64", f"Quality reading · lot {am_f['batch_id']} · temperature {am_f['value']} · schema v{am_f['schema_version']}",
                 f"A separate temperature result for the existing lot {am_f['batch_id']}: {am_f['value']} under schema v{am_f['schema_version']} (it adds a measurement, not units).",
                 "quality_reading", ("reading", am_f["inspection_id"]), facts=am_f, created_at=T_RECOVERY)
    checks = [{"batch_id": c["batch_id"], "semantic_measure": c["semantic_measure"], "unit": c["unit"], "minimum_value": num(c["minimum_value"]),
               "maximum_value": num(c["maximum_value"]), "specification_id": c["specification_id"]} for c in table("required_checks.csv")]
    yield record("required-checks", f"Required checks · {len(checks)} checks across three lots",
                 "QMS required checks before a lot can be reviewed:\n" + md_table(checks, [("batch_id", "Lot"), ("semantic_measure", "Measure"), ("unit", "Unit"), ("minimum_value", "Min"), ("maximum_value", "Max")]),
                 "quality_spec", ("required-checks", "all"), facts={"checks": checks}, created_at=T_RECOVERY)
    yield Asset(id="memo-contract-recovery", name="Schema incident SCH-63 · contract for schema v3 recovered · 2 Oct 11:00", kind="document",
                content=ctx.file("producer_contract_recovery.md").read_text(), created_at=T_RECOVERY, updated_at=T_RECOVERY,
                metadata={"object_type": "memo", "written_at": T_RECOVERY})
    yield record(
        "view-quality-readings-update", "Quality devices · updated 12:00 with the recovered contract and required checks",
        "The quality sheet after the producer recovered schema v3 and a separate temperature result arrived.",
        "decision_view", view="quality_readings", created_at=T_UPDATE,
        facts={"as_of": T_UPDATE, "payloads": payloads + [am_f], "contracts": contracts, "alarm_c": alarm,
               "recovered": {"contract": rc_f, "checks": checks}})


def relationships():
    for a in table("material_aliases.csv"):
        yield flow(upstream=Ref.asset(f"alias-{a['source_system']}-{a['source_material_id']}"), downstream=Ref.asset("view-gasket-stock"), type=FlowType.VIEW)
    for s in table("stock_snapshots.csv"):
        yield flow(upstream=Ref.asset(f"snapshot-{s['source_system']}-{s['source_material_id']}"), downstream=Ref.asset("view-gasket-stock"), type=FlowType.VIEW)
        yield references(Ref.asset(f"snapshot-{s['source_system']}-{s['source_material_id']}"), Ref.urn(urn("plant", s["plant_id"])))
    yield flow(upstream=Ref.asset("authority-physical-stock"), downstream=Ref.asset("view-gasket-stock"), type=FlowType.VIEW)
    yield flow(upstream=Ref.asset("demand-mes-GS-124"), downstream=Ref.asset("view-gasket-stock"), type=FlowType.VIEW)
    for k, e in enumerate(table("order_events.csv")):
        yield flow(upstream=Ref.asset(f"message-{e['event_id']}-{k + 1}"), downstream=Ref.asset("view-order-feed"), type=FlowType.VIEW)
    yield flow(upstream=Ref.asset("stock-impellers-MUC"), downstream=Ref.asset("view-order-feed"), type=FlowType.VIEW)
    yield references(Ref.asset("stock-impellers-MUC"), Ref.urn(urn("plant", "MUC")))
    for p in table("inspection_payloads.csv"):
        yield flow(upstream=Ref.asset(f"reading-{p['batch_id']}"), downstream=Ref.asset("view-quality-readings"), type=FlowType.VIEW)
    for c in table("field_contracts.csv"):
        yield flow(upstream=Ref.asset(f"contract-v{c['schema_version']}"), downstream=Ref.asset("view-quality-readings"), type=FlowType.VIEW)
    yield flow(upstream=Ref.asset("view-quality-readings"), downstream=Ref.asset("view-quality-readings-update"), type=FlowType.VIEW)
    for a in ("contract-v3-recovered", "reading-IQ64", "required-checks"):
        yield flow(upstream=Ref.asset(a), downstream=Ref.asset("view-quality-readings-update"), type=FlowType.VIEW)
    yield references(Ref.asset("memo-stewardship-tickets"), Ref.asset("view-gasket-stock"))
    yield references(Ref.asset("memo-stewardship-tickets"), Ref.asset("view-order-feed"))
    yield references(Ref.asset("memo-stewardship-tickets"), Ref.asset("view-quality-readings"))
    yield references(Ref.asset("memo-contract-recovery"), Ref.asset("contract-v3-recovered"))
    for v in ("view-gasket-stock", "view-order-feed", "view-quality-readings", "view-quality-readings-update"):
        yield means(Ref.asset(v), Ref.term("decision-view"))
    for m in ("memo-stewardship-tickets", "memo-contract-recovery"):
        yield means(Ref.asset(m), Ref.term("plant-memo"))


def test_connection():
    names = {f.name for f in ctx.files}
    need = {"material_aliases.csv", "order_events.csv", "inspection_payloads.csv", "stewardship_tickets.md"}
    if need - names:
        return {"status": "FAILURE", "message": f"missing files: {sorted(need - names)}"}
    return {"status": "SUCCESS", "message": f"{len(names)} files ready"}
