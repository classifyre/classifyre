import type { Locale } from "@/lib/locale";

import de from "./landing-de";
import { docs, routes } from "@/lib/site";

/**
 * Landing-page copy, one typed object per locale.
 *
 * Every string that renders on the marketing landing page lives here, so the
 * German page is a translation of the English one by construction: `de` is
 * type-checked against `LandingCopy`, and a missing string fails the build
 * instead of silently falling back. Links point at shared URL constants
 * (`@/lib/site`) so the two locales cannot drift apart on destinations,
 * only on words.
 *
 * Narrative: Classifyre is the one governed way into an organisation's
 * data. Lead with who sees what (access follows departments, roles and
 * rules), then masking by default, data products on top, the tools people
 * already use, and the read log. Discovery is the first step of masking,
 * never the headline.
 *
 * Word rules: masking is never called anonymisation (the hashed mask is
 * pseudonymisation); no "AI-powered", "zero trust", "DSPM" or a bare
 * "platform"; never "query everything" (say what people are allowed to
 * see); regulations are "supported", never "compliant"; investigation is a
 * use case with its own page, not the promise. "Data product" in headlines
 * is always explained as a shared dataset right under it. The product name
 * is the full "Open-source data access governance platform", never a bare
 * "platform". No "Enterprise" edition and no OpenShift upsell: help with
 * setup or tailoring is a contact, not a tier.
 */

/* ── Hero ───────────────────────────────────────────────────────────────── */

const enHero = {
  /** Small stamps above the headline. */
  chips: ["Open-source data access governance platform"],
  /** Each sentence (split after a full stop) starts a new line. */
  titleA: "Your access rules,",
  /** Rendered as `titleBLead` + an accent block with `titleBHighlight`. */
  titleBLead: "enforced on",
  titleBHighlight: "every query.",
  lede: "Classifyre sits between your people and the systems you already run. Departments, roles and locations decide who sees which tables, rows and columns. Personal data stays masked until someone is cleared to see it. Teams build data products on top, and every read is on record. Nothing leaves your infrastructure: run it on-premises, in your own cloud, or on public cloud infrastructure like AWS, Azure or Google Cloud.",
  /** For buyers: a pilot mapped onto their own organisation. */
  ctaPrimary: "Plan a pilot with your org structure",
  /** For engineers: the Docker command further down. */
  ctaSecondary: "Run it on one database",
  ctaShowcase: "Walk the live showcase",
} as const;

/* ── The redaction sheet (hero) ─────────────────────────────────────────── */

const enSheet = {
  readAs: "Read as",
  /** Three people, three answers to the same query. */
  personas: {
    analyst: "Analyst · Amsterdam team",
    steward: "Finance steward",
    admin: "Workspace admin",
  },
  notes: {
    analyst:
      "Her group's row filter shows Amsterdam only. Personal columns are masked inside the query; the token column is hidden.",
    steward:
      "Clear reading granted on this table until 30 June. This read is on record.",
    admin:
      "Every row, still masked. Workspace admins don't get clear values by default.",
  },
  /** Shown on the query line while the row filter applies. */
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

/** Alt text for the hand-inked investigator drawings. */
const enMascots = {
  questioning:
    "The Classifyre investigator in a trench coat, scratching his head over an unanswerable question mark",
  lookingAround:
    "The Classifyre investigator glancing around, searching for the trail",
  lookingAtYou: "The Classifyre investigator looking straight at you",
  hiddenGem:
    "The Classifyre investigator holding a magnifying glass over a hidden gem",
} as const;

/* ── The governance path (hero band) ────────────────────────────────── */

const enPath = {
  label: "The path data takes through Classifyre",
  steps: [
    { verb: "Connect", examples: ["PostgreSQL · crm", "Iceberg tables via S3", "Delta in Databricks", "Confluence wiki"] },
    { verb: "Classify", examples: ["IBAN found · 0.99", "National ID found · 0.93", "Email found · 0.98", "Column: personal"] },
    { verb: "Organise", examples: ["Group · Amsterdam team", "Groups from Entra ID", "Row filter · Amsterdam", "Finance · clear to 30 June"] },
    { verb: "Mask", examples: ["IBAN · last four", "Email · hashed", "Name · redacted", "Secret · hidden"] },
    { verb: "Build", examples: ["orders + customers", "Owner: Finance", "Masks kept as a floor", "Granted · 90 days"] },
    { verb: "Use", examples: ["Power BI via ODBC", "Excel · own login", "Agent · MCP", "Tableau · TLS only"] },
    { verb: "Log", examples: ["Lena read · Power BI", "Tom read · SQL page", "Agent read · MCP", "Noah export · Excel"] },
  ],
} as const;

/* ── Install strip ──────────────────────────────────────────────────────── */

const enInstall = {
  marker: "Start here",
  title: "One command tonight. The same core at scale.",
  lede: "The all-in-one image has the database, the UI and the scan workers in it; everything stays on your machine. The Helm chart runs the same core on Kubernetes when the estate grows.",
  dockerLabel: "All-in-one image · free · no signup",
  dockerTitle: "Run it where you already work",
  dockerCta: "Setup & configuration",
  helmLabel: "Helm chart · scales to any size",
  helmTitle: "Or run it on Kubernetes",
  helmCopy:
    "Ephemeral scan and query workers scale to zero between runs and fan out as far as your estate goes. Your cluster, your data.",
  helmCtaDocs: "Helm chart docs",
  helmCtaRepo: "Chart README on GitHub",
} as const;

/* ── Problem / tension ──────────────────────────────────────────────────── */

const enTension = {
  marker: "The problem",
  title: "Your access rules live on paper. Your data doesn't know them.",
  lede: "Every organisation has an access concept that says who may see what. It sits in a wiki, while the data sits in a dozen systems with their own logins. So access becomes a ticket, the ticket becomes an export, and nobody can say who has what.",
  /** Margin notes: the ways access goes wrong. */
  notes: [
    {
      label: "Field note 01",
      title: "Who can see this column?",
      body: "Finance asks for the customer database. Which of its 212 tables hold personal data? Nobody knows, so the ticket waits, or everyone gets everything.",
    },
    {
      label: "Field note 02",
      title: "Just send me the export",
      body: "Data leaves by CSV and shared database passwords. Six copies later nobody can say where the customer list lives, or who still has it.",
    },
    {
      label: "Field note 03",
      title: "Prove it to the auditor",
      body: "Who read the payroll tables last quarter, with which tool? Without a log of every read, the honest answer is: we don't know.",
    },
    {
      label: "Field note 04",
      title: "Can the districts see only their own cases?",
      body: "The Amsterdam office asks for the case statistics. Today that means a separate export per district, rebuilt every month, and one more copy nobody tracks.",
    },
  ],
  kicker:
    "Access that follows your organisation, masked by default, every read on record: that is the way out. Because it is the same shape every time: useful data locked away because nobody can say who may see it, or handed out whole because nobody had time to say no.",
  figureCaption: "Fig. 01: six systems, six logins, and an access concept none of them has read",
  /** The six systems on the board. */
  nodes: ["CRM", "HR", "BUCKET", "WIKI", "LAKE", "BI"],
} as const;

/* ── How it works: the journey ──────────────────────────────────────── */

const enJourney = {
  marker: "How it works",
  tape: "Reads 40+ systems in place · never copied",
  tapeLink: "Browse the source catalogue",
  title: "From your org chart to governed data products.",
  lede: "Connect your systems, map your departments and roles, and Classifyre decides every read: which rows, which columns, masked or clear. Teams then build data products on top, and people use them in the tools they already have.",
  stages: [
    {
      id: "discover",
      step: "Connect & classify",
      title: "Connect and classify every source",
      body: [
        "Classification decides what is protected. Connect databases, lakehouses, buckets and SaaS tools; Classifyre reads them in place, so nothing is copied into another warehouse. Built-in detectors look for 41 kinds of personal data, including Austrian, German and Swiss identifiers, and 27 kinds of secrets. Add your own with a regex, a model or a prompt.",
        "Every finding comes with a score and a written reason, so a data protection officer can check it before it counts. The classification it produces is what the masks follow from then on.",
      ],
      facts: ["40+ source types", "41 PII entities · 27 secret patterns", "A score and a reason on every finding"],
      href: docs.detectors,
      linkLabel: "See the detector packs",
      media: "discover",
      caption: "Personal data found across three sources, ranked with reasons.",
    },
    {
      id: "access",
      step: "Access by organisation",
      title: "Access follows your organisation",
      body: [
        "Bring in your groups from single sign-on: Entra ID, Active Directory, Okta or any OIDC or SAML directory. Then grant a department a source, a team a table, a district only its own rows, a steward clear values until a date. Access is always given to groups, so when someone changes department in the directory, their data access follows at the next sign-in.",
        "Nobody grants more than they have, and nobody approves their own request. Workspace admins don't get clear data by default: reading personal data in clear is a grant of its own, and it is on record.",
      ],
      facts: ["Groups from Entra ID, AD, Okta", "Row filters per group, failing closed", "Grants with end dates", "Requests decided by owners"],
      href: docs.whoMayQuery,
      linkLabel: "Who may query what",
      media: "access",
      caption: "Directory groups mapped to grants: a district sees its own rows, finance reads in clear until 30 June.",
    },
    {
      id: "mask",
      step: "Masked by default",
      title: "Masked by default, inside the query",
      body: [
        "Personal columns are masked by default: redacted, last four, hashed so tables still join, or hidden. Masks apply inside the query, so a WHERE or a JOIN can't reach past them. Only a group granted Data reader, unmasked reads the clear values, for a source or a single table, with an end date.",
        "The hashed mask is pseudonymisation in the sense of the GDPR, not anonymisation: equal values hash the same, so analysts can join and count people without reading who they are. Watch it below: the same queries, run by an analyst and by a finance steward.",
      ],
      facts: ["Masked by default", "Redacted · last four · hashed · hidden", "Pseudonymisation, not anonymisation", "Clear reading is its own grant"],
      href: docs.masking,
      linkLabel: "How masking works",
      media: "readers",
      caption: "",
    },
    {
      id: "share",
      step: "Data products",
      title: "Build data products on governed data",
      body: [
        "Yes — you can build data products on Classifyre. Join sources into a shared dataset (customers from the CRM, orders from the lake, invoices from finance), name an owning group, and grant it to the groups that need it. That is what we mean by a data product: a named, owned, sharable dataset a team can rely on, query with governance, and build on, without anyone handing over the raw tables.",
        "A shared dataset is a saved query, not a copy: it reads up to eight sources live, next to the data, from databases to Delta, Iceberg and Parquet files. The masks of every input travel with it as a floor, so a data product can never be looser than its sources.",
      ],
      facts: ["Joins up to 8 sources live", "Masks travel as a floor", "An owning group, readers per group", "Sharable assets, queried with governance"],
      href: docs.sharedDatasets,
      linkLabel: "Shared datasets",
      media: "share",
      caption: "Three sources joined into one dataset, shared with a group, masks kept.",
    },
    {
      id: "bi",
      step: "Power BI, Excel & agents",
      title: "Use it in Power BI, Excel, SQL and AI agents",
      body: [
        "Classifyre answers as a PostgreSQL database. Each person creates their own SQL connection, encrypted and expiring, and points Power BI, Excel, Tableau or DBeaver at it. No service account with the keys to everything, no password inside a report file. The SQL page and exports to Excel, CSV and Parquet work the same way.",
        "The connection carries the person's own rights: the tables they may query, the rows their group may see, the masks on every personal column. AI agents over MCP read through the same rules as the person who connected them, never more. Revoke it and the report stops.",
      ],
      facts: ["A personal connection per tool", "TLS only, expiring, revocable", "MCP agents read as you", "The read log names the tool"],
      href: docs.sqlConnections,
      linkLabel: "SQL connections",
      media: "bi",
      caption: "A personal connection, used from a BI report, still masked.",
    },
    {
      id: "govern",
      step: "Proof",
      title: "Prove it: owners, contracts and every read on record",
      body: [
        "A governed table has an owner, stewards and a custodian, a classification for every column, and a status from draft to certified. Quality rules check it on a schedule: missing values, invalid IBANs, duplicates, row counts or any SQL you write. The agreement exports as an ODCS data contract.",
        "Usage shows who reads the table and through which tool; Activity shows every read and every change, old value next to new. When the auditor or the data protection officer asks, the answer is already written down.",
      ],
      facts: ["Owners, stewards, custodians", "Quality rules on a schedule", "ODCS data contracts", "Every read and change on record"],
      href: docs.governance,
      linkLabel: "Governed assets",
      media: "govern",
      caption: "Owner, steward and custodian assigned, access set, a quality rule run, the table certified, the contract exported.",
    },
  ],
} as const;

/* ── The differentiator ─────────────────────────────────────────────────── */

const enReaders = {
  readers: {
    masked: { name: "Lena, analyst", role: "Data reader" },
    clear: { name: "Tom, finance steward", role: "Data reader, unmasked" },
  },
  rowsLabel: (n: number) => (n === 1 ? "1 row" : `${n} rows`),
  variants: [
    {
      id: "select",
      label: "SELECT",
      note: "Same rows, different cells. Lena sees the last four digits; Tom reads the account in clear.",
    },
    {
      id: "where",
      label: "WHERE",
      note: "Filtering on the clear value finds nothing for Lena: the filter runs on the masked value, not around it.",
    },
    {
      id: "join",
      label: "JOIN",
      note: "The hashed email still joins: equal values hash the same, so Lena matches tables without reading a single address.",
    },
    {
      id: "group",
      label: "GROUP BY",
      note: "Counts work on masked columns. The answer is useful; the person behind it stays covered.",
    },
  ],
  caption:
    "Reading masked data is a grant of its own, with an end date, and it is on record.",
  link: "How masking works",
} as const;

/* ── Interactive demo (cases) ───────────────────────────────────────────── */

const enDemo = {
  marker: "When something leaks",
  title: "This is the part most tools leave to you.",
  tabs: {
    caseBoard: "Case 042",
    queue: "Findings queue",
    autopilot: "Autopilot log",
  },
  caseBoard: {
    label: "A case, assembling itself",
    figcaption:
      "A classified file emailed out: sender traced, impact scoped, duplicate confirmed, every exhibit attributed.",
    exhibits: [
      { tag: "EML", text: "The external email itself: headers, recipient, timestamp" },
      { tag: "ID", text: "Sender identity resolved across the directory" },
      { tag: "CLASS", text: "Classification marking found inside the attachment" },
      { tag: "DUP", text: "Internal original confirmed by fingerprint" },
    ],
  },
  queue: {
    label: "Findings, ranked; not listed",
    columns: {
      finding: "Finding",
      where: "Where",
      score: "Score",
      reason: "Why it ranked",
    },
    rows: [
      {
        finding: "Access key in a build log",
        where: "gitlab-ci / build.log",
        score: "0.94",
        reason: "Deterministic key pattern in a world-readable log, twice in one week.",
      },
      {
        finding: "Customer list left the company",
        where: "mail-gateway / EML",
        score: "0.87",
        reason: "421 customer rows in an attachment sent to a personal address.",
      },
      {
        finding: "Supplier contract, second copy",
        where: "sharepoint / procurement",
        score: "0.71",
        reason: "Near-duplicate of the signed original: clause 7 differs.",
      },
      {
        finding: "Salary table in a personal drive",
        where: "drive / personal",
        score: "0.68",
        reason: "Payroll columns plus employee identifiers, outside the HR workspace.",
      },
      {
        finding: "Register entry contradicts filing",
        where: "company register / public",
        score: "0.52",
        reason: "Company marked active; no accounts filed in 34 years.",
      },
    ],
    footnote:
      "Score is importance 0–1 with written reasons, not a severity label you have to trust blindly.",
  },
  autopilot: {
    label: "Between scans, nobody typed a prompt",
    rows: [
      {
        time: "02:14",
        agent: "Inquiry",
        text: "3 fresh findings matched the standing question “PII leaving the company”.",
      },
      {
        time: "02:15",
        agent: "Case",
        text: "Opened case 042, drafted two competing hypotheses, attached 4 exhibits.",
      },
      {
        time: "02:16",
        agent: "Config",
        text: "The mail-gateway source found nothing across three scans. Proposed wider sampling.",
      },
      {
        time: "02:17",
        agent: "Detector author",
        text: "Drafted a classification-marking detector. Dry-run: 12 hits on the last corpus.",
      },
      {
        time: "02:18",
        agent: "Dream",
        text: "Consolidated memory: two priors confirmed, one discarded before the next cycle.",
      },
    ],
    footnote:
      "Observe-only mode keeps every action a proposal. Each step logs what it did and why.",
  },
  cta: "Walk the real thing",
} as const;

/* ── Sectors ────────────────────────────────────────────────────────────── */

const enSectors = {
  marker: "Where it lands",
  title: "The data looks different. The rules are the same.",
  lede: "Classifyre reads whatever the organisation runs on; the sector only decides which columns are personal, which rows each unit sees, and who reads them in clear.",
  columns: {
    sector: "Sector",
    data: "Typical data",
    finds: "What changes",
  },
  rows: [
    {
      sector: "Public sector · states · cities",
      data: "Registers, case files, statistics, procurement",
      finds: "Each district, department or municipal office sees its own rows; personal columns arrive masked; the DPO reads the log",
    },
    {
      sector: "Healthcare · hospitals",
      data: "Admissions, lab results, staffing, billing",
      finds: "Analysts count patients without reading who they are",
    },
    {
      sector: "Banking · KYC",
      data: "Customer master, transactions, accounts",
      finds: "IBANs as last four, hashed IDs that still join, a read log for the regulator",
    },
    {
      sector: "Insurance",
      data: "Claims, policies, health declarations",
      finds: "Actuaries get the tables, not the policyholders",
    },
    {
      sector: "BI · analytics teams",
      data: "Warehouses, lakehouses, Delta and Iceberg tables",
      finds: "Power BI and Excel on personal connections instead of one shared password",
    },
    {
      sector: "Security teams",
      data: "Git, wikis, tickets, buckets, logs",
      finds: "Keys and tokens found, ranked with reasons, cleaned up first",
    },
    {
      sector: "Internal audit · compliance",
      data: "Access logs, payroll, contracts",
      finds: "Who read which table, through which tool, and when: one filter",
    },
    {
      sector: "Incident response",
      data: "Mail, drives, databases",
      finds: "When something leaks: one fingerprint across systems, worked as a case",
    },
  ],
  footnote:
    "Each row is a starting point, not a separate product: the same groups, masks, grants and read log underneath.",
  links: [
    { label: "Data access governance", href: "/data-access-governance" },
    { label: "Incident response", href: routes.incidentResponse },
    { label: "Immuta alternative", href: "/immuta-alternative" },
    { label: "Unity Catalog alternative", href: "/unity-catalog-alternative" },
    { label: "Read the case files", href: routes.blog + "/cases" },
  ],
} as const;

/* ── Conversion ─────────────────────────────────────────────────────────── */

const enConvert = {
  marker: "Your move",
  title: "Start with one department and one source.",
  lede: "A four-to-six-week pilot maps your groups and rules onto a real system. Engineers can run the same thing tonight with one Docker command, and everything they set up carries over to Kubernetes.",
  paths: [
    {
      label: "A pilot with one department",
      text: "Four to six weeks on a real system: your directory groups mapped, masks and row filters on, one Power BI connection, and an access report your DPO can sign off. Fixed scope, fixed price.",
    },
    {
      label: "Tonight, on your machine",
      text: "One Docker command. Sources, groups, masks and the read log stay local.",
    },
    {
      label: "At scale, on Kubernetes",
      text: "The same core as a Helm chart: workers scale to zero between runs. Your team or your integrator runs it; if you need help with setup, installation or tailoring Classifyre to your organisation, contact us.",
    },
  ],
  ctaPrimary: "Plan a pilot",
  ctaSecondary: "Run it on one database",
  ctaShowcase: "Walk the live showcase",
  ctaBlog: "Read the field notes",
} as const;

/* ── FAQ ────────────────────────────────────────────────────────────────── */

const enFaq = {
  marker: "Straight answers",
  title: "Questions people actually ask.",
  lede: "",
  items: [
    {
      q: "What is Classifyre?",
      a: "Classifyre is the one governed way into your organisation's data: access follows your departments, roles and rules, personal data stays masked until someone is cleared for it, and every read is on record, on your own servers. It reads the 40+ systems you already run in place and serves them to SQL, Excel, Power BI and AI agents. All of it is open source under Apache-2.0.",
    },
    {
      q: "How does Classifyre use our org structure and AD groups?",
      a: "Sign-in runs through an identity server (Keycloak) connected to your directory: Entra ID, Active Directory over LDAP, Okta, or any OIDC or SAML provider. Directory groups map to groups in Classifyre, and access is always given to groups: Data reader on a workspace, a source or one table; clear reading of personal columns as a grant of its own; row filters that show each group only its rows. Grants can carry an end date. When someone moves department in the directory, their data access follows at their next sign-in.",
    },
    {
      q: "Does Classifyre replace our access concept?",
      a: "No, it enforces it. Your access concept still decides who may see what. Classifyre makes that decision hold on the data itself, on every query and in every tool, and writes down every read, so you can show that it held.",
    },
    {
      q: "Can teams build data products on Classifyre?",
      a: "Yes — you can build data products on Classifyre. A shared dataset joins tables from different sources into one named, saved query with an owning group and readers granted per group. It is a sharable asset: teams query it with the same governance — grants, row filters, masks and the read log — as the sources underneath. It reads the sources live instead of copying them, and the masks of every input travel with it as a floor, so a data product can never show more than its sources allow.",
    },
    {
      q: "Is everything really open source, including SSO and roles?",
      a: "Yes. Every feature is Apache-2.0: connectors, detection, masking, grants, row filters, the SQL endpoint, the read audit, SSO, roles, tenants and workspaces. There is no separate enterprise build with extra code. If you need help with rollout, installation or tailoring Classifyre to your organisation, contact us — running it yourself or with your integrator is always an option.",
    },
    {
      q: "Does Classifyre replace our ETL or data-product tools?",
      a: "No. Keep your ETL tools, pipelines, dbt models and data products. Classifyre doesn't build or move data: it reads what those tools produce, in place, and governs it with classification, owners, masks, quality rules and access, every read on record. That works the same in open source.",
    },
    {
      q: "How is this different from Immuta, Unity Catalog or Trino?",
      a: "Immuta is a commercial product that enforces access policies inside cloud data platforms such as Snowflake and Databricks. Unity Catalog is the governance layer of Databricks. Trino federates queries and leaves access rules and masking to you. Classifyre puts one governed access layer over 40+ systems, open source, running on your infrastructure — on-premises, in your own cloud, or on public cloud infrastructure like AWS, Azure or Google Cloud: access by group, row and column, masks inside the query, and the result in SQL, Excel and Power BI.",
    },
    {
      q: "Does it work with Power BI and Excel?",
      a: "Yes. Classifyre answers as a PostgreSQL database. Power BI, Excel, Tableau, DBeaver and any JDBC or ODBC client connect with a personal, encrypted connection that expires and can be revoked. Masks and row filters apply there exactly as in the app, and every read is recorded with the tool's name.",
    },
    {
      q: "Is masking the same as anonymisation?",
      a: "No. Masking hides values from people who are not allowed to see them; the data itself is unchanged and the right people can still read it. The hashed mask is pseudonymisation in the sense of the GDPR: equal values hash the same, so tables still join, but the value can't be read.",
    },
    {
      q: "Where does my data go? Does anything leave our infrastructure?",
      a: "Nowhere. Classifyre runs inside your network and keeps everything in your own PostgreSQL database and storage — on-premises, in your own cloud, or on public cloud infrastructure like AWS, Azure or Google Cloud. Queries run where the data is. It runs offline, and AI features use only the providers you configure, including models you host yourself.",
    },
    {
      q: "Does it run on Kubernetes?",
      a: "The quickest start is one Docker image on macOS, Windows or Linux. The same core ships as a Helm chart for Kubernetes, where workers run as jobs that scale to zero between runs — on-premises, in your own cloud, or on public cloud infrastructure like AWS, Azure or Google Cloud. If you need help with setup, installation or tailoring, contact us.",
    },
  ],
} as const;

/* ── Incident response (its own use-case page) ──────────────────────────── */

const enIncident = {
  metaTitle: "Incident Response for Data Leaks, Open Source",
  metaDescription:
    "When personal data or a secret leaks: ranked findings, fingerprints across systems, cases with evidence and hypotheses, and an autopilot that explains itself.",
  breadcrumb: "Incident response",
  chip: "Use case · incident response",
  titleLead: "When something leaks,",
  titleHighlight: "work it as a case.",
  lede: "Governance is what you run every day. The investigation is what you open on the day a customer list leaves by email or a key turns up in a build log. The same findings that drive the masks feed it: standing inquiries, fingerprints across systems, cases with evidence and competing hypotheses, and an autopilot that does the legwork between scans.",
  ctaPrimary: "Walk the live case",
  ctaSecondary: "Read the case files",
  points: {
    marker: "What you get",
    title: "From a finding to a conclusion you can defend.",
    items: [
      {
        title: "Inquiries",
        body: "Saved questions (“PII leaving the company”) that keep surfacing matching findings, scan after scan.",
        href: docs.inquiry,
      },
      {
        title: "Fingerprints",
        body: "Deterministic duplicate and similarity detection that links the same file or record across systems.",
        href: docs.duplicates,
      },
      {
        title: "Cases and hypotheses",
        body: "A workspace that collects exhibits, weighs competing explanations, and records how the conclusion was reached.",
        href: docs.cases,
      },
      {
        title: "Autopilot",
        body: "Agents that open inquiries, maintain fingerprints, build cases and draft hypotheses after every scan, logging what they did and why.",
        href: docs.autopilot,
      },
    ],
    linkLabel: "Read the docs",
  },
  faq: [
    {
      q: "Is Classifyre still an investigation tool?",
      a: "Yes, for the day something leaks. Cases, standing inquiries, fingerprints across sources and the autopilot are all there and open source. Governed access is what you run every day; the investigation is what you open when it matters.",
    },
    {
      q: "Does the autopilot act on its own?",
      a: "Only as far as you let it. In observe-only mode every action stays a proposal for a person to accept. Every step logs what it did and why, and agents running on their own never read table rows: only a signed-in person's token does.",
    },
    {
      q: "Do we need the governance part to use it?",
      a: "No. Connect a source, switch on detectors, and the findings feed inquiries and cases straight away. The masks, grants and read log are there when you want them.",
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

/**
 * The shape every locale must fill: the English copy with its literal
 * strings widened, so a translation is checked for completeness, not for
 * matching English words.
 */
export type LandingCopy = Widen<typeof en>;

export const landingCopy: Record<Locale, LandingCopy> = {
  en,
  de,
};

export function getLandingCopy(locale: Locale): LandingCopy {
  return landingCopy[locale] ?? en;
}

/** Destinations the copy refers to, shared by both locales. */
export const landingLinks = {
  routes,
  docs,
} as const;
