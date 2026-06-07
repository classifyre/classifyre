"""Email (IMAP) source.

Connects to any IMAP mailbox (Gmail, Outlook/M365, Yahoo, Fastmail, self-hosted)
using a username + app password. Each message becomes an ``email`` asset; every
attachment becomes a separate ``attachment`` asset linked from the parent email's
``links``. Email body text routes through text detectors; attachment bytes are
served via ``fetch_content_bytes`` so the file parser / OCR pipeline applies the
full detector suite to them.
"""

import hashlib
import logging
from collections.abc import AsyncGenerator
from datetime import UTC, date, datetime
from typing import Any

from ...models.generated_input import EmailInput, SamplingStrategy
from ...models.generated_single_asset_scan_results import (
    AssetType as OutputAssetType,
)
from ...models.generated_single_asset_scan_results import (
    DetectionResult,
    Location,
    SingleAssetScanResults,
)
from ...utils.content_extraction import html_to_text
from ...utils.file_metadata import extract_file_metadata
from ...utils.file_parser import resolve_mime_type
from ...utils.hashing import hash_id
from ..base import BaseSource
from ..dependencies import require_module

logger = logging.getLogger(__name__)

_TABULAR_MIME_TYPES = {
    "text/csv",
    "text/tab-separated-values",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/parquet",
    "application/vnd.apache.parquet",
}

# MIME types whose text can be extracted (by file_parser) and so should route
# through text detectors. Everything else binary falls back to BINARY.
_TEXT_MIME_PREFIXES = ("text/",)
_TEXT_MIME_TYPES = {
    "application/json",
    "application/xml",
    "text/xml",
    "application/xhtml+xml",
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/html",
    "text/markdown",
}


class EmailSource(BaseSource):
    source_type = "email"

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ):
        super().__init__(recipe, source_id=source_id, runner_id=runner_id)
        self.config = EmailInput.model_validate(recipe)
        self.runner_id = runner_id or "local-run"

        self.host = self.config.required.host
        self.port = int(self.config.required.port or 993)
        self.username = self.config.masked.username
        self.password = self.config.masked.password

        connection = self.config.optional.connection if self.config.optional else None
        self.use_ssl = (
            True if connection is None or connection.use_ssl is None else connection.use_ssl
        )
        self.timeout_seconds = (
            int(connection.timeout_seconds) if connection and connection.timeout_seconds else 30
        )

        scope = self.config.optional.scope if self.config.optional else None
        self.folders = list(scope.folders) if scope and scope.folders else ["INBOX"]
        self.since_date = scope.since_date if scope else None
        self.before_date = scope.before_date if scope else None
        self.unseen_only = bool(scope.unseen_only) if scope else False
        self.include_attachments = (
            True
            if scope is None or scope.include_attachments is None
            else scope.include_attachments
        )
        self.max_attachment_size_bytes = scope.max_attachment_size_bytes if scope else None

        # Caches populated during extract_raw; served to the detector pipeline.
        self._asset_content_cache: dict[str, tuple[str, str]] = {}
        self._attachment_bytes_by_hash: dict[str, tuple[bytes, str]] = {}
        self._attachment_locator_by_hash: dict[str, tuple[str, str, int]] = {}
        self._email_locator_by_hash: dict[str, tuple[str, str]] = {}
        self._hash_by_url: dict[str, str] = {}
        self._attachment_name_by_hash = {}
        # Phase 1: tracks (email_hash → [attachment_hash, ...]) for relationship emission.
        self._email_attachment_links: dict[str, list[str]] = {}

        self._mailbox: Any = None

        logger.info("Initialized Email source for %s@%s:%s", self.username, self.host, self.port)

    # ------------------------------------------------------------------
    # Connection helpers
    # ------------------------------------------------------------------
    def _imap_tools(self) -> Any:
        return require_module(
            "imap_tools",
            "Email source",
            ["email"],
            detail="IMAP ingestion requires the 'imap-tools' library.",
        )

    def _connect(self, initial_folder: str = "INBOX") -> Any:
        mod = self._imap_tools()
        if self.use_ssl:
            mailbox = mod.MailBox(self.host, self.port, timeout=self.timeout_seconds)
        else:
            mailbox = mod.MailBoxUnencrypted(self.host, self.port, timeout=self.timeout_seconds)
        mailbox.login(self.username, self.password, initial_folder=initial_folder)
        return mailbox

    def _build_criteria(self, mod: Any) -> Any:
        kwargs: dict[str, Any] = {}
        if self.unseen_only:
            kwargs["seen"] = False
        since = self._parse_date(self.since_date)
        if since:
            kwargs["date_gte"] = since
        before = self._parse_date(self.before_date)
        if before:
            kwargs["date_lt"] = before
        if not kwargs:
            return "ALL"
        return mod.AND(**kwargs)

    @staticmethod
    def _parse_date(value: str | None) -> date | None:
        if not value:
            return None
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
        except ValueError:
            try:
                return date.fromisoformat(value[:10])
            except ValueError:
                logger.warning("Could not parse email date filter: %s", value)
                return None

    def test_connection(self) -> dict[str, Any]:
        logger.info("Testing IMAP connection to %s:%s...", self.host, self.port)
        result: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "source_type": self.recipe.get("type"),
        }
        try:
            mailbox = self._connect(self.folders[0] if self.folders else "INBOX")
            try:
                mailbox.folder.list()
            finally:
                mailbox.logout()
            result["status"] = "SUCCESS"
            result["message"] = "Successfully connected and authenticated to the IMAP mailbox."
        except Exception as e:
            result["status"] = "FAILURE"
            result["message"] = f"Failed to connect: {e!s}"
            logger.error("IMAP connection test failed: %s", e)
        return result

    # ------------------------------------------------------------------
    # Extraction
    # ------------------------------------------------------------------
    async def extract_raw(self) -> AsyncGenerator[list[SingleAssetScanResults], None]:
        if self._aborted:
            return

        mod = self._imap_tools()
        sampling = self.config.sampling
        strategy = sampling.strategy
        limit = None if strategy == SamplingStrategy.ALL else int(sampling.rows_per_page or 100)
        reverse = strategy in (SamplingStrategy.LATEST, SamplingStrategy.RANDOM)
        criteria = self._build_criteria(mod)

        self._mailbox = self._connect(self.folders[0] if self.folders else "INBOX")
        pending: list[SingleAssetScanResults] = []
        total = 0

        try:
            for folder in self.folders:
                if self._aborted or (limit is not None and total >= limit):
                    break
                try:
                    self._mailbox.folder.set(folder)
                except Exception as e:
                    logger.warning("Skipping folder %s: %s", folder, e)
                    continue

                fetch_limit = None if limit is None else max(limit - total, 0)
                logger.info("Fetching messages from folder '%s' (limit=%s)", folder, fetch_limit)
                for msg in self._mailbox.fetch(
                    criteria,
                    mark_seen=False,
                    bulk=self.BATCH_SIZE,
                    reverse=reverse,
                    limit=fetch_limit,
                ):
                    if self._aborted:
                        break
                    try:
                        assets = self._message_to_assets(msg, folder)
                    except Exception as e:
                        logger.error(
                            "Failed to transform message uid=%s: %s", getattr(msg, "uid", "?"), e
                        )
                        continue
                    for asset in assets:
                        pending.append(asset)
                        while len(pending) >= self.BATCH_SIZE:
                            yield pending[: self.BATCH_SIZE]
                            pending = pending[self.BATCH_SIZE :]
                    total += 1
                    if limit is not None and total >= limit:
                        break

            if pending:
                yield pending
        finally:
            logger.info("Extracted %s email messages", total)

    def _message_to_assets(self, msg: Any, folder: str) -> list[SingleAssetScanResults]:
        message_id = self._message_id(msg, folder)
        email_hash = self.generate_hash_id(message_id)
        email_url = f"imap://{self.host}/{folder};UID={msg.uid or ''}"
        self._hash_by_url[email_url] = email_hash
        self._email_locator_by_hash[email_hash] = (folder, str(msg.uid or ""))

        created = self._aware(getattr(msg, "date", None))

        body_text = (msg.text or "").strip()
        body_html = msg.html or ""
        if not body_text and body_html:
            body_text = html_to_text(body_html)
        self._asset_content_cache[email_hash] = (body_html or body_text, body_text)

        attachment_assets: list[SingleAssetScanResults] = []
        attachment_hashes: list[str] = []
        if self.include_attachments:
            for idx, att in enumerate(msg.attachments or []):
                asset = self._attachment_to_asset(
                    att, idx, message_id, email_hash, email_url, folder, msg.uid, created
                )
                attachment_assets.append(asset)
                attachment_hashes.append(asset.hash)

        from_address = (msg.from_ or "").strip() or "unknown"
        subject = (msg.subject or "").strip() or "(no subject)"
        metadata: dict[str, Any] = {
            "message_id": message_id,
            "subject": subject,
            "from_address": from_address,
            "date": created.isoformat(),
            "folder": folder,
            "has_html": bool(body_html),
            "attachment_count": len(attachment_assets),
        }
        if "@" in from_address:
            metadata["sender_domain"] = from_address.rsplit("@", 1)[-1].strip(">").strip()
        to_addresses = [a for a in (msg.to or ()) if a]
        if to_addresses:
            metadata["to_addresses"] = to_addresses
        cc_addresses = [a for a in (msg.cc or ()) if a]
        if cc_addresses:
            metadata["cc_addresses"] = cc_addresses
        reply_to = next((a for a in (msg.reply_to or ()) if a), None)
        if reply_to:
            metadata["reply_to"] = reply_to
        in_reply_to = self._header(msg, "in-reply-to")
        if in_reply_to:
            metadata["in_reply_to"] = in_reply_to
        references = self._header(msg, "references")
        if references:
            metadata["references"] = references
        for key, value in self._auth_results(msg).items():
            metadata[key] = value

        email_asset = SingleAssetScanResults(
            hash=email_hash,
            checksum=self.calculate_checksum(metadata),
            name=subject,
            external_url=email_url,
            links=attachment_hashes,
            asset_type=OutputAssetType.TXT,
            source_id=self.source_id,
            created_at=created,
            updated_at=created,
            runner_id=self.runner_id,
            **self.metadata_fields("email", metadata),
        )
        # Track for Phase 1 relationship emission.
        if attachment_hashes:
            self._email_attachment_links[email_hash] = attachment_hashes
        return [email_asset, *attachment_assets]

    def _attachment_to_asset(
        self,
        att: Any,
        idx: int,
        message_id: str,
        email_hash: str,
        email_url: str,
        folder: str,
        uid: Any,
        created: datetime,
    ) -> SingleAssetScanResults:
        filename = (att.filename or f"attachment-{idx}").strip()
        att_id = f"{message_id}#att{idx}:{filename}"
        att_hash = self.generate_hash_id(att_id)
        att_url = f"{email_url}#att{idx}-{filename}"
        self._hash_by_url[att_url] = att_hash
        self._attachment_name_by_hash[att_hash] = filename
        self._attachment_locator_by_hash[att_hash] = (folder, str(uid or ""), idx)

        payload = att.payload or b""
        size = int(att.size or len(payload))
        mime = resolve_mime_type(payload, declared_mime_type=att.content_type, file_name=filename)

        metadata: dict[str, Any] = {
            "filename": filename,
            "parent_email_hash": email_hash,
            "size_bytes": size,
            "mime_type": mime,
            "is_inline": (att.content_disposition or "").lower() == "inline",
        }
        if att.content_id:
            metadata["content_id"] = att.content_id

        over_limit = self.max_attachment_size_bytes is not None and size > int(
            self.max_attachment_size_bytes
        )
        if payload and not over_limit:
            metadata["sha256"] = hashlib.sha256(payload).hexdigest()
            self._attachment_bytes_by_hash[att_hash] = (payload, mime)
            for key, value in extract_file_metadata(payload, mime, file_name=filename).items():
                if value is not None:
                    metadata[key] = value

        return SingleAssetScanResults(
            hash=att_hash,
            checksum=self.calculate_checksum({"id": att_id, "size": size, "mime": mime}),
            name=filename,
            external_url=att_url,
            links=[],
            asset_type=self._asset_type_from_mime(mime),
            source_id=self.source_id,
            created_at=created,
            updated_at=created,
            runner_id=self.runner_id,
            **self.metadata_fields("attachment", metadata),
        )

    # ------------------------------------------------------------------
    # Header parsing helpers
    # ------------------------------------------------------------------
    @staticmethod
    def _header(msg: Any, name: str) -> str | None:
        value = (msg.headers or {}).get(name)
        if isinstance(value, (tuple, list)):
            value = value[0] if value else None
        if isinstance(value, str):
            stripped = value.strip()
            return stripped or None
        return None

    def _message_id(self, msg: Any, folder: str) -> str:
        raw = self._header(msg, "message-id")
        if not raw:
            raw = msg.obj.get("Message-ID") if getattr(msg, "obj", None) else None
        if raw:
            raw = str(raw).strip().strip("<>").strip()
        if not raw:
            raw = f"uid-{msg.uid}-{folder}"
        return raw

    def _auth_results(self, msg: Any) -> dict[str, str]:
        raw = self._header(msg, "authentication-results")
        results: dict[str, str] = {}
        if not raw:
            return results
        lowered = raw.lower()
        for key in ("spf", "dkim", "dmarc"):
            token = f"{key}="
            if token in lowered:
                start = lowered.index(token) + len(token)
                value = lowered[start:].split(" ", 1)[0].split(";", 1)[0].strip()
                if value:
                    results[key] = value
        return results

    @staticmethod
    def _aware(value: Any) -> datetime:
        if not isinstance(value, datetime):
            return datetime.now(UTC)
        # imap_tools yields 1900-01-01 for unparsed dates.
        if value.year < 1971:
            return datetime.now(UTC)
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value

    @staticmethod
    def _asset_type_from_mime(mime: str) -> OutputAssetType:
        normalized = (mime or "").split(";", 1)[0].strip().lower()
        if normalized.startswith("image/"):
            return OutputAssetType.IMAGE
        if normalized.startswith("audio/"):
            return OutputAssetType.AUDIO
        if normalized.startswith("video/"):
            return OutputAssetType.VIDEO
        if normalized in _TABULAR_MIME_TYPES:
            return OutputAssetType.TABLE
        if normalized in _TEXT_MIME_TYPES or normalized.startswith(_TEXT_MIME_PREFIXES):
            return OutputAssetType.TXT
        return OutputAssetType.BINARY

    # ------------------------------------------------------------------
    # Hashing + identifiers
    # ------------------------------------------------------------------
    def generate_hash_id(self, asset_id: str) -> str:
        return hash_id(self.source_type, asset_id)

    def _resolve_hash(self, asset_id: str) -> str:
        return self._hash_by_url.get(asset_id, asset_id)

    # ------------------------------------------------------------------
    # Content fetching for detectors
    # ------------------------------------------------------------------
    async def fetch_content(self, asset_id: str) -> tuple[str, str] | None:
        asset_hash = self._resolve_hash(asset_id)
        cached = self._asset_content_cache.get(asset_hash)
        if cached:
            return cached

        locator = self._email_locator_by_hash.get(asset_hash)
        if not locator:
            return None
        folder, uid = locator
        msg = self._refetch_message(folder, uid)
        if msg is None:
            return None
        body_text = (msg.text or "").strip()
        body_html = msg.html or ""
        if not body_text and body_html:
            body_text = html_to_text(body_html)
        return (body_html or body_text, body_text)

    async def fetch_content_bytes(self, asset_id: str) -> tuple[bytes, str] | None:
        asset_hash = self._resolve_hash(asset_id)
        cached = self._attachment_bytes_by_hash.get(asset_hash)
        if cached:
            return cached

        locator = self._attachment_locator_by_hash.get(asset_hash)
        if not locator:
            return None
        folder, uid, idx = locator
        msg = self._refetch_message(folder, uid)
        if msg is None:
            return None
        attachments = list(msg.attachments or [])
        if idx >= len(attachments):
            return None
        att = attachments[idx]
        payload = att.payload or b""
        if not payload:
            return None
        mime = resolve_mime_type(
            payload,
            declared_mime_type=att.content_type,
            file_name=self._attachment_file_name(asset_hash, att.filename or ""),
        )
        return payload, mime

    def _refetch_message(self, folder: str, uid: str) -> Any:
        if not uid:
            return None
        try:
            mod = self._imap_tools()
            mailbox = self._connect(folder)
            try:
                for msg in mailbox.fetch(mod.AND(uid=str(uid)), mark_seen=False, limit=1):
                    return msg
            finally:
                mailbox.logout()
        except Exception as e:
            logger.warning("Failed to re-fetch message uid=%s from %s: %s", uid, folder, e)
        return None

    def evict_asset_cache(self, asset_hash: str) -> None:
        self._attachment_bytes_by_hash.pop(asset_hash, None)
        self._asset_content_cache.pop(asset_hash, None)

    def enrich_finding_location(
        self,
        finding: DetectionResult,
        asset: SingleAssetScanResults,
        text_content: str,
    ) -> None:
        name = self._attachment_name_by_hash.get(asset.hash) or asset.name or asset.external_url
        finding.location = Location(path=name)

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------
    async def collect_relationships(self) -> list[Any]:
        """Emit ATTACHED_TO edges: email → attachment for each extracted message."""
        from ...outputs.rest import IngestEdge

        edges: list[IngestEdge] = []
        for email_hash, attachment_hashes in self._email_attachment_links.items():
            for att_hash in attachment_hashes:
                edges.append(
                    IngestEdge(
                        from_type="asset",
                        from_hash=email_hash,
                        to_type="asset",
                        to_hash=att_hash,
                        relation_type="ATTACHED_TO",
                    )
                )
        return edges

    def abort(self) -> None:
        logger.info("Aborting email extraction...")
        super().abort()
        self._logout()

    def cleanup(self) -> None:
        self._logout()

    def _logout(self) -> None:
        if self._mailbox is not None:
            try:
                self._mailbox.logout()
            except Exception:
                pass
            self._mailbox = None
