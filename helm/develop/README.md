# Classifyre environment profiles

Internal deployment overlays for the chart in `../classifyre/`. These are the
maintainers' own environments — **not** part of the published chart. External
deployments should start from `../classifyre/values-production.example.yaml`
instead (see the chart [README](../classifyre/README.md)).

| File | Target | Notes |
| --- | --- | --- |
| `values-dev.yaml` | local k3d (`classifyre-dev` ns) | Source mounts, Bun containers, embedded Postgres. Used by `skaffold.yaml` (`dev` profile) and `scripts/dev/start.sh`. |
| `values-dev-vps-db.yaml` | local k3d against the VPS database | Layered **on top of** `values-dev.yaml`. Used by `scripts/dev/start-vps-db.sh` only; not usable alone. |
| `values-vps.yaml` | single-node VPS demo (`classifyre` ns, NodePort 30100) | Public read-only instance. Deployed by CI (`Deploy Image` → `classifyre`) and `scripts/demo-deployment.sh`. The node budget is documented inside the file. |
| `values-vps-develop.yaml` | single-node VPS staging (`classifyre-develop` ns, NodePort 30101) | Shares the node with prod on reduced requests; api/web parked at 0 between test runs. Deployed by CI (`Deploy Image` → `classifyre-develop`) and `scripts/deploy-develop.sh`. |

All four are passed with `-f` against the chart, e.g.:

```bash
helm upgrade --install classifyre-develop ./helm/classifyre \
  -n classifyre-develop \
  -f ./helm/develop/values-vps-develop.yaml
```
