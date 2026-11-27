import type { Locale } from "@/lib/locale";

import de from "./landing-de";
import { docs, routes } from "@/lib/site";

/**
 * Landing-page copy, one typed object per locale.
 *
 * Every string that renders on the marketing landing page lives here, so the
 * German page stays structurally locked to the English one at build time.
 *
 * Narrative: Classifyre is an end-to-end open-source data governance platform
 * that integrates with the tools an organisation already runs (existing ETL,
 * IAM, databases, lakehouses, and BI tools). Connect known or custom sources,
 * detect PII and business-specific signals, enforce group access plus row and
 * column masking, serve governed SQL/Power BI/Excel/ODBC, and let business
 * users request and share Delta / live data products with every read logged.
 */

/* ── Hero ───────────────────────────────────────────────────────────────── */

const enHero = {
  chips: ["Sovereign Data Governance Platform"],
  titleA: "Find it. Govern it.",
  titleBLead: "Use it",
  titleBHighlight: "safely.",
  lede: "Classifyre connects directly to your existing databases, lakehouses, file stores, and identity directory — governing data from source to consumption without migration. Discover and classify sensitive data in place, enforce live masking and access controls across SQL, Power BI, Excel, and AI agents, publish trusted data products with built-in quality checks and usage tracking, and resolve data leaks as auditable cases — on your own infrastructure.",
  ctaPrimary: "Deploy open source",
  ctaSecondary: "Plan a tailored rollout",
  ctaShowcase: "Explore live demo",
  proofBar: [
    { label: "Licence", value: "100% Apache-2.0 open source" },
    { label: "Infrastructure", value: "Docker, Kubernetes & OpenShift" },
    { label: "Data estate", value: "Iceberg, Delta, Parquet & 40+ sources" },
    { label: "Built in Austria", value: "EU standards · deployed worldwide" },
  ],
} as const;

/* ── The redaction sheet (hero) ─────────────────────────────────────────── */

const enSheet = {
  readAs: "View as",
  personas: {
    analyst: "Regional analyst",
    steward: "Finance steward",
    admin: "Platform admin",
  },
  notes: {
    analyst:
      "Row filter limits results to Amsterdam. Personal columns are masked at query time and the token column is hidden.",
    steward:
      "Time-limited unmasked grant active through 30 June. Every query is recorded in the audit log.",
    admin:
      "Full infrastructure access across all rows, while personal values remain masked by default.",
  },
  rowFilter: "row filter · city = 'Amsterdam'",
  hidden: "1 column hidden",
  tags: {
    name: "Person · 0.97",
    iban: "IBAN · 0.99",
    email: "Email · 0.98",
    token: "Secret · 0.96",
  },
  masks: {
    redact: "redacted",
    partial: "last four",
    hash: "hashed",
    hidden: "hidden",
  },
  replay: "Replay",
} as const;

/** Alt text for illustrations used on secondary use-case pages. */
const enMascots = {
  questioning: "Classifyre diagram showing an unresolved data leak",
  lookingAround: "Classifyre overview illustration",
  lookingAtYou: "Classifyre governance illustration",
  hiddenGem: "Classifyre data discovery illustration",
} as const;

/* ── The governance path (hero band) ────────────────────────────────────── */

const enPath = {
  label: "End-to-end data governance flow in Classifyre",
  steps: [
    {
      verb: "Integrate",
      examples: ["PostgreSQL · CRM", "Iceberg & Parquet", "Databricks Delta", "Custom sources"],
    },
    {
      verb: "Detect",
      examples: ["PII & national IDs", "Secrets & keys", "Custom regex & code", "Local AI & LLM models"],
    },
    {
      verb: "Govern",
      examples: ["Entra ID & AD groups", "Owners & stewards", "Row-level policies", "Expiring grants"],
    },
    {
      verb: "Mask",
      examples: ["Redacted & hidden", "Last-four IBAN", "Hashed joins", "Same floor on shares"],
    },
    {
      verb: "Query & BI",
      examples: ["Power BI via ODBC", "Excel live feed", "Governed SQL", "AI agents via MCP"],
    },
    {
      verb: "Request & Share",
      examples: ["Visual join canvas", "Routed to data teams", "Versioned shared datasets", "Every read logged"],
    },
  ],
} as const;

/* ── Install strip ──────────────────────────────────────────────────────── */

const enInstall = {
  marker: "Self-hosted deployment",
  title: "Evaluate with Docker. Run in production on Kubernetes or OpenShift.",
  lede: "Inspect the code, test on real data locally in minutes, and deploy the exact same open-source core on your cluster with zero feature gates.",
  dockerLabel: "All-in-one container · no signup",
  dockerTitle: "Local evaluation with Docker",
  dockerCta: "Deployment guide",
  helmLabel: "Production Helm chart · Kubernetes & OpenShift",
  helmTitle: "Scale on your cluster",
  helmCopy:
    "Stateless scan and query workers scale to zero between runs and fan out for large estates. Run on-premises, in your private cloud, or on AWS, Azure, and GCP.",
  helmCtaDocs: "Kubernetes & OpenShift docs",
  helmCtaRepo: "Helm chart on GitHub",
} as const;

/* ── Problem / architecture framing ─────────────────────────────────────── */

const enTension = {
  marker: "Why Classifyre",
  title: "End data paralysis — without CSV leaks or US cloud lock-in.",
  lede: "When sensitive data sits across six or more databases and file stores, IT is forced into a bad choice: block BI and AI agents for months, or hand out untracked CSV exports and shared passwords. Classifyre travels to your data so teams query live in Power BI, Excel, SQL, and MCP AI tools under one open-source masking and audit layer.",
  diagram: {
    leftLabel: "Your existing stack",
    leftSources: ["PostgreSQL · MySQL · Oracle", "Iceberg · Delta · Parquet", "S3 · Azure · GCS · Files", "Custom & SaaS sources"],
    iamLabel: "Your existing IAM",
    iamSystems: "Entra ID · Active Directory · Okta · OIDC / SAML",
    centerTitle: "Classifyre Governance Layer",
    centerSub: "Open Source · Self-Hosted · In-Place",
    centerPillars: [
      "Built-in & Custom Detectors",
      "Group Access & Row Filters",
      "Multi-Level Column Masking",
      "Data Requests & Audit Trail",
    ],
    rightLabel: "Governed consumption",
    rightTools: ["Power BI & Tableau", "Excel & ODBC Clients", "Governed SQL Workbench", "Delta Shared Data Products"],
  },
  notes: [
    {
      label: "01 · Zero migration",
      title: "Keep your ETL, IAM, and storage",
      body: "Classifyre reads your databases, Iceberg and Delta tables, and file stores in place. Directory groups stay in Entra ID, Active Directory, or Okta, and your pipelines keep running untouched.",
    },
    {
      label: "02 · Multi-level control",
      title: "Different access for every group",
      body: "Regional teams see only their own rows with personal fields masked; finance stewards receive time-limited clear access; platform administrators operate the system without viewing clear customer records.",
    },
    {
      label: "03 · Governed self-service",
      title: "End uncontrolled exports and shared logins",
      body: "Replace ad-hoc CSV dumps and shared service passwords with personal, revocable SQL, Power BI, and Excel connections — plus a structured workflow for business users to request new shared datasets.",
    },
    {
      label: "04 · Audit-ready",
      title: "Clear answers for compliance and security",
      body: "Every read, export, permission grant, and dataset approval is recorded with user and tool, giving auditors and data protection officers verifiable proof on demand.",
    },
  ],
  kicker:
    "An open-source alternative to closed-source governance platforms: transparent code you can verify yourself, running on infrastructure you control, with no per-seat licensing.",
  figureCaption: "Classifyre integrates between your existing data estate and the tools your teams already use.",
  nodes: ["CRM", "HR", "BUCKET", "WIKI", "LAKE", "BI"],
} as const;

/* ── How it works: end-to-end journey ───────────────────────────────────── */

const enJourney = {
  marker: "End-to-end platform",
  tape: "Integrates with 40+ systems in place · no data copying",
  tapeLink: "Explore supported sources",
  title: "From raw sources to governed data products.",
  lede: "Six connected capabilities that cover the full governance lifecycle, from initial discovery to daily BI queries and shared data products.",
  stages: [
    {
      id: "discover",
      step: "Connect & detect",
      title: "Connect any source and detect what matters to your business",
      body: [
        "Connect 40+ known sources — relational databases, Iceberg, Delta, Parquet, cloud object storage, wikis, and collaboration tools — or add custom connectors for proprietary systems. Data is read in place without copying it into another warehouse.",
        "Start immediately with built-in packs for personal data (EU, US, and global identifiers) and secrets, then add business-specific detectors: simple regex patterns, custom Python checks, lightweight local AI extraction and classification models running on CPU, decision models, or your preferred private LLM.",
      ],
      facts: [
        "40+ built-in & custom sources",
        "PII, secrets & custom business rules",
        "Regex, Python, local CPU AI & LLMs",
        "Score and explanation on every finding",
      ],
      href: docs.detectors,
      linkLabel: "Explore detectors",
      media: "discover",
      caption: "Sources scanned in place; personal data and business signals ranked with clear explanations.",
    },
    {
      id: "access",
      step: "Govern & organise",
      title: "Access rules that follow your organisation",
      body: [
        "Connect your existing identity provider (Entra ID, Active Directory, Okta, or any OIDC/SAML directory). Permissions are always assigned to groups — per workspace, source, table, or shared dataset — so when someone changes department or leaves, their access updates automatically at next sign-in.",
        "Assign data owners and stewards, set expiration dates on temporary access, and route access requests to the responsible owner. Administrators never receive unmasked data by default.",
      ],
      facts: [
        "Syncs with Entra ID, AD & Okta",
        "Group grants with expiration dates",
        "Row-level security per group",
        "Owner-approved access requests",
      ],
      href: docs.whoMayQuery,
      linkLabel: "How access control works",
      media: "access",
      caption: "Directory groups mapped to table grants: regional teams get filtered rows, finance gets time-limited clear access.",
    },
    {
      id: "mask",
      step: "Multi-level masking",
      title: "Column and row masking tailored to each group",
      body: [
        "Apply granular protection from individual columns down to specific rows: fully redacted, partial last-four (such as IBAN or account numbers), deterministic hashed pseudonymisation (so analysts can still join and count records without seeing identities), empty, or completely hidden columns.",
        "Masks are enforced inside the query engine so filters and joins cannot leak hidden values. The same policies work on original source tables and travel automatically onto shared datasets, letting different groups work on the same data at different clearance levels.",
      ],
      facts: [
        "Redacted · last four · hashed · empty · hidden",
        "Row filters + column masks combined",
        "Applied on source tables & shared datasets",
        "GDPR pseudonymisation, safe for joins",
      ],
      href: docs.masking,
      linkLabel: "How masking works",
      media: "readers",
      caption: "",
    },
    {
      id: "bi",
      step: "SQL, Power BI, Excel & ODBC",
      title: "Live governed access in the tools teams already use",
      body: [
        "Analysts and business teams do not need a new BI tool. Classifyre exposes a standard PostgreSQL-compatible endpoint so Power BI, Excel, Tableau, DBeaver, and any ODBC or JDBC client connect directly with personal, encrypted, expiring credentials.",
        "Every query runs through the user's exact group permissions, row filters, and column masks — whether executed from the built-in SQL workbench, Excel, Power BI, or an AI assistant connected over MCP. Revoke a connection and downstream access stops immediately.",
      ],
      facts: [
        "Power BI, Excel, Tableau & ODBC",
        "Personal, expiring, revocable connections",
        "Cross-source SQL joins up to 8 systems",
        "AI agents via MCP inherit user rules",
      ],
      href: docs.sqlConnections,
      linkLabel: "SQL & BI connections",
      media: "bi",
      caption: "A personal Power BI connection queries live governed tables with masking enforced and every read logged.",
    },
    {
      id: "share",
      step: "Data requests & shared datasets",
      title: "Sketch the dataset you need. Receive a governed shared dataset.",
      body: [
        "Business users build dataset requests on a visual join canvas — placing catalog tables (including locked tables, seeing columns without exposing rows), connecting joins, ticking fields, and adding filters while valid SQL writes itself live. Requests route to a data-team group to check, refine in SQL if needed, and publish — or open via plain-language prompts through an MCP AI assistant.",
        "Each delivery publishes or links a governed shared dataset for the requesting group, automatically inheriting every underlying table's masks, classifications, and row filters as a strict floor. When needs change, requesters ask for updates on the same case and each delivery creates a new dataset version — or teams with publish rights can self-serve immediately.",
      ],
      facts: [
        "Visual join canvas with live SQL",
        "Routed to data-team groups",
        "Versioned shared datasets & change requests",
        "Source masks inherited as a strict floor",
      ],
      href: docs.dataRequests,
      linkLabel: "How data requests work",
      media: "share",
      caption: "Tables joined on the request canvas, SQL generated live, routed to the Finance data team, and delivered as v1 of a governed shared dataset.",
    },
    {
      id: "govern",
      step: "Quality, usage & audit",
      title: "Verifiable ownership, data quality, and live usage tracking",
      body: [
        "Every governed table and shared dataset carries named owners, stewards, and custodians, certification status (Draft to Certified), and scheduled data quality checks for missing values, invalid identifiers, duplicates, freshness, or custom SQL — where failures automatically open findings for the asset owner and export cleanly as open data contracts (ODCS).",
        "Every read, export, permission change, and dataset approval is recorded with the person, timestamp, and tool used (Workbench, Power BI, Excel, SQL, or MCP), giving CDOs live usage and export analytics while turning GDPR, EU AI Act, NIS2, and DORA reviews into a filtered view.",
      ],
      facts: [
        "Owners, stewards & certification lifecycle",
        "Scheduled quality checks & auto-findings",
        "Live usage, exports & policy change diffs",
        "Open data contracts (ODCS) & full read log",
      ],
      href: docs.governance,
      linkLabel: "Governance & audit docs",
      media: "govern",
      caption: "Ownership assigned, column masks reviewed, quality checks passing, live usage tracked, and open data contract exported.",
    },
  ],
} as const;

/* ── The differentiator (side-by-side readers) ──────────────────────────── */

const enReaders = {
  readers: {
    masked: { name: "Lena · BI Analyst (EU)", role: "Masked · all regions" },
    clear: { name: "Tom · Finance Steward", role: "Cleared access" },
  },
  rowsLabel: (n: number) => (n === 1 ? "1 row" : `${n} rows`),
  variants: [
    {
      id: "select",
      label: "SELECT",
      note: "Same query, different clearance. Lena sees redacted names and last-four IBANs; Tom reads full values under a time-limited grant.",
    },
    {
      id: "where",
      label: "WHERE",
      note: "Filtering on an unmasked IBAN returns zero rows for Lena — masking runs inside the query so values cannot be guessed via filters.",
    },
    {
      id: "join",
      label: "JOIN",
      note: "Deterministic hashed emails still join accurately across tables, letting Lena analyse support volume without seeing customer addresses.",
    },
    {
      id: "group",
      label: "GROUP BY",
      note: "Aggregations and distinct counts work seamlessly over masked columns, keeping analytics accurate while protecting identities.",
    },
  ],
  caption:
    "Unmasked access is always an explicit, time-limited grant — never bundled into admin rights — and every read is logged.",
  link: "How masking works",
} as const;

/* ── Interactive demo (incident response secondary page) ────────────────── */

const enDemo = {
  marker: "Incident response",
  title: "When sensitive data leaks, investigate it in one place.",
  tabs: {
    caseBoard: "Case 042",
    queue: "Findings queue",
    autopilot: "Autopilot log",
  },
  caseBoard: {
    label: "Assembled incident case",
    figcaption:
      "A classified file emailed externally: sender resolved, scope confirmed via fingerprints, every exhibit linked.",
    exhibits: [
      { tag: "EML", text: "External email headers, recipient, and timestamp" },
      { tag: "ID", text: "Sender resolved against the corporate directory" },
      { tag: "CLASS", text: "Internal classification marking detected inside attachment" },
      { tag: "DUP", text: "Source file matched via deterministic fingerprint" },
    ],
  },
  queue: {
    label: "Prioritised findings with written rationale",
    columns: {
      finding: "Finding",
      where: "Location",
      score: "Score",
      reason: "Why it ranked",
    },
    rows: [
      {
        finding: "Access key in build log",
        where: "gitlab-ci / build.log",
        score: "0.94",
        reason: "Verified key pattern in a shared log, recurring twice in one week.",
      },
      {
        finding: "Customer list sent externally",
        where: "mail-gateway / EML",
        score: "0.87",
        reason: "421 customer records attached to an email sent to a personal address.",
      },
      {
        finding: "Modified supplier contract copy",
        where: "sharepoint / procurement",
        score: "0.71",
        reason: "Near-duplicate of signed original with clause 7 altered.",
      },
      {
        finding: "Payroll sheet in personal drive",
        where: "drive / personal",
        score: "0.68",
        reason: "Salary columns and employee IDs stored outside the HR workspace.",
      },
      {
        finding: "Registry mismatch on vendor",
        where: "company register / public",
        score: "0.52",
        reason: "Active supplier record with no statutory filings on record.",
      },
    ],
    footnote:
      "Every finding carries a 0–1 relevance score and a clear explanation so reviewers can prioritise quickly.",
  },
  autopilot: {
    label: "Automated triage between scans",
    rows: [
      {
        time: "02:14",
        agent: "Inquiry",
        text: "Matched 3 new findings to standing watch “PII leaving the organisation”.",
      },
      {
        time: "02:15",
        agent: "Case",
        text: "Opened case 042, drafted two competing hypotheses, and linked 4 exhibits.",
      },
      {
        time: "02:16",
        agent: "Config",
        text: "Noticed zero hits on mail-gateway over three runs; proposed broader sampling.",
      },
      {
        time: "02:17",
        agent: "Detector",
        text: "Drafted a classification-marking rule; dry-run matched 12 documents.",
      },
      {
        time: "02:18",
        agent: "Review",
        text: "Consolidated triage notes and queued proposals for human approval.",
      },
    ],
    footnote:
      "Observe-only mode keeps every automated step as a proposal. Every action and reason is logged.",
  },
  cta: "Explore live showcase",
} as const;

/* ── Real-world scenarios / sectors ─────────────────────────────────────── */

const enSectors = {
  marker: "Real-world scenarios",
  title: "One table. Different rules for every group.",
  lede: "Whether you operate in Europe, North America, or globally, the governance model stays consistent: each group sees only the rows, columns, and detail level their role requires.",
  columns: {
    sector: "Sector & team",
    data: "Typical sources",
    finds: "How group-level governance works",
  },
  rows: [
    {
      sector: "Public sector & critical infrastructure",
      data: "Municipal utilities, case registers, billing DBs (Oracle/PostgreSQL), SAP & open-data exports",
      finds: "Each district or agency queries only its own jurisdiction via row filters; citizen identifiers and IBANs stay masked; DPOs and CISOs audit every read under NIS2 and GDPR.",
    },
    {
      sector: "Healthcare, hospitals & universities",
      data: "Admissions, lab feeds, clinical & research cohorts, billing tables, document archives",
      finds: "Analysts and researchers count cohorts and join records on deterministic hashed IDs without ever viewing patient names or national social security numbers.",
    },
    {
      sector: "Regulated mid-market & hybrid BI / AI",
      data: "On-premises PostgreSQL/Oracle/ODBC, Iceberg/Delta/Parquet lakes, EDI feeds, Power BI & MCP agents",
      finds: "Replaces untracked CSV exports and shared database passwords with personal, expiring BI, Excel, and AI-agent connections governed by directory groups.",
    },
    {
      sector: "Banking, insurance & actuarial",
      data: "Core customer tables, claims databases, KYC records, Delta & Iceberg lakes",
      finds: "Actuaries and analysts query live tables with redacted names and last-four IBANs while compliance holds time-limited clear grants with regulator-ready DORA audit logs.",
    },
  ],
  footnote:
    "Every scenario runs on the same Apache-2.0 core — no separate modules or paid add-ons required.",
  links: [
    { label: "Data access governance", href: "/data-access-governance" },
    { label: "Supported sources", href: routes.sources },
    { label: "vs Immuta", href: "/immuta-alternative" },
    { label: "vs Unity Catalog", href: "/unity-catalog-alternative" },
    { label: "About Classifyre", href: routes.madeInEurope },
  ],
} as const;

/* ── Conversion: Open source, run by you (no offer, questions welcome) ─── */

const enConvert = {
  marker: "Open source, run by you",
  title: "100% open source. Yours to run.",
  lede: "Every capability in Classifyre is open source under Apache-2.0 and runs on your own servers — never multi-tenant SaaS. Install it yourself, with your own team or the integrator you already work with.",
  paths: [
    {
      label: "Evaluating Classifyre",
      text: "Not sure it fits your sources, identity provider or masking rules? Ask before you install — we'd rather give you an honest answer than have you guess.",
    },
    {
      label: "Sources and setups we haven't seen",
      text: "A legacy system, an internal API, an unusual directory structure or an air-gapped cluster — tell us about it. It shapes what we build next.",
    },
    {
      label: "Bugs and feature requests",
      text: "Open an issue on GitHub so others can follow along, or write to us if you'd rather not post publicly.",
    },
    {
      label: "Security reports",
      text: "Send vulnerabilities by email with “Security” in the subject instead of opening a public issue.",
    },
  ],
  tailoringTitle: "Questions, or an unusual setup?",
  tailoringLede:
    "There is no enterprise edition and no locked features. If you're trying Classifyre and something isn't clear, or your environment looks different from what the docs assume, we're happy to hear from you.",
  ctaPrimary: "Get in touch",
  ctaSecondary: "Deployment guide",
  ctaShowcase: "Explore live demo",
  ctaBlog: "Read engineering articles",
} as const;

/* ── FAQ ────────────────────────────────────────────────────────────────── */

const enFaq = {
  marker: "FAQ",
  title: "Common questions from technical and business leaders.",
  lede: "",
  items: [
    {
      q: "What makes Classifyre different from closed-source tools like Immuta, Purview, or Unity Catalog?",
      a: "Closed-source platforms either lock governance to a single cloud warehouse (such as Unity Catalog to Databricks) or require costly commercial licences and SaaS dependencies. Classifyre is 100% open source under Apache-2.0, runs on your own infrastructure across 40+ databases, lakehouses (Iceberg, Delta, Parquet), and file systems, and combines discovery, multi-level masking, SQL/BI access, data products, and audit logging in one transparent platform.",
    },
    {
      q: "Does Classifyre replace our existing ETL pipelines, IAM, or BI tools?",
      a: "No. Classifyre is built to integrate with what you already run. Keep your ETL jobs, dbt models, identity provider (Entra ID, Active Directory, Okta, OIDC/SAML), and BI tools (Power BI, Excel, Tableau). Classifyre sits cleanly as the governance and access layer across them.",
    },
    {
      q: "How do column masking and row-level security work for different groups?",
      a: "Permissions always follow your directory groups. On any source table or shared dataset, you can restrict which rows a group sees (such as a single region or department) and mask sensitive columns as redacted, last-four, hashed pseudonymisation, empty, or hidden. Different groups querying the exact same table receive different rows and masking levels automatically, and workspace admins do not see clear personal data by default.",
    },
    {
      q: "Can business users request and share governed datasets?",
      a: "Yes. Business users build a request on a visual join canvas — placing catalog tables (seeing columns without raw rows), connecting joins, ticking fields, and adding filters while SQL generates live — or open a draft in plain language through an MCP AI assistant. The request routes to a data-team group, which checks permissions against its own access, refines the SQL if needed, and publishes a versioned shared dataset for the requesting group. Source masking, classifications, and row filters travel automatically as a floor, and change requests create new versions on the same case.",
    },
    {
      q: "What detectors are included, and can we detect business-specific data?",
      a: "Classifyre ships with ready-made detectors for personal data (including EU, US, and international identifiers) and secrets. Beyond PII, you can define custom business detectors ranging from fast regex patterns and Python checks to lightweight on-CPU zero-shot AI extraction and classification models, decision models, and private LLMs.",
    },
    {
      q: "How do teams connect Power BI, Excel, SQL, and ODBC tools?",
      a: "Classifyre provides a PostgreSQL-compatible endpoint with TLS encryption. Each user creates their own personal, expiring, revocable connection for Power BI, Excel, Tableau, DBeaver, or any ODBC/JDBC tool — eliminating shared database passwords. Every query enforces that user's row filters and column masks and records the read with the tool name.",
    },
    {
      q: "Is there a separate Enterprise edition, or is everything truly open source?",
      a: "Everything is open source under Apache-2.0 — SSO, roles, row filters, dynamic masking, SQL/BI gateway, shared datasets, audit logging, and the Helm chart. We do not gate security features behind an enterprise tier or offer multi-tenant SaaS. You run it yourself, with your own team or the integrator you already work with.",
    },
    {
      q: "Where does Classifyre run? Does data ever leave our environment?",
      a: "Nothing leaves your environment. Classifyre runs entirely on your own infrastructure — locally with Docker for evaluation, or in production on Kubernetes and OpenShift, whether on-premises, in a private data centre, or in your AWS, Azure, or Google Cloud account. It also supports offline and air-gapped deployments.",
    },
  ],
} as const;

/* ── Incident response (secondary use-case page) ────────────────────────── */

const enIncident = {
  metaTitle: "Open-Source Data Leak Incident Response",
  metaDescription:
    "When personal data or credentials leak: ranked findings, cross-system fingerprints, structured cases with evidence, and transparent automated triage.",
  breadcrumb: "Incident response",
  chip: "Use case · Incident response",
  titleLead: "When sensitive data leaks,",
  titleHighlight: "trace it fast.",
  lede: "Daily governance prevents most exposure. When a customer export leaves by email or an API key appears in a shared repository, Classifyre's detection engine feeds structured incident response: standing watches, cross-system duplicate fingerprints, evidence-backed cases, and transparent triage.",
  ctaPrimary: "Explore live case",
  ctaSecondary: "Read case files",
  points: {
    marker: "Capabilities",
    title: "From initial alert to defensible conclusion.",
    items: [
      {
        title: "Standing inquiries",
        body: "Saved queries (such as “PII leaving the organisation”) that automatically surface matching findings across every scan.",
        href: docs.inquiry,
      },
      {
        title: "Cross-system fingerprints",
        body: "Deterministic duplicate and near-duplicate matching that links leaked files back to their internal source across systems.",
        href: docs.duplicates,
      },
      {
        title: "Cases & evidence",
        body: "Structured workspaces that gather exhibits, weigh competing explanations, and document how a conclusion was reached.",
        href: docs.cases,
      },
      {
        title: "Supervised autopilot",
        body: "Automated agents that maintain fingerprints and draft case summaries between scans — logging every step and keeping humans in control.",
        href: docs.autopilot,
      },
    ],
    linkLabel: "Read the docs",
  },
  faq: [
    {
      q: "How does incident response relate to Classifyre's data governance platform?",
      a: "It runs on the exact same open-source connectors and detection engine. Governance controls who accesses data every day; incident response is ready whenever a detector flags an unexpected leak or exposed secret.",
    },
    {
      q: "Does the autopilot act without human approval?",
      a: "No. In observe-only mode every action remains a proposal for a reviewer to accept or dismiss, every step is logged, and background agents never query table rows directly.",
    },
    {
      q: "Can security teams deploy this standalone?",
      a: "Yes. Connect your repositories, buckets, mail gateways, or wikis, enable secret and PII detectors, and triage findings immediately — adding governed SQL access and masking whenever you are ready.",
    },
  ],
} as const;

/* ── Assembled copy ─────────────────────────────────────────────────────── */

export const en = {
  hero: enHero,
  sheet: enSheet,
  path: enPath,
  mascots: enMascots,
  install: enInstall,
  tension: enTension,
  journey: enJourney,
  readers: enReaders,
  demo: enDemo,
  sectors: enSectors,
  convert: enConvert,
  faq: enFaq,
  incident: enIncident,
} as const;

type Widen<T> = T extends string
  ? string
  : T extends (...args: infer A) => infer R
    ? (...args: A) => R
    : T extends readonly (infer U)[]
      ? readonly Widen<U>[]
      : T extends object
        ? { [K in keyof T]: Widen<T[K]> }
        : T;

export type LandingCopy = Widen<typeof en>;

export const landingCopy: Record<Locale, LandingCopy> = {
  en,
  de,
};

export function getLandingCopy(locale: Locale): LandingCopy {
  return landingCopy[locale] ?? en;
}

export const landingLinks = {
  routes,
  docs,
} as const;
