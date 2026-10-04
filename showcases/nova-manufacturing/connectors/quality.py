# Quality & Traceability: housing batches and their inspection results, what has
# shipped to which customer, the scrap-rate trend, finished lots and where their
# material came from, and the quality log. A recovered production traveler arrives
# later the same day.

T_LOG = "2026-10-02T08:00:00Z"
T_TRAVELER = "2026-10-02T11:00:00Z"
T_RECOVERED = "2026-10-02T12:00:00Z"


def extract():
    suppliers = lookup("suppliers.csv", "supplier_id")
    customers = lookup("customers.csv", "customer_id")

    batches = {}
    for b in table("batches.csv"):
        batches[b["batch_id"]] = {"batch_id": b["batch_id"], "supplier_id": b["supplier_id"], "supplier": suppliers[b["supplier_id"]]["name"],
                                  "component_id": b["component_id"], "received_date": b["received_date"]}
        yield record(
            f"batch-{b['batch_id']}", f"Housing batch {b['batch_id']} · {suppliers[b['supplier_id']]['name']} · received {nice_day(b['received_date'])}",
            f"Batch {b['batch_id']} of C431 housings from {suppliers[b['supplier_id']]['name']} ({b['supplier_id']}), received {nice_day(b['received_date'])}.",
            "material_batch", ("batch", b["batch_id"]), facts=batches[b["batch_id"]], created_at=b["received_date"] + "T08:00:00Z")

    shipments = []
    for s in table("shipments.csv"):
        f = {"shipment_id": s["shipment_id"], "customer_id": s["customer_id"], "customer": customers[s["customer_id"]]["name"],
             "batch_id": s["batch_id"], "units": num(s["units"]), "state": s["state"]}
        shipments.append(f)
        state = "shipped" if s["state"] == "SHIPPED" else "still in production"
        yield record(
            f"shipment-{s['shipment_id']}", f"{s['shipment_id']} · {f['customer']} · {f['units']} units from batch {s['batch_id']} · {state}",
            f"Shipment {s['shipment_id']}: {f['units']} pumps built with housings from batch {s['batch_id']}, for {f['customer']} ({s['customer_id']}) — {state}.",
            "shipment", ("shipment", s["shipment_id"]), facts=f, status=s["state"], created_at=T_LOG)

    qc = {"quality_case": "QC-994", "suspect_batch": "B994", "symptom": "seal leakage reported in the field", "opened_at": T_LOG,
          "supplier_report_available": False, "lab_analysis_available": False}
    yield record("qms-QC-994", "Quality case QC-994 · seal leakage · suspect batch B994",
                 "QMS case QC-994, opened 2 Oct: seal leakage reported in the field; batch B994 is the suspect material. No metallography or "
                 "supplier root-cause report is available yet.", "quality_case", ("quality-case", "QC-994"), facts=qc, created_at=T_LOG)

    inspections = table("inspections.csv")
    csv_text = "inspection_id,machine_id,batch_id,product_id,result\n" + "\n".join(
        f"{r['inspection_id']},{r['machine_id']},{r['batch_id']},{r['product_id']},{r['result']}" for r in inspections)
    yield Asset(
        id="inspections-housing-batches", name="Housing inspection results · batches B994 and B990 on M001 and M002 · 400 units",
        kind="table", content=csv_text, created_at=T_LOG, updated_at=T_LOG,
        metadata={"object_type": "inspection_results", "view": "batch_inspections",
                  "facts": {"as_of": T_LOG, "batches": list(batches.values()), "shipments": shipments, "quality_case": qc}})

    mix = table("mix_inspections.csv")
    mix_csv = "inspection_id,period,product_id,result\n" + "\n".join(f"{r['inspection_id']},{r['period']},{r['product_id']},{r['result']}" for r in mix)
    yield Asset(
        id="inspections-scrap-trend", name="Final inspection results · before and after the schedule change · 2,000 units",
        kind="table", content=mix_csv, created_at=T_LOG, updated_at=T_LOG,
        metadata={"object_type": "inspection_results", "view": "scrap_mix",
                  "facts": {"as_of": T_LOG, "periods": ["BEFORE", "AFTER"], "reference_mix": "equal weight per product"}})

    lots = []
    for l in table("finished_lots.csv"):
        f = {"finished_lot": l["finished_lot"], "customer_id": l["customer_id"], "customer": customers[l["customer_id"]]["name"],
             "material_batch": l["material_batch"] or None, "units": num(l["units"]), "state": l["state"]}
        lots.append(f)
        origin = f"material from batch {f['material_batch']}" if f["material_batch"] else "material batch NOT RECORDED (scan lost)"
        yield record(
            f"lot-{l['finished_lot']}", f"Finished lot {l['finished_lot']} · {f['customer']} · {f['units']} units · {origin.split(' (')[0]}",
            f"Finished lot {l['finished_lot']}: {f['units']} pumps shipped to {f['customer']} ({l['customer_id']}); {origin}.",
            "finished_lot", ("finished-lot", l["finished_lot"]), facts=f, status=l["state"], created_at=T_LOG)
    yield record(
        "view-finished-lots", "Finished lots · where each lot's housings came from",
        "Traceability sheet: finished lots joined with the material batch each consumed.\n\n"
        + md_table([dict(l, material_batch=l["material_batch"] or "— not recorded —") for l in lots],
                   [("finished_lot", "Lot"), ("customer", "Customer"), ("units", "Units"), ("material_batch", "Material batch")]),
        "decision_view", view="finished_lots", created_at=T_LOG, facts={"as_of": T_LOG, "lots": lots, "quality_case": qc})

    yield Asset(id="memo-quality-log", name="Quality investigation log · QC-994 · 2 Oct", kind="document",
                content=ctx.file("quality_investigation_log.md").read_text(), created_at=T_LOG, updated_at=T_LOG,
                metadata={"object_type": "memo", "written_at": T_LOG})

    # ── Later the same day: the recovered traveler for lot FG42 ───────────────
    serials = table("recovered_serial_genealogy.csv")
    ser_csv = "serial_id,finished_lot,material_batch,component_qty,production_at,recovered_at\n" + "\n".join(
        f"{r['serial_id']},{r['finished_lot']},{r['material_batch']},{r['component_qty']},{r['production_at']},{r['recovered_at']}" for r in serials)
    yield Asset(
        id="traveler-TV42", name="Recovered traveler TV42 · lot FG42 · 30 serials", kind="table", content=ser_csv,
        created_at=T_TRAVELER, updated_at=T_TRAVELER,
        metadata={"object_type": "traveler", "view": "genealogy",
                  "facts": {"as_of": T_RECOVERED, "lot": "FG42", "original_units": next(l["units"] for l in lots if l["finished_lot"] == "FG42"),
                            "customer": next(l["customer"] for l in lots if l["finished_lot"] == "FG42"),
                            "suspect_batch": qc["suspect_batch"],
                            "other_lots": [l for l in lots if l["finished_lot"] != "FG42"]}})
    yield Asset(id="memo-recovered-traveler", name="Recovery ticket REC-42 · traveler for lot FG42 · 2 Oct 11:00", kind="document",
                content=ctx.file("recovered_traveler.md").read_text(), created_at=T_TRAVELER, updated_at=T_TRAVELER,
                metadata={"object_type": "memo", "written_at": T_TRAVELER})


def relationships():
    for b in table("batches.csv"):
        yield references(Ref.asset(f"batch-{b['batch_id']}"), Ref.urn(urn("supplier", b["supplier_id"])))
        yield flow(upstream=Ref.asset(f"batch-{b['batch_id']}"), downstream=Ref.asset("inspections-housing-batches"), type=FlowType.VIEW)
    for m in ("M001", "M002"):
        yield references(Ref.asset("inspections-housing-batches"), Ref.urn(urn("machine", m)))
    for s in table("shipments.csv"):
        yield flow(upstream=Ref.asset(f"shipment-{s['shipment_id']}"), downstream=Ref.asset("inspections-housing-batches"), type=FlowType.VIEW)
        yield references(Ref.asset(f"shipment-{s['shipment_id']}"), Ref.asset(f"batch-{s['batch_id']}"))
        yield references(Ref.asset(f"shipment-{s['shipment_id']}"), Ref.urn(urn("customer", s["customer_id"])))
    yield references(Ref.asset("qms-QC-994"), Ref.asset("batch-B994"))
    yield flow(upstream=Ref.asset("qms-QC-994"), downstream=Ref.asset("view-finished-lots"), type=FlowType.VIEW)
    for l in table("finished_lots.csv"):
        yield flow(upstream=Ref.asset(f"lot-{l['finished_lot']}"), downstream=Ref.asset("view-finished-lots"), type=FlowType.VIEW)
        yield references(Ref.asset(f"lot-{l['finished_lot']}"), Ref.urn(urn("customer", l["customer_id"])))
        if l["material_batch"]:
            yield references(Ref.asset(f"lot-{l['finished_lot']}"), Ref.asset(f"batch-{l['material_batch']}"))
    yield references(Ref.asset("traveler-TV42"), Ref.asset("lot-FG42"))
    yield references(Ref.asset("traveler-TV42"), Ref.asset("batch-B994"))
    yield references(Ref.asset("traveler-TV42"), Ref.asset("batch-B990"))
    yield references(Ref.asset("memo-recovered-traveler"), Ref.asset("traveler-TV42"))
    yield references(Ref.asset("memo-quality-log"), Ref.asset("qms-QC-994"))
    for v in ("view-finished-lots", "inspections-housing-batches", "inspections-scrap-trend", "traveler-TV42"):
        yield means(Ref.asset(v), Ref.term("decision-view"))
    for m in ("memo-quality-log", "memo-recovered-traveler"):
        yield means(Ref.asset(m), Ref.term("plant-memo"))


def test_connection():
    names = {f.name for f in ctx.files}
    need = {"batches.csv", "inspections.csv", "shipments.csv", "mix_inspections.csv", "finished_lots.csv", "quality_investigation_log.md"}
    if need - names:
        return {"status": "FAILURE", "message": f"missing files: {sorted(need - names)}"}
    return {"status": "SUCCESS", "message": f"{len(names)} files ready"}
