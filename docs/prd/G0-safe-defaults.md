# PRD G0 · Safe defaults for self-hosted instances

| | |
|---|---|
| **Status** | Proposed |
| **Size** | XS–S (mostly docs, one optional image feature) |
| **Milestone** | M0 · Safety and seams ([integration](00-integration-architecture.md#4-build-order-and-milestones)) |
| **Depends on** | nothing |
| **Used by** | every later PRD: new features must not widen what an open instance exposes |
| **Not in scope** | users, roles, SSO, audit. Those are the enterprise edition ([S1](S1-enterprise-extension-seams.md)) |

## 1. Summary

Make it hard to run Classifyre by accident where anyone can reach it, without adding a user model. This means three things:
- Document how to put an instance behind an authenticating proxy.
- Give the all-in-one Docker image an optional built-in password gate.
- Tell operators plainly, in the UI and the docs, when their instance has no login.

## 2. Why

The open-source core has no sign-in by design: identity belongs to the enterprise edition. That is a sound product split, but an unauthenticated Classifyre instance is unusually dangerous to leave open:

- **It is a map of secrets.** Findings carry the matched content of every secret, credential and identifier the scan found (`findings.matched_content`).
- **It runs code.** CUSTOM sources and augmentation execute arbitrary Python in the scan job. The notebook contract says so itself: "This is not a sandbox" (`apps/cli/src/notebook/contract.py`). Anyone who can reach an open instance can create a source and run code on your infrastructure.
- **REST is open while MCP is not.** MCP requires a bearer token (`McpTokenService.authorizeBearerToken`), but the REST API behind the web UI has no authentication. The Helm chart says so in the `internalApiKey` comment of `helm/classifyre/values.yaml`.
- **The quick start publishes the port on all interfaces.** The Docker guide (`apps/docs/app/deployment/docker/page.mdx`) runs `-p 3000:3000`, which Docker publishes on every host interface. Nothing on the page says the instance has no login.

For an open-source project whose goal is traction, the first exposed instance on the internet would be the worst possible headline. It would also block every European enterprise evaluation, because security teams check this first.

## 3. Goals

- An operator following the docs ends up with an instance that is either reachable only locally, or behind a login.
- The all-in-one image can be protected with one environment variable pair, without extra infrastructure.
- An operator running without protection sees a clear, dismissible warning that names the risk.
- None of this interferes with MCP clients, CLI callbacks, health checks or WebSockets.

## 4. Non-goals

- User accounts, roles, per-user audit, SSO. That is the enterprise edition.
- Protecting the public demo. Demo mode (`DEMO_MODE`, `apps/api/src/demo-mode.guard.ts`) stays as it is.
- TLS termination. That is documented, not built.

## 5. Requirements

| # | Requirement | Priority |
|---|---|---|
| R1 | A docs page **"Securing your instance"** explains the threat model: findings content, code execution through notebooks, open REST versus token-protected MCP. It gives one recipe per deployment path (R2–R5) | MUST |
| R2 | The Docker quick start and every `docker run` example bind to loopback by default (`-p 127.0.0.1:3000:3000`), with a short note on reaching the instance remotely: SSH tunnel, a VPN such as Tailscale, or R3 | MUST |
| R3 | The all-in-one image supports an **optional password gate** in Caddy, enabled only when `CLASSIFYRE_BASIC_AUTH_USER` and `CLASSIFYRE_BASIC_AUTH_HASH` (bcrypt, from `caddy hash-password`) are set | MUST |
| R4 | The R3 gate exempts: `/api/ping` (container health check), the MCP route (`@mcp`, which uses bearer tokens), and nothing else. Socket.IO and the UI stay behind the gate; browsers resend basic-auth credentials to the same origin | MUST |
| R5 | Helm docs show tested ingress examples for ingress-nginx basic auth, oauth2-proxy (`auth-url`/`auth-signin`) and a Traefik `forwardAuth` middleware, applied to the web, API and socket ingresses, but not to the MCP ingress | MUST |
| R6 | A new setting, env `CLASSIFYRE_ACCESS_MODE` = `open` (default) \| `proxy` \| `basic`, tells the product how it is protected. The image sets `basic` automatically when R3 is configured | MUST |
| R7 | When the access mode is `open`, the web shell shows a dismissible banner: "This instance has no login. Anyone who can reach it can read findings and run notebook code. Secure it →", linking to R1. Dismissal is per browser (localStorage), and the banner returns after 30 days | MUST |
| R8 | The API logs one warning line at boot when the access mode is `open`, naming the risk and the docs URL | SHOULD |
| R9 | `GET /instance-settings` returns `accessMode` so the web, the MCP overview and the assistant can describe the posture correctly | SHOULD |
| R10 | The README's quick start gets the same loopback default and a one-line pointer to R1 | MUST |

## 6. Design

### 6.1 Caddy password gate (R3, R4)

`docker/rootfs/etc/caddy/Caddyfile` already routes `@socketio`, `@mcp`, `@api` and the UI. Add a conditional snippet, rendered by `docker/entrypoint.sh` only when both variables are set. This keeps the gate provably inert otherwise.

```caddy
# rendered into /etc/caddy/auth.caddy by entrypoint.sh when both env vars are set
@gated not path /api/ping
@gated not path_regexp mcp ^/[^/]+/mcp(/.*)?$
basic_auth @gated {
	{$CLASSIFYRE_BASIC_AUTH_USER} {$CLASSIFYRE_BASIC_AUTH_HASH}
}
```

Import it inside the site block with `import /etc/caddy/auth*.caddy`. The glob matches nothing when the file is absent. The entrypoint also exports `CLASSIFYRE_ACCESS_MODE=basic` to the API and web processes.

Internal traffic is unaffected: the CLI scan processes call the API on `127.0.0.1:{API_PORT}` directly, not through Caddy.

### 6.2 Access mode (R6–R9)

- API: read `CLASSIFYRE_ACCESS_MODE` once at boot and expose it on the instance-settings response DTO (`dto/instance-settings-response.dto.ts`). Regenerate OpenAPI and the api-client, and add the new field's DTO to the `export type {…}` block in `packages/api-client/src/client.ts`.
- Web: a `SecurityPostureBanner` in the dashboard layout (`app/[locale]/[namespaceSlug]/(dashboard)/layout.tsx`), with i18n keys in `apps/web/i18n/en.json` and `de.json`. Don't show it on the demo showcase (demo mode already implies a known posture).
- Helm: `values.yaml` gets `accessMode: open` under the API and web env blocks. Operators set `proxy` once they have added R5 annotations.

### 6.3 Docs (R1, R2, R5, R10)

- New page: `apps/docs/app/deployment/security/page.mdx`, added to `_meta.js` next to docker and kubernetes.
- Update: `deployment/docker/page.mdx` (all four `docker run` examples) and the root `README.md`.
- Each Helm example is tested once on the k3d dev cluster and pasted verbatim.

## 7. How it connects

- [S1](S1-enterprise-extension-seams.md) introduces the actor resolver. With `accessMode=proxy`, the default resolver may read a proxy-supplied user header such as `X-Forwarded-User` or `X-Auth-Request-User` as the display name. That makes attribution better behind oauth2-proxy without a user model. This is a SHOULD in S1, not here.
- Every later PRD that adds an outbound channel ([G3](G3-outbound-webhooks-notifications-export.md)) or code execution ([G1](G1-python-detector.md)) links to the R1 page in its own docs.

## 8. Testing and acceptance

- **Image test, gate on:** `docker run` with both variables set.
  - `curl /` returns 401.
  - `curl -u user:pw /` returns 200.
  - `curl /api/ping` returns 200 without credentials.
  - `POST /<ws>/mcp` with a bearer token and no basic auth reaches the API: 401 from the MCP token check, not from Caddy.
- **Image test, gate off:** with neither variable set, the gate file is absent and behaviour is unchanged.
- **Web:** the banner shows for `open`, is hidden for `proxy`, `basic` and demo mode, and dismissal persists.
- **Docs:** the docs build passes. Every `docker run` in the docs binds to `127.0.0.1` (a grep check in CI).

## 9. Success measures

- Zero `docker run -p 3000:3000` examples left in docs or README.
- Share of telemetry-reporting instances (where telemetry is enabled) with `accessMode != open` tracked over time. Report only the mode, never the host.

## 10. Open questions

- Should `open` mode refuse to start CUSTOM notebook execution until the banner is acknowledged once? This is safer, but adds friction to the first-run experience. The recommendation is not to gate it, and to rely on the banner.
