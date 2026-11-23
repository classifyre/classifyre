# Marketing site and blog

`apps/blog` is the public marketing site (`classifyre.com`) and publication in English and German.

## Positioning & voice

Classifyre is positioned as an **end-to-end open-source data governance platform** (Apache-2.0) — a transparent, self-hosted alternative to closed-source enterprise governance suites:

1. **Integrates with existing tools**: does not replace ETL pipelines, IAM (Entra ID, Active Directory, Okta, OIDC/SAML), databases, lakehouses (Iceberg, Delta, Parquet), or BI tools.
2. **Connect & detect**: 40+ known sources or custom connectors; built-in PII & secrets plus business-specific custom detectors from regex and Python checks to local CPU AI extraction models and private LLMs.
3. **Group-based governance**: permissions follow directory groups, with owners, stewards, expiring grants, and row-level filters.
4. **Multi-level masking**: column masking (redacted, last-four, hashed pseudonymisation, empty, hidden) and row filtering across source tables and shared datasets, tailored per group.
5. **Governed SQL, Power BI, Excel & ODBC**: personal, expiring TLS connections over PostgreSQL wire protocol, plus AI agents over MCP.
6. **Dataset requests & Delta data products**: business users request combined datasets in plain language; owners review and publish governed live or Delta shared datasets that inherit source masks as a floor.
7. **100% open source + maintenance & tailored projects (no SaaS)**: no enterprise tier or feature walls; organisations can self-host freely, subscribe to annual maintenance, security patches, and optional dedicated single-tenant hosting (never multi-tenant SaaS), or commission scoped projects (IAM/org mapping, custom sources, billable EDI requests, Delta data products, bespoke detectors).
8. **Built in Austria, deployed worldwide**: engineered in Austria to European privacy and security standards, serving Europe, North America, and global teams.

## Blog authoring

The publication has two sections under `app/(en)/blog` and `app/(de)/de/blog`:

- `articles/` contains business and architecture writing on data governance, lakehouses, lineage, and detector design.
- `cases/` contains evidence-led case files and field write-ups.

## Development

```bash
bun --filter @classifyre/blog dev
bun --filter @classifyre/blog check-types
bun --filter @classifyre/blog lint
bun --filter @classifyre/blog build
```
