"""Factory function for creating runner instances from pipeline schemas."""

from __future__ import annotations

from ....models.generated_detectors import (
    FeatureExtractionPipelineSchema,
    GLiNER2PipelineSchema,
    ImageClassificationPipelineSchema,
    LLMPipelineSchema,
    ObjectDetectionPipelineSchema,
    RegexPipelineSchema,
    TextClassificationPipelineSchema,
)
from ._base import BaseRunner
from ._feature_extraction import FeatureExtractionRunner
from ._gliner2 import GLiNER2Runner
from ._image_classification import ImageClassificationRunner
from ._llm import LLMRunner
from ._object_detection import ObjectDetectionRunner
from ._regex import RegexRunner
from ._text_classification import TextClassificationRunner


def create_runner(
    schema: (
        GLiNER2PipelineSchema
        | RegexPipelineSchema
        | LLMPipelineSchema
        | TextClassificationPipelineSchema
        | ImageClassificationPipelineSchema
        | FeatureExtractionPipelineSchema
        | ObjectDetectionPipelineSchema
    ),
    detector_key: str = "",
    detector_name: str = "",
) -> BaseRunner:
    """Return the appropriate runner for *schema* based on its type discriminator."""
    if isinstance(schema, TextClassificationPipelineSchema):
        return TextClassificationRunner(schema, detector_key, detector_name)
    if isinstance(schema, ImageClassificationPipelineSchema):
        return ImageClassificationRunner(schema, detector_key, detector_name)
    if isinstance(schema, FeatureExtractionPipelineSchema):
        return FeatureExtractionRunner(schema, detector_key, detector_name)
    if isinstance(schema, ObjectDetectionPipelineSchema):
        return ObjectDetectionRunner(schema, detector_key, detector_name)
    if isinstance(schema, RegexPipelineSchema):
        return RegexRunner(schema, detector_key, detector_name)
    if isinstance(schema, LLMPipelineSchema):
        return LLMRunner(schema, detector_key, detector_name)
    # GLiNER2PipelineSchema is the default / backward-compat path
    return GLiNER2Runner(schema, detector_key, detector_name)
