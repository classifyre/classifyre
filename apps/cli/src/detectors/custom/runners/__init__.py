"""Custom detector runner package.

Public surface re-exported here so that existing imports of the form
    from .runners import BaseRunner, create_runner, GLiNER2Runner, ...
continue to work unchanged.
"""

from ._base import (
    _DEFAULT_GLINER2_MODEL,
    _DEFAULT_IMAGE_CLASSIFICATION_MODEL,
    _IMAGE_CONTENT_TYPES,
    _TEXT_CONTENT_TYPES,
    BaseRunner,
    _resolve_pipeline_severity,
)
from ._factory import create_runner
from ._feature_extraction import FeatureExtractionRunner, _chunk_text_with_offsets, _pool_hidden
from ._gliner2 import (
    GLiNER2Runner,
    _apply_classification_validation,
    _apply_entity_validation,
    _normalise_classification_output,
    _normalise_entity_output,
    _normalise_span,
)
from ._image_classification import ImageClassificationRunner
from ._llm import LLMRunner
from ._object_detection import ObjectDetectionRunner
from ._regex import RegexRunner, _load_regex_engine
from ._text_classification import TextClassificationRunner, _chunk_text

__all__ = [
    "_DEFAULT_GLINER2_MODEL",
    "_DEFAULT_IMAGE_CLASSIFICATION_MODEL",
    "_IMAGE_CONTENT_TYPES",
    "_TEXT_CONTENT_TYPES",
    "BaseRunner",
    "FeatureExtractionRunner",
    "GLiNER2Runner",
    "ImageClassificationRunner",
    "LLMRunner",
    "ObjectDetectionRunner",
    "RegexRunner",
    "TextClassificationRunner",
    "_apply_classification_validation",
    "_apply_entity_validation",
    "_chunk_text",
    "_chunk_text_with_offsets",
    "_load_regex_engine",
    "_normalise_classification_output",
    "_normalise_entity_output",
    "_normalise_span",
    "_pool_hidden",
    "_resolve_pipeline_severity",
    "create_runner",
]
