"""Tests for HTML to text content extraction utilities."""

from src.utils.content_extraction import html_to_text


def test_html_to_text_removes_tags() -> None:
    """Test that HTML tags are removed."""
    html = "<p>Hello <b>world</b></p>"
    result = html_to_text(html)
    assert "Hello world" in result
    assert "<p>" not in result
    assert "<b>" not in result


def test_html_to_text_removes_scripts() -> None:
    """Test that script tags and content are removed."""
    html = "<p>Text</p><script>alert('bad')</script>"
    result = html_to_text(html)
    assert "alert" not in result
    assert "bad" not in result
    assert "Text" in result


def test_html_to_text_removes_styles() -> None:
    """Test that style tags and content are removed."""
    html = "<p>Text</p><style>body { color: red; }</style>"
    result = html_to_text(html)
    assert "color" not in result
    assert "red" not in result
    assert "Text" in result


def test_html_to_text_preserves_structure() -> None:
    """Test that document structure is preserved with newlines."""
    html = "<h1>Title</h1><p>Paragraph 1</p><p>Paragraph 2</p>"
    result = html_to_text(html)
    assert "Title" in result
    assert "Paragraph 1" in result
    assert "Paragraph 2" in result
    lines = [line for line in result.split("\n") if line.strip()]
    assert len(lines) >= 3


def test_html_to_text_cleans_whitespace() -> None:
    """Test that excessive whitespace is cleaned up."""
    html = "<p>  Too    much   space  </p>"
    result = html_to_text(html)
    assert result.strip() == "Too much space"


def test_html_to_text_handles_structured_markup() -> None:
    """Test structured macro-like markup handling."""
    html = """
    <ac:structured-macro ac:name="info">
      <ac:rich-text-body>
        <p>Important information</p>
      </ac:rich-text-body>
    </ac:structured-macro>
    """
    result = html_to_text(html)
    assert "Important information" in result
    assert "ac:structured-macro" not in result


def test_html_to_text_handles_empty() -> None:
    """Test handling of empty content."""
    assert html_to_text("") == ""
    assert html_to_text("<p></p>") == ""
    assert html_to_text("   ") == ""


def test_html_to_text_handles_nested_elements() -> None:
    """Test deeply nested HTML elements."""
    html = "<div><div><div><p>Deep <span>nested <strong>text</strong></span></p></div></div></div>"
    result = html_to_text(html)
    assert "Deep nested text" in result


def test_html_to_text_handles_lists() -> None:
    """Test list handling."""
    html = """
    <ul>
        <li>Item 1</li>
        <li>Item 2</li>
        <li>Item 3</li>
    </ul>
    """
    result = html_to_text(html)
    assert "Item 1" in result
    assert "Item 2" in result
    assert "Item 3" in result


def test_html_to_text_handles_tables() -> None:
    """Test table content extraction."""
    html = """
    <table>
        <tr><th>Header 1</th><th>Header 2</th></tr>
        <tr><td>Cell 1</td><td>Cell 2</td></tr>
    </table>
    """
    result = html_to_text(html)
    assert "Header 1" in result
    assert "Header 2" in result
    assert "Cell 1" in result
    assert "Cell 2" in result


def test_html_to_text_handles_links() -> None:
    """Test link handling."""
    html = '<p>Visit <a href="https://example.com">our website</a> for more info.</p>'
    result = html_to_text(html)
    assert "Visit" in result
    assert "our website" in result
    assert "for more info" in result


def test_html_to_text_without_structure_preservation() -> None:
    """Test text extraction without preserving structure."""
    html = "<h1>Title</h1><p>Paragraph 1</p><p>Paragraph 2</p>"
    result = html_to_text(html, preserve_structure=False)
    assert "Title" in result
    assert "Paragraph 1" in result
    assert "Paragraph 2" in result


def test_html_to_text_handles_malformed_html() -> None:
    """Test graceful handling of malformed HTML."""
    html = "<p>Unclosed paragraph<div>Missing close tag"
    result = html_to_text(html)
    assert "Unclosed paragraph" in result
    assert "Missing close tag" in result


def test_html_to_text_handles_entities() -> None:
    """Test HTML entity decoding."""
    html = "<p>AT&amp;T, Ben &amp; Jerry's, 5 &lt; 10</p>"
    result = html_to_text(html)
    assert "AT&T" in result
    assert "Ben & Jerry" in result
    assert "5 < 10" in result


def test_html_to_text_handles_unicode() -> None:
    """Test Unicode content handling."""
    html = "<p>Hello 世界! Привет мир! مرحبا العالم</p>"
    result = html_to_text(html)
    assert "Hello 世界!" in result
    assert "Привет мир!" in result
    assert "مرحبا العالم" in result
