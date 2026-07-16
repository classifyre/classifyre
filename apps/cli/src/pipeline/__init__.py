"""Pipeline for processing assets through detectors.

Exports are lazy so lightweight callers do not import the detector and source
graph (which itself uses the REST output types).
"""

from typing import Any

__all__ = ["ContentProvider", "DetectorPipeline", "ParsedContentProvider"]


def __getattr__(name: str) -> Any:
    if name == "ContentProvider":
        from .content_provider import ContentProvider

        return ContentProvider
    if name == "DetectorPipeline":
        from .detector_pipeline import DetectorPipeline

        return DetectorPipeline
    if name == "ParsedContentProvider":
        from .parsed_content_provider import ParsedContentProvider

        return ParsedContentProvider
    raise AttributeError(name)
