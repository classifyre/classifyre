"""HTML to text content extraction utilities for detector scanning."""

import logging

from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)


def html_to_text(html: str, preserve_structure: bool = True) -> str:
    """
    Extract plain text from HTML for detector scanning.

    Removes scripts, styles, and other non-content elements while preserving
    the text content. Optionally preserves document structure with newlines.

    Args:
        html: HTML content to extract text from
        preserve_structure: Keep newlines for document structure (default: True)

    Returns:
        Clean plain text extracted from HTML

    Examples:
        >>> html_to_text("<p>Hello <b>world</b></p>")
        'Hello world'

        >>> html_to_text("<h1>Title</h1><p>Text</p>")
        'Title\\nText'
    """
    if not html or not html.strip():
        return ""

    try:
        import re

        # Parse HTML using lxml for speed
        soup = BeautifulSoup(html, "lxml")

        # Remove script, style, noscript elements
        for element in soup(["script", "style", "noscript"]):
            element.decompose()

        if preserve_structure:
            # Add newlines after block-level elements for structure preservation
            block_elements = [
                "p",
                "div",
                "h1",
                "h2",
                "h3",
                "h4",
                "h5",
                "h6",
                "li",
                "tr",
                "br",
                "hr",
            ]
            for tag in soup.find_all(block_elements):
                # Insert a newline after each block element
                tag.append("\n")

        # Get text
        text = soup.get_text(separator=" ")

        # Clean up whitespace
        if preserve_structure:
            # Normalize whitespace within lines
            text = re.sub(r"[ \t]+", " ", text)
            # Remove leading/trailing whitespace per line
            lines = [line.strip() for line in text.split("\n")]
            # Remove empty lines and join
            text = "\n".join(line for line in lines if line)
        else:
            # For non-structure mode, just collapse all whitespace
            text = re.sub(r"\s+", " ", text).strip()

        return text

    except Exception as e:
        logger.error(f"Failed to parse HTML: {e}")
        # Fallback: return HTML as-is (detectors will still work)
        return html


def strip_html_tags(html: str) -> str:
    """
    Simple tag removal without parsing (faster but less accurate).

    This is a lightweight alternative to html_to_text that uses regex
    to strip tags. It doesn't handle entities, nested structures, or
    script/style removal. Use html_to_text for better results.

    Args:
        html: HTML content to strip tags from

    Returns:
        Text with HTML tags removed

    Examples:
        >>> strip_html_tags("<p>Hello <b>world</b></p>")
        'Hello world'
    """
    import re

    clean = re.compile("<.*?>")
    return re.sub(clean, "", html)
