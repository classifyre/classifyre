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
 * Word rules: masking is never called anonymisation (the hashed mask is
 * pseudonymisation); no "AI-powered", "zero trust", "DSPM" or "data
 * platform"; investigation is one use case, not the promise.
 */

/* ── Hero ───────────────────────────────────────────────────────────────── */

const enHero = {
  /** Small stamps above the headline. */
  chips: ["Open-source data governance platform"],
  titleA: "Find it. Protect it.",
  /** Rendered as `titleBLead` + an accent block with `titleBHighlight`. */
  titleBLead: "",
  titleBHighlight: "Use it.",
  lede: "Classifyre finds personal data and secrets across the systems you already run, masks them automatically, and lets your team query everything with SQL, Excel and Power BI. Every read is logged. Nothing leaves your servers.",
  ctaPrimary: "Run it on your machine",
  ctaSecondary: "Walk the live showcase",
  micro: "No signup. One Docker command. Your data stays with you.",
} as const;

/* ── The redaction sheet (hero) ─────────────────────────────────────────── */

const enSheet = {
  readAs: "Read as",
  personas: {
    analyst: "Analyst",
    steward: "Unmasked reader",
  },
  notes: {
    analyst:
      "Personal columns are masked inside the query. The token column is hidden.",
    steward:
      "Clear reading granted on this table until 30 June. This read is on record.",
  },
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
    { verb: "Connect", examples: ["Iceberg tables via S3", "PostgreSQL · crm", "Delta in Databricks", "Confluence wiki"] },
    { verb: "Detect", examples: ["IBAN found · 0.99", "AWS key found · 0.96", "AT SVNR found · 0.93", "Email found · 0.98"] },
    { verb: "Govern", examples: ["Owner: Finance", "Column masked", "Secret hidden", "Steward named"] },
    { verb: "Grant", examples: ["Analysts · 90 days", "Clear reading · Finance", "Row filter · Graz", "Request approved"] },
    { verb: "Share", examples: ["orders + customers", "Shared table, masks kept", "Joined with lake.orders", "Parquet export"] },
    { verb: "Connect BI", examples: ["Power BI via ODBC", "Excel · own login", "Tableau · TLS only", "DBeaver · JDBC"] },
    { verb: "Log", examples: ["Lena read · Power BI", "Tom read · SQL page", "Agent read · MCP", "Jakob export · Excel"] },
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
  title: "Your data is useful. It is also full of personal data.",
  lede: "Every team wants the numbers. Every table that holds them also holds names, accounts, addresses and the odd password. So access becomes a negotiation, and the negotiation ends in a spreadsheet.",
  /** Margin notes: the three ways access goes wrong. */
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
  ],
  kicker:
    "It is the same shape every time: useful data locked away because nobody can say what is personal in it, or handed out whole because nobody had time to say no. Masked by default, granted on purpose, every read on record: that is the way out.",
  figureCaption: "Fig. 01: six systems, personal data in all of them, no line between who may see what",
  /** The six systems on the board. */
  nodes: ["CRM", "HR", "BUCKET", "WIKI", "LAKE", "BI"],
} as const;

/* ── How it works: the journey ──────────────────────────────────────── */

const enJourney = {
  marker: "How it works",
  tape: "Reads 40+ systems in place · never copied",
  tapeLink: "Browse the source catalogue",
  title: "From a raw table to a shared dataset.",
  lede: "Follow the data through Classifyre: found where it lives, queried in place, governed, used in the tools your team already has, masked for the people who should not see it, and shared on purpose.",
  stages: [
    {
      id: "discover",
      step: "Connect & detect",
      title: "Find personal data and secrets where they live",
      body: [
        "Connect databases, lakehouses, buckets and SaaS tools; Classifyre reads them in place, so nothing is copied into another warehouse. Built-in detectors look for 41 kinds of personal data, including Austrian, German and Swiss identifiers, and 27 kinds of secrets. Add your own with a regex, a model or a prompt.",
        "Every finding comes with a score and a written reason, so a data protection officer can check it and a security team can rank the cleanup. The classification it produces is what the masks follow later.",
      ],
      facts: ["40+ source types", "41 PII entities · 27 secret patterns", "A score and a reason on every finding"],
      href: docs.detectors,
      linkLabel: "See the detector packs",
      media: "discover",
      caption: "Personal data found across three sources, ranked with reasons.",
    },
    {
      id: "query",
      step: "Query across sources",
      title: "Query every system with one SQL statement",
      body: [
        "Ask questions across the systems you already have: PostgreSQL, MySQL, Databricks, and Delta, Iceberg and Parquet files in S3, Azure or Google Cloud Storage. Join up to eight sources in one query. Each query runs next to the data; nothing is loaded into a central store first.",
        "Results go where people work: the SQL page, exports to Excel, CSV and Parquet up to a million rows, or straight into a BI tool.",
      ],
      facts: ["Up to 8 sources in one query", "Delta · Iceberg · Parquet · CSV", "Exports up to 1M rows"],
      href: docs.dataQuery,
      linkLabel: "Query data",
      media: "query",
      caption: "A PostgreSQL table joined with Parquet files in a bucket.",
    },
    {
      id: "govern",
      step: "Governance",
      title: "Governance: an owner, a contract and a history for every table",
      body: [
        "A governed table has an owner, stewards and a custodian, a classification for every column, and a status from draft to certified. Quality rules check it on a schedule: missing values, invalid IBANs, duplicates, row counts or any SQL you write. The agreement exports as an ODCS data contract.",
        "Usage shows who reads the table and through which tool; Activity shows every read and every change, old value next to new. When the auditor asks, the answer is already written down.",
      ],
      facts: ["Owners, stewards, custodians", "Quality rules on a schedule", "ODCS data contracts", "Every read and change on record"],
      href: docs.governance,
      linkLabel: "Governed assets",
      media: "govern",
      caption: "Owner, steward and custodian assigned, access set, a quality rule run, the table certified, the contract exported.",
    },
    {
      id: "bi",
      step: "Power BI & Excel",
      title: "Connect Power BI and Excel without a shared password",
      body: [
        "Classifyre answers as a PostgreSQL database. Each person creates their own SQL connection, encrypted and expiring, and points Power BI, Excel, Tableau or DBeaver at it. No service account with the keys to everything, no password inside a report file.",
        "The connection carries the person's own rights: the tables they may query, the rows their group may see, the masks on every personal column. Revoke it and the report stops.",
      ],
      facts: ["A personal connection per tool", "TLS only, expiring, revocable", "The read log names the tool"],
      href: docs.sqlConnections,
      linkLabel: "SQL connections",
      media: "bi",
      caption: "A personal connection, used from a BI report, still masked.",
    },
    {
      id: "mask",
      step: "Mask per person",
      title: "Masked for one person, clear for another",
      body: [
        "Personal columns are masked by default: redacted, last four, hashed so tables still join, or hidden. Masks apply inside the query, so a WHERE or a JOIN can't reach past them. Only a group granted Data reader, unmasked reads the clear values, for a source or a single table, with an end date. Admins don't get it by default.",
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
      step: "Share",
      title: "Share a dataset that joins your sources",
      body: [
        "Join tables from different systems into a shared dataset (customers from the CRM, orders from the lake, invoices from finance) and give it to the groups that need it. A shared dataset is a governed, saved query, not a copy: it reads the sources live, and the masks of every input table travel with it as a floor that can only be raised.",
        "The receiving team queries it like any table, on the SQL page, in Excel or in Power BI, and every read is on record.",
      ],
      facts: ["Joins across sources", "Masks travel with the data", "Granted per group, with an end date"],
      href: docs.sharedDatasets,
      linkLabel: "Shared datasets",
      media: "share",
      caption: "Three sources joined into one dataset, shared with a group, masks kept.",
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
        where: "firmenbuch / public",
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
  lede: "Classifyre reads whatever the organisation runs on; the sector only decides which columns are personal and who reads them in clear.",
  columns: {
    sector: "Sector",
    data: "Typical data",
    finds: "What changes",
  },
  rows: [
    {
      sector: "Public sector · Länder · cities",
      data: "Registers, case files, statistics, procurement",
      finds: "Districts query their own rows, personal columns arrive masked, the DPO reads the log",
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
      finds: "One fingerprint across systems, worked as a case",
    },
  ],
  footnote:
    "Each row is a starting point, not a separate product: the same masks, grants and read log underneath.",
  links: [
    { label: "Immuta alternative", href: "/immuta-alternative" },
    { label: "Unity Catalog alternative", href: "/unity-catalog-alternative" },
    { label: "Read the case files", href: routes.blog + "/cases" },
  ],
} as const;

/* ── Open source and Enterprise ─────────────────────────────────────────── */

const enEditions = {
  marker: "Open source and Enterprise",
  title: "All of it is open source. Enterprise is tailored to your organisation.",
  lede: "Run it yourself or with your consultants: every feature is in the open-source repository. Keep your ETL tools, pipelines and data products as they are. Classifyre doesn't build them; it governs what they produce.",
  oss: {
    title: "Open source",
    sub: "Every feature · free forever",
    items: [
      "40+ source connectors",
      "PII and secret detection, custom detectors",
      "Column masks: redacted, last four, hashed, empty, hidden",
      "Owners, stewards, quality rules, ODCS contracts",
      "Grants per group, source and table, with end dates",
      "SQL page, exports, shared datasets",
      "PostgreSQL endpoint for Power BI, Excel, Tableau",
      "Audit of every read",
      "SSO, roles, tenants and workspaces",
      "Cases, inquiries, lineage, autopilot",
    ],
  },
  ent: {
    title: "Enterprise",
    sub: "Tailored to your organisation",
    items: [
      {
        title: "Your stack stays",
        body: "Your ETL jobs, dbt models, Spark pipelines and data products stay where they are. Classifyre reads what they produce and governs it: owners, masks, quality, access. In open source too.",
      },
      {
        title: "Shaped to how you work",
        body: "Roles mapped to your groups, an access model your data protection officer can sign, detectors and models tuned to your terminology and documents, OpenShift if that is your platform.",
      },
      {
        title: "Your team, your integrator, or us",
        body: "Roll it out yourself, with your consultants, or with our engineers. A fixed-price pilot is there if you want a head start; nobody has to wait for us.",
      },
      {
        title: "Support and SLA",
        body: "Supported releases and security patches, a named contact and published response times, for when someone has to be accountable.",
      },
    ],
  },
  ctaPilot: "Talk to us about Enterprise",
  ctaCompare: "Compare open source and Enterprise",
} as const;

/* ── Conversion ─────────────────────────────────────────────────────────── */

const enConvert = {
  marker: "Your move",
  title: "Open your data safely tonight.",
  lede: "Point it at one database you already run. By the morning you know which columns hold personal data, and your team can query the rest. Everything you set up carries over when you go to Kubernetes.",
  paths: [
    {
      label: "Tonight, on your machine",
      text: "One Docker command. Sources, masks and the read log stay local.",
    },
    {
      label: "At scale, on Kubernetes",
      text: "The same core as a Helm chart: workers scale to zero between runs.",
    },
    {
      label: "When it becomes infrastructure",
      text: "Your team or your integrator runs it. Enterprise tailors it to your organisation, adds OpenShift and an SLA. Every feature is already open source.",
    },
  ],
  ctaPrimary: "Setup & configuration",
  ctaSecondary: "Walk the live showcase",
  ctaEnterprise: "Talk to us about Enterprise",
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
      a: "Open-source data governance you run yourself. It reads the systems you already have, finds personal data and secrets in them, masks those columns automatically, and lets people query the tables with SQL, exports, Excel and Power BI. Every read is recorded: who, which table, which tool, when.",
    },
    {
      q: "Is everything really open source, including SSO and roles?",
      a: "Yes. Every feature is Apache-2.0: connectors, detection, masking, grants, row filters, the SQL endpoint, the read audit, SSO, roles, tenants and workspaces. There is no enterprise build with extra code. Enterprise is the same product tailored to your organisation, with support and an SLA; rolling it out yourself or with your integrator is always an option.",
    },
    {
      q: "Does Classifyre replace our ETL or data-product tools?",
      a: "No. Keep your ETL tools, pipelines, dbt models and data products. Classifyre doesn't build or move data: it reads what those tools produce, in place, and governs it with classification, owners, masks, quality rules and access, every read on record. That works the same in open source.",
    },
    {
      q: "How is this different from Immuta, Unity Catalog or Trino?",
      a: "Immuta is a commercial product that enforces access policies inside cloud data platforms such as Snowflake and Databricks. Unity Catalog is the governance layer of Databricks. Trino federates queries and leaves finding and masking personal data to you. Classifyre does the three jobs in one self-hosted, open-source product: it finds the personal data, masks it inside the query, and serves the result to SQL, Excel and Power BI across 40+ systems.",
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
      a: "Nowhere. Classifyre runs inside your network and keeps everything in your own PostgreSQL database and storage. Queries run where the data is. It runs offline, and AI features use only the providers you configure, including models you host yourself.",
    },
    {
      q: "Does it run on Kubernetes and OpenShift?",
      a: "The quickest start is one Docker image on macOS, Windows or Linux. The same core ships as a Helm chart for Kubernetes, where workers run as jobs that scale to zero between runs. OpenShift installation and support are part of Enterprise.",
    },
    {
      q: "Is it still an investigation tool?",
      a: "Yes, for the day something leaks. Cases, standing inquiries, fingerprints across sources and the autopilot are all still there and open source. Governance is what you run every day; the investigation is what you open when it matters.",
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
  editions: enEditions,
  convert: enConvert,
  faq: enFaq,
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
