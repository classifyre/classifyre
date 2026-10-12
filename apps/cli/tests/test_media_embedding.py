"""Tests for media sent to the API to be embedded as what it is.

A photograph with no writing in it has no text, so no search over text finds
it. When the workspace's embedding model can see, the scan sends the picture
itself. Two things have to hold for that to be worth having: what is sent is
what the model can read, and a picture scanned before the model could see is
not skipped forever just because nothing about it changed.
"""

from __future__ import annotations

import base64
import io
import wave
from typing import Any

import pytest

from src.pipeline.media_artifact import (
    EmbeddingPlan,
    MediaSpec,
    prepare_audio_clips,
    prepare_image,
    prepare_media,
)
from src.pipeline.scan_cache import ScanCache
from src.pipeline.text_artifact import TextArtifact

PIL = pytest.importorskip("PIL.Image")

_PLAN_PAYLOAD = {
    "chunks": True,
    "media": [
        {
            "modality": "image",
            "mimeType": "image/jpeg",
            "maxItems": 1,
            "maxEdge": 768,
            "quality": 85,
            "cacheKey": "EMBED_MEDIA::image",
            "fingerprint": "plan-1",
        },
        {
            "modality": "audio",
            "mimeType": "audio/wav",
            "maxItems": 4,
            "sampleRate": 16000,
            "clipSeconds": 30,
            "cacheKey": "EMBED_MEDIA::audio",
            "fingerprint": "audio-plan-1",
        },
    ],
}


def _png(width: int, height: int, mode: str = "RGB", color: Any = (200, 30, 30)) -> bytes:
    buffer = io.BytesIO()
    PIL.new(mode, (width, height), color).save(buffer, format="PNG")
    return buffer.getvalue()


def _wav(seconds: float, rate: int = 44_100, channels: int = 2) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(channels)
        out.setsampwidth(2)
        out.setframerate(rate)
        frames = int(seconds * rate)
        # A square wave, so the clip is not silence.
        frame = b"".join(
            ((8000 if (index // 50) % 2 else -8000).to_bytes(2, "little", signed=True)) * channels
            for index in range(frames)
        )
        out.writeframes(frame)
    return buffer.getvalue()


# ---------------------------------------------------------------------------
# The plan
# ---------------------------------------------------------------------------


def test_plan_names_what_each_kind_of_asset_sends() -> None:
    plan = EmbeddingPlan.from_payload(_PLAN_PAYLOAD)

    assert plan.collects_media
    assert plan.spec_for("IMAGE").modality == "image"  # type: ignore[union-attr]
    assert plan.spec_for("AUDIO").modality == "audio"  # type: ignore[union-attr]
    # Text has nothing to send, and neither does a kind nobody prepares yet.
    assert plan.spec_for("TXT") is None
    assert plan.spec_for("VIDEO") is None


def test_plan_follows_what_the_workspace_embeds() -> None:
    images_only = EmbeddingPlan.from_payload({**_PLAN_PAYLOAD, "media": _PLAN_PAYLOAD["media"][:1]})

    assert images_only.spec_for("IMAGE") is not None
    assert images_only.spec_for("AUDIO") is None


@pytest.mark.parametrize("payload", [None, {}, {"media": "image"}, {"media": [{"modality": "x"}]}])
def test_an_api_that_asks_for_nothing_gets_nothing(payload: Any) -> None:
    """An older API answers 404 and the sink hands back {}: text only, as before."""
    plan = EmbeddingPlan.from_payload(payload)

    assert not plan.collects_media
    assert plan.spec_for("IMAGE") is None
    assert plan.cache_entry_for("IMAGE") is None


# ---------------------------------------------------------------------------
# Pictures
# ---------------------------------------------------------------------------


def test_a_large_picture_is_sent_small() -> None:
    """Encoders work at a few hundred pixels a side; more is only storage."""
    spec = MediaSpec(modality="image", mime_type="image/jpeg", max_edge=768)

    prepared = prepare_image(_png(3000, 1500), spec)

    assert prepared is not None
    with PIL.open(io.BytesIO(prepared)) as image:
        assert image.format == "JPEG"
        assert image.size == (768, 384)
        assert image.mode == "RGB"


def test_a_small_picture_is_not_blown_up() -> None:
    spec = MediaSpec(modality="image", mime_type="image/jpeg", max_edge=768)

    prepared = prepare_image(_png(200, 100), spec)

    assert prepared is not None
    with PIL.open(io.BytesIO(prepared)) as image:
        assert image.size == (200, 100)


def test_transparency_becomes_white_not_black() -> None:
    """JPEG has no alpha; dropping the channel would paint a logo's background black."""
    spec = MediaSpec(modality="image", mime_type="image/jpeg")

    prepared = prepare_image(_png(64, 64, "RGBA", (0, 0, 0, 0)), spec)

    assert prepared is not None
    with PIL.open(io.BytesIO(prepared)) as image:
        assert min(image.getpixel((32, 32))) > 240


def test_bytes_that_are_not_a_picture_send_nothing() -> None:
    spec = MediaSpec(modality="image", mime_type="image/jpeg")

    assert prepare_image(b"%PDF-1.7 not a picture", spec) is None
    assert prepare_image(b"", spec) is None
    assert prepare_media(b"not a picture", spec) == []


# ---------------------------------------------------------------------------
# Recordings
# ---------------------------------------------------------------------------


def _read(clip: bytes) -> tuple[int, int, int, float]:
    with wave.open(io.BytesIO(clip), "rb") as audio:
        return (
            audio.getnchannels(),
            audio.getframerate(),
            audio.getsampwidth(),
            audio.getnframes() / audio.getframerate(),
        )


def test_a_recording_is_sent_as_mono_16khz_clips() -> None:
    """What the audio encoder is trained on, whatever the file was recorded at."""
    pytest.importorskip("av")
    spec = MediaSpec(modality="audio", mime_type="audio/wav", max_items=4, clip_seconds=2)

    clips = prepare_audio_clips(_wav(7.0), spec)

    # Three full clips; the second left over at the end is not worth a vector.
    assert len(clips) == 3
    assert [_read(clip)[:3] for clip in clips] == [(1, 16_000, 2)] * 3
    assert [round(_read(clip)[3]) for clip in clips] == [2, 2, 2]


def test_the_short_tail_of_a_long_recording_is_left_out() -> None:
    """The clips before it already say what the recording is."""
    pytest.importorskip("av")
    spec = MediaSpec(modality="audio", mime_type="audio/wav", max_items=4, clip_seconds=10)

    clips = prepare_audio_clips(_wav(22.0), spec)

    assert [round(_read(clip)[3]) for clip in clips] == [10, 10]


def test_a_recording_of_a_second_or_two_is_sent_whole() -> None:
    """A door slamming is all of the recording, not a tail of one."""
    pytest.importorskip("av")
    spec = MediaSpec(modality="audio", mime_type="audio/wav", max_items=4, clip_seconds=30)

    clips = prepare_audio_clips(_wav(2.0), spec)

    assert [round(_read(clip)[3]) for clip in clips] == [2]


def test_a_long_recording_sends_only_its_opening() -> None:
    pytest.importorskip("av")
    spec = MediaSpec(modality="audio", mime_type="audio/wav", max_items=2, clip_seconds=1)

    clips = prepare_audio_clips(_wav(10.0), spec)

    assert len(clips) == 2
    assert all(round(_read(clip)[3]) == 1 for clip in clips)


def test_bytes_that_are_not_a_recording_send_nothing() -> None:
    pytest.importorskip("av")
    spec = MediaSpec(modality="audio", mime_type="audio/wav")

    assert prepare_audio_clips(b"not audio at all", spec) == []
    assert prepare_audio_clips(b"", spec) == []


# ---------------------------------------------------------------------------
# The artifact
# ---------------------------------------------------------------------------


def test_media_travels_with_the_text_of_its_asset() -> None:
    artifact = TextArtifact()
    artifact.add_page("the delivery note", 1)

    artifact.add_media("image", "image/jpeg", b"jpeg-bytes")
    artifact.add_media("audio", "audio/wav", b"clip-1")
    artifact.add_media("audio", "audio/wav", b"clip-2")

    assert len(artifact.chunks) == 1
    assert [(item["modality"], item["page"]) for item in artifact.media] == [
        ("image", 1),
        ("audio", 1),
        ("audio", 2),
    ]
    assert base64.b64decode(artifact.media[0]["data"]) == b"jpeg-bytes"


# ---------------------------------------------------------------------------
# The scan cache
# ---------------------------------------------------------------------------


class _Asset:
    def __init__(self, asset_type: str, hash_: str = "asset-1") -> None:
        self.hash = hash_
        self.checksum = "checksum-1"
        self.external_url = ""
        self.name = hash_
        self.asset_type = asset_type


class _Source:
    SUPPORTS_SCAN_CACHE = True
    SCAN_CACHE_VERIFY = "metadata"


def _cache(plan: EmbeddingPlan | None) -> tuple[ScanCache, dict[str, str]]:
    recipe = {
        "type": "LOCAL_FOLDER",
        "sampling": {"strategy": "ALL"},
        "scan_cache": {"enabled": True, "verify": "auto"},
        "detectors": [{"type": "PII", "enabled": True}],
    }
    cache = ScanCache(recipe, _Source())
    if plan is not None:
        cache.set_embedding_plan(plan)
    return cache, dict(cache._cacheable)


def _prior(cache: ScanCache, detectors: dict[str, str], **extra: Any) -> None:
    cache.record_prior(
        [
            {
                "hash": "asset-1",
                "checksum": "checksum-1",
                "contentHash": None,
                "scopeFingerprint": None,
                "detectors": detectors,
                **extra,
            }
        ]
    )


@pytest.mark.asyncio
async def test_an_unchanged_picture_is_read_again_once_pictures_are_embedded() -> None:
    """Nothing about the photograph changed. What changed is that the model can see.

    Without this the cache has every reason to skip it, and it would stay
    unfindable until the day its file happened to change.
    """
    cache, fingerprints = _cache(EmbeddingPlan.from_payload(_PLAN_PAYLOAD))
    _prior(cache, fingerprints)

    plan = await cache.plan(_Asset("IMAGE"))

    assert plan.mode == "partial"
    assert plan.media_only
    # No detector re-runs: its findings are still its findings.
    assert plan.run_detector_keys == frozenset()
    assert "media" in plan.reason


@pytest.mark.asyncio
async def test_a_text_file_is_still_skipped_when_pictures_are_embedded() -> None:
    cache, fingerprints = _cache(EmbeddingPlan.from_payload(_PLAN_PAYLOAD))
    _prior(cache, fingerprints)

    plan = await cache.plan(_Asset("TXT"))

    assert plan.mode == "skip"


@pytest.mark.asyncio
async def test_a_picture_whose_media_was_sent_is_skipped() -> None:
    cache, fingerprints = _cache(EmbeddingPlan.from_payload(_PLAN_PAYLOAD))
    _prior(cache, {**fingerprints, "EMBED_MEDIA::image": "plan-1"})

    plan = await cache.plan(_Asset("IMAGE"))

    assert plan.mode == "skip"
    assert plan.carried_detectors["EMBED_MEDIA::image"] == "plan-1"


@pytest.mark.asyncio
async def test_a_change_in_how_media_is_prepared_sends_it_again() -> None:
    cache, fingerprints = _cache(EmbeddingPlan.from_payload(_PLAN_PAYLOAD))
    _prior(cache, {**fingerprints, "EMBED_MEDIA::image": "an-older-plan"})

    plan = await cache.plan(_Asset("IMAGE"))

    assert plan.media_only


@pytest.mark.asyncio
async def test_starting_to_embed_sound_does_not_send_the_pictures_again() -> None:
    """Each kind keeps its own record; a plan-wide one would re-read every picture."""
    images_only = {**_PLAN_PAYLOAD, "media": _PLAN_PAYLOAD["media"][:1]}
    before, fingerprints = _cache(EmbeddingPlan.from_payload(images_only))
    picture = _Asset("IMAGE")
    recorded = before.build_state(
        await before.plan(picture),
        content_hash=None,
        detector_outcomes=None,
        media_state=before.media_state_for(picture),
    )
    assert recorded is not None

    after, _ = _cache(EmbeddingPlan.from_payload(_PLAN_PAYLOAD))
    _prior(after, recorded["detectors"])

    assert (await after.plan(_Asset("IMAGE"))).mode == "skip"
    assert (await after.plan(_Asset("AUDIO"))).media_only
    assert fingerprints  # the detector itself was never in question


@pytest.mark.asyncio
async def test_a_text_only_workspace_never_re_reads_for_media() -> None:
    for plan_in_force in (None, EmbeddingPlan()):
        cache, fingerprints = _cache(plan_in_force)
        _prior(cache, fingerprints)

        assert (await cache.plan(_Asset("IMAGE"))).mode == "skip"


@pytest.mark.asyncio
async def test_sending_media_is_recorded_so_it_is_not_sent_twice() -> None:
    cache, fingerprints = _cache(EmbeddingPlan.from_payload(_PLAN_PAYLOAD))
    asset = _Asset("IMAGE")

    state = cache.build_state(
        await cache.plan(asset),
        content_hash=None,
        detector_outcomes=None,
        media_state=cache.media_state_for(asset),
    )

    assert state is not None
    assert state["detectors"]["EMBED_MEDIA::image"] == "plan-1"
    assert state["detectors"]["PII"] == fingerprints["PII"]


@pytest.mark.asyncio
async def test_media_is_not_recorded_when_the_chunk_request_failed() -> None:
    """The record is what lets a later run skip; a failed send must not leave one."""
    cache, _ = _cache(EmbeddingPlan.from_payload(_PLAN_PAYLOAD))
    asset = _Asset("IMAGE")

    state = cache.build_state(
        await cache.plan(asset),
        content_hash=None,
        detector_outcomes=None,
        completed=False,
        media_state=cache.media_state_for(asset),
    )

    assert state is not None
    assert state["complete"] is False
    assert state["detectors"] == {}


@pytest.mark.asyncio
async def test_a_media_only_re_read_keeps_the_findings_it_did_not_look_for() -> None:
    """No detector ran, so "found nothing" would be a lie about the asset."""
    cache, fingerprints = _cache(EmbeddingPlan.from_payload(_PLAN_PAYLOAD))
    _prior(
        cache,
        fingerprints,
        findingsTotal=3,
        findingsBySeverity={"HIGH": 3},
        findingsByDetector={"PII": {"HIGH": 3}},
    )
    asset = _Asset("IMAGE")
    plan = await cache.plan(asset)

    state = cache.build_state(
        plan,
        content_hash=None,
        detector_outcomes=None,
        findings_total=0,
        findings_by_severity={},
        findings_by_detector={},
        media_state=cache.media_state_for(asset),
    )

    assert state is not None
    assert state["findings_total"] == 3
    assert state["findings_by_severity"] == {"HIGH": 3}
    assert state["detectors"] == {**fingerprints, "EMBED_MEDIA::image": "plan-1"}
