from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, ClassVar
from urllib.parse import quote, urlparse

from ...graph.edges import FlowType, Method, Ref, flow
from ...models.generated_input import (
    DremioInput,
    DremioMaskedPassword,
    DremioMaskedToken,
    DremioOptionalConnection,
    DremioOptionalExtraction,
    DremioOptionalScope,
    DremioRequiredCloud,
    SamplingConfig,
)
from ...models.generated_single_asset_scan_results import AssetType as OutputAssetType
from ...utils.sql_lineage import table_paths_from_sql
from ...utils.urn import Urn, UrnError
from ..tabular_base import BaseTabularSource
from ..tabular_utils import TableRef, ViewLineage
from .client import (
    JOB_ROW_WINDOW,
    DremioApiError,
    DremioClient,
    cloud_api_url,
    cloud_app_url,
)

logger = logging.getLogger(__name__)

# Schemas Dremio serves from every context without them being catalog objects.
_SYSTEM_ROOTS = {"sys", "information_schema"}

# After this many lineage-graph calls fail without one ever succeeding, the
# endpoint is treated as absent for the rest of the run (Community Edition has
# none) instead of being asked once per view.
_GRAPH_FAILURES_BEFORE_GIVING_UP = 3


@dataclass(frozen=True)
class DremioTableRef(TableRef):
    """A dataset addressed by its full catalog path.

    Dremio names are folder paths of any depth, and a single path element may
    itself contain dots (``Samples."samples.dremio.com"."zips.json"``). Folding
    the middle of the path into one ``schema`` string would make the name
    impossible to quote again, so the path is kept whole and is what identity,
    hashing and SQL are built from. ``database``/``schema``/``table`` are filled
    in as well because that is what the shared asset metadata speaks.
    """

    path: tuple[str, ...] = ()

    @property
    def fqn_parts(self) -> tuple[str, ...]:
        return self.path or super().fqn_parts


def dataset_ref(path: tuple[str, ...], object_type: str = "TABLE") -> DremioTableRef:
    return DremioTableRef(
        database=path[0],
        schema=".".join(path[1:-1]) or None,
        table=path[-1],
        object_type=object_type,
        path=path,
    )


def parse_path(text: str) -> tuple[str, ...]:
    """Split a dotted path the way Dremio's SQL does.

    Dots separate elements except inside double quotes, where ``""`` is a
    literal quote: ``Samples."samples.dremio.com"`` is two elements.
    """
    parts: list[str] = []
    current: list[str] = []
    quoted = False
    index = 0
    while index < len(text):
        char = text[index]
        if char == '"':
            if quoted and text[index + 1 : index + 2] == '"':
                current.append('"')
                index += 1
            else:
                quoted = not quoted
        elif char == "." and not quoted:
            parts.append("".join(current))
            current = []
        else:
            current.append(char)
        index += 1
    parts.append("".join(current))
    return tuple(part.strip() for part in parts if part.strip())


def _fold(path: tuple[str, ...]) -> tuple[str, ...]:
    # Dremio resolves names case-insensitively.
    return tuple(part.lower() for part in path)


def _starts_with(path: tuple[str, ...], prefix: tuple[str, ...]) -> bool:
    return len(path) >= len(prefix) and path[: len(prefix)] == prefix


class DremioSource(BaseTabularSource):
    source_type = "dremio"

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ) -> None:
        super().__init__(recipe, source_id, runner_id)
        self.config = DremioInput.model_validate(recipe)
        self.runner_id = runner_id or "local-run"
        self._validate_auth_configuration()

        self._client = self._build_client()
        # Filled in during discovery; everything below is keyed by folded path.
        self._roots: dict[str, dict[str, Any]] = {}
        self._dataset_ids: dict[tuple[str, ...], str] = {}
        self._entities: dict[tuple[str, ...], dict[str, Any]] = {}
        self._source_systems: dict[str, tuple[str, dict[str, Any]]] = {}
        self._discovered = 0
        self._graph_available: bool | None = None
        self._graph_failures = 0

    # ── Auth ─────────────────────────────────────────────────────────────

    def _is_cloud(self) -> bool:
        return isinstance(self.config.required, DremioRequiredCloud)

    def _validate_auth_configuration(self) -> None:
        # Where Dremio runs and how to sign in are chosen separately, and one
        # combination does not exist: Dremio Cloud has no passwords to sign in
        # with, only access tokens.
        if self._is_cloud() and not isinstance(self.config.masked, DremioMaskedToken):
            raise ValueError(
                "Dremio Cloud signs in with a personal access token (masked.token), "
                "not a username and password"
            )

    def _base_url(self) -> str:
        """The address a self-hosted Dremio is opened at, without a trailing slash."""
        required = self.config.required
        if isinstance(required, DremioRequiredCloud):
            raise ValueError("Dremio Cloud has no base URL; use the project endpoints")
        return str(required.url).rstrip("/")

    def _build_client(self) -> DremioClient:
        connection = self._connection_options()
        common: dict[str, Any] = {
            "verify_ssl": connection.verify_ssl is not False,
            "timeout_seconds": int(connection.timeout_seconds or 30),
            "query_timeout_seconds": int(connection.query_timeout_seconds or 300),
        }
        required = self.config.required
        masked = self.config.masked
        if isinstance(required, DremioRequiredCloud):
            assert isinstance(masked, DremioMaskedToken)
            return DremioClient(
                api_url=cloud_api_url(str(required.region.value), required.project_id),
                token=masked.token.strip(),
                **common,
            )
        base_url = self._base_url()
        if isinstance(masked, DremioMaskedPassword):
            return DremioClient(
                api_url=f"{base_url}/api/v3",
                login_url=f"{base_url}/apiv2/login",
                username=masked.username,
                password=masked.password,
                **common,
            )
        return DremioClient(api_url=f"{base_url}/api/v3", token=masked.token.strip(), **common)

    # ── Identity ─────────────────────────────────────────────────────────

    @property
    def _source_label(self) -> str:
        return "Dremio"

    def _asset_type_value(self) -> str:
        type_value = self.config.type
        return type_value.value if hasattr(type_value, "value") else str(type_value)

    def _sampling(self) -> SamplingConfig:
        return self.config.sampling

    # ── Config accessors ─────────────────────────────────────────────────

    def _connection_options(self) -> DremioOptionalConnection:
        if self.config.optional and self.config.optional.connection:
            return self.config.optional.connection
        return DremioOptionalConnection()

    def _scope_options(self) -> DremioOptionalScope:
        if self.config.optional and self.config.optional.scope:
            return self.config.optional.scope
        return DremioOptionalScope()

    def _extraction_options(self) -> DremioOptionalExtraction:
        if self.config.optional and self.config.optional.extraction:
            return self.config.optional.extraction
        return DremioOptionalExtraction()

    def _include_filters(self) -> list[tuple[str, ...]]:
        return self._path_filters(self._scope_options().include_paths)

    def _exclude_filters(self) -> list[tuple[str, ...]]:
        return self._path_filters(self._scope_options().exclude_paths)

    @staticmethod
    def _path_filters(entries: list[str] | None) -> list[tuple[str, ...]]:
        return [folded for entry in entries or [] if entry and (folded := _fold(parse_path(entry)))]

    # ── Connection (SQL over REST) ───────────────────────────────────────

    def _connect(self, database: str | None = None) -> Any:
        del database  # one endpoint serves every source and space
        return self._client.connect()

    def _is_connection_alive(self, conn: Any) -> bool:
        return bool(getattr(conn, "open", False))

    # ── Dialect hooks ────────────────────────────────────────────────────

    def _quote_identifier(self, identifier: str) -> str:
        return '"' + identifier.replace('"', '""') + '"'

    def _table_select_fqn(self, table_ref: TableRef) -> str:
        return self._table_fqn(table_ref)

    def _random_order_expr(self) -> str:
        return "RANDOM()"

    def _supports_nulls_last(self) -> bool:
        return True

    def _query_primary_key_columns(self, table_ref: TableRef) -> list[str]:
        # Dremio has no enforced keys and no constraint catalog to ask; without
        # this the base would spend a failing job per table finding that out.
        del table_ref
        return []

    @staticmethod
    def _cursor_execute(cursor: Any, query: str) -> list[str]:
        # Only the full-scan path comes through here, with an unbounded SELECT.
        cursor.execute_windowed(query, JOB_ROW_WINDOW)
        return [column[0] for column in cursor.description or []]

    def _serialize_cell(self, value: Any) -> str:
        if isinstance(value, (dict, list)):
            # STRUCT and LIST columns arrive as parsed JSON; a Python repr of
            # them would put single quotes around every key a detector reads.
            return json.dumps(value, ensure_ascii=False, default=str)
        return super()._serialize_cell(value)

    # ── Scope ────────────────────────────────────────────────────────────

    def _is_excluded(self, folded: tuple[str, ...]) -> bool:
        return any(_starts_with(folded, prefix) for prefix in self._exclude_filters())

    def _may_contain_included(self, folded: tuple[str, ...]) -> bool:
        """Whether a container is inside, or on the way to, an included path."""
        includes = self._include_filters()
        if not includes:
            return True
        return any(
            _starts_with(folded, prefix) or _starts_with(prefix, folded) for prefix in includes
        )

    def _dataset_in_scope(self, folded: tuple[str, ...]) -> bool:
        if self._is_excluded(folded):
            return False
        includes = self._include_filters()
        return not includes or any(_starts_with(folded, prefix) for prefix in includes)

    # ── Discovery (catalog tree) ─────────────────────────────────────────
    #
    # ``INFORMATION_SCHEMA."TABLES"`` would list every dataset in one query, but
    # it reports the folder path as a single dotted string, and nothing in that
    # string says whether ``samples.dremio.com`` is one folder or three. The
    # catalog API returns each path as a list, and it is also where dataset ids
    # (needed for lineage), view SQL and source types come from — so the tree
    # is walked instead, pruned by scope so an unrelated source is never opened.

    def _load_roots(self) -> dict[str, dict[str, Any]]:
        if not self._roots:
            for entry in self._client.list_roots():
                path = entry.get("path")
                entity_id = entry.get("id")
                if not (isinstance(path, list) and path and isinstance(entity_id, str)):
                    continue
                self._roots[str(path[0]).lower()] = entry
        return self._roots

    def _resolve_databases(self) -> list[str]:
        names: list[str] = []
        for folded_name, entry in self._load_roots().items():
            name = str(entry["path"][0])
            container_type = str(entry.get("containerType") or "").upper()
            if container_type == "HOME" and not self._scope_options().include_home_spaces:
                continue
            if self._is_excluded((folded_name,)) or not self._may_contain_included((folded_name,)):
                continue
            names.append(name)
        names.sort(key=str.lower)
        logger.info("Found %d Dremio source(s)/space(s) in scope", len(names))
        return names

    def _iter_tables(self) -> list[TableRef]:
        self._discovered = 0
        return super()._iter_tables()

    def _list_tables_for_database(self, database: str) -> list[TableRef]:
        root = self._load_roots().get(database.lower())
        if root is None:
            return []
        scope = self._scope_options()
        limit = int(scope.table_limit) if scope.table_limit else None

        tables: list[TableRef] = []
        pending: list[str] = [str(root["id"])]
        while pending:
            if self._aborted or (limit is not None and self._discovered >= limit):
                break
            container_id = pending.pop()
            try:
                entity = self._client.catalog_entity(container_id)
            except DremioApiError as exc:
                # One unreadable folder (a source that is down, a permission
                # gap) should cost that folder, not the rest of the tree.
                logger.warning("Skipping Dremio container %s: %s", container_id, exc)
                continue
            self._remember_source_system(database, entity)

            for child in entity.get("children") or []:
                if not isinstance(child, dict):
                    continue
                child_id = child.get("id")
                raw_path = child.get("path")
                if not (isinstance(child_id, str) and isinstance(raw_path, list) and raw_path):
                    continue
                path = tuple(str(part) for part in raw_path)
                folded = _fold(path)
                kind = str(child.get("type") or "").upper()

                if kind == "CONTAINER":
                    if not self._is_excluded(folded) and self._may_contain_included(folded):
                        pending.append(child_id)
                    continue
                # FILE entries are unpromoted files: Dremio cannot query them
                # until someone formats them into a table, so there is nothing
                # to sample.
                if kind != "DATASET" or len(path) < 2:
                    continue

                is_view = str(child.get("datasetType") or "").upper() == "VIRTUAL"
                if is_view and scope.include_views is False:
                    continue
                if not is_view and scope.include_tables is False:
                    continue
                if not self._dataset_in_scope(folded):
                    continue

                self._dataset_ids[folded] = child_id
                tables.append(dataset_ref(path, "VIEW" if is_view else "TABLE"))
                self._discovered += 1
                if limit is not None and self._discovered >= limit:
                    break

        logger.info("Dremio %s: found %d dataset(s)", database, len(tables))
        return tables

    def _remember_source_system(self, root_name: str, entity: dict[str, Any]) -> None:
        if str(entity.get("entityType") or "").lower() != "source":
            return
        source_type = entity.get("type")
        config = entity.get("config")
        if isinstance(source_type, str) and source_type:
            self._source_systems[root_name.lower()] = (
                source_type.upper(),
                config if isinstance(config, dict) else {},
            )

    # ── Dataset details ──────────────────────────────────────────────────

    def _dataset_entity(self, table_ref: TableRef) -> dict[str, Any]:
        """The catalog record for one dataset: its columns, and a view's SQL."""
        folded = _fold(table_ref.table_key)
        cached = self._entities.get(folded)
        if cached is not None:
            return cached
        dataset_id = self._dataset_ids.get(folded)
        try:
            if dataset_id:
                entity = self._client.catalog_entity(dataset_id)
            else:
                # Reached from a stored asset id rather than this run's
                # discovery, so the path is all there is to go on.
                entity = self._client.catalog_entity_by_path(table_ref.table_key)
                if isinstance(entity.get("id"), str):
                    self._dataset_ids[folded] = entity["id"]
        except DremioApiError as exc:
            logger.debug("Could not read Dremio dataset %s: %s", table_ref.display_name, exc)
            entity = {}
        self._entities[folded] = entity
        return entity

    @staticmethod
    def _field_type(field: dict[str, Any]) -> str:
        type_info = field.get("type")
        if not isinstance(type_info, dict):
            return ""
        name = str(type_info.get("name") or "")
        precision, scale = type_info.get("precision"), type_info.get("scale")
        if name == "DECIMAL" and precision is not None:
            return f"DECIMAL({precision},{scale or 0})"
        return name

    def _available_column_types(self, table_ref: TableRef) -> dict[str, str]:
        types: dict[str, str] = {}
        for field in self._dataset_entity(table_ref).get("fields") or []:
            if isinstance(field, dict) and isinstance(field.get("name"), str):
                types[field["name"]] = self._field_type(field)
        return types

    def _available_columns(self, table_ref: TableRef) -> list[str]:
        return list(self._available_column_types(table_ref))

    # ── Cross-system identity ────────────────────────────────────────────

    def _urn_authority(self) -> str:
        required = self.config.required
        if isinstance(required, DremioRequiredCloud):
            # Every Dremio Cloud tenant shares the same hostnames; the project
            # is the only thing that tells two of them apart.
            return required.project_id
        # Host without the port: REST, JDBC and Flight each listen on their own,
        # and another tool naming this Dremio will have recorded a different one.
        return urlparse(self._base_url()).hostname or self._base_url()

    # ── View lineage ─────────────────────────────────────────────────────

    def _collect_view_lineage(self, tables: list[TableRef]) -> list[ViewLineage]:
        """What each view reads from.

        Dremio answers this itself through the lineage graph, but only on
        Enterprise and Cloud. Community Edition has no such endpoint, so there
        the view's own SQL is parsed instead — a weaker answer, and marked as
        one. Either way the SQL travels with the edge, which is where column
        detail is recovered from.
        """
        if not self._extraction_options().include_view_lineage:
            return []

        known = {_fold(t.table_key): t.table_key for t in tables}
        results: list[ViewLineage] = []
        for table_ref in tables:
            if self._aborted:
                break
            if table_ref.object_type != "VIEW":
                continue
            entity = self._dataset_entity(table_ref)
            sql = entity.get("sql") if isinstance(entity.get("sql"), str) else None

            # Left unset when Dremio named the upstreams itself: the edge is
            # then credited the same way every other catalog-backed view is.
            method: Method | None = None
            upstreams = self._graph_parents(table_ref)
            if upstreams is None:
                method = Method.SQL_PARSED
                upstreams = self._parents_from_sql(sql, entity.get("sqlContext"), known)

            view_key = table_ref.table_key
            # Paths from the graph are already spelled as the catalog spells
            # them; SQL-parsed ones were mapped onto that spelling above.
            resolved = tuple(
                sorted(
                    {known.get(_fold(up), up) for up in upstreams if _fold(up) != _fold(view_key)}
                )
            )
            if resolved:
                results.append(ViewLineage(view_key, resolved, sql, method))
        return results

    def _graph_parents(self, table_ref: TableRef) -> list[tuple[str, ...]] | None:
        """Direct upstreams from Dremio's lineage graph, or None to fall back."""
        if self._graph_available is False:
            return None
        dataset_id = self._dataset_ids.get(_fold(table_ref.table_key))
        if not dataset_id:
            return None
        try:
            graph = self._client.lineage_graph(dataset_id)
        except DremioApiError as exc:
            self._graph_failures += 1
            if (
                self._graph_available is None
                and self._graph_failures >= _GRAPH_FAILURES_BEFORE_GIVING_UP
            ):
                self._graph_available = False
                logger.info(
                    "Dremio lineage graph is not available (%s); reading view SQL instead", exc
                )
            return None
        self._graph_available = True
        parents: list[tuple[str, ...]] = []
        for parent in graph.get("parents") or []:
            path = parent.get("path") if isinstance(parent, dict) else None
            if isinstance(path, list) and len(path) >= 2:
                parents.append(tuple(str(part) for part in path))
        return parents

    def _parents_from_sql(
        self,
        sql: str | None,
        sql_context: Any,
        known: dict[tuple[str, ...], tuple[str, ...]],
    ) -> list[tuple[str, ...]]:
        """Resolve the tables a view's SQL names the way Dremio would.

        A name is looked up relative to the view's saved context first and from
        the root second. When neither is a dataset this scan saw, the name is
        still kept — as an absolute path if it starts at a real source or
        space, otherwise under the context — so the edge can bind later if that
        part of the catalog is ever scanned.
        """
        if not sql:
            return []
        context = (
            tuple(str(part) for part in sql_context if part)
            if isinstance(sql_context, list)
            else ()
        )
        roots = set(self._load_roots())

        parents: list[tuple[str, ...]] = []
        for parts in table_paths_from_sql(sql, dialect="dremio"):
            if parts[0].lower() in _SYSTEM_ROOTS:
                continue
            relative = (*context, *parts) if context else None
            if relative and _fold(relative) in known:
                parents.append(relative)
            elif _fold(parts) in known:
                parents.append(parts)
            elif len(parts) >= 2 and parts[0].lower() in roots:
                parents.append(parts)
            elif relative:
                parents.append(relative)
            # else: a bare name with no context to place it under. Guessing a
            # location for it would draw lineage to a table that may not exist.
        return parents

    # ── Source lineage (the system behind a Dremio source) ───────────────
    #
    # A table in a Dremio source is not Dremio's data: it is a PostgreSQL or
    # Snowflake table read in place. Without an edge to that table, lineage
    # would dead-end at Dremio and a scan of the database itself would show a
    # second, unrelated copy. The database's own connector names its tables by
    # URN, so the same URN is built here from the source's connection settings
    # and the two halves meet whichever is scanned first.

    #: Dremio source type -> (URN platform, name parts the platform's own
    #: connector uses, source setting that supplies the database when Dremio
    #: does not show it as a folder).
    _SOURCE_PLATFORMS: ClassVar[dict[str, tuple[str, int, str | None]]] = {
        "POSTGRES": ("postgres", 3, "databaseName"),  # source.schema.table
        "MYSQL": ("mysql", 2, None),  # source.database.table
        "MSSQL": ("mssql", 3, "database"),  # source[.database].schema.table
        "ORACLE": ("oracle", 3, "instance"),  # source.schema.table
        "SNOWFLAKE": ("snowflake", 3, None),  # source.database.schema.table
    }

    def _external_urn(self, table_ref: TableRef) -> str | None:
        """The URN the underlying system's own connector writes for this table."""
        system = self._source_systems.get(table_ref.database.lower())
        if system is None:
            return None
        source_type, config = system
        mapping = self._SOURCE_PLATFORMS.get(source_type)
        if mapping is None:
            return None
        platform, name_parts, database_key = mapping

        host = str(config.get("hostname") or "").strip()
        if not host:
            # Without a host there is nothing to scope the name to, and a URN
            # scoped to the wrong host would stitch two unrelated systems.
            return None
        if platform == "snowflake":
            authority = host.removesuffix(".snowflakecomputing.com")
        else:
            port = config.get("port")
            authority = f"{host}:{port}" if port else host

        name = table_ref.table_key[1:]
        if len(name) == name_parts - 1 and database_key:
            # The database is fixed by the connection rather than shown as a
            # folder: always for PostgreSQL and Oracle, optionally for MSSQL.
            database = str(config.get(database_key) or "").strip()
            if not database:
                return None
            name = (database, *name)
        if len(name) != name_parts:
            # Deeper or shallower than this kind of source lays tables out, so
            # there is no confident name to give it.
            return None
        try:
            return str(Urn.of(platform, authority, *name))
        except UrnError:
            return None

    def _emit_relationship_edges(
        self,
        tables: list[TableRef],
        table_hash_by_key: dict[tuple[str, ...], str],
        fk_links: dict[tuple[str, ...], set[tuple[str, ...]]],
    ) -> None:
        super()._emit_relationship_edges(tables, table_hash_by_key, fk_links)
        if not self._extraction_options().include_source_lineage:
            return
        for table_ref in tables:
            if table_ref.object_type != "TABLE":
                continue
            asset_hash = table_hash_by_key.get(table_ref.table_key)
            urn = self._external_urn(table_ref)
            if not (asset_hash and urn):
                continue
            self.add_edge(
                flow(
                    upstream=Ref.urn(urn),
                    downstream=Ref.asset(asset_hash),
                    # Read in place, not copied: the same relationship a view
                    # has to its base table.
                    type=FlowType.VIEW,
                    method=Method.SYSTEM_CATALOG,
                )
            )

    # ── Asset details ────────────────────────────────────────────────────

    def _output_asset_type(self, table_ref: TableRef) -> OutputAssetType:
        del table_ref
        return OutputAssetType.TABLE

    def _container_kind(self, table_ref: TableRef) -> str | None:
        root = self._roots.get(table_ref.database.lower())
        kind = str((root or {}).get("containerType") or "").upper()
        return kind or None

    def _build_external_url(self, table_ref: TableRef) -> str:
        required = self.config.required
        if isinstance(required, DremioRequiredCloud):
            ui_url = cloud_app_url(str(required.region.value), required.project_id)
        else:
            ui_url = self._base_url()
        section = {"SPACE": "space", "HOME": "home"}.get(
            self._container_kind(table_ref) or "", "source"
        )
        root, *rest = table_ref.table_key
        dotted = ".".join(self._quote_identifier(part) for part in rest)
        return (
            f"{ui_url}/{section}/{quote(self._quote_identifier(root), safe='')}"
            f"/{quote(dotted, safe='')}"
        )

    def _extra_asset_metadata(self, table_ref: TableRef) -> dict[str, Any]:
        entity = self._dataset_entity(table_ref)
        extra: dict[str, Any] = {
            "object_type": str(entity.get("type") or "")
            or ("VIRTUAL_DATASET" if table_ref.object_type == "VIEW" else "PHYSICAL_DATASET"),
        }
        container_kind = self._container_kind(table_ref)
        if container_kind:
            extra["container_type"] = container_kind
        system = self._source_systems.get(table_ref.database.lower())
        if system:
            extra["source_system"] = system[0]
        data_format = entity.get("format")
        if isinstance(data_format, dict) and data_format.get("type"):
            extra["format"] = str(data_format["type"])
        return extra

    def _finding_base_path(self, table_ref: TableRef) -> str:
        return table_ref.display_name

    # ── Test connection ──────────────────────────────────────────────────

    def test_connection(self) -> dict[str, Any]:
        logger.info("Testing connection to Dremio...")
        result: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "source_type": self.recipe.get("type"),
        }
        try:
            roots = self._resolve_databases()
            with self._connect().cursor() as cursor:
                cursor.execute("SELECT 1")
                cursor.fetchone()
            product = "Dremio Cloud" if self._is_cloud() else "Dremio"
            result["status"] = "SUCCESS"
            result["message"] = (
                f"Successfully connected to {product}. Sources and spaces in scope: {len(roots)}."
            )
        except Exception as exc:
            result["status"] = "FAILURE"
            result["message"] = f"Failed to connect to Dremio: {exc}"
        return result

    # ── Parse table ref from asset ID ────────────────────────────────────

    def _table_ref_from_parts(self, parts: list[str]) -> TableRef | None:
        if len(parts) >= 3 and parts[0].upper() == self._asset_type_value().upper():
            parts = parts[1:]
        if len(parts) < 2 or not all(parts):
            return None
        return dataset_ref(tuple(parts))

    # ── Lifecycle ────────────────────────────────────────────────────────

    def abort(self) -> None:
        super().abort()
        self._client.abort()

    def cleanup(self) -> None:
        super().cleanup()
        self._client.close()
