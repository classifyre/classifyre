"""MySQL through DuckDB's ``mysql`` scanner, read-only, connected by a secret."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import Any

from ...utils.duckdb_engine import quote_identifier, sql_literal
from .base import BindingError, QueryBinding, SourceContext, TableLocation, endpoint_label


def system_ca_bundle() -> str | None:
    """The system's trusted roots as one PEM file, as the scan's TLS uses them."""
    try:
        import certifi

        return str(certifi.where())
    except ImportError:  # pragma: no cover - certifi ships with requests
        pass
    for path in (
        "/etc/ssl/certs/ca-certificates.crt",
        "/etc/pki/tls/certs/ca-bundle.crt",
        "/etc/ssl/cert.pem",
    ):
        if Path(path).exists():
            return path
    return None


class MySQLBinding(QueryBinding):
    tier = "native"

    def __init__(self, source: SourceContext) -> None:
        super().__init__(source)
        self._attached: dict[str, str] = {}
        self._ca_path: str | None = None

    def label(self) -> str | None:
        return endpoint_label(self.source, "mysql")

    def relation(self, conn: Any, location: TableLocation) -> str:
        database, table = self.require(location, "database", "table")
        alias = self._attached.get(database)
        if alias is None:
            self.load(conn, "mysql")
            required, masked = self.source.section("required"), self.source.section("masked")
            try:
                port = int(str(required.get("port") or "").strip())
            except (TypeError, ValueError):
                raise BindingError(
                    "The MySQL source has no usable port: check its configuration."
                ) from None
            alias = f"{self.source.hidden}_{len(self._attached)}"
            # Connect through a DuckDB *secret*, not a connection string. The
            # scanner's DSN parser takes values literally, quotes included
            # (`ssl_mode='verify_ca'` answers "got ''verify_ca''", a quoted
            # password is refused as wrong), so nothing with a space, a quote
            # or a backslash in it (a password, a path) can be passed safely.
            # Secret fields are SQL literals, escaped like any other.
            fields = [
                "TYPE mysql",
                f"HOST {sql_literal(str(required.get('host') or ''))}",
                f"PORT {port}",
                f"DATABASE {sql_literal(database)}",
                f"USER {sql_literal(str(masked.get('username') or ''))}",
                f"PASSWORD {sql_literal(str(masked.get('password') or ''))}",
                *self._tls_fields(),
            ]
            secret = quote_identifier(f"{alias}_secret")
            conn.execute(f"CREATE OR REPLACE SECRET {secret} ({', '.join(fields)})")
            conn.execute(
                f"ATTACH '' AS {quote_identifier(alias)} (TYPE mysql, SECRET {secret}, READ_ONLY)"
            )
            self._attached[database] = alias
        # The scanner names its schemas after the server's databases.
        return ".".join(quote_identifier(part) for part in (alias, database, table))

    def _tls_fields(self) -> list[str]:
        """The secret's TLS fields, never weaker than what the scan does.

        The scan (``MySQLSource._build_ssl_kwargs``) always uses TLS unless
        the mode is *Disabled*, and verifies the certificate for *Verify CA* /
        *Verify identity* against the source's CA, else the system roots.
        So *Required* is sent as ``required`` with or without a CA (the
        scanner's default, ``preferred``, would fall back to plain text when
        the server, or someone between, offers no TLS), and the verifying
        modes always get a CA file: the source's, else the system bundle.
        The CA is a *file* to DuckDB, so the PEM is written to a private temp
        file kept until :meth:`close` — parallel scan threads reconnect.
        """
        mode = str(self.source.connection_option("ssl_mode") or "").upper()
        if mode == "DISABLED":
            return ["SSL_MODE 'disabled'"]
        if mode in ("VERIFY_CA", "VERIFY_IDENTITY"):
            ca_path = self._ca_file() or system_ca_bundle()
            fields = [f"SSL_MODE '{mode.lower()}'"]
            if ca_path:
                fields.append(f"SSL_CA {sql_literal(ca_path)}")
            return fields
        if mode == "REQUIRED":
            ca_path = self._ca_file()
            fields = ["SSL_MODE 'required'"]
            if ca_path:
                fields.append(f"SSL_CA {sql_literal(ca_path)}")
            return fields
        return []

    def _ca_file(self) -> str | None:
        """The source's CA certificate as a file path, or None without one."""
        pem = str(self.source.section("masked").get("ssl_ca") or "")
        if not pem.strip():
            return None
        if self._ca_path is None:
            # Same normalisation as the scan: escaped newlines and CRLF.
            text = pem.replace("\\n", "\n").replace("\r\n", "\n").strip() + "\n"
            fd, path = tempfile.mkstemp(prefix="classifyre-mysql-ca-", suffix=".pem")
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                handle.write(text)
            self._ca_path = path
        return self._ca_path

    def close(self) -> None:
        if self._ca_path is not None:
            try:
                Path(self._ca_path).unlink()
            except OSError:  # pragma: no cover - best effort
                pass
            self._ca_path = None
