"""Cost and terms checks.

"Cheaper on paper" is the oldest trap in purchasing. These checks take a quote, an
offer or a product mix and work out what it really costs once the physical facts
are in: usable yield, storage, shelf life, scarce machine hours, contract minimums.
"""
from classifyre import Finding

MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()


def day(iso):
    y, m, d = iso[:10].split("-")
    return f"{int(d)} {MONTHS[int(m) - 1]}"


def eur(x, cents=False):
    return f"€{x:,.2f}" if cents else f"€{x:,.0f}"


def detect(asset, ctx):
    view = asset.metadata.get("view")
    facts = asset.metadata.get("facts") or {}
    if view == "steel_comparison":
        yield from steel_comparison(facts)
    elif view == "resin_plan":
        yield from resin_plan(facts)
    elif view == "finishing_mix":
        yield from finishing_mix(facts)


def steel_comparison(facts):
    quotes = facts["quotes"]
    if len(quotes) < 2:
        return

    def unit(q, yld=None):
        return (q["price_per_kg_eur"] + q["freight_per_kg_eur"]) / (yld or q["usable_yield"])

    need = quotes[0]["net_requirement_kg"]
    cheapest_headline = min(quotes, key=lambda q: q["price_per_kg_eur"])
    cheapest_usable = min(quotes, key=lambda q: unit(q))
    release = facts.get("release")
    trials = [t for t in facts.get("trials", []) if release and t["process_revision"] == release["process_revision"]
              and t["supplier_id"] == release["supplier_id"] and t["chemistry_result"] == "PASS"]

    if not release:
        if cheapest_headline["supplier_id"] != cheapest_usable["supplier_id"]:
            a, b = cheapest_headline, cheapest_usable
            total_a, total_b = need * unit(a), need * unit(b)
            breakeven = (a["price_per_kg_eur"] + a["freight_per_kg_eur"]) / unit(b)
            discount = 1 - a["price_per_kg_eur"] / b["price_per_kg_eur"]
            yield Finding(
                label="discount_erased_by_yield", severity="high", identity=f"yield-{a['supplier_id']}-{b['supplier_id']}",
                value=(f"{a['supplier']} quotes {discount:.0%} less per kg than {b['supplier']}, but at {a['usable_yield']:.0%} usable yield "
                       f"{need:,} usable kg cost {eur(total_a)} against {eur(total_b)}: {eur(total_a - total_b)} more, not less."),
                message=(f"{a['supplier']} would need about {breakeven:.1%} usable yield to break even; prices are per purchased kg, "
                         f"the requirement is in usable kg."),
                fields={"supplier": a["supplier"], "cost_eur": total_a, "extra_cost_eur": total_a - total_b, "yield_pct": a["usable_yield"] * 100,
                        "breakeven_yield_pct": round(breakeven * 100, 2)})
    elif trials:
        pooled = sum(t["usable_kg"] for t in trials) / sum(t["input_kg"] for t in trials)
        alt = next(q for q in quotes if q["supplier_id"] == release["supplier_id"])
        base = min((q for q in quotes if q["supplier_id"] != alt["supplier_id"]), key=lambda q: unit(q))
        total_alt, total_base = need * unit(alt, pooled), need * unit(base)
        if total_alt < total_base:
            yield Finding(
                label="discount_survives_new_process", severity="medium", identity=f"r2-{alt['supplier_id']}",
                value=(f"With the approved revised process {release['process_revision']}, the pooled pilot yield for {alt['supplier']} is {pooled:.1%}: "
                       f"{need:,} usable kg would cost {eur(total_alt)}, {eur(total_base - total_alt)} less than {base['supplier']}."),
                message="A modelled saving from three pilot runs for the next order only. It is not a realised saving and not a guaranteed yield.",
                fields={"supplier": alt["supplier"], "cost_eur": total_alt, "extra_cost_eur": total_alt - total_base,
                        "yield_pct": round(pooled * 100, 1)})


def resin_plan(facts):
    offers, weeks = facts["offers"], facts["forecast"]
    for o in offers:
        used = sum(w["consumption_kg"] for w in weeks if w["week_start"] <= o["expires_date"])
        on_hand = o["on_hand_kg"]
        overflow = max(0, on_hand + o["moq_kg"] - o["storage_capacity_kg"])
        unused = max(0, on_hand + o["moq_kg"] - used)
        cash = o["moq_kg"] * o["price_per_kg_eur"]
        need = max(0, used - on_hand)
        if overflow > 0:
            fits = [x for x in offers if x is not o and x["on_hand_kg"] + x["moq_kg"] <= x["storage_capacity_kg"]
                    and x["on_hand_kg"] + x["moq_kg"] >= used]
            alt = min(fits, key=lambda x: x["moq_kg"] * x["price_per_kg_eur"]) if fits else None
            tail = (f" The {alt['supplier']} offer of {alt['moq_kg']:,} kg fits, leaves nothing over and commits "
                    f"{eur(alt['moq_kg'] * alt['price_per_kg_eur'])}.") if alt else ""
            yield Finding(
                label="offer_exceeds_storage", severity="high", identity=f"storage-{o['supplier_id']}",
                value=(f"The {o['supplier']} minimum order of {o['moq_kg']:,} kg arrives into {o['storage_capacity_kg']:,} kg of storage that already holds "
                       f"{on_hand:,} kg: {overflow:,} kg has nowhere to go, and {unused:,} kg would still be unused when the resin expires on "
                       f"{day(o['expires_date'])}."),
                message=(f"Nova needs {need:,} kg more; this offer commits {eur(cash)} for it and cannot be called off in instalments.{tail}"),
                fields={"supplier": o["supplier"], "overflow_kg": overflow, "unused_kg": unused, "cost_eur": cash})


def finishing_mix(facts):
    opts, hours = facts["options"], facts["capacity"]["available_hours"]
    if len(opts) < 2:
        return
    opts = [dict(o, contribution=o["price_eur"] - o["material_cost_eur"] - o["labor_cost_eur"] - o["energy_cost_eur"]) for o in opts]
    for o in opts:
        o["per_hour"] = o["contribution"] / o["bottleneck_hours"]
    a, b = opts[0], opts[1]

    def best(honour_minimums):
        top = (-1, 0, 0)
        for x in range(0, a["demand_units"] + 1):
            for y in range(b["min_contract_units"] if honour_minimums else 0, b["demand_units"] + 1):
                if x < a["min_contract_units"] and honour_minimums:
                    continue
                if x * a["bottleneck_hours"] + y * b["bottleneck_hours"] > hours:
                    continue
                value = x * a["contribution"] + y * b["contribution"]
                if value > top[0]:
                    top = (value, x, y)
        return top

    feasible, free = best(True), best(False)
    by_unit = max(opts, key=lambda o: o["contribution"])
    by_hour = max(opts, key=lambda o: o["per_hour"])
    if by_unit["product_id"] != by_hour["product_id"]:
        yield Finding(
            label="margin_ranking_reverses", severity="medium", identity="margin-vs-hour",
            value=(f"{by_unit['product']} earns more per pump ({eur(by_unit['contribution'])} vs {eur(by_hour['contribution'])}) but "
                   f"{by_hour['product']} earns more per finishing hour ({eur(by_hour['per_hour'])} vs {eur(by_unit['per_hour'])})."),
            message=f"When the finishing station is the bottleneck, the margin per pump is the wrong ranking: rank by margin per scarce hour.",
            fields={"hourly_margin_eur": by_hour["per_hour"]})
    if feasible[0] != free[0]:
        margin_first = by_unit
        mf_units = min(margin_first["demand_units"], hours // margin_first["bottleneck_hours"])
        mf_value = mf_units * margin_first["contribution"]
        yield Finding(
            label="contract_minimum_binds", severity="medium", identity="contract-minimum",
            value=(f"Without the contract minimum the best mix would be {free[1]} {a['product_id']} + {free[2]} {b['product_id']} ({eur(free[0])}); "
                   f"honouring the {b['min_contract_units']}-pump {b['product_id']} minimum the best feasible mix is {feasible[1]} + {feasible[2]} "
                   f"({eur(feasible[0])})."),
            message=(f"Building only {margin_first['product_id']} for margin would give {eur(mf_value)} and break the contract; the minimum is a hard commitment."),
            fields={"best_plan_eur": feasible[0], "units_a": feasible[1], "units_b": feasible[2], "unconstrained_eur": free[0]})
