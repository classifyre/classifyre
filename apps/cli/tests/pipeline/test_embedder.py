from src.pipeline.embedder import (
    EmbeddingArtifact,
    chunk_text_with_offsets,
    content_hash,
    normalize_embedding_text,
)


def test_content_hash_matches_api_contract() -> None:
    normalized = normalize_embedding_text(" before\n", " match ", "\tafter")
    assert normalized == "before match after"
    assert content_hash(normalized) == (
        "56e11ca0fe43cd8a8a9cca0827464992480a472f80eae078cffb0eb72e53e6be"
    )


def test_chunking_is_deterministic_and_preserves_offsets() -> None:
    text = "alpha beta gamma " * 200
    first = chunk_text_with_offsets(text)
    second = chunk_text_with_offsets(text)

    assert first == second
    assert len(first) > 1
    assert first[0][1] == 0
    assert all(value and length == len(value) for value, _offset, length in first)


def test_artifact_deduplicates_content_but_keeps_chunk_provenance() -> None:
    artifact = EmbeddingArtifact()
    artifact.add_page("same text", 1)
    artifact.add_page("same text", 2)

    assert len(artifact.contents) == 1
    assert len(artifact.chunks) == 2
    assert artifact.chunks[0]["contentHash"] == content_hash("same text")
    assert artifact.chunks[1]["page"] == 2
