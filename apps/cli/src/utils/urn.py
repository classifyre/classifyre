"""Platform-qualified names, so two connectors can name the same object.

An asset's ``hash`` is scoped to the connector that produced it: ``hash_id``
mixes in ``source_type``, and ``Asset`` is unique per ``(source_id, hash)``.
That is the right identity for ingestion and useless for lineage, because the
whole point of lineage is that a Tableau workbook names a Snowflake table it
does not own and has never scanned.

A URN is that second name, derived only from what the *platform* calls the
object, so two connectors independently produce the same string for the same
table. Normalization is the entire contract: one side writing
``PROD.PUBLIC.ORDERS`` and the other ``prod.public.orders`` means no edge ever
stitches. Every builder therefore goes through the same folding rules, and the
rules live here rather than in the connectors so there is one place to be wrong.

``apps/api/src/graph/urn.ts`` is the mirror of this file. The two must agree
character for character -- a test in each language pins the same table of cases.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

__all__ = ["CasePolicy", "Urn", "UrnError", "normalize_urn", "normalize_urn_or_none"]


logger = logging.getLogger(__name__)


class UrnError(ValueError):
    """Raised when a URN cannot be parsed, or is missing a required part."""


class CasePolicy(StrEnum):
    """How a platform folds identifiers that were not quoted."""

    UPPER = "upper"
    LOWER = "lower"
    PRESERVE = "preserve"


@dataclass(frozen=True)
class _Platform:
    """Folding rules for one platform.

    ``authority`` is the account / host / workspace / bucket; ``path`` is
    everything after it. They fold differently more often than not: an S3
    bucket name is case-insensitive while the key after it is byte-exact.
    """

    name: str
    authority_case: CasePolicy = CasePolicy.LOWER
    path_case: CasePolicy = CasePolicy.PRESERVE
    default_port: int | None = None


# Registered platforms, plus the aliases that mean the same thing. Anything not
# listed still works -- it just gets the conservative default (lowercase the
# authority, leave the path alone), which never merges two objects that are
# actually distinct.
_PLATFORMS: dict[str, _Platform] = {}
_ALIASES: dict[str, str] = {}


def _register(platform: _Platform, *aliases: str) -> None:
    _PLATFORMS[platform.name] = platform
    for alias in aliases:
        _ALIASES[alias] = platform.name


# Warehouses that fold unquoted identifiers to UPPER.
_register(_Platform("snowflake", path_case=CasePolicy.UPPER))
_register(_Platform("oracle", path_case=CasePolicy.UPPER, default_port=1521))

# Engines that fold to lower, or match case-insensitively.
_register(_Platform("postgres", path_case=CasePolicy.LOWER, default_port=5432), "postgresql")
_register(_Platform("mysql", path_case=CasePolicy.LOWER, default_port=3306), "mariadb")
_register(_Platform("mssql", path_case=CasePolicy.LOWER, default_port=1433), "sqlserver")
_register(_Platform("databricks", path_case=CasePolicy.LOWER))
_register(_Platform("hive", path_case=CasePolicy.LOWER, default_port=10000))
_register(_Platform("iceberg", path_case=CasePolicy.LOWER))
_register(_Platform("delta", path_case=CasePolicy.LOWER), "delta_lake")
_register(_Platform("sqlite", path_case=CasePolicy.LOWER))

# Object stores and the rest: the path is byte-exact.
_register(_Platform("s3"), "s3a", "s3n", "s3_compatible_storage")
_register(_Platform("gcs"), "gs", "google_cloud_storage")
_register(_Platform("abfss"), "azure", "abfs", "wasbs", "azure_blob_storage")
_register(_Platform("bigquery"))
_register(_Platform("tableau"))
_register(_Platform("powerbi"))
_register(_Platform("kafka"))
_register(_Platform("file"))

_DEFAULT_PLATFORM = _Platform("", authority_case=CasePolicy.LOWER, path_case=CasePolicy.PRESERVE)


def _fold(value: str, policy: CasePolicy) -> str:
    if policy is CasePolicy.UPPER:
        return value.upper()
    if policy is CasePolicy.LOWER:
        return value.lower()
    return value


def _encode(segment: str) -> str:
    """Escape only what would break parsing: the separator and the escape itself.

    Deliberately not ``urllib.parse.quote``. An S3 key is the common case and
    percent-encoding every space and colon in it would produce URNs nobody can
    read in a graph label, for no gain -- these strings are compared, not
    fetched.
    """
    return segment.replace("%", "%25").replace("/", "%2F")


def _decode(segment: str) -> str:
    return segment.replace("%2F", "/").replace("%2f", "/").replace("%25", "%")


@dataclass(frozen=True)
class Urn:
    """A parsed, already-normalized platform-qualified name.

    Build one with a platform helper (:meth:`snowflake`, :meth:`s3`, ...) rather
    than the constructor, so folding is applied. ``str(urn)`` is the canonical
    form -- that string, not the object, is what travels to the API.
    """

    platform: str
    authority: str
    path: tuple[str, ...]

    def __str__(self) -> str:
        tail = "/".join(_encode(part) for part in self.path)
        return (
            f"{self.platform}://{self.authority}/{tail}"
            if tail
            else f"{self.platform}://{self.authority}"
        )

    # -- construction --------------------------------------------------------

    @classmethod
    def of(cls, platform: str, authority: str, *path: str) -> Urn:
        """Build and normalize a URN for any platform, registered or not.

        Empty path segments are dropped rather than rejected: callers assemble
        these from optional catalog/schema parts, and a missing middle should
        degrade to a shorter name instead of raising mid-scan.
        """
        name = (platform or "").strip().lower()
        if not name:
            raise UrnError("URN platform is required")
        name = _ALIASES.get(name, name)
        rules = _PLATFORMS.get(name, _DEFAULT_PLATFORM)

        auth = _fold((authority or "").strip(), rules.authority_case)
        if not auth:
            raise UrnError(f"URN authority is required (platform {name!r})")
        auth = _strip_default_port(auth, rules.default_port)

        parts = tuple(
            _fold(str(part).strip().strip("/"), rules.path_case)
            for part in path
            if part is not None and str(part).strip().strip("/")
        )
        return cls(platform=name, authority=auth, path=parts)

    @classmethod
    def parse(cls, value: str | Urn) -> Urn:
        """Parse a URN string, applying the same folding a builder would.

        Parsing normalizes, so a URN that arrives from a notebook or a config
        file is held to the same rules as one this process built.
        """
        if isinstance(value, Urn):
            return value
        raw = (value or "").strip()
        if "://" not in raw:
            raise UrnError(f"Not a URN (expected 'platform://authority/...'): {raw!r}")
        platform, _, rest = raw.partition("://")
        authority, _, tail = rest.partition("/")
        segments = [_decode(part) for part in tail.split("/")] if tail else []
        return cls.of(platform, authority, *segments)

    # -- platform helpers ----------------------------------------------------
    #
    # One per family we emit lineage for. They exist so a connector never has to
    # remember the segment order, which is the other half of "both sides agree".

    @classmethod
    def snowflake(cls, account: str, database: str, schema: str, table: str) -> Urn:
        return cls.of("snowflake", account, database, schema, table)

    @classmethod
    def databricks(cls, workspace: str, catalog: str, schema: str, table: str) -> Urn:
        return cls.of("databricks", workspace, catalog, schema, table)

    @classmethod
    def bigquery(cls, project: str, dataset: str, table: str) -> Urn:
        return cls.of("bigquery", project, dataset, table)

    @classmethod
    def postgres(
        cls, host: str, port: int | str | None, database: str, schema: str, table: str
    ) -> Urn:
        return cls.of("postgres", _host_port(host, port), database, schema, table)

    @classmethod
    def mysql(cls, host: str, port: int | str | None, database: str, table: str) -> Urn:
        return cls.of("mysql", _host_port(host, port), database, table)

    @classmethod
    def mssql(
        cls, host: str, port: int | str | None, database: str, schema: str, table: str
    ) -> Urn:
        return cls.of("mssql", _host_port(host, port), database, schema, table)

    @classmethod
    def oracle(
        cls, host: str, port: int | str | None, service: str, schema: str, table: str
    ) -> Urn:
        return cls.of("oracle", _host_port(host, port), service, schema, table)

    @classmethod
    def hive(cls, host: str, port: int | str | None, database: str, table: str) -> Urn:
        return cls.of("hive", _host_port(host, port), database, table)

    @classmethod
    def s3(cls, bucket: str, key: str) -> Urn:
        return cls.of("s3", bucket, *str(key or "").split("/"))

    @classmethod
    def gcs(cls, bucket: str, key: str) -> Urn:
        return cls.of("gcs", bucket, *str(key or "").split("/"))

    @classmethod
    def abfss(cls, account: str, container: str, key: str) -> Urn:
        return cls.of("abfss", account, container, *str(key or "").split("/"))

    @classmethod
    def tableau(cls, server: str, site: str, *path: str) -> Urn:
        return cls.of("tableau", server, site, *path)

    @classmethod
    def powerbi(cls, tenant: str, workspace: str, *path: str) -> Urn:
        return cls.of("powerbi", tenant, workspace, *path)

    @classmethod
    def kafka(cls, bootstrap: str, topic: str) -> Urn:
        return cls.of("kafka", bootstrap, topic)


def _host_port(host: str, port: int | str | None) -> str:
    """``host:port``, or bare host when no port was configured."""
    hostname = (host or "").strip().strip("/")
    if not hostname:
        raise UrnError("URN host is required")
    if port in (None, "", 0):
        return hostname
    return f"{hostname}:{port}"


def _strip_default_port(authority: str, default_port: int | None) -> str:
    """Drop an explicitly written default port.

    One connector reads the port from config and writes ``:5432``; another takes
    the driver default and writes nothing. Without this they never stitch.
    """
    if default_port is None or not authority.endswith(f":{default_port}"):
        return authority
    return authority[: -len(f":{default_port}")]


def normalize_urn(value: str | Urn) -> str:
    """Canonical string form of a URN, for comparison and storage."""
    return str(Urn.parse(value))


def normalize_urn_or_none(value: Any) -> str | None:
    """Normalize a URN written by someone we do not control, or give up quietly.

    Notebook authors type these by hand. One unusable string should cost that
    asset its cross-system identity, not fail the scan.
    """
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return normalize_urn(value)
    except UrnError:
        logger.debug("Ignoring unparseable URN %r", value)
        return None
