"""The environment a notebook is allowed to see.

This is the second of two layers. The API already refuses to hand a CUSTOM job
the secrets of the wider system, but the CLI process it launches legitimately
holds things a notebook must never reach -- above all
``CLASSIFYRE_INTERNAL_KEY``, which authenticates the callbacks that write scan
results, and ``DATABASE_URL``, which points at the tenant schema. Notebook code
runs in a child process built from this allowlist instead of inheriting them.

An allowlist, not a denylist: a denylist has to predict every credential anyone
will ever put in the environment, and gets it wrong the first time someone adds
a new integration.
"""

from __future__ import annotations

import os

#: Needed to start Python and reach the network at all.
ALLOWED_ENV_KEYS = frozenset(
    {
        "PATH",
        "HOME",
        "USER",
        "LOGNAME",
        "SHELL",
        "LANG",
        "LC_ALL",
        "LC_CTYPE",
        "TZ",
        "TMPDIR",
        "TEMP",
        "TMP",
        # Python itself
        "PYTHONPATH",
        "PYTHONHOME",
        "PYTHONIOENCODING",
        "PYTHONUNBUFFERED",
        "VIRTUAL_ENV",
        # TLS trust: without these a notebook cannot verify certificates behind
        # a corporate root CA, which looks like a connector bug rather than a
        # policy decision.
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
        "REQUESTS_CA_BUNDLE",
        "CURL_CA_BUNDLE",
        "NODE_EXTRA_CA_CERTS",
        # Egress proxies, for the same reason.
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "NO_PROXY",
        "http_proxy",
        "https_proxy",
        "no_proxy",
        # Windows needs these to spawn a process at all.
        "SYSTEMROOT",
        "COMSPEC",
        "PATHEXT",
        "APPDATA",
        "LOCALAPPDATA",
        "USERPROFILE",
        "NUMBER_OF_PROCESSORS",
    }
)


def scrubbed_environment(extra: dict[str, str] | None = None) -> dict[str, str]:
    """Build the child environment from the allowlist plus explicit additions."""
    env = {key: value for key, value in os.environ.items() if key in ALLOWED_ENV_KEYS}
    # Unbuffered so the parent sees each streamed asset as it is produced
    # rather than in 8 KB gulps.
    env["PYTHONUNBUFFERED"] = "1"
    if extra:
        env.update(extra)
    return env


def leaked_keys(env: dict[str, str]) -> list[str]:
    """Anything in ``env`` that is not on the allowlist. For tests and audits."""
    return sorted(key for key in env if key not in ALLOWED_ENV_KEYS)
