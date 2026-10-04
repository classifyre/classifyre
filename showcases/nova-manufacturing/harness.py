#!/usr/bin/env python3
"""Run a desk's connector and detector locally, without the platform.

    python3 harness.py supply            # assets + findings summary
    python3 harness.py supply -v         # full finding text
    python3 harness.py supply --assets   # list assets

A stub of the ``classifyre`` SDK stands in for the real one so the connector and
detector code that ships to the platform is exactly the code that runs here.
"""
from __future__ import annotations

import argparse
import dataclasses
import json
import sys
import types
from pathlib import Path

ROOT = Path(__file__).parent
DATA = ROOT / "data"


# ───────────────────────── SDK stub ─────────────────────────
class _Enum:
    TRANSFORM = "TRANSFORM"
    VIEW = "VIEW"
    COPY = "COPY"


@dataclasses.dataclass
class Asset:
    id: str
    name: str = ""
    kind: str = "record"
    content: str = ""
    metadata: dict = dataclasses.field(default_factory=dict)
    urn: str | None = None
    entity: object = None
    created_at: str | None = None
    updated_at: str | None = None
    links: list = dataclasses.field(default_factory=list)
    tags: dict = dataclasses.field(default_factory=dict)


@dataclasses.dataclass
class Entity:
    name: str
    type: str = "OTHER"
    identifiers: dict = dataclasses.field(default_factory=dict)
    aliases: list = dataclasses.field(default_factory=list)
    attributes: dict = dataclasses.field(default_factory=dict)
    key: str | None = None


@dataclasses.dataclass
class Finding:
    label: str
    value: str
    severity: str | None = None
    confidence: float = 1.0
    location: object = None
    message: str | None = None
    fields: dict | None = None
    normalized_value: str | None = None
    identity: str | None = None


class Ref:
    @staticmethod
    def asset(i):
        return ("asset", i)

    @staticmethod
    def urn(u):
        return ("urn", u)

    @staticmethod
    def term(k):
        return ("term", k)


def _edge(kind):
    def make(*a, **k):
        return (kind, a, k)
    return make


class _File:
    def __init__(self, path: Path):
        self.path, self.name = path, path.name

    def read_text(self):
        return self.path.read_text()

    def read_bytes(self):
        return self.path.read_bytes()


class _Ctx:
    def __init__(self, files):
        self._files = {f.name: f for f in files}
        self.files = sorted(self._files.values(), key=lambda f: f.name)

    def file(self, name):
        if name not in self._files:
            raise FileNotFoundError(f"{name}; have {sorted(self._files)}")
        return self._files[name]

    def log(self, *a):
        print("[log]", *a)

    def var(self, name, default=None):
        return default

    state: dict = {}


def build_sdk(files):
    m = types.ModuleType("classifyre")
    m.Asset, m.Entity, m.Finding, m.Ref = Asset, Entity, Finding, Ref
    m.FlowType = _Enum
    for n in ("flow", "contains", "references", "means", "uses", "same_as"):
        setattr(m, n, _edge(n))
    m.urn_for = lambda *parts: "urn:" + ":".join(str(p) for p in parts)
    m.Location = lambda **k: k
    m.ctx = _Ctx(files)
    return m


# ───────────────────────── runners ─────────────────────────
def desk_files(desk):
    files = {}
    for d in ("master", desk):
        for p in (DATA / d).iterdir():
            if p.suffix in (".csv", ".md"):
                files[p.name] = _File(p)
    return list(files.values())


def run_connector(desk):
    files = desk_files(desk)
    sdk = build_sdk(files)
    sys.modules["classifyre"] = sdk
    src = (ROOT / "connectors" / "_common.py").read_text() + "\n\n" + (ROOT / "connectors" / f"{desk}.py").read_text()
    ns: dict = {}
    exec(compile(src, f"{desk}.py", "exec"), ns)
    assets = list(ns["extract"]())
    rels = list(ns["relationships"]()) if "relationships" in ns else []
    return assets, rels, ns


class _AssetView:
    """What a code detector sees: read-only asset."""

    def __init__(self, a: Asset):
        self._a = a
        self.id, self.name, self.kind = a.id, a.name, a.kind
        self.metadata = a.metadata
        self.urn = a.urn

    def text(self):
        return self._a.content

    def pages(self):
        return [self._a.content]

    def rows(self):
        return iter(())


def run_detector(name, assets):
    sys.modules["classifyre"] = build_sdk([])
    ns: dict = {"__name__": f"det_{name}"}
    exec(compile((ROOT / "detectors" / f"{name}.py").read_text(), f"{name}.py", "exec"), ns)
    out = []
    ctx = types.SimpleNamespace(var=lambda n, d=None: d, log=print, state={}, now=lambda: None)
    if "setup" in ns:
        ns["setup"](ctx)
    for a in assets:
        found = ns["detect"](_AssetView(a), ctx)
        if found is None:
            continue
        for f in found:
            out.append((a, f))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("desk")
    ap.add_argument("-v", "--verbose", action="store_true")
    ap.add_argument("--assets", action="store_true")
    ap.add_argument("--detector", default=None)
    args = ap.parse_args()

    assets, rels, ns = run_connector(args.desk)
    print(f"{args.desk}: {len(assets)} assets, {len(rels)} relationships")
    ids = [a.id for a in assets]
    dup = {i for i in ids if ids.count(i) > 1}
    if dup:
        print("DUPLICATE IDS:", dup)
    if args.assets:
        for a in assets:
            print(f"  {a.kind:8} {a.id:42} {a.name}")
    det = args.detector or args.desk
    if (ROOT / "detectors" / f"{det}.py").exists():
        found = run_detector(det, assets)
        print(f"{det}: {len(found)} findings")
        by = {}
        for a, f in found:
            by.setdefault((f.label, f.severity), []).append((a, f))
        for (label, sev), items in sorted(by.items()):
            print(f"  [{sev}] {label} ×{len(items)}")
            if args.verbose:
                for a, f in items:
                    print(f"      {a.id}: {f.value}")
                    if f.message:
                        print(f"        ↳ {f.message}")
                    if f.fields:
                        print(f"        fields={json.dumps(f.fields)}")


if __name__ == "__main__":
    main()
