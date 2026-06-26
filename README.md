<div align="center">
  <img src=".github/assets/classifyre_icon.png" alt="Classifyre" width="96" />

  # Classifyre — Open-Source Investigation Platform

  **Detect. Investigate. Resolve.**

  Classifyre turns the data scattered across the systems you already run into **investigations you can act on**. Connect a source, let detectors surface the evidence, and work the results like an analyst — standing questions, duplicate detection, cases, and hypotheses — with an **AI autopilot** doing the legwork in between.

  [Documentation](https://docs.classifyre.com/) · [Live Demo](https://demo.classifyre.com/)

</div>

---

## What Classifyre does

It's more than a scanner. Detection is the first step; the value is in turning raw findings into resolved investigations.

| Capability | What it means | Docs |
|---|---|---|
| **Sources** | Connect databases, lakehouses, storage, collaboration tools, and content platforms — no data migration. Choose what to scan and how (sampling, OCR, transcription). | [Sources](https://docs.classifyre.com/sources/) |
| **Detectors** | Ready-made packs (secrets, PII, security) plus custom detectors you build — from a regex to an LLM, across text and images. | [Detectors](https://docs.classifyre.com/detectors/) |
| **Findings** | Every signal a detector raises, with severity, confidence, and a lifecycle tracked across scans. | [Findings](https://docs.classifyre.com/detectors/findings/) |
| **Inquiries** | Saved questions that keep surfacing matching findings, scan after scan. | [Inquiries](https://docs.classifyre.com/flow/investigations/inquiry/) |
| **Fingerprints** | Deterministic duplicate and similarity detection that links the same entity across systems into clusters. | [Fingerprints](https://docs.classifyre.com/flow/investigations/fingerprints/) |
| **Cases & hypotheses** | Workspaces that collect evidence, weigh competing explanations, and reach a conclusion. | [Cases](https://docs.classifyre.com/flow/investigations/cases/) |
| **Autopilot** | AI agents that open inquiries, maintain fingerprints, build cases, and draft hypotheses after every scan — explaining every move. | [Autopilot](https://docs.classifyre.com/flow/investigations/autopilot/) |

## How it all connects

```
Sources → Assets → Detectors → Findings ─┬─→ Inquiries ─────┐
                                          └─→ Fingerprints ──┴─→ Cases & Hypotheses
                                                  ▲                      ▲
                                                  └──── Autopilot (AI agents) ────┘
```

A scan ingests a source into **assets**, **detectors** raise **findings**,
**inquiries** and **fingerprints** organise those findings, and **cases** turn
them into investigations — with **Autopilot** running the whole right-hand side
for you. The end-to-end journey is documented in [Flow](https://docs.classifyre.com/flow/).

---

## Try it locally

Bring up the full product locally in one Docker command. Use it for testing, demos, and first-touch evaluation. Not the production topology — the fastest way to explore everything Classifyre can do.

```bash
docker pull classifyre/all-in-one:latest
docker run --rm -p 3000:3000 \
  classifyre/all-in-one:latest
```

Open [http://localhost:3000](http://localhost:3000). Full product, zero config.

> More options: [docs.classifyre.com/deployment/docker](https://docs.classifyre.com/deployment/docker/)

## Production deployment

Deploy to Kubernetes with the official Helm chart. See the production deployment guide for values, secrets management, external PostgreSQL, RBAC, HPA, and PDB configuration.

```bash
helm install classifyre \
  oci://registry-1.docker.io/classifyre/classifyre-core
```

> Full guide: [docs.classifyre.com/deployment/kubernetes](https://docs.classifyre.com/deployment/kubernetes/)

---

## Architecture

Classifyre is a distributed, decoupled platform: a **Web UI** and **API/Orchestrator** form the core stack, while an ephemeral **CLI Runner** does the extraction and detection. It relies on standard external infrastructure (PostgreSQL, optional S3) you can bring your own instances of. See the [platform components](https://docs.classifyre.com/deployment/) overview.

### Repository layout

This is a [Turborepo](https://turbo.build/) monorepo managed with [bun](https://bun.sh/).

| Path | Stack | Purpose |
|---|---|---|
| `apps/web` | Next.js 16 · React 19 | The product Web UI |
| `apps/api` | NestJS · Fastify | API, orchestrator, and the Autopilot harness |
| `apps/cli` | Python · `uv` | The scan runner (extraction + detection) |
| `apps/docs` | Nextra | The documentation site ([docs.classifyre.com](https://docs.classifyre.com/)) |
| `apps/blog` | Next.js | The marketing site |
| `packages/schemas` | JSON Schema | Shared source/detector schemas (cross-language) |
| `packages/ui` | shadcn/ui | Shared UI components |

### Development

```bash
bun install      # install workspace dependencies
bun dev          # run all apps in dev mode
bun build        # build all apps and packages
bun lint         # lint every workspace
```

Target a single app with a Turborepo filter, e.g. `bun --filter web dev` or `bun --filter api test`.

---

## Contributing

1. Fork and create a feature branch from `develop`
2. Follow the code style: `bun lint` must pass, TypeScript strict mode, Python mypy strict
3. Add tests alongside implementation (`.spec.ts` for API, pytest for CLI)
4. Run `bun build` from root to verify all apps compile before opening a PR
5. Target `develop`; `main` is the release branch

For larger changes, open an issue first to align on approach. Plugin architecture guidance is in `docs/architecture/PLUGIN_SYSTEM.md`.
