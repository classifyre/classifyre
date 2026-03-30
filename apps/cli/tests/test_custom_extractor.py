"""Tests for CustomExtractor — all three strategies."""

from __future__ import annotations

from src.detectors.custom.extractor import (
    EXTRACTION_METHOD_CLASSIFIER_GLINER,
    EXTRACTION_METHOD_GLINER,
    EXTRACTION_METHOD_REGEX,
    CustomExtractor,
    ExtractionResult,
)
from src.models.generated_detectors import (
    CustomDetectorMethod,
    CustomExtractorConfig,
    CustomExtractorField,
)


def make_config(*fields_kwargs: dict, **config_kwargs) -> CustomExtractorConfig:
    fields = [CustomExtractorField(**kw) for kw in fields_kwargs]
    return CustomExtractorConfig(fields=fields, **config_kwargs)


# ── RULESET / REGEX ──────────────────────────────────────────────────────────


class TestRegexExtraction:
    def _extractor(self, *fields_kwargs: dict) -> CustomExtractor:
        return CustomExtractor(make_config(*fields_kwargs), CustomDetectorMethod.RULESET)

    def test_extracts_named_group(self):
        ex = self._extractor(
            {
                "name": "amount",
                "regex_pattern": r"(?P<value>\d+[.,]\d+)\s*EUR",
                "aggregate": "first",
            }
        )
        result = ex.extract("price is 29.99 EUR today", "price is 29.99 EUR today")
        assert result is not None
        assert result.extracted_data["amount"] == "29.99"
        assert result.method == EXTRACTION_METHOD_REGEX
        assert "amount" in result.populated_fields

    def test_list_aggregate_collects_all(self):
        ex = self._extractor(
            {
                "name": "emails",
                "regex_pattern": r"(?P<value>[a-z]+@[a-z]+\.[a-z]+)",
                "aggregate": "list",
            }
        )
        result = ex.extract("a@b.com and c@d.com", "a@b.com and c@d.com")
        assert result is not None
        assert result.extracted_data["emails"] == ["a@b.com", "c@d.com"]

    def test_join_aggregate(self):
        ex = self._extractor(
            {
                "name": "tags",
                "regex_pattern": r"#(?P<value>\w+)",
                "aggregate": "join",
                "join_separator": " | ",
            }
        )
        result = ex.extract("found #food and #recipe here", "found #food and #recipe here")
        assert result is not None
        assert result.extracted_data["tags"] == "food | recipe"

    def test_count_aggregate(self):
        ex = self._extractor(
            {
                "name": "mention_count",
                "regex_pattern": r"(?P<value>car rental)",
                "aggregate": "count",
                "regex_flags": "i",
            }
        )
        result = ex.extract(
            "car rental here and car rental there", "car rental here and car rental there"
        )
        assert result is not None
        assert result.extracted_data["mention_count"] == 2

    def test_no_match_returns_none(self):
        ex = self._extractor(
            {"name": "iban", "regex_pattern": r"(?P<value>DE\d{20})", "aggregate": "first"}
        )
        result = ex.extract("no iban here", "no iban here")
        assert result is None

    def test_required_field_gates_result(self):
        ex = self._extractor(
            {"name": "optional", "regex_pattern": r"(?P<value>foo)", "aggregate": "first"},
            {
                "name": "must_have",
                "regex_pattern": r"(?P<value>REQUIRED)",
                "aggregate": "first",
                "required": True,
            },
        )
        result = ex.extract("foo bar baz", "foo bar baz")
        assert result is None  # must_have not populated

    def test_required_field_allows_result_when_present(self):
        ex = self._extractor(
            {
                "name": "must_have",
                "regex_pattern": r"(?P<value>REQUIRED)",
                "aggregate": "first",
                "required": True,
            },
        )
        result = ex.extract("text with REQUIRED word", "text with REQUIRED word")
        assert result is not None
        assert result.extracted_data["must_have"] == "REQUIRED"

    def test_invalid_regex_skipped_gracefully(self):
        ex = self._extractor(
            {"name": "bad", "regex_pattern": r"[invalid", "aggregate": "first"},
            {"name": "good", "regex_pattern": r"(?P<value>ok)", "aggregate": "first"},
        )
        result = ex.extract("ok", "ok")
        assert result is not None
        assert "good" in result.extracted_data
        assert "bad" not in result.extracted_data

    def test_case_insensitive_flag(self):
        ex = self._extractor(
            {
                "name": "word",
                "regex_pattern": r"(?P<value>hello)",
                "aggregate": "first",
                "regex_flags": "i",
            }
        )
        result = ex.extract("HELLO world", "HELLO world")
        assert result is not None
        assert result.extracted_data["word"].lower() == "hello"

    def test_disabled_extractor_returns_none(self):
        config = make_config(
            {"name": "f", "regex_pattern": r"(?P<value>\w+)", "aggregate": "first"},
            enabled=False,
        )
        ex = CustomExtractor(config, CustomDetectorMethod.RULESET)
        assert ex.extract("hello", "hello") is None

    def test_extraction_result_populated_fields(self):
        ex = self._extractor(
            {"name": "a", "regex_pattern": r"(?P<value>yes)", "aggregate": "first"},
            {"name": "b", "regex_pattern": r"(?P<value>no)", "aggregate": "first"},
        )
        result = ex.extract("yes only", "yes only")
        assert result is not None
        assert "a" in result.populated_fields
        assert "b" not in result.populated_fields


# ── ENTITY / GLINER ──────────────────────────────────────────────────────────


class TestGlinerExtraction:
    """Tests using a mocked GLiNER model to avoid downloading models."""

    def _extractor_with_mock_gliner(
        self, fields: list[dict], mock_entities: list[dict]
    ) -> CustomExtractor:
        config = make_config(*fields)
        ex = CustomExtractor(config, CustomDetectorMethod.ENTITY)

        class MockGliner:
            def predict_entities(self, content: str, labels: list[str]) -> list[dict]:
                return [e for e in mock_entities if e.get("label") in labels]

        ex._gliner_model = MockGliner()
        return ex

    def test_groups_entity_spans_by_label(self):
        ex = self._extractor_with_mock_gliner(
            [
                {
                    "name": "persons",
                    "entity_label": "person",
                    "type": "list[string]",
                    "aggregate": "list",
                },
                {
                    "name": "orgs",
                    "entity_label": "organization",
                    "type": "list[string]",
                    "aggregate": "list",
                },
            ],
            [
                {"label": "person", "text": "Alice", "score": 0.9},
                {"label": "person", "text": "Bob", "score": 0.8},
                {"label": "organization", "text": "Acme Corp", "score": 0.85},
            ],
        )
        result = ex.extract("text", "Alice and Bob work at Acme Corp")
        assert result is not None
        assert result.extracted_data["persons"] == ["Alice", "Bob"]
        assert result.extracted_data["orgs"] == ["Acme Corp"]
        assert result.method == EXTRACTION_METHOD_GLINER

    def test_min_confidence_filters_low_score(self):
        ex = self._extractor_with_mock_gliner(
            [{"name": "items", "entity_label": "item", "aggregate": "list", "min_confidence": 0.8}],
            [
                {"label": "item", "text": "high conf", "score": 0.9},
                {"label": "item", "text": "low conf", "score": 0.3},
            ],
        )
        result = ex.extract("text", "text")
        assert result is not None
        assert result.extracted_data["items"] == ["high conf"]

    def test_first_aggregate_takes_first(self):
        ex = self._extractor_with_mock_gliner(
            [{"name": "role", "entity_label": "job title", "aggregate": "first"}],
            [
                {"label": "job title", "text": "CEO", "score": 0.9},
                {"label": "job title", "text": "CFO", "score": 0.85},
            ],
        )
        result = ex.extract("text", "text")
        assert result is not None
        assert result.extracted_data["role"] == "CEO"

    def test_no_entities_returns_none(self):
        ex = self._extractor_with_mock_gliner(
            [{"name": "dish", "entity_label": "food dish", "aggregate": "list"}],
            [],
        )
        result = ex.extract("no food here", "no food here")
        assert result is None

    def test_classifier_method_uses_classifier_gliner_tag(self):
        config = make_config({"name": "dish", "entity_label": "food dish", "aggregate": "list"})
        ex = CustomExtractor(config, CustomDetectorMethod.CLASSIFIER)

        class MockGliner:
            def predict_entities(self, content: str, labels: list[str]) -> list[dict]:
                return [{"label": "food dish", "text": "pizza", "score": 0.9}]

        ex._gliner_model = MockGliner()
        result = ex.extract("text", "I ate pizza")
        assert result is not None
        assert result.method == EXTRACTION_METHOD_CLASSIFIER_GLINER

    def test_required_field_gates_gliner_result(self):
        ex = self._extractor_with_mock_gliner(
            [
                {"name": "optional_field", "entity_label": "item", "aggregate": "list"},
                {
                    "name": "required_field",
                    "entity_label": "must",
                    "aggregate": "first",
                    "required": True,
                },
            ],
            [{"label": "item", "text": "something", "score": 0.9}],
        )
        result = ex.extract("text", "text")
        assert result is None  # required_field (label "must") was not found


# ── ExtractionResult ─────────────────────────────────────────────────────────


class TestExtractionResult:
    def test_populated_fields_excludes_empty_list(self):
        r = ExtractionResult(extracted_data={"a": ["x"], "b": [], "c": "hello"}, method="REGEX")
        assert "a" in r.populated_fields
        assert "b" not in r.populated_fields
        assert "c" in r.populated_fields

    def test_field_count_matches_data_keys(self):
        r = ExtractionResult(extracted_data={"x": 1, "y": 2, "z": 3}, method="GLINER")
        assert r.field_count == 3
