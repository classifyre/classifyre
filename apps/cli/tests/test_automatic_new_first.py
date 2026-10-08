"""AUTOMATIC reads what is new first, then the backfill, and does not start over.

The mechanics are tested in ``test_sampling_frontier.py``. These are the same
promises checked through real sources, each against a fake of the thing it
reads from, starting with the case that prompted the change: files added to a
local folder that went unread because the sweep had moved on.
"""

from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Any

import pytest

from src.notebook.sdk import Context
from src.sources.local_folder.source import LocalFolderSource
from src.sources.mongodb.source import CollectionRef, MongoDBSource
from src.sources.wordpress.source import WordPressSource
from src.sources.youtube.source import YouTubeSource
from src.utils.sampling_cursor import encode_sampling_cursor

CURSOR_ENV = "CLASSIFYRE_SAMPLING_CURSOR"
DAY = 86_400


def _use_cursor(monkeypatch: pytest.MonkeyPatch, cursor: dict[str, Any] | None) -> None:
    if cursor:
        monkeypatch.setenv(CURSOR_ENV, encode_sampling_cursor(cursor))
    else:
        monkeypatch.delenv(CURSOR_ENV, raising=False)


# ── Local folder ─────────────────────────────────────────────────────────


def _write(folder: Path, name: str, *, days_old: float) -> None:
    path = folder / name
    path.write_text(name)
    stamp = time.time() - days_old * DAY
    os.utime(path, (stamp, stamp))


def _folder_run(
    monkeypatch: pytest.MonkeyPatch, folder: Path, cursor: dict[str, Any] | None
) -> tuple[list[str], dict[str, Any] | None]:
    """One AUTOMATIC scan of the folder: the files it picked and the cursor it leaves."""
    _use_cursor(monkeypatch, cursor)
    source = LocalFolderSource(
        {
            "type": "LOCAL_FOLDER",
            "required": {"path": str(folder)},
            "masked": {},
            "optional": {},
            "sampling": {"strategy": "AUTOMATIC", "rows_per_page": 10},
        },
        source_id="s",
        runner_id="r",
    )
    window = [ref.key for ref in source._apply_sampling(source._list_objects())]
    next_cursor = source.current_sampling_cursor()
    return window, next_cursor if next_cursor is not None else cursor


def _settle() -> None:
    # Change times are stamped from a coarse clock; step past its granularity
    # so "created afterwards" is also "has a later change time".
    time.sleep(0.05)


def test_files_added_to_a_folder_are_read_before_the_sweep_goes_on(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    for index in range(25):
        _write(tmp_path, f"old-{index:02d}.txt", days_old=30 + index)
    first, cursor = _folder_run(monkeypatch, tmp_path, None)
    assert len(first) == 10

    _settle()
    for index in range(3):
        _write(tmp_path, f"new-{index}.txt", days_old=0)

    second, cursor = _folder_run(monkeypatch, tmp_path, cursor)
    assert sorted(second[:3]) == ["new-0.txt", "new-1.txt", "new-2.txt"]
    # The rest of the window is the backfill, and none of it was read before.
    assert len(second) == 10
    assert not set(second) & set(first)


def test_a_file_copied_in_with_its_old_date_is_still_new(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Finder, `cp -p`, rsync and unzip all keep a file's modification time, so
    # a file dropped in today can be dated last year.
    for index in range(5):
        _write(tmp_path, f"old-{index}.txt", days_old=10 + index)
    _, cursor = _folder_run(monkeypatch, tmp_path, None)
    assert cursor is not None and cursor["objects"]["done"] is True

    _settle()
    _write(tmp_path, "copied-in.txt", days_old=400)

    window, cursor = _folder_run(monkeypatch, tmp_path, cursor)
    assert window == ["copied-in.txt"]
    # And then nothing: the sweep has finished and does not start over.
    assert _folder_run(monkeypatch, tmp_path, cursor)[0] == []


def test_every_file_is_read_once_however_the_folder_changes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    for index in range(37):
        _write(tmp_path, f"f-{index:02d}.txt", days_old=1 + index)

    read: list[str] = []
    cursor: dict[str, Any] | None = None
    for run in range(9):
        if run == 2:
            _settle()
            for index in range(14):  # more than one window of new files
                _write(tmp_path, f"added-{index:02d}.txt", days_old=0)
        if run == 4:
            (tmp_path / "f-36.txt").unlink()
        window, cursor = _folder_run(monkeypatch, tmp_path, cursor)
        read += window

    on_disk = sorted(path.name for path in tmp_path.iterdir())
    assert sorted(name for name in read if name != "f-36.txt") == [
        name for name in on_disk if name != "f-36.txt"
    ]
    assert len(read) == len(set(read))
    assert _folder_run(monkeypatch, tmp_path, cursor)[0] == []


def test_a_mount_that_rewrites_change_times_falls_back_to_modification_time(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    for index in range(25):
        _write(tmp_path, f"f-{index:02d}.txt", days_old=1 + index)

    def touch_everything() -> None:
        # What a volume re-owned at every pod start does: every file's change
        # time moves, no file's content or modification time does.
        _settle()
        for path in tmp_path.iterdir():
            path.chmod(0o644 if path.stat().st_mode & 0o020 else 0o664)

    _, cursor = _folder_run(monkeypatch, tmp_path, None)

    # Once is a folder that was replaced, and is read as one.
    touch_everything()
    _, cursor = _folder_run(monkeypatch, tmp_path, cursor)
    assert cursor is not None and cursor.get("objects_order") != "modified"

    # Twice in a row is the mount. From here the folder is ordered by
    # modification time and the sweep makes progress whatever the mount does.
    touch_everything()
    first, cursor = _folder_run(monkeypatch, tmp_path, cursor)
    assert cursor is not None and cursor["objects_order"] == "modified"
    assert first == [f"f-{index:02d}.txt" for index in range(10)]

    touch_everything()
    second, cursor = _folder_run(monkeypatch, tmp_path, cursor)
    assert second == [f"f-{index:02d}.txt" for index in range(10, 20)]

    touch_everything()
    third, cursor = _folder_run(monkeypatch, tmp_path, cursor)
    assert third == [f"f-{index:02d}.txt" for index in range(20, 25)]
    touch_everything()
    assert _folder_run(monkeypatch, tmp_path, cursor)[0] == []


# ── WordPress ────────────────────────────────────────────────────────────


class _FakeSite:
    """A WordPress posts endpoint: newest-modified first, filtered, paged."""

    def __init__(self, *, knows_modified_filters: bool = True, offset_hours: int = 0) -> None:
        self.posts: list[dict[str, Any]] = []
        self.requests: list[dict[str, Any]] = []
        self._filters = knows_modified_filters
        self._offset = offset_hours * 3600

    def add(self, post_id: int, modified_gmt_seconds: int) -> None:
        self.posts = [post for post in self.posts if post["id"] != post_id]
        self.posts.append(
            {
                "id": post_id,
                "_gmt": modified_gmt_seconds,
                "modified_gmt": self._iso(modified_gmt_seconds),
                "modified": self._iso(modified_gmt_seconds + self._offset),
            }
        )

    @staticmethod
    def _iso(seconds: int) -> str:
        return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(seconds))

    def get(self, _url: str, params: dict[str, Any], timeout: int = 0) -> Any:
        self.requests.append(dict(params))
        rows = sorted(self.posts, key=lambda post: (post["_gmt"], post["id"]), reverse=True)
        if self._filters:
            # The real filter compares the site-local `modified` column.
            if "modified_before" in params:
                rows = [row for row in rows if row["modified"] < params["modified_before"]]
        per_page, page = int(params["per_page"]), int(params["page"])
        chunk = rows[(page - 1) * per_page : page * per_page]

        class _Response:
            status_code = 200
            headers = {"X-WP-TotalPages": str(max(1, -(-len(rows) // per_page)))}  # noqa: RUF012

            @staticmethod
            def raise_for_status() -> None:
                return None

            @staticmethod
            def json() -> list[dict[str, Any]]:
                return [{k: v for k, v in row.items() if k != "_gmt"} for row in chunk]

        return _Response()


def _wordpress_run(
    monkeypatch: pytest.MonkeyPatch, site: _FakeSite, cursor: dict[str, Any] | None
) -> tuple[list[int], dict[str, Any] | None]:
    _use_cursor(monkeypatch, cursor)
    source = WordPressSource(
        {
            "type": "WORDPRESS",
            "required": {"url": "https://example.com"},
            "sampling": {"strategy": "AUTOMATIC", "rows_per_page": 10},
        }
    )
    source.session = site  # type: ignore[assignment]
    items = source.automatic_ranged_window(
        key="wp:posts",
        order=source._modified_order,
        fetch=lambda lower, upper: source._iter_modified_range(
            "posts", "https://example.com/wp-json/wp/v2/posts", lower, upper
        ),
    )
    next_cursor = source.current_sampling_cursor()
    return [item["id"] for item in items], next_cursor if next_cursor is not None else cursor


@pytest.mark.parametrize(
    ("knows_filters", "offset_hours"),
    [(True, 0), (True, 11), (True, -8), (False, 0)],
    ids=["utc-site", "site-ahead-of-utc", "site-behind-utc", "site-too-old-to-filter"],
)
def test_wordpress_reads_edited_posts_first_and_every_post_once(
    monkeypatch: pytest.MonkeyPatch, knows_filters: bool, offset_hours: int
) -> None:
    site = _FakeSite(knows_modified_filters=knows_filters, offset_hours=offset_hours)
    base = 1_760_000_000
    for post_id in range(1, 36):
        site.add(post_id, base + post_id * 3600)

    first, cursor = _wordpress_run(monkeypatch, site, None)
    assert first == list(range(35, 25, -1))

    # A new post and an edit to one read long ago: both come first, and the
    # backfill then carries on from 25 -- a page number would have re-read 26
    # and 27, which the two changes pushed down the listing.
    site.add(36, base + 40 * 3600)
    site.add(30, base + 41 * 3600)
    second, cursor = _wordpress_run(monkeypatch, site, cursor)
    assert second[:2] == [30, 36]
    assert second[2:] == list(range(25, 17, -1))

    read = first + second
    for _ in range(6):
        window, cursor = _wordpress_run(monkeypatch, site, cursor)
        read += window
    # Post 30 twice (it was edited); every other post exactly once.
    assert sorted(read) == sorted([*range(1, 37), 30])
    assert _wordpress_run(monkeypatch, site, cursor)[0] == []


def test_wordpress_asks_only_for_the_ranges_it_needs(monkeypatch: pytest.MonkeyPatch) -> None:
    site = _FakeSite()
    base = 1_760_000_000
    for post_id in range(1, 501):
        site.add(post_id, base + post_id * 3600)

    _, cursor = _wordpress_run(monkeypatch, site, None)
    site.requests.clear()
    _wordpress_run(monkeypatch, site, cursor)

    # One request for what is new and one for the next slice: not the 5 pages
    # the whole site would take.
    assert len(site.requests) == 2
    assert "modified_before" not in site.requests[0]
    assert "modified_before" in site.requests[1]


# ── MongoDB ──────────────────────────────────────────────────────────────


class _Query:
    def __init__(self, documents: list[dict[str, Any]]) -> None:
        self._documents = documents

    def sort(self, _field: str, direction: int) -> _Query:
        return _Query(sorted(self._documents, key=lambda d: d["_id"], reverse=direction < 0))

    def skip(self, count: int) -> _Query:
        return _Query(self._documents[count:])

    def limit(self, count: int) -> _Query:
        return _Query(self._documents[:count])

    def __iter__(self) -> Any:
        return iter(self._documents)


class _Collection:
    def __init__(self, ids: list[Any]) -> None:
        self.documents = [{"_id": value} for value in ids]

    def find(self, query: dict[str, Any] | None = None, _projection: Any = None) -> _Query:
        bounds = (query or {}).get("_id", {})
        return _Query(
            [
                document
                for document in self.documents
                if ("$gt" not in bounds or document["_id"] > bounds["$gt"])
                and ("$lt" not in bounds or document["_id"] < bounds["$lt"])
            ]
        )


def _mongo_run(
    monkeypatch: pytest.MonkeyPatch, collection: _Collection, cursor: dict[str, Any] | None
) -> tuple[list[Any], dict[str, Any] | None]:
    _use_cursor(monkeypatch, cursor)
    monkeypatch.setattr("src.sources.mongodb.source.require_module", lambda **_kwargs: object())
    source = MongoDBSource(
        {
            "type": "MONGODB",
            "required": {"deployment": "ATLAS", "cluster_host": "cluster.example.net"},
            "masked": {"username": "scanner", "password": "secret"},
            "optional": {"scope": {"database": "app"}},
            "sampling": {"strategy": "AUTOMATIC", "rows_per_page": 10},
        }
    )
    documents = source._automatic_documents(
        collection, CollectionRef(database="app", collection="events"), 10
    )
    next_cursor = source.current_sampling_cursor()
    return [d["_id"] for d in documents], next_cursor if next_cursor is not None else cursor


def test_mongodb_reads_new_documents_first_when_ids_increase(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    collection = _Collection(list(range(1, 26)))
    first, cursor = _mongo_run(monkeypatch, collection, None)
    assert first == list(range(25, 15, -1))

    collection.documents += [{"_id": 26}, {"_id": 27}]
    second, cursor = _mongo_run(monkeypatch, collection, cursor)
    assert second == [27, 26, *range(15, 7, -1)]

    third, cursor = _mongo_run(monkeypatch, collection, cursor)
    assert third == list(range(7, 0, -1))
    assert cursor is not None and cursor["collection:app.events"]["done"] is True
    assert _mongo_run(monkeypatch, collection, cursor)[0] == []


def test_mongodb_wraps_when_ids_do_not_order_by_age(monkeypatch: pytest.MonkeyPatch) -> None:
    collection = _Collection([f"key-{n:02d}" for n in range(15)])
    first, cursor = _mongo_run(monkeypatch, collection, None)
    assert cursor == {"collection:app.events": 10}
    second, cursor = _mongo_run(monkeypatch, collection, cursor)
    assert len(first) == 10 and len(second) == 5
    assert cursor == {"collection:app.events": 0}
    # Round again: with nothing to tell new from old, this is how new ones are seen.
    assert len(_mongo_run(monkeypatch, collection, cursor)[0]) == 10


# ── YouTube ──────────────────────────────────────────────────────────────


def _youtube_run(
    monkeypatch: pytest.MonkeyPatch, uploads: list[str], cursor: dict[str, Any] | None
) -> tuple[list[str], dict[str, Any] | None]:
    _use_cursor(monkeypatch, cursor)
    source = YouTubeSource(
        {
            "type": "YOUTUBE",
            "required": {"channels": ["@channel"]},
            "sampling": {"strategy": "AUTOMATIC", "rows_per_page": 10},
        },
        source_id="src-1",
        runner_id="run-1",
    )
    monkeypatch.setattr(source, "_list_channel_video_ids", lambda _c, _l: list(uploads))
    ids = source._resolve_target_video_ids()
    next_cursor = source.current_sampling_cursor()
    return ids, next_cursor if next_cursor is not None else cursor


def test_youtube_reads_new_uploads_first_then_the_back_catalogue(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    uploads = [f"v{n:02d}" for n in range(24, -1, -1)]  # newest first
    first, cursor = _youtube_run(monkeypatch, uploads, None)
    assert first == uploads[:10]

    uploads = ["v26", "v25", *uploads]
    second, cursor = _youtube_run(monkeypatch, uploads, cursor)
    assert second == ["v26", "v25", *uploads[12:20]]

    third, cursor = _youtube_run(monkeypatch, uploads, cursor)
    assert third == uploads[20:]
    assert _youtube_run(monkeypatch, uploads, cursor)[0] == []


# ── Notebook SDK ─────────────────────────────────────────────────────────


def _docs(count: int, start: int = 0) -> list[dict[str, Any]]:
    return [{"id": f"d{n:02d}", "updated": n} for n in range(start, start + count)]


def _order(doc: dict[str, Any]) -> tuple[int, str]:
    return doc["updated"], doc["id"]


def test_ctx_newest_first_keeps_its_place_beside_the_notebooks_own_cursor() -> None:
    ctx = Context(sampling={"strategy": "ALL", "rows_per_page": 4}, cursor={"mine": 1})
    first = ctx.newest_first(_docs(10), order=_order)
    assert [doc["id"] for doc in first] == ["d09", "d08", "d07", "d06"]
    assert ctx.partial_coverage is True
    cursor = ctx.next_cursor
    assert cursor is not None and cursor["mine"] == 1

    ctx = Context(sampling={"strategy": "ALL", "rows_per_page": 4}, cursor=cursor)
    ctx.set_cursor({"mine": 2})
    second = ctx.newest_first([*_docs(10), *_docs(1, start=10)], order=_order)
    assert [doc["id"] for doc in second] == ["d10", "d05", "d04", "d03"]
    assert ctx.next_cursor is not None and ctx.next_cursor["mine"] == 2


def test_ctx_config_changed_restarts_newest_first_and_leaves_the_rest() -> None:
    ctx = Context(sampling={"rows_per_page": 4}, cursor={"mine": 1})
    ctx.newest_first(_docs(10), order=_order)
    cursor = ctx.next_cursor

    unchanged = Context(sampling={"rows_per_page": 4}, cursor=cursor)
    assert unchanged.config_changed is False
    assert [d["id"] for d in unchanged.newest_first(_docs(10), order=_order)] == [
        "d05",
        "d04",
        "d03",
        "d02",
    ]

    changed = Context(sampling={"rows_per_page": 4}, cursor=cursor, config_changed=True)
    assert changed.config_changed is True
    # The notebook's own state is still there for it to decide about...
    assert changed.cursor["mine"] == 1
    # ...while the helper starts its sweep from scratch.
    assert [d["id"] for d in changed.newest_first(_docs(10), order=_order)] == [
        "d09",
        "d08",
        "d07",
        "d06",
    ]
