"""The Dremio source, driven against an in-memory stand-in for its REST API.

The stand-in replaces ``DremioClient.request`` — the one place HTTP happens — so
everything above it runs for real: catalog paging, the job submit/poll/page
cycle, the DB-API cursor the tabular base drives, and the source itself.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest

from src.graph.edges import EdgeClass, FlowType, Method
from src.models.generated_single_asset_scan_results import AssetType as OutputAssetType
from src.models.generated_single_asset_scan_results import SingleAssetScanResults
from src.sources.asset_metadata import resolve_fields, validate_metadata
from src.sources.dremio.client import (
    DremioApiError,
    DremioClient,
    DremioCursor,
    cloud_api_url,
    render_sql,
)
from src.sources.dremio.source import DremioSource, DremioTableRef, dataset_ref, parse_path
from src.utils.hashing import hash_id

Q3_LEADS_SQL = (
    "SELECT o.id, o.email AS contact "
    "FROM warehouse_pg.public.orders o "
    "JOIN customers_clean c ON o.customer_id = c.id"
)
CUSTOMERS_CLEAN_SQL = 'SELECT * FROM "Samples"."samples.dremio.com"."customers.json"'


def _recipe(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "type": "DREMIO",
        "required": {"url": "https://Dremio.Example.com:9047/"},
        "masked": {"token": "pat-token"},
        "sampling": {"strategy": "RANDOM"},
    }
    base.update(overrides)
    return base


def _fields(*columns: tuple[str, str]) -> list[dict[str, Any]]:
    return [{"name": name, "type": {"name": type_name}} for name, type_name in columns]


class FakeDremio:
    """Enough of Dremio's catalog, lineage and job endpoints to scan against."""

    def __init__(self, *, lineage_graph: bool = True) -> None:
        self.lineage_graph = lineage_graph
        self.calls: list[tuple[str, str]] = []
        self.sql: list[str] = []
        self.result_requests: list[tuple[str, int, int]] = []
        self.rows_for: Callable[[str], list[dict[str, Any]]] = lambda _sql: [{"one": 1}]
        self.failing_sql: str | None = None
        self._jobs: dict[str, list[dict[str, Any]]] = {}

        self.roots = [
            self._root("space-marketing", "Marketing", "SPACE"),
            self._root("src-pg", "warehouse_pg", "SOURCE"),
            self._root("src-samples", "Samples", "SOURCE"),
            self._root("home-zephyr", "@zephyr.quill", "HOME"),
        ]
        self.entities: dict[str, dict[str, Any]] = {
            "space-marketing": {
                "entityType": "space",
                "children": [
                    self._folder("folder-campaigns", ["Marketing", "Campaigns"]),
                    self._folder("folder-scratch", ["Marketing", "Scratch"]),
                ],
            },
            "folder-campaigns": {
                "entityType": "folder",
                "children": [
                    self._dataset("view-q3", ["Marketing", "Campaigns", "q3_leads"], "VIRTUAL"),
                    self._dataset(
                        "view-clean", ["Marketing", "Campaigns", "customers_clean"], "VIRTUAL"
                    ),
                ],
            },
            "folder-scratch": {
                "entityType": "folder",
                "children": [
                    self._dataset("view-tmp", ["Marketing", "Scratch", "tmp"], "VIRTUAL"),
                ],
            },
            "src-pg": {
                "entityType": "source",
                "type": "POSTGRES",
                "config": {
                    "hostname": "PG.internal",
                    "port": "5432",
                    "databaseName": "analytics",
                    "password": "$DREMIO_EXISTING_VALUE$",
                },
                "children": [self._folder("folder-public", ["warehouse_pg", "public"])],
            },
            "folder-public": {
                "entityType": "folder",
                "children": [
                    self._dataset("tbl-orders", ["warehouse_pg", "public", "orders"], "DIRECT"),
                ],
            },
            "src-samples": {
                "entityType": "source",
                "type": "S3",
                "config": {},
                "children": [
                    self._folder(
                        "dremio:/Samples/samples.dremio.com", ["Samples", "samples.dremio.com"]
                    )
                ],
            },
            "dremio:/Samples/samples.dremio.com": {
                "entityType": "folder",
                "children": [
                    self._dataset(
                        "tbl-customers",
                        ["Samples", "samples.dremio.com", "customers.json"],
                        "PROMOTED",
                    ),
                    {
                        "id": "dremio:/Samples/samples.dremio.com/raw.csv",
                        "path": ["Samples", "samples.dremio.com", "raw.csv"],
                        "type": "FILE",
                    },
                ],
            },
            "home-zephyr": {
                "entityType": "home",
                "children": [self._dataset("view-home", ["@zephyr.quill", "notes"], "VIRTUAL")],
            },
            "view-q3": {
                "entityType": "dataset",
                "type": "VIRTUAL_DATASET",
                "path": ["Marketing", "Campaigns", "q3_leads"],
                "sql": Q3_LEADS_SQL,
                "sqlContext": ["Marketing", "Campaigns"],
                "fields": _fields(("id", "BIGINT"), ("contact", "VARCHAR")),
            },
            "view-clean": {
                "entityType": "dataset",
                "type": "VIRTUAL_DATASET",
                "path": ["Marketing", "Campaigns", "customers_clean"],
                "sql": CUSTOMERS_CLEAN_SQL,
                "sqlContext": [],
                "fields": _fields(("id", "BIGINT"), ("email", "VARCHAR")),
            },
            "view-tmp": {
                "entityType": "dataset",
                "type": "VIRTUAL_DATASET",
                "path": ["Marketing", "Scratch", "tmp"],
                "sql": "SELECT 1 AS one",
                "fields": _fields(("one", "INTEGER")),
            },
            "view-home": {
                "entityType": "dataset",
                "type": "VIRTUAL_DATASET",
                "path": ["@zephyr.quill", "notes"],
                "sql": "SELECT 1 AS one",
                "fields": _fields(("one", "INTEGER")),
            },
            "tbl-orders": {
                "entityType": "dataset",
                "type": "PHYSICAL_DATASET",
                "path": ["warehouse_pg", "public", "orders"],
                "fields": [
                    {"name": "id", "type": {"name": "BIGINT"}},
                    {"name": "email", "type": {"name": "VARCHAR"}},
                    {"name": "total", "type": {"name": "DECIMAL", "precision": 12, "scale": 2}},
                    {"name": "updated_at", "type": {"name": "TIMESTAMP"}},
                ],
            },
            "tbl-customers": {
                "entityType": "dataset",
                "type": "PHYSICAL_DATASET",
                "path": ["Samples", "samples.dremio.com", "customers.json"],
                "format": {"type": "JSON"},
                "fields": _fields(("id", "BIGINT"), ("email", "VARCHAR")),
            },
        }
        self.parents: dict[str, list[list[str]]] = {
            "view-q3": [
                ["warehouse_pg", "public", "orders"],
                ["Marketing", "Campaigns", "customers_clean"],
            ],
            "view-clean": [["Samples", "samples.dremio.com", "customers.json"]],
        }

    @staticmethod
    def _root(entity_id: str, name: str, container_type: str) -> dict[str, Any]:
        return {
            "id": entity_id,
            "path": [name],
            "type": "CONTAINER",
            "containerType": container_type,
        }

    @staticmethod
    def _folder(entity_id: str, path: list[str]) -> dict[str, Any]:
        return {"id": entity_id, "path": path, "type": "CONTAINER", "containerType": "FOLDER"}

    @staticmethod
    def _dataset(entity_id: str, path: list[str], dataset_type: str) -> dict[str, Any]:
        return {"id": entity_id, "path": path, "type": "DATASET", "datasetType": dataset_type}

    def fetched(self, entity_id: str) -> bool:
        from urllib.parse import quote

        return ("get", f"/catalog/{quote(entity_id, safe='')}") in self.calls

    def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json_payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        from urllib.parse import unquote

        self.calls.append((method, path))
        if path == "/catalog":
            return {"data": self.roots}
        if path == "/sql":
            assert json_payload is not None
            sql = json_payload["sql"]
            self.sql.append(sql)
            job_id = f"job-{len(self.sql)}"
            self._jobs[job_id] = self.rows_for(sql)
            return {"id": job_id}
        if path.startswith("/job/"):
            job_id, _, tail = path.removeprefix("/job/").partition("/")
            rows = self._jobs[job_id]
            if tail == "results":
                assert params is not None
                offset, limit = int(params["offset"]), int(params["limit"])
                assert limit <= 500, "Dremio rejects a results limit above 500"
                self.result_requests.append((job_id, offset, limit))
                names = list(rows[0]) if rows else ["one"]
                return {
                    "rowCount": len(rows),
                    "schema": [{"name": name, "type": {"name": "VARCHAR"}} for name in names],
                    "rows": rows[offset : offset + limit],
                }
            if tail == "cancel":
                return {}
            sql = self.sql[int(job_id.removeprefix("job-")) - 1]
            if self.failing_sql and self.failing_sql in sql:
                return {"jobState": "FAILED", "errorMessage": "Table not found"}
            return {"jobState": "COMPLETED", "rowCount": len(rows)}
        if path.startswith("/catalog/by-path/"):
            wanted = [unquote(part) for part in path.removeprefix("/catalog/by-path/").split("/")]
            for entity in self.entities.values():
                if entity.get("path") == wanted:
                    return dict(entity)
            raise DremioApiError("Dremio API returned HTTP 404", 404)
        if path.endswith("/graph"):
            entity_id = unquote(path.removeprefix("/catalog/").removesuffix("/graph"))
            if not self.lineage_graph:
                raise DremioApiError("Dremio API returned HTTP 404", 404)
            return {
                "parents": [
                    {"path": parent, "type": "DATASET"}
                    for parent in self.parents.get(entity_id, [])
                ]
            }
        if path.startswith("/catalog/"):
            entity_id = unquote(path.removeprefix("/catalog/"))
            entity = self.entities.get(entity_id)
            if entity is None:
                raise DremioApiError("Dremio API returned HTTP 404", 404)
            return {**entity, "children": list(entity.get("children") or [])}
        raise AssertionError(f"Unexpected Dremio request: {method} {path}")


@pytest.fixture
def dremio(monkeypatch: pytest.MonkeyPatch) -> FakeDremio:
    fake = FakeDremio()
    monkeypatch.setattr(
        DremioClient,
        "request",
        lambda _self, method, path, **kwargs: fake.request(method, path, **kwargs),
    )
    return fake


async def _extract(source: DremioSource) -> list[SingleAssetScanResults]:
    return [asset async for batch in source.extract() for asset in batch]


def _hash(*path: str) -> str:
    return hash_id("DREMIO", "_#_".join(path))


def _flow_edges(source: DremioSource) -> dict[tuple[str | None, str | None], Any]:
    edges = source.drain_edges()
    assert all(edge.relation_class == str(EdgeClass.FLOW) for edge in edges)
    return {(edge.from_hash or edge.from_urn, edge.to_hash): edge for edge in edges}


# ── Paths and identity ───────────────────────────────────────────────────


def test_parse_path_keeps_dots_inside_quotes() -> None:
    assert parse_path("Marketing.Campaigns") == ("Marketing", "Campaigns")
    assert parse_path('Samples."samples.dremio.com"') == ("Samples", "samples.dremio.com")
    assert parse_path('"a ""b"" c".d') == ('a "b" c', "d")
    assert parse_path(" Finance ") == ("Finance",)


def test_dataset_ref_keeps_the_whole_path_as_identity() -> None:
    ref = dataset_ref(("Samples", "samples.dremio.com", "NYC", "trips.parquet"), "TABLE")

    assert ref.table_key == ("Samples", "samples.dremio.com", "NYC", "trips.parquet")
    assert ref.raw_id == "Samples_#_samples.dremio.com_#_NYC_#_trips.parquet"
    assert (ref.database, ref.schema, ref.table) == (
        "Samples",
        "samples.dremio.com.NYC",
        "trips.parquet",
    )


def test_asset_hash_round_trips_a_path_with_dots() -> None:
    source = DremioSource(_recipe())
    asset_hash = _hash("Samples", "samples.dremio.com", "customers.json")

    ref = source._parse_table_ref_from_asset_id(asset_hash)

    assert isinstance(ref, DremioTableRef)
    assert ref.table_key == ("Samples", "samples.dremio.com", "customers.json")
    assert source._table_select_fqn(ref) == '"Samples"."samples.dremio.com"."customers.json"'


# ── Connection ───────────────────────────────────────────────────────────


def test_dremio_test_connection_success(dremio: FakeDremio) -> None:
    result = DremioSource(_recipe()).test_connection()

    assert result["status"] == "SUCCESS"
    # The home space is out of scope by default.
    assert "Sources and spaces in scope: 3" in result["message"]
    assert dremio.sql == ["SELECT 1"]


def test_dremio_test_connection_reports_rejected_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _reject(_self: DremioClient, _method: str, _path: str, **_kwargs: Any) -> dict[str, Any]:
        raise DremioApiError("Dremio rejected the credentials (HTTP 401)", 401)

    monkeypatch.setattr(DremioClient, "request", _reject)

    result = DremioSource(_recipe()).test_connection()

    assert result["status"] == "FAILURE"
    assert "rejected the credentials" in result["message"]
    assert "pat-token" not in result["message"]


def test_dremio_cloud_refuses_a_username_and_password() -> None:
    with pytest.raises(ValueError, match="Dremio Cloud signs in with a personal access token"):
        DremioSource(
            _recipe(
                required={"project_id": "proj-1", "region": "EU"},
                masked={"username": "lantern-bot", "password": "not-a-real-password"},
            )
        )


def test_self_hosted_dremio_accepts_either_sign_in() -> None:
    with_token = DremioSource(_recipe())
    assert with_token._client._token == "pat-token"
    assert with_token._client._login_url is None

    with_password = DremioSource(
        _recipe(masked={"username": "lantern-bot", "password": "not-a-real-password"})
    )
    assert with_password._client._token is None
    assert with_password._client._login_url == "https://dremio.example.com:9047/apiv2/login"
    assert with_password._client._api_url == "https://dremio.example.com:9047/api/v3"


def test_dremio_cloud_uses_project_endpoints() -> None:
    source = DremioSource(_recipe(required={"project_id": "proj-1", "region": "EU"}))

    assert source._client._api_url == "https://api.eu.dremio.cloud/v0/projects/proj-1"
    assert cloud_api_url("US", "proj-1") == "https://api.dremio.cloud/v0/projects/proj-1"
    assert source._urn_authority() == "proj-1"
    url = source._build_external_url(dataset_ref(("Marketing", "leads"), "VIEW"))
    assert url.startswith("https://app.eu.dremio.cloud/sonar/proj-1/")


class _Response:
    def __init__(self, status_code: int, payload: dict[str, Any] | None = None) -> None:
        self.status_code = status_code
        self._payload = payload or {}
        self.content = b"{}"
        self.ok = status_code < 400

    def json(self) -> dict[str, Any]:
        return self._payload


def test_pat_is_sent_as_a_bearer_token(monkeypatch: pytest.MonkeyPatch) -> None:
    client = DremioClient(api_url="https://dremio.example.com:9047/api/v3", token="pat-token")
    seen: list[dict[str, Any]] = []

    def _request(method: str, url: str, **kwargs: Any) -> _Response:
        seen.append({"method": method, "url": url, **kwargs})
        return _Response(200, {"data": []})

    monkeypatch.setattr(client.session, "request", _request)

    assert client.list_roots() == []
    assert seen[0]["url"] == "https://dremio.example.com:9047/api/v3/catalog"
    assert seen[0]["headers"]["Authorization"] == "Bearer pat-token"


def test_password_mode_logs_in_and_refreshes_an_expired_session(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = DremioClient(
        api_url="http://localhost:9047/api/v3",
        login_url="http://localhost:9047/apiv2/login",
        username="lantern-bot",
        password="s3cret",
    )
    logins: list[dict[str, Any]] = []
    headers: list[str] = []
    statuses = iter([401, 200])

    def _post(url: str, **kwargs: Any) -> _Response:
        logins.append({"url": url, **kwargs})
        return _Response(200, {"token": f"session-{len(logins)}"})

    def _request(_method: str, _url: str, **kwargs: Any) -> _Response:
        headers.append(kwargs["headers"]["Authorization"])
        return _Response(next(statuses), {"data": []})

    monkeypatch.setattr(client.session, "post", _post)
    monkeypatch.setattr(client.session, "request", _request)

    client.list_roots()

    assert logins[0]["url"] == "http://localhost:9047/apiv2/login"
    assert logins[0]["json"] == {"userName": "lantern-bot", "password": "s3cret"}
    # The stale session got one fresh login, not an error and not a loop.
    assert headers == ["_dremiosession-1", "_dremiosession-2"]


# ── Discovery ────────────────────────────────────────────────────────────


async def test_dremio_extract_walks_the_catalog_tree(dremio: FakeDremio) -> None:
    source = DremioSource(_recipe())

    assets = {asset.name: asset for asset in await _extract(source)}

    assert set(assets) == {
        "Marketing.Campaigns.q3_leads",
        "Marketing.Campaigns.customers_clean",
        "Marketing.Scratch.tmp",
        "warehouse_pg.public.orders",
        # One folder whose name contains dots, not three folders; and the
        # unpromoted raw.csv beside it is not a dataset.
        "Samples.samples.dremio.com.customers.json",
    }
    assert not dremio.fetched("home-zephyr")

    orders = assets["warehouse_pg.public.orders"]
    assert orders.hash == _hash("warehouse_pg", "public", "orders")
    assert orders.asset_type == OutputAssetType.TABLE
    assert orders.asset_kind == "table"
    assert orders.urn == "dremio://dremio.example.com/warehouse_pg/public/orders"
    assert orders.external_url == (
        "https://dremio.example.com:9047/source/%22warehouse_pg%22/%22public%22.%22orders%22"
    )
    assert orders.metadata == {
        "database": "warehouse_pg",
        "table_name": "orders",
        "table_type": "TABLE",
        "schema": "public",
        "columns": [
            {"name": "id", "type": "BIGINT"},
            {"name": "email", "type": "VARCHAR"},
            {"name": "total", "type": "DECIMAL(12,2)"},
            {"name": "updated_at", "type": "TIMESTAMP"},
        ],
        "object_type": "PHYSICAL_DATASET",
        "container_type": "SOURCE",
        "source_system": "POSTGRES",
    }

    view = assets["Marketing.Campaigns.q3_leads"]
    assert view.metadata["table_type"] == "VIEW"
    assert view.metadata["object_type"] == "VIRTUAL_DATASET"
    assert view.metadata["container_type"] == "SPACE"
    assert view.external_url.startswith("https://dremio.example.com:9047/space/%22Marketing%22/")

    customers = assets["Samples.samples.dremio.com.customers.json"]
    assert customers.metadata["schema"] == "samples.dremio.com"
    assert customers.metadata["format"] == "JSON"

    # Lineage is carried by typed edges, so no dataset doubles it up as a
    # plain reference link.
    assert all(asset.links == [] for asset in assets.values())


@pytest.mark.usefixtures("dremio")
async def test_dremio_asset_metadata_conforms_to_the_catalog() -> None:
    declared = {field["name"] for field in resolve_fields("dremio", "table")}
    for asset in await _extract(DremioSource(_recipe())):
        assert asset.asset_kind == "table"
        assert asset.metadata is not None
        # Strict under pytest: an undeclared or missing key raises here.
        validate_metadata("dremio", "table", dict(asset.metadata))
        assert set(asset.metadata) <= declared


async def test_dremio_scope_prunes_the_walk(dremio: FakeDremio) -> None:
    source = DremioSource(
        _recipe(
            optional={
                "scope": {
                    "include_paths": ["marketing", 'Samples."samples.dremio.com"'],
                    "exclude_paths": ["Marketing.Scratch"],
                }
            }
        )
    )

    names = {asset.name for asset in await _extract(source)}

    assert names == {
        "Marketing.Campaigns.q3_leads",
        "Marketing.Campaigns.customers_clean",
        "Samples.samples.dremio.com.customers.json",
    }
    # Out-of-scope containers are never opened, not opened and then filtered.
    assert not dremio.fetched("src-pg")
    assert not dremio.fetched("folder-scratch")


@pytest.mark.usefixtures("dremio")
async def test_dremio_scope_dataset_kinds_home_spaces_and_limit() -> None:
    tables_only = DremioSource(_recipe(optional={"scope": {"include_views": False}}))
    assert {asset.name for asset in await _extract(tables_only)} == {
        "warehouse_pg.public.orders",
        "Samples.samples.dremio.com.customers.json",
    }

    with_home = DremioSource(
        _recipe(optional={"scope": {"include_tables": False, "include_home_spaces": True}})
    )
    assert "@zephyr.quill.notes" in {asset.name for asset in await _extract(with_home)}

    limited = DremioSource(_recipe(optional={"scope": {"table_limit": 2}}))
    assert len(await _extract(limited)) == 2


# ── Lineage ──────────────────────────────────────────────────────────────


@pytest.mark.usefixtures("dremio")
async def test_dremio_view_lineage_from_the_lineage_graph() -> None:
    source = DremioSource(_recipe())
    await _extract(source)

    edges = _flow_edges(source)

    q3 = _hash("Marketing", "Campaigns", "q3_leads")
    clean = _hash("Marketing", "Campaigns", "customers_clean")
    orders = _hash("warehouse_pg", "public", "orders")
    customers = _hash("Samples", "samples.dremio.com", "customers.json")

    # Upstream -> downstream, the way the data moves.
    for upstream, downstream in ((orders, q3), (clean, q3), (customers, clean)):
        assert edges[(upstream, downstream)].relation_type == str(FlowType.VIEW)

    q3_edge = edges[(orders, q3)]
    assert q3_edge.evidence == {"sql": Q3_LEADS_SQL}
    assert {
        (mapping["downstream"], tuple(mapping["upstreams"])) for mapping in q3_edge.field_mappings
    } >= {("id", ("id",)), ("contact", ("email",))}

    # `SELECT *` yields no column detail, and Dremio itself named the upstream.
    star_edge = edges[(customers, clean)]
    assert star_edge.granularity == "DATASET"
    assert star_edge.method == str(Method.SYSTEM_CATALOG)


async def test_dremio_view_lineage_falls_back_to_view_sql(
    dremio: FakeDremio,
) -> None:
    dremio.lineage_graph = False  # Community Edition has no lineage endpoint
    source = DremioSource(_recipe())
    await _extract(source)

    edges = _flow_edges(source)

    q3 = _hash("Marketing", "Campaigns", "q3_leads")
    clean = _hash("Marketing", "Campaigns", "customers_clean")
    orders = _hash("warehouse_pg", "public", "orders")
    customers = _hash("Samples", "samples.dremio.com", "customers.json")

    # `customers_clean` is written bare and resolves through the view's saved
    # context; `warehouse_pg.public.orders` is absolute.
    assert (orders, q3) in edges
    assert (clean, q3) in edges
    assert (customers, clean) in edges
    # Read out of SQL, and labelled so even where no columns could be mapped.
    assert edges[(customers, clean)].method == str(Method.SQL_PARSED)
    assert edges[(customers, clean)].confidence < 0.95

    # The endpoint is given up on rather than asked once per view.
    graph_calls = [path for _method, path in dremio.calls if path.endswith("/graph")]
    assert len(graph_calls) == 3


async def test_dremio_keeps_lineage_to_datasets_outside_the_scan(dremio: FakeDremio) -> None:
    for graph in (True, False):
        dremio.lineage_graph = graph
        source = DremioSource(_recipe(optional={"scope": {"include_paths": ["Marketing"]}}))
        await _extract(source)

        edges = _flow_edges(source)

        q3 = _hash("Marketing", "Campaigns", "q3_leads")
        clean = _hash("Marketing", "Campaigns", "customers_clean")
        assert ("dremio://dremio.example.com/warehouse_pg/public/orders", q3) in edges
        assert (
            "dremio://dremio.example.com/samples/samples.dremio.com/customers.json",
            clean,
        ) in edges


@pytest.mark.usefixtures("dremio")
async def test_dremio_links_source_tables_to_the_database_behind_them() -> None:
    source = DremioSource(_recipe())
    await _extract(source)

    edges = _flow_edges(source)

    orders = _hash("warehouse_pg", "public", "orders")
    # The URN PostgreSQL's own connector writes: default port dropped, the
    # database taken from the Dremio source's connection settings.
    edge = edges[("postgres://pg.internal/analytics/public/orders", orders)]
    assert edge.relation_type == str(FlowType.VIEW)
    assert edge.method == str(Method.SYSTEM_CATALOG)
    # An S3 source has no table-level name on the other side to point at.
    assert not any(str(upstream).startswith("s3://") for upstream, _ in edges)


@pytest.mark.usefixtures("dremio")
async def test_dremio_source_lineage_can_be_switched_off() -> None:
    source = DremioSource(
        _recipe(
            optional={
                "extraction": {"include_view_lineage": False, "include_source_lineage": False}
            }
        )
    )
    await _extract(source)

    assert source.drain_edges() == []


@pytest.mark.parametrize(
    ("source_type", "config", "path", "expected"),
    [
        (
            "MYSQL",
            {"hostname": "mysql.internal", "port": "3307"},
            ("my", "shop", "orders"),
            "mysql://mysql.internal:3307/shop/orders",
        ),
        (
            "MSSQL",
            {"hostname": "sql.internal", "port": "1433"},
            ("ms", "Sales", "dbo", "Orders"),
            "mssql://sql.internal/sales/dbo/orders",
        ),
        (
            "MSSQL",
            {"hostname": "sql.internal", "port": "1433", "database": "Sales"},
            ("ms", "dbo", "Orders"),
            "mssql://sql.internal/sales/dbo/orders",
        ),
        (
            "ORACLE",
            {"hostname": "ora.internal", "port": "1521", "instance": "ORCL"},
            ("ora", "HR", "EMPLOYEES"),
            "oracle://ora.internal/ORCL/HR/EMPLOYEES",
        ),
        (
            "SNOWFLAKE",
            {"hostname": "xy12345.eu-west-1.snowflakecomputing.com"},
            ("sf", "PROD", "PUBLIC", "ORDERS"),
            "snowflake://xy12345.eu-west-1/PROD/PUBLIC/ORDERS",
        ),
        # No host to scope the name to, or a layout the platform does not use.
        ("POSTGRES", {"databaseName": "analytics"}, ("pg", "public", "orders"), None),
        ("POSTGRES", {"hostname": "pg.internal"}, ("pg", "public", "orders"), None),
        ("MYSQL", {"hostname": "mysql.internal"}, ("my", "a", "b", "c"), None),
        ("S3", {"hostname": "s3.internal"}, ("lake", "bucket", "file.parquet"), None),
    ],
)
def test_dremio_external_urn_matches_each_platforms_own_naming(
    source_type: str, config: dict[str, Any], path: tuple[str, ...], expected: str | None
) -> None:
    source = DremioSource(_recipe())
    source._source_systems[path[0].lower()] = (source_type, config)

    assert source._external_urn(dataset_ref(path)) == expected


# ── Sampling ─────────────────────────────────────────────────────────────


async def test_dremio_random_sample_query_and_content(dremio: FakeDremio) -> None:
    dremio.rows_for = lambda _sql: [
        {"id": 1, "email": "pip.marlow@example.com", "total": "10.50", "updated_at": "2026-01-01"},
        {"id": 2, "email": None, "total": "7.00", "updated_at": "2026-01-02"},
    ]
    source = DremioSource(_recipe(sampling={"strategy": "RANDOM", "rows_per_page": 25}))
    assets = {asset.name: asset for asset in await _extract(source)}
    dremio.sql.clear()

    content = await source.fetch_content(assets["warehouse_pg.public.orders"].hash)

    assert dremio.sql == [
        'SELECT "id", "email", "total", "updated_at" '
        'FROM "warehouse_pg"."public"."orders" ORDER BY RANDOM() LIMIT 25'
    ]
    assert content is not None
    _raw, text = content
    assert "table=warehouse_pg.public.orders" in text
    assert "email: pip.marlow@example.com" in text
    assert "email: null" in text


@pytest.mark.usefixtures("dremio")
async def test_dremio_latest_sample_orders_by_the_timestamp_column() -> None:
    source = DremioSource(_recipe(sampling={"strategy": "LATEST", "rows_per_page": 10}))
    ref = dataset_ref(("warehouse_pg", "public", "orders"))

    query, params = source._build_sampling_query(ref, source._available_columns(ref))

    assert render_sql(query, params).endswith(
        'FROM "warehouse_pg"."public"."orders" ORDER BY "updated_at" DESC NULLS LAST LIMIT 10'
    )


def test_dremio_automatic_sampling_pages_by_offset(dremio: FakeDremio) -> None:
    dremio.rows_for = lambda _sql: [{"id": n, "email": f"u{n}@example.com"} for n in range(10)]
    source = DremioSource(_recipe(sampling={"strategy": "AUTOMATIC", "rows_per_page": 10}))
    ref = dataset_ref(("Samples", "samples.dremio.com", "customers.json"))

    source._automatic_fetch(ref)

    assert dremio.sql[-1].endswith('"customers.json" LIMIT 10 OFFSET 0')
    # A dataset has no key to tell new rows from old, so it is paged by
    # position and wraps. A full page means there may be more: the next run
    # resumes after it.
    assert source.current_sampling_cursor() == {
        "tables": {ref.raw_id: {"mode": "wrap", "offset": 10}}
    }


async def test_dremio_fetch_content_pages_batches_for_all_strategy(dremio: FakeDremio) -> None:
    rows = [{"id": n, "email": f"user{n}@example.com"} for n in range(12)]
    dremio.rows_for = lambda sql: [{"cnt": 12}] if "COUNT(*)" in sql else rows
    source = DremioSource(_recipe(sampling={"strategy": "ALL", "rows_per_page": 10}))
    asset_hash = _hash("Samples", "samples.dremio.com", "customers.json")

    pages = [page async for page in source.fetch_content_pages(asset_hash)]

    assert len(pages) == 12
    assert "row_12:" in pages[-1][1]
    scans = [sql for sql in dremio.sql if "COUNT(*)" not in sql]
    # One bounded job for the whole table, not one query per page.
    assert scans == [
        'SELECT "id", "email" FROM "Samples"."samples.dremio.com"."customers.json" '
        "LIMIT 500000 OFFSET 0"
    ]


def test_cursor_reads_a_full_scan_in_bounded_windows(dremio: FakeDremio) -> None:
    table = [{"id": n} for n in range(12)]

    def _rows(sql: str) -> list[dict[str, Any]]:
        limit, offset = (int(part) for part in sql.split("LIMIT ")[1].split(" OFFSET "))
        return table[offset : offset + limit]

    dremio.rows_for = _rows
    cursor = DremioCursor(DremioClient(api_url="http://dremio/api/v3", token="t"))

    cursor.execute_windowed("SELECT id FROM t", window=5)

    assert cursor.description is not None and cursor.description[0][0] == "id"
    # fetchmany fills its page across a window boundary rather than coming up
    # short, which the caller would read as the end of the table.
    assert [row[0] for row in cursor.fetchmany(8)] == list(range(8))
    assert [row[0] for row in cursor.fetchall()] == [8, 9, 10, 11]
    assert dremio.sql == [
        "SELECT id FROM t LIMIT 5 OFFSET 0",
        "SELECT id FROM t LIMIT 5 OFFSET 5",
        "SELECT id FROM t LIMIT 5 OFFSET 10",
    ]


def test_cursor_pages_job_results_500_rows_at_a_time(dremio: FakeDremio) -> None:
    dremio.rows_for = lambda _sql: [{"id": n} for n in range(1200)]
    cursor = DremioCursor(DremioClient(api_url="http://dremio/api/v3", token="t"))

    cursor.execute("SELECT id FROM t")

    assert len(cursor.fetchall()) == 1200
    assert [(offset, limit) for _job, offset, limit in dremio.result_requests] == [
        (0, 500),
        (500, 500),
        (1000, 500),
    ]


def test_cursor_exposes_columns_for_an_empty_result(dremio: FakeDremio) -> None:
    dremio.rows_for = lambda _sql: []
    cursor = DremioCursor(DremioClient(api_url="http://dremio/api/v3", token="t"))

    cursor.execute("SELECT one FROM t")

    assert cursor.description is not None and [c[0] for c in cursor.description] == ["one"]
    assert cursor.fetchall() == []


def test_a_failed_job_raises_instead_of_reading_as_empty(dremio: FakeDremio) -> None:
    dremio.failing_sql = "missing_table"
    cursor = DremioCursor(DremioClient(api_url="http://dremio/api/v3", token="t"))

    with pytest.raises(DremioApiError, match="Table not found"):
        cursor.execute("SELECT * FROM missing_table")


def test_render_sql_inlines_only_safe_literals() -> None:
    assert render_sql("SELECT 1 LIMIT %s OFFSET %s", [10, 20]) == "SELECT 1 LIMIT 10 OFFSET 20"
    assert render_sql("WHERE a = %s", ["Tam O'Shanter"]) == "WHERE a = 'Tam O''Shanter'"
    with pytest.raises(DremioApiError, match="placeholder"):
        render_sql("LIMIT %s", [1, 2])
    with pytest.raises(DremioApiError, match="Unsupported SQL parameter"):
        render_sql("WHERE a = %s", [object()])


def test_nested_values_are_serialized_as_json() -> None:
    source = DremioSource(_recipe())

    assert source._serialize_cell({"city": "Larkhaven", "tags": ["a"]}) == (
        '{"city": "Larkhaven", "tags": ["a"]}'
    )
    assert source._serialize_cell(None) == "null"
