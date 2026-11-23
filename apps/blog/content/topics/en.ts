import { docs } from "@/lib/site";

import type { TopicChrome, TopicCopy, TopicId } from "./types";

export const enChrome: TopicChrome = {
  home: "Home",
  chip: "Open-Source Data Governance",
  marks: {
    points: "How it works",
    detail: "In practice",
    architecture: "Architecture comparison",
    scorecard: "Capability scorecard",
    tradeoffs: "Strengths & honest trade-offs",
    decision: "Decision guide",
    compare: "Detailed specification",
    notDo: "Scope & boundaries",
    run: "Deploy or collaborate",
    faq: "Common questions",
    related: "Explore further",
  },
  runTitle: "Deploy on your own infrastructure",
  runBody:
    "Evaluate locally with one Docker container or deploy to Kubernetes and OpenShift with Helm. 100% Apache-2.0 open source — your data stays inside your network.",
  runDocs: "Deployment guide",
  tailoringTitle: "Questions about your setup?",
  tailoringBody:
    "If you're evaluating Classifyre and your sources, identity provider or infrastructure don't quite match what the docs cover, write to us. We're happy to answer questions and to hear about setups we haven't seen yet.",
  tailoringCta: "Get in touch",
  relatedTitle: "Related comparisons & guides",
  faqTitle: "Common questions",
  sourcesLabel: "Sources",
};

const accessGovernance: TopicCopy = {
  id: "data-access-governance",
  name: "Data access governance",
  metaTitle: "Open-Source Data Access Governance, Self-Hosted",
  metaDescription:
    "Enforce who sees which tables, rows, and columns across 40+ systems: directory groups, multi-level masking, governed SQL/BI access, and verifiable audit logs under Apache-2.0.",
  keywords: [
    "data access governance",
    "governed data access",
    "open source data governance",
    "role-based access control for data",
    "row-level security across sources",
    "dynamic data masking open source",
    "self-hosted data governance",
  ],
  h1: "Data access governance: your rules enforced on every query",
  lede: "Data access governance determines who may access which data and enforces that decision wherever data is queried. Classifyre integrates with your existing databases, lakehouses, and directory to enforce group permissions, row filters, and column masking across SQL, Power BI, Excel, ODBC, and governed data products.",
  demo: "access",
  demoCaption: "Directory groups mapped to table grants: regional teams get filtered rows, finance receives time-limited clear access.",
  mascot: "looking-at-you",
  mascotAlt: "Classifyre data access governance overview",
  pointsTitle: "How Classifyre enforces data access",
  points: [
    {
      title: "Groups synced from your directory",
      body: "Connect Entra ID, Active Directory, Okta, or any OIDC/SAML provider. Permissions always target groups — never individual overrides — so department changes propagate at next sign-in.",
      href: docs.directory,
      linkLabel: "Connect a company directory",
    },
    {
      title: "Row-level security per group",
      body: "Row filters restrict each group to the exact slice of rows its rule selects (such as a region or subsidiary), failing closed when no rule matches.",
      href: docs.rowFilters,
      linkLabel: "Filtered rows",
    },
    {
      title: "Multi-level column masking",
      body: "Mask personal and sensitive columns as redacted, last-four, deterministic hashed pseudonymisation, empty, or hidden — enforced inside the query engine on source tables and shared datasets alike.",
      href: docs.masking,
      linkLabel: "Masked and hidden columns",
    },
    {
      title: "Complete audit trail across tools",
      body: "Every read records the signed-in person, table or shared dataset, timestamp, and channel: SQL workbench, export, Power BI, Excel, ODBC, or AI agent over MCP.",
      href: docs.whoMayQuery,
      linkLabel: "Who may query what",
    },
  ],
  detail: {
    title: "Closing the gap between policy documents and live queries",
    paragraphs: [
      "Most organisations already maintain a formal access concept defining which departments may read which datasets and for what purpose. In practice, data sits across dozens of relational databases, Iceberg and Delta lakehouses, and file shares — each with separate credentials — so access degrades into manual tickets, untracked CSV exports, and shared BI service accounts.",
      "Classifyre closes that gap without forcing a platform migration. Directory groups remain in your existing identity provider, classification flags sensitive and business-specific columns in place, and every query runs through the same row filters, column masks, and audit log — whether consumed in Power BI, Excel, SQL, or as a published Delta data product.",
      "This architecture directly supports GDPR principles of data minimisation, accountability (Art. 5), and data protection by design (Art. 25), as well as NIS2 and DORA governance expectations. No software makes an organisation compliant by itself, but technical enforcement and complete read logs make compliance verifiable.",
    ],
  },
  notDo: {
    title: "Scope, boundaries & production enforcement",
    body: "Classifyre enforces rules on reads routed through Classifyre (SQL workbench, Power BI/Excel/ODBC gateway, exports, shared datasets, and MCP). In production, organisations prevent bypass by revoking direct analyst database credentials and restricting source read ports at the network/firewall layer to Classifyre's dedicated service account — so BI, SQL, and AI tools flow exclusively through Classifyre's TLS gateway. Classifyre does not replace your identity provider or ETL tools.",
  },
  faq: [
    {
      q: "What is data access governance?",
      a: "Data access governance is the practice of defining who may read or share specific data assets, enforcing those rules dynamically at query time (via group grants, row filters, and column masks), and retaining an auditable record of every read and approval.",
    },
    {
      q: "Does Classifyre support RBAC and ABAC?",
      a: "Yes. Permissions are assigned via directory groups and roles (RBAC), while row-level predicates and column classifications dynamically determine visible rows and masking modes (ABAC).",
    },
    {
      q: "Do we need to duplicate user management in Classifyre?",
      a: "No. Connect Entra ID, Active Directory, Okta, or any OIDC/SAML directory to sync groups automatically. When a user changes teams or leaves, their data access updates at next sign-in.",
    },
  ],
  related: ["immuta-alternative", "unity-catalog-alternative"],
};

const immuta: TopicCopy = {
  id: "immuta-alternative",
  name: "Classifyre vs Immuta",
  metaTitle: "Classifyre vs Immuta: Honest Open-Source Comparison (2026)",
  metaDescription:
    "An objective engineering comparison of Classifyre and Immuta: policy pushdown vs. cross-source query governance, open source vs. commercial licensing, strengths, limitations, and when to choose each.",
  keywords: [
    "Immuta alternative",
    "Classifyre vs Immuta",
    "open source Immuta alternative",
    "Immuta competitor",
    "open source data access governance",
    "dynamic data masking open source",
    "self-hosted data governance",
  ],
  h1: "Classifyre vs Immuta: an honest engineering comparison",
  lede: "Immuta is an established commercial platform built to push access policies natively into cloud data warehouses like Snowflake and Databricks. Classifyre is a 100% open-source (Apache-2.0), self-hosted governance platform that spans on-premises databases, lakehouses (Iceberg, Delta, Parquet), files, and BI tools in one layer. Both solve real governance problems — with fundamentally different architectures and trade-offs.",
  demo: "mask",
  demoCaption: "Classifyre classifies columns in place and applies row filters and multi-level masks dynamically per group.",
  mascot: "looking-at-you",
  mascotAlt: "Classifyre vs Immuta comparison overview",
  pointsTitle: "Core architectural differences",
  points: [
    {
      title: "Cross-source query layer vs. warehouse pushdown",
      body: "Immuta translates policies into native rules inside supported cloud platforms (Snowflake, Databricks, Redshift, BigQuery). Classifyre enforces row filters and column masks inside its own query layer across 40+ heterogeneous sources — including on-premises PostgreSQL, MySQL, ODBC databases, Parquet/Iceberg/Delta files, and shared datasets.",
      href: docs.dataQuery,
      linkLabel: "How Classifyre queries work",
    },
    {
      title: "Integrated flexible detection vs. platform-scoped discovery",
      body: "Classifyre includes built-in PII and secret packs plus custom business detectors (regex, Python code, local CPU zero-shot AI models, and private LLMs) across both structured tables and unstructured wikis, tickets, and files — feeding column masks automatically.",
      href: docs.detectors,
      linkLabel: "Explore detectors",
    },
    {
      title: "100% Apache-2.0 open source vs. commercial SaaS licensing",
      body: "Every Classifyre feature — SSO, roles, row filters, dynamic masking, SQL/BI gateway, dataset requests, shared data products, and audit logging — is Apache-2.0 with zero per-seat fees. Immuta requires a commercial enterprise contract.",
      href: docs.deployment,
      linkLabel: "Self-hosted deployment",
    },
    {
      title: "Built-in BI gateway & dataset request workflow",
      body: "Classifyre gives analysts personal, expiring PostgreSQL/ODBC connections for Power BI, Excel, and Tableau, plus a plain-language workflow for business users to request and publish governed Delta or live data products.",
      href: docs.sqlConnections,
      linkLabel: "SQL & BI connections",
    },
  ],
  detail: {
    title: "The fundamental trade-off: native cloud pushdown vs. universal self-hosted layer",
    paragraphs: [
      "Choosing between Immuta and Classifyre comes down to where your data actually lives and how your users query it. Immuta's greatest strength is deep native integration with major cloud data platforms: if 95% of your analytical estate sits inside Snowflake and Databricks and data scientists run heavy Spark or SQL workloads directly inside those platforms, Immuta's native policy pushdown enforces rules without inserting an extra query hop.",
      "Classifyre is built for the reality most mid-sized and large organisations face: data spread across on-premises databases (PostgreSQL, MySQL, SQL Server/Oracle via ODBC), S3/Azure/GCS buckets with Parquet, Iceberg, and Delta tables, Databricks, plus documents and collaboration tools — often with strict data residency, Kubernetes/OpenShift, or open-source procurement requirements. Classifyre gives all of those systems one consistent governance layer, one masking engine, and one BI/SQL access gateway.",
      "Neither approach is magic. Because Classifyre does not push policies into Snowflake or Databricks internal compute, users who connect directly to Snowflake or Databricks notebooks with their own credentials are governed by those platforms, not Classifyre. Conversely, Immuta cannot unify governance across on-premises databases, object-storage Parquet files, unstructured wikis, and air-gapped environments under an open-source licence.",
    ],
  },
  comparison: {
    title: "Classifyre vs Immuta: technical comparison",
    asOf: "Based on public vendor documentation as of November 2026.",
    columns: { aspect: "Capability", them: "Immuta", us: "Classifyre" },
    architecture: {
      title: "How enforcement works under the hood",
      lede: "Immuta pushes policies down into supported cloud warehouses. Classifyre enforces policies inside a self-hosted governance and query layer spanning your entire data estate.",
      them: {
        name: "Immuta",
        badge: "Native cloud pushdown · Commercial",
        flow: [
          { step: "01 · Policy authoring", detail: "ABAC/RBAC policies authored centrally in Immuta SaaS or self-managed control plane" },
          { step: "02 · Native translation", detail: "Policies compiled and pushed down into Snowflake, Databricks, Redshift, or BigQuery" },
          { step: "03 · Warehouse execution", detail: "Users query the cloud warehouse directly; warehouse enforces translated masks & filters" },
        ],
        takeaway: "Best when workloads run natively inside supported cloud warehouses (Snowflake, Databricks) with zero extra query hop.",
      },
      us: {
        name: "Classifyre",
        badge: "Cross-source governance layer · Apache-2.0",
        flow: [
          { step: "01 · Connect & classify", detail: "Scans 40+ on-prem DBs, Iceberg/Delta/Parquet lakes, buckets, and custom sources in place" },
          { step: "02 · Group rules & masks", detail: "Directory groups (Entra ID, AD, Okta) control row filters, multi-level column masks, and data products" },
          { step: "03 · Governed consumption", detail: "Users query via SQL, Power BI, Excel, ODBC, MCP, or Delta data products with every read logged" },
        ],
        takeaway: "Best when data spans heterogeneous on-prem + cloud sources, requires open source / sovereignty, or needs unified BI & data-product governance.",
      },
    },
    scorecard: {
      title: "Capability scorecard at a glance",
      lede: "An objective view across eight practical architecture dimensions — including areas where Immuta is stronger.",
      items: [
        {
          dimension: "Open-source transparency & zero licence lock-in",
          them: { level: "none", label: "Closed source · commercial" },
          us: { level: "native", label: "100% Apache-2.0" },
        },
        {
          dimension: "Native policy pushdown inside Snowflake / Databricks compute",
          them: { level: "native", label: "Native pushdown" },
          us: { level: "none", label: "Governs Classifyre access only" },
        },
        {
          dimension: "Heterogeneous & on-prem sources (Postgres, MySQL, ODBC, Iceberg, files)",
          them: { level: "partial", label: "Cloud-warehouse focused" },
          us: { level: "native", label: "40+ & custom connectors" },
        },
        {
          dimension: "Dynamic column masking & row-level security",
          them: { level: "native", label: "Mature ABAC & masking" },
          us: { level: "native", label: "5 mask modes + row filters" },
        },
        {
          dimension: "Built-in + custom AI/ML/regex/Python detectors (tables & documents)",
          them: { level: "supported", label: "Cloud-platform discovery" },
          us: { level: "native", label: "PII, secrets, local AI & LLM" },
        },
        {
          dimension: "Governed Power BI, Excel & ODBC gateway (no shared passwords)",
          them: { level: "partial", label: "Via underlying warehouse" },
          us: { level: "native", label: "Personal expiring TLS endpoint" },
        },
        {
          dimension: "Plain-language dataset requests & governed shared data products",
          them: { level: "supported", label: "Data marketplace / access workflows" },
          us: { level: "native", label: "Requests + live & Delta shares" },
        },
        {
          dimension: "Air-gapped, on-prem & OpenShift / Kubernetes self-hosting",
          them: { level: "partial", label: "SaaS-first, enterprise self-managed" },
          us: { level: "native", label: "Docker, K8s & OpenShift offline" },
        },
      ],
    },
    tradeoffs: {
      title: "Strengths and honest limitations — both sides",
      lede: "Real architectural decisions require seeing both what each platform does well and where its boundaries lie.",
      themPros: {
        heading: "Where Immuta excels",
        items: [
          "Deep native policy pushdown inside Snowflake, Databricks, Redshift, Starburst, and BigQuery — enforcing rules even for direct notebooks and warehouse queries.",
          "Years of enterprise ABAC policy maturity, purpose-based access controls, and large-scale cloud data-platform deployments.",
          "Managed SaaS option removes infrastructure operations for teams already standardized on US cloud data platforms.",
        ],
      },
      themCons: {
        heading: "Where Immuta falls short",
        items: [
          "Proprietary, closed-source licensing with significant commercial cost and vendor lock-in.",
          "Narrowly optimized for major cloud data platforms; less suited for heterogeneous on-premises databases, raw bucket Parquet/Iceberg files, wikis, or air-gapped networks.",
          "Does not provide a unified cross-source SQL/BI gateway or custom local CPU AI / Python detector pipeline for unstructured and structured estates alike.",
        ],
      },
      usPros: {
        heading: "Where Classifyre excels",
        items: [
          "100% open source under Apache-2.0 — full code auditability, zero per-seat licensing, and no gated enterprise tiers.",
          "Unifies 40+ heterogeneous sources (on-prem DBs, Iceberg, Delta, Parquet, Databricks, S3/Azure/GCS, wikis, custom sources) under one masking, row-filter, and audit layer.",
          "Combines built-in PII/secret packs with custom business detectors (regex, Python, local CPU AI extraction, private LLMs), personal Power BI/Excel/ODBC connections, and plain-language data product requests.",
          "Runs anywhere — Docker, Kubernetes, OpenShift, air-gapped on-premises, or your own cloud — with full data sovereignty.",
        ],
      },
      usCons: {
        heading: "Honest limitations of Classifyre",
        items: [
          "Does not push masking policies down into Snowflake or Databricks internal compute; direct queries bypassing Classifyre follow the underlying platform's own permissions.",
          "Cross-source SQL runs in Classifyre's query workers (DuckDB), which handles tens of millions of rows well but is not intended to replace petabyte-scale Spark or Snowflake ETL compute.",
          "Newer project with a smaller third-party partner ecosystem than a decade-old commercial vendor.",
        ],
      },
    },
    chooseWhen: {
      title: "How to decide between Immuta and Classifyre",
      them: {
        heading: "Choose Immuta if…",
        items: [
          "Nearly all of your analytical data already lives in Snowflake, Databricks, or BigQuery.",
          "Users must run heavy native notebooks or warehouse compute directly inside those platforms under centralized policy pushdown.",
          "You prefer a commercial SaaS vendor with established enterprise cloud partnerships over self-hosted open source.",
        ],
      },
      us: {
        heading: "Choose Classifyre if…",
        items: [
          "Your data spans on-premises databases, Iceberg/Delta/Parquet lakes, object storage, and SaaS tools rather than one cloud warehouse.",
          "You need 100% open-source software (Apache-2.0), zero per-seat fees, or strict data sovereignty on Kubernetes/OpenShift or air-gapped servers.",
          "You want discovery, custom business detectors, multi-level masking, personal Power BI/Excel/ODBC access, and governed shared data products in one self-hosted platform.",
        ],
      },
    },
    rows: [
      { aspect: "Licence", them: "Commercial proprietary", us: "Apache-2.0 open source (every feature included)" },
      {
        aspect: "Deployment model",
        them: "Immuta SaaS or commercial self-managed",
        us: "Self-hosted on Docker, Kubernetes & OpenShift — on-prem, private cloud, or AWS/Azure/GCP; offline-ready",
      },
      {
        aspect: "Enforcement mechanism",
        them: "Native policy pushdown into Snowflake, Databricks, Redshift, BigQuery, Starburst",
        us: "Query-time enforcement in Classifyre across databases, Iceberg, Delta, Parquet, ODBC, and shared datasets",
      },
      {
        aspect: "Supported sources",
        them: "Major cloud data warehouses & lakehouses",
        us: "40+ structured & unstructured sources (PostgreSQL, MySQL, Databricks, ODBC, Iceberg, Delta, S3/Azure/GCS, wikis, tickets) + custom plugins",
      },
      {
        aspect: "Sensitive & custom detection",
        them: "Sensitive data discovery on connected cloud platforms",
        us: "Built-in PII & secret packs + custom regex, Python, local CPU AI extraction, text/image classifiers, and private LLMs",
      },
      {
        aspect: "Masking & row security",
        them: "Dynamic masking, differential privacy, ABAC row filtering",
        us: "5 column mask modes (redacted, last-four, deterministic hash, empty, hidden) + fail-closed group row filters",
      },
      {
        aspect: "BI & SQL access",
        them: "Connect BI tools to the underlying cloud warehouse",
        us: "Built-in PostgreSQL/ODBC TLS gateway with personal, expiring connections for Power BI, Excel, Tableau & MCP agents",
      },
      {
        aspect: "Data products & sharing",
        them: "Data marketplace access workflows over connected platforms",
        us: "Plain-language dataset requests, owner approval workflow, and live or Delta shared data products with inherited mask floors",
      },
      {
        aspect: "Licensing & cost",
        them: "Commercial enterprise subscription",
        us: "100% Apache-2.0, no per-seat licences and no locked tiers; self-hosted by your own team or integrator, with community support on GitHub",
      },
    ],
    note: "Vendor capabilities evolve frequently; verify current Immuta specifications in their official documentation. Factual corrections are always welcome at contact@classifyre.com.",
    sources: [
      {
        label: "Immuta: deployment options",
        href: "https://documentation.immuta.com/configure-integration/deployment-options/",
      },
      {
        label: "Immuta: supported data platforms",
        href: "https://documentation.immuta.com/configure-integration/data-platforms/",
      },
      {
        label: "Classifyre: SQL, masking & shared datasets",
        href: docs.dataQuery,
      },
      {
        label: "Classifyre: detectors reference",
        href: docs.detectors,
      },
    ],
  },
  notDo: {
    title: "What Classifyre does not do — and how production prevents bypass",
    body: "Classifyre does not rewrite or push masking policies into Snowflake, Redshift, or Databricks internal compute engines. In production, organisations enforce non-bypass on analytical reads by revoking direct analyst database credentials and restricting source network access to Classifyre's service principal so Power BI, Excel, SQL, and MCP agents route exclusively through Classifyre's TLS gateway.",
  },
  faq: [
    {
      q: "Can Classifyre replace Immuta if we run on-premises PostgreSQL, Iceberg, and Power BI?",
      a: "Yes — that is Classifyre's core strength. Classifyre connects directly to on-premises databases, Iceberg/Delta/Parquet storage, and your directory (Entra ID / AD / Okta), enforces row filters and multi-level column masking in place, and serves Power BI and Excel over personal expiring connections without commercial licence fees.",
    },
    {
      q: "What if we already use Snowflake or Databricks heavily for notebooks?",
      a: "If your main requirement is enforcing policies inside direct Snowflake worksheets or Databricks Spark notebooks, Immuta's native warehouse pushdown is purpose-built for that. Classifyre is a stronger fit when you need open-source governance spanning heterogeneous sources, on-premises data, custom detectors, and governed BI/data-product access.",
    },
    {
      q: "Can we migrate existing policies from Immuta?",
      a: "Not via an automated one-click converter. In practice, teams start by scanning sources with Classifyre's built-in and custom detectors (which mask sensitive columns by default), mapping directory groups, and configuring row filters and clear-read grants. Our team can assist with architecture mapping on an individually agreed basis.",
    },
    {
      q: "How does total cost compare at 500+ users?",
      a: "The Classifyre core platform is 100% Apache-2.0 open source with zero per-seat licensing fees. Your cost is the infrastructure it runs on and the time your team or integrator spends operating it. Immuta is licensed commercially per platform/scale.",
    },
  ],
  related: ["data-access-governance", "unity-catalog-alternative"],
};

const unity: TopicCopy = {
  id: "unity-catalog-alternative",
  name: "Classifyre vs Unity Catalog",
  metaTitle: "Classifyre vs Unity Catalog: Honest Governance Comparison (2026)",
  metaDescription:
    "An objective engineering comparison of Classifyre and Databricks Unity Catalog: Databricks-native lakehouse governance vs. cross-system open-source data governance across databases, Iceberg, Delta, and BI tools.",
  keywords: [
    "Unity Catalog alternative",
    "Classifyre vs Unity Catalog",
    "open source Unity Catalog alternative",
    "data governance beyond Databricks",
    "lakehouse governance open source",
    "Iceberg Delta governance",
    "column masking across sources",
  ],
  h1: "Classifyre vs Unity Catalog: governance inside Databricks vs. across your whole estate",
  lede: "Databricks Unity Catalog is the natural, deeply integrated governance layer for teams working inside the Databricks Lakehouse. Classifyre is an open-source (Apache-2.0), vendor-neutral governance platform that governs everything around and alongside Databricks — on-premises databases, Iceberg, Delta, Parquet, cloud storage, wikis, and BI tools — from one self-hosted control plane.",
  demo: "query",
  demoCaption: "A Databricks Delta table joined live with an on-premises PostgreSQL database under unified group masks.",
  mascot: "looking-around",
  mascotAlt: "Classifyre vs Unity Catalog comparison overview",
  pointsTitle: "Where the two platforms diverge",
  points: [
    {
      title: "Whole-estate governance vs. Databricks-centric scope",
      body: "Unity Catalog excels inside Databricks (and engines adopting its catalog APIs). Classifyre governs 40+ source types — relational databases, ODBC systems, Iceberg REST catalogs, raw Parquet/Delta buckets, Databricks Delta tables, and collaboration platforms — under one set of group rules and audit logs.",
      href: docs.lakehouse,
      linkLabel: "Lakehouse & multi-source docs",
    },
    {
      title: "Classification-driven masking vs. per-column SQL UDFs",
      body: "In Classifyre, column masks (redacted, last-four, deterministic hash, empty, hidden) follow detected classifications automatically or can be adjusted in a dialog — without maintaining custom SQL masking functions across dozens of tables.",
      href: docs.masking,
      linkLabel: "How masking works",
    },
    {
      title: "100% open source vs. commercial platform + OSS subset",
      body: "Databricks open-sourced a Unity Catalog server under LF AI & Data, while full enterprise capabilities (managed UI, automated classification, lineage, system audit tables, serverless compute governance) live in commercial Databricks. Classifyre ships every governance feature under Apache-2.0.",
      href: docs.deployment,
      linkLabel: "Open-source deployment",
    },
    {
      title: "Complementary — not strictly either/or",
      body: "Classifyre can read Databricks Delta tables via Unity Catalog external data access and scan Iceberg REST catalogs, making it practical to keep Unity Catalog for Databricks notebooks while using Classifyre for cross-source BI, masking, and non-Databricks systems.",
      href: docs.dataQuery,
      linkLabel: "Databricks integration docs",
    },
  ],
  detail: {
    title: "Single-lakehouse mastery vs. vendor-neutral governance",
    paragraphs: [
      "Unity Catalog is genuinely excellent when your entire data platform runs on Databricks. It governs Delta tables, Spark and Python notebooks, MLflow models, volumes, and SQL warehouses natively with zero extra latency, rich automatic lineage, and Delta Sharing built straight into the cloud workspace.",
      "The friction appears when an organisation's data does not live solely in Databricks — which is true for almost every European and North American enterprise and public-sector body. Operational PostgreSQL, MySQL, Oracle, and SQL Server databases, Iceberg tables on S3 or on-premises MinIO, departmental file shares, Confluence wikis, and Excel/Power BI users all sit outside Databricks compute.",
      "Classifyre solves that wider problem without asking you to migrate everything into one commercial cloud. It connects to your existing databases, buckets, Iceberg catalogs, and Databricks Delta tables in place, classifies sensitive and business-specific data automatically, enforces group-based row filters and column masks across cross-source SQL and BI tools, and lets business users request and publish governed shared datasets — all running on your own Docker, Kubernetes, or OpenShift infrastructure.",
    ],
  },
  comparison: {
    title: "Classifyre vs Unity Catalog: technical comparison",
    asOf: "Based on public documentation from Databricks and LF AI & Data Unity Catalog as of November 2026.",
    columns: { aspect: "Capability", them: "Unity Catalog (Databricks)", us: "Classifyre" },
    architecture: {
      title: "How each governance layer sits in your stack",
      lede: "Unity Catalog is the native metastore and security engine inside Databricks. Classifyre is an independent, self-hosted governance layer spanning databases, lakehouses, and BI tools.",
      them: {
        name: "Unity Catalog",
        badge: "Databricks-native metastore · Cloud + OSS server",
        flow: [
          { step: "01 · Metastore & catalog", detail: "Catalogs, schemas, tables, volumes, and AI/ML models registered inside Unity Catalog" },
          { step: "02 · SQL functions & ABAC", detail: "Grants, SQL row-filter functions, column-mask UDFs, or tag-based policies defined per catalog" },
          { step: "03 · Databricks compute", detail: "Enforced natively across Spark clusters, Databricks notebooks, SQL Warehouses, and Delta Sharing" },
        ],
        takeaway: "Best when your data, pipelines, notebooks, and ML workloads live primarily inside the Databricks Lakehouse.",
      },
      us: {
        name: "Classifyre",
        badge: "Vendor-neutral governance layer · Apache-2.0",
        flow: [
          { step: "01 · 40+ & custom sources", detail: "Connects Postgres, MySQL, ODBC, Iceberg, Databricks Delta, Parquet buckets, wikis, and custom systems in place" },
          { step: "02 · Detectors & group rules", detail: "Automatic PII/secret & custom AI/regex classification drives 5 masking modes and fail-closed row filters" },
          { step: "03 · Governed SQL, BI & shares", detail: "Personal Power BI, Excel, ODBC, and SQL connections plus plain-language dataset requests & Delta data products" },
        ],
        takeaway: "Best when your estate extends beyond Databricks, requires on-prem / OpenShift / Kubernetes sovereignty, or needs full open-source governance.",
      },
    },
    scorecard: {
      title: "Capability scorecard at a glance",
      lede: "An honest breakdown of where Unity Catalog wins and where Classifyre is the stronger fit.",
      items: [
        {
          dimension: "Native Databricks notebooks, Spark ETL & ML model governance",
          them: { level: "native", label: "Deeply integrated" },
          us: { level: "none", label: "Outside Classifyre scope" },
        },
        {
          dimension: "Cross-system governance (on-prem DBs, ODBC, Iceberg, files, SaaS)",
          them: { level: "partial", label: "Via Lakehouse Federation" },
          us: { level: "native", label: "40+ & custom connectors" },
        },
        {
          dimension: "Full-featured open source (UI, masking, SSO, audit, lineage)",
          them: { level: "partial", label: "OSS server is a subset" },
          us: { level: "native", label: "100% Apache-2.0" },
        },
        {
          dimension: "Zero-code column masking (redact, last-4, hash, empty, hide)",
          them: { level: "supported", label: "SQL UDFs / tag ABAC" },
          us: { level: "native", label: "Classification-driven UI" },
        },
        {
          dimension: "Built-in + custom AI/ML/regex/Python detectors (tables & docs)",
          them: { level: "supported", label: "Databricks table classification" },
          us: { level: "native", label: "PII, secrets, local AI & LLM" },
        },
        {
          dimension: "Power BI, Excel & ODBC access without cloud warehouse spend",
          them: { level: "supported", label: "Via Databricks SQL Warehouse" },
          us: { level: "native", label: "Built-in TLS Postgres gateway" },
        },
        {
          dimension: "Dataset requests & governed shared data products",
          them: { level: "native", label: "Access requests & Delta Sharing" },
          us: { level: "native", label: "Plain-language requests & shares" },
        },
        {
          dimension: "On-premises, air-gapped & Kubernetes / OpenShift self-hosting",
          them: { level: "partial", label: "Full UI/features cloud-only" },
          us: { level: "native", label: "Full stack on K8s & OpenShift" },
        },
      ],
    },
    tradeoffs: {
      title: "Strengths and honest limitations — both sides",
      lede: "Understanding both platforms' boundaries avoids costly rework later.",
      themPros: {
        heading: "Where Unity Catalog excels",
        items: [
          "Seamless, zero-hop governance inside Databricks Spark jobs, Python/SQL notebooks, SQL Warehouses, and Mosaic AI / MLflow models.",
          "Petabyte-scale native execution with built-in Delta Sharing and automatic column-level lineage across Databricks pipelines.",
          "Open-source Unity Catalog server (LF AI & Data) provides open API interoperability for lakehouse engines.",
        ],
      },
      themCons: {
        heading: "Where Unity Catalog falls short",
        items: [
          "Full governance capabilities (managed UI, automated classification, system audit tables, rich lineage) require commercial Databricks cloud rather than the OSS server alone.",
          "Tied architecturally to the Databricks ecosystem — governing on-premises databases, non-Databricks files, wikis, or air-gapped environments adds friction and cloud spend.",
          "Column masking and row filtering typically require authoring and managing SQL UDFs or Databricks-specific ABAC tags.",
        ],
      },
      usPros: {
        heading: "Where Classifyre excels",
        items: [
          "Vendor-neutral and 100% Apache-2.0 open source: full UI, SSO, roles, masking, SQL/BI gateway, shared datasets, and audit logs included with no commercial lock-in.",
          "Governs 40+ heterogeneous sources — on-prem PostgreSQL/MySQL/ODBC, Iceberg, Delta, Parquet, Databricks, cloud buckets, and unstructured wikis/documents — in one place.",
          "Built-in PII and secret packs plus custom business detectors (regex, Python, local CPU AI extraction, private LLMs) automatically drive multi-level column masking.",
          "Self-hosted on Docker, Kubernetes, or OpenShift — including completely offline and sovereign European or North American environments.",
        ],
      },
      usCons: {
        heading: "Honest limitations of Classifyre",
        items: [
          "Does not govern Databricks notebooks, Spark ETL clusters, or MLflow model registries running directly inside Databricks compute.",
          "Reads Databricks Delta tables via Unity Catalog external data access (tables only, not Databricks SQL views).",
          "Does not replace a distributed petabyte-scale Spark engine for heavy data engineering transformations.",
        ],
      },
    },
    chooseWhen: {
      title: "How to decide between Unity Catalog and Classifyre",
      them: {
        heading: "Choose Unity Catalog if…",
        items: [
          "Your organisation has standardized on Databricks as its primary cloud data and AI platform.",
          "You need native governance over Spark notebooks, ML models, and petabyte-scale Databricks pipelines.",
          "Running in Databricks' cloud environment fits your budget and data residency rules.",
        ],
      },
      us: {
        heading: "Choose Classifyre if…",
        items: [
          "Your data spans on-premises databases, Iceberg/Delta/Parquet storage, SaaS tools, and possibly Databricks side by side.",
          "You want a 100% open-source, self-hosted governance platform on Kubernetes, OpenShift, or on-premises hardware with no cloud vendor lock-in.",
          "You need automatic detection + zero-code column masking, personal Power BI/Excel/ODBC connections, and plain-language data product requests across all your sources.",
        ],
      },
    },
    rows: [
      {
        aspect: "Licence & open-source scope",
        them: "Commercial Databricks platform; LF AI & Data OSS server covers a core catalog subset",
        us: "100% Apache-2.0 open source — complete UI, SSO, masking, row filters, gateway, and audit",
      },
      {
        aspect: "Data estate scope",
        them: "Databricks Lakehouse, Delta/Iceberg via UniForm, and Lakehouse Federation",
        us: "40+ heterogeneous sources (on-prem DBs, ODBC, Iceberg, Delta, Parquet, Databricks, buckets, wikis) + custom plugins",
      },
      {
        aspect: "Column masking",
        them: "SQL masking functions per column or tag-based ABAC policies",
        us: "Classification-driven or per-column dialog: redacted, last-four, deterministic hash, empty, hidden",
      },
      {
        aspect: "Row-level security",
        them: "SQL row-filter functions per table or ABAC policies",
        us: "Fail-closed group row filters applied identically across SQL, BI, exports, and shared datasets",
      },
      {
        aspect: "Detection & classification",
        them: "Data classification for Databricks tables (commercial platform)",
        us: "Built-in PII & secrets + custom regex, Python, local CPU AI extraction, and private LLM detectors across tables and documents",
      },
      {
        aspect: "Notebooks & ML governance",
        them: "Native Spark notebooks, volumes, feature stores, and MLflow models",
        us: "Not governed inside Databricks compute; governs SQL, BI, MCP agents, and shared datasets",
      },
      {
        aspect: "Deployment & sovereignty",
        them: "Databricks cloud control plane (AWS, Azure, GCP); minimal OSS server self-hostable",
        us: "Full platform self-hosted on Docker, Kubernetes & OpenShift — on-prem, private cloud, or public cloud; runs offline",
      },
    ],
    note: "Databricks and the LF AI & Data Unity Catalog project ship updates regularly; verify current details in their official documentation. Corrections welcome at contact@classifyre.com.",
    sources: [
      {
        label: "Databricks: row filters and column masks",
        href: "https://docs.databricks.com/en/data-governance/unity-catalog/filters-and-masks/",
      },
      {
        label: "Unity Catalog open-source repository (LF AI & Data)",
        href: "https://github.com/unitycatalog/unitycatalog",
      },
      {
        label: "Classifyre: lakehouse & Databricks sources",
        href: docs.lakehouse,
      },
      {
        label: "Classifyre: SQL, masking & shared datasets",
        href: docs.dataQuery,
      },
    ],
  },
  notDo: {
    title: "What Classifyre does not do — and how hybrid enforcement works",
    body: "Classifyre does not enforce masks inside Databricks compute clusters or replace Unity Catalog for Databricks notebooks and Spark jobs. In hybrid deployments, Unity Catalog governs Databricks engineering compute while organisations revoke direct analyst DB logins on PostgreSQL, Oracle, ODBC, and storage sources so BI, SQL, and MCP AI access flows exclusively through Classifyre's TLS gateway.",
  },
  faq: [
    {
      q: "Can Classifyre work alongside Unity Catalog instead of replacing it?",
      a: "Yes — many hybrid teams run both. Keep Unity Catalog for Spark pipelines and notebooks inside Databricks, and connect Databricks Delta tables (via external data access) alongside PostgreSQL, Iceberg, Parquet, and ODBC sources in Classifyre to give business teams unified Power BI/Excel access, masking, and audit logging.",
    },
    {
      q: "Can Classifyre read Unity Catalog Delta and Iceberg tables?",
      a: "Yes. Classifyre queries Databricks Unity Catalog Delta tables (with external data access enabled) and scans Iceberg REST catalogs including Unity Catalog's Iceberg REST endpoint. Databricks SQL views are listed but cannot be queried directly because they have no underlying files.",
    },
    {
      q: "How does Classifyre compare to the open-source Unity Catalog server?",
      a: "The open-source Unity Catalog server focuses on open catalog APIs and interoperability across engines, whereas enterprise governance UI, automated classification, and full audit features sit in commercial Databricks. Classifyre ships the complete governance platform — web UI, SSO, detectors, masking, row filters, BI gateway, shared datasets, and audit logs — under Apache-2.0.",
    },
  ],
  related: ["data-access-governance", "immuta-alternative"],
};

export const enTopics: Record<TopicId, TopicCopy> = {
  "data-access-governance": accessGovernance,
  "immuta-alternative": immuta,
  "unity-catalog-alternative": unity,
};
