"""Machine health checks.

A vibration number only means something against the machine it came from. These
checks compare every machine with its own history in the same operating mode, test
whether a sensor message can be trusted before anyone acts on it, and weigh two
possible maintenance jobs by what they protect.
"""
import csv
import io
from datetime import datetime

from classifyre import Finding

MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()
BASELINE_HOURS = 14 * 24
RECENT_HOURS = 7 * 24


def day(iso):
    y, m, d = iso[:10].split("-")
    return f"{int(d)} {MONTHS[int(m) - 1]}"


def eur(x):
    return f"€{x:,.0f}"


def mean(xs):
    return sum(xs) / len(xs) if xs else 0.0


def parse_ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def detect(asset, ctx):
    view = asset.metadata.get("view")
    facts = asset.metadata.get("facts") or {}
    if view == "machine_health":
        yield from machine_health(asset, facts)
    elif view == "sensor_feed":
        yield from sensor_feed(facts)
    elif view == "maintenance_slot":
        yield from maintenance_slot(facts)
    elif view == "service_check":
        yield from service_check(asset, facts)


# ── Is this machine drifting from its own normal? ─────────────────────────────
def machine_health(asset, f):
    rows = list(csv.DictReader(io.StringIO(asset.text())))
    by_mode = {}
    for r in rows:
        by_mode.setdefault(r["operating_mode"], []).append((float(r["vibration_mm_s"]), float(r["temperature_c"])))
    for mode, series in by_mode.items():
        if len(series) < BASELINE_HOURS + RECENT_HOURS:
            continue
        base_v, base_t = mean([v for v, _ in series[:BASELINE_HOURS]]), mean([t for _, t in series[:BASELINE_HOURS]])
        now_v, now_t = mean([v for v, _ in series[-RECENT_HOURS:]]), mean([t for _, t in series[-RECENT_HOURS:]])
        label = mode.replace("_", "-").lower()
        if now_v >= 1.5 * base_v and now_t - base_t >= 5:
            history = f["maintenance"]
            bearings = [h for h in history if h["failure_mode"] == "BEARING"]
            exposed = sum(o["revenue_eur"] for o in f["open_orders"])
            extra = ""
            if bearings:
                extra += f" It has had {len(bearings)} bearing repairs ({', '.join(day(h['performed_date']) for h in bearings)})."
            if exposed:
                extra += f" {eur(exposed)} of open orders are assigned to it in the next 48 hours."
            yield Finding(
                label="drift_from_own_baseline", severity="high", identity=f"drift-{f['machine_id']}-{mode}",
                value=(f"{f['machine_id']} ({f['plant'].replace('Nova ', '')}) is drifting from its own normal: in {label} mode vibration rose from {base_v:.1f} to {now_v:.1f} mm/s "
                       f"and temperature from {base_t:.0f} to {now_t:.0f} °C over the last 7 days."),
                message=("A bearing problem is a hypothesis, not a diagnosis: inspect it, with the trend and repair history attached." + extra),
                fields={"machine": f["machine_id"], "vibration_before": round(base_v, 2), "vibration_now": round(now_v, 2),
                        "temperature_before": round(base_t, 1), "temperature_now": round(now_t, 1),
                        "revenue_eur": exposed})
        elif now_v > f["alert_line_mm_s"] and abs(now_v - base_v) <= 0.1 * base_v:
            yield Finding(
                label="loud_but_steady", severity="info", identity=f"steady-{f['machine_id']}-{mode}",
                value=(f"{f['machine_id']} runs at {now_v:.1f} mm/s, above the plant-wide {f['alert_line_mm_s']:.0f} mm/s alert line, but it has held that level "
                       f"for 90 days in {label} mode — the approved recipe — so it is not deteriorating."),
                message="A global threshold would flag this machine; its own history says it is normal. Keep it as the control.",
                fields={"machine": f["machine_id"], "vibration_now": round(now_v, 2)})


# ── Can this sensor message be trusted? ───────────────────────────────────────
def sensor_feed(f):
    reg = sorted(f["registry"], key=lambda r: r["effective_from"])
    as_of = parse_ts(f["as_of"])

    def config(sensor, at):
        out = None
        for r in reg:
            if r["sensor_id"] == sensor and r["effective_from"] <= at:
                out = r
        return out

    seen = {}
    for p in f["packets"]:
        seen.setdefault(p["event_id"], []).append(p)
    for event, deliveries in seen.items():
        if len(deliveries) > 1:
            first = min(d["received_at"] for d in deliveries)
            yield Finding(
                label="duplicate_delivery", severity="low", identity=f"dup-{event}",
                value=(f"Event {event} was delivered {len(deliveries)} times (received {', '.join(d['received_at'][11:16] for d in sorted(deliveries, key=lambda d: d['received_at']))} UTC) — "
                       f"one measurement, not {len(deliveries)}."),
                message="Count events by event id, never by delivery.", fields={"machine": deliveries[0]["machine_id"]})
        p = deliveries[0]
        c = config(p["sensor_id"], p["event_at"])
        if not c:
            continue
        value_c = p["value"]
        if c["actual_unit"] == "F":
            value_c = (p["value"] - 32) * 5 / 9
        if c["actual_unit"] != p["reported_unit"]:
            yield Finding(
                label="sensor_unit_mismatch", severity="high", identity=f"unit-{p['sensor_id']}-{event}",
                value=(f"{p['sensor_id']} on {p['machine_id']} is configured in °{c['actual_unit']} since {day(c['effective_from'])}, but the adapter still "
                       f"labels readings °{p['reported_unit']}: the reported {p['value']:g} is {value_c:.1f} °C, not {p['value']:g} °C."),
                message="Read units from the effective sensor configuration, not from the message label.",
                fields={"machine": p["machine_id"], "reported_value": p["value"], "value_c": round(value_c, 2)})
        age_min = (as_of - parse_ts(p["event_at"])).total_seconds() / 60
        if age_min > c["max_age_minutes"]:
            yield Finding(
                label="stale_reading", severity="medium", identity=f"stale-{p['sensor_id']}-{event}",
                value=(f"The latest {p['sensor_id']} reading on {p['machine_id']} was measured {day(p['event_at'])} {p['event_at'][11:16]} UTC — "
                       f"{age_min / 60:.0f} hours old against a {c['max_age_minutes']:g}-minute limit. The gateway replay only changed when it was received."),
                message="Freshness is measured from the event time, not the receive time. A stale value cannot show current health.",
                fields={"machine": p["machine_id"], "age_hours": round(age_min / 60, 1)})
        elif p["sensor_id"].endswith("REFERENCE") and value_c < c["alarm_c"]:
            yield Finding(
                label="independent_reading_below_alarm", severity="info", identity=f"ref-{event}",
                value=(f"The independent reference sensor on {p['machine_id']} reads {value_c:.1f} °C at {p['event_at'][11:16]} UTC, "
                       f"below the {c['alarm_c']:g} °C alarm line."),
                message="Fresh, correctly labelled and independent: this is the reading to use.",
                fields={"machine": p["machine_id"], "value_c": round(value_c, 1)})


# ── Which job is worth the one technician slot? ───────────────────────────────
def maintenance_slot(f):
    opts, crew = f["options"], f["crew"]["available_technician_hours"]
    scored = []
    for o in opts:
        exposure = o["failure_probability"] * o["unplanned_hours"] * o["contribution_per_hour_eur"]
        scored.append(dict(o, exposure=exposure, net=exposure - o["planned_cost_eur"]))
    if len(scored) < 2:
        return
    best = None
    for mask in range(1, 1 << len(scored)):
        pick = [s for i, s in enumerate(scored) if mask & (1 << i)]
        if sum(p["technician_hours"] for p in pick) <= crew and all(p["free_spare_kits"] >= 1 for p in pick):
            total = sum(p["net"] for p in pick)
            if best is None or total > best[0]:
                best = (total, pick)
    if not best:
        return
    chosen = best[1][0]
    other = [s for s in scored if s is not chosen][0]
    if chosen["failure_probability"] < other["failure_probability"]:
        breakeven = (other["net"] + chosen["planned_cost_eur"]) / (chosen["unplanned_hours"] * chosen["contribution_per_hour_eur"])
        yield Finding(
            label="higher_value_intervention", severity="medium", identity="slot-choice",
            value=(f"Servicing {chosen['machine_id']} is worth about {eur(chosen['net'])} against {eur(other['net'])} for {other['machine_id']} — "
                   f"even though {other['machine_id']} has the higher assumed failure probability ({other['failure_probability']:.0%} vs {chosen['failure_probability']:.0%}). "
                   f"Only one job fits in {crew:g} technician hours."),
            message=(f"Planning assumptions, not predictions: {chosen['machine_id']} stays ahead unless its failure probability is below {breakeven:.1%}."),
            fields={"machine": chosen["machine_id"], "net_benefit_eur": round(chosen["net"]), "alternative_net_eur": round(other["net"]),
                    "breakeven_probability": round(breakeven, 4)})


# ── Did the repair work? ──────────────────────────────────────────────────────
def service_check(asset, f):
    rows = list(csv.DictReader(io.StringIO(asset.text())))
    stats = {}
    for r in rows:
        key = (r["machine_id"], r["window"], r["operating_mode"])
        stats.setdefault(key, []).append((float(r["vibration_mm_s"]), float(r["temperature_c"])))
    svc, control = f["service"], f["control_machine"]
    m = svc["machine_id"]

    def avg(machine, window):
        for (mm, w, mode), vals in stats.items():
            if mm == machine and w == window:
                return mode, mean([v for v, _ in vals]), mean([t for _, t in vals])
        return None

    b, a, cb, ca = avg(m, "before"), avg(m, "after"), avg(control, "before"), avg(control, "after")
    if not (b and a and cb and ca) or b[0] != a[0]:
        return  # only matched operating modes can be compared
    if a[1] < 0.5 * b[1] and "SPALLING" in svc["findings"]:
        yield Finding(
            label="recovery_confirmed", severity="info", identity=f"recovered-{svc['maintenance_id']}",
            value=(f"After the bearing was replaced ({svc['maintenance_id']}: {svc['findings'].replace('_', ' ').lower()} found), {m} runs at "
                   f"{a[1]:.1f} mm/s and {a[2]:.0f} °C in {a[0].lower().replace('_', '-')} mode, down from {b[1]:.1f} mm/s and {b[2]:.0f} °C; the untouched control "
                   f"{control} held {ca[1]:.1f} / {ca[2]:.0f} °C."),
            message="A short verification window. It supports the bearing finding; it does not show lasting reliability or saved revenue.",
            fields={"machine": m, "vibration_before": round(b[1], 2), "vibration_now": round(a[1], 2),
                    "temperature_before": round(b[2], 1), "temperature_now": round(a[2], 1)})
