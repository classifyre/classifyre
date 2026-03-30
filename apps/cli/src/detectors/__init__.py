"""Detector package for identifying sensitive content."""

import importlib
import logging
import pkgutil

from ..models.generated_detectors import DetectorConfig
from .base import BaseDetector

__all__ = ["BaseDetector", "get_detector", "list_available_detectors"]

logger = logging.getLogger(__name__)

_registry: dict[str, "type[BaseDetector]"] = {}


def _discover_detectors() -> None:
    """Auto-discover all BaseDetector subclasses in the detectors package."""
    if _registry:
        # Already discovered
        return

    logger.debug("Starting detector discovery...")

    # Walk through all modules in the detectors package
    for _loader, module_name, is_pkg in pkgutil.walk_packages(__path__, __name__ + "."):
        if is_pkg:
            continue

        try:
            # Import the module
            module = importlib.import_module(module_name)

            # Find all BaseDetector subclasses in the module
            for attr_name in dir(module):
                if attr_name.startswith("_"):
                    continue
                attr = getattr(module, attr_name)

                # Check if it's a BaseDetector subclass (but not BaseDetector itself)
                if (
                    isinstance(attr, type)
                    and issubclass(attr, BaseDetector)
                    and attr is not BaseDetector
                ):
                    # Get detector name from class attribute or derive from class name
                    detector_name = getattr(attr, "detector_name", None)
                    if not detector_name:
                        # Fallback: derive from class name
                        detector_name = attr.__name__.replace("Detector", "").lower()
                    if str(detector_name).startswith("_"):
                        continue

                    # Register the detector
                    if detector_name in _registry:
                        logger.warning(
                            f"Duplicate detector name '{detector_name}' - "
                            f"ignoring {module_name}.{attr_name}"
                        )
                    else:
                        _registry[detector_name] = attr
                        logger.debug(
                            f"Registered detector '{detector_name}' from {module_name}.{attr_name}"
                        )

        except Exception as e:
            logger.error(f"Failed to import {module_name}: {e}")


def get_detector(detector_name: str, config: DetectorConfig | None = None) -> BaseDetector:
    """
    Factory function to create a detector instance.

    Args:
        detector_name: Name of the detector to create
        config: Optional detector configuration

    Returns:
        Instance of the requested detector

    Raises:
        ValueError: If detector_name is not found in registry
    """
    # Ensure detectors are discovered
    _discover_detectors()

    if detector_name not in _registry:
        available = ", ".join(sorted(_registry.keys()))
        raise ValueError(f"Detector '{detector_name}' not found. Available: {available or 'none'}")

    detector_class = _registry[detector_name]
    return detector_class(config)


def list_available_detectors() -> list[str]:
    """
    Return list of all registered detector names.

    Returns:
        Sorted list of detector names
    """
    # Ensure detectors are discovered
    _discover_detectors()

    return sorted(_registry.keys())
