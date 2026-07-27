"""One-off Dropbox authorization helper.

Dropbox only hands out long-lived credentials through an interactive OAuth
authorization. A scan runner has no browser and no logged-in user, so the
exchange has to happen once, up front, on a machine where a human is present.

``DropboxOAuth2FlowNoRedirect`` is built exactly for that: it needs no redirect
URI and no callback server. It prints a URL, the operator opens it in their own
browser, Dropbox shows them a short authorization code, and the code is pasted
back here and exchanged for a refresh token. Only that refresh token — which
does not expire — is ever stored on a source.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any

from ..dependencies import require_module

# Scopes each mode needs. Dropbox binds scopes to the refresh token at
# authorization time, so anything missing here means a `missing_scope` error at
# scan time and a fresh authorization to fix it.
INDIVIDUAL_SCOPES = [
    "account_info.read",
    "files.metadata.read",
    "files.content.read",
    "sharing.read",
]

TEAM_SCOPES = [
    *INDIVIDUAL_SCOPES,
    "team_info.read",
    "members.read",
    "team_data.member",
    "team_data.team_space",
]


def default_scopes(*, team: bool) -> list[str]:
    return list(TEAM_SCOPES if team else INDIVIDUAL_SCOPES)


def build_flow(
    *,
    app_key: str,
    app_secret: str | None,
    scopes: list[str],
    use_pkce: bool,
) -> Any:
    """Create the no-redirect authorization flow.

    ``token_access_type="offline"`` is what makes Dropbox return a refresh
    token; without it the exchange yields only a four-hour access token.
    """
    oauth = require_module(
        module_name="dropbox.oauth",
        source_name="Dropbox",
        uv_groups=["dropbox"],
        detail="Dropbox authorization requires the official Dropbox SDK.",
    )
    return oauth.DropboxOAuth2FlowNoRedirect(
        app_key,
        consumer_secret=None if use_pkce else app_secret,
        token_access_type="offline",
        scope=scopes,
        use_pkce=use_pkce,
    )


def verify_credentials(
    *,
    app_key: str,
    app_secret: str | None,
    refresh_token: str,
    team: bool,
) -> str:
    """Prove the refresh token works before printing it as a recipe."""
    dropbox_module = require_module(
        module_name="dropbox",
        source_name="Dropbox",
        uv_groups=["dropbox"],
        detail="Dropbox authorization requires the official Dropbox SDK.",
    )
    kwargs: dict[str, Any] = {
        "oauth2_refresh_token": refresh_token,
        "app_key": app_key,
        "user_agent": "classifyre",
    }
    if app_secret:
        kwargs["app_secret"] = app_secret

    if team:
        client = dropbox_module.DropboxTeam(**kwargs)
        info = client.team_get_info()
        return (
            f"team '{getattr(info, 'name', '')}' ({getattr(info, 'num_licensed_users', '?')} seats)"
        )

    client = dropbox_module.Dropbox(**kwargs)
    account = client.users_get_current_account()
    display_name = getattr(getattr(account, "name", None), "display_name", "") or ""
    return f"{display_name} <{getattr(account, 'email', '')}>"


def build_recipe_credentials(
    *,
    app_key: str,
    app_secret: str | None,
    refresh_token: str,
    use_pkce: bool,
) -> dict[str, Any]:
    """The `required`/`masked` blocks to paste into a DROPBOX source."""
    if use_pkce:
        return {
            "required": {"auth_method": "oauth_pkce", "app_key": app_key},
            "masked": {"refresh_token": refresh_token},
        }
    return {
        "required": {"auth_method": "oauth", "app_key": app_key},
        "masked": {"app_secret": app_secret or "", "refresh_token": refresh_token},
    }


def run_dropbox_auth_command(args: argparse.Namespace) -> int:
    app_key = str(getattr(args, "app_key", "") or "").strip()
    app_secret = str(getattr(args, "app_secret", "") or "").strip() or None
    use_pkce = bool(getattr(args, "pkce", False))
    team = bool(getattr(args, "team", False))

    if not app_key:
        print("--app-key is required (Dropbox App Console → Settings → App key)")
        return 1
    if not use_pkce and not app_secret:
        print(
            "--app-secret is required unless --pkce is used.\n"
            "Use --pkce for an app that cannot hold a secret; it refreshes with the app key alone."
        )
        return 1

    scopes = list(getattr(args, "scope", None) or []) or default_scopes(team=team)

    try:
        flow = build_flow(
            app_key=app_key,
            app_secret=app_secret,
            scopes=scopes,
            use_pkce=use_pkce,
        )
        authorize_url = flow.start()
    except Exception as exc:
        print(f"Failed to start the Dropbox authorization flow: {exc}")
        return 1

    print()
    print("Dropbox authorization — this runs once; the runner never needs a browser.")
    print(f"  Mode:   {'PKCE (no app secret)' if use_pkce else 'app key + secret'}")
    print(f"  Target: {'Dropbox Business team' if team else 'individual account'}")
    print(f"  Scopes: {' '.join(scopes)}")
    print()
    print("1. Open this URL in your browser:")
    print(f"   {authorize_url}")
    print('2. Sign in if needed, then click "Allow".')
    print("3. Copy the authorization code Dropbox shows you.")
    print()

    try:
        auth_code = input("Authorization code: ").strip()
    except (EOFError, KeyboardInterrupt):
        print("\nAborted.")
        return 1

    if not auth_code:
        print("No authorization code entered.")
        return 1

    try:
        result = flow.finish(auth_code)
    except Exception as exc:
        print(f"Failed to exchange the authorization code: {exc}")
        return 1

    refresh_token = getattr(result, "refresh_token", None)
    if not refresh_token:
        print(
            "Dropbox returned no refresh token. The app must be authorized with "
            "token_access_type=offline; re-run this command."
        )
        return 1

    try:
        identity = verify_credentials(
            app_key=app_key,
            app_secret=app_secret,
            refresh_token=refresh_token,
            team=team,
        )
    except Exception as exc:
        print(f"Refresh token issued, but the verification call failed: {exc}")
        if team:
            print(
                "For a team scan the Dropbox app must use a team access type "
                "('Team member file access')."
            )
        return 1

    credentials = build_recipe_credentials(
        app_key=app_key,
        app_secret=app_secret,
        refresh_token=refresh_token,
        use_pkce=use_pkce,
    )

    print()
    print(f"Authorized as {identity}.")
    print("Paste these into the Dropbox source configuration:")
    print()
    print(json.dumps(credentials, indent=2))
    print()
    print("The refresh token does not expire. Treat it as a secret.")
    return 0


def add_dropbox_auth_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--app-key", default=None, help="Dropbox app key (dropbox-auth only)")
    parser.add_argument(
        "--app-secret",
        default=None,
        help="Dropbox app secret; omit when using --pkce (dropbox-auth only)",
    )
    parser.add_argument(
        "--pkce",
        action="store_true",
        help="Authorize with PKCE so no app secret is needed (dropbox-auth only)",
    )
    parser.add_argument(
        "--team",
        action="store_true",
        help="Authorize a Dropbox Business team app and request team scopes (dropbox-auth only)",
    )
    parser.add_argument(
        "--scope",
        action="append",
        default=None,
        help="Override a requested OAuth scope; repeatable (dropbox-auth only)",
    )


def main() -> None:  # pragma: no cover - thin argparse wrapper
    parser = argparse.ArgumentParser(description="Authorize Classifyre against Dropbox")
    add_dropbox_auth_arguments(parser)
    sys.exit(run_dropbox_auth_command(parser.parse_args()))
