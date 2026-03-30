import importlib
import inspect
import logging
import pkgutil
from typing import Any

from .base import BaseSource

logger = logging.getLogger(__name__)

_registry: dict[str, type[BaseSource]] = {}


def _discover_sources() -> None:
    """
    Automatically discover and register all BaseSource subclasses
    in the subpackages of src.sources.
    """
    if _registry:
        return

    # Iterate over all subpackages in the current directory
    for _loader, module_name, is_pkg in pkgutil.walk_packages(__path__, __name__ + "."):
        if is_pkg:
            continue

        try:
            module = importlib.import_module(module_name)
            for attr_name in dir(module):
                attr = getattr(module, attr_name)
                # Check if it's a class, inherits from BaseSource, and is not BaseSource itself
                if (
                    isinstance(attr, type)
                    and issubclass(attr, BaseSource)
                    and attr is not BaseSource
                    and not inspect.isabstract(attr)
                ):
                    # We can use a class attribute for the type name,
                    # or derive it from the class name/module name.
                    # Let's assume the class might have a 'source_type' attribute,
                    # otherwise we fallback to a cleaned up class name.
                    source_type = getattr(attr, "source_type", None)
                    if not source_type:
                        # Fallback: WordPressSource -> wordpress
                        source_type = attr.__name__.replace("Source", "").lower()

                    if source_type in _registry:
                        logger.warning(
                            f"Duplicate source type '{source_type}' registered by {attr.__name__}"
                        )
                    else:
                        _registry[source_type] = attr
                        logger.debug(f"Registered source type '{source_type}' from {module_name}")
        except Exception as e:
            logger.error(f"Failed to import module {module_name}: {e}")


def get_source(
    recipe: dict[str, Any],
    source_id: str | None = None,
    runner_id: str | None = None,
) -> BaseSource:
    """
    Factory function to create a source instance from a recipe.

    Args:
        recipe: Source configuration
        source_id: Optional source ID for asset attribution
        runner_id: Optional runner ID for tracking
    """
    _discover_sources()

    source_type = recipe.get("type", "").lower()
    if not source_type:
        raise ValueError("Recipe must have a 'type' field")

    source_class = _registry.get(source_type)
    if not source_class:
        available = ", ".join(sorted(_registry.keys()))
        raise ValueError(f"Source type '{source_type}' not found. Available sources: {available}")

    # Prefer passing source_id + runner_id for full attribution.
    try:
        return source_class(recipe, source_id=source_id, runner_id=runner_id)
    except TypeError:
        try:
            return source_class(recipe, runner_id=runner_id)
        except TypeError:
            return source_class(recipe)


def list_available_sources() -> list[str]:
    """Return a list of all registered source types."""
    _discover_sources()
    return sorted(_registry.keys())
