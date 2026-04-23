"""PII detector using Microsoft Presidio."""

import importlib
import logging
import os
import re
import tempfile
import warnings
from dataclasses import dataclass
from pathlib import Path
from typing import Any, ClassVar

from ...models.generated_detectors import DetectorConfig, Severity
from ...models.generated_single_asset_scan_results import DetectionResult, DetectorType, Location
from ..base import BaseDetector
from ..dependencies import MissingDependencyError, require_module

logger = logging.getLogger(__name__)
_PRESIDIO_FILTER_INSTALLED = False


class _PresidioNoiseFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        if (
            "Recognizer not added to registry because language is not supported by registry"
            in message
        ):
            return False
        if "model_to_presidio_entity_mapping is missing from configuration" in message:
            return False
        if "low_score_entity_names is missing from configuration" in message:
            return False
        if "labels_to_ignore is missing from configuration" in message:
            return False
        if "Entity " in message and "is not mapped to a Presidio entity" in message:
            return False
        return True


@dataclass
class _FallbackPIIResult:
    start: int
    end: int
    entity_type: str
    score: float
    recognition_metadata: dict[str, Any]


@dataclass(frozen=True)
class _TabularCell:
    row_index: int
    column_name: str
    value: str


class _RegexPIIAnalyzer:
    """Fallback analyzer used when Presidio runtime assets are unavailable."""

    _PATTERNS: ClassVar[list[tuple[str, re.Pattern[str], float]]] = [
        (
            "EMAIL_ADDRESS",
            re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"),
            0.99,
        ),
        (
            "US_SSN",
            re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
            0.95,
        ),
        (
            "PHONE_NUMBER",
            re.compile(r"\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b"),
            0.9,
        ),
        (
            "CREDIT_CARD",
            re.compile(r"\b(?:\d[ -]*?){13,16}\b"),
            0.9,
        ),
        (
            "IP_ADDRESS",
            re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b"),
            0.9,
        ),
    ]

    def analyze(self, text: str, language: str = "en") -> list[_FallbackPIIResult]:
        del language
        findings: list[_FallbackPIIResult] = []

        for entity_type, pattern, score in self._PATTERNS:
            for match in pattern.finditer(text):
                findings.append(
                    _FallbackPIIResult(
                        start=match.start(),
                        end=match.end(),
                        entity_type=entity_type,
                        score=score,
                        recognition_metadata={"recognizer_name": "regex_fallback"},
                    )
                )

        # Deterministic ordering for predictable test behavior.
        findings.sort(key=lambda item: (item.start, item.end, item.entity_type))
        return findings

    def get_supported_entities(self) -> list[str]:
        return [entity for entity, _pattern, _score in self._PATTERNS]


class PIIDetector(BaseDetector):
    """
    Detector for Personally Identifiable Information (PII) using Presidio.

    Detects various types of PII including:
    - Social Security Numbers (SSN)
    - Credit Card Numbers
    - Email Addresses
    - Phone Numbers
    - Person Names
    - Locations
    - IP Addresses
    - US Driver Licenses
    - US Passports
    - IBAN Codes
    """

    detector_type = "pii"
    detector_name = "pii"
    _ENTITY_PATTERN_MAP: ClassVar[dict[str, str]] = {
        "CREDIT_CARD": "credit_card",
        "US_SSN": "ssn",
        "EMAIL_ADDRESS": "email",
        "PHONE_NUMBER": "phone_number",
        "PERSON": "person",
        "LOCATION": "location",
        "IP_ADDRESS": "ip_address",
        "IBAN_CODE": "iban_code",
        "US_PASSPORT": "us_passport",
        "US_DRIVER_LICENSE": "us_driver_license",
        "AT_SVNR": "austrian_svnr",
        "CH_AHV": "swiss_ahv",
        "DE_TAX_ID": "german_tax_id",
        "EU_NATIONAL_ID": "eu_national_id",
    }
    _PATTERN_ENTITY_MAP: ClassVar[dict[str, set[str]]] = {
        "credit_card": {"CREDIT_CARD"},
        "ssn": {"US_SSN"},
        "email": {"EMAIL_ADDRESS"},
        "phone_number": {"PHONE_NUMBER"},
        "person": {"PERSON"},
        "location": {"LOCATION"},
        "ip_address": {"IP_ADDRESS"},
        "iban_code": {"IBAN_CODE"},
        "us_passport": {"US_PASSPORT"},
        "us_driver_license": {"US_DRIVER_LICENSE"},
        "austrian_svnr": {"AT_SVNR"},
        "swiss_ahv": {"CH_AHV"},
        "german_tax_id": {"DE_TAX_ID"},
        "eu_national_id": {"EU_NATIONAL_ID"},
        "date_of_birth": {"DATE_TIME"},
    }
    _REGEX_ANALYZER_ENTITIES: ClassVar[set[str]] = {
        "CREDIT_CARD",
        "US_SSN",
        "EMAIL_ADDRESS",
        "PHONE_NUMBER",
        "IP_ADDRESS",
    }
    _TABULAR_ROW_RE: ClassVar[re.Pattern[str]] = re.compile(r"^row_(\d+):$")
    _TABULAR_CELL_RE: ClassVar[re.Pattern[str]] = re.compile(r"^  ([^:]+):(?: ?(.*))?$")
    _TABULAR_CONTINUATION_RE: ClassVar[re.Pattern[str]] = re.compile(r"^    (.*)$")
    _FREE_TEXT_COLUMN_TOKENS: ClassVar[set[str]] = {
        "text",
        "body",
        "content",
        "description",
        "message",
        "comment",
        "comments",
        "note",
        "notes",
        "summary",
        "details",
        "bio",
    }
    _NAME_COLUMN_TOKENS: ClassVar[set[str]] = {
        "name",
        "first",
        "last",
        "middle",
        "full",
        "person",
        "contact",
    }
    _EMAIL_COLUMN_TOKENS: ClassVar[set[str]] = {"email", "mail"}
    _PHONE_COLUMN_TOKENS: ClassVar[set[str]] = {"phone", "mobile", "tel", "telephone", "fax"}
    _ADDRESS_COLUMN_TOKENS: ClassVar[set[str]] = {
        "address",
        "street",
        "city",
        "state",
        "country",
        "postal",
        "postcode",
        "zipcode",
        "zip",
        "location",
    }
    _URL_COLUMN_TOKENS: ClassVar[set[str]] = {"url", "uri", "website", "web", "link", "domain"}
    _ID_COLUMN_TOKENS: ClassVar[set[str]] = {"id", "uuid", "guid", "key", "source", "row"}
    _COLUMN_PATTERN_HINTS: ClassVar[dict[str, set[str]]] = {
        "email": {"email"},
        "mail": {"email"},
        "phone": {"phone_number"},
        "mobile": {"phone_number"},
        "tel": {"phone_number"},
        "telephone": {"phone_number"},
        "fax": {"phone_number"},
        "name": {"person"},
        "person": {"person"},
        "address": {"location"},
        "location": {"location"},
        "city": {"location"},
        "state": {"location"},
        "country": {"location"},
        "postal": {"location"},
        "postcode": {"location"},
        "zipcode": {"location"},
        "zip": {"location"},
        "ip": {"ip_address"},
        "ssn": {"ssn"},
        "passport": {"us_passport"},
        "driver": {"us_driver_license"},
        "license": {"us_driver_license"},
        "iban": {"iban_code"},
        "svnr": {"austrian_svnr"},
        "ahv": {"swiss_ahv"},
        "tax": {"german_tax_id"},
        "national": {"eu_national_id"},
        "card": {"credit_card"},
        "credit": {"credit_card"},
    }
    _NON_TEXT_ENTITY_PATTERNS: ClassVar[set[str]] = {"person", "location", "date_of_birth"}

    @staticmethod
    def _is_runtime_dependency_failure(error: Exception) -> bool:
        """Return True when analyzer failed due to missing optional runtime data."""
        if isinstance(error, ModuleNotFoundError):
            return True
        error_text = str(error).lower()
        if "no module named" in error_text:
            return True
        if "phonenumbers.data.region_" in error_text:
            return True
        if "numpy.core.multiarray failed to import" in error_text:
            return True
        if "numpy.import_array" in error_text:
            return True
        if "dtype size changed" in error_text:
            return True
        return False

    def _activate_regex_fallback(
        self,
        error: Exception,
        *,
        initialization_error: bool = False,
    ) -> None:
        if initialization_error:
            logger.warning(
                "Presidio initialization unavailable for PII detector; using regex fallback: %s",
                error,
            )
        else:
            logger.error(f"Failed to initialize Presidio analyzer: {error}")
            logger.exception(error)

        self.analyzer = _RegexPIIAnalyzer()
        self._supported_entities = self.analyzer.get_supported_entities()
        logger.warning("PII detector initialized with regex fallback analyzer")

    def __init__(self, config: DetectorConfig | None = None):
        """Initialize PII detector with Presidio."""
        super().__init__(config)

        native_pii_enabled = os.environ.get("CLASSIFYRE_ENABLE_NATIVE_PII", "").strip().lower()
        if native_pii_enabled not in {"1", "true", "yes"}:
            self.analyzer = _RegexPIIAnalyzer()
            self._supported_entities = self.analyzer.get_supported_entities()
            logger.info(
                "PII detector using regex fallback analyzer by default; "
                "set CLASSIFYRE_ENABLE_NATIVE_PII=1 to enable native Presidio."
            )
            return

        # Initialize Presidio analyzer
        try:
            with warnings.catch_warnings():
                warnings.filterwarnings(
                    "ignore",
                    message=r"`torch\.jit\.script` is deprecated\..*",
                    category=DeprecationWarning,
                    module=r"torch\.jit\._script",
                )

                global _PRESIDIO_FILTER_INSTALLED  # noqa: PLW0603
                if not _PRESIDIO_FILTER_INSTALLED:
                    logging.getLogger("presidio-analyzer").addFilter(_PresidioNoiseFilter())
                    _PRESIDIO_FILTER_INSTALLED = True

                cache_dir = os.environ.get("TLDEXTRACT_CACHE")
                if not cache_dir:
                    default_cache = Path(tempfile.gettempdir()) / "tldextract-cache"
                    default_cache.mkdir(parents=True, exist_ok=True)
                    os.environ["TLDEXTRACT_CACHE"] = str(default_cache)

                presidio_module = require_module(
                    "presidio_analyzer",
                    "pii",
                    ["privacy", "detectors"],
                )
                AnalyzerEngine = presidio_module.AnalyzerEngine  # noqa: N806

                try:
                    spacy = importlib.import_module("spacy")
                except Exception:
                    logger.warning("spaCy not available, using basic analyzer")
                    self.analyzer = AnalyzerEngine()
                    self._supported_entities = self.analyzer.get_supported_entities()
                    return

                cfg_model: str = getattr(self.config, "spacy_model", None) or "en_core_web_sm"
                cfg_model_url: str | None = getattr(self.config, "spacy_model_url", None)

                # Install model from URL if provided and model not yet available
                if cfg_model_url:
                    try:
                        spacy.load(cfg_model)
                    except OSError:
                        logger.info("spaCy model '%s' not found; installing from URL...", cfg_model)
                        import subprocess
                        import sys

                        subprocess.run(
                            [sys.executable, "-m", "pip", "install", cfg_model_url],
                            check=True,
                            capture_output=True,
                        )
                        importlib.invalidate_caches()

                try:
                    nlp = spacy.load(cfg_model)
                    logger.debug("Loaded spaCy model %s", cfg_model)
                except OSError:
                    logger.warning("spaCy model '%s' not found, using basic analyzer", cfg_model)
                    self.analyzer = AnalyzerEngine()
                    self._supported_entities = self.analyzer.get_supported_entities()
                    return

                # Manually set the spacy model to avoid download attempts
                nlp_engine_module = require_module(
                    "presidio_analyzer.nlp_engine",
                    "pii",
                    ["privacy", "detectors"],
                )
                SpacyNlpEngine = nlp_engine_module.SpacyNlpEngine  # noqa: N806
                NerModelConfiguration = nlp_engine_module.NerModelConfiguration  # noqa: N806
                ner_config_module = require_module(
                    "presidio_analyzer.nlp_engine.ner_model_configuration",
                    "pii",
                    ["privacy", "detectors"],
                )

                ner_config = NerModelConfiguration(
                    labels_to_ignore=[
                        "CARDINAL",
                        "ORDINAL",
                        "QUANTITY",
                        "FAC",
                        "WORK_OF_ART",
                        "PRODUCT",
                        "EVENT",
                        "LAW",
                        "LANGUAGE",
                        "PERCENT",
                        "MONEY",
                    ],
                    model_to_presidio_entity_mapping=(
                        ner_config_module.MODEL_TO_PRESIDIO_ENTITY_MAPPING
                    ),
                    low_score_entity_names=ner_config_module.LOW_SCORE_ENTITY_NAMES,
                )
                nlp_engine = SpacyNlpEngine(
                    models=[{"lang_code": "en", "model_name": cfg_model}],
                    ner_model_configuration=ner_config,
                )
                nlp_engine.nlp = {"en": nlp}  # Set the loaded model directly

                # Create analyzer
                self.analyzer = AnalyzerEngine(nlp_engine=nlp_engine, supported_languages=["en"])

                # Get list of supported entities
                self._supported_entities = self.analyzer.get_supported_entities()
                logger.debug(
                    f"Initialized PII detector with {len(self._supported_entities)} entity types"
                )

        except MissingDependencyError as e:
            self._activate_regex_fallback(e, initialization_error=True)
        except Exception as e:
            self._activate_regex_fallback(e)

    def _enabled_pattern_keys(self) -> set[str] | None:
        configured = getattr(self.config, "enabled_patterns", None)
        if not configured:
            return None

        normalized = {
            str(pattern).strip().lower() for pattern in configured if str(pattern).strip()
        }
        return normalized or None

    def _is_entity_enabled(self, entity_type: str) -> bool:
        enabled_patterns = self._enabled_pattern_keys()
        if enabled_patterns is None:
            return True

        mapped_pattern = self._ENTITY_PATTERN_MAP.get(entity_type.upper())
        if mapped_pattern is None:
            return False

        return mapped_pattern in enabled_patterns

    def _default_enabled_patterns(self) -> set[str]:
        return set(self._ENTITY_PATTERN_MAP.values()) | {"date_of_birth"}

    def _normalize_column_name(self, column_name: str) -> str:
        return re.sub(r"[^a-z0-9]+", " ", column_name.lower()).strip()

    def _column_tokens(self, column_name: str) -> set[str]:
        normalized = self._normalize_column_name(column_name)
        return {token for token in normalized.split() if token}

    def _is_free_text_column(self, column_name: str) -> bool:
        tokens = self._column_tokens(column_name)
        return bool(tokens & self._FREE_TEXT_COLUMN_TOKENS)

    def _allowed_patterns_for_column(self, column_name: str) -> set[str]:
        enabled_patterns = self._enabled_pattern_keys() or self._default_enabled_patterns()
        tokens = self._column_tokens(column_name)
        if not tokens:
            return enabled_patterns - self._NON_TEXT_ENTITY_PATTERNS

        if tokens & self._FREE_TEXT_COLUMN_TOKENS:
            return enabled_patterns

        allowed: set[str] = set()
        for token in tokens:
            allowed.update(self._COLUMN_PATTERN_HINTS.get(token, set()))

        if tokens & self._NAME_COLUMN_TOKENS and "company" not in tokens:
            allowed.add("person")
        if tokens & self._EMAIL_COLUMN_TOKENS:
            allowed.add("email")
        if tokens & self._PHONE_COLUMN_TOKENS:
            allowed.add("phone_number")
        if tokens & self._ADDRESS_COLUMN_TOKENS:
            allowed.add("location")

        if allowed:
            return allowed & enabled_patterns

        if tokens & self._URL_COLUMN_TOKENS:
            return {"ip_address"} & enabled_patterns

        if tokens & self._ID_COLUMN_TOKENS:
            return set()

        return enabled_patterns - self._NON_TEXT_ENTITY_PATTERNS

    def _is_entity_allowed_for_column(self, entity_type: str, column_name: str) -> bool:
        allowed_patterns = self._allowed_patterns_for_column(column_name)
        if not allowed_patterns:
            return False

        mapped_pattern = self._ENTITY_PATTERN_MAP.get(entity_type.upper())
        if mapped_pattern is None:
            return self._enabled_pattern_keys() is None and self._is_free_text_column(column_name)

        return mapped_pattern in allowed_patterns

    def _allowed_entity_types_for_patterns(self, patterns: set[str]) -> set[str]:
        entity_types: set[str] = set()
        for pattern in patterns:
            entity_types.update(self._PATTERN_ENTITY_MAP.get(pattern, set()))
        return entity_types

    def _filter_results_by_entity_types(
        self, analyzer_results: list[Any], entity_types: set[str] | None
    ) -> list[Any]:
        if not entity_types:
            return analyzer_results
        return [result for result in analyzer_results if result.entity_type in entity_types]

    def _analyze_content(self, content: str, *, entities: list[str] | None = None) -> list[Any]:
        try:
            if entities is None:
                return self.analyzer.analyze(text=content, language="en")
            try:
                return self.analyzer.analyze(text=content, language="en", entities=entities)
            except TypeError as error:
                if "unexpected keyword argument 'entities'" not in str(error):
                    raise
                analyzer_results = self.analyzer.analyze(text=content, language="en")
                return self._filter_results_by_entity_types(analyzer_results, set(entities))
        except Exception as e:
            if self._is_runtime_dependency_failure(e) and not isinstance(
                self.analyzer, _RegexPIIAnalyzer
            ):
                logger.warning(
                    "PII analyzer runtime dependency unavailable (%s); switching to regex fallback",
                    e,
                )
                self.analyzer = _RegexPIIAnalyzer()
                self._supported_entities = self.analyzer.get_supported_entities()
                try:
                    analyzer_results = self.analyzer.analyze(text=content, language="en")
                    return self._filter_results_by_entity_types(
                        analyzer_results,
                        set(entities) if entities else None,
                    )
                except Exception as fallback_error:
                    logger.error(
                        "Error scanning for PII with fallback analyzer: %s", fallback_error
                    )
                    logger.exception(fallback_error)
                    return []

            logger.error(f"Error scanning for PII: {e}")
            logger.exception(e)
            return []

    def _analyze_structured_cell(
        self, content: str, *, allowed_entity_types: set[str]
    ) -> list[Any]:
        if not allowed_entity_types:
            return []

        if allowed_entity_types.issubset(self._REGEX_ANALYZER_ENTITIES):
            analyzer_results = _RegexPIIAnalyzer().analyze(text=content, language="en")
            return self._filter_results_by_entity_types(analyzer_results, allowed_entity_types)

        filtered_entity_types = allowed_entity_types
        get_supported_entities = getattr(self.analyzer, "get_supported_entities", None)
        if callable(get_supported_entities):
            supported_entity_types = set(self._supported_entities or [])
            if supported_entity_types:
                filtered_entity_types = allowed_entity_types & supported_entity_types
                if not filtered_entity_types:
                    return []

        return self._analyze_content(content, entities=sorted(filtered_entity_types))

    def _extract_tabular_cells(self, content: str) -> list[_TabularCell]:
        if "row_1:" not in content:
            return []

        cells: list[_TabularCell] = []
        current_row_index: int | None = None
        current_column_name: str | None = None
        current_value_lines: list[str] = []

        def flush_cell() -> None:
            nonlocal current_column_name, current_value_lines
            if current_row_index is None or current_column_name is None:
                current_column_name = None
                current_value_lines = []
                return

            cells.append(
                _TabularCell(
                    row_index=current_row_index,
                    column_name=current_column_name,
                    value="\n".join(current_value_lines).strip(),
                )
            )
            current_column_name = None
            current_value_lines = []

        for line in content.splitlines():
            row_match = self._TABULAR_ROW_RE.match(line)
            if row_match:
                flush_cell()
                current_row_index = int(row_match.group(1))
                continue

            cell_match = self._TABULAR_CELL_RE.match(line)
            if cell_match and current_row_index is not None:
                flush_cell()
                current_column_name = cell_match.group(1).strip()
                current_value_lines = [cell_match.group(2) or ""]
                continue

            continuation_match = self._TABULAR_CONTINUATION_RE.match(line)
            if continuation_match and current_column_name is not None:
                current_value_lines.append(continuation_match.group(1))
                continue

            if current_column_name is not None and line and current_row_index is not None:
                current_value_lines.append(line)
                continue

            if not line:
                flush_cell()

        flush_cell()
        return [cell for cell in cells if cell.value]

    def _build_detection_result(
        self,
        *,
        matched_content: str,
        entity_type: str,
        confidence: float,
        recognition_metadata: dict[str, Any] | None,
        line_number: int,
        start: int,
        end: int,
        metadata: dict[str, Any] | None = None,
    ) -> DetectionResult:
        base_metadata = {
            "recognizer": recognition_metadata.get("recognizer_name", "unknown")
            if recognition_metadata
            else "unknown",
            "entity_type": entity_type,
        }
        if metadata:
            base_metadata.update(metadata)

        return DetectionResult(
            detector_type=DetectorType.PII,
            finding_type=entity_type,
            category="PII",
            severity=self._get_severity_for_entity(entity_type),
            confidence=confidence,
            matched_content=matched_content,
            location=Location(
                path=f"line {line_number}",
                description=f"character range {start}-{end}",
            ),
            metadata=base_metadata,
        )

    def _dedupe_tabular_findings(self, findings: list[DetectionResult]) -> list[DetectionResult]:
        deduped: dict[tuple[str, str, int | None, str | None], DetectionResult] = {}
        ordered_keys: list[tuple[str, str, int | None, str | None]] = []

        for finding in findings:
            metadata = finding.metadata or {}
            key = (
                finding.finding_type,
                finding.matched_content.strip(),
                metadata.get("tabular_row_index"),
                metadata.get("tabular_column_name"),
            )
            existing = deduped.get(key)
            if existing is None:
                deduped[key] = finding
                ordered_keys.append(key)
                continue
            if finding.confidence > existing.confidence:
                deduped[key] = finding

        return [deduped[key] for key in ordered_keys]

    def _should_keep_tabular_result(
        self, *, cell: _TabularCell, entity_type: str, matched_content: str
    ) -> bool:
        if entity_type != "PERSON":
            return True
        if not self._is_free_text_column(cell.column_name):
            return True

        token_count = len(re.findall(r"[A-Za-z][A-Za-z'-]*", matched_content))
        return token_count >= 2

    def _detect_tabular_content(self, content: str) -> list[DetectionResult] | None:
        cells = self._extract_tabular_cells(content)
        if not cells:
            return None

        results: list[DetectionResult] = []
        for cell in cells:
            allowed_patterns = self._allowed_patterns_for_column(cell.column_name)
            if not allowed_patterns:
                continue

            allowed_entity_types = self._allowed_entity_types_for_patterns(allowed_patterns)
            analyzer_results = self._analyze_structured_cell(
                cell.value,
                allowed_entity_types=allowed_entity_types,
            )
            for result in analyzer_results:
                if not self._is_entity_enabled(result.entity_type):
                    continue
                if not self._is_entity_allowed_for_column(result.entity_type, cell.column_name):
                    continue

                matched_content = cell.value[result.start : result.end]
                if not self._should_keep_tabular_result(
                    cell=cell,
                    entity_type=result.entity_type,
                    matched_content=matched_content,
                ):
                    continue
                detection_result = self._build_detection_result(
                    matched_content=matched_content,
                    entity_type=result.entity_type,
                    confidence=result.score,
                    recognition_metadata=result.recognition_metadata,
                    line_number=cell.row_index,
                    start=result.start,
                    end=result.end,
                    metadata={
                        "tabular_row_index": cell.row_index,
                        "tabular_column_name": cell.column_name,
                    },
                )
                if detection_result.confidence >= (self.config.confidence_threshold or 0.7):
                    results.append(detection_result)

        return self._dedupe_tabular_findings(results)

    async def detect(self, content: str, content_type: str = "text/plain") -> list[DetectionResult]:
        """
        Detect PII in content using Presidio.

        Args:
            content: Text content to scan
            content_type: MIME type (must be text-based)

        Returns:
            List of detection results for found PII
        """
        results: list[DetectionResult] = []

        tabular_results = self._detect_tabular_content(content)
        if tabular_results is not None:
            if self.config.max_findings and len(tabular_results) > self.config.max_findings:
                return tabular_results[: self.config.max_findings]
            return tabular_results

        analyzer_results = self._analyze_content(content)

        # Process each detected PII entity
        for result in analyzer_results:
            if not self._is_entity_enabled(result.entity_type):
                continue

            # Calculate line number from offset
            line_number = content[: result.start].count("\n") + 1

            # Extract the matched content
            matched_content = content[result.start : result.end]

            # Create detection result
            detection_result = self._build_detection_result(
                matched_content=matched_content,
                entity_type=result.entity_type,
                confidence=result.score,
                recognition_metadata=result.recognition_metadata,
                line_number=line_number,
                start=result.start,
                end=result.end,
            )

            # Apply confidence threshold
            if detection_result.confidence >= (self.config.confidence_threshold or 0.7):
                results.append(detection_result)

        # Apply max_findings limit if configured
        if self.config.max_findings and len(results) > self.config.max_findings:
            results = results[: self.config.max_findings]

        return results

    def get_supported_content_types(self) -> list[str]:
        """Return supported content types for PII detection."""
        return [
            "text/plain",
            "text/html",
            "application/json",
            "text/xml",
        ]

    def _get_severity_for_entity(self, entity_type: str) -> Severity:
        """
        Determine severity level based on PII entity type.

        Args:
            entity_type: Type of PII entity detected

        Returns:
            Severity level
        """
        entity_type_upper = entity_type.upper()

        # Critical PII - financial and government IDs
        if any(
            keyword in entity_type_upper
            for keyword in [
                "CREDIT_CARD",
                "US_SSN",
                "US_PASSPORT",
                "US_DRIVER_LICENSE",
                "IBAN_CODE",
                "CRYPTO",
            ]
        ):
            return Severity.critical

        # High severity - contact info and identifiers
        if any(
            keyword in entity_type_upper
            for keyword in [
                "EMAIL",
                "PHONE",
                "IP_ADDRESS",
                "MEDICAL",
                "AU_TFN",
                "AU_ACN",
                "AU_ABN",
                "SG_NRIC",
                "UK_NHS",
            ]
        ):
            return Severity.high

        # Medium severity - personal info
        if any(
            keyword in entity_type_upper
            for keyword in [
                "PERSON",
                "LOCATION",
                "DATE",
                "NRP",  # National Registry Person
                "URL",
            ]
        ):
            return Severity.medium

        # Default to high for any detected PII
        return Severity.high
