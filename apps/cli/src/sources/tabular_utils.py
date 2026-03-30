from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from ..models.generated_single_asset_scan_results import Location


def _truncate_text(value: str, max_chars: int) -> str:
    if len(value) <= max_chars:
        return value
    if max_chars <= 3:
        return value[:max_chars]
    return f"{value[: max_chars - 3]}..."


@dataclass(frozen=True)
class TabularCellMatch:
    row_index: int
    column_name: str
    row: dict[str, str]


def format_tabular_sample_content(
    *,
    scope_label: str,
    scope_value: str,
    strategy: Any,
    rows: list[tuple[Any, ...]],
    column_names: list[str],
    serialize_cell: Any,
    max_total_chars: int,
    include_column_names: bool,
    object_type: str | None = None,
    raw_metadata: dict[str, Any] | None = None,
) -> tuple[str, str]:
    lines = [
        f"{scope_label}={scope_value}",
    ]
    if object_type:
        lines.append(f"object_type={object_type}")
    lines.extend(
        [
            f"sampling_strategy={strategy}",
            f"sampled_rows={len(rows)}",
            "",
        ]
    )

    serialized_rows: list[dict[str, str]] = []
    for index, row in enumerate(rows, start=1):
        serialized_row: dict[str, str] = {}
        lines.append(f"row_{index}:")
        for column_name, cell in zip(column_names, row, strict=False):
            serialized = str(serialize_cell(cell))
            serialized_row[column_name] = serialized
            if include_column_names:
                rendered_lines = serialized.splitlines() or [""]
                first_line, *continuation_lines = rendered_lines
                lines.append(f"  {column_name}: {first_line}")
                for continuation_line in continuation_lines:
                    lines.append(f"    {continuation_line}")
            else:
                lines.append(f"  {serialized}")
        lines.append("")
        serialized_rows.append(serialized_row)

    raw_payload = dict(raw_metadata or {})
    raw_payload["strategy"] = str(strategy)
    raw_payload["rows"] = serialized_rows
    if object_type:
        raw_payload["object_type"] = object_type

    text_content = _truncate_text("\n".join(lines).rstrip(), max_total_chars)
    return json.dumps(raw_payload, ensure_ascii=False), text_content


def build_tabular_location(
    *,
    raw_content: str | None,
    matched_content: str,
    base_path: str,
    primary_key_columns: list[str] | None = None,
    row_index: int | None = None,
    column_name: str | None = None,
) -> Location:
    match = _find_tabular_cell_match(
        raw_content,
        matched_content,
        row_index=row_index,
        column_name=column_name,
    )
    if match is None:
        return Location(path=base_path)

    path = base_path
    pk_columns = primary_key_columns or []
    pk_parts = [f"{column}={match.row[column]}" for column in pk_columns if column in match.row]
    if pk_parts:
        path += f", {', '.join(pk_parts)}"
    else:
        path += f", row {match.row_index}"

    return Location(path=path, description=f"column {match.column_name}")


def _find_tabular_cell_match(
    raw_content: str | None,
    matched_content: str,
    *,
    row_index: int | None = None,
    column_name: str | None = None,
) -> TabularCellMatch | None:
    if not raw_content or not matched_content:
        return None

    try:
        payload = json.loads(raw_content)
    except (TypeError, json.JSONDecodeError):
        return None

    rows = payload.get("rows")
    if not isinstance(rows, list):
        return None

    normalized_match = _normalize_for_match(matched_content)
    substring_match: TabularCellMatch | None = None
    normalized_substring_match: TabularCellMatch | None = None
    for current_row_index, raw_row in enumerate(rows, start=1):
        if row_index is not None and current_row_index != row_index:
            continue
        if not isinstance(raw_row, dict):
            continue

        row = {str(key): "" if value is None else str(value) for key, value in raw_row.items()}
        for current_column_name, value in row.items():
            if column_name is not None and current_column_name != column_name:
                continue
            if value == matched_content:
                return TabularCellMatch(
                    row_index=current_row_index,
                    column_name=current_column_name,
                    row=row,
                )
            if substring_match is None and matched_content in value:
                substring_match = TabularCellMatch(
                    row_index=current_row_index,
                    column_name=current_column_name,
                    row=row,
                )
            normalized_value = _normalize_for_match(value)
            if normalized_value == normalized_match:
                return TabularCellMatch(
                    row_index=current_row_index,
                    column_name=current_column_name,
                    row=row,
                )
            if normalized_substring_match is None and normalized_match in normalized_value:
                normalized_substring_match = TabularCellMatch(
                    row_index=current_row_index,
                    column_name=current_column_name,
                    row=row,
                )

    return substring_match or normalized_substring_match


def _normalize_for_match(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()
