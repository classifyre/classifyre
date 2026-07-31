"""Reddit ingestion built on PRAW.

Subreddits are configured on the source; everything else follows from them:

    subreddit listing (new/hot/top/rising/controversial)
        -> submission            -> one ``post`` asset
            -> comment forest    -> one ``comment`` asset each, linked
                                    post -> comment -> reply so a thread is
                                    navigable from either end
            -> attached media    -> one ``image``/``video``/``file`` asset each,
                                    downloaded on demand and put through
                                    ``utils/file_parser`` so images (OCR),
                                    documents and media (transcription) are all
                                    scanned by the same pipeline as local files
            -> linked video      -> one ``external_video`` asset, analysed with
                                    the shared ``utils/external_video`` pipeline
                                    the YouTube source uses (captions first,
                                    Whisper fallback, changed-frame OCR)

All three PRAW OAuth flows are supported (see ``RedditAuthMode``). Whichever one
is configured, the client is put into read-only mode immediately after
construction and there is no configuration knob to undo it — Classifyre never
writes to Reddit. The practical consequence is that requests carry the
application's own token, so content only a signed-in account can see is not
reachable regardless of the flow.

``praw`` is an optional dependency (the ``reddit`` uv group) and is imported
lazily so the base CLI loads without it.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncGenerator, Iterable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from ...models.generated_input import (
    RedditAuthMode,
    RedditCommentSort,
    RedditInput,
    RedditListing,
    RedditOptionalConnection,
    RedditOptionalScope,
    RedditOptionalSite,
    SamplingStrategy,
)
from ...models.generated_single_asset_scan_results import (
    AssetType as OutputAssetType,
)
from ...models.generated_single_asset_scan_results import (
    DetectionResult,
    Location,
    SingleAssetScanResults,
)
from ...utils import external_video
from ...utils.file_parser import infer_mime_type_from_file_name, resolve_mime_type
from ...utils.hashing import hash_id
from ..atlassian_common import dedupe_preserve_order, deterministic_sample, is_tabular_mime_type
from ..base import BaseSource
from ..dependencies import require_module

logger = logging.getLogger(__name__)

# Declared inline at each call site rather than via a shared constant: the
# dependency-group conformance test reads these lists statically (AST) to prove
# the parent process pre-warms the right uv group before the worker pool starts.

# Reddit truncates every listing at 1000 items, so there is nothing to gain by
# paging past it — and asking for more just burns rate limit.
_LISTING_HARD_CAP = 1000

# RANDOM samples from a pool rather than the first N, so the choice is actually
# spread over the listing. Bounded to keep one subreddit from dominating a run.
_RANDOM_POOL_MULTIPLIER = 4

# Sampling strategy -> the listing that makes it meaningful. NEW is chronological,
# which is what LATEST wants and what keeps an AUTOMATIC cursor stable between
# runs; HOT is a ranked cross-section, which is the better pool to sample from.
_LISTING_BY_STRATEGY: dict[SamplingStrategy, RedditListing] = {
    SamplingStrategy.ALL: RedditListing.NEW,
    SamplingStrategy.LATEST: RedditListing.NEW,
    SamplingStrategy.AUTOMATIC: RedditListing.NEW,
    SamplingStrategy.RANDOM: RedditListing.HOT,
}

_COMMENT_SORT_BY_ENUM: dict[RedditCommentSort, str] = {
    RedditCommentSort.TOP: "top",
    RedditCommentSort.BEST: "confidence",
    RedditCommentSort.NEW: "new",
    RedditCommentSort.OLD: "old",
    RedditCommentSort.CONTROVERSIAL: "controversial",
    RedditCommentSort.Q_AND_A: "q&a",
}

# Fallback asset typing for media Reddit serves without a usable extension.
_ASSET_TYPE_BY_EXTENSION: dict[str, OutputAssetType] = {
    ".png": OutputAssetType.IMAGE,
    ".jpg": OutputAssetType.IMAGE,
    ".jpeg": OutputAssetType.IMAGE,
    ".gif": OutputAssetType.IMAGE,
    ".webp": OutputAssetType.IMAGE,
    ".mp4": OutputAssetType.VIDEO,
    ".mov": OutputAssetType.VIDEO,
    ".webm": OutputAssetType.VIDEO,
    ".mp3": OutputAssetType.AUDIO,
    ".m4a": OutputAssetType.AUDIO,
    ".csv": OutputAssetType.TABLE,
    ".xlsx": OutputAssetType.TABLE,
    ".txt": OutputAssetType.TXT,
    ".md": OutputAssetType.TXT,
}


class RedditSource(BaseSource):
    """Extract Reddit submissions, their comment threads and their media."""

    source_type = "reddit"

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ):
        super().__init__(recipe, source_id=source_id, runner_id=runner_id)
        self.config = RedditInput.model_validate(recipe)
        self.runner_id = runner_id or "local-run"

        required = self.config.required
        self.auth_mode = RedditAuthMode(required.auth_mode)
        self.user_agent = str(required.user_agent or "").strip()
        self.subreddits = dedupe_preserve_order(
            [
                name
                for name in (self._normalize_subreddit(raw) for raw in required.subreddits or [])
                if name
            ]
        )
        if not self.subreddits:
            raise ValueError("Reddit source requires at least one subreddit.")
        if not self.user_agent:
            raise ValueError("Reddit source requires a user_agent.")

        self._client: Any | None = None

        # Detector-visible text keyed by asset hash, for assets whose content is
        # already in hand (posts, comments) or resolved lazily (linked videos).
        self._text_by_hash: dict[str, tuple[str, str]] = {}
        # Downloadable media, resolved when a detector asks for the bytes.
        self._media_url_by_hash: dict[str, str] = {}
        self._media_mime_by_hash: dict[str, str] = {}
        # Linked videos, analysed on first content request (the download and the
        # Whisper pass are far too expensive to run during discovery).
        self._external_video_url_by_hash: dict[str, str] = {}
        self._external_video_assets: dict[str, SingleAssetScanResults] = {}
        self._external_video_processed: set[str] = set()
        self._content_pages_processed: set[str] = set()

    # ------------------------------------------------------------------
    # Configuration helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _normalize_subreddit(raw: str) -> str:
        """Accept ``datasets``, ``r/datasets`` or a full subreddit URL."""
        value = str(raw or "").strip()
        if not value:
            return ""
        if "://" in value:
            value = urlsplit(value).path
        value = value.strip("/")
        for prefix in ("r/", "R/"):
            if value.startswith(prefix):
                value = value[len(prefix) :]
        return value.split("/")[0].strip()

    def _scope(self) -> RedditOptionalScope:
        if self.config.optional and self.config.optional.scope:
            return self.config.optional.scope
        return RedditOptionalScope()

    def _connection(self) -> RedditOptionalConnection:
        if self.config.optional and self.config.optional.connection:
            return self.config.optional.connection
        return RedditOptionalConnection()

    def _site(self) -> RedditOptionalSite:
        if self.config.optional and self.config.optional.site:
            return self.config.optional.site
        return RedditOptionalSite()

    def _sample_limit(self) -> int | None:
        """Submissions to take per subreddit, or None for an unbounded sweep."""
        if self.config.sampling.strategy == SamplingStrategy.ALL:
            return None
        return self.sampling_window_size()

    def _listing(self) -> RedditListing:
        configured = self._scope().listing
        if configured is not None:
            return RedditListing(configured)
        return _LISTING_BY_STRATEGY.get(self.config.sampling.strategy, RedditListing.NEW)

    def _submission_prefix(self) -> str:
        return str(self._site().submission_kind or "t3_")

    def _comment_prefix(self) -> str:
        return str(self._site().comment_kind or "t1_")

    def _reddit_base_url(self) -> str:
        return self._url_str(self._site().reddit_url, "https://www.reddit.com")

    @staticmethod
    def _url_str(value: Any, fallback: str) -> str:
        """Render a schema URL without the trailing slash pydantic's AnyUrl adds.

        PRAW composes endpoints as ``f"{reddit_url}/api/v1/..."``, so a trailing
        slash would produce a double slash in every authorization request.
        """
        return (str(value).rstrip("/") if value else "") or fallback

    def _max_media_bytes(self) -> int | None:
        """The attachment size ceiling, or None when unbounded."""
        value = self._scope().max_media_bytes
        if value is None:
            return None
        # The schema models this as `integer | null`, which datamodel-codegen
        # renders as a RootModel wrapper.
        return int(getattr(value, "root", value))

    # ------------------------------------------------------------------
    # PRAW client
    # ------------------------------------------------------------------

    @property
    def client(self) -> Any:
        """The PRAW ``Reddit`` instance, created on first use.

        Built lazily so that constructing the source — validating a recipe,
        computing asset hash IDs — does not require the optional ``praw``
        dependency. A missing dependency is then reported from the first API
        call, where it is actionable.
        """
        if self._client is None:
            self._client = self._build_client()
        return self._client

    def _build_client(self) -> Any:
        praw = require_module(
            "praw",
            "Reddit",
            ["reddit"],
            detail="Reddit ingestion requires the official praw package.",
        )

        masked = self.config.masked
        connection = self._connection()
        site = self._site()

        kwargs: dict[str, Any] = {
            "user_agent": self.user_agent,
            "client_id": masked.client_id,
            "client_secret": getattr(masked, "client_secret", None) or None,
            # Basic configuration options (PRAW "Configuring PRAW").
            "check_for_updates": bool(connection.check_for_updates),
            "check_for_async": connection.check_for_async is not False,
            "ratelimit_seconds": int(connection.ratelimit_seconds or 5),
            "timeout": int(connection.timeout or 16),
            "window_size": int(connection.window_size or 600),
            # Reddit site configuration options — only meaningful for a
            # third-party instance, but always passed so the defaults are
            # explicit rather than implied.
            "reddit_url": self._url_str(site.reddit_url, "https://www.reddit.com"),
            "oauth_url": self._url_str(site.oauth_url, "https://oauth.reddit.com"),
            "short_url": self._url_str(site.short_url, "https://redd.it"),
            "comment_kind": str(site.comment_kind or "t1_"),
            "redditor_kind": str(site.redditor_kind or "t2_"),
            "submission_kind": str(site.submission_kind or "t3_"),
            "message_kind": str(site.message_kind or "t4_"),
            "subreddit_kind": str(site.subreddit_kind or "t5_"),
            "trophy_kind": str(site.trophy_kind or "t6_"),
        }

        if self.auth_mode == RedditAuthMode.SCRIPT:
            kwargs["username"] = getattr(masked, "username", None)
            kwargs["password"] = getattr(masked, "password", None)
        elif self.auth_mode == RedditAuthMode.REFRESH_TOKEN:
            kwargs["refresh_token"] = getattr(masked, "refresh_token", None)

        reddit = praw.Reddit(**kwargs)
        # Not configurable, deliberately: Classifyre is an observer of Reddit and
        # must never be able to post, vote, edit or delete. Setting this after
        # construction also covers the SCRIPT and REFRESH_TOKEN flows, which
        # would otherwise hold a writable user session.
        reddit.read_only = True
        return reddit

    # ------------------------------------------------------------------
    # BaseSource interface
    # ------------------------------------------------------------------

    def test_connection(self) -> dict[str, Any]:
        logger.info("Testing connection to the Reddit API...")
        result: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "source_type": self.recipe.get("type"),
        }
        try:
            client = self.client
        except Exception as exc:
            result["status"] = "FAILURE"
            result["message"] = str(exc)
            return result

        try:
            subreddit = client.subreddit(self.subreddits[0])
            # Touching an attribute is what actually issues the request; PRAW is
            # lazy, so `client.subreddit(...)` alone proves nothing.
            display_name = subreddit.display_name
            if not client.read_only:
                result["status"] = "FAILURE"
                result["message"] = "Reddit client did not stay in read-only mode."
                return result
            result["status"] = "SUCCESS"
            result["message"] = f"Successfully connected to Reddit (r/{display_name}, read-only)."
        except Exception as exc:
            result["status"] = "FAILURE"
            result["message"] = self._describe_error(exc)
        return result

    @staticmethod
    def _describe_error(exc: Exception) -> str:
        """Turn a prawcore error into something a user can act on."""
        name = type(exc).__name__
        hints = {
            "OAuthException": (
                "Reddit rejected the credentials. Check the client id/secret, and for a "
                "script app that the username/password belong to the account that "
                "registered it (append :token when 2FA is on)."
            ),
            "InvalidToken": "The refresh token was rejected — re-run the authorization flow.",
            "ResponseException": "Reddit returned an error response — check the app credentials.",
            "Forbidden": "The application cannot see this subreddit (private, quarantined or banned).",
            "NotFound": "Subreddit not found — check the name.",
            "Redirect": "Subreddit not found — Reddit redirected the request to search.",
        }
        hint = hints.get(name)
        return f"{name}: {hint} ({exc})" if hint else f"{name}: {exc}"

    def generate_hash_id(self, asset_id: str) -> str:
        type_value = (
            self.config.type.value if hasattr(self.config.type, "value") else str(self.config.type)
        )
        return hash_id(type_value, asset_id)

    def discover(self) -> dict[str, Any]:
        return {
            "subreddits": [
                {"id": name, "name": f"r/{name}", "type": "REDDIT_SUBREDDIT"}
                for name in self.subreddits
            ]
        }

    def abort(self) -> None:
        logger.info("Aborting Reddit extraction...")
        super().abort()

    def cleanup(self) -> None:
        self._text_by_hash.clear()
        self._media_url_by_hash.clear()
        self._media_mime_by_hash.clear()
        self._external_video_url_by_hash.clear()
        self._external_video_assets.clear()
        self._external_video_processed.clear()
        self._content_pages_processed.clear()

    def enrich_finding_location(
        self,
        finding: DetectionResult,
        asset: SingleAssetScanResults,
        text_content: str,
    ) -> None:
        _ = text_content
        finding.location = Location(path=asset.external_url)

    # ------------------------------------------------------------------
    # Extraction
    # ------------------------------------------------------------------

    async def extract_raw(self) -> AsyncGenerator[list[SingleAssetScanResults], None]:
        if self._aborted:
            return

        batch: list[SingleAssetScanResults] = []
        for subreddit_name in self.subreddits:
            if self._aborted:
                break
            for submission in self._sample_submissions(subreddit_name):
                if self._aborted:
                    break
                try:
                    assets = self._submission_assets(submission, subreddit_name)
                except Exception as exc:
                    logger.error(
                        "Failed to build assets for Reddit submission %s: %s",
                        getattr(submission, "id", "?"),
                        exc,
                    )
                    continue
                for asset in assets:
                    batch.append(asset)
                    if len(batch) >= self.BATCH_SIZE:
                        yield batch
                        batch = []

        if batch:
            yield batch

    def _listing_iterator(self, subreddit: Any, listing: RedditListing, limit: int | None) -> Any:
        """The PRAW listing generator for one subreddit."""
        time_filter = str(self._scope().time_filter or "ALL").lower()
        if listing == RedditListing.NEW:
            return subreddit.new(limit=limit)
        if listing == RedditListing.HOT:
            return subreddit.hot(limit=limit)
        if listing == RedditListing.RISING:
            return subreddit.rising(limit=limit)
        if listing == RedditListing.TOP:
            return subreddit.top(time_filter=time_filter, limit=limit)
        return subreddit.controversial(time_filter=time_filter, limit=limit)

    def _sample_submissions(self, subreddit_name: str) -> Iterable[Any]:
        """Apply the sampling strategy at submission granularity.

        ALL walks the whole listing (Reddit itself stops at 1000). LATEST takes
        the first window of the chronological listing. RANDOM draws a stable
        pseudo-random subset from a larger pool so findings stay comparable
        between runs rather than churning. AUTOMATIC remembers where the previous
        run stopped, ingests the next window, and wraps once the listing has been
        covered — so successive runs cover everything at a bounded cost each.
        """
        strategy = self.config.sampling.strategy
        listing = self._listing()
        limit = self._sample_limit()
        scope = self._scope()

        try:
            subreddit = self.client.subreddit(subreddit_name)
        except Exception as exc:
            logger.warning("Cannot open r/%s: %s", subreddit_name, self._describe_error(exc))
            return []

        if strategy == SamplingStrategy.LATEST:
            fetch_limit: int | None = limit
        elif strategy == SamplingStrategy.RANDOM:
            fetch_limit = min(_LISTING_HARD_CAP, (limit or 100) * _RANDOM_POOL_MULTIPLIER)
        elif strategy == SamplingStrategy.AUTOMATIC:
            fetch_limit = _LISTING_HARD_CAP
        else:
            fetch_limit = None

        try:
            submissions = list(self._listing_iterator(subreddit, listing, fetch_limit))
        except Exception as exc:
            logger.warning(
                "Failed to list r/%s (%s): %s",
                subreddit_name,
                listing.value,
                self._describe_error(exc),
            )
            return []

        if scope.exclude_nsfw:
            submissions = [s for s in submissions if not getattr(s, "over_18", False)]
        if scope.exclude_stickied:
            submissions = [s for s in submissions if not getattr(s, "stickied", False)]

        if strategy == SamplingStrategy.RANDOM and limit is not None:
            submissions = deterministic_sample(submissions, min(limit, len(submissions)))
        elif strategy == SamplingStrategy.AUTOMATIC:
            # The listing order is stable between runs, which is what makes the
            # saved offset mean the same thing next time.
            submissions = self.automatic_window(submissions, key=f"subreddit:{subreddit_name}")

        logger.info(
            "Sampled %d submission(s) from r/%s (%s, %s)",
            len(submissions),
            subreddit_name,
            listing.value,
            strategy.value,
        )
        return submissions

    # ------------------------------------------------------------------
    # Assets
    # ------------------------------------------------------------------

    def _submission_assets(
        self,
        submission: Any,
        subreddit_name: str,
    ) -> list[SingleAssetScanResults]:
        submission_id = str(getattr(submission, "id", "") or "")
        if not submission_id:
            return []

        post_hash = self.generate_hash_id(f"post_#_{submission_id}")
        created_at = self._created_at(submission)
        title = str(getattr(submission, "title", "") or "").strip() or f"Post {submission_id}"
        selftext = str(getattr(submission, "selftext", "") or "")
        permalink = self._permalink(getattr(submission, "permalink", ""))

        media_assets = self._media_assets(submission, subreddit_name, submission_id, post_hash)
        video_assets = self._external_video_assets_for(
            submission, subreddit_name, submission_id, post_hash
        )
        comment_assets, top_level_hashes = self._comment_assets(
            submission, subreddit_name, submission_id, post_hash
        )

        child_hashes = dedupe_preserve_order(
            [*top_level_hashes, *(a.hash for a in media_assets), *(a.hash for a in video_assets)]
        )

        detector_text = "\n\n".join(part for part in (title, selftext) if part).strip()
        self._text_by_hash[post_hash] = (detector_text, detector_text)

        outbound_url = str(getattr(submission, "url", "") or "")
        post_metadata: dict[str, Any] = {
            "submission_id": submission_id,
            "subreddit": subreddit_name,
            "title": title,
            "links_count": len(child_hashes),
            "listing": self._listing().value,
        }
        self._put_if_set(post_metadata, "author", self._author_name(submission))
        self._put_if_set(
            post_metadata, "score", self._coerce_int(getattr(submission, "score", None))
        )
        self._put_if_set(
            post_metadata,
            "upvote_ratio",
            self._coerce_float(getattr(submission, "upvote_ratio", None)),
        )
        self._put_if_set(
            post_metadata,
            "num_comments",
            self._coerce_int(getattr(submission, "num_comments", None)),
        )
        self._put_if_set(
            post_metadata, "flair", str(getattr(submission, "link_flair_text", "") or "") or None
        )
        self._put_if_set(
            post_metadata, "is_self", self._coerce_bool(getattr(submission, "is_self", None))
        )
        self._put_if_set(
            post_metadata, "over_18", self._coerce_bool(getattr(submission, "over_18", None))
        )
        self._put_if_set(
            post_metadata, "spoiler", self._coerce_bool(getattr(submission, "spoiler", None))
        )
        self._put_if_set(
            post_metadata, "stickied", self._coerce_bool(getattr(submission, "stickied", None))
        )
        self._put_if_set(
            post_metadata, "locked", self._coerce_bool(getattr(submission, "locked", None))
        )
        self._put_if_set(
            post_metadata, "domain", str(getattr(submission, "domain", "") or "") or None
        )
        if outbound_url and not getattr(submission, "is_self", False):
            post_metadata["outbound_url"] = outbound_url

        post_asset = SingleAssetScanResults(
            hash=post_hash,
            # Vote counters move on every re-scan; including them would flip
            # unchanged posts to UPDATED on every run.
            checksum=self.calculate_checksum(
                {
                    "submission_id": submission_id,
                    "title": title,
                    "selftext": selftext,
                    "children": child_hashes,
                }
            ),
            name=title,
            external_url=self.ensure_location(
                permalink, fallback=f"{self._reddit_base_url()}/comments/{submission_id}"
            ),
            links=child_hashes,
            asset_type=OutputAssetType.TXT,
            source_id=self.source_id,
            created_at=created_at,
            updated_at=created_at,
            runner_id=self.runner_id,
            **self.metadata_fields("post", post_metadata),
        )
        return [post_asset, *comment_assets, *media_assets, *video_assets]

    # ------------------------------------------------------------------ comments

    def _comment_assets(
        self,
        submission: Any,
        subreddit_name: str,
        submission_id: str,
        post_hash: str,
    ) -> tuple[list[SingleAssetScanResults], list[str]]:
        """One asset per comment, wired parent <-> child so a thread is walkable.

        Returns the assets plus the hashes of the top-level comments, which are
        what the submission links to; deeper comments hang off their own parent.
        """
        scope = self._scope()
        if scope.include_comments is False:
            return [], []

        max_comments = int(scope.max_comments_per_post or 0)
        if max_comments == 0:
            return [], []

        try:
            submission.comment_sort = _COMMENT_SORT_BY_ENUM.get(
                RedditCommentSort(scope.comment_sort or RedditCommentSort.TOP), "top"
            )
            forest = submission.comments
            # replace_more(limit=0) drops the "load more comments" placeholders
            # without issuing a request for each; limit=None expands them, which
            # is one API round-trip per placeholder and can be hundreds.
            forest.replace_more(limit=None if scope.expand_more_comments else 0)
            comments = list(forest.list())[:max_comments]
        except Exception as exc:
            logger.warning(
                "Failed to fetch comments for submission %s: %s",
                submission_id,
                self._describe_error(exc),
            )
            return [], []

        comment_prefix = self._comment_prefix()
        submission_prefix = self._submission_prefix()

        # Two passes: the first fixes every comment's identity so the second can
        # link a parent to children that appear later in the flattened forest.
        records: list[dict[str, Any]] = []
        hash_by_comment_id: dict[str, str] = {}
        for comment in comments:
            comment_id = str(getattr(comment, "id", "") or "")
            if not comment_id:
                continue
            comment_hash = self.generate_hash_id(f"comment_#_{comment_id}")
            hash_by_comment_id[comment_id] = comment_hash
            records.append({"comment": comment, "id": comment_id, "hash": comment_hash})

        children_by_hash: dict[str, list[str]] = {}
        top_level_hashes: list[str] = []
        for record in records:
            parent_fullname = str(getattr(record["comment"], "parent_id", "") or "")
            if parent_fullname.startswith(submission_prefix):
                parent_hash = post_hash
                top_level_hashes.append(record["hash"])
            elif parent_fullname.startswith(comment_prefix):
                parent_hash = hash_by_comment_id.get(parent_fullname[len(comment_prefix) :], "")
            else:
                parent_hash = ""
            record["parent_fullname"] = parent_fullname
            record["parent_hash"] = parent_hash
            if parent_hash and parent_hash != post_hash:
                children_by_hash.setdefault(parent_hash, []).append(record["hash"])

        assets: list[SingleAssetScanResults] = []
        for record in records:
            asset = self._comment_asset(
                record,
                subreddit_name=subreddit_name,
                submission_id=submission_id,
                post_hash=post_hash,
                replies=children_by_hash.get(record["hash"], []),
            )
            if asset is not None:
                assets.append(asset)
        return assets, top_level_hashes

    def _comment_asset(
        self,
        record: dict[str, Any],
        *,
        subreddit_name: str,
        submission_id: str,
        post_hash: str,
        replies: list[str],
    ) -> SingleAssetScanResults | None:
        comment = record["comment"]
        body = str(getattr(comment, "body", "") or "")
        if not body.strip():
            return None

        comment_hash = record["hash"]
        parent_hash = str(record.get("parent_hash") or "")
        links = dedupe_preserve_order([h for h in (parent_hash, *replies) if h])

        created_at = self._created_at(comment)
        permalink = self._permalink(getattr(comment, "permalink", ""))
        self._text_by_hash[comment_hash] = (body, body)

        metadata: dict[str, Any] = {
            "comment_id": record["id"],
            "submission_id": submission_id,
            "subreddit": subreddit_name,
            "links_count": len(links),
        }
        self._put_if_set(metadata, "author", self._author_name(comment))
        self._put_if_set(metadata, "parent_fullname", record.get("parent_fullname") or None)
        self._put_if_set(metadata, "parent_hash", parent_hash or None)
        self._put_if_set(metadata, "depth", self._coerce_int(getattr(comment, "depth", None)))
        self._put_if_set(metadata, "score", self._coerce_int(getattr(comment, "score", None)))
        self._put_if_set(
            metadata, "is_submitter", self._coerce_bool(getattr(comment, "is_submitter", None))
        )
        self._put_if_set(
            metadata, "stickied", self._coerce_bool(getattr(comment, "stickied", None))
        )
        if replies:
            metadata["reply_count"] = len(replies)

        return SingleAssetScanResults(
            hash=comment_hash,
            checksum=self.calculate_checksum(
                {"comment_id": record["id"], "body": body, "links": links}
            ),
            name=f"Comment {record['id']} on {submission_id}",
            external_url=self.ensure_location(
                permalink,
                fallback=f"{self._reddit_base_url()}/comments/{submission_id}/_/{record['id']}",
            ),
            links=links,
            asset_type=OutputAssetType.TXT,
            source_id=self.source_id,
            created_at=created_at,
            updated_at=created_at,
            runner_id=self.runner_id,
            **self.metadata_fields("comment", metadata),
        )

    # --------------------------------------------------------------------- media

    def _media_assets(
        self,
        submission: Any,
        subreddit_name: str,
        submission_id: str,
        post_hash: str,
    ) -> list[SingleAssetScanResults]:
        scope = self._scope()
        if scope.include_media is False:
            return []

        assets: list[SingleAssetScanResults] = []
        seen_urls: set[str] = set()

        for index, url in self._media_urls(submission):
            if not url or url in seen_urls:
                continue
            seen_urls.add(url)
            asset = self._media_asset(
                url,
                gallery_index=index,
                subreddit_name=subreddit_name,
                submission_id=submission_id,
                post_hash=post_hash,
                created_at=self._created_at(submission),
                duration_seconds=self._reddit_video_duration(submission),
            )
            if asset is not None:
                assets.append(asset)
        return assets

    def _media_urls(self, submission: Any) -> list[tuple[int | None, str]]:
        """Every downloadable media URL a submission carries, in a stable order."""
        urls: list[tuple[int | None, str]] = []

        # Gallery submissions keep the real media behind media_metadata; the `s`
        # entry holds the full-resolution URL under a format-specific key.
        metadata = getattr(submission, "media_metadata", None)
        if isinstance(metadata, dict):
            for index, key in enumerate(sorted(metadata)):
                entry = metadata.get(key)
                if not isinstance(entry, dict):
                    continue
                best = entry.get("s")
                if not isinstance(best, dict):
                    continue
                url = best.get("u") or best.get("gif") or best.get("mp4")
                if isinstance(url, str) and url:
                    urls.append((index, url.replace("&amp;", "&")))

        # Reddit-hosted video: the fallback URL is the muxed-ish progressive
        # stream, which is the only variant worth handing to the file pipeline.
        media = getattr(submission, "media", None)
        if isinstance(media, dict):
            reddit_video = media.get("reddit_video")
            if isinstance(reddit_video, dict):
                fallback = reddit_video.get("fallback_url")
                if isinstance(fallback, str) and fallback:
                    urls.append((None, fallback))

        # Direct link submissions (i.redd.it, an imgur png, a linked PDF, ...).
        url = str(getattr(submission, "url", "") or "")
        if url and not getattr(submission, "is_self", False):
            if self._is_downloadable_media(url):
                urls.append((None, url))

        return urls

    @staticmethod
    def _is_downloadable_media(url: str) -> bool:
        """Whether a linked URL points at a file rather than a web page.

        Deliberately extension-driven: a scan must not start downloading every
        article a subreddit links to, only the files it links to.
        """
        if external_video.is_external_video_url(url):
            return False
        mime = infer_mime_type_from_file_name(url)
        return mime != "application/octet-stream"

    def _media_asset(
        self,
        url: str,
        *,
        gallery_index: int | None,
        subreddit_name: str,
        submission_id: str,
        post_hash: str,
        created_at: datetime,
        duration_seconds: int | None,
    ) -> SingleAssetScanResults | None:
        scope = self._scope()
        file_name = self._file_name_from_url(url)
        if not self._extension_allowed(file_name, scope):
            logger.debug("Skipping Reddit media %s: extension filtered out", file_name)
            return None

        declared_mime = infer_mime_type_from_file_name(file_name)
        asset_kind = self._asset_kind_for_mime(declared_mime)
        media_hash = self.generate_hash_id(f"media_#_{url}")
        self._media_url_by_hash[media_hash] = url
        self._media_mime_by_hash[media_hash] = declared_mime
        self._attachment_name_by_hash[media_hash] = file_name

        metadata: dict[str, Any] = {
            "submission_id": submission_id,
            "subreddit": subreddit_name,
            "file_name": file_name,
            "source_url": url,
            "parent_hash": post_hash,
            "mime_type": declared_mime,
        }
        if gallery_index is not None:
            metadata["gallery_index"] = gallery_index
        if asset_kind == "video" and duration_seconds is not None:
            metadata["duration_seconds"] = duration_seconds

        return SingleAssetScanResults(
            hash=media_hash,
            checksum=self.calculate_checksum({"url": url, "file_name": file_name}),
            name=file_name,
            external_url=self.ensure_location(url),
            links=[post_hash],
            asset_type=self._asset_type_for_media(declared_mime, file_name),
            source_id=self.source_id,
            created_at=created_at,
            updated_at=created_at,
            runner_id=self.runner_id,
            **self.metadata_fields(asset_kind, metadata),
        )

    def _extension_allowed(self, file_name: str, scope: RedditOptionalScope) -> bool:
        extension = Path(urlsplit(file_name).path or file_name).suffix.lower()
        include = [self._normalize_extension(e) for e in (scope.include_file_extensions or [])]
        exclude = [self._normalize_extension(e) for e in (scope.exclude_file_extensions or [])]
        if include and extension not in include:
            return False
        return extension not in exclude

    @staticmethod
    def _normalize_extension(extension: str) -> str:
        cleaned = str(extension).strip().lower()
        if not cleaned:
            return ""
        return cleaned if cleaned.startswith(".") else f".{cleaned}"

    @staticmethod
    def _file_name_from_url(url: str) -> str:
        path = urlsplit(url).path
        name = Path(path).name if path else ""
        return name or "reddit-media"

    @staticmethod
    def _asset_kind_for_mime(mime_type: str) -> str:
        if mime_type.startswith("image/"):
            return "image"
        if mime_type.startswith(("video/", "audio/")):
            return "video"
        return "file"

    @staticmethod
    def _asset_type_for_media(mime_type: str, file_name: str) -> OutputAssetType:
        normalized = (mime_type or "").lower()
        if normalized.startswith("image/"):
            return OutputAssetType.IMAGE
        if normalized.startswith("video/"):
            return OutputAssetType.VIDEO
        if normalized.startswith("audio/"):
            return OutputAssetType.AUDIO
        if is_tabular_mime_type(normalized):
            return OutputAssetType.TABLE
        if normalized.startswith("text/"):
            return OutputAssetType.TXT
        extension = Path(urlsplit(file_name).path or file_name).suffix.lower()
        return _ASSET_TYPE_BY_EXTENSION.get(extension, OutputAssetType.BINARY)

    @staticmethod
    def _reddit_video_duration(submission: Any) -> int | None:
        media = getattr(submission, "media", None)
        if isinstance(media, dict):
            reddit_video = media.get("reddit_video")
            if isinstance(reddit_video, dict):
                duration = reddit_video.get("duration")
                if isinstance(duration, int):
                    return duration
        return None

    # ------------------------------------------------------------ linked videos

    def _external_video_assets_for(
        self,
        submission: Any,
        subreddit_name: str,
        submission_id: str,
        post_hash: str,
    ) -> list[SingleAssetScanResults]:
        if self._scope().include_external_videos is False:
            return []
        if getattr(submission, "is_self", False):
            return []

        url = str(getattr(submission, "url", "") or "")
        if not external_video.is_external_video_url(url):
            return []

        video_hash = self.generate_hash_id(f"video_#_{url}")
        self._external_video_url_by_hash[video_hash] = url
        created_at = self._created_at(submission)
        title = str(getattr(submission, "title", "") or "").strip() or url

        metadata: dict[str, Any] = {
            "submission_id": submission_id,
            "subreddit": subreddit_name,
            "video_url": url,
            "provider": external_video.video_provider(url),
            "title": title,
            "parent_hash": post_hash,
            "transcript_available": False,
        }

        asset = SingleAssetScanResults(
            hash=video_hash,
            checksum=self.calculate_checksum({"video_url": url, "detector_content": ""}),
            name=title,
            external_url=self.ensure_location(url),
            links=[post_hash],
            asset_type=OutputAssetType.TXT,
            source_id=self.source_id,
            created_at=created_at,
            updated_at=created_at,
            runner_id=self.runner_id,
            **self.metadata_fields("external_video", metadata),
        )
        self._external_video_assets[video_hash] = asset

        # Direct source usage (tests, local integrations) keeps the eager
        # behaviour; the CLI's two-phase runner sets discovery_only and resolves
        # the video lazily in fetch_content, bounded by max_concurrent_assets.
        if not self._discovery_only:
            self._populate_external_video(video_hash)
        return [asset]

    def _populate_external_video(self, video_hash: str) -> None:
        if video_hash in self._external_video_processed:
            return
        self._external_video_processed.add(video_hash)

        url = self._external_video_url_by_hash.get(video_hash)
        asset = self._external_video_assets.get(video_hash)
        if not url or asset is None:
            return

        connection = self._connection()
        info, transcript, visual_text = external_video.analyze_external_video(
            url,
            caller="Reddit",
            uv_groups=["reddit"],
            opts=external_video.base_ydl_opts(
                timeout_seconds=int(connection.timeout or 16),
            ),
        )

        parts: list[str] = []
        if transcript is not None:
            parts.append(f"[Transcript]\n{transcript.text}")
        if visual_text:
            parts.append(visual_text)
        detector_content = "\n\n".join(parts)

        asset.metadata["transcript_available"] = transcript is not None
        if transcript is not None:
            asset.metadata["transcript_source"] = transcript.source
            if transcript.language:
                asset.metadata["transcript_language"] = transcript.language
            if transcript.is_generated is not None:
                asset.metadata["transcript_is_generated"] = transcript.is_generated
        if isinstance(info, dict):
            duration = self._coerce_int(info.get("duration"))
            if duration is not None:
                asset.metadata["duration_seconds"] = duration

        asset.checksum = self.calculate_checksum(
            {"video_url": url, "detector_content": detector_content}
        )
        if detector_content:
            self._text_by_hash[video_hash] = (detector_content, detector_content)

    # ------------------------------------------------------------------ content

    async def fetch_content(self, asset_id: str) -> tuple[str, str] | None:
        if asset_id in self._external_video_url_by_hash:
            import asyncio

            await asyncio.to_thread(self._populate_external_video, asset_id)
            return self._text_by_hash.get(asset_id)

        cached = self._text_by_hash.get(asset_id)
        if cached is not None:
            return cached

        if asset_id in self._media_url_by_hash:
            return await self._fetch_media_text(asset_id)
        return None

    async def _fetch_media_text(self, asset_id: str) -> tuple[str, str] | None:
        bytes_result = await self.fetch_content_bytes(asset_id)
        if bytes_result is None:
            return None
        file_bytes, mime_type = bytes_result

        parsed = self.parse_asset_bytes(
            file_bytes,
            declared_mime_type=mime_type,
            file_name=self._attachment_file_name(asset_id, asset_id),
        )
        # Marked processed even with no text: the download and the extraction
        # already ran, and the pipeline's fallback would repeat both to the same
        # end.
        self._content_pages_processed.add(asset_id)
        if parsed.text_content:
            return parsed.raw_content, parsed.text_content
        return None

    async def fetch_content_bytes(self, asset_id: str) -> tuple[bytes, str] | None:
        url = self._media_url_by_hash.get(asset_id)
        if not url:
            return None

        try:
            file_bytes = self._download_media(url)
        except Exception as exc:
            logger.warning("Failed to download Reddit media %s: %s", url, exc)
            return None
        if not file_bytes:
            return None

        mime_type = resolve_mime_type(
            file_bytes,
            declared_mime_type=self._media_mime_by_hash.get(asset_id),
            file_name=self._attachment_file_name(asset_id, url),
        )
        return file_bytes, mime_type

    def _download_media(self, url: str) -> bytes:
        """Fetch media bytes, refusing anything past ``max_media_bytes``.

        Reddit media is served from public CDNs (i.redd.it, v.redd.it, preview
        hosts) and needs no OAuth header — but it also has no size ceiling, so
        the response is streamed and abandoned as soon as the cap is passed
        rather than after the whole file has landed in memory.
        """
        import requests

        limit = self._max_media_bytes()

        with requests.get(
            url,
            headers={"User-Agent": self.user_agent},
            timeout=int(self._connection().timeout or 16),
            allow_redirects=True,
            stream=True,
        ) as response:
            response.raise_for_status()
            declared_length = response.headers.get("Content-Length")
            if limit is not None and declared_length and int(declared_length) > limit:
                logger.info(
                    "Skipping Reddit media %s: %s bytes exceeds max_media_bytes (%d)",
                    url,
                    declared_length,
                    limit,
                )
                return b""

            chunks: list[bytes] = []
            total = 0
            for chunk in response.iter_content(chunk_size=1 << 16):
                if not chunk:
                    continue
                total += len(chunk)
                if limit is not None and total > limit:
                    logger.info(
                        "Skipping Reddit media %s: exceeded max_media_bytes (%d)", url, limit
                    )
                    return b""
                chunks.append(chunk)
        return b"".join(chunks)

    def evict_asset_cache(self, asset_hash: str) -> None:
        self._text_by_hash.pop(asset_hash, None)
        self._media_url_by_hash.pop(asset_hash, None)
        self._media_mime_by_hash.pop(asset_hash, None)
        self._external_video_url_by_hash.pop(asset_hash, None)
        self._external_video_assets.pop(asset_hash, None)
        self._external_video_processed.discard(asset_hash)
        self._content_pages_processed.discard(asset_hash)

    # ------------------------------------------------------------------ helpers

    def _permalink(self, permalink: Any) -> str:
        value = str(permalink or "").strip()
        if not value:
            return ""
        if value.startswith("http://") or value.startswith("https://"):
            return value
        return f"{self._reddit_base_url()}/{value.lstrip('/')}"

    @staticmethod
    def _author_name(obj: Any) -> str | None:
        author = getattr(obj, "author", None)
        if author is None:
            return "[deleted]"
        name = getattr(author, "name", None) or str(author)
        return str(name) or None

    @staticmethod
    def _created_at(obj: Any) -> datetime:
        created = getattr(obj, "created_utc", None)
        if isinstance(created, (int, float)):
            try:
                return datetime.fromtimestamp(float(created), tz=UTC)
            except (OverflowError, OSError, ValueError):
                pass
        return datetime.now(UTC)

    @staticmethod
    def _put_if_set(target: dict[str, Any], key: str, value: Any) -> None:
        if value is not None and value != "":
            target[key] = value

    @staticmethod
    def _coerce_int(value: Any) -> int | None:
        if isinstance(value, bool):
            return None
        if isinstance(value, int):
            return value
        if isinstance(value, float):
            return int(value)
        return None

    @staticmethod
    def _coerce_float(value: Any) -> float | None:
        if isinstance(value, bool):
            return None
        if isinstance(value, (int, float)):
            return float(value)
        return None

    @staticmethod
    def _coerce_bool(value: Any) -> bool | None:
        return value if isinstance(value, bool) else None
