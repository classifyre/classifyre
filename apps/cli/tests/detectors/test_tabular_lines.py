"""Which table cell each line of a tabular sample belongs to."""

from src.detectors.tabular_lines import LineCell, cells_of_lines


def test_first_row_cells() -> None:
    lines = ["row_1:", "  email: someone@example.test", "  token: abc"]
    assert cells_of_lines(lines) == [
        None,
        LineCell(1, "email"),
        LineCell(1, "token"),
    ]


def test_a_later_page_starts_at_its_own_row() -> None:
    # A sweep hands detectors one row per page: row_2, row_41, …
    lines = ["row_2:", "  token: ghp_abc"]
    assert cells_of_lines(lines) == [None, LineCell(2, "token")]


def test_deeper_lines_continue_the_cell_above() -> None:
    lines = [
        "row_3:",
        "  notes: first line",
        "    password: not a column",
        "  email: x@example.test",
    ]
    assert cells_of_lines(lines) == [
        None,
        LineCell(3, "notes"),
        LineCell(3, "notes"),
        LineCell(3, "email"),
    ]


def test_text_that_is_not_a_sample_has_no_cells() -> None:
    lines = ["  email: x@example.test", "row 1: nothing"]
    assert cells_of_lines(lines) == [None, None]
