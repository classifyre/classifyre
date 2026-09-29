<div align="center">
<img src="https://www.classifyre.com/clasifyre_icon.png" alt="Classifyre" width="96" />

# Classifyre Web

**Frontend of the open-source Classifyre investigation platform — work findings, inquiries, duplicates and cases in the browser.**

</div>

Classifyre turns the data scattered across the systems you already run — file shares, Confluence, Jira, SharePoint, S3, Git repositories, databases — into **investigations you can act on**. This `classifyre/web` image is the investigator-facing Next.js UI: browse findings, manage standing inquiries, review duplicate clusters, build cases and hypotheses, configure sources, detectors and AI providers. The bundled documentation is served alongside the app.

It is one of three service images — with [`classifyre/api`](https://hub.docker.com/r/classifyre/api) (backend) and [`classifyre/cli`](https://hub.docker.com/r/classifyre/cli) (scan jobs) — composed into the [`classifyre/all-in-one`](https://hub.docker.com/r/classifyre/all-in-one) image and deployed separately by the [`classifyre/classifyre-core`](https://hub.docker.com/r/classifyre/classifyre-core) Helm chart.

You normally don't run this image by hand: use the [all-in-one image](https://hub.docker.com/r/classifyre/all-in-one) for local use or the [Helm chart](https://github.com/classifyre/classifyre/tree/develop/helm) for Kubernetes.

📚 Full documentation: **https://docs.classifyre.com**

---

## Quickstart (standalone)

The UI needs a running API:

```bash
docker run -d --name classifyre-web \
  -p 3100:3100 \
  -e NEXT_PUBLIC_API_URL="http://localhost:8000" \
  -e NEXT_PUBLIC_WS_URL="ws://localhost:8000" \
  classifyre/web:latest
```

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3100` | Port the web server listens on. |
| `NEXT_PUBLIC_API_URL` | *(required standalone)* | Public URL of the API (REST). Note: `NEXT_PUBLIC_*` values are baked in at build time — use the tag built for your deployment or set the API URL before building. |
| `NEXT_PUBLIC_WS_URL` | same host as API | WebSocket URL for live scan updates. |
| `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` / `NEXT_PUBLIC_POSTHOG_HOST` / `NEXT_PUBLIC_POSTHOG_UI_HOST` | unset | Product analytics (self-hosted PostHog). Leave unset for no tracking. |

## Tags

- `latest` tracks the newest stable release; pin a version (e.g. `classifyre/web:0.6.3`) in production. API, web and CLI tags with the same version are built from the same commit — keep them in sync.

---

*Classifyre is open source: https://github.com/classifyre/classifyre · Docs: https://docs.classifyre.com*
