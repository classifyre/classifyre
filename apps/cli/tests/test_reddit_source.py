"""Unit tests for the Reddit source.

PRAW is fully faked — no network, no credentials. Because these run under
pytest, ``metadata_fields`` validates every emitted asset against the
x-asset-metadata catalog in strict mode, so an asset that drifts from the
declared contract fails these tests automatically.
"""

from __future__ import annotations

from typing import Any, ClassVar

import pytest

from src.models.generated_single_asset_scan_results import AssetType as OutputAssetType
from src.sources.asset_metadata import resolve_fields
from src.sources.reddit import source as reddit_module
from src.sources.reddit.source import RedditSource
from src.utils import external_video

# ---------------------------------------------------------------------------
# PRAW doubles
# ---------------------------------------------------------------------------


class _FakeAuthor:
    def __init__(self, name: str) -> None:
        self.name = name


class _FakeComment:
    def __init__(
        self,
        comment_id: str,
        body: str,
        parent_id: str,
        *,
        depth: int = 0,
        score: int = 1,
        author: str = "commenter",
    ) -> None:
        self.id = comment_id
        self.body = body
        self.parent_id = parent_id
        self.depth = depth
        self.score = score
        self.author = _FakeAuthor(author)
        self.is_submitter = False
        self.stickied = False
        self.created_utc = 1767225600.0
        self.permalink = f"/r/testsub/comments/sub1/_/{comment_id}/"


class _FakeForest:
    def __init__(self, comments: list[_FakeComment]) -> None:
        self._comments = comments
        self.replace_more_limits: list[int | None] = []

    def replace_more(self, limit: int | None = 0) -> list[Any]:
        self.replace_more_limits.append(limit)
        return []

    def list(self) -> list[_FakeComment]:
        return list(self._comments)


class _FakeSubmission:
    def __init__(
        self,
        submission_id: str,
        *,
        title: str = "Demo post",
        selftext: str = "post body",
        is_self: bool = True,
        url: str = "",
        comments: list[_FakeComment] | None = None,
        media_metadata: dict[str, Any] | None = None,
        media: dict[str, Any] | None = None,
        over_18: bool = False,
        stickied: bool = False,
    ) -> None:
        self.id = submission_id
        self.title = title
        self.selftext = selftext
        self.is_self = is_self
        self.url = url or f"https://www.reddit.com/r/testsub/comments/{submission_id}/"
        self.permalink = f"/r/testsub/comments/{submission_id}/"
        self.author = _FakeAuthor("poster")
        self.score = 42
        self.upvote_ratio = 0.97
        self.num_comments = len(comments or [])
        self.link_flair_text = "Discussion"
        self.over_18 = over_18
        self.spoiler = False
        self.stickied = stickied
        self.locked = False
        self.domain = "self.testsub"
        self.created_utc = 1767225600.0
        self.comments = _FakeForest(comments or [])
        self.comment_sort = "top"
        if media_metadata is not None:
            self.media_metadata = media_metadata
        if media is not None:
            self.media = media


class _FakeSubreddit:
    def __init__(self, name: str, submissions: list[_FakeSubmission]) -> None:
        self.display_name = name
        self._submissions = submissions
        self.calls: list[tuple[str, Any, Any]] = []

    def _listing(self, kind: str, limit: Any, time_filter: Any = None) -> list[_FakeSubmission]:
        self.calls.append((kind, limit, time_filter))
        return self._submissions if limit is None else self._submissions[:limit]

    def new(self, limit: Any = None) -> list[_FakeSubmission]:
        return self._listing("new", limit)

    def hot(self, limit: Any = None) -> list[_FakeSubmission]:
        return self._listing("hot", limit)

    def rising(self, limit: Any = None) -> list[_FakeSubmission]:
        return self._listing("rising", limit)

    def top(self, time_filter: str = "all", limit: Any = None) -> list[_FakeSubmission]:
        return self._listing("top", limit, time_filter)

    def controversial(self, time_filter: str = "all", limit: Any = None) -> list[_FakeSubmission]:
        return self._listing("controversial", limit, time_filter)


class _FakeReddit:
    def __init__(
        self,
        subreddits: dict[str, _FakeSubreddit],
        *,
        read_only: bool = True,
    ) -> None:
        self._subreddits = subreddits
        # Matches a client built by _build_client, which always forces this on.
        self.read_only = read_only

    def subreddit(self, name: str) -> _FakeSubreddit:
        return self._subreddits[name]


# ---------------------------------------------------------------------------
# Fixtures / builders
# ---------------------------------------------------------------------------


def _recipe(**overrides: Any) -> dict[str, Any]:
    recipe: dict[str, Any] = {
        "type": "REDDIT",
        "required": {
            "auth_mode": "READ_ONLY",
            "subreddits": ["testsub"],
            "user_agent": "classifyre:test:v1 (by u/test)",
        },
        "masked": {"client_id": "cid", "client_secret": "csecret"},
        "sampling": {"strategy": "LATEST", "rows_per_page": 10},
    }
    recipe.update(overrides)
    return recipe


def _source(
    submissions: list[_FakeSubmission] | None = None,
    **overrides: Any,
) -> RedditSource:
    source = RedditSource(_recipe(**overrides), source_id="src-1", runner_id="run-1")
    if submissions is not None:
        subreddit = _FakeSubreddit("testsub", submissions)
        source._client = _FakeReddit({"testsub": subreddit})
    return source


async def _collect(source: RedditSource) -> list[Any]:
    assets: list[Any] = []
    async for batch in source.extract_raw():
        assets.extend(batch)
    return assets


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


def test_normalizes_subreddit_names_and_urls() -> None:
    source = _source(
        required={
            "auth_mode": "READ_ONLY",
            "subreddits": [
                "datasets",
                "r/MachineLearning",
                "https://www.reddit.com/r/datasets/",
                "  /r/python/  ",
            ],
            "user_agent": "classifyre:test:v1 (by u/test)",
        }
    )
    assert source.subreddits == ["datasets", "MachineLearning", "python"]


def test_requires_at_least_one_subreddit() -> None:
    with pytest.raises(ValueError, match="at least one subreddit"):
        RedditSource(
            _recipe(
                required={
                    "auth_mode": "READ_ONLY",
                    "subreddits": ["   "],
                    "user_agent": "classifyre:test:v1 (by u/test)",
                }
            )
        )


# ---------------------------------------------------------------------------
# Authentication — all three PRAW flows, always read-only
# ---------------------------------------------------------------------------


class _FakePrawReddit:
    last_kwargs: ClassVar[dict[str, Any]] = {}

    def __init__(self, **kwargs: Any) -> None:
        type(self).last_kwargs = kwargs
        self._read_only = False

    @property
    def read_only(self) -> bool:
        return self._read_only

    @read_only.setter
    def read_only(self, value: bool) -> None:
        self._read_only = value


@pytest.fixture()
def fake_praw(monkeypatch: pytest.MonkeyPatch) -> type[_FakePrawReddit]:
    class _Module:
        Reddit = _FakePrawReddit

    monkeypatch.setattr(reddit_module, "require_module", lambda *_args, **_kwargs: _Module)
    return _FakePrawReddit


@pytest.mark.parametrize(
    ("required_extra", "masked", "expected_keys"),
    [
        ({"auth_mode": "READ_ONLY"}, {"client_id": "cid", "client_secret": "sec"}, ()),
        (
            {"auth_mode": "SCRIPT"},
            {
                "client_id": "cid",
                "client_secret": "sec",
                "username": "bot",
                "password": "pw:123456",
            },
            ("username", "password"),
        ),
        (
            {"auth_mode": "REFRESH_TOKEN"},
            {"client_id": "cid", "refresh_token": "rt"},
            ("refresh_token",),
        ),
    ],
)
def test_every_auth_flow_builds_a_read_only_client(
    fake_praw: type[_FakePrawReddit],
    required_extra: dict[str, Any],
    masked: dict[str, Any],
    expected_keys: tuple[str, ...],
) -> None:
    source = _source(
        required={
            **required_extra,
            "subreddits": ["testsub"],
            "user_agent": "classifyre:test:v1 (by u/test)",
        },
        masked=masked,
    )
    client = source.client

    assert client.read_only is True, "read-only mode must be forced on for every auth flow"
    kwargs = fake_praw.last_kwargs
    assert kwargs["client_id"] == "cid"
    assert kwargs["user_agent"] == "classifyre:test:v1 (by u/test)"
    for key in expected_keys:
        assert kwargs[key] == masked[key]
    for key in ("username", "password", "refresh_token"):
        if key not in expected_keys:
            assert key not in kwargs


def test_client_passes_praw_basic_and_site_configuration(
    fake_praw: type[_FakePrawReddit],
) -> None:
    source = _source(
        optional={
            "connection": {
                "check_for_updates": True,
                "check_for_async": False,
                "ratelimit_seconds": 60,
                "timeout": 30,
                "window_size": 300,
            },
            "site": {
                "reddit_url": "https://reddit.internal",
                "oauth_url": "https://oauth.reddit.internal",
                "short_url": "https://rd.internal",
                "comment_kind": "t1_",
                "submission_kind": "t3_",
                "subreddit_kind": "t5_",
            },
        }
    )
    assert source.client is not None
    kwargs = fake_praw.last_kwargs

    assert kwargs["check_for_updates"] is True
    assert kwargs["check_for_async"] is False
    assert kwargs["ratelimit_seconds"] == 60
    assert kwargs["timeout"] == 30
    assert kwargs["window_size"] == 300
    assert kwargs["reddit_url"] == "https://reddit.internal"
    assert kwargs["oauth_url"] == "https://oauth.reddit.internal"
    assert kwargs["short_url"] == "https://rd.internal"
    assert kwargs["comment_kind"] == "t1_"
    assert kwargs["redditor_kind"] == "t2_"
    assert kwargs["submission_kind"] == "t3_"
    assert kwargs["message_kind"] == "t4_"
    assert kwargs["subreddit_kind"] == "t5_"
    assert kwargs["trophy_kind"] == "t6_"


def test_connection_reports_read_only_success() -> None:
    source = _source([_FakeSubmission("sub1")])
    result = source.test_connection()
    assert result["status"] == "SUCCESS"
    assert "read-only" in result["message"]


def test_connection_rejects_a_client_that_is_not_read_only() -> None:
    source = _source()
    source._client = _FakeReddit(
        {"testsub": _FakeSubreddit("testsub", [])},
        read_only=False,
    )
    result = source.test_connection()
    assert result["status"] == "FAILURE"
    assert "read-only" in result["message"]


def test_connection_failure_is_described(monkeypatch: pytest.MonkeyPatch) -> None:
    source = _source()

    def _raise(*_args: Any, **_kwargs: Any) -> Any:
        raise ImportError("Reddit source requires optional dependencies (praw)")

    monkeypatch.setattr(reddit_module, "require_module", _raise)
    result = source.test_connection()
    assert result["status"] == "FAILURE"
    assert "praw" in result["message"]


# ---------------------------------------------------------------------------
# Sampling strategies
# ---------------------------------------------------------------------------


def _submissions(count: int) -> list[_FakeSubmission]:
    return [_FakeSubmission(f"sub{i}", title=f"Post {i}") for i in range(count)]


@pytest.mark.asyncio
async def test_latest_takes_one_window_of_the_new_listing() -> None:
    source = _source(_submissions(30), sampling={"strategy": "LATEST", "rows_per_page": 10})
    assets = await _collect(source)
    subreddit = source._client.subreddit("testsub")

    assert subreddit.calls == [("new", 10, None)]
    assert len(assets) == 10


@pytest.mark.asyncio
async def test_all_walks_the_listing_unbounded() -> None:
    source = _source(_submissions(30), sampling={"strategy": "ALL"})
    assets = await _collect(source)
    subreddit = source._client.subreddit("testsub")

    assert subreddit.calls == [("new", None, None)]
    assert len(assets) == 30


@pytest.mark.asyncio
async def test_random_samples_a_stable_subset_of_a_larger_pool() -> None:
    source = _source(_submissions(40), sampling={"strategy": "RANDOM", "rows_per_page": 10})
    assets = await _collect(source)
    subreddit = source._client.subreddit("testsub")

    # HOT is the ranked cross-section RANDOM draws from, over a pool wider than
    # the window so the choice is actually spread.
    assert subreddit.calls[0][0] == "hot"
    assert subreddit.calls[0][1] == 40
    assert len(assets) == 10

    repeat = _source(_submissions(40), sampling={"strategy": "RANDOM", "rows_per_page": 10})
    repeat_assets = await _collect(repeat)
    assert [a.hash for a in repeat_assets] == [a.hash for a in assets]


@pytest.mark.asyncio
async def test_automatic_advances_a_cursor_and_wraps() -> None:
    source = _source(_submissions(25), sampling={"strategy": "AUTOMATIC", "rows_per_page": 10})
    first = await _collect(source)
    cursor = source.current_sampling_cursor()

    assert len(first) == 10
    assert cursor == {"subreddit:testsub": 10}

    # Second run resumes where the first stopped.
    resumed = _source(_submissions(25), sampling={"strategy": "AUTOMATIC", "rows_per_page": 10})
    resumed._sampling_cursor = {"subreddit:testsub": 10}
    second = await _collect(resumed)
    assert [a.metadata["submission_id"] for a in second] == [f"sub{i}" for i in range(10, 20)]

    # Third run covers the tail and wraps back to the start.
    tail = _source(_submissions(25), sampling={"strategy": "AUTOMATIC", "rows_per_page": 10})
    tail._sampling_cursor = {"subreddit:testsub": 20}
    await _collect(tail)
    assert tail.current_sampling_cursor() == {"subreddit:testsub": 0}


@pytest.mark.asyncio
async def test_scope_filters_nsfw_and_stickied() -> None:
    submissions = [
        _FakeSubmission("keep"),
        _FakeSubmission("nsfw", over_18=True),
        _FakeSubmission("pinned", stickied=True),
    ]
    source = _source(
        submissions,
        sampling={"strategy": "ALL"},
        optional={"scope": {"exclude_nsfw": True, "exclude_stickied": True}},
    )
    assets = await _collect(source)
    assert [a.metadata["submission_id"] for a in assets] == ["keep"]


# ---------------------------------------------------------------------------
# Post -> comment -> reply threading
# ---------------------------------------------------------------------------


def _threaded_submission() -> _FakeSubmission:
    return _FakeSubmission(
        "sub1",
        comments=[
            _FakeComment("c1", "top level one", "t3_sub1"),
            _FakeComment("c2", "reply to c1", "t1_c1", depth=1),
            _FakeComment("c3", "reply to c2", "t1_c2", depth=2),
            _FakeComment("c4", "top level two", "t3_sub1"),
        ],
    )


@pytest.mark.asyncio
async def test_post_and_comments_form_a_navigable_thread() -> None:
    source = _source([_threaded_submission()], sampling={"strategy": "ALL"})
    assets = await _collect(source)

    by_kind: dict[str, list[Any]] = {}
    for asset in assets:
        by_kind.setdefault(asset.asset_kind, []).append(asset)

    post = by_kind["post"][0]
    comments = {a.metadata["comment_id"]: a for a in by_kind["comment"]}
    assert set(comments) == {"c1", "c2", "c3", "c4"}

    # The submission links its top-level comments only.
    assert post.links == [comments["c1"].hash, comments["c4"].hash]
    assert post.metadata["links_count"] == 2

    # Each comment links its parent first, then its own replies — so a thread is
    # walkable from either end.
    assert comments["c1"].links == [post.hash, comments["c2"].hash]
    assert comments["c1"].metadata["parent_hash"] == post.hash
    assert comments["c1"].metadata["parent_fullname"] == "t3_sub1"
    assert comments["c1"].metadata["reply_count"] == 1

    assert comments["c2"].links == [comments["c1"].hash, comments["c3"].hash]
    assert comments["c2"].metadata["parent_hash"] == comments["c1"].hash
    assert comments["c3"].links == [comments["c2"].hash]
    assert comments["c4"].links == [post.hash]


@pytest.mark.asyncio
async def test_comment_limit_and_more_comments_expansion() -> None:
    submission = _threaded_submission()
    source = _source(
        [submission],
        sampling={"strategy": "ALL"},
        optional={"scope": {"max_comments_per_post": 2, "expand_more_comments": True}},
    )
    assets = await _collect(source)
    comments = [a for a in assets if a.asset_kind == "comment"]

    assert len(comments) == 2
    # limit=None means "expand every 'load more comments' placeholder".
    assert submission.comments.replace_more_limits == [None]


@pytest.mark.asyncio
async def test_comments_can_be_switched_off() -> None:
    source = _source(
        [_threaded_submission()],
        sampling={"strategy": "ALL"},
        optional={"scope": {"include_comments": False}},
    )
    assets = await _collect(source)
    assert all(a.asset_kind != "comment" for a in assets)


@pytest.mark.asyncio
async def test_post_and_comment_text_is_served_as_detector_content() -> None:
    source = _source([_threaded_submission()], sampling={"strategy": "ALL"})
    assets = await _collect(source)
    post = next(a for a in assets if a.asset_kind == "post")
    comment = next(a for a in assets if a.asset_kind == "comment")

    assert await source.fetch_content(post.hash) == ("Demo post\n\npost body",) * 2
    assert await source.fetch_content(comment.hash) == ("top level one", "top level one")


# ---------------------------------------------------------------------------
# Media assets
# ---------------------------------------------------------------------------


def _gallery_submission() -> _FakeSubmission:
    return _FakeSubmission(
        "sub1",
        is_self=False,
        url="https://www.reddit.com/gallery/sub1",
        media_metadata={
            "abc": {"s": {"u": "https://i.redd.it/abc.png?width=100&amp;auto=webp"}},
            "def": {"s": {"u": "https://i.redd.it/def.jpg"}},
        },
    )


@pytest.mark.asyncio
async def test_gallery_media_becomes_linked_image_assets() -> None:
    source = _source([_gallery_submission()], sampling={"strategy": "ALL"})
    assets = await _collect(source)

    post = next(a for a in assets if a.asset_kind == "post")
    images = [a for a in assets if a.asset_kind == "image"]

    assert [a.metadata["file_name"] for a in images] == ["abc.png", "def.jpg"]
    assert [a.metadata["gallery_index"] for a in images] == [0, 1]
    assert all(a.links == [post.hash] for a in images)
    assert all(a.metadata["parent_hash"] == post.hash for a in images)
    assert post.links == [images[0].hash, images[1].hash]
    assert all(a.asset_type == OutputAssetType.IMAGE for a in images)
    # HTML-escaped query separators must be repaired or the CDN 403s.
    assert "&amp;" not in source._media_url_by_hash[images[0].hash]


@pytest.mark.asyncio
async def test_reddit_hosted_video_and_linked_document_become_assets() -> None:
    submission = _FakeSubmission(
        "sub1",
        is_self=False,
        url="https://example.com/whitepaper.pdf",
        media={
            "reddit_video": {"fallback_url": "https://v.redd.it/xyz/DASH_480.mp4", "duration": 61}
        },
    )
    source = _source([submission], sampling={"strategy": "ALL"})
    assets = await _collect(source)

    video = next(a for a in assets if a.asset_kind == "video")
    document = next(a for a in assets if a.asset_kind == "file")

    assert video.asset_type == OutputAssetType.VIDEO
    assert video.metadata["duration_seconds"] == 61
    assert document.metadata["file_name"] == "whitepaper.pdf"
    assert document.asset_type == OutputAssetType.BINARY


@pytest.mark.asyncio
async def test_linked_web_pages_are_not_downloaded() -> None:
    submission = _FakeSubmission("sub1", is_self=False, url="https://example.com/some/article")
    source = _source([submission], sampling={"strategy": "ALL"})
    assets = await _collect(source)
    assert [a.asset_kind for a in assets] == ["post"]


@pytest.mark.asyncio
async def test_media_extension_filters_apply() -> None:
    source = _source(
        [_gallery_submission()],
        sampling={"strategy": "ALL"},
        optional={"scope": {"include_file_extensions": ["png"]}},
    )
    assets = await _collect(source)
    assert [a.metadata["file_name"] for a in assets if a.asset_kind == "image"] == ["abc.png"]


@pytest.mark.asyncio
async def test_media_can_be_switched_off() -> None:
    source = _source(
        [_gallery_submission()],
        sampling={"strategy": "ALL"},
        optional={"scope": {"include_media": False}},
    )
    assets = await _collect(source)
    assert all(a.asset_kind != "image" for a in assets)


@pytest.mark.asyncio
async def test_media_bytes_are_parsed_by_the_shared_file_pipeline(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = _source([_gallery_submission()], sampling={"strategy": "ALL"})
    assets = await _collect(source)
    image = next(a for a in assets if a.asset_kind == "image")

    png = b"\x89PNG\r\n\x1a\n" + b"0" * 64
    monkeypatch.setattr(RedditSource, "_download_media", lambda _self, _url: png)

    captured: dict[str, Any] = {}

    def _parse(_self: Any, file_bytes: bytes, **kwargs: Any) -> Any:
        captured.update({"bytes": file_bytes, **kwargs})

        class _Parsed:
            raw_content = ""
            text_content = "text from OCR"

        return _Parsed()

    monkeypatch.setattr(RedditSource, "parse_asset_bytes", _parse)

    assert await source.fetch_content(image.hash) == ("", "text from OCR")
    assert captured["bytes"] == png
    assert captured["file_name"] == "abc.png"


def test_download_media_abandons_oversize_responses(monkeypatch: pytest.MonkeyPatch) -> None:
    source = _source(optional={"scope": {"max_media_bytes": 100}})

    class _Response:
        headers: ClassVar[dict[str, str]] = {}

        def __enter__(self) -> _Response:
            return self

        def __exit__(self, *_: Any) -> bool:
            return False

        def raise_for_status(self) -> None:
            return None

        def iter_content(self, chunk_size: int = 0) -> Any:
            _ = chunk_size
            yield b"x" * 80
            yield b"x" * 80

    import requests

    monkeypatch.setattr(requests, "get", lambda *_a, **_k: _Response())
    assert source._download_media("https://i.redd.it/big.png") == b""


# ---------------------------------------------------------------------------
# Linked (external) videos — shared YouTube pipeline
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_linked_youtube_video_uses_the_shared_video_pipeline(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[dict[str, Any]] = []

    def _analyze(url: str, **kwargs: Any) -> Any:
        calls.append({"url": url, **kwargs})
        return (
            {"duration": 212},
            external_video.TranscriptResult(
                text="spoken words",
                language="en",
                is_generated=True,
                source="captions",
            ),
            "[Frame 00:10]\non-screen text",
        )

    monkeypatch.setattr(external_video, "analyze_external_video", _analyze)

    submission = _FakeSubmission(
        "sub1", is_self=False, url="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    )
    source = _source([submission], sampling={"strategy": "ALL"})
    assets = await _collect(source)

    post = next(a for a in assets if a.asset_kind == "post")
    video = next(a for a in assets if a.asset_kind == "external_video")

    assert calls and calls[0]["caller"] == "Reddit"
    assert calls[0]["uv_groups"] == ["reddit"]
    assert video.links == [post.hash]
    assert video.metadata["provider"] == "youtube.com"
    assert video.metadata["transcript_available"] is True
    assert video.metadata["transcript_source"] == "captions"
    assert video.metadata["transcript_language"] == "en"
    assert video.metadata["duration_seconds"] == 212

    raw, text = await source.fetch_content(video.hash)
    assert "spoken words" in text
    assert "on-screen text" in raw


@pytest.mark.asyncio
async def test_linked_videos_can_be_switched_off(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        external_video,
        "analyze_external_video",
        lambda *_a, **_k: pytest.fail("should not analyse a video when disabled"),
    )
    submission = _FakeSubmission("sub1", is_self=False, url="https://youtu.be/dQw4w9WgXcQ")
    source = _source(
        [submission],
        sampling={"strategy": "ALL"},
        optional={"scope": {"include_external_videos": False}},
    )
    assets = await _collect(source)
    assert all(a.asset_kind != "external_video" for a in assets)


# ---------------------------------------------------------------------------
# Asset metadata contract
# ---------------------------------------------------------------------------


def test_asset_metadata_catalog_declares_every_emitted_kind() -> None:
    for kind in ("post", "comment", "image", "video", "file", "external_video"):
        fields = resolve_fields("reddit", kind)
        assert fields, f"reddit/{kind} resolved to no fields"

    post_fields = {f["name"]: f for f in resolve_fields("reddit", "post")}
    assert post_fields["submission_id"]["required"] is True
    assert post_fields["links_count"]["required"] is True

    comment_fields = {f["name"]: f for f in resolve_fields("reddit", "comment")}
    assert comment_fields["parent_hash"]["required"] is False
    assert comment_fields["comment_id"]["required"] is True
