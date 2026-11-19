<div align="center">
  <img src=".github/assets/classifyre_icon.png" alt="Classifyre" width="96" />

# Classifyre

## Open-Source Data Governance

**Find it. Protect it. Use it.**

[![CI](https://img.shields.io/github/actions/workflow/status/classifyre/classifyre/ci.yml?branch=develop&style=flat-square&label=CI&logo=github)](https://github.com/classifyre/classifyre/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/classifyre/classifyre?sort=semver&style=flat-square&label=release)](https://github.com/classifyre/classifyre/releases/latest)
[![License](https://img.shields.io/github/license/classifyre/classifyre?style=flat-square)](LICENSE)
[![Docs](https://img.shields.io/badge/docs-classifyre.com-1f6feb?style=flat-square)](https://docs.classifyre.com/)

Classifyre finds personal data and secrets across the systems you already run, **masks them automatically**, and lets your team query everything with SQL, Excel and Power BI. Every read is logged. Nothing leaves your servers. All of it is Apache-2.0, including SSO, roles and masking; when something leaks, cases and an AI autopilot help you investigate it.

[Documentation](https://docs.classifyre.com/) · [Live Showcase](https://showcase.classifyre.com/)

</div>

---

## What Classifyre does

Detection is the first step. The value is in what happens next: classified data is masked by default, people get governed access through the tools they already use, and every read is on record.

| Capability                | What it means                                                                                                                                                                                                                      | Docs                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **Sources**               | Connect databases, lakehouses, storage, collaboration tools, and content platforms — no data migration. Choose sampling while image OCR and audio/video transcription run automatically.                                           | [Sources](https://docs.classifyre.com/sources/)                            |
| **Detectors**             | Ready-made packs (secrets, PII, security) plus custom detectors you build — from a regex to an LLM, across text and images.                                                                                                        | [Detectors](https://docs.classifyre.com/detectors/)                        |
| **Findings**              | Every signal a detector raises, with severity, confidence, and a lifecycle tracked across scans.                                                                                                                                   | [Findings](https://docs.classifyre.com/detectors/findings/)                |
| **Masking & access**      | Classified columns are masked by default (redacted, last four, hashed, empty, or hidden). Masks apply inside the query, so `WHERE`, `JOIN` and `GROUP BY` cannot see past them. Grants, row filters and access requests per group. | [Query data & masking](https://docs.classifyre.com/data-query/)            |
| **SQL, Excel & Power BI** | A SQL page, exports, and a PostgreSQL-protocol endpoint for Power BI, Excel, Tableau and DBeaver, plus AI agents over MCP — all through the same masks.                                                                            | [SQL connections](https://docs.classifyre.com/sql-connections/)            |
| **Shared datasets**       | Governed saved queries shared with groups, so a team works from one reviewed dataset across sources.                                                                                                                               | [Shared datasets](https://docs.classifyre.com/data-query/#shared-datasets) |
| **Roles & SSO**           | Single sign-on, roles, groups and workspaces. All open source, none of it behind a paid tier.                                                                                                                                      | [Roles](https://docs.classifyre.com/access/roles/)                         |
| **Activity log**          | Every read, per table and person, with the channel used.                                                                                                                                                                           | [Access](https://docs.classifyre.com/access/)                              |

### When something leaks

Findings also feed an investigation layer for the cases that need a human to dig in:

| Capability             | What it means                                                                                                                     | Docs                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Inquiries**          | Saved questions that keep surfacing matching findings, scan after scan.                                                           | [Inquiries](https://docs.classifyre.com/flow/investigations/inquiry/)         |
| **Fingerprints**       | Deterministic duplicate and similarity detection that links the same entity across systems into clusters.                         | [Fingerprints](https://docs.classifyre.com/flow/investigations/fingerprints/) |
| **Cases & hypotheses** | Workspaces that collect evidence, weigh competing explanations, and reach a conclusion.                                           | [Cases](https://docs.classifyre.com/flow/investigations/cases/)               |
| **Autopilot**          | AI agents that open inquiries, maintain fingerprints, build cases, and draft hypotheses after every scan — explaining every move. | [Autopilot](https://docs.classifyre.com/flow/investigations/autopilot/)       |

## How it all connects

```mermaid
flowchart LR
    A[Sources] --> B[Assets]
    B --> C[Detectors]
    C --> D[Findings]

    D --> E[Masks and grants]
    E --> F["SQL · Excel · Power BI · MCP"]
    F --> G[Activity log]

    D -.->|when something leaks| H["Inquiries · Fingerprints · Cases"]
    I[Autopilot] -.-> H
```

1. **Scan.** A scan ingests each source into **assets**, and **detectors** raise **findings** on them.
2. **Protect.** Findings decide which columns are **masked**. Access is granted per group.
3. **Use.** People read the data through the SQL page, exports, a PostgreSQL endpoint or MCP, always through the masks.
4. **Audit.** **Every read is logged**, per table and person.
5. **Investigate (optional).** When something does leak, **inquiries**, **fingerprints** and **cases** turn findings into an investigation, with **Autopilot** doing the legwork.

The end-to-end journey is documented in [Flow](https://docs.classifyre.com/flow/).

---

## Try it locally

Run the production Helm chart locally on k3d with Skaffold:

```bash
./scripts/dev/create-cluster.sh
./scripts/dev/start.sh
```

The first start takes several minutes (image pulls, dependency install, and the
identity server's one-time setup). The web app is not deployed in the cluster;
in a second terminal run it on your machine against the stack:

```bash
./scripts/dev/web-iam.sh
```

Then open [http://localhost:3000](http://localhost:3000). The API is on
<http://localhost:8811>. To open the app from another device on the same wifi,
run `bun run web-iam:dev:lan` instead. Details:
[`scripts/dev/README.md`](scripts/dev/README.md).

### Or just run the image

To try Classifyre without a cluster, the all-in-one image carries the whole
stack — API, web UI, scan workers and PostgreSQL — in one container:

```bash
docker run -d --name classifyre \
  -p 3000:3000 --shm-size=1g \
  -v classifyre-pgdata:/var/lib/postgresql/data \
  -v classifyre-data:/var/lib/classifyre \
  -v classifyre-uv-cache:/cache/uv \
  classifyre/all-in-one:latest
```

See [`docker/README.md`](docker/README.md) for configuration, external
databases, object storage and resource tuning.

## Production deployment

Deploy to Kubernetes with the official Helm chart. See the production deployment guide for values, secrets management, external PostgreSQL, RBAC, HPA, and PDB configuration.

```bash
helm install classifyre \
  oci://registry-1.docker.io/classifyre/classifyre-core
```

> Full guide: [docs.classifyre.com/deployment/kubernetes](https://docs.classifyre.com/deployment/kubernetes/)
>
> Chart README — every value, the sizing rules, and the production checklist: [helm/classifyre/README.md](https://github.com/classifyre/classifyre/blob/main/helm/classifyre/README.md)

---

## Architecture

Classifyre is a distributed, decoupled platform: a **Web UI** and **API/Orchestrator** form the core stack, while an ephemeral **CLI Runner** does the extraction and detection. It relies on standard external infrastructure (PostgreSQL, optional S3) you can bring your own instances of. See the [platform components](https://docs.classifyre.com/deployment/) overview.

### Repository layout

This is a [Turborepo](https://turbo.build/) monorepo managed with [bun](https://bun.sh/).

| Path               | Stack                 | Purpose                                                                      |
| ------------------ | --------------------- | ---------------------------------------------------------------------------- |
| `apps/web`         | Next.js 16 · React 19 | The product Web UI                                                           |
| `apps/api`         | NestJS · Fastify      | API, orchestrator, and the Autopilot harness                                 |
| `apps/cli`         | Python · `uv`         | The scan runner (extraction + detection)                                     |
| `apps/docs`        | Nextra                | The documentation site ([docs.classifyre.com](https://docs.classifyre.com/)) |
| `apps/blog`        | Next.js               | The marketing site                                                           |
| `packages/schemas` | JSON Schema           | Shared source/detector schemas (cross-language)                              |
| `packages/ui`      | shadcn/ui             | Shared UI components                                                         |

### Development

```bash
bun install      # install workspace dependencies
bun dev          # run all apps in dev mode
bun build        # build all apps and packages
bun lint         # lint every workspace
```

Target a single app with a Turborepo filter, e.g. `bun --filter web dev` or `bun --filter api test`.

For a production-like Kubernetes development loop with k3d, Skaffold, Helm,
source mounts, and container-native hot reload, see
[`docs/development/skaffold.md`](docs/development/skaffold.md).

---

## Contributing

1. Fork and create a feature branch from `develop`
2. Follow the code style: `bun lint` must pass, TypeScript strict mode, Python mypy strict
3. Add tests alongside implementation (`.spec.ts` for API, pytest for CLI)
4. Run `bun build` from root to verify all apps compile before opening a PR
5. Target `develop`; `main` is the release branch

For larger changes, open an issue first to align on approach. Plugin architecture guidance is in `docs/architecture/PLUGIN_SYSTEM.md`.
