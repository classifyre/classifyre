import base64
import hashlib
import json
from typing import Any
from urllib.parse import urljoin, urlsplit, urlunsplit


def hash_id(source_type: str, raw_id: str) -> str:
    """
    Hash the raw ID into a base64 encoded string with a source type prefix.
    Note: This is actually just base64 encoding for reversibility in debugging,
    not a cryptographic hash.
    """
    final_raw_id = f"{source_type}_#_{raw_id}"
    return base64.urlsafe_b64encode(final_raw_id.encode()).decode().rstrip("=")


def unhash_id(hashed_id: str) -> str:
    """
    Unhash the base64 encoded ID back to its raw form.
    """
    # Add padding back if necessary
    padding = len(hashed_id) % 4
    if padding:
        hashed_id += "=" * (4 - padding)
    return base64.urlsafe_b64decode(hashed_id.encode()).decode()


def calculate_checksum(data: dict[str, Any]) -> str:
    """
    Calculate a stable SHA-256 checksum for a dictionary.
    Keys are sorted to ensure stability.
    """
    # Use sort_keys=True for stability
    dump = json.dumps(data, sort_keys=True, default=str).encode("utf-8")
    return hashlib.sha256(dump).hexdigest()


def normalize_http_url(url: str, *, base_url: str | None = None) -> str | None:
    """
    Normalize an HTTP(S) URL for stable hashing and deduplication.

    - Resolves relative URLs against `base_url` when provided
    - Rejects non-HTTP(S) schemes (mailto:, tel:, javascript:, data:, etc.)
    - Removes URL fragments
    """
    candidate = (url or "").strip()
    if not candidate:
        return None

    lowered = candidate.lower()
    if lowered.startswith(("#", "javascript:", "mailto:", "tel:", "data:")):
        return None

    if base_url:
        candidate = urljoin(f"{base_url.rstrip('/')}/", candidate)

    parsed = urlsplit(candidate)
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc:
        return None

    path = parsed.path or "/"
    return urlunsplit(
        (
            parsed.scheme.lower(),
            parsed.netloc.lower(),
            path,
            parsed.query,
            "",
        )
    )


def hash_url(url: str, *, base_url: str | None = None) -> str:
    """
    URL hash strategy: opaque SHA-256 digest of normalized absolute URL.
    """
    normalized = normalize_http_url(url, base_url=base_url)
    if not normalized:
        raise ValueError(f"Invalid URL for hash: {url}")
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
    return f"url_sha256:{digest}"
