# Inventory Control: stock, reservations, expiry and transfers across Munich,
# Hamburg and Brno. Three different parts (seal cartridges, resin, bearing kits)
# each with its own way of looking more available than it is. Later the same
# morning, the reservation service's audit trail arrives.

T_POLICY = "2026-10-01T09:00:00Z"
T_TRACE = "2026-10-02T08:04:00Z"


def extract():
    plants = lookup("plants.csv", "plant_id")
    pname = lambda pid: plants[pid]["name"]

    # ── Seal cartridges: Munich needs 400 by 5 October ───────────────────────
    stock = []
    for s in table("seal_stock.csv"):
        f = {"plant_id": s["plant_id"], "component_id": s["component_id"], "quantity": num(s["quantity"]), "reserved": num(s["reserved_qty"]),
             "safety": num(s["safety_qty"]), "quarantine": num(s["quarantine_qty"])}
        f["free"] = f["quantity"] - f["reserved"] - f["safety"] - f["quarantine"]
        stock.append(f)
        yield record(
            f"seal-stock-{s['plant_id']}", f"Seal cartridges · {pname(s['plant_id'])} · {f['quantity']:,} on hand",
            f"{pname(s['plant_id'])} ({s['plant_id']}) shows {f['quantity']:,} seal cartridges (C100): {f['reserved']} reserved, {f['safety']} safety stock, "
            f"{f['quarantine']} in quarantine. These buckets never overlap.", "stock_position", ("stock", f"{s['plant_id']}-C100"), facts=f, created_at=AS_OF)
    demand = [{"plant_id": d["plant_id"], "component_id": d["component_id"], "quantity": num(d["quantity"]), "need_date": d["need_date"],
               "priority": num(d["priority"])} for d in table("seal_demand.csv")]
    for d in demand:
        yield record(f"seal-demand-{d['plant_id']}", f"Demand · {pname(d['plant_id'])} · {d['quantity']} seal cartridges by {nice_day(d['need_date'])}",
                     f"{pname(d['plant_id'])} needs {d['quantity']} seal cartridges (C100) by {nice_day(d['need_date'])}; priority {d['priority']}.",
                     "demand", ("demand", f"{d['plant_id']}-C100-{d['need_date']}"), facts=d, created_at=AS_OF)
    lanes = [{"origin": l["origin"], "destination": l["destination"], "arrival_date": l["arrival_date"], "capacity": num(l["capacity"]),
              "unit_cost_eur": num(l["unit_cost_eur"]), "cold_chain": bool(num(l["cold_chain"]))} for l in table("seal_lanes.csv")]
    for l in lanes:
        yield record(f"seal-lane-{l['origin']}-{l['destination']}",
                     f"Truck lane {l['origin']} → {l['destination']} · {l['capacity']} units · {eur(l['unit_cost_eur'])} each",
                     f"Truck lane from {pname(l['origin'])} to {pname(l['destination'])}: arrives {nice_day(l['arrival_date'])}, carries up to {l['capacity']} units "
                     f"at {eur(l['unit_cost_eur'])} per unit, no fixed trip charge.", "transport_lane",
                     ("lane", f"{l['origin']}-{l['destination']}-C100-{l['arrival_date']}"), facts=l, created_at=AS_OF)
    q = table("emergency_quotes.csv")[0]
    quote = {"component_id": q["component_id"], "price_eur": num(q["price_eur"]), "earliest_arrival": q["earliest_arrival"]}
    yield record("seal-emergency-quote", f"Emergency purchase quote · seal cartridges · {eur(quote['price_eur'])} each · earliest {nice_day(quote['earliest_arrival'])}",
                 f"Purchasing's emergency quote for seal cartridges: {eur(quote['price_eur'])} per unit, no delivery before {nice_day(quote['earliest_arrival'])}.",
                 "supplier_quote", ("quote", "C100-emergency"), facts=quote, created_at=AS_OF)
    yield record(
        "view-seal-shortage", "Seal cartridges · Munich needs 400 by 5 Oct · stock, lanes and quote",
        "Inventory control's sheet for the Munich seal-cartridge shortage.\n\n" + md_table(stock, [("plant_id", "Plant"), ("quantity", "On hand"), ("reserved", "Reserved"),
        ("safety", "Safety"), ("quarantine", "Quarantine"), ("free", "Free to move")])
        + "\n\n" + md_table(lanes, [("origin", "From"), ("destination", "To"), ("arrival_date", "Arrives"), ("capacity", "Capacity"), ("unit_cost_eur", "€/unit")]),
        "decision_view", view="seal_shortage", created_at=AS_OF,
        facts={"as_of": AS_OF, "stock": stock, "demand": demand, "lanes": lanes, "emergency_quote": quote,
               "plant_names": {k: v["name"].replace("Nova ", "") for k, v in plants.items()}})

    # ── Resin: plenty on paper, little that is usable ─────────────────────────
    lots = []
    for l in table("resin_lots.csv"):
        f = {"lot_id": l["lot_id"], "plant_id": l["plant_id"], "component_id": l["component_id"], "quantity": num(l["quantity"]),
             "reserved": num(l["reserved_qty"]), "expires_date": l["expires_date"]}
        lots.append(f)
        yield record(f"resin-lot-{l['lot_id']}", f"Resin lot {l['lot_id']} · {pname(l['plant_id'])} · {f['quantity']} kg · expires {nice_day(f['expires_date'])}",
                     f"Resin lot {l['lot_id']} at {pname(l['plant_id'])}: {f['quantity']} kg, {f['reserved']} kg reserved for a signed customer order, expires {nice_day(f['expires_date'])}.",
                     "stock_lot", ("lot", l["lot_id"]), facts=f, created_at=AS_OF)
    rd = table("resin_demand.csv")[0]
    r_demand = {"plant_id": rd["plant_id"], "component_id": rd["component_id"], "quantity": num(rd["quantity"]), "need_date": rd["need_date"]}
    yield record("resin-demand-MUC", f"Demand · Munich · {r_demand['quantity']} kg resin on {nice_day(r_demand['need_date'])}",
                 f"Munich consumes {r_demand['quantity']} kg of resin on {nice_day(r_demand['need_date'])}; it must still be usable then and travel on a cold-chain route.",
                 "demand", ("demand", f"MUC-CRESIN-{r_demand['need_date']}"), facts=r_demand, created_at=AS_OF)
    r_lanes = [{"origin": l["origin"], "destination": l["destination"], "arrival_date": l["arrival_date"], "capacity": num(l["capacity"]),
                "unit_cost_eur": num(l["unit_cost_eur"]), "cold_chain": bool(num(l["cold_chain"]))} for l in table("resin_lanes.csv")]
    for l in r_lanes:
        kind = "cold-chain" if l["cold_chain"] else "ambient"
        yield record(f"resin-lane-{kind}", f"Truck lane {l['origin']} → {l['destination']} · {kind} · {l['capacity']} kg · {eur(l['unit_cost_eur'])}/kg",
                     f"{kind.capitalize()} truck lane {pname(l['origin'])} → {pname(l['destination'])}: arrives {nice_day(l['arrival_date'])}, up to {l['capacity']} kg at {eur(l['unit_cost_eur'])}/kg.",
                     "transport_lane", ("lane", f"{l['origin']}-{l['destination']}-CRESIN-{kind}"), facts=l, created_at=AS_OF)
    yield record(
        "view-resin-lots", "Resin · Munich needs 120 kg on 6 Oct · lots, reservations and routes",
        "Resin sheet for Munich.\n\n" + md_table(lots, [("lot_id", "Lot"), ("quantity", "kg"), ("reserved", "Reserved"), ("expires_date", "Expires")])
        + "\n\n" + md_table(r_lanes, [("origin", "From"), ("destination", "To"), ("arrival_date", "Arrives"), ("capacity", "kg"), ("unit_cost_eur", "€/kg"), ("cold_chain", "Cold chain")]),
        "decision_view", view="resin_lots", created_at=AS_OF, facts={"as_of": AS_OF, "lots": lots, "demand": r_demand, "lanes": r_lanes})

    # ── Bearing kits: two approvals, one shelf ────────────────────────────────
    b_stock = table("bearing_stock.csv")[0]
    bs = {"plant_id": b_stock["plant_id"], "component_id": "CBRG", "quantity": num(b_stock["quantity"]), "reserved": num(b_stock["reserved_qty"]),
          "safety": num(b_stock["safety_qty"]), "quarantine": num(b_stock["quarantine_qty"])}
    yield record("bearing-stock-HAM", f"Bearing kits · {pname(bs['plant_id'])} · {bs['quantity']} on hand · {bs['safety']} safety",
                 f"{pname(bs['plant_id'])} holds {bs['quantity']} spindle bearing kits (CBRG), {bs['reserved']} reserved, {bs['safety']} safety stock that nobody may touch.",
                 "stock_position", ("stock", "HAM-CBRG"), facts=bs, created_at=AS_OF)
    b_demand = [{"plant_id": d["plant_id"], "quantity": num(d["quantity"]), "need_date": d["need_date"], "priority": num(d["priority"])} for d in table("bearing_demand.csv")]
    for d in b_demand:
        yield record(f"bearing-demand-{d['plant_id']}", f"Demand · {pname(d['plant_id'])} · {d['quantity']} bearing kits · priority {d['priority']}",
                     f"{pname(d['plant_id'])} needs {d['quantity']} bearing kits by {nice_day(d['need_date'])}; priority {d['priority']}.", "demand",
                     ("demand", f"{d['plant_id']}-CBRG-{d['need_date']}"), facts=d, created_at=AS_OF)
    proposals = [{"proposal_id": p["proposal_id"], "origin": p["origin"], "destination": p["destination"], "component_id": "CBRG",
                  "quantity": num(p["quantity"]), "stock_version": num(p["stock_version"])} for p in table("transfer_proposals.csv")]
    for p in proposals:
        yield record(f"proposal-{p['proposal_id']}", f"Transfer proposal {p['proposal_id']} · {p['origin']} → {p['destination']} · {p['quantity']} kits · read stock version {p['stock_version']}",
                     f"Draft {p['proposal_id']}: move {p['quantity']} bearing kits from {pname(p['origin'])} to {pname(p['destination'])}. A proposal is not a reservation; it read the Hamburg "
                     f"stock at version {p['stock_version']}.", "transfer_proposal", ("proposal", p["proposal_id"]), facts=p, created_at=AS_OF)
    b_lanes = [{"origin": l["origin"], "destination": l["destination"], "arrival_date": l["arrival_date"], "capacity": num(l["capacity"]),
                "unit_cost_eur": num(l["unit_cost_eur"])} for l in table("bearing_lanes.csv")]
    yield record(
        "view-bearing-proposals", "Bearing kits · two transfer proposals against Hamburg's stock",
        "Allocation sheet for the Hamburg bearing kits.\n\n" + md_table(proposals, [("proposal_id", "Proposal"), ("origin", "From"), ("destination", "To"), ("quantity", "Kits"), ("stock_version", "Read version")])
        + f"\n\nHamburg: {bs['quantity']} on hand, {bs['reserved']} reserved, {bs['safety']} safety.",
        "decision_view", view="bearing_proposals", created_at=AS_OF,
        facts={"as_of": AS_OF, "stock": bs, "demand": b_demand, "proposals": proposals, "lanes": b_lanes})

    # ── Later: what the reservation service actually did ──────────────────────
    resp = {r["attempt_id"]: r for r in table("reservation_responses.csv")}
    attempts = []
    for rq in table("reservation_requests.csv"):
        rs = resp[rq["attempt_id"]]
        f = {"attempt_id": rq["attempt_id"], "proposal_id": rq["proposal_id"], "idempotency_key": rq["idempotency_key"], "requested_qty": num(rq["requested_qty"]),
             "expected_stock_version": num(rq["expected_stock_version"]), "requested_at": rq["requested_at"], "result": rs["result"],
             "decision_id": rs["decision_id"] or None, "accepted_qty": num(rs["accepted_qty"]), "stock_version_after": num(rs["stock_version"])}
        attempts.append(f)
        yield record(f"attempt-{rq['attempt_id']}", f"Reservation attempt {rq['attempt_id']} · {rq['proposal_id']} · requested {f['requested_qty']} · {rs['result'].replace('_', ' ').lower()}",
                     f"Attempt {rq['attempt_id']} for {rq['proposal_id']} (key {rq['idempotency_key']}) requested {f['requested_qty']} kits against stock version {f['expected_stock_version']}; "
                     f"result: {rs['result'].replace('_', ' ').lower()}, accepted {f['accepted_qty']}.", "reservation_attempt",
                     ("reservation-attempt", rq["attempt_id"]), facts=f, status=rs["result"], created_at=rq["requested_at"])
    ls = table("later_stock.csv")[0]
    later = {"plant_id": ls["plant_id"], "component_id": "CBRG", "physical_qty": num(ls["physical_qty"]), "reserved_qty": num(ls["reserved_qty"]),
             "safety_qty": num(ls["safety_qty"]), "stock_version": num(ls["stock_version"]), "observed_at": ls["observed_at"]}
    yield record("bearing-stock-HAM-later", f"Bearing kits · Hamburg · after reservations · {later['reserved_qty']} reserved · version {later['stock_version']}",
                 f"Hamburg stock at {ls['observed_at'][11:16]} UTC: {later['physical_qty']} physical, {later['reserved_qty']} reserved, {later['safety_qty']} safety; version {later['stock_version']}. "
                 f"No physical dispatch yet.", "stock_position", ("stock", "HAM-CBRG-later"), facts=later, created_at=ls["observed_at"])
    yield record(
        "view-reservation-audit", "Bearing kits · reservation attempts reconciled with the later stock snapshot",
        "Audit sheet: every request and response, plus the stock afterwards.\n\n" + md_table(attempts, [("attempt_id", "Attempt"), ("proposal_id", "Proposal"), ("requested_qty", "Requested"),
        ("result", "Result"), ("accepted_qty", "Accepted"), ("decision_id", "Decision")]),
        "decision_view", view="reservation_audit", created_at=T_TRACE, facts={"as_of": T_TRACE, "attempts": attempts, "stock": later, "demand": b_demand})

    yield Asset(id="memo-dispatch-policy", name="Inventory control policy and open requests · effective 1 Oct", kind="document",
                content=ctx.file("dispatch_policy.md").read_text(), created_at=T_POLICY, updated_at=T_POLICY,
                metadata={"object_type": "memo", "written_at": T_POLICY})
    yield Asset(id="memo-reservation-incident", name="Reservation service trace RES-51 · 2 Oct 08:04", kind="document",
                content=ctx.file("reservation_incident.md").read_text(), created_at=T_TRACE, updated_at=T_TRACE,
                metadata={"object_type": "memo", "written_at": T_TRACE})


def relationships():
    for s in table("seal_stock.csv"):
        yield flow(upstream=Ref.asset(f"seal-stock-{s['plant_id']}"), downstream=Ref.asset("view-seal-shortage"), type=FlowType.VIEW)
        yield references(Ref.asset(f"seal-stock-{s['plant_id']}"), Ref.urn(urn("plant", s["plant_id"])))
    for d in table("seal_demand.csv"):
        yield flow(upstream=Ref.asset(f"seal-demand-{d['plant_id']}"), downstream=Ref.asset("view-seal-shortage"), type=FlowType.VIEW)
    for l in table("seal_lanes.csv"):
        yield flow(upstream=Ref.asset(f"seal-lane-{l['origin']}-{l['destination']}"), downstream=Ref.asset("view-seal-shortage"), type=FlowType.VIEW)
    yield flow(upstream=Ref.asset("seal-emergency-quote"), downstream=Ref.asset("view-seal-shortage"), type=FlowType.VIEW)
    for l in table("resin_lots.csv"):
        yield flow(upstream=Ref.asset(f"resin-lot-{l['lot_id']}"), downstream=Ref.asset("view-resin-lots"), type=FlowType.VIEW)
    yield flow(upstream=Ref.asset("resin-demand-MUC"), downstream=Ref.asset("view-resin-lots"), type=FlowType.VIEW)
    for l in table("resin_lanes.csv"):
        kind = "cold-chain" if num(l["cold_chain"]) else "ambient"
        yield flow(upstream=Ref.asset(f"resin-lane-{kind}"), downstream=Ref.asset("view-resin-lots"), type=FlowType.VIEW)
    yield flow(upstream=Ref.asset("bearing-stock-HAM"), downstream=Ref.asset("view-bearing-proposals"), type=FlowType.VIEW)
    for d in table("bearing_demand.csv"):
        yield flow(upstream=Ref.asset(f"bearing-demand-{d['plant_id']}"), downstream=Ref.asset("view-bearing-proposals"), type=FlowType.VIEW)
    for p in table("transfer_proposals.csv"):
        yield flow(upstream=Ref.asset(f"proposal-{p['proposal_id']}"), downstream=Ref.asset("view-bearing-proposals"), type=FlowType.VIEW)
        yield references(Ref.asset(f"proposal-{p['proposal_id']}"), Ref.urn(urn("plant", p["origin"])))
        yield references(Ref.asset(f"proposal-{p['proposal_id']}"), Ref.urn(urn("plant", p["destination"])))
    for r in table("reservation_requests.csv"):
        yield flow(upstream=Ref.asset(f"attempt-{r['attempt_id']}"), downstream=Ref.asset("view-reservation-audit"), type=FlowType.VIEW)
        yield references(Ref.asset(f"attempt-{r['attempt_id']}"), Ref.asset(f"proposal-{r['proposal_id']}"))
    yield flow(upstream=Ref.asset("bearing-stock-HAM-later"), downstream=Ref.asset("view-reservation-audit"), type=FlowType.VIEW)
    yield references(Ref.asset("memo-dispatch-policy"), Ref.asset("view-seal-shortage"))
    yield references(Ref.asset("memo-dispatch-policy"), Ref.asset("view-resin-lots"))
    yield references(Ref.asset("memo-dispatch-policy"), Ref.asset("view-bearing-proposals"))
    yield references(Ref.asset("memo-reservation-incident"), Ref.asset("view-reservation-audit"))
    for v in ("view-seal-shortage", "view-resin-lots", "view-bearing-proposals", "view-reservation-audit"):
        yield means(Ref.asset(v), Ref.term("decision-view"))
    for m in ("memo-dispatch-policy", "memo-reservation-incident"):
        yield means(Ref.asset(m), Ref.term("plant-memo"))


def test_connection():
    names = {f.name for f in ctx.files}
    need = {"seal_stock.csv", "resin_lots.csv", "transfer_proposals.csv", "dispatch_policy.md"}
    if need - names:
        return {"status": "FAILURE", "message": f"missing files: {sorted(need - names)}"}
    return {"status": "SUCCESS", "message": f"{len(names)} files ready"}
