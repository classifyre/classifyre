"""The SQL gate: one read-only SELECT over the tables a person may read.

Ported from the payload-access proof of concept and made stricter in one way:
the allowlist is of *tables* (``source.schema.table``), not of sources, because
access in Classifyre can be given to one table of a source.

Everything not explicitly allowed is refused: statements other than SELECT,
write CTEs, table functions (``read_parquet``, ``query``, ``postgres_query``…),
functions outside :data:`SAFE_FUNCTIONS` (``getenv``, ``current_setting``…),
system catalogs, and any table name that is not in the allowlist — the hidden
``__src_*`` attachments included.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field

import sqlglot
from sqlglot import exp

# Fail closed: an unknown function is refused. Widening this list is a policy
# decision (docs/prd/DQ-data-query.md §6), not a convenience fix. Names are
# SQLGlot's canonical names (``sql_name()``) or, for functions SQLGlot does not
# model, the name as typed.
SAFE_FUNCTIONS = frozenset(
    """
ABS ACOS ASIN ATAN ATAN2 CBRT CEIL CEILING COS COT DEGREES EXP FLOOR LN LOG LOG10 LOG2
MOD PI POW POWER RADIANS ROUND SIGN SIN SQRT TAN TRUNC
SUM AVG MIN MAX COUNT COUNT_IF BOOL_AND BOOL_OR STDDEV STDDEV_POP STDDEV_SAMP
VARIANCE VAR_POP VAR_SAMP MEDIAN MODE QUANTILE QUANTILE_CONT QUANTILE_DISC
PERCENTILE_CONT PERCENTILE_DISC APPROX_DISTINCT APPROX_QUANTILE ARG_MAX ARG_MIN
ANY_VALUE FIRST LAST CORR COVAR_POP COVAR_SAMP HISTOGRAM
COALESCE NULLIF IFNULL NVL IF CASE CAST TRY_CAST EXTRACT DATE_TRUNC TIMESTAMP_TRUNC
DATE_ADD DATE_SUB DATE_DIFF DATEDIFF DATE_PART DATEPART DATE_FORMAT
CURRENT_DATE CURRENT_TIMESTAMP CURRENT_TIME NOW AGE MAKE_DATE MAKE_TIMESTAMP
YEAR QUARTER MONTH WEEK DAY DAY_OF_WEEK DAY_OF_YEAR DAY_OF_MONTH HOUR MINUTE SECOND
DAYOFWEEK DAYOFYEAR DAYOFMONTH WEEKOFYEAR EPOCH EPOCH_MS LAST_DAY
DATE TIME TIMESTAMP TS_OR_DS_TO_DATE TS_OR_DS_ADD TIME_TO_STR TIME_STR_TO_TIME
TIME_STR_TO_DATE STR_TO_TIME STR_TO_DATE TIMESTAMP_OR_DS_TO_DATE UNIX_TO_TIME TIME_TO_UNIX
STRFTIME STRPTIME TRY_STRPTIME TO_TIMESTAMP GENERATE_DATE_ARRAY
LOWER UPPER LENGTH CHAR_LENGTH CHARACTER_LENGTH OCTET_LENGTH SUBSTRING SUBSTR LEFT RIGHT
TRIM LTRIM RTRIM LPAD RPAD REPEAT REVERSE INITCAP POSITION STRPOS INSTR
CONCAT CONCAT_WS REPLACE TRANSLATE REGEXP_REPLACE REGEXP_LIKE REGEXP_MATCHES
REGEXP_EXTRACT REGEXP_EXTRACT_ALL REGEXP_SPLIT RLIKE LIKE ILIKE GLOB_MATCH
STARTS_WITH ENDS_WITH CONTAINS SPLIT SPLIT_PART STRING_SPLIT FORMAT PRINTF
MD5 SHA1 SHA2 SHA256 HASH LEVENSHTEIN JARO_WINKLER_SIMILARITY
ROW_NUMBER RANK DENSE_RANK PERCENT_RANK CUME_DIST LAG LEAD FIRST_VALUE LAST_VALUE
NTH_VALUE NTILE
GREATEST LEAST ARRAY ARRAY_AGG LIST LISTAGG STRING_AGG GROUP_CONCAT ARRAY_SIZE
ARRAY_LENGTH ARRAY_CONTAINS ARRAY_TO_STRING ARRAY_JOIN UNNEST EXPLODE FLATTEN
LIST_VALUE LIST_EXTRACT ARRAY_EXTRACT STRUCT STRUCT_EXTRACT BRACKET
JSON_EXTRACT JSON_EXTRACT_SCALAR JSON_EXTRACT_PATH_TEXT JSON_EXTRACT_STRING
JSON_VALUE JSON_OBJECT JSON_ARRAY JSON_KEYS PARSE_JSON TO_JSON JSONB_EXTRACT
JSON_TYPE JSON_ARRAY_LENGTH JSON_FORMAT
TYPEOF ISNAN ISINF IS_NAN IS_INF
AND OR NOT XOR IN BETWEEN EXISTS ANY ALL
""".split()
)


class QueryRefusedError(ValueError):
    """The SQL was refused before anything ran; ``code`` says why."""

    def __init__(self, message: str, code: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class TableName:
    """``source.schema.table`` as the person types it, lower-cased."""

    source: str
    schema: str
    table: str

    @classmethod
    def of(cls, source: str, schema: str, table: str) -> TableName:
        return cls(source.lower(), schema.lower(), table.lower())

    def __str__(self) -> str:
        return f"{self.source}.{self.schema}.{self.table}"


@dataclass
class Validated:
    """What may run: the rewritten SQL and the tables it reads."""

    sql: str
    tables: set[TableName] = field(default_factory=set)


_FORBIDDEN_NODES: tuple[type, ...] = (
    exp.Into,
    exp.Command,
    exp.Lock,
    exp.DDL,
    exp.DML,
)


def _function_name(node: exp.Func) -> str:
    if isinstance(node, exp.Anonymous):
        return str(node.name).upper()
    return str(node.sql_name()).upper()


def _cte_names(tree: exp.Expression) -> set[str]:
    return {cte.alias_or_name.lower() for cte in tree.find_all(exp.CTE) if cte.alias_or_name}


def validate(sql: str, allowed: Iterable[TableName], dialect: str = "duckdb") -> Validated:
    """Check ``sql`` against the allowlist and return it rewritten for DuckDB.

    Raises :class:`QueryRefusedError` with a stable ``code`` the UI can show:
    ``invalid_sql``, ``select_only``, ``function_not_allowed``,
    ``table_name_required`` or ``table_not_available``.
    """
    allowed_set = set(allowed)
    text = (sql or "").strip()
    if not text:
        raise QueryRefusedError("Write a SELECT statement.", "invalid_sql")
    try:
        statements = [s for s in sqlglot.parse(text, read=dialect) if s is not None]
    except (sqlglot.errors.SqlglotError, ValueError) as exc:
        raise QueryRefusedError(
            f"The SQL cannot be parsed: {_first_line(exc)}", "invalid_sql"
        ) from None
    if len(statements) != 1:
        raise QueryRefusedError("Run one statement at a time.", "select_only")
    tree = statements[0]
    if not isinstance(tree, (exp.Select, exp.SetOperation)):
        raise QueryRefusedError("Only SELECT statements can run here.", "select_only")

    for node in tree.walk():
        if isinstance(node, _FORBIDDEN_NODES):
            raise QueryRefusedError("Only read-only SELECT statements can run here.", "select_only")
        if isinstance(node, exp.Func):
            name = _function_name(node)
            if name not in SAFE_FUNCTIONS:
                raise QueryRefusedError(
                    f"The function {name} is not available here.", "function_not_allowed"
                )
            if isinstance(node.parent, exp.Dot):
                raise QueryRefusedError(
                    "Qualified function names are not available here.", "function_not_allowed"
                )
        if isinstance(node, exp.Star) and (node.args.get("rename") or node.args.get("replace")):
            raise QueryRefusedError("SELECT * REPLACE and RENAME are not supported.", "select_only")

    ctes = _cte_names(tree)
    referenced: set[TableName] = set()
    for table in list(tree.find_all(exp.Table)):
        if not isinstance(table.this, exp.Identifier):
            # read_parquet(...), query(...), 's3://…', generate_series(...):
            # anything in FROM that is not a plain name.
            raise QueryRefusedError(
                "Only tables can be read here, not files or table functions.",
                "function_not_allowed",
            )
        name = str(table.name)
        if not table.catalog and not table.db and name.lower() in ctes:
            continue
        if not (table.catalog and table.db):
            raise QueryRefusedError(
                f"Name tables in full, as source.schema.table (got '{table.sql(dialect='duckdb')}').",
                "table_name_required",
            )
        candidate = TableName.of(str(table.catalog), str(table.db), name)
        if candidate not in allowed_set:
            raise QueryRefusedError(
                f"The table {candidate} does not exist or you cannot query it.",
                "table_not_available",
            )
        referenced.add(candidate)
        table.set("catalog", exp.to_identifier(candidate.source, quoted=True))
        table.set("db", exp.to_identifier(candidate.schema, quoted=True))
        table.set("this", exp.to_identifier(candidate.table, quoted=True))

    return Validated(sql=tree.sql(dialect="duckdb"), tables=referenced)


def _first_line(exc: BaseException) -> str:
    text = str(exc).strip().splitlines()
    return text[0][:300] if text else type(exc).__name__
