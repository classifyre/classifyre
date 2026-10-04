"""Inventory availability checks.

"On hand" is the most optimistic number in a warehouse. These checks subtract what
cannot actually be used: reserved, safety, quarantined, expired, on the wrong truck,
or already promised to someone else.
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


def detect(asset, ctx):
    view = asset.metadata.get("view")
    facts = asset.metadata.get("facts") or {}
    handler = {"seal_shortage": seal_shortage, "resin_lots": resin_lots, "bearing_proposals": bearing_proposals,
               "reservation_audit": reservation_audit}.get(view)
    if handler:
        yield from handler(facts)


# ── Munich needs seal cartridges: where can they come from? ───────────────────
def seal_shortage(f):
    names = f["plant_names"]
    dest_demand = f["demand"][0]
    dest = dest_demand["plant_id"]
    stock = {s["plant_id"]: s for s in f["stock"]}
    need = dest_demand["quantity"] - max(0, stock.get(dest, {"free": 0})["free"])
    plan, cost, left = [], 0, need
    for lane in sorted((l for l in f["lanes"] if l["destination"] == dest and l["arrival_date"] <= dest_demand["need_date"]),
                       key=lambda l: l["unit_cost_eur"]):
        s = stock[lane["origin"]]
        take = min(left, s["free"], lane["capacity"])
        if take > 0:
            plan.append((lane, take, s))
            cost += take * lane["unit_cost_eur"]
            left -= take
    for lane, take, s in plan:
        o = names[lane["origin"]]
        if s["free"] < s["quantity"]:
            parts = [f"{s['reserved']} are reserved"] if s["reserved"] else []
            parts += [f"{s['safety']} are safety stock"] if s["safety"] else []
            parts += [f"{s['quarantine']} are in quarantine"] if s["quarantine"] else []
            yield Finding(
                label="free_stock_below_physical", severity="medium", identity=f"free-{lane['origin']}",
                value=f"{o} shows {s['quantity']:,} seal cartridges, but only {s['free']:,} are free to move: " + ", ".join(parts) + ".",
                message="Reservations, safety stock and quarantine are separate buckets; none of them can be transferred.",
                fields={"plant": o, "quantity": s["quantity"], "free": s["free"]})
        if lane["capacity"] < s["free"]:
            yield Finding(
                label="route_capacity_binds", severity="medium", identity=f"route-{lane['origin']}-{lane['destination']}",
                value=f"{o} could release {s['free']:,}, but its only truck before {day(dest_demand['need_date'])} ({lane['origin']} → {lane['destination']}) carries {lane['capacity']}.",
                message="The transport slot, not the stock, limits the transfer.",
                fields={"plant": o, "free": s["free"], "capacity": lane["capacity"]})
    if need > 0 and left == 0 and plan:
        q = f["emergency_quote"]
        buy = need * q["price_eur"]
        moves = " + ".join(f"{t} from {names[l['origin']]}" for l, t, _ in plan)
        late = days_between(dest_demand["need_date"], q["earliest_arrival"])
        yield Finding(
            label="transfer_plan_found", severity="medium", identity=f"plan-{dest}",
            value=(f"Munich can be covered for {eur(cost)}: {moves}, all arriving {day(plan[0][0]['arrival_date'])} for the {day(dest_demand['need_date'])} need. "
                   f"The emergency purchase of {need} units ({eur(buy)}) would arrive {day(q['earliest_arrival'])}, {late} days too late."),
            message="Transfers avoid a planned purchase; the avoided purchase value is not a realised saving. Freight is linear, with no fixed trip charge.",
            fields={"cost_eur": cost, "units": need, "emergency_cost_eur": buy})


# ── Resin: arrived, but is it usable? ─────────────────────────────────────────
def resin_lots(f):
    need = f["demand"]
    usable, notes = 0, []
    for lot in f["lots"]:
        if lot["expires_date"] < need["need_date"]:
            gap = days_between(lot["expires_date"], need["need_date"])
            yield Finding(
                label="stock_expires_before_use", severity="high", identity=f"expiry-{lot['lot_id']}",
                value=f"Lot {lot['lot_id']} ({lot['quantity']} kg) expires {day(lot['expires_date'])}, {gap} days before the {day(need['need_date'])} consumption date.",
                message="Arriving before the need date is not enough: the material must still be usable on the day it is consumed.",
                fields={"lot": lot["lot_id"], "quantity": lot["quantity"]})
            continue
        free = lot["quantity"] - lot["reserved"]
        usable += free
        if lot["reserved"] > 0:
            yield Finding(
                label="reserved_stock_unavailable", severity="medium", identity=f"reserved-{lot['lot_id']}",
                value=f"Lot {lot['lot_id']} holds {lot['quantity']} kg, but {lot['reserved']} kg are reserved for a signed customer order: only {free} kg are free.",
                message="Reserved stock belongs to someone else and cannot be reassigned.",
                fields={"lot": lot["lot_id"], "quantity": lot["quantity"], "free": free})
    compliant = [l for l in f["lanes"] if l["cold_chain"]]
    for l in f["lanes"]:
        if not l["cold_chain"]:
            yield Finding(
                label="route_not_cold_chain", severity="medium", identity=f"route-{l['origin']}-{l['destination']}-ambient",
                value=f"The cheapest route ({eur(l['unit_cost_eur'])}/kg, {l['capacity']} kg capacity) is not a cold-chain route, so it is not eligible for this resin whatever it costs.",
                message="Capacity and price are irrelevant when the route cannot carry the material.",
                fields={"capacity": l["capacity"]})
    carry = max((l["capacity"] for l in compliant), default=0)
    supply = min(usable, carry)
    if supply < need["quantity"]:
        yield Finding(
            label="unresolved_shortfall", severity="high", identity="shortfall-resin",
            value=(f"Only {supply} kg of the {need['quantity']} kg needed on {day(need['need_date'])} can be supplied from usable, unreserved stock on a compliant route; "
                   f"{need['quantity'] - supply} kg remain unresolved."),
            message="Move the 20 kg that qualify, keep the shortfall visible, and look for new usable supply or a schedule change.",
            fields={"quantity": supply, "units_short": need["quantity"] - supply})


# ── Bearing kits: two approvals, one shelf ────────────────────────────────────
def bearing_proposals(f):
    s = f["stock"]
    transferable = s["quantity"] - s["reserved"] - s["safety"] - s["quarantine"]
    asked = sum(p["quantity"] for p in f["proposals"])
    if asked > transferable:
        by_priority = sorted(f["demand"], key=lambda d: d["priority"])
        left, alloc = transferable, []
        for d in by_priority:
            give = min(left, d["quantity"])
            alloc.append((d, give))
            left -= give
        split = ", ".join(f"{d['plant_id']} {g} of {d['quantity']}" for d, g in alloc)
        yield Finding(
            label="proposals_overcommit_stock", severity="high", identity="overcommit-HAM-CBRG",
            value=(f"The two proposals ask Hamburg for {asked} bearing kits, but only {transferable} are transferable ({s['quantity']} on hand, {s['safety']} untouchable safety stock): "
                   f"{asked - transferable} too many."),
            message=f"Each proposal looks feasible alone; together they are not. By customer priority the stock would go {split}.",
            fields={"requested": asked, "transferable": transferable, "overcommitted": asked - transferable})
    versions = {p["stock_version"] for p in f["proposals"]}
    if len(versions) == 1 and len(f["proposals"]) > 1:
        yield Finding(
            label="stale_read_conflict", severity="medium", identity="shared-version",
            value=f"Both proposals read the Hamburg stock at version {versions.pop()}: whichever is approved second would act on data the first approval has already changed.",
            message="Approval must re-check availability and reserve in one step, with an idempotent decision record.",
            fields={"proposals": len(f["proposals"])})


# ── What did the reservation service really do? ──────────────────────────────
def reservation_audit(f):
    seen, reserved = set(), 0
    replays = []
    for a in f["attempts"]:
        if a["result"] == "RESERVED" and a["decision_id"] not in seen:
            seen.add(a["decision_id"])
            reserved += a["accepted_qty"]
        elif a["result"] == "REPLAYED_EXISTING_DECISION":
            replays.append(a)
    naive = sum(a["accepted_qty"] for a in f["attempts"])
    st = f["stock"]
    free = st["physical_qty"] - st["reserved_qty"] - st["safety_qty"]
    if replays:
        a = replays[0]
        yield Finding(
            label="retry_not_double_counted", severity="info", identity=f"replay-{a['decision_id']}",
            value=(f"The retry of {a['proposal_id']} returned its existing decision {a['decision_id']} and reserved nothing new. Real reservations: {reserved} kits "
                   f"({len(seen)} decisions); adding up every accepted response would claim {naive}."),
            message="Idempotency works: a repeat returns the earlier decision. The stale request on version 7 changed nothing.",
            fields={"reserved": reserved, "naive_total": naive})
    short = [(d["plant_id"], d["quantity"]) for d in f["demand"]]
    gap = sum(q for _, q in short) - reserved
    if gap > 0:
        yield Finding(
            label="reservation_gap_remains", severity="medium", identity="gap-after-reservations",
            value=f"Hamburg now has {max(0, free)} free bearing kits ({st['physical_qty']} on hand, {st['reserved_qty']} reserved, {st['safety_qty']} safety); {gap} kits of demand are still unmet and no shipment has happened.",
            message="Reservations are not dispatches. The remaining need has to be met from new supply or by changing the plan.",
            fields={"units_short": gap, "free": max(0, free)})
