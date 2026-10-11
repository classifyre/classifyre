"""The text around a match.

A finding is a value and where it was found. What the value means is in the
words either side of it: "IBAN DE89..." in a payment reminder and the same
number in a list of test fixtures are two different pieces of evidence, and
nothing downstream can tell them apart from the value alone. The API ranks a
finding by its surrounding text, embeds the match together with it, and shows
it to the reviewer next to the match.

No detector returns that text: each answers with the value and, at most, a
position. So it is cut here, once, from the content the detectors were given,
for every finding that does not already carry it.
"""

from __future__ import annotations

import re

from ..models.generated_single_asset_scan_results import DetectionResult

# Characters kept on each side. The ranking treats 320 characters of evidence
# as a full context, so a match of ordinary length with both sides reaches it.
CONTEXT_CHARS = 160

# A match longer than this is already a passage (an LLM detector quoting a
# paragraph); text around it would be the next paragraph, not its context.
MAX_MATCH_CHARS = 600

_CHAR_RANGE = re.compile(r"character range (\d+)-(\d+)")


def _locate(content: str, matched: str, finding: DetectionResult, start_at: int) -> int:
    """Offset of this finding's match in `content`, or -1."""
    description = getattr(finding.location, "description", None) if finding.location else None
    stated = _CHAR_RANGE.search(description) if isinstance(description, str) else None
    if stated:
        start, end = int(stated.group(1)), int(stated.group(2))
        if content[start:end] == matched:
            return start
    found = content.find(matched, start_at)
    return found if found >= 0 else content.find(matched)


def _before(content: str, start: int) -> str | None:
    cut = max(0, start - CONTEXT_CHARS)
    text = content[cut:start]
    # A window that opens in the middle of a word starts with half of it.
    if cut > 0 and not content[cut - 1].isspace() and text[:1].strip():
        parts = text.split(None, 1)
        text = parts[1] if len(parts) > 1 else ""
    return " ".join(text.split()) or None


def _after(content: str, end: int) -> str | None:
    cut = min(len(content), end + CONTEXT_CHARS)
    text = content[end:cut]
    if cut < len(content) and not content[cut].isspace() and text[-1:].strip():
        parts = text.rsplit(None, 1)
        text = parts[0] if len(parts) > 1 else ""
    return " ".join(text.split()) or None


def attach_context(findings: list[DetectionResult], content: str) -> list[DetectionResult]:
    """`findings` with the text around each match filled in where it was missing.

    A value that occurs several times is matched to its occurrences in order,
    so two findings of one value do not both get the first one's surroundings.
    A match that cannot be found in the content (a detector that reports a
    normalised value, or a verdict rather than a quotation) is left as it is.
    """
    if not content:
        return findings
    cursor: dict[str, int] = {}
    out: list[DetectionResult] = []
    for finding in findings:
        matched = finding.matched_content
        if (
            finding.context_before
            or finding.context_after
            or not matched
            or len(matched) > MAX_MATCH_CHARS
        ):
            out.append(finding)
            continue
        start = _locate(content, matched, finding, cursor.get(matched, 0))
        if start < 0:
            out.append(finding)
            continue
        end = start + len(matched)
        cursor[matched] = end
        out.append(
            finding.model_copy(
                update={
                    "context_before": _before(content, start),
                    "context_after": _after(content, end),
                }
            )
        )
    return out
