"""PII detector powered by Microsoft Presidio."""

import importlib
import logging
import os
import re
import subprocess
import sys
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

_PRESIDIO_LOG_FILTER_INSTALLED = False


class _PresidioNoiseFilter(logging.Filter):
    """Suppresses noisy but harmless Presidio initialization warnings."""

    _SUPPRESSED = (
        "Recognizer not added to registry because language is not supported by registry",
        "model_to_presidio_entity_mapping is missing from configuration",
        "low_score_entity_names is missing from configuration",
        "labels_to_ignore is missing from configuration",
        "Fetching all recognizers for language",
    )

    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        if any(s in msg for s in self._SUPPRESSED):
            return False
        if "Entity " in msg and (
            "is not mapped to a Presidio entity" in msg
            or "doesn't have the corresponding recognizer in language" in msg
        ):
            return False
        return True


@dataclass(frozen=True)
class _TabularCell:
    row_index: int
    column_name: str
    value: str


class PIIDetector(BaseDetector):
    """
    PII detector powered by Microsoft Presidio.

    Detects personally identifiable information across global and regional entity types,
    covering all built-in Presidio recognizers plus optional ad-hoc custom recognizers
    defined in configuration.

    Supported regions: Global, USA, UK, Spain, Italy, Singapore, Australia, India,
    Finland, Poland, DACH (Germany / Austria / Switzerland).
    """

    detector_type = "pii"
    detector_name = "pii"

    # All entity types supported by built-in Presidio recognizers.
    _ALL_SUPPORTED_ENTITIES: ClassVar[set[str]] = {
        # Global
        "CREDIT_CARD",
        "CRYPTO",
        "DATE_TIME",
        "EMAIL_ADDRESS",
        "IBAN_CODE",
        "IP_ADDRESS",
        "NRP",
        "LOCATION",
        "PERSON",
        "PHONE_NUMBER",
        "MEDICAL_LICENSE",
        "URL",
        # USA
        "US_BANK_NUMBER",
        "US_DRIVER_LICENSE",
        "US_ITIN",
        "US_PASSPORT",
        "US_SSN",
        # UK
        "UK_NHS",
        # Spain
        "ES_NIF",
        "ES_NIE",
        # Italy
        "IT_FISCAL_CODE",
        "IT_DRIVER_LICENSE",
        "IT_VAR_CODE",
        "IT_PASSPORT",
        "IT_IDENTITY_CARD",
        # Singapore
        "SG_NRIC_FIN",
        "SG_UEN",
        # Australia
        "AU_ABN",
        "AU_ACN",
        "AU_TFN",
        "AU_MEDICARE",
        # India
        "IN_PAN",
        "IN_AADHAAR",
        "IN_VEHICLE_REGISTRATION",
        "IN_VOTER",
        # Finland
        "FI_PERSONAL_IDENTITY_CODE",
        # Poland
        "PL_PESEL",
        # DACH
        "AT_SVNR",
        "CH_AHV",
        "DE_TAX_ID",
        "EU_NATIONAL_ID",
    }

    # Entity types that carry low signal in structured column values unless the column
    # explicitly indicates free text (e.g. description, notes, body).
    _NON_TEXT_ENTITY_TYPES: ClassVar[set[str]] = {"PERSON", "LOCATION", "DATE_TIME", "NRP"}

    # Maps individual column-name tokens to the entity types relevant for that column.
    _COLUMN_ENTITY_HINTS: ClassVar[dict[str, set[str]]] = {
        "email": {"EMAIL_ADDRESS"},
        "mail": {"EMAIL_ADDRESS"},
        "phone": {"PHONE_NUMBER"},
        "mobile": {"PHONE_NUMBER"},
        "tel": {"PHONE_NUMBER"},
        "telephone": {"PHONE_NUMBER"},
        "fax": {"PHONE_NUMBER"},
        "name": {"PERSON"},
        "person": {"PERSON"},
        "address": {"LOCATION"},
        "location": {"LOCATION"},
        "city": {"LOCATION"},
        "state": {"LOCATION"},
        "country": {"LOCATION"},
        "postal": {"LOCATION"},
        "postcode": {"LOCATION"},
        "zipcode": {"LOCATION"},
        "zip": {"LOCATION"},
        "ip": {"IP_ADDRESS"},
        "ssn": {"US_SSN"},
        "passport": {"US_PASSPORT"},
        "driver": {"US_DRIVER_LICENSE"},
        "license": {"US_DRIVER_LICENSE"},
        "iban": {"IBAN_CODE"},
        "svnr": {"AT_SVNR"},
        "ahv": {"CH_AHV"},
        "tax": {"DE_TAX_ID"},
        "national": {"EU_NATIONAL_ID"},
        "card": {"CREDIT_CARD"},
        "credit": {"CREDIT_CARD"},
        "crypto": {"CRYPTO"},
        "wallet": {"CRYPTO"},
        "url": {"URL"},
        "uri": {"URL"},
        "website": {"URL"},
        "nhs": {"UK_NHS"},
        "medicare": {"AU_MEDICARE"},
        "tfn": {"AU_TFN"},
        "abn": {"AU_ABN"},
        "acn": {"AU_ACN"},
        "pan": {"IN_PAN"},
        "aadhaar": {"IN_AADHAAR"},
        "nric": {"SG_NRIC_FIN"},
        "fin": {"SG_NRIC_FIN"},
        "uen": {"SG_UEN"},
        "pesel": {"PL_PESEL"},
        "nif": {"ES_NIF"},
        "nie": {"ES_NIE"},
        "medical": {"MEDICAL_LICENSE"},
    }

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

    _TABULAR_ROW_RE: ClassVar[re.Pattern[str]] = re.compile(r"^row_(\d+):$")
    _TABULAR_CELL_RE: ClassVar[re.Pattern[str]] = re.compile(r"^  ([^:]+):(?: ?(.*))?$")
    _TABULAR_CONTINUATION_RE: ClassVar[re.Pattern[str]] = re.compile(r"^    (.*)$")

    # Fall back to full-text analysis when a page has more than this many cells.
    # Per-cell analysis at scale causes O(rowsxcolumns) Presidio calls per page.
    _TABULAR_CELL_LIMIT: ClassVar[int] = 200

    def __init__(self, config: DetectorConfig | None = None) -> None:
        super().__init__(config)
        self._init_error: MissingDependencyError | None = None
        self.analyzer: Any = None
        self._supported_entities_cache: frozenset[str] | None = None
        try:
            self._initialize_analyzer()
        except MissingDependencyError as exc:
            self._init_error = exc
            logger.warning("Presidio unavailable — PII detector will raise on first use: %s", exc)

    # ------------------------------------------------------------------
    # Initialization
    # ------------------------------------------------------------------

    def _initialize_analyzer(self) -> None:
        """Build the Presidio AnalyzerEngine with NLP engine and custom recognizers."""
        global _PRESIDIO_LOG_FILTER_INSTALLED  # noqa: PLW0603

        with warnings.catch_warnings():
            warnings.filterwarnings(
                "ignore",
                message=r"`torch\.jit\.script` is deprecated\..*",
                category=DeprecationWarning,
            )

            if not os.environ.get("TLDEXTRACT_CACHE"):
                cache = Path(tempfile.gettempdir()) / "tldextract-cache"
                cache.mkdir(parents=True, exist_ok=True)
                os.environ["TLDEXTRACT_CACHE"] = str(cache)

            if not _PRESIDIO_LOG_FILTER_INSTALLED:
                logging.getLogger("presidio-analyzer").addFilter(_PresidioNoiseFilter())
                _PRESIDIO_LOG_FILTER_INSTALLED = True

            presidio_module = require_module(
                "presidio_analyzer",
                "pii",
                ["privacy", "detectors"],
            )
            AnalyzerEngine = presidio_module.AnalyzerEngine  # noqa: N806

            nlp_engine = self._build_nlp_engine(presidio_module)
            if nlp_engine is not None:
                self.analyzer = AnalyzerEngine(nlp_engine=nlp_engine, supported_languages=["en"])
            else:
                self.analyzer = AnalyzerEngine()

            self._register_custom_recognizers(presidio_module)
            self._probe_phone_recognizer()

            self._supported_entities_cache = frozenset(self.analyzer.get_supported_entities())
            logger.debug(
                "PII detector initialized — %d built-in entity types, %d custom recognizers",
                len(self._supported_entities_cache),
                len(getattr(self.config, "custom_recognizers", None) or []),
            )

    def _build_nlp_engine(self, presidio_module: Any) -> Any | None:
        """Return a SpacyNlpEngine for the configured model, or None to use the default."""
        try:
            spacy = importlib.import_module("spacy")
        except ImportError:
            logger.warning("spaCy not available; using default Presidio NLP engine")
            return None

        cfg_model: str = getattr(self.config, "spacy_model", None) or "en_core_web_sm"
        cfg_model_url: str | None = getattr(self.config, "spacy_model_url", None)

        if cfg_model_url:
            try:
                spacy.load(cfg_model)
            except OSError:
                logger.info(
                    "spaCy model '%s' not found; installing from %s", cfg_model, cfg_model_url
                )
                subprocess.run(
                    [sys.executable, "-m", "pip", "install", cfg_model_url],
                    check=True,
                    capture_output=True,
                )
                importlib.invalidate_caches()

        try:
            nlp = spacy.load(cfg_model)
        except OSError:
            logger.warning("spaCy model '%s' not found; using default NLP engine", cfg_model)
            return None

        nlp_engine_module = require_module(
            "presidio_analyzer.nlp_engine",
            "pii",
            ["privacy", "detectors"],
        )
        ner_config_module = require_module(
            "presidio_analyzer.nlp_engine.ner_model_configuration",
            "pii",
            ["privacy", "detectors"],
        )

        ner_config = nlp_engine_module.NerModelConfiguration(
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
            model_to_presidio_entity_mapping=ner_config_module.MODEL_TO_PRESIDIO_ENTITY_MAPPING,
            low_score_entity_names=ner_config_module.LOW_SCORE_ENTITY_NAMES,
        )
        nlp_engine = nlp_engine_module.SpacyNlpEngine(
            models=[{"lang_code": "en", "model_name": cfg_model}],
            ner_model_configuration=ner_config,
        )
        nlp_engine.nlp = {"en": nlp}
        logger.debug("Loaded spaCy model '%s'", cfg_model)
        return nlp_engine

    def _register_custom_recognizers(self, presidio_module: Any) -> None:
        """Add ad-hoc recognizers from config to the analyzer registry."""
        custom_recognizers = getattr(self.config, "custom_recognizers", None) or []
        if not custom_recognizers:
            return

        PatternRecognizer = presidio_module.PatternRecognizer  # noqa: N806
        Pattern = presidio_module.Pattern  # noqa: N806

        for rec in custom_recognizers:
            raw_patterns = getattr(rec.patterns, "root", rec.patterns) or []
            patterns = [Pattern(name=p.name, regex=p.regex, score=p.score) for p in raw_patterns]
            raw_deny_list = getattr(rec.deny_list, "root", rec.deny_list)
            deny_list = list(raw_deny_list) if raw_deny_list else None
            context = list(rec.context) if rec.context else None

            recognizer = PatternRecognizer(
                supported_entity=rec.supported_entity,
                name=rec.name,
                supported_language=rec.supported_language or "en",
                patterns=patterns or None,
                deny_list=deny_list,
                context=context,
            )
            self.analyzer.registry.add_recognizer(recognizer)
            logger.debug(
                "Registered custom recognizer '%s' → entity '%s'",
                rec.name,
                rec.supported_entity,
            )

    def _probe_phone_recognizer(self) -> None:
        """Verify phonenumbers regional data loads correctly; remove PhoneRecognizer if broken.

        phonenumbers >=9 uses __import__ with level=1 for lazy region loading, which can fail
        in certain execution contexts (e.g. frozen environments, some uv/venv setups).
        Probing once at init avoids per-call ModuleNotFoundError spam.
        """
        if self.analyzer is None:
            return
        try:
            import phonenumbers

            phonenumbers.parse("+12025551234", None)
        except ModuleNotFoundError as exc:
            logger.warning(
                "phonenumbers regional data unavailable (%s) — PHONE_NUMBER entity disabled", exc
            )
            self.analyzer.registry.recognizers = [
                r
                for r in self.analyzer.registry.recognizers
                if "phone" not in r.name.lower()
            ]
            self._ALL_SUPPORTED_ENTITIES = self._ALL_SUPPORTED_ENTITIES - {"PHONE_NUMBER"}
        except Exception:
            pass

    # ------------------------------------------------------------------
    # Entity filtering
    # ------------------------------------------------------------------

    def _enabled_entities(self) -> set[str] | None:
        """Return the set of enabled Presidio entity types, or None for all."""
        configured = getattr(self.config, "enabled_patterns", None)
        if not configured:
            return None
        normalized = {str(p).strip().upper() for p in configured if str(p).strip()}
        return normalized or None

    def _is_entity_enabled(self, entity_type: str) -> bool:
        enabled = self._enabled_entities()
        return True if enabled is None else entity_type.upper() in enabled

    # ------------------------------------------------------------------
    # Tabular column heuristics
    # ------------------------------------------------------------------

    def _normalize_column_name(self, column_name: str) -> str:
        return re.sub(r"[^a-z0-9]+", " ", column_name.lower()).strip()

    def _column_tokens(self, column_name: str) -> set[str]:
        normalized = self._normalize_column_name(column_name)
        return {t for t in normalized.split() if t}

    def _is_free_text_column(self, column_name: str) -> bool:
        return bool(self._column_tokens(column_name) & self._FREE_TEXT_COLUMN_TOKENS)

    def _allowed_entities_for_column(self, column_name: str) -> set[str]:
        """Return the Presidio entity types that are relevant for this column name."""
        enabled = self._enabled_entities() or self._ALL_SUPPORTED_ENTITIES
        tokens = self._column_tokens(column_name)

        if not tokens:
            return enabled - self._NON_TEXT_ENTITY_TYPES

        if tokens & self._FREE_TEXT_COLUMN_TOKENS:
            return enabled

        allowed: set[str] = set()
        for token in tokens:
            allowed.update(self._COLUMN_ENTITY_HINTS.get(token, set()))

        if tokens & self._NAME_COLUMN_TOKENS and "company" not in tokens:
            allowed.add("PERSON")
        if tokens & self._EMAIL_COLUMN_TOKENS:
            allowed.add("EMAIL_ADDRESS")
        if tokens & self._PHONE_COLUMN_TOKENS:
            allowed.add("PHONE_NUMBER")
        if tokens & self._ADDRESS_COLUMN_TOKENS:
            allowed.add("LOCATION")

        if allowed:
            return allowed & enabled

        if tokens & self._URL_COLUMN_TOKENS:
            return {"IP_ADDRESS", "URL"} & enabled

        if tokens & self._ID_COLUMN_TOKENS:
            return set()

        return enabled - self._NON_TEXT_ENTITY_TYPES

    def _is_entity_allowed_for_column(self, entity_type: str, column_name: str) -> bool:
        allowed = self._allowed_entities_for_column(column_name)
        if not allowed:
            return False
        entity_upper = entity_type.upper()
        if entity_upper not in self._ALL_SUPPORTED_ENTITIES:
            # Custom entity: allow in free-text columns when no pattern filter is active.
            return self._enabled_entities() is None and self._is_free_text_column(column_name)
        return entity_upper in allowed

    # ------------------------------------------------------------------
    # Presidio analysis
    # ------------------------------------------------------------------

    def _analyze_content(self, content: str, *, entities: list[str] | None = None) -> list[Any]:
        if self.analyzer is None:
            if self._init_error is not None:
                raise self._init_error
            return []
        try:
            return self.analyzer.analyze(text=content, language="en", entities=entities)
        except ModuleNotFoundError as exc:
            if "phonenumbers" in str(exc):
                logger.warning("phonenumbers data missing mid-run; disabling PHONE_NUMBER entity")
                self._probe_phone_recognizer()
                # Retry without the now-removed phone recognizer
                retry_entities = (
                    [e for e in entities if e != "PHONE_NUMBER"] if entities is not None else None
                )
                try:
                    return self.analyzer.analyze(text=content, language="en", entities=retry_entities)
                except Exception:
                    return []
            logger.error("PII analysis failed: %s", exc)
            logger.exception(exc)
            return []
        except Exception as e:
            logger.error("PII analysis failed: %s", e)
            logger.exception(e)
            return []

    def _analyzer_supported_entities(self) -> frozenset[str]:
        if self._supported_entities_cache is not None:
            return self._supported_entities_cache
        if self.analyzer is None:
            return frozenset()
        self._supported_entities_cache = frozenset(self.analyzer.get_supported_entities())
        return self._supported_entities_cache

    def _analyze_structured_cell(
        self, content: str, *, allowed_entity_types: set[str]
    ) -> list[Any]:
        if not allowed_entity_types or self.analyzer is None:
            if self.analyzer is None and self._init_error is not None:
                raise self._init_error
            return []

        entities = sorted(allowed_entity_types & self._analyzer_supported_entities())
        if not entities:
            return []

        return self._analyze_content(content, entities=entities)

    # ------------------------------------------------------------------
    # Tabular content detection
    # ------------------------------------------------------------------

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

    def _should_keep_tabular_result(
        self, *, cell: _TabularCell, entity_type: str, matched_content: str
    ) -> bool:
        if entity_type != "PERSON":
            return True
        if not self._is_free_text_column(cell.column_name):
            return True
        token_count = len(re.findall(r"[A-Za-z][A-Za-z'-]*", matched_content))
        return token_count >= 2

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
            elif finding.confidence > existing.confidence:
                deduped[key] = finding

        return [deduped[k] for k in ordered_keys]

    def _detect_tabular_content(self, content: str) -> list[DetectionResult] | None:
        cells = self._extract_tabular_cells(content)
        if not cells:
            return None

        # For very wide/long pages fall back to full-text analysis to avoid O(N) Presidio calls.
        if len(cells) > self._TABULAR_CELL_LIMIT:
            logger.debug(
                "Page has %d cells (> %d limit); using full-text analysis instead of per-cell",
                len(cells),
                self._TABULAR_CELL_LIMIT,
            )
            return None

        threshold = self.config.confidence_threshold or 0.7
        results: list[DetectionResult] = []

        for cell in cells:
            allowed = self._allowed_entities_for_column(cell.column_name)
            if not allowed:
                continue

            for result in self._analyze_structured_cell(cell.value, allowed_entity_types=allowed):
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

                detection = self._build_detection_result(
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
                if detection.confidence >= threshold:
                    results.append(detection)

        return self._dedupe_tabular_findings(results)

    # ------------------------------------------------------------------
    # Result construction
    # ------------------------------------------------------------------

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
        base_metadata: dict[str, Any] = {
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

    def _get_severity_for_entity(self, entity_type: str) -> Severity:
        e = entity_type.upper()

        # Critical — government IDs, financial account numbers, biometric IDs
        if e in {
            "CREDIT_CARD",
            "CRYPTO",
            "IBAN_CODE",
            "US_SSN",
            "US_PASSPORT",
            "US_DRIVER_LICENSE",
            "US_BANK_NUMBER",
            "US_ITIN",
            "UK_NHS",
            "AT_SVNR",
            "CH_AHV",
            "DE_TAX_ID",
            "EU_NATIONAL_ID",
            "ES_NIF",
            "ES_NIE",
            "IT_FISCAL_CODE",
            "IT_PASSPORT",
            "IT_DRIVER_LICENSE",
            "IT_IDENTITY_CARD",
            "SG_NRIC_FIN",
            "AU_TFN",
            "AU_MEDICARE",
            "IN_PAN",
            "IN_AADHAAR",
            "FI_PERSONAL_IDENTITY_CODE",
            "PL_PESEL",
        }:
            return Severity.critical

        # High — contact identifiers, business numbers, less-direct personal IDs
        if e in {
            "EMAIL_ADDRESS",
            "PHONE_NUMBER",
            "IP_ADDRESS",
            "MEDICAL_LICENSE",
            "AU_ABN",
            "AU_ACN",
            "SG_UEN",
            "IT_VAR_CODE",
            "IN_VOTER",
            "IN_VEHICLE_REGISTRATION",
        }:
            return Severity.high

        # Medium — contextual personal information
        if e in {"PERSON", "LOCATION", "DATE_TIME", "NRP", "URL"}:
            return Severity.medium

        return Severity.high

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def detect(self, content: str, content_type: str = "text/plain") -> list[DetectionResult]:
        """Detect PII in *content* and return a list of :class:`DetectionResult` objects."""
        tabular_results = self._detect_tabular_content(content)
        if tabular_results is not None:
            if self.config.max_findings and len(tabular_results) > self.config.max_findings:
                return tabular_results[: self.config.max_findings]
            return tabular_results

        enabled = self._enabled_entities()
        entities = sorted(enabled) if enabled else None
        analyzer_results = self._analyze_content(content, entities=entities)

        threshold = self.config.confidence_threshold or 0.7
        results: list[DetectionResult] = []

        for result in analyzer_results:
            if not self._is_entity_enabled(result.entity_type):
                continue

            line_number = content[: result.start].count("\n") + 1
            matched_content = content[result.start : result.end]

            detection = self._build_detection_result(
                matched_content=matched_content,
                entity_type=result.entity_type,
                confidence=result.score,
                recognition_metadata=result.recognition_metadata,
                line_number=line_number,
                start=result.start,
                end=result.end,
            )
            if detection.confidence >= threshold:
                results.append(detection)

        if self.config.max_findings and len(results) > self.config.max_findings:
            results = results[: self.config.max_findings]

        return results

    def get_supported_content_types(self) -> list[str]:
        return ["text/plain", "text/html", "application/json", "text/xml"]
