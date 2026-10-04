"""Quality and traceability checks.

Three questions every quality engineer asks before anyone stops a line or calls a
customer: does the defect follow the material or the machine, is the "crisis" a
change in process or a change in what was built, and which finished goods can we
actually trace back to their material?
"""
import csv
import io

from classifyre import Finding


def pct(x, digits=1):
    return f"{x * 100:.{digits}f}%".replace(".0%", "%") if digits == 1 and abs(x * 100 - round(x * 100)) < 1e-9 else f"{x * 100:.{digits}f}%"


def detect(asset, ctx):
    view = asset.metadata.get("view")
    facts = asset.metadata.get("facts") or {}
    if view == "batch_inspections":
        yield from batch_inspections(asset, facts)
    elif view == "scrap_mix":
        yield from scrap_mix(asset)
    elif view == "finished_lots":
        yield from finished_lots(facts)
    elif view == "genealogy":
        yield from genealogy(asset, facts)


# ── Does the defect follow the batch or the machine? ──────────────────────────
def batch_inspections(asset, f):
    rows = list(csv.DictReader(io.StringIO(asset.text())))
    tally = {}
    for r in rows:
        for key in ((r["batch_id"], None), (r["batch_id"], r["machine_id"])):
            t = tally.setdefault(key, [0, 0])
            t[0] += 1
            t[1] += r["result"] == "FAIL"
    batches = sorted({b for b, m in tally if m is None})
    if len(batches) < 2:
        return
    rate = lambda b, m=None: tally[(b, m)][1] / tally[(b, m)][0]
    suspect = max(batches, key=rate)
    control = min(batches, key=rate)
    machines = sorted({m for b, m in tally if m})
    if rate(suspect) < 3 * rate(control) or any(rate(suspect, m) < 3 * rate(control, m) for m in machines):
        return
    info = {b["batch_id"]: b for b in f["batches"]}
    per_machine = ", ".join(f"{m} {pct(rate(suspect, m))} vs {pct(rate(control, m))}" for m in machines)
    yield Finding(
        label="batch_linked_defects", severity="critical", identity=f"batch-{suspect}",
        value=(f"Batch {suspect} ({info[suspect]['supplier']}) fails {pct(rate(suspect))} of inspections ({tally[(suspect, None)][1]} of {tally[(suspect, None)][0]}) "
               f"against {pct(rate(control))} for batch {control}, and the gap shows on every machine ({per_machine}): the defects follow the material, not the machine."),
        message="An association strong enough to act on — contain and investigate the batch — not a proven root cause: no lab analysis exists yet.",
        fields={"batch": suspect, "supplier": info[suspect]["supplier"], "failure_rate_pct": round(rate(suspect) * 100, 1),
                "control_rate_pct": round(rate(control) * 100, 1)})
    exposed = [s for s in f["shipments"] if s["batch_id"] == suspect]
    shipped = [s for s in exposed if s["state"] == "SHIPPED"]
    wip = sum(s["units"] for s in exposed if s["state"] != "SHIPPED")
    if exposed:
        who = ", ".join(f"{sum(x['units'] for x in shipped if x['customer'] == c)} to {c}" for c in dict.fromkeys(s["customer"] for s in shipped))
        yield Finding(
            label="exposed_shipments", severity="high", identity=f"exposed-{suspect}",
            value=(f"{sum(s['units'] for s in shipped)} pumps built with batch {suspect} are already with customers ({who}); {wip} more are still in production."),
            message="Exposure is not a defect count: these units used suspect material. Contain the work in progress and offer targeted inspection to the shipped cohorts.",
            fields={"units_shipped": sum(s["units"] for s in shipped), "units_in_process": wip,
                    "customers": ", ".join(dict.fromkeys(s["customer"] for s in shipped))})


# ── Did quality get worse, or did we build something harder? ──────────────────
def scrap_mix(asset):
    rows = list(csv.DictReader(io.StringIO(asset.text())))
    n, fail = {}, {}
    for r in rows:
        key = (r["period"], r["product_id"])
        n[key] = n.get(key, 0) + 1
        fail[key] = fail.get(key, 0) + (r["result"] == "FAIL")
    periods = sorted({p for p, _ in n}, key=lambda p: p != "BEFORE")
    products = sorted({q for _, q in n})
    if len(periods) != 2 or len(products) < 2:
        return
    before, after = periods
    overall = lambda p: sum(fail[(p, q)] for q in products if (p, q) in fail) / sum(n[(p, q)] for q in products if (p, q) in n)
    within = lambda p, q: fail.get((p, q), 0) / n[(p, q)] if n.get((p, q)) else 0.0
    standardized = lambda p: sum(within(p, q) for q in products) / len(products)
    share_hard = lambda p: n.get((p, products[-1]), 0) / sum(n.get((p, q), 0) for q in products)
    within_change = max(abs(within(after, q) - within(before, q)) for q in products)
    if overall(after) >= 2 * overall(before) and within_change <= 0.005 and abs(standardized(after) - standardized(before)) <= 0.005:
        detail = ", ".join(f"{q} {pct(within(before, q))} → {pct(within(after, q))}" for q in products)
        yield Finding(
            label="mix_shift_explains_scrap", severity="medium", identity="mix-shift",
            value=(f"Scrap rose from {pct(overall(before))} to {pct(overall(after))}, but within each product nothing changed ({detail}); the share of {products[-1]} in the "
                   f"inspected units went from {share_hard(before) * 100:.0f}% to {share_hard(after) * 100:.0f}%."),
            message=(f"At the same {len(products)}-product mix, both periods score {pct(standardized(before))}. The extra scrap workload is real; a process "
                     f"deterioration is not supported by these results."),
            fields={"overall_before_pct": round(overall(before) * 100, 1), "overall_after_pct": round(overall(after) * 100, 1),
                    "standardized_pct": round(standardized(after) * 100, 1)})


# ── Which lots can we trace? ──────────────────────────────────────────────────
def finished_lots(f):
    suspect = f["quality_case"]["suspect_batch"]
    lots = f["lots"]
    confirmed = [l for l in lots if l["material_batch"] == suspect]
    unknown = [l for l in lots if l["material_batch"] is None]
    for l in unknown:
        yield Finding(
            label="unknown_material_ancestry", severity="high", identity=f"unknown-{l['finished_lot']}",
            value=(f"Lot {l['finished_lot']} ({l['units']} units for {l['customer']}) has no recorded material batch: the scan was lost, so it cannot be "
                   f"called clean or exposed."),
            message="A missing link is unknown, not clean. Do not guess the batch from timestamps.",
            fields={"lot": l["finished_lot"], "units": l["units"], "customer": l["customer"]})
    if confirmed and unknown:
        lo = sum(l["units"] for l in confirmed)
        hi = lo + sum(l["units"] for l in unknown)
        yield Finding(
            label="containment_scope", severity="high", identity=f"scope-{suspect}",
            value=(f"Exposure to batch {suspect} is between {lo} and {hi} units: {lo} confirmed ({', '.join(l['customer'] for l in confirmed)}), "
                   f"up to {hi - lo} more unknown ({', '.join(l['customer'] for l in unknown)})."),
            message=f"{hi} is a prudent containment scope, not a count of defective product. Recovering the production traveler narrows it.",
            fields={"units_confirmed": lo, "units_upper_bound": hi})


# ── What did the recovered paperwork settle? ─────────────────────────────────
def genealogy(asset, f):
    serials = list(csv.DictReader(io.StringIO(asset.text())))
    seen = {s["serial_id"] for s in serials}
    original = f["original_units"]
    exposed = [s for s in serials if s["material_batch"] == f["suspect_batch"]]
    clean = [s for s in serials if s["material_batch"] != f["suspect_batch"]]
    missing = original - len(seen)
    base = sum(l["units"] for l in f["other_lots"] if l["material_batch"] == f["suspect_batch"])
    if missing > 0:
        yield Finding(
            label="unknown_material_ancestry", severity="high", identity=f"unknown-{f['lot']}-partial",
            value=f"{missing} of lot {f['lot']}'s {original} units are still without ancestry after the traveler was recovered.",
            fields={"lot": f["lot"], "units": missing})
        return
    yield Finding(
        label="ancestry_recovered", severity="info", identity=f"recovered-{f['lot']}",
        value=(f"The recovered traveler assigns all {original} units of lot {f['lot']}: {len(exposed)} used batch {f['suspect_batch']} and {len(clean)} used batch "
               f"{' and '.join(sorted({s['material_batch'] for s in clean}))}. "
               f"Confirmed exposure is now exactly {base + len(exposed)} units; {len(clean)} units can leave precautionary containment after quality review."),
        message="Narrower exposure is not a release: no release has been approved and no customer has been informed.",
        fields={"lot": f["lot"], "units_confirmed": base + len(exposed), "units_cleared": len(clean)})
