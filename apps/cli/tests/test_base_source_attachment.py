"""Tests for BaseSource attachment-name helpers."""

from __future__ import annotations

from src.sources.confluence.source import ConfluenceSource
from src.sources.jira.source import JiraSource
from src.sources.servicedesk.source import ServiceDeskSource


def _confluence_source() -> ConfluenceSource:
    return ConfluenceSource(
        {
            "type": "CONFLUENCE",
            "required": {
                "base_url": "https://example.atlassian.net",
                "account_email": "user@example.com",
            },
            "masked": {"api_token": "tok"},
            "sampling": {"strategy": "ALL"},
        }
    )


def _jira_source() -> JiraSource:
    return JiraSource(
        {
            "type": "JIRA",
            "required": {
                "base_url": "https://example.atlassian.net",
                "account_email": "user@example.com",
            },
            "masked": {"api_token": "tok"},
            "sampling": {"strategy": "ALL"},
        }
    )


def _servicedesk_source() -> ServiceDeskSource:
    return ServiceDeskSource(
        {
            "type": "SERVICEDESK",
            "required": {
                "base_url": "https://example.atlassian.net",
                "account_email": "user@example.com",
            },
            "masked": {"api_token": "tok"},
            "sampling": {"strategy": "ALL"},
        }
    )


class TestAttachmentFileNameFromBase:
    """_attachment_file_name is now defined on BaseSource and shared by all three sources."""

    def test_returns_stored_name_when_present(self) -> None:
        source = _confluence_source()
        source._attachment_name_by_hash["abc123"] = "invoice.pdf"

        assert (
            source._attachment_file_name("abc123", "https://example.com/dl/abc123") == "invoice.pdf"
        )

    def test_strips_whitespace_from_stored_name(self) -> None:
        source = _jira_source()
        source._attachment_name_by_hash["xyz"] = "  report.docx  "

        assert source._attachment_file_name("xyz", "fallback") == "report.docx"

    def test_returns_fallback_when_hash_not_found(self) -> None:
        source = _servicedesk_source()

        assert (
            source._attachment_file_name("missing", "https://fallback/url")
            == "https://fallback/url"
        )

    def test_returns_fallback_when_stored_name_is_blank(self) -> None:
        source = _confluence_source()
        source._attachment_name_by_hash["blank"] = "   "

        assert source._attachment_file_name("blank", "fallback.pdf") == "fallback.pdf"

    def test_reset_clears_attachment_names(self) -> None:
        source = _jira_source()
        source._attachment_name_by_hash["abc"] = "file.txt"

        source._reset_runtime_state()

        assert source._attachment_file_name("abc", "fallback") == "fallback"

    def test_jira_and_confluence_share_same_implementation(self) -> None:
        jira = _jira_source()
        confluence = _confluence_source()
        jira._attachment_name_by_hash["k"] = "shared.pdf"
        confluence._attachment_name_by_hash["k"] = "shared.pdf"

        assert jira._attachment_file_name("k", "x") == confluence._attachment_file_name("k", "x")

    def test_attachment_name_by_hash_initialized_in_base(self) -> None:
        source = _servicedesk_source()
        assert hasattr(source, "_attachment_name_by_hash")
        assert isinstance(source._attachment_name_by_hash, dict)
