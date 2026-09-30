"""Code detectors: the ``CUSTOM_DETECTOR`` pipeline type.

A notebook that defines ``detect(asset, ctx)`` and yields ``Finding`` objects,
run in an isolated child process once per asset, after every other detector.
"""

from .session import CustomDetectorSession, DetectOutcome

__all__ = ["CustomDetectorSession", "DetectOutcome"]
