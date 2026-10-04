# Machines & Maintenance: ninety days of hourly sensor readings for the sixteen
# instrumented machines, the maintenance system's history and open orders, the
# temperature-sensor feed from M003, and the technicians' handover notes. After a
# service on 3 October, the post-service window arrives as new records.

T_HANDOVER = "2026-10-02T07:30:00Z"
T_SERVICE = "2026-10-03T10:05:00Z"
T_HANDOVER2 = "2026-10-03T12:45:00Z"
T_UPDATE = "2026-10-03T13:00:00Z"
ALERT_LINE_MM_S = 5.0  # the plant-wide vibration alert line used on the shop floor


def extract():
    machines = lookup("machines.csv", "machine_id")
    plants = lookup("plants.csv", "plant_id")
    customers = lookup("customers.csv", "customer_id")
    products = lookup("products.csv", "product_id")

    history = {}
    for h in table("maintenance_history.csv"):
        history.setdefault(h["machine_id"], []).append({"performed_date": h["performed_date"], "failure_mode": h["failure_mode"],
                                                        "downtime_hours": num(h["downtime_hours"])})
    open_orders = {}
    for o in table("open_orders.csv"):
        open_orders.setdefault(o["machine_id"], []).append({
            "sales_order_id": o["sales_order_id"], "customer": customers[o["customer_id"]]["name"], "product_id": o["product_id"],
            "open_units": num(o["open_units"]), "revenue_eur": num(o["revenue_eur"])})

    # ── One health record per instrumented machine ────────────────────────────
    by_machine = {}
    for r in table("telemetry.csv"):
        by_machine.setdefault(r["machine_id"], []).append(r)
    for mid in sorted(by_machine):
        rows = by_machine[mid]
        m, p = machines[mid], plants[machines[mid]["plant_id"]]
        csv_text = "observed_at,operating_mode,vibration_mm_s,temperature_c\n" + "\n".join(
            f"{r['observed_at']},{r['operating_mode']},{r['vibration_mm_s']},{r['temperature_c']}" for r in rows)
        yield Asset(
            id=f"health-{mid}", name=f"{mid} · {p['name'].replace('Nova ', '')} · 90 days of hourly vibration and temperature",
            kind="table", content=csv_text, created_at=AS_OF, updated_at=AS_OF, urn=urn("machine-health", mid),
            metadata={"object_type": "machine_health", "view": "machine_health",
                      "facts": {"machine_id": mid, "plant_id": m["plant_id"], "plant": p["name"], "machine_type": m["machine_type"],
                                "readings": len(rows), "first": rows[0]["observed_at"], "last": rows[-1]["observed_at"],
                                "alert_line_mm_s": ALERT_LINE_MM_S, "maintenance": history.get(mid, []),
                                "open_orders": open_orders.get(mid, [])}})

    for mid, evs in history.items():
        for h in evs:
            yield record(
                f"maintenance-{mid}-{h['performed_date']}", f"{mid} · {h['failure_mode'].replace('_', ' ').lower()} · {nice_day(h['performed_date'])}",
                f"Maintenance record for {mid}: {h['failure_mode'].replace('_', ' ').lower()} on {nice_day(h['performed_date'])}, "
                f"{h['downtime_hours']} hours of downtime.", "maintenance_event", ("maintenance", f"{mid}-{h['performed_date']}"),
                facts={"machine_id": mid, **h}, created_at=h["performed_date"] + "T12:00:00Z")
    for mid, orders in open_orders.items():
        for o in orders:
            yield record(
                f"order-{o['sales_order_id']}", f"{o['sales_order_id']} · {o['customer']} · {o['open_units']}× {products[o['product_id']]['name']} · {eur(o['revenue_eur'])}",
                f"Open order {o['sales_order_id']} for {o['customer']}: {o['open_units']} × {products[o['product_id']]['name']} ({o['product_id']}) "
                f"assigned to machine {mid}, due within the next 48 hours. Value {eur(o['revenue_eur'])}.",
                "sales_order", ("sales-order", o["sales_order_id"]), facts={"machine_id": mid, **o}, created_at=AS_OF)

    # ── M003's temperature feed ───────────────────────────────────────────────
    registry = [{"sensor_id": r["sensor_id"], "actual_unit": r["actual_unit"], "max_age_minutes": num(r["max_age_minutes"]),
                 "alarm_c": num(r["alarm_c"]), "effective_from": r["effective_from"]} for r in table("sensor_registry.csv")]
    packets = []
    for k, p in enumerate(table("sensor_packets.csv")):
        f = {"machine_id": p["machine_id"], "sensor_id": p["sensor_id"], "event_id": p["event_id"], "event_at": p["event_at"],
             "received_at": p["received_at"], "value": num(p["temperature_value"]), "reported_unit": p["reported_unit"]}
        packets.append(f)
        yield record(
            f"packet-{p['event_id']}-{k + 1}", f"Sensor message {p['event_id']} · {p['machine_id']} {p['sensor_id']} · {f['value']} {f['reported_unit']}",
            f"Message for event {p['event_id']} from {p['sensor_id']} on {p['machine_id']}: {f['value']} labelled °{f['reported_unit']}, measured "
            f"{p['event_at'][:16].replace('T', ' ')} UTC, received {p['received_at'][:16].replace('T', ' ')} UTC.",
            "sensor_message", ("sensor-message", f"{p['event_id']}-{k + 1}"), facts=f, created_at=p["received_at"])
    yield record(
        "sensor-registry", "Sensor configuration register · M003 and M004",
        "Engineering configuration of the temperature sensors:\n" + md_table(registry, [("sensor_id", "Sensor"), ("actual_unit", "Real unit"),
                                                                                       ("max_age_minutes", "Max age (min)"), ("alarm_c", "Alarm °C"),
                                                                                       ("effective_from", "Effective from")]),
        "configuration", ("sensor-registry", "M003"), facts={"sensors": registry}, created_at="2026-09-30T00:00:00Z")
    yield record(
        "view-m003-sensor-feed", "M003 temperature feed · messages against sensor configuration",
        "Sensor feed for machine M003 with the effective sensor configuration joined in.\n\n"
        + md_table(packets, [("event_id", "Event"), ("sensor_id", "Sensor"), ("value", "Value"), ("reported_unit", "Labelled"),
                             ("event_at", "Measured"), ("received_at", "Received")]),
        "decision_view", view="sensor_feed", created_at=AS_OF, facts={"as_of": AS_OF, "packets": packets, "registry": registry})

    # ── Today's maintenance slot ─────────────────────────────────────────────
    options = []
    for o in table("maintenance_options.csv"):
        f = {"machine_id": o["machine_id"], "failure_probability": num(o["assumed_failure_probability"]),
             "unplanned_hours": num(o["unplanned_hours"]), "contribution_per_hour_eur": num(o["contribution_per_hour_eur"]),
             "planned_cost_eur": num(o["planned_cost_eur"]), "technician_hours": num(o["technician_hours"]), "free_spare_kits": num(o["free_spare_kits"])}
        options.append(f)
        yield record(
            f"option-{o['machine_id']}", f"Maintenance option · {o['machine_id']} · {f['technician_hours']} technician hours",
            f"Candidate job on {o['machine_id']}: {f['technician_hours']} technician hours, planned cost {eur(f['planned_cost_eur'])} (includes the contribution lost "
            f"during the planned stop). Planning assumption: {f['failure_probability']:.0%} chance of an unplanned stop of {f['unplanned_hours']} hours, "
            f"each worth {eur(f['contribution_per_hour_eur'])} of contribution.", "maintenance_option", ("maintenance-option", o["machine_id"]),
            facts=f, created_at=AS_OF)
    crew = table("crew_capacity.csv")[0]
    crew_f = {"available_technician_hours": num(crew["available_technician_hours"])}
    yield record("crew-today", f"Crew shift today · {crew_f['available_technician_hours']} technician hours",
                 f"One technician is on shift with {crew_f['available_technician_hours']} hours available today.",
                 "capacity", ("crew-shift", "2026-10-02"), facts=crew_f, created_at=AS_OF)
    yield record(
        "view-maintenance-slot", "Today's maintenance slot · M005 against M006",
        "Maintenance planner's sheet: the two candidate jobs against the technician hours on shift. All probabilities are planning inputs.\n\n"
        + md_table(options, [("machine_id", "Machine"), ("failure_probability", "Assumed failure prob."), ("unplanned_hours", "Unplanned hours"),
                             ("contribution_per_hour_eur", "€/hour"), ("planned_cost_eur", "Planned cost €"), ("technician_hours", "Technician hours")]),
        "decision_view", view="maintenance_slot", created_at=AS_OF, facts={"as_of": AS_OF, "options": options, "crew": crew_f})

    yield Asset(id="memo-technician-handover", name="Maintenance handover · 2 Oct 07:30", kind="document",
                content=ctx.file("technician_handover.md").read_text(), created_at=T_HANDOVER, updated_at=T_HANDOVER,
                metadata={"object_type": "memo", "written_at": T_HANDOVER})

    # ── 3 October: the service on M001 and a fresh window ─────────────────────
    sv = table("service_records.csv")[0]
    sv_f = {"maintenance_id": sv["maintenance_id"], "machine_id": sv["machine_id"], "component_id": sv["component_id"],
            "findings": sv["findings"], "action_taken": sv["action_taken"], "started_at": sv["started_at"], "completed_at": sv["completed_at"]}
    yield record(
        "service-MW301", f"Service {sv_f['maintenance_id']} · {sv_f['machine_id']} · bearing replaced",
        f"Work order {sv_f['maintenance_id']} on {sv_f['machine_id']}: technician found {sv_f['findings'].replace('_', ' ').lower()}, "
        f"{sv_f['action_taken'].replace('_', ' ').lower()}, machine stopped {sv_f['started_at'][11:16]}–{sv_f['completed_at'][11:16]} UTC.",
        "service_record", ("service", sv_f["maintenance_id"]), facts=sv_f, created_at=T_SERVICE)

    window = []
    for mid in ("M001", "M002"):
        tail = [r for r in by_machine[mid]][-168:]
        window += [(mid, "before", r["observed_at"], r["operating_mode"], r["vibration_mm_s"], r["temperature_c"]) for r in tail]
    post = table("post_service_telemetry.csv")
    window += [(r["machine_id"], "after", r["observed_at"], r["operating_mode"], r["vibration_mm_s"], r["temperature_c"]) for r in post]
    win_csv = "machine_id,window,observed_at,operating_mode,vibration_mm_s,temperature_c\n" + "\n".join(",".join(map(str, w)) for w in window)
    yield Asset(
        id="view-m001-recovery", name="M001 and M002 · last week before service against the window after", kind="table", content=win_csv,
        created_at=T_UPDATE, updated_at=T_UPDATE,
        metadata={"object_type": "decision_view", "view": "service_check",
                  "facts": {"as_of": T_UPDATE, "service": sv_f, "control_machine": "M002"}})
    yield Asset(id="memo-service-handover", name="Service handover MW301 · M001 · 3 Oct 12:45", kind="document",
                content=ctx.file("service_handover.md").read_text(), created_at=T_HANDOVER2, updated_at=T_HANDOVER2,
                metadata={"object_type": "memo", "written_at": T_HANDOVER2})


def relationships():
    for mid in {r["machine_id"] for r in table("telemetry.csv")}:
        yield references(Ref.asset(f"health-{mid}"), Ref.urn(urn("machine", mid)))
    for h in table("maintenance_history.csv"):
        a = f"maintenance-{h['machine_id']}-{h['performed_date']}"
        yield references(Ref.asset(a), Ref.asset(f"health-{h['machine_id']}"))
    for o in table("open_orders.csv"):
        yield references(Ref.asset(f"order-{o['sales_order_id']}"), Ref.asset(f"health-{o['machine_id']}"))
        yield references(Ref.asset(f"order-{o['sales_order_id']}"), Ref.urn(urn("customer", o["customer_id"])))
    for k, p in enumerate(table("sensor_packets.csv")):
        yield flow(upstream=Ref.asset(f"packet-{p['event_id']}-{k + 1}"), downstream=Ref.asset("view-m003-sensor-feed"), type=FlowType.VIEW)
        yield references(Ref.asset(f"packet-{p['event_id']}-{k + 1}"), Ref.urn(urn("machine", p["machine_id"])))
    yield flow(upstream=Ref.asset("sensor-registry"), downstream=Ref.asset("view-m003-sensor-feed"), type=FlowType.VIEW)
    for o in table("maintenance_options.csv"):
        yield flow(upstream=Ref.asset(f"option-{o['machine_id']}"), downstream=Ref.asset("view-maintenance-slot"), type=FlowType.VIEW)
        yield references(Ref.asset(f"option-{o['machine_id']}"), Ref.urn(urn("machine", o["machine_id"])))
    yield flow(upstream=Ref.asset("crew-today"), downstream=Ref.asset("view-maintenance-slot"), type=FlowType.VIEW)
    yield references(Ref.asset("service-MW301"), Ref.asset("health-M001"))
    yield flow(upstream=Ref.asset("service-MW301"), downstream=Ref.asset("view-m001-recovery"), type=FlowType.VIEW)
    yield flow(upstream=Ref.asset("health-M001"), downstream=Ref.asset("view-m001-recovery"), type=FlowType.VIEW)
    yield flow(upstream=Ref.asset("health-M002"), downstream=Ref.asset("view-m001-recovery"), type=FlowType.VIEW)
    yield references(Ref.asset("memo-technician-handover"), Ref.asset("health-M001"))
    yield references(Ref.asset("memo-technician-handover"), Ref.asset("view-m003-sensor-feed"))
    yield references(Ref.asset("memo-service-handover"), Ref.asset("service-MW301"))
    for v in ("view-m003-sensor-feed", "view-maintenance-slot", "view-m001-recovery"):
        yield means(Ref.asset(v), Ref.term("decision-view"))
    for m in ("memo-technician-handover", "memo-service-handover"):
        yield means(Ref.asset(m), Ref.term("plant-memo"))


def test_connection():
    names = {f.name for f in ctx.files}
    need = {"telemetry.csv", "maintenance_history.csv", "sensor_packets.csv", "technician_handover.md"}
    if need - names:
        return {"status": "FAILURE", "message": f"missing files: {sorted(need - names)}"}
    return {"status": "SUCCESS", "message": f"{len(names)} files ready"}
