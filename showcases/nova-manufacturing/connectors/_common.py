"""Shared helpers, prepended to every desk connector at build time.

Everything a connector does is reading its uploaded files, joining them into
business records, and saying how those records relate. It never decides what is
wrong with them: that is the detectors' job.
"""
import csv
import io
import json
from datetime import date

from classifyre import Asset, Entity, Ref, FlowType, contains, flow, means, references, urn_for, ctx

AS_OF = "2026-10-02T08:00:00Z"


def table(name):
    """A CSV file uploaded to this source, as a list of dict rows."""
    return list(csv.DictReader(io.StringIO(ctx.file(name).read_text())))


def lookup(name, key):
    return {row[key]: row for row in table(name)}


def num(value, default=0):
    try:
        x = float(value)
    except (TypeError, ValueError):
        return default
    return int(x) if x == int(x) else x


def eur(value):
    value = float(value)
    return f"€{value:,.0f}" if value == int(value) else f"€{value:,.2f}"


def nice_day(iso):
    """'2026-10-05' -> '5 Oct'."""
    y, m, d = iso[:10].split("-")
    months = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()
    return f"{int(d)} {months[int(m) - 1]}"


def days_between(a, b):
    """Whole days from date string a to date string b."""
    return (date.fromisoformat(b[:10]) - date.fromisoformat(a[:10])).days


def md_table(rows, columns):
    """columns: [(key, header)] -> a small markdown table."""
    if not rows:
        return ""
    head = "| " + " | ".join(h for _, h in columns) + " |"
    rule = "|" + "|".join("---" for _ in columns) + "|"
    body = ["| " + " | ".join(str(r.get(k, "")) for k, _ in columns) + " |" for r in rows]
    return "\n".join([head, rule, *body])


def urn(kind, ident):
    return urn_for("nova", "manufacturing", kind, ident)


def record(id, name, content, object_type, urn_key=None, facts=None, view=None, status=None,
           created_at=None, entity=None, **extra):
    """A business record. ``facts`` is the structured copy detectors read."""
    meta = {"object_type": object_type}
    if view:
        meta["view"] = view
    if status:
        meta["status"] = status
    if facts is not None:
        meta["facts"] = facts
    meta.update(extra)
    kwargs = {}
    if created_at:
        kwargs["created_at"] = created_at
        kwargs["updated_at"] = created_at
    if urn_key:
        kwargs["urn"] = urn(*urn_key)
    if entity is not None:
        kwargs["entity"] = entity
    return Asset(id=id, name=name, kind="record", content=content, metadata=meta, **kwargs)
