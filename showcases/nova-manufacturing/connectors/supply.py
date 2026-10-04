# Supply & Orders: what planners see on a Friday morning when a delivery slips.
# ERP orders and purchase orders, warehouse stock, carrier slots, supplier offers
# and disclosures, plus the supplier-operations notes. Later in the day a recovery
# offer arrives; it is a separate set of records with its own timestamps.

T_NOTE = "2026-10-02T07:15:00Z"
T_OFFER = "2026-10-02T10:30:00Z"
T_RELEASE = "2026-10-02T11:00:00Z"
T_SLOT = "2026-10-02T11:15:00Z"
T_PROC = "2026-10-02T11:30:00Z"
T_UPDATE = "2026-10-02T12:00:00Z"


def _facts():
    suppliers = lookup("suppliers.csv", "supplier_id")
    customers = lookup("customers.csv", "customer_id")
    products = lookup("products.csv", "product_id")
    plants = lookup("plants.csv", "plant_id")
    per_unit = {(b["product_id"], b["component_id"]): num(b["quantity_per_unit"]) for b in table("bill_of_materials.csv")}

    orders = []
    for o in table("orders.csv"):
        units = num(o["units"])
        orders.append({
            "sales_order_id": o["sales_order_id"], "work_order_id": o["work_order_id"],
            "customer_id": o["customer_id"], "customer": customers[o["customer_id"]]["name"],
            "plant_id": o["plant_id"], "product_id": o["product_id"], "product": products[o["product_id"]]["name"],
            "units": units, "housings_needed": units * per_unit[(o["product_id"], "C431")],
            "need_date": o["material_need_date"], "priority": num(o["priority"]),
            "revenue_eur": num(o["revenue_eur"]),
        })
    stock = [{"plant_id": s["plant_id"], "component_id": s["component_id"], "quantity": num(s["quantity"]),
              "status": s["status"], "reserved": num(s["reserved_qty"]), "safety": num(s["safety_qty"])}
             for s in table("housing_stock.csv")]
    inbound = [{"purchase_order_id": p["purchase_order_id"], "supplier_id": p["supplier_id"],
                "supplier": suppliers[p["supplier_id"]]["name"], "component_id": p["component_id"],
                "quantity": num(p["quantity"]), "promised_date": p["promised_date"],
                "revised_eta": p["revised_eta"], "destination": p["destination"]}
               for p in table("inbound_orders.csv")]
    slots = [{"origin": t["origin"], "destination": t["destination"], "departure_date": t["departure_date"],
              "arrival_date": t["arrival_date"], "capacity": num(t["capacity"]),
              "cost_per_unit_eur": num(t["cost_per_unit_eur"])} for t in table("truck_slots.csv")]
    return suppliers, customers, products, plants, orders, stock, inbound, slots


def extract():
    suppliers, customers, products, plants, orders, stock, inbound, slots = _facts()
    short_names = {pid: p["name"].replace("Nova ", "") for pid, p in plants.items()}

    # ── Orders, stock, inbound delivery, truck slot ────────────────────────────
    for o in orders:
        yield record(
            f"order-{o['sales_order_id']}",
            f"{o['sales_order_id']} · {o['customer']} · {o['units']}× {o['product']} · {eur(o['revenue_eur'])}",
            f"Sales order {o['sales_order_id']} for {o['customer']} ({o['customer_id']}): {o['units']} × {o['product']} "
            f"({o['product_id']}), built at {plants[o['plant_id']]['name']} ({o['plant_id']}) on work order {o['work_order_id']}.\n"
            f"Order value {eur(o['revenue_eur'])}, service priority {o['priority']}, complete delivery required "
            f"(no partial shipments or partial revenue).\n"
            f"Material need date: {nice_day(o['need_date'])}. The order needs {o['housings_needed']} C431 housings.",
            "sales_order", ("sales-order", o["sales_order_id"]), facts=o, created_at=AS_OF)

    for s in stock:
        free = s["quantity"] - s["reserved"] - s["safety"] if s["status"] == "RELEASED" else 0
        yield record(
            f"stock-{s['plant_id']}-{s['status'].lower()}",
            f"C431 housings · {plants[s['plant_id']]['name']} · {s['status'].lower()} · {s['quantity']}",
            f"{plants[s['plant_id']]['name']} ({s['plant_id']}) holds {s['quantity']} C431 housings with warehouse status "
            f"{s['status']}; {s['reserved']} reserved, {s['safety']} kept as safety stock"
            + (f", so {free} are free to move." if s["status"] == "RELEASED" else "; quarantined stock cannot be used."),
            "stock_line", ("stock", f"{s['plant_id']}-{s['component_id']}-{s['status']}"),
            facts=s, status=s["status"], created_at=AS_OF)

    for p in inbound:
        late = days_between(p["promised_date"], p["revised_eta"])
        yield record(
            f"po-{p['purchase_order_id']}",
            f"{p['purchase_order_id']} · {p['supplier']} · {p['quantity']} housings · arrival moved to {nice_day(p['revised_eta'])}",
            f"Purchase order {p['purchase_order_id']} with {p['supplier']} ({p['supplier_id']}): {p['quantity']} × C431 housings "
            f"for {plants[p['destination']]['name']}.\nPromised for {nice_day(p['promised_date'])}; the supplier's revised arrival is "
            f"{nice_day(p['revised_eta'])} ({late} days later). Planning must use the revised date.",
            "purchase_order", ("purchase-order", p["purchase_order_id"]), facts=p, created_at=AS_OF)

    for t in slots:
        yield record(
            f"truck-{t['origin']}-{t['destination']}",
            f"Truck slot {t['origin']} → {t['destination']} · {nice_day(t['arrival_date'])} · {t['capacity']} pieces",
            f"The only truck slot from {plants[t['origin']]['name']} to {plants[t['destination']]['name']} before the need dates: "
            f"departs {nice_day(t['departure_date'])}, arrives {nice_day(t['arrival_date'])}, carries at most {t['capacity']} pieces "
            f"at {eur(t['cost_per_unit_eur'])} per piece. No second departure is available in the planning horizon.",
            "truck_slot", ("truck-slot", f"{t['origin']}-{t['destination']}-{t['departure_date']}"), facts=t, created_at=AS_OF)

    # ── Sanitary pump P300: requirement and supplier offers ────────────────────
    req = table("sanitary_requirement.csv")[0]
    req_f = {"product_id": req["product_id"], "product": products[req["product_id"]]["name"],
             "price_eur": num(products[req["product_id"]]["price_eur"]), "component_id": req["component_id"],
             "quantity": num(req["quantity"]), "need_date": req["need_date"],
             "required_revision": req["required_revision"], "required_scope": req["required_scope"]}
    yield record(
        "requirement-p300", f"Requirement · {req_f['product']} {req_f['product_id']} · {req_f['quantity']} housings by {nice_day(req_f['need_date'])}",
        f"The {req_f['product']} ({req_f['product_id']}) needs {req_f['quantity']} C431 housings of revision {req_f['required_revision']} "
        f"with {req_f['required_scope']} approval, arriving by {nice_day(req_f['need_date'])}. The 80-pump delivery is worth "
        f"{eur(req_f['quantity'] * req_f['price_eur'])}.",
        "requirement", ("requirement", "P300-C431"), facts=req_f, created_at=AS_OF)

    offers = []
    for o in table("supplier_offers.csv"):
        f = {"supplier_id": o["supplier_id"], "supplier": suppliers[o["supplier_id"]]["name"], "component_id": o["component_id"],
             "quantity": num(o["quantity"]), "arrival_date": o["arrival_date"], "revision": o["revision"], "scope": o["scope"],
             "valid_until": o["valid_until"], "unit_price_eur": num(o["unit_price_eur"])}
        offers.append(f)
        yield record(
            f"offer-{o['supplier_id']}",
            f"Offer · {f['supplier']} · {f['quantity']:,} housings · rev {f['revision']} {f['scope'].lower()} · {eur(f['unit_price_eur'])}",
            f"{f['supplier']} ({f['supplier_id']}) offers {f['quantity']:,} C431 housings, revision {f['revision']}, approved for "
            f"{f['scope']} use until {nice_day(f['valid_until'])}. Firm arrival {nice_day(f['arrival_date'])} at {eur(f['unit_price_eur'])} each.",
            "supplier_offer", ("offer", f"{o['supplier_id']}-C431-{o['arrival_date']}"), facts=f, created_at=AS_OF)

    # ── Booked supply, who casts it, and the outage ───────────────────────────
    booked = []
    for b in table("booked_supply.csv"):
        f = {"supplier_id": b["supplier_id"], "supplier": suppliers[b["supplier_id"]]["name"], "component_id": b["component_id"],
             "quantity": num(b["quantity"]), "status": b["status"], "due_date": b["due_date"]}
        booked.append(f)
        label = "booked" if b["status"] == "BOOKED" else "available alternative"
        yield record(
            f"booked-{b['supplier_id']}",
            f"{f['supplier']} · {f['quantity']} C431 housings · {label}",
            f"{f['supplier']} ({f['supplier_id']}): {f['quantity']} C431 housings, {label}, due {nice_day(f['due_date'])}.",
            "booked_supply", ("booked-supply", f"{b['supplier_id']}-C431"), facts=f, status=b["status"], created_at=AS_OF)

    sources = [{"supplier_id": r["supplier_id"], "supplier": suppliers[r["supplier_id"]]["name"],
                "upstream_id": r["upstream_supplier_id"], "upstream": suppliers[r["upstream_supplier_id"]]["name"],
                "component_id": r["component_id"]} for r in table("casting_sources.csv")]
    yield record(
        "register-casting-sources", "Who casts C431 · supplier disclosure register",
        "Disclosure register — which foundry casts the C431 housings each supplier sells to Nova:\n"
        + md_table(sources, [("supplier", "Supplier"), ("upstream", "Casts at")]),
        "disclosure_register", ("disclosure-register", "C431-casting"), facts={"sources": sources}, created_at="2026-10-01T12:00:00Z")

    outages = [{"upstream_id": d["supplier_id"], "upstream": suppliers[d["supplier_id"]]["name"],
                "component_id": d["affected_component"], "start_date": d["start_date"], "end_date": d["end_date"]}
               for d in table("outage_notices.csv")]
    for d in outages:
        yield record(
            f"outage-{d['upstream_id']}",
            f"Outage notice · {d['upstream']} ({d['upstream_id']}) · {nice_day(d['start_date'])}–{nice_day(d['end_date'])}",
            f"{d['upstream']} ({d['upstream_id']}) confirmed an outage for {d['component_id']} castings from "
            f"{nice_day(d['start_date'])} to {nice_day(d['end_date'])}.",
            "outage_notice", ("outage-notice", f"{d['upstream_id']}-{d['start_date']}"), facts=d, created_at=AS_OF)

    # ── The memo ──────────────────────────────────────────────────────────────
    yield Asset(id="memo-dispatch-and-qualification", name="Supplier operations note · C431 housings · 2 Oct 07:15",
                kind="document", content=ctx.file("dispatch_and_qualification.md").read_text(),
                metadata={"object_type": "memo", "written_at": T_NOTE}, created_at=T_NOTE, updated_at=T_NOTE)

    # ── Decision views: the joined sheets planners actually work from ─────────
    demand_cols = [("sales_order_id", "Order"), ("customer", "Customer"), ("units", "Pumps"), ("housings_needed", "Housings"),
                   ("need_date", "Needed by"), ("priority", "Priority"), ("revenue_eur", "Value (€)")]
    yield record(
        "view-supply-position", "Munich housing supply position · Fri 2 Oct 10:00",
        "Planner's view of C431 housings for Nova Munich, joined from ERP orders, warehouse stock, the open purchase order and "
        "the carrier feed.\n\n**Demand (strict priority, complete delivery only)**\n" + md_table(orders, demand_cols)
        + "\n\n**Stock**\n" + md_table(stock, [("plant_id", "Plant"), ("status", "Status"), ("quantity", "Quantity"), ("reserved", "Reserved"), ("safety", "Safety")])
        + "\n\n**Inbound**\n" + md_table(inbound, [("purchase_order_id", "PO"), ("supplier", "Supplier"), ("quantity", "Qty"), ("promised_date", "Promised"), ("revised_eta", "Revised arrival")])
        + "\n\n**Truck slots**\n" + md_table(slots, [("origin", "From"), ("destination", "To"), ("arrival_date", "Arrives"), ("capacity", "Capacity")]),
        "decision_view", view="supply_position", created_at=AS_OF,
        facts={"as_of": AS_OF, "component_id": "C431", "destination": "MUC", "demand": orders, "stock": stock,
               "inbound": inbound, "truck_slots": slots, "recovery": None, "plant_names": short_names})

    yield record(
        "view-sanitary-sourcing", "Sanitary pump P300 · housing sourcing options",
        "Sourcing sheet for the P300 housing requirement, joined from the requirement and the supplier offers.\n\n"
        f"**Requirement:** {req_f['quantity']} × C431, revision {req_f['required_revision']}, {req_f['required_scope']} approval, by {nice_day(req_f['need_date'])}.\n\n"
        + md_table(offers, [("supplier", "Supplier"), ("quantity", "Quantity"), ("revision", "Rev"), ("scope", "Scope"), ("arrival_date", "Arrives"), ("unit_price_eur", "€ / pc")]),
        "decision_view", view="sanitary_sourcing", created_at=AS_OF,
        facts={"as_of": AS_OF, "requirement": req_f, "offers": offers})

    yield record(
        "view-upstream-map", "C431 booked supply · who casts it · outage window",
        "Supply-risk sheet: what is booked for C431, which foundry casts it, and which foundry is down.\n\n"
        + md_table(booked, [("supplier", "Supplier"), ("quantity", "Qty"), ("status", "Status"), ("due_date", "Due")])
        + "\n\n" + md_table(sources, [("supplier", "Supplier"), ("upstream", "Casts at")])
        + "\n\n" + md_table(outages, [("upstream", "Foundry"), ("start_date", "Down from"), ("end_date", "Down until")]),
        "decision_view", view="upstream_map", created_at=AS_OF,
        facts={"as_of": AS_OF, "booked": booked, "sources": sources, "outages": outages})

    # ── Later the same day: a recovery offer ──────────────────────────────────
    ro = table("recovery_offer.csv")[0]
    rel = table("engineering_release.csv")
    slot = table("recovery_transport.csv")[0]
    offer_f = {"offer_id": ro["offer_id"], "supplier_id": ro["supplier_id"], "supplier": suppliers[ro["supplier_id"]]["name"],
               "component_id": ro["component_id"], "quantity": num(ro["quantity"]), "revision": ro["revision"],
               "unit_price_landed_eur": num(ro["unit_price_landed_eur"]), "accept_before": ro["accept_before"]}
    release_f = {"approval_id": rel[0]["approval_id"], "offer_id": rel[0]["offer_id"], "revision": rel[0]["revision"],
                 "products": [r["product_id"] for r in rel], "scope": rel[0]["scope"]}
    slot_f = {"offer_id": slot["offer_id"], "destination": slot["destination"], "arrival_date": slot["arrival_date"],
              "capacity": num(slot["capacity"]), "status": slot["status"]}

    yield record(
        "offer-recovery-s004", f"Recovery offer {offer_f['offer_id']} · {offer_f['supplier']} · {offer_f['quantity']} housings · {eur(offer_f['unit_price_landed_eur'])} landed",
        f"{offer_f['supplier']} ({offer_f['supplier_id']}) offers {offer_f['quantity']} finished C431 housings, revision {offer_f['revision']}, "
        f"at {eur(offer_f['unit_price_landed_eur'])} landed each. Indivisible. The offer expires at 15:00 UTC today; it is an offer, not stock.",
        "supplier_offer", ("offer", f"{ro['offer_id']}"), facts=offer_f, created_at=T_OFFER)
    yield record(
        "release-eng101", f"Engineering release {release_f['approval_id']} · revision D for {' and '.join(release_f['products'])}",
        f"Engineering release {release_f['approval_id']}: revision {release_f['revision']} housings from offer {release_f['offer_id']} "
        f"are approved for {' and '.join(release_f['products'])} ({release_f['scope'].lower()} use).",
        "engineering_release", ("engineering-release", release_f["approval_id"]), facts=release_f, created_at=T_RELEASE)
    yield record(
        "slot-recovery", f"Held truck slot · arrives Munich {nice_day(slot_f['arrival_date'])} · {slot_f['capacity']} pieces",
        f"A truck slot is held for offer {slot_f['offer_id']}: it arrives in Munich on {nice_day(slot_f['arrival_date'])} and carries up to "
        f"{slot_f['capacity']} pieces — but only if the offer is accepted before its cutoff.",
        "truck_slot", ("truck-slot", f"{slot_f['offer_id']}-held"), facts=slot_f, status=slot_f["status"], created_at=T_SLOT)
    yield Asset(id="memo-recovery-dispatch", name="Procurement note PROC-101 · recovery offer · 2 Oct 11:30", kind="document",
                content=ctx.file("recovery_dispatch.md").read_text(),
                metadata={"object_type": "memo", "written_at": T_PROC}, created_at=T_PROC, updated_at=T_PROC)

    yield record(
        "view-supply-position-update", "Munich housing supply position · updated Fri 2 Oct 12:00",
        "The Friday-10:00 position, updated at 12:00 with the recovery offer, its engineering release and the held truck slot. "
        "Nothing has been accepted; the recovery lot is still an offer.\n\n"
        + md_table(orders, demand_cols)
        + f"\n\n**New:** {offer_f['quantity']} housings from {offer_f['supplier']}, landed {eur(offer_f['unit_price_landed_eur'])} each, "
          f"arriving {nice_day(slot_f['arrival_date'])}, accept before {offer_f['accept_before'][11:16]} UTC; released for {' and '.join(release_f['products'])}.",
        "decision_view", view="supply_position", created_at=T_UPDATE,
        facts={"as_of": T_UPDATE, "component_id": "C431", "destination": "MUC", "demand": orders, "stock": stock,
               "inbound": inbound, "truck_slots": slots, "plant_names": short_names,
               "recovery": {"offer": offer_f, "release": release_f, "slot": slot_f}})


def relationships():
    # views are derived from the records they join (lineage)
    for o in table("orders.csv"):
        yield flow(upstream=Ref.asset(f"order-{o['sales_order_id']}"), downstream=Ref.asset("view-supply-position"), type=FlowType.VIEW)
        yield references(Ref.asset(f"order-{o['sales_order_id']}"), Ref.urn(urn("customer", o["customer_id"])))
    for s in table("housing_stock.csv"):
        key = f"stock-{s['plant_id']}-{s['status'].lower()}"
        yield flow(upstream=Ref.asset(key), downstream=Ref.asset("view-supply-position"), type=FlowType.VIEW)
    for p in table("inbound_orders.csv"):
        yield flow(upstream=Ref.asset(f"po-{p['purchase_order_id']}"), downstream=Ref.asset("view-supply-position"), type=FlowType.VIEW)
        yield references(Ref.asset(f"po-{p['purchase_order_id']}"), Ref.urn(urn("supplier", p["supplier_id"])))
    for t in table("truck_slots.csv"):
        key = f"truck-{t['origin']}-{t['destination']}"
        yield flow(upstream=Ref.asset(key), downstream=Ref.asset("view-supply-position"), type=FlowType.VIEW)

    yield flow(upstream=Ref.asset("requirement-p300"), downstream=Ref.asset("view-sanitary-sourcing"), type=FlowType.VIEW)
    for o in table("supplier_offers.csv"):
        yield flow(upstream=Ref.asset(f"offer-{o['supplier_id']}"), downstream=Ref.asset("view-sanitary-sourcing"), type=FlowType.VIEW)
        yield references(Ref.asset(f"offer-{o['supplier_id']}"), Ref.urn(urn("supplier", o["supplier_id"])))

    for b in table("booked_supply.csv"):
        yield flow(upstream=Ref.asset(f"booked-{b['supplier_id']}"), downstream=Ref.asset("view-upstream-map"), type=FlowType.VIEW)
        yield references(Ref.asset(f"booked-{b['supplier_id']}"), Ref.urn(urn("supplier", b["supplier_id"])))
    yield flow(upstream=Ref.asset("register-casting-sources"), downstream=Ref.asset("view-upstream-map"), type=FlowType.VIEW)
    for s in table("casting_sources.csv"):
        yield references(Ref.asset("register-casting-sources"), Ref.urn(urn("supplier", s["upstream_supplier_id"])))
    for d in table("outage_notices.csv"):
        yield flow(upstream=Ref.asset(f"outage-{d['supplier_id']}"), downstream=Ref.asset("view-upstream-map"), type=FlowType.VIEW)
        yield references(Ref.asset(f"outage-{d['supplier_id']}"), Ref.urn(urn("supplier", d["supplier_id"])))

    # the 12:00 sheet is the 10:00 sheet plus what arrived since
    yield flow(upstream=Ref.asset("view-supply-position"), downstream=Ref.asset("view-supply-position-update"), type=FlowType.VIEW)
    yield flow(upstream=Ref.asset("offer-recovery-s004"), downstream=Ref.asset("view-supply-position-update"), type=FlowType.VIEW)
    yield flow(upstream=Ref.asset("release-eng101"), downstream=Ref.asset("view-supply-position-update"), type=FlowType.VIEW)
    yield flow(upstream=Ref.asset("slot-recovery"), downstream=Ref.asset("view-supply-position-update"), type=FlowType.VIEW)
    yield references(Ref.asset("offer-recovery-s004"), Ref.urn(urn("supplier", "S004")))
    yield references(Ref.asset("memo-recovery-dispatch"), Ref.asset("offer-recovery-s004"))
    yield references(Ref.asset("memo-dispatch-and-qualification"), Ref.asset("po-PO101"))
    yield references(Ref.asset("memo-dispatch-and-qualification"), Ref.asset("register-casting-sources"))

    for v in ("view-supply-position", "view-supply-position-update", "view-sanitary-sourcing", "view-upstream-map"):
        yield means(Ref.asset(v), Ref.term("decision-view"))
    for m in ("memo-dispatch-and-qualification", "memo-recovery-dispatch"):
        yield means(Ref.asset(m), Ref.term("plant-memo"))


def test_connection():
    names = sorted(f.name for f in ctx.files)
    need = {"orders.csv", "housing_stock.csv", "inbound_orders.csv", "dispatch_and_qualification.md"}
    missing = need - set(names)
    if missing:
        return {"status": "FAILURE", "message": f"missing files: {sorted(missing)}"}
    return {"status": "SUCCESS", "message": f"{len(names)} files ready"}
