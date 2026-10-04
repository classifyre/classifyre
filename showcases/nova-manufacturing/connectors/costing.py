# Purchasing & Costing: supplier quotes, quarter-end offers, the shop-floor costing
# sheet and the commercial notes that explain them. Four weeks later, a pilot of a
# revised cutting process changes one of the numbers; that arrives as new records.

T_MEMO = "2026-10-02T08:00:00Z"
T_TRIAL_END = "2026-10-05T10:00:00Z"
T_RELEASE = "2026-10-05T11:00:00Z"
T_UPDATE = "2026-10-05T12:00:00Z"


def extract():
    suppliers = lookup("suppliers.csv", "supplier_id")
    products = lookup("products.csv", "product_id")

    # ── Stainless steel: headline price versus usable yield ───────────────────
    quotes = []
    for q in table("steel_quotes.csv"):
        f = {"supplier_id": q["supplier_id"], "supplier": suppliers[q["supplier_id"]]["name"], "component_id": q["component_id"],
             "price_per_kg_eur": num(q["price_per_kg_eur"]), "freight_per_kg_eur": num(q["freight_per_kg_eur"]),
             "usable_yield": num(q["usable_yield"]), "net_requirement_kg": num(q["net_requirement_kg"])}
        quotes.append(f)
        yield record(
            f"quote-steel-{q['supplier_id']}",
            f"Steel quote · {f['supplier']} · {eur(f['price_per_kg_eur'])}/kg · {f['usable_yield']:.0%} usable yield",
            f"{f['supplier']} ({f['supplier_id']}) quotes stainless steel feedstock at {eur(f['price_per_kg_eur'])} per purchased kg plus "
            f"{eur(f['freight_per_kg_eur'])} freight per purchased kg. In manufacturing trials {f['usable_yield']:.0%} of the purchased mass "
            f"ends up usable. Nova needs {f['net_requirement_kg']:,} usable kg.",
            "supplier_quote", ("steel-quote", f"{q['supplier_id']}-CSTEEL"), facts=f, created_at=T_MEMO)

    yield record(
        "view-steel-comparison", "Steel feedstock · cost per usable kilogram",
        "Cost sheet for the Q4 steel requirement, joined from both supplier quotes and the manufacturing trial yields.\n\n"
        + md_table(quotes, [("supplier", "Supplier"), ("price_per_kg_eur", "€/kg"), ("freight_per_kg_eur", "Freight €/kg"),
                            ("usable_yield", "Usable yield"), ("net_requirement_kg", "Usable kg needed")]),
        "decision_view", view="steel_comparison", created_at=T_MEMO,
        facts={"as_of": T_MEMO, "quotes": quotes, "release": None, "trials": []})

    # ── Resin: quarter-end bulk offer versus what fits and what is used ───────
    offers = []
    for o in table("resin_offers.csv"):
        f = {"supplier_id": o["supplier_id"], "supplier": suppliers[o["supplier_id"]]["name"], "component_id": o["component_id"],
             "moq_kg": num(o["moq_kg"]), "price_per_kg_eur": num(o["price_per_kg_eur"]), "expires_date": o["expires_date"],
             "arrival_date": o["arrival_date"], "storage_capacity_kg": num(o["capacity_kg"]), "on_hand_kg": num(o["on_hand_kg"])}
        offers.append(f)
        yield record(
            f"offer-resin-{o['supplier_id']}",
            f"Resin offer · {f['supplier']} · {f['moq_kg']:,} kg minimum · {eur(f['price_per_kg_eur'])}/kg",
            f"{f['supplier']} ({f['supplier_id']}) offers two-part sealing resin at {eur(f['price_per_kg_eur'])}/kg, minimum order "
            f"{f['moq_kg']:,} kg as one indivisible delivery on {nice_day(f['arrival_date'])}. The resin expires {nice_day(f['expires_date'])}.",
            "supplier_offer", ("resin-offer", f"{o['supplier_id']}-CRESIN"), facts=f, created_at=T_MEMO)
    forecast = [{"week_start": r["week_start"], "consumption_kg": num(r["consumption_kg"])} for r in table("resin_forecast.csv")]
    yield Asset(id="forecast-resin", name="Resin consumption forecast · Oct", kind="table", created_at=T_MEMO, updated_at=T_MEMO,
                content=ctx.file("resin_forecast.csv").read_text(),
                metadata={"object_type": "forecast", "facts": {"weeks": forecast}})
    yield record(
        "view-resin-plan", "Resin · quarter-end offers against storage, shelf life and forecast",
        "Replenishment sheet for resin: the offers, the 600 kg already on hand, the storage limit and the committed consumption forecast.\n\n"
        + md_table(offers, [("supplier", "Supplier"), ("moq_kg", "Min order kg"), ("price_per_kg_eur", "€/kg"), ("arrival_date", "Arrives"),
                            ("expires_date", "Expires"), ("storage_capacity_kg", "Storage kg"), ("on_hand_kg", "On hand kg")])
        + "\n\n**Forecast consumption (kg/week):** " + ", ".join(f"{nice_day(w['week_start'])}: {w['consumption_kg']}" for w in forecast),
        "decision_view", view="resin_plan", created_at=T_MEMO,
        facts={"as_of": T_MEMO, "offers": offers, "forecast": forecast})

    # ── Pump mix on the shared finishing station ─────────────────────────────
    options = []
    for p in table("pump_options.csv"):
        f = {"product_id": p["product_id"], "product": products[p["product_id"]]["name"], "demand_units": num(p["demand_units"]),
             "min_contract_units": num(p["min_contract_units"]), "price_eur": num(p["price_eur"]),
             "material_cost_eur": num(p["material_cost_eur"]), "labor_cost_eur": num(p["labor_cost_eur"]),
             "energy_cost_eur": num(p["energy_cost_eur"]), "bottleneck_hours": num(p["bottleneck_hours"])}
        options.append(f)
        yield record(
            f"option-{p['product_id']}",
            f"{f['product']} ({f['product_id']}) · {eur(f['price_eur'])} each · {f['bottleneck_hours']} finishing hours",
            f"{f['product']} ({f['product_id']}): sells for {eur(f['price_eur'])}; variable costs {eur(f['material_cost_eur'])} material, "
            f"{eur(f['labor_cost_eur'])} labor, {eur(f['energy_cost_eur'])} energy; needs {f['bottleneck_hours']} hours on the shared finishing "
            f"station per pump. Demand {f['demand_units']} pumps this period"
            + (f", of which {f['min_contract_units']} are a binding contract minimum." if f["min_contract_units"] else "."),
            "production_option", ("pump-option", f["product_id"]), facts=f, created_at=T_MEMO)
    cap = table("finishing_capacity.csv")[0]
    cap_f = {"plant_id": cap["plant_id"], "available_hours": num(cap["available_hours"])}
    yield record(
        "capacity-munich-finishing", f"Finishing station Munich · {cap_f['available_hours']} hours available",
        f"The shared finishing station at Nova Munich has {cap_f['available_hours']} hours available this period, net of downtime.",
        "capacity", ("capacity", "MUC-finishing"), facts=cap_f, created_at=T_MEMO)
    yield record(
        "view-finishing-mix", "Pump mix · P100 and P200 on 240 finishing hours",
        "Product-mix sheet for the Munich finishing station.\n\n"
        + md_table(options, [("product", "Pump"), ("demand_units", "Demand"), ("min_contract_units", "Contract min."), ("price_eur", "Price €"),
                             ("bottleneck_hours", "Hours/pump")])
        + f"\n\nAvailable: {cap_f['available_hours']} hours.",
        "decision_view", view="finishing_mix", created_at=T_MEMO, facts={"as_of": T_MEMO, "options": options, "capacity": cap_f})

    yield Asset(id="memo-commercial-terms", name="Sourcing and commercial notes · Q4 · 2 Oct", kind="document",
                content=ctx.file("commercial_terms.md").read_text(), created_at=T_MEMO, updated_at=T_MEMO,
                metadata={"object_type": "memo", "written_at": T_MEMO})

    # ── Four working days later: the process trial ───────────────────────────
    trials = []
    for t in table("process_trials.csv"):
        f = {"trial_id": t["trial_id"], "supplier_id": t["supplier_id"], "process_revision": t["process_revision"],
             "input_kg": num(t["input_kg"]), "usable_kg": num(t["usable_kg"]), "chemistry_result": t["chemistry_result"],
             "completed_at": t["completed_at"]}
        trials.append(f)
        yield record(
            f"trial-{t['trial_id']}", f"Pilot {t['trial_id']} · process {t['process_revision']} · {f['input_kg']:,} kg in, {f['usable_kg']:,} kg usable",
            f"Pilot run {t['trial_id']} with {suppliers[t['supplier_id']]['name']} steel on cutting process {t['process_revision']}: "
            f"{f['input_kg']:,} kg in, {f['usable_kg']:,} kg usable; chemistry check {t['chemistry_result'].lower()}.",
            "pilot_run", ("pilot-run", t["trial_id"]), facts=f, created_at=t["completed_at"])
    rel = table("process_release.csv")[0]
    rel_f = {"supplier_id": rel["supplier_id"], "component_id": rel["component_id"], "process_revision": rel["process_revision"],
             "status": rel["status"], "yield_basis": rel["yield_basis"], "price_valid_until": rel["price_valid_until"]}
    yield record(
        "release-r2", f"Planning release · process {rel_f['process_revision']} · approved for the next order only",
        f"Engineering approves process {rel_f['process_revision']} for planning (basis: pooled pilot mass, {rel_f['yield_basis'].replace('_', ' ').lower()}). "
        f"The quote from {suppliers[rel_f['supplier_id']]['name']} stays valid until {nice_day(rel_f['price_valid_until'])}. No order has been placed.",
        "engineering_release", ("planning-release", f"{rel_f['supplier_id']}-{rel_f['process_revision']}"), facts=rel_f, created_at=T_RELEASE)
    yield Asset(id="memo-process-release", name="Engineering note ENG-202 · revised cutting process R2 · 5 Oct", kind="document",
                content=ctx.file("process_release_note.md").read_text(), created_at=T_RELEASE, updated_at=T_RELEASE,
                metadata={"object_type": "memo", "written_at": T_RELEASE})
    yield record(
        "view-steel-comparison-r2", "Steel feedstock · cost per usable kilogram · updated 5 Oct with process R2",
        "The steel cost sheet, updated with the three pilot runs and the engineering planning release for process R2.\n\n"
        + md_table(quotes, [("supplier", "Supplier"), ("price_per_kg_eur", "€/kg"), ("freight_per_kg_eur", "Freight €/kg"), ("usable_yield", "Old-process yield")])
        + "\n\n" + md_table(trials, [("trial_id", "Pilot"), ("process_revision", "Process"), ("input_kg", "Input kg"), ("usable_kg", "Usable kg")]),
        "decision_view", view="steel_comparison", created_at=T_UPDATE,
        facts={"as_of": T_UPDATE, "quotes": quotes, "release": rel_f, "trials": trials})


def relationships():
    for s in table("steel_quotes.csv"):
        yield flow(upstream=Ref.asset(f"quote-steel-{s['supplier_id']}"), downstream=Ref.asset("view-steel-comparison"), type=FlowType.VIEW)
        yield references(Ref.asset(f"quote-steel-{s['supplier_id']}"), Ref.urn(urn("supplier", s["supplier_id"])))
    for o in table("resin_offers.csv"):
        yield flow(upstream=Ref.asset(f"offer-resin-{o['supplier_id']}"), downstream=Ref.asset("view-resin-plan"), type=FlowType.VIEW)
        yield references(Ref.asset(f"offer-resin-{o['supplier_id']}"), Ref.urn(urn("supplier", o["supplier_id"])))
    yield flow(upstream=Ref.asset("forecast-resin"), downstream=Ref.asset("view-resin-plan"), type=FlowType.VIEW)
    for p in table("pump_options.csv"):
        yield flow(upstream=Ref.asset(f"option-{p['product_id']}"), downstream=Ref.asset("view-finishing-mix"), type=FlowType.VIEW)
        yield references(Ref.asset(f"option-{p['product_id']}"), Ref.urn(urn("product", p["product_id"])))
    yield flow(upstream=Ref.asset("capacity-munich-finishing"), downstream=Ref.asset("view-finishing-mix"), type=FlowType.VIEW)
    yield references(Ref.asset("capacity-munich-finishing"), Ref.urn(urn("plant", "MUC")))
    for t in table("process_trials.csv"):
        yield flow(upstream=Ref.asset(f"trial-{t['trial_id']}"), downstream=Ref.asset("view-steel-comparison-r2"), type=FlowType.VIEW)
    yield flow(upstream=Ref.asset("release-r2"), downstream=Ref.asset("view-steel-comparison-r2"), type=FlowType.VIEW)
    yield flow(upstream=Ref.asset("view-steel-comparison"), downstream=Ref.asset("view-steel-comparison-r2"), type=FlowType.VIEW)
    yield references(Ref.asset("memo-process-release"), Ref.asset("release-r2"))
    yield references(Ref.asset("memo-commercial-terms"), Ref.asset("view-steel-comparison"))
    yield references(Ref.asset("memo-commercial-terms"), Ref.asset("view-resin-plan"))
    yield references(Ref.asset("memo-commercial-terms"), Ref.asset("view-finishing-mix"))
    for v in ("view-steel-comparison", "view-steel-comparison-r2", "view-resin-plan", "view-finishing-mix"):
        yield means(Ref.asset(v), Ref.term("decision-view"))
    for m in ("memo-commercial-terms", "memo-process-release"):
        yield means(Ref.asset(m), Ref.term("plant-memo"))


def test_connection():
    names = {f.name for f in ctx.files}
    need = {"steel_quotes.csv", "resin_offers.csv", "pump_options.csv", "commercial_terms.md"}
    if need - names:
        return {"status": "FAILURE", "message": f"missing files: {sorted(need - names)}"}
    return {"status": "SUCCESS", "message": f"{len(names)} files ready"}
