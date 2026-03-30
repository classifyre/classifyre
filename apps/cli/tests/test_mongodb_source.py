from __future__ import annotations

from typing import Any

import pytest

from src.sources.mongodb.source import CollectionRef, MongoDBSource


def _recipe(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "type": "MONGODB",
        "required": {
            "deployment": "ATLAS",
            "cluster_host": "finanzen.rtlj1gu.mongodb.net",
        },
        "masked": {
            "username": "scanner",
            "password": "secret",
        },
        "optional": {
            "connection": {
                "auth_mechanism": "SCRAM-SHA-256",
                "app_name": "classifyre-test",
            },
            "scope": {
                "database": "finanzen",
                "include_all_databases": False,
                "include_collections": ["transactions", "users"],
            },
        },
        "sampling": {
            "strategy": "RANDOM",
            "limit": 10,
        },
    }
    base.update(overrides)
    return base


@pytest.fixture(autouse=True)
def _patch_optional_dep(monkeypatch: pytest.MonkeyPatch) -> None:
    class _FakePyMongo:
        DESCENDING = -1

        class MongoClient:
            def __init__(self, *_args: Any, **_kwargs: Any) -> None:  # pragma: no cover
                raise AssertionError("MongoClient should be monkeypatched by test")

    monkeypatch.setattr(
        "src.sources.mongodb.source.require_module",
        lambda **_kwargs: _FakePyMongo(),
    )


class _FakeCursor:
    def __init__(self, docs: list[dict[str, Any]]) -> None:
        self._docs = list(docs)

    def sort(self, field: str, direction: int) -> _FakeCursor:
        reverse = direction < 0
        self._docs.sort(key=lambda doc: doc.get(field), reverse=reverse)
        return self

    def limit(self, size: int) -> _FakeCursor:
        self._docs = self._docs[:size]
        return self

    def __iter__(self):
        return iter(self._docs)


class _FakeCollection:
    def __init__(self, docs: list[dict[str, Any]]) -> None:
        self.docs = docs
        self.last_pipeline: list[dict[str, Any]] | None = None

    def aggregate(
        self,
        pipeline: list[dict[str, Any]],
        allow_disk_use: bool = False,
        **_kwargs: Any,
    ) -> list[dict[str, Any]]:
        _ = allow_disk_use
        self.last_pipeline = pipeline
        size = pipeline[0].get("$sample", {}).get("size", len(self.docs))
        return list(self.docs[:size])

    def find(self, _filter: dict[str, Any]) -> _FakeCursor:
        return _FakeCursor(list(self.docs))

    def count_documents(self, query: dict[str, Any], limit: int = 0) -> int:
        field = next(iter(query.keys()))
        matches = [doc for doc in self.docs if field in doc and doc[field] is not None]
        if limit > 0:
            return min(len(matches), limit)
        return len(matches)


class _FakeDatabase:
    def __init__(self, collections: dict[str, _FakeCollection]) -> None:
        self._collections = collections

    def list_collection_names(self) -> list[str]:
        return sorted(self._collections.keys())

    def __getitem__(self, name: str) -> _FakeCollection:
        return self._collections[name]


class _FakeAdmin:
    def command(self, cmd: str) -> dict[str, int]:
        if cmd != "ping":
            raise AssertionError(f"Unexpected command: {cmd}")
        return {"ok": 1}


class _FakeMongoClient:
    def __init__(self, databases: dict[str, _FakeDatabase]) -> None:
        self._databases = databases
        self.admin = _FakeAdmin()

    def list_database_names(self) -> list[str]:
        return sorted(self._databases.keys())

    def __getitem__(self, name: str) -> _FakeDatabase:
        return self._databases[name]

    def close(self) -> None:
        return None


def test_mongodb_builds_expected_connection_uris() -> None:
    atlas_source = MongoDBSource(_recipe())
    onprem_source = MongoDBSource(
        _recipe(
            required={"deployment": "ON_PREM", "host": "mongo.local", "port": 27018},
        )
    )

    assert atlas_source._build_connection_uri() == "mongodb+srv://finanzen.rtlj1gu.mongodb.net"
    assert onprem_source._build_connection_uri() == "mongodb://mongo.local:27018"


def test_mongodb_full_uri_in_cluster_host_is_normalised() -> None:
    """Full mongodb+srv:// URIs pasted into cluster_host are accepted and stripped to host-only."""
    full_uri_source = MongoDBSource(
        _recipe(
            required={
                "deployment": "ATLAS",
                "cluster_host": "mongodb+srv://user:secret@cluster.abc123.mongodb.net/?retryWrites=true&w=majority",
            }
        )
    )
    assert full_uri_source._atlas_cluster_host() == "cluster.abc123.mongodb.net"
    assert full_uri_source._build_connection_uri() == "mongodb+srv://cluster.abc123.mongodb.net"


def test_mongodb_connection_kwargs_include_masked_credentials() -> None:
    source = MongoDBSource(_recipe())

    kwargs = source._build_client_kwargs()

    assert kwargs["username"] == "scanner"
    assert kwargs["password"] == "secret"
    assert kwargs["authMechanism"] == "SCRAM-SHA-256"
    assert kwargs["appname"] == "classifyre-test"


def test_mongodb_requires_database_when_not_include_all() -> None:
    source = MongoDBSource(
        _recipe(
            optional={
                "scope": {
                    "include_all_databases": False,
                }
            }
        )
    )

    with pytest.raises(ValueError, match=r"requires optional\.scope\.database"):
        source._resolve_databases()


def test_mongodb_test_connection_success(monkeypatch: pytest.MonkeyPatch) -> None:
    source = MongoDBSource(_recipe())
    fake_client = _FakeMongoClient(
        {
            "finanzen": _FakeDatabase(
                {
                    "transactions": _FakeCollection([{"_id": 1, "amount": 10}]),
                }
            )
        }
    )
    monkeypatch.setattr(source, "_client", lambda: fake_client)

    result = source.test_connection()

    assert result["status"] == "SUCCESS"
    assert "MongoDB (Atlas)" in result["message"]


@pytest.mark.asyncio
async def test_mongodb_extract_streams_assets_in_batches(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = MongoDBSource(_recipe())
    monkeypatch.setattr(
        source,
        "_iter_collections",
        lambda: [
            CollectionRef(database="finanzen", collection="transactions"),
            CollectionRef(database="finanzen", collection="users"),
            CollectionRef(database="finanzen", collection="payments"),
        ],
    )

    original_batch_size = MongoDBSource.BATCH_SIZE
    MongoDBSource.BATCH_SIZE = 2
    try:
        batches: list[list[Any]] = []
        async for batch in source.extract():
            batches.append(batch)
    finally:
        MongoDBSource.BATCH_SIZE = original_batch_size

    assert [len(batch) for batch in batches] == [2, 1]
    assert batches[0][0].name == "finanzen.transactions"
    assert batches[0][1].name == "finanzen.users"
    assert batches[1][0].name == "finanzen.payments"


@pytest.mark.asyncio
async def test_mongodb_fetch_content_uses_cache(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = MongoDBSource(_recipe())
    ref = CollectionRef(database="finanzen", collection="transactions")
    asset = source._collection_to_asset(ref)
    source._collection_lookup[asset.hash] = ref

    call_count = 0

    def _sample(_ref: CollectionRef) -> list[dict[str, Any]]:
        nonlocal call_count
        call_count += 1
        return [{"_id": 1, "secret": "abc"}]

    monkeypatch.setattr(source, "_sample_collection_documents", _sample)

    first = await source.fetch_content(asset.hash)
    second = await source.fetch_content(asset.hash)

    assert first == second
    assert first is not None
    assert "doc_1:" in first[1]
    assert call_count == 1


def test_mongodb_random_sampling_uses_sample_pipeline() -> None:
    source = MongoDBSource(_recipe(sampling={"strategy": "RANDOM", "limit": 3}))
    collection = _FakeCollection([{"_id": i, "value": f"v-{i}"} for i in range(10)])
    fake_client = _FakeMongoClient({"finanzen": _FakeDatabase({"transactions": collection})})
    source._mongo_client = fake_client

    docs = source._sample_collection_documents(
        CollectionRef(database="finanzen", collection="transactions")
    )

    assert len(docs) == 3
    assert collection.last_pipeline == [{"$sample": {"size": 3}}]


def test_mongodb_latest_sampling_falls_back_to_random_when_order_column_missing() -> None:
    source = MongoDBSource(
        _recipe(
            sampling={
                "strategy": "LATEST",
                "limit": 2,
                "order_by_column": "updated_at",
                "fallback_to_random": True,
            }
        )
    )
    collection = _FakeCollection(
        [{"_id": 1, "value": "one"}, {"_id": 2, "value": "two"}, {"_id": 3, "value": "three"}]
    )
    fake_client = _FakeMongoClient({"finanzen": _FakeDatabase({"transactions": collection})})
    source._mongo_client = fake_client

    docs = source._sample_collection_documents(
        CollectionRef(database="finanzen", collection="transactions")
    )

    assert len(docs) == 2
    assert collection.last_pipeline == [{"$sample": {"size": 2}}]


def test_mongodb_all_sampling_reads_entire_collection() -> None:
    source = MongoDBSource(_recipe(sampling={"strategy": "ALL"}))
    collection = _FakeCollection([{"_id": 1, "value": "one"}, {"_id": 2, "value": "two"}])
    fake_client = _FakeMongoClient({"finanzen": _FakeDatabase({"transactions": collection})})
    source._mongo_client = fake_client

    docs = source._sample_collection_documents(
        CollectionRef(database="finanzen", collection="transactions")
    )

    assert len(docs) == 2
    assert collection.last_pipeline is None


@pytest.mark.asyncio
async def test_mongodb_extract_runs_detector_pipeline_when_enabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = MongoDBSource(_recipe(detectors=[{"type": "SECRETS", "enabled": True}]))
    monkeypatch.setattr(
        source,
        "_iter_collections",
        lambda: [CollectionRef(database="finanzen", collection="transactions")],
    )

    processed_batches: list[int] = []

    class _Pipeline:
        async def process(self, batch: list[Any]) -> list[Any]:
            processed_batches.append(len(batch))
            return batch

    monkeypatch.setattr(
        "src.pipeline.detector_pipeline.DetectorPipeline.from_recipe",
        lambda *_args, **_kwargs: _Pipeline(),
    )

    batches: list[list[Any]] = []
    async for batch in source.extract():
        batches.append(batch)

    assert [len(batch) for batch in batches] == [1]
    assert processed_batches == [1]
