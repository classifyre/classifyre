"""The augmentation contract: augment() required, setup()/finalize() optional."""

from __future__ import annotations

from src.augmentation.contract import (
    OPTIONAL_FUNCTIONS,
    REQUIRED_FUNCTIONS,
    validate_augmentation_notebook,
)


def _cells(*sources: str) -> list[dict[str, str]]:
    return [
        {"id": f"cell-{index}", "type": "code", "source": source}
        for index, source in enumerate(sources)
    ]


def test_required_and_optional_names() -> None:
    assert REQUIRED_FUNCTIONS == ("augment",)
    assert set(OPTIONAL_FUNCTIONS) == {"setup", "finalize"}


def test_minimal_notebook_passes() -> None:
    report = validate_augmentation_notebook(_cells("def augment(asset):\n    pass\n"))
    assert report.ok, report.to_dict()


def test_setup_and_finalize_are_optional() -> None:
    report = validate_augmentation_notebook(
        _cells(
            "def setup():\n    pass\n",
            "def augment(asset):\n    pass\n",
            "def finalize():\n    pass\n",
        )
    )
    assert report.ok, report.to_dict()
    assert set(report.defined_functions) == {"setup", "augment", "finalize"}


def test_missing_augment_fails() -> None:
    report = validate_augmentation_notebook(_cells("def setup():\n    pass\n"))
    assert not report.ok
    assert report.missing == ("augment",)


def test_connector_functions_do_not_satisfy_the_contract() -> None:
    # An augmentation is not a connector: test_connection()/extract() are the
    # wrong shape, and must not pass.
    report = validate_augmentation_notebook(
        _cells("def test_connection():\n    pass\n", "def extract():\n    pass\n")
    )
    assert not report.ok
    assert report.missing == ("augment",)


def test_syntax_error_is_a_violation() -> None:
    report = validate_augmentation_notebook(_cells("def augment(:\n"))
    assert not report.ok
    assert report.violations[0].kind == "syntax_error"


def test_augment_as_a_variable_is_not_a_function() -> None:
    report = validate_augmentation_notebook(_cells("augment = 42\n"))
    assert not report.ok
    assert report.violations[0].kind == "not_a_function"


def test_shadowed_definitions_are_warnings_not_violations() -> None:
    report = validate_augmentation_notebook(
        _cells(
            "def helper():\n    pass\n",
            "def helper():\n    pass\n",
            "def augment(asset):\n    pass\n",
        )
    )
    assert report.ok
    assert any(w.kind == "shadowed_definition" for w in report.warnings)


def test_empty_notebook_fails() -> None:
    assert not validate_augmentation_notebook([]).ok
