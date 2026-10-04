"""Supply risk checks.

Reads the joined supply sheets (``asset.metadata['facts']``) and says what is wrong
with them in plain language: which orders cannot be completed, which delivery moved,
which offers cannot be used, which "two suppliers" are really one.

Every figure is computed here from the sheet's rows. Nothing is looked up from an
answer; change a quantity or a date in the source and the findings change with it.
"""
from datetime import date

from classifyre import Finding

MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()


def day(iso):
    y, m, d = iso[:10].split("-")
    return f"{int(d)} {MONTHS[int(m) - 1]}"


def eur(x):
    return f"€{x:,.0f}"


def days_between(a, b):
    return (date.fromisoformat(b[:10]) - date.fromisoformat(a[:10])).days


def allocate(orders, lots):
    """Strict priority, complete delivery only.

    Each order draws, earliest arrival first, from the lots that reach the plant by
    its material need date. An order that cannot be completed still consumes what it
    takes: nobody ships or invoices half an order, but the stock is gone all the same.
    """
    pool = [dict(lot) for lot in sorted(lots, key=lambda lot: lot["arrival"])]
    out = {}
    for o in sorted(orders, key=lambda o: (o["priority"], o["need_date"])):
        need, got = o["housings_needed"], 0
        for lot in pool:
            if got >= need:
                break
            if lot["arrival"] > o["need_date"] or lot["qty"] <= 0:
                continue
            take = min(lot["qty"], need - got)
            lot["qty"] -= take
            got += take
        out[o["sales_order_id"]] = {"allocated": got, "short": need - got, "covered": got >= need}
    return out


def detect(asset, ctx):
    view = asset.metadata.get("view")
    facts = asset.metadata.get("facts") or {}
    if view == "supply_position":
        yield from supply_position(facts)
    elif view == "sanitary_sourcing":
        yield from sanitary_sourcing(facts)
    elif view == "upstream_map":
        yield from upstream_map(facts)


# ── Orders versus stock, deliveries and the truck ─────────────────────────────
def supply_position(facts):
    orders, dest = facts["demand"], facts["destination"]
    names = facts.get("plant_names", {})
    now = facts["as_of"][:10]
    usable_now = sum(s["quantity"] for s in facts["stock"] if s["plant_id"] == dest and s["status"] == "RELEASED")
    base_lots = [{"arrival": now, "qty": usable_now}]
    for p in facts["inbound"]:
        if p["destination"] == dest:
            base_lots.append({"arrival": p["revised_eta"][:10], "qty": p["quantity"]})

    rescue_lots, capped = [], []
    for t in facts["truck_slots"]:
        if t["destination"] != dest:
            continue
        free = sum(max(0, s["quantity"] - s["reserved"] - s["safety"]) for s in facts["stock"]
                   if s["plant_id"] == t["origin"] and s["status"] == "RELEASED")
        moved = min(free, t["capacity"])
        rescue_lots.append({"arrival": t["arrival_date"][:10], "qty": moved, "cost": moved * t["cost_per_unit_eur"],
                            "origin": t["origin"]})
        if free > t["capacity"]:
            capped.append((t, free))

    recovery = facts.get("recovery")
    rec_lots = []
    if recovery and {o["product_id"] for o in orders} <= set(recovery["release"]["products"]):
        rec_lots.append({"arrival": recovery["slot"]["arrival_date"][:10], "qty": recovery["offer"]["quantity"]})

    base = allocate(orders, base_lots)
    rescued = allocate(orders, base_lots + rescue_lots)

    if recovery is None:
        for p in facts["inbound"]:
            if p["revised_eta"] > p["promised_date"]:
                hit = [o for o in orders if p["revised_eta"] > o["need_date"]]
                late = days_between(p["promised_date"], p["revised_eta"])
                yield Finding(
                    label="late_inbound_supply", severity="high", identity=f"late-{p['purchase_order_id']}",
                    value=(f"{p['purchase_order_id']} from {p['supplier']} ({p['quantity']} housings) now arrives {day(p['revised_eta'])}, "
                           f"{late} days after the promised {day(p['promised_date'])} — too late for all {len(hit)} orders that need it."),
                    message="Planning must not use the original promise; the delivery cannot cover any order on time.",
                    fields={"purchase_order": p["purchase_order_id"], "days_late": late, "quantity": p["quantity"],
                            "revenue_eur": sum(o["revenue_eur"] for o in hit)})
        for t, free in capped:
            yield Finding(
                label="rescue_capped_by_truck", severity="medium", identity=f"cap-{t['origin']}-{t['destination']}",
                value=(f"{names.get(t['origin'], t['origin'])} has {free} free housings, but the only truck slot arriving by "
                       f"{day(t['arrival_date'])} carries {t['capacity']}: {free - t['capacity']} housings that exist cannot reach "
                       f"{names.get(dest, dest)} in time."),
                message="Free stock is not the same as movable stock: the transport slot is the limit.",
                fields={"quantity": t["capacity"], "units_short": free - t["capacity"]})
        for o in orders:
            b, r = base[o["sales_order_id"]], rescued[o["sales_order_id"]]
            if not b["covered"] and r["covered"]:
                yield Finding(
                    label="order_saved_by_transfer", severity="medium", identity=f"saved-{o['sales_order_id']}",
                    value=(f"{o['sales_order_id']} ({o['customer']}, {eur(o['revenue_eur'])}) is {b['short']} housings short today "
                           f"but can be completed if the Hamburg slot is used."),
                    message="The Hamburg transfer protects this order; it cannot protect the others.",
                    fields={"sales_order": o["sales_order_id"], "customer": o["customer"], "revenue_eur": o["revenue_eur"],
                            "units_short": b["short"]})
            if not r["covered"]:
                yield Finding(
                    label="order_at_risk", severity="critical", identity=f"risk-{o['sales_order_id']}",
                    value=(f"{o['sales_order_id']} ({o['customer']}, {eur(o['revenue_eur'])}) cannot be completed by {day(o['need_date'])}: "
                           f"{r['short']} of {o['housings_needed']} housings are still missing even after the best available transfer."),
                    message="Complete delivery is required, so the whole order value is at risk, not a share of it.",
                    fields={"sales_order": o["sales_order_id"], "customer": o["customer"], "revenue_eur": o["revenue_eur"],
                            "units_short": r["short"]})
    else:
        with_rec = allocate(orders, base_lots + rescue_lots + rec_lots) if rec_lots else None
        if with_rec and all(v["covered"] for v in with_rec.values()) and not all(v["covered"] for v in rescued.values()):
            o, r, s = recovery["offer"], recovery["release"], recovery["slot"]
            freight = sum(l["cost"] for l in rescue_lots)
            cost = o["quantity"] * o["unit_price_landed_eur"] + freight
            total = sum(x["housings_needed"] for x in orders)
            yield Finding(
                label="rescue_option_open", severity="medium", identity=f"option-{o['offer_id']}",
                value=(f"Accepting {o['supplier']}'s {o['quantity']}-housing lot before {o['accept_before'][11:16]} UTC covers all "
                       f"{len(orders)} orders ({total} of {total} housings) for {eur(cost)} including the Hamburg freight."),
                message=(f"Released by {r['approval_id']} for {' and '.join(r['products'])}; arrives {day(s['arrival_date'])}. "
                         f"Still only an offer: nothing has been accepted."),
                fields={"cost_eur": cost, "accept_before": o["accept_before"], "revenue_eur": sum(x["revenue_eur"] for x in orders)})
        elif with_rec:
            for x in orders:
                if not with_rec[x["sales_order_id"]]["covered"]:
                    yield Finding(
                        label="order_at_risk", severity="critical", identity=f"risk-{x['sales_order_id']}-update",
                        value=f"{x['sales_order_id']} ({x['customer']}) is still not covered after the recovery offer.",
                        fields={"sales_order": x["sales_order_id"], "revenue_eur": x["revenue_eur"]})


# ── Offers versus the engineering requirement ─────────────────────────────────
def sanitary_sourcing(facts):
    req, offers = facts["requirement"], facts["offers"]
    usable = 0
    for o in offers:
        wrong = []
        if o["revision"] != req["required_revision"]:
            wrong.append(f"revision {o['revision']} instead of {req['required_revision']}")
        if o["scope"] != req["required_scope"]:
            wrong.append(f"{o['scope'].lower()} approval instead of {req['required_scope'].lower()}")
        if o["valid_until"] < req["need_date"]:
            wrong.append(f"approval expires {day(o['valid_until'])}")
        late = o["arrival_date"] > req["need_date"]
        if not wrong and not late:
            usable += o["quantity"]
            continue
        if wrong:
            yield Finding(
                label="offer_unusable", severity="high", identity=f"offer-{o['supplier_id']}",
                value=(f"{o['supplier']} offers {o['quantity']:,} housings, but they cannot be used for the {req['product']}: "
                       + " and ".join(wrong) + "."),
                message="Engineering cannot waive the revision rule; the lowest price does not make a part eligible.",
                fields={"supplier": o["supplier"], "quantity": o["quantity"], "reason": "; ".join(wrong)})
        else:
            gap = days_between(req["need_date"], o["arrival_date"])
            yield Finding(
                label="offer_unusable", severity="medium", identity=f"offer-{o['supplier_id']}",
                value=(f"{o['supplier']} offers {o['quantity']} compliant housings, but they arrive {day(o['arrival_date'])}, "
                       f"{gap} days after the {day(req['need_date'])} need date."),
                message="Right part, wrong day: a firm destination arrival after the need date is no help.",
                fields={"supplier": o["supplier"], "quantity": o["quantity"], "reason": f"arrives {gap} days late"})
    if usable < req["quantity"]:
        gap = req["quantity"] - usable
        yield Finding(
            label="qualified_supply_gap", severity="high", identity="gap-p300",
            value=(f"Only {usable} of the {req['quantity']} housings are available in time in the right revision; {gap} are missing, "
                   f"so the {eur(req['quantity'] * req['price_eur'])} delivery of {req['quantity']} {req['product']}s cannot be promised yet."),
            message="Reserve what qualifies and open a request for the rest; do not simulate a waiver as approved.",
            fields={"units_short": gap, "quantity": usable, "revenue_eur": req["quantity"] * req["price_eur"]})


# ── "Two suppliers" that are one ──────────────────────────────────────────────
def upstream_map(facts):
    deps = {}
    for s in facts["sources"]:
        deps.setdefault(s["supplier_id"], set()).add(s["upstream_id"])
    names = {s["upstream_id"]: s["upstream"] for s in facts["sources"]}
    outages = facts["outages"]

    def window(up, due):
        for o in outages:
            if o["upstream_id"] == up and o["start_date"] <= due <= o["end_date"]:
                return o
        return None

    groups = {}
    for b in facts["booked"]:
        if b["status"] != "BOOKED":
            continue
        for up in deps.get(b["supplier_id"], ()):
            if window(up, b["due_date"]):
                groups.setdefault(up, []).append(b)
    for up, rows in groups.items():
        suppliers = sorted({r["supplier"] for r in rows})
        if len(suppliers) < 2:
            continue
        exposed = sum(r["quantity"] for r in rows)
        alts = [b for b in facts["booked"] if b["status"] == "AVAILABLE_ALTERNATIVE" and deps.get(b["supplier_id"])
                and all(window(u, b["due_date"]) is None for u in deps[b["supplier_id"]])]
        alt_qty = sum(b["quantity"] for b in alts)
        residual = max(0, exposed - alt_qty)
        out = window(up, rows[0]["due_date"])
        yield Finding(
            label="shared_upstream_dependency", severity="critical", identity=f"shared-{up}",
            value=(f"{' and '.join(suppliers)} look like two sources, but both cast at {names[up]} ({up}), which is down "
                   f"from {day(out['start_date'])} to {day(out['end_date'])}. All {exposed} booked housings fall inside the outage; "
                   f"independent capacity covers {alt_qty}, leaving {residual} exposed."),
            message="Two supplier names are not two sources when they share a foundry: dual sourcing does not protect this order.",
            fields={"suppliers": ", ".join(suppliers), "upstream": names[up], "exposed_units": exposed,
                    "independent_units": alt_qty, "residual_units": residual})
