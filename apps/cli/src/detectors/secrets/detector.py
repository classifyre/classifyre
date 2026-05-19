"""Secrets detector powered by the detect-secrets library.

Operates entirely in-memory: splits text into lines and invokes each enabled
plugin's ``analyze_line`` directly.  No temp files, no global Settings state,
and no ``SecretsCollection`` needed.
"""

import importlib
import logging
import pkgutil
from typing import Any

from ...models.generated_detectors import DetectorConfig, SecretsDetectorConfig, Severity
from ...models.generated_single_asset_scan_results import DetectionResult, DetectorType, Location
from ..base import BaseDetector
from ..dependencies import MissingDependencyError, require_module

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Lazy plugin discovery
# ---------------------------------------------------------------------------
# detect-secrets is an optional dependency (security group).  We must NOT
# touch the package at module-import time because the CLI auto-installs it
# lazily when the detector is instantiated.  _discover_plugins() is therefore
# deferred until the first call to _build_plugins().
# ---------------------------------------------------------------------------

# Mutable container avoids the need for the ``global`` keyword.
_plugin_cache: dict[str, Any] = {"_loaded": False}


def _discover_plugins() -> dict[str, tuple[str, str]]:
    """Return {pattern_key: (module_path, class_name)} by scanning detect_secrets.plugins."""
    import detect_secrets.plugins

    # Build {class_name -> module_path} from the installed package
    class_to_mod: dict[str, str] = {}
    for _, mod_name, is_pkg in pkgutil.iter_modules(detect_secrets.plugins.__path__):
        if is_pkg or mod_name == "base":
            continue
        full_mod = f"detect_secrets.plugins.{mod_name}"
        try:
            mod = importlib.import_module(full_mod)
            for name in dir(mod):
                obj = getattr(mod, name)
                if isinstance(obj, type) and obj.__module__ == full_mod:
                    class_to_mod[name] = full_mod
        except Exception:
            continue

    _pattern_to_class: dict[str, str] = {
        "artifactory": "ArtifactoryDetector",
        "aws": "AWSKeyDetector",
        "azure_storage": "AzureStorageKeyDetector",
        "basic_auth": "BasicAuthDetector",
        "cloudant": "CloudantDetector",
        "discord": "DiscordBotTokenDetector",
        "github": "GitHubTokenDetector",
        "gitlab": "GitLabTokenDetector",
        "high_entropy_base64": "Base64HighEntropyString",
        "high_entropy_hex": "HexHighEntropyString",
        "ibm_cloud_iam": "IbmCloudIamDetector",
        "ibm_cos_hmac": "IbmCosHmacDetector",
        "ip_public": "IPPublicDetector",
        "jwt": "JwtTokenDetector",
        "keyword": "KeywordDetector",
        "mailchimp": "MailchimpDetector",
        "npm": "NpmDetector",
        "openai": "OpenAIDetector",
        "private_key": "PrivateKeyDetector",
        "pypi": "PypiTokenDetector",
        "sendgrid": "SendGridDetector",
        "slack": "SlackDetector",
        "softlayer": "SoftlayerDetector",
        "square_oauth": "SquareOAuthDetector",
        "stripe": "StripeDetector",
        "telegram": "TelegramBotTokenDetector",
        "twilio": "TwilioKeyDetector",
    }

    specs: dict[str, tuple[str, str]] = {}
    for key, cls_name in _pattern_to_class.items():
        mod = class_to_mod.get(cls_name)
        if mod:
            specs[key] = (mod, cls_name)
        else:
            logger.warning(
                "Plugin class '%s' not found in installed detect-secrets; "
                "pattern '%s' will be skipped",
                cls_name,
                key,
            )
    return specs


def _get_plugin_specs() -> dict[str, tuple[str, str]]:
    """Lazy accessor for plugin specs (populated on first call)."""
    if not _plugin_cache["_loaded"]:
        _plugin_cache["specs"] = _discover_plugins()
        _plugin_cache["defaults"] = list(_plugin_cache["specs"].keys())
        _plugin_cache["_loaded"] = True
    return _plugin_cache["specs"]


# Severity classification by keywords in detect-secrets finding type (lowercased).
_SEVERITY_RULES: list[tuple[Severity, list[str]]] = [
    (
        Severity.critical,
        [
            "aws",
            "private key",
            "github",
            "gitlab",
            "slack",
            "stripe",
            "azure storage",
            "google oauth",
            "openai",
        ],
    ),
    (
        Severity.high,
        [
            "artifactory",
            "basic auth",
            "cloudant",
            "discord",
            "ibm",
            "json web token",
            "mailchimp",
            "npm",
            "pypi",
            "sendgrid",
            "softlayer",
            "square",
            "telegram",
            "twilio",
        ],
    ),
    (Severity.medium, ["entropy", "keyword", "ip public"]),
]

_SEVERITY_RANK: dict[Severity, int] = {
    Severity.info: 0,
    Severity.low: 1,
    Severity.medium: 2,
    Severity.high: 3,
    Severity.critical: 4,
}

# Confidence by keywords in detect-secrets finding type (lowercased).
_CONFIDENCE_RULES: list[tuple[float, list[str]]] = [
    (
        0.95,
        [
            "aws",
            "github",
            "gitlab",
            "private key",
            "slack",
            "stripe",
            "azure storage",
            "openai",
            "pypi",
        ],
    ),
    (
        0.85,
        [
            "artifactory",
            "basic auth",
            "cloudant",
            "discord",
            "ibm",
            "mailchimp",
            "npm",
            "sendgrid",
            "softlayer",
            "square",
            "telegram",
            "twilio",
        ],
    ),
    (0.80, ["json web token"]),
    (0.75, ["entropy"]),
    (0.70, ["keyword", "ip public"]),
]


class SecretsDetector(BaseDetector):
    """Secrets detector backed by the detect-secrets library.

    Each enabled plugin is imported and instantiated directly.  Text is scanned
    line-by-line in memory via ``analyze_line`` -- no temp files, no global
    Settings state, and no async locking required.
    """

    detector_type = "secrets"
    detector_name = "secrets"

    def __init__(self, config: DetectorConfig | None = None):
        super().__init__(config)
        self._cfg: SecretsDetectorConfig = (
            config if isinstance(config, SecretsDetectorConfig) else SecretsDetectorConfig()
        )
        # Fail fast at construction time if detect-secrets is not installed.
        try:
            require_module("detect_secrets", "secrets", ["security", "detectors"])
        except MissingDependencyError:
            raise

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _enabled_pattern_names(self) -> list[str]:
        """Return the list of pattern string keys to activate."""
        specs = _get_plugin_specs()
        defaults = list(specs.keys())

        raw = self._cfg.enabled_patterns
        if raw is None:
            return defaults

        # Unwrap Pydantic RootModel
        items = raw.root if hasattr(raw, "root") else raw
        if not items:
            return defaults

        names: list[str] = []
        for item in items:
            # item may be a str or a SecretsEnabledPattern enum member
            name = item.value if hasattr(item, "value") else str(item)
            if name in specs:
                names.append(name)
            else:
                logger.warning("Unknown secrets pattern '%s' ignored", name)
        return names

    def _build_plugins(self) -> list[Any]:
        """Import and instantiate each enabled detect-secrets plugin."""
        specs = _get_plugin_specs()
        names = self._enabled_pattern_names()
        plugins: list[Any] = []

        for name in names:
            mod_path, cls_name = specs[name]
            try:
                mod = importlib.import_module(mod_path)
                cls = getattr(mod, cls_name)
            except Exception as exc:
                logger.warning("Failed to import plugin '%s' from %s: %s", cls_name, mod_path, exc)
                continue

            kwargs: dict[str, Any] = {}
            if name == "high_entropy_base64":
                limit = self._cfg.entropy_limit_base64
                if limit is not None:
                    kwargs["limit"] = float(limit.root if hasattr(limit, "root") else limit)
            elif name == "high_entropy_hex":
                limit = self._cfg.entropy_limit_hex
                if limit is not None:
                    kwargs["limit"] = float(limit.root if hasattr(limit, "root") else limit)

            try:
                plugin = cls(**kwargs)
                plugins.append(plugin)
                logger.debug("Initialized secrets plugin: %s", cls_name)
            except Exception as exc:
                logger.warning("Failed to instantiate plugin '%s': %s", cls_name, exc)

        return plugins

    @classmethod
    def _get_severity(cls, secret_type: str) -> Severity:
        t = secret_type.lower()
        for severity, keywords in _SEVERITY_RULES:
            if any(kw in t for kw in keywords):
                return severity
        return Severity.high

    @classmethod
    def _get_confidence(cls, secret_type: str) -> float:
        t = secret_type.lower()
        for confidence, keywords in _CONFIDENCE_RULES:
            if any(kw in t for kw in keywords):
                return confidence
        return 0.85

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def detect(
        self, content: str | bytes, content_type: str = "text/plain"
    ) -> list[DetectionResult]:
        if isinstance(content, bytes):
            try:
                content = content.decode("utf-8", errors="replace")
            except Exception:
                logger.warning(
                    "Secrets detector received non-decodable binary content (%d bytes) and cannot scan it",
                    len(content),
                )
                return []

        plugins = self._build_plugins()
        if not plugins:
            return []

        lines = content.splitlines()
        confidence_threshold: float = self._cfg.confidence_threshold or 0.7
        severity_threshold = self._cfg.severity_threshold
        min_severity_rank = _SEVERITY_RANK.get(severity_threshold, 0) if severity_threshold else 0
        results: list[DetectionResult] = []

        for line_number, line_text in enumerate(lines, start=1):
            for plugin in plugins:
                try:
                    secrets = plugin.analyze_line(
                        filename="<inline>",
                        line=line_text,
                        line_number=line_number,
                    )
                except Exception as exc:
                    logger.debug(
                        "Plugin %s failed on line %d: %s",
                        plugin.__class__.__name__,
                        line_number,
                        exc,
                    )
                    continue

                for secret in secrets:
                    try:
                        secret_type = str(secret.type) if secret.type else ""
                        secret_value = (
                            str(secret.secret_value) if secret.secret_value is not None else ""
                        )
                        is_verified = bool(secret.is_verified)
                    except Exception:
                        continue

                    if not secret_type:
                        continue

                    confidence = self._get_confidence(secret_type)
                    if confidence < confidence_threshold:
                        continue

                    severity = self._get_severity(secret_type)
                    if _SEVERITY_RANK.get(severity, 0) < min_severity_rank:
                        continue

                    if not secret_value:
                        continue

                    col_offset = line_text.find(secret_value) if secret_value in line_text else 0
                    start = col_offset
                    end = start + len(secret_value)

                    results.append(
                        DetectionResult(
                            detector_type=DetectorType.SECRETS,
                            finding_type=secret_type,
                            category="SECRETS",
                            severity=severity,
                            confidence=confidence,
                            matched_content=secret_value,
                            location=Location(
                                start=start,
                                end=end,
                                line=line_number,
                                path=f"line {line_number}",
                            ),
                            metadata={
                                "detector": "secrets",
                                "plugin": secret_type,
                                "is_verified": is_verified,
                            },
                        )
                    )

        if self._cfg.max_findings and len(results) > self._cfg.max_findings:
            results = results[: self._cfg.max_findings]

        return results

    def get_supported_content_types(self) -> list[str]:
        return [
            "text/plain",
            "application/json",
            "application/yaml",
            "application/x-yaml",
            "text/yaml",
            "application/xml",
            "text/xml",
        ]
