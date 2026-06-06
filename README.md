<div align="center">
  <img src=".github/assets/classifyre_icon.png" alt="Classifyre" width="96" />

  # Classifyre, Detection Platform

  **Detect. Classify. Label.**

  Classifyre turns messy, distributed source data into governed signals. Connect the systems you already run, detect what matters, classify content and findings, and label data for security, privacy, moderation, and operational workflows.

  [Documentation](https://docs.classifyre.com/) · [Live Demo](https://demo.classifyre.com/)

</div>

---

## Try it locally

Bring up the full product locally in one Docker command. Use it for testing, demos, and first-touch evaluation. Not the production topology, fastest way to explore everything Classifyre can do.

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

## Contributing

1. Fork and create a feature branch from `develop`
2. Follow the code style: `bun lint` must pass, TypeScript strict mode, Python mypy strict
3. Add tests alongside implementation (`.spec.ts` for API, pytest for CLI)
4. Run `bun build` from root to verify all apps compile before opening a PR
5. Target `develop`; `main` is the release branch

For larger changes, open an issue first to align on approach. Plugin architecture guidance is in `docs/architecture/PLUGIN_SYSTEM.md`.
