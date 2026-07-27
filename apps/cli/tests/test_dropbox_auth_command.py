"""Tests for the one-off `classifyre dropbox-auth` authorization helper.

The runner is headless, so a long-lived refresh token has to be minted ahead of
time by an operator at a keyboard. These tests pin the contract that makes that
possible: offline access is always requested, PKCE drops the app secret, and the
printed credentials match the DROPBOX source schema.
"""

from __future__ import annotations

import argparse
import json
from types import SimpleNamespace

import pytest

from src.sources.dropbox import auth as dropbox_auth


def _args(**overrides) -> argparse.Namespace:
    defaults = {
        "app_key": "app-key",
        "app_secret": "app-secret",
        "pkce": False,
        "team": False,
        "scope": None,
    }
    defaults.update(overrides)
    return argparse.Namespace(**defaults)


class _FakeFlow:
    def __init__(self, refresh_token: str | None = "refresh-token") -> None:
        self.refresh_token = refresh_token
        self.finished_with: str | None = None

    def start(self) -> str:
        return "https://www.dropbox.com/oauth2/authorize?code_challenge=x"

    def finish(self, code: str):
        self.finished_with = code
        return SimpleNamespace(refresh_token=self.refresh_token, access_token="sl.short")


def _install(monkeypatch, *, flow=None, identity="Ada <ada@acme.com>", captured=None):
    flow = flow or _FakeFlow()

    def _build_flow(**kwargs):
        if captured is not None:
            captured.update(kwargs)
        return flow

    monkeypatch.setattr(dropbox_auth, "build_flow", _build_flow)
    monkeypatch.setattr(dropbox_auth, "verify_credentials", lambda **_kw: identity)
    monkeypatch.setattr("builtins.input", lambda _prompt="": "auth-code")
    return flow


def test_dropbox_auth_prints_pasteable_oauth_credentials(monkeypatch, capsys):
    _install(monkeypatch)

    assert dropbox_auth.run_dropbox_auth_command(_args()) == 0

    output = capsys.readouterr().out
    credentials = json.loads(output[output.index("{") : output.rindex("}") + 1])
    assert credentials == {
        "required": {"auth_method": "oauth", "app_key": "app-key"},
        "masked": {"app_secret": "app-secret", "refresh_token": "refresh-token"},
    }


def test_dropbox_auth_pkce_omits_the_app_secret(monkeypatch, capsys):
    captured: dict = {}
    _install(monkeypatch, captured=captured)

    assert dropbox_auth.run_dropbox_auth_command(_args(app_secret=None, pkce=True)) == 0

    assert captured["use_pkce"] is True
    assert captured["app_secret"] is None
    output = capsys.readouterr().out
    credentials = json.loads(output[output.index("{") : output.rindex("}") + 1])
    assert credentials == {
        "required": {"auth_method": "oauth_pkce", "app_key": "app-key"},
        "masked": {"refresh_token": "refresh-token"},
    }


def test_dropbox_auth_requires_a_secret_without_pkce(capsys):
    assert dropbox_auth.run_dropbox_auth_command(_args(app_secret=None)) == 1
    assert "--pkce" in capsys.readouterr().out


def test_dropbox_auth_requires_an_app_key(capsys):
    assert dropbox_auth.run_dropbox_auth_command(_args(app_key="")) == 1
    assert "--app-key is required" in capsys.readouterr().out


def test_dropbox_auth_requests_team_scopes(monkeypatch):
    captured: dict = {}
    _install(monkeypatch, captured=captured)

    assert dropbox_auth.run_dropbox_auth_command(_args(team=True)) == 0

    assert set(captured["scopes"]) >= {
        "team_info.read",
        "members.read",
        "team_data.member",
        "team_data.team_space",
    }


def test_dropbox_auth_scope_override_replaces_defaults(monkeypatch):
    captured: dict = {}
    _install(monkeypatch, captured=captured)

    assert dropbox_auth.run_dropbox_auth_command(_args(scope=["files.metadata.read"])) == 0

    assert captured["scopes"] == ["files.metadata.read"]


def test_dropbox_auth_fails_when_no_refresh_token_is_returned(monkeypatch, capsys):
    _install(monkeypatch, flow=_FakeFlow(refresh_token=None))

    assert dropbox_auth.run_dropbox_auth_command(_args()) == 1
    assert "token_access_type=offline" in capsys.readouterr().out


def test_dropbox_auth_reports_a_failed_verification(monkeypatch, capsys):
    _install(monkeypatch)

    def _boom(**_kwargs):
        raise RuntimeError("missing_scope")

    monkeypatch.setattr(dropbox_auth, "verify_credentials", _boom)

    assert dropbox_auth.run_dropbox_auth_command(_args(team=True)) == 1
    output = capsys.readouterr().out
    assert "verification call failed" in output
    assert "Team member file access" in output


@pytest.mark.parametrize("team", [False, True])
def test_dropbox_auth_default_scopes_cover_content_and_metadata(team: bool):
    scopes = dropbox_auth.default_scopes(team=team)

    assert "files.metadata.read" in scopes
    assert "files.content.read" in scopes


def test_dropbox_auth_always_requests_offline_access(monkeypatch):
    """Without offline access Dropbox returns only a four-hour access token."""
    captured: dict = {}

    class _FakeOAuthModule:
        @staticmethod
        def DropboxOAuth2FlowNoRedirect(app_key, **kwargs):  # noqa: N802 - SDK name
            captured["app_key"] = app_key
            captured.update(kwargs)
            return _FakeFlow()

    monkeypatch.setattr(dropbox_auth, "require_module", lambda **_kw: _FakeOAuthModule)

    dropbox_auth.build_flow(
        app_key="app-key",
        app_secret="app-secret",
        scopes=["files.metadata.read"],
        use_pkce=False,
    )

    assert captured["token_access_type"] == "offline"
    assert captured["consumer_secret"] == "app-secret"
    assert captured["use_pkce"] is False
