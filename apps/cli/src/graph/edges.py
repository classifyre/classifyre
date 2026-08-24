"""The typed relationship vocabulary a connector emits.

Everything a connector knows about how two assets relate arrives here, and the
only thing this module really enforces is the distinction that a flat list of
links cannot make: **what does traversing this edge mean?**

Four classes, and only one of them is lineage:

``FLOW``         the values in B come from A. The only class where "what breaks
                 if I change this" is a meaningful question.
``CONTAINMENT``  A is a part of B; dropping B drops A. Column in table, chart in
                 dashboard, member in archive. Used to *collapse* a graph, never
                 to add a hop to it.
``IDENTITY``     A and B are the same real thing seen from two systems. Used to
                 *merge* nodes.
``REFERENCE``    everything about meaning or navigation -- foreign keys, "see
                 also", glossary terms. Propagates nothing.
``USAGE``        who touched it. An edge weight, not a path.

Flattening these into one "links" list is what produces lineage graphs that are
technically correct and unreadable: PII tags travelling downstream through a
join, or a dbt model showing up as an extra hop in every path.

**Direction.** A ``FLOW`` edge points *the way the data moves*: upstream to
downstream, so the arrow on screen follows the data and a downstream traversal
is an outward one. :func:`flow` takes both ends as keyword-only arguments
because reversing them is the easiest mistake in the whole subject and the
hardest to notice afterwards.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

from ..utils.urn import Urn

__all__ = [
    "ContainmentType",
    "Edge",
    "EdgeClass",
    "FieldMapping",
    "FieldTransform",
    "FlowType",
    "Method",
    "Ref",
    "ReferenceType",
    "UsageType",
    "contains",
    "edge_from_payload",
    "edge_to_payload",
    "flow",
    "references",
    "same_as",
    "uses",
]


class EdgeClass(StrEnum):
    FLOW = "FLOW"
    CONTAINMENT = "CONTAINMENT"
    IDENTITY = "IDENTITY"
    REFERENCE = "REFERENCE"
    USAGE = "USAGE"


class FlowType(StrEnum):
    """Subtypes of lineage, named so they do not imply a direction.

    A verb would: "DERIVED_FROM" reads backwards on an edge that points
    downstream. These are the *nature* of the derivation instead, and the
    direction is carried by the edge itself.
    """

    TRANSFORM = "TRANSFORM"  # computed from, with real logic in between
    VIEW = "VIEW"  # a view over its base tables
    COPY = "COPY"  # replica, CDC mirror, CLONE -- identity-preserving
    WRITE = "WRITE"  # a process produced this
    EXPORT = "EXPORT"  # left the system
    SEND = "SEND"  # delivered to a recipient


class ContainmentType(StrEnum):
    CONTAINS = "CONTAINS"
    ATTACHED_TO = "ATTACHED_TO"


class ReferenceType(StrEnum):
    REFERENCES = "REFERENCES"
    MENTIONS = "MENTIONS"
    FOREIGN_KEY = "FOREIGN_KEY"


class UsageType(StrEnum):
    OWNS = "OWNS"
    ACCESSED = "ACCESSED"
    READS = "READS"
    EXECUTED = "EXECUTED"


class Method(StrEnum):
    """How the edge was derived -- which is how much it should be trusted.

    Ordered strongest first. A runtime observation saw the data move; a SQL
    parse only read the intent; a heuristic guessed. Keeping this per-edge is
    what lets two connectors disagree about the same pair without either of
    them having to win at write time.
    """

    RUNTIME_OBSERVED = "RUNTIME_OBSERVED"
    SYSTEM_CATALOG = "SYSTEM_CATALOG"
    SQL_PARSED = "SQL_PARSED"
    HEURISTIC = "HEURISTIC"
    MANUAL = "MANUAL"


#: Default confidence per method. A connector may override, but should not have
#: to think about it for the ordinary case.
_METHOD_CONFIDENCE: dict[Method, float] = {
    Method.RUNTIME_OBSERVED: 1.0,
    Method.SYSTEM_CATALOG: 0.95,
    Method.SQL_PARSED: 0.8,
    Method.HEURISTIC: 0.5,
    Method.MANUAL: 1.0,
}


class FieldTransform(StrEnum):
    IDENTITY = "IDENTITY"  # copied through unchanged
    TRANSFORMED = "TRANSFORMED"  # an expression combined the upstreams
    AGGREGATED = "AGGREGATED"  # SUM/COUNT/... over a group
    INDIRECT = "INDIRECT"  # influenced the rows, not the values


@dataclass(frozen=True)
class FieldMapping:
    """One column-level dependency inside a dataset-level flow edge.

    ``downstream=None`` records an *indirect* dependency -- a column that shaped
    which rows came out (an ``ORDER BY``, a ``WHERE``, a join key) without
    feeding any particular output column. Keeping it against the dataset instead
    of against every output column is what stops indirect dependencies from
    fanning out across the whole mapping, and it is the one thing warehouse
    lineage tables have no way to say at all.
    """

    downstream: str | None
    upstreams: Sequence[str] = ()
    transform: str | None = None
    type: FieldTransform = FieldTransform.TRANSFORMED

    def __post_init__(self) -> None:
        cleaned = tuple(str(name).strip() for name in self.upstreams if str(name).strip())
        object.__setattr__(self, "upstreams", cleaned)
        if self.downstream is not None:
            object.__setattr__(self, "downstream", str(self.downstream).strip() or None)
        if self.downstream is None and self.type is not FieldTransform.INDIRECT:
            # A mapping with no output column is only meaningful as an indirect
            # dependency; silently keeping it as TRANSFORMED would render as a
            # column-to-nothing arrow in the UI.
            object.__setattr__(self, "type", FieldTransform.INDIRECT)

    def to_payload(self) -> dict[str, Any]:
        return {
            "downstream": self.downstream,
            "upstreams": list(self.upstreams),
            "transform": self.transform,
            "type": str(self.type),
        }


@dataclass(frozen=True)
class Ref:
    """One end of an edge.

    ``asset`` names something this run produced, by its hash. ``urn`` names an
    object by what its *platform* calls it -- which is how a connector points at
    a table in a system it does not scan. An unresolved URN is kept and stitched
    when the other system is eventually ingested, rather than dropped.
    """

    kind: str
    value: str

    @staticmethod
    def asset(asset_hash: str) -> Ref:
        value = str(asset_hash or "").strip()
        if not value:
            raise ValueError("Ref.asset() needs an asset hash")
        return Ref("asset", value)

    @staticmethod
    def urn(urn: str | Urn) -> Ref:
        return Ref("urn", str(Urn.parse(urn)))

    @staticmethod
    def finding(finding_id: str) -> Ref:
        value = str(finding_id or "").strip()
        if not value:
            raise ValueError("Ref.finding() needs a finding id")
        return Ref("finding", value)


@dataclass(frozen=True)
class Edge:
    """A directed, classified relationship between two graph entities."""

    frm: Ref
    to: Ref
    edge_class: EdgeClass
    relation_type: str
    confidence: float = 1.0
    method: Method = Method.SYSTEM_CATALOG
    fields: tuple[FieldMapping, ...] = ()
    via: Ref | None = None
    evidence: dict[str, Any] = field(default_factory=dict)

    @property
    def granularity(self) -> str:
        return "FIELD" if self.fields else "DATASET"

    def to_ingest(self) -> Any:
        """Convert to the wire model the REST sink posts.

        Imported lazily: this module is part of the connector-facing SDK and
        must not drag the HTTP sink into a notebook's import graph.
        """
        from ..outputs.rest import IngestEdge

        payload: dict[str, Any] = {
            "from_type": "asset" if self.frm.kind != "finding" else "finding",
            "to_type": "asset" if self.to.kind != "finding" else "finding",
            "relation_type": str(self.relation_type),
            "relation_class": str(self.edge_class),
            "granularity": self.granularity,
            "method": str(self.method),
            "confidence": round(float(self.confidence), 2),
        }
        _apply_endpoint(payload, self.frm, "from")
        _apply_endpoint(payload, self.to, "to")
        if self.fields:
            payload["field_mappings"] = [mapping.to_payload() for mapping in self.fields]
        if self.evidence:
            payload["evidence"] = dict(self.evidence)
        if self.via is not None:
            payload["via_id"] = self.via.value if self.via.kind == "asset" else None
            payload["via_urn"] = self.via.value if self.via.kind == "urn" else None
        return IngestEdge(**payload)


def edge_to_payload(edge: Edge) -> dict[str, Any]:
    """Plain-JSON form, for crossing the notebook subprocess boundary."""
    return {
        "from": {"kind": edge.frm.kind, "value": edge.frm.value},
        "to": {"kind": edge.to.kind, "value": edge.to.value},
        "class": str(edge.edge_class),
        "relationType": str(edge.relation_type),
        "confidence": edge.confidence,
        "method": str(edge.method),
        "fields": [mapping.to_payload() for mapping in edge.fields],
        "evidence": dict(edge.evidence),
        "via": None if edge.via is None else {"kind": edge.via.kind, "value": edge.via.value},
    }


def edge_from_payload(payload: dict[str, Any]) -> Edge:
    """Rebuild an Edge on the parent side of the notebook boundary."""

    def ref(value: Any) -> Ref | None:
        if not isinstance(value, dict):
            return None
        kind = str(value.get("kind") or "asset")
        text = str(value.get("value") or "")
        return Ref(kind, text) if text else None

    frm = ref(payload.get("from"))
    to = ref(payload.get("to"))
    if frm is None or to is None:
        raise ValueError("A relationship needs both ends")

    return Edge(
        frm=frm,
        to=to,
        edge_class=EdgeClass(str(payload.get("class") or EdgeClass.REFERENCE)),
        relation_type=str(payload.get("relationType") or "REFERENCES"),
        confidence=float(payload.get("confidence") or 1.0),
        method=Method(str(payload.get("method") or Method.SYSTEM_CATALOG)),
        fields=tuple(
            FieldMapping(
                downstream=item.get("downstream"),
                upstreams=item.get("upstreams") or [],
                transform=item.get("transform"),
                type=FieldTransform(str(item.get("type") or FieldTransform.TRANSFORMED)),
            )
            for item in payload.get("fields") or []
            if isinstance(item, dict)
        ),
        via=ref(payload.get("via")),
        evidence=dict(payload.get("evidence") or {}),
    )


def _apply_endpoint(payload: dict[str, Any], ref: Ref, side: str) -> None:
    if ref.kind == "urn":
        payload[f"{side}_urn"] = ref.value
    else:
        payload[f"{side}_hash"] = ref.value


def _confidence(method: Method, override: float | None) -> float:
    if override is not None:
        return max(0.0, min(1.0, float(override)))
    return _METHOD_CONFIDENCE.get(method, 1.0)


# ── Builders ─────────────────────────────────────────────────────────────
#
# One per class. The class is never a free-text argument, so a connector cannot
# accidentally file a containment relation as lineage -- it would have to call a
# different function to do it.


def flow(
    *,
    upstream: Ref,
    downstream: Ref,
    type: FlowType = FlowType.TRANSFORM,
    fields: Iterable[FieldMapping] | None = None,
    via: Ref | None = None,
    sql: str | None = None,
    method: Method = Method.SYSTEM_CATALOG,
    confidence: float | None = None,
    evidence: dict[str, Any] | None = None,
) -> Edge:
    """Data moves from ``upstream`` into ``downstream``.

    Both ends are keyword-only on purpose: a reversed lineage edge is silently
    wrong rather than loudly broken, and it is the mistake everyone makes once.
    """
    detail = dict(evidence or {})
    if sql:
        detail["sql"] = sql
    return Edge(
        frm=upstream,
        to=downstream,
        edge_class=EdgeClass.FLOW,
        relation_type=str(type),
        confidence=_confidence(method, confidence),
        method=method,
        fields=tuple(fields or ()),
        via=via,
        evidence=detail,
    )


def contains(parent: Ref, child: Ref, *, type: ContainmentType = ContainmentType.CONTAINS) -> Edge:
    """``child`` is a part of ``parent`` -- structural, not temporal."""
    return Edge(
        frm=parent,
        to=child,
        edge_class=EdgeClass.CONTAINMENT,
        relation_type=str(type),
        method=Method.SYSTEM_CATALOG,
        confidence=1.0,
    )


def same_as(a: Ref, b: Ref, *, method: Method = Method.SYSTEM_CATALOG) -> Edge:
    """The same real-world object, seen from two systems."""
    return Edge(
        frm=a,
        to=b,
        edge_class=EdgeClass.IDENTITY,
        relation_type="SAME_AS",
        method=method,
        confidence=_confidence(method, None),
    )


def references(
    frm: Ref,
    to: Ref,
    *,
    type: ReferenceType = ReferenceType.REFERENCES,
    method: Method = Method.SYSTEM_CATALOG,
) -> Edge:
    """``frm`` points at ``to``. No data moves -- a foreign key is not lineage."""
    return Edge(
        frm=frm,
        to=to,
        edge_class=EdgeClass.REFERENCE,
        relation_type=str(type),
        method=method,
        confidence=_confidence(method, None),
    )


def uses(actor: Ref, target: Ref, *, type: UsageType = UsageType.ACCESSED) -> Edge:
    """``actor`` touched ``target``. Answers "who", not "where did this come from"."""
    return Edge(
        frm=actor,
        to=target,
        edge_class=EdgeClass.USAGE,
        relation_type=str(type),
        method=Method.RUNTIME_OBSERVED,
        confidence=1.0,
    )
