"""ODBC connection strings: building one from a recipe, and reading one back.

Shared by the ODBC source (a scan, through ``pyodbc``) and the SQL query job
(through DuckDB's ``odbc_scanner``), so both reach the database with exactly the
same string. Nothing here imports a driver.
"""

from __future__ import annotations

from typing import Any

#: Default port of the engines whose objects another connector can also name.
_DEFAULT_PORTS = {"postgres": 5432, "mysql": 3306, "mssql": 1433, "oracle": 1521}

#: ``SQL_DBMS_NAME`` of a driver -> the URN platform of that engine's own source.
URN_PLATFORMS = {
    "postgresql": "postgres",
    "mysql": "mysql",
    "mariadb": "mysql",
    "microsoft sql server": "mssql",
}


def attribute_value(value: str) -> str:
    """A value as an ODBC connection-string attribute.

    Braces protect ``;`` and ``=`` in it (a password); a ``}`` inside braces is
    doubled. Plain values stay bare, which is what every driver accepts.
    """
    if value and not any(ch in value for ch in ";{}=") and value == value.strip():
        return value
    return "{" + value.replace("}", "}}") + "}"


def _server_attributes(
    driver: str, host: str, port: int | None, database: str | None
) -> list[tuple[str, str]]:
    """The server fields as the attribute names the driver family reads.

    ODBC has no standard names for them: every vendor spells them its own way.
    The families below are the ones whose spelling differs from the common
    ``Server`` / ``Port`` / ``Database``; anything else is written that way, and
    a driver that disagrees takes the rest through ``optional.connection.attributes``
    (which come last, so they win).
    """
    name = driver.lower()
    pairs: list[tuple[str, str]]
    if "sql server" in name or "native client" in name:
        # Microsoft's drivers take the port after a comma.
        pairs = [("Server", f"{host},{port}" if port else host)]
    elif "oracle" in name:
        pairs = [
            (
                "DBQ",
                f"//{host}:{port or 1521}/{database}" if database else f"//{host}:{port or 1521}",
            )
        ]
        return pairs
    elif "db2" in name:
        pairs = [("HostName", host)]
        if port:
            pairs.append(("Port", str(port)))
    elif "teradata" in name:
        pairs = [("DBCName", host)]
    elif "hdbodbc" in name or "hana" in name:
        pairs = [("ServerNode", f"{host}:{port}" if port else host)]
    elif "exasol" in name:
        pairs = [("EXAHOST", f"{host}:{port}" if port else host)]
    elif any(key in name for key in ("spark", "hive", "impala", "databricks", "drill")):
        pairs = [("Host", host)]
        if port:
            pairs.append(("Port", str(port)))
    elif "vertica" in name:
        pairs = [("Servername", host)]
        if port:
            pairs.append(("Port", str(port)))
    else:
        pairs = [("Server", host)]
        if port:
            pairs.append(("Port", str(port)))
    if database:
        pairs.append(("Database", database))
    return pairs


def build_connection_string(recipe: dict[str, Any]) -> str:
    """The recipe's connection string: its fields, extra attributes, ``UID`` / ``PWD``."""
    required = recipe.get("required") if isinstance(recipe.get("required"), dict) else {}
    masked = recipe.get("masked") if isinstance(recipe.get("masked"), dict) else {}
    optional = recipe.get("optional") if isinstance(recipe.get("optional"), dict) else {}
    connection = optional.get("connection") if isinstance(optional.get("connection"), dict) else {}

    parts: list[str] = []
    if str(required.get("connection_string") or "").strip():
        parts.append(str(required["connection_string"]).strip().rstrip(";"))
    elif str(required.get("dsn") or "").strip():
        parts.append(f"DSN={attribute_value(str(required['dsn']).strip())}")
    elif str(required.get("driver") or "").strip() and str(required.get("host") or "").strip():
        driver = str(required["driver"]).strip()
        parts.append("Driver={" + driver.replace("}", "}}") + "}")
        port = required.get("port")
        for key, value in _server_attributes(
            driver,
            str(required["host"]).strip(),
            int(port) if isinstance(port, (int, float, str)) and str(port).strip() else None,
            str(required.get("database") or "").strip() or None,
        ):
            parts.append(f"{key}={attribute_value(value)}")
    else:
        raise ValueError("The ODBC source needs a driver and host, a DSN, or a connection string.")

    for attribute in connection.get("attributes") or []:
        if isinstance(attribute, dict) and str(attribute.get("name") or "").strip():
            parts.append(
                f"{str(attribute['name']).strip()}={attribute_value(str(attribute.get('value') or ''))}"
            )
    username, password = masked.get("username"), masked.get("password")
    if username not in (None, ""):
        parts.append(f"UID={attribute_value(str(username))}")
    if password not in (None, ""):
        parts.append(f"PWD={attribute_value(str(password))}")
    return ";".join(parts) + ";"


def parse_attributes(connection_string: str) -> dict[str, str]:
    """``{KEY: value}`` (keys upper-cased) from a connection string."""
    attributes: dict[str, str] = {}
    key: list[str] = []
    value: list[str] = []
    in_key = True
    braced = False
    index = 0
    text = connection_string
    while index <= len(text):
        char = text[index] if index < len(text) else ";"
        index += 1
        if braced:
            if char == "}":
                if index < len(text) and text[index] == "}":
                    value.append("}")
                    index += 1
                else:
                    braced = False
            else:
                value.append(char)
            continue
        if in_key:
            if char == "=":
                in_key = False
            elif char == ";":
                key = []
            else:
                key.append(char)
        elif char == "{" and not "".join(value).strip():
            braced = True
            value = []
        elif char == ";":
            name = "".join(key).strip().upper()
            if name:
                attributes[name] = "".join(value).strip()
            key, value, in_key = [], [], True
        else:
            value.append(char)
    return attributes


def endpoint_label(connection_string: str) -> str:
    """What the source is called in logs and errors: the DSN, or ``host:port``."""
    attributes = parse_attributes(connection_string)
    if attributes.get("DSN"):
        return attributes["DSN"]
    host, port = host_and_port(attributes)
    if host:
        return f"{host}:{port}" if port else host
    return attributes.get("DRIVER") or "odbc"


def host_and_port(attributes: dict[str, str]) -> tuple[str | None, int | None]:
    """The server a connection string names, in the spellings drivers use."""
    host = None
    port: int | None = None
    for key in (
        "SERVER",
        "HOST",
        "HOSTNAME",
        "DATA SOURCE",
        "ADDRESS",
        "SERVERNAME",
        "DBCNAME",
        "SERVERNODE",
        "EXAHOST",
    ):
        if attributes.get(key):
            host = attributes[key]
            break
    if host is None and attributes.get("DBQ", "").startswith("//"):
        # Oracle's easy connect: //host:port/service
        host = attributes["DBQ"][2:].split("/", 1)[0]
    if host is None:
        return None, None
    # SQL Server: ``tcp:host,1433``; others: ``host:1433``.
    host = host.removeprefix("tcp:").removeprefix("TCP:")
    for sep in (",", ":"):
        if sep in host:
            name, _, tail = host.rpartition(sep)
            if tail.isdigit():
                host, port = name, int(tail)
                break
    explicit = attributes.get("PORT")
    if explicit and explicit.isdigit():
        port = int(explicit)
    return host.strip().lower() or None, port


def urn_endpoint(connection_string: str, platform: str) -> str | None:
    """``host:port`` as the engine's own source writes it, or None.

    None when the string names no server (a DSN hides it), so no URN is made
    rather than one that could stitch two unrelated systems together.
    """
    host, port = host_and_port(parse_attributes(connection_string))
    if not host:
        return None
    port = port or _DEFAULT_PORTS.get(platform)
    return f"{host}:{port}" if port else None
