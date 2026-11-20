import { docs } from "@/lib/site";

import type { TopicChrome, TopicCopy, TopicId } from "./types";

export const enChrome: TopicChrome = {
  home: "Home",
  chip: "Open-source data access governance",
  marks: {
    points: "How it works",
    detail: "In plain words",
    compare: "Side by side",
    notDo: "What it does not do",
    run: "Your move",
    faq: "Straight answers",
    related: "Read next",
  },
  runTitle: "Run it on your machine tonight",
  runBody:
    "One Docker image with the database, the UI and the workers in it. No signup; sign in as classifyre / classifyre. Your data stays with you.",
  runDocs: "Setup and configuration",
  pilotTitle: "Or start with a pilot",
  pilotBody:
    "Four to six weeks with one department: your directory groups and rules mapped onto 3 to 5 sources, masks and row filters on, one BI connection, and an access report your DPO can sign off. Fixed scope, fixed price.",
  pilotCta: "Talk to us about a pilot",
  relatedTitle: "Related",
  faqTitle: "Questions",
  sourcesLabel: "Sources",
};

const accessGovernance: TopicCopy = {
  id: "data-access-governance",
  name: "Data access governance",
  metaTitle: "Data Access Governance, Open Source, Self-Hosted",
  metaDescription:
    "Enforce who sees which tables, rows and columns across 40+ systems: access by group and role from your directory, masking by default, every read logged.",
  keywords: [
    "data access governance",
    "governed data access",
    "role-based access control for data",
    "row-level security across sources",
    "attribute-based access control",
    "least privilege data access",
    "self-hosted data governance",
  ],
  h1: "Data access governance: your access rules, enforced on the data",
  lede: "Data access governance decides who may see which data, and makes that decision hold wherever the data is read. Classifyre does it as one governed layer over the systems you already run: directory groups decide the tables, rows and columns each person sees, personal data stays masked until someone is cleared, and every read is on record.",
  demo: "access",
  demoCaption: "Directory groups mapped to grants on one table: rows per district, clear reading until a date.",
  mascot: "looking-at-you",
  mascotAlt: "The Classifyre investigator looking straight at you",
  pointsTitle: "How Classifyre does it",
  points: [
    {
      title: "Groups from your directory",
      body: "Entra ID, Active Directory, Okta or any OIDC or SAML provider, through the bundled identity server. Access always goes to groups, so a move in the directory moves the access at the next sign-in.",
      href: docs.directory,
      linkLabel: "Connect a company directory",
    },
    {
      title: "Rows per group",
      body: "Row filters show each group only the rows a rule selects for it, and no row without a rule. A district sees its district; the table's owner and stewards keep the rules.",
      href: docs.rowFilters,
      linkLabel: "Filtered rows",
    },
    {
      title: "Columns masked by classification",
      body: "Personal and sensitive columns are masked and secrets hidden, inside the query. Reading in clear is a grant of its own, with an end date, and workspace admins don't get it by default.",
      href: docs.masking,
      linkLabel: "Masked and hidden columns",
    },
    {
      title: "Every read on record",
      body: "Each read names the person, the table and the channel: the SQL page, an export, Power BI or Excel over a personal connection, or an AI agent over MCP reading as that person.",
      href: docs.whoMayQuery,
      linkLabel: "Who may query what",
    },
  ],
  detail: {
    title: "Why the access concept needs to reach the data",
    paragraphs: [
      "Most organisations already have an access concept: a document that says which department may see which data, and why. The data does not read documents. Each system has its own logins and roles, so the concept is enforced by hand, one ticket and one export at a time, and nobody can say afterwards who has what.",
      "Data access governance closes that gap. In Classifyre the groups and roles come from the directory you already run, the rules (grants, row filters, masks, end dates) sit next to the data, and every query passes through them: in the app, over a PostgreSQL connection from Power BI or Excel, and for AI agents. The read log is the evidence that the concept held.",
      "It supports the GDPR principles of data minimisation and accountability (Art. 5) and data protection by design (Art. 25). No software makes an organisation compliant on its own; what Classifyre changes is that the rules are enforced and the proof is written down.",
    ],
  },
  notDo: {
    title: "What Classifyre does not do",
    body: "Classifyre governs the reads that go through it. People who query a database or Databricks directly, with their own credentials, follow that system's rules, not Classifyre's. It does not replace your identity provider either: sign-in and groups stay there, and Classifyre follows them.",
  },
  faq: [
    {
      q: "What is data access governance?",
      a: "The practice of deciding who may access which data, enforcing that decision where the data is read, and being able to show afterwards who read what. It covers roles and groups, row- and column-level rules, masking, approvals and the audit trail.",
    },
    {
      q: "Is this role-based or attribute-based access control?",
      a: "Both, in practice. Access is given to roles and groups (role-based), and rules on rows and classifications on columns decide the rest (attribute-based): a row filter selects rows by their values, and a column's classification decides its mask.",
    },
    {
      q: "Do we need to rebuild our groups in Classifyre?",
      a: "No. Connect your directory to the identity server and map its groups with group mappers; changes reach Classifyre at the next sign-in. Groups that exist only for a project can be made by hand in the identity console.",
    },
  ],
  related: ["immuta-alternative", "unity-catalog-alternative"],
};

const immuta: TopicCopy = {
  id: "immuta-alternative",
  name: "Immuta alternative",
  metaTitle: "Open-Source Immuta Alternative, Self-Hosted",
  metaDescription:
    "Looking for an open-source alternative to Immuta? Classifyre enforces access by group, row and column, masks personal data inside the query and logs every read, on your own servers.",
  keywords: [
    "Immuta alternative",
    "open source Immuta",
    "Immuta competitor",
    "data access governance open source",
    "dynamic data masking open source",
  ],
  h1: "An open-source alternative to Immuta",
  lede: "Immuta is a mature commercial product that enforces access policies inside cloud data platforms. Classifyre covers the same ground differently: open source, self-hosted, and with access by group, discovery, masking, querying and the read audit in one product.",
  demo: "mask",
  demoCaption: "Classification drives the masks without a policy written.",
  mascot: "looking-at-you",
  mascotAlt: "The Classifyre investigator looking straight at you",
  pointsTitle: "Where Classifyre is different",
  points: [
    {
      title: "Discovery and masking are one step",
      body: "A column found to hold personal data is masked from the next query on. No separate policy has to be written before protection starts.",
    },
    {
      title: "The query runs in Classifyre",
      body: "Instead of pushing policies into each warehouse, Classifyre runs the query next to the data with the masks applied, and serves it to SQL, Excel and Power BI.",
    },
    {
      title: "All of it is open source",
      body: "Apache-2.0, including SSO, roles and the gateway. If you need help with implementation or support, contact us: every feature is already open source.",
    },
  ],
  detail: {
    title: "When each one fits",
    paragraphs: [
      "If your data already lives in Snowflake or Databricks and you want policies enforced natively there, Immuta is built for that and has years of integrations behind it.",
      "If your data is spread across on-premises databases, file shares and lakehouse files, if it must stay on your servers, or if procurement prefers open code, Classifyre fits better.",
    ],
  },
  comparison: {
    title: "Classifyre and Immuta side by side",
    asOf: "As of November 2026, from each vendor's public documentation.",
    columns: { aspect: "", them: "Immuta", us: "Classifyre" },
    rows: [
      {
        aspect: "Licence",
        them: "Commercial",
        us: "Apache-2.0, every feature",
      },
      {
        aspect: "Deployment",
        them: "Immuta SaaS or self-managed",
        us: "Self-hosted: Docker or Kubernetes — on-premises, your own cloud, or public cloud (AWS, Azure, Google Cloud); runs offline",
      },
      {
        aspect: "Where policies apply",
        them: "Natively inside connected platforms such as Snowflake and Databricks",
        us: "Inside Classifyre's own query jobs, next to the data",
      },
      {
        aspect: "Finding personal data",
        them: "Sensitive data discovery for connected platforms",
        us: "41 PII entities, 27 secret patterns, custom detectors, across 40+ source types including wikis, tickets and files",
      },
      {
        aspect: "BI access",
        them: "Through the governed platform",
        us: "PostgreSQL-protocol gateway with personal, expiring connections",
      },
      {
        aspect: "Pricing",
        them: "Licence",
        us: "Free and open source; support on request",
      },
    ],
    note: "Immuta's features change often; check their documentation for the current state. Corrections welcome at contact@classifyre.com.",
    sources: [
      {
        label: "Immuta: deployment options",
        href: "https://documentation.immuta.com/configure-integration/deployment-options/",
      },
      {
        label: "Classifyre: query data",
        href: docs.dataQuery,
      },
    ],
  },
  notDo: {
    title: "What Classifyre does not do",
    body: "Classifyre does not push masking policies down into Snowflake or Databricks for queries that bypass it. People who query those platforms directly are governed by the platforms' own rules.",
  },
  faq: [
    {
      q: "Can I migrate policies from Immuta?",
      a: "Not automatically. Most teams start from the classification, which masks personal data by default, and then grant clear reading where it is needed. A pilot includes mapping your existing access model.",
    },
  ],
  related: ["data-access-governance", "unity-catalog-alternative"],
};

const unity: TopicCopy = {
  id: "unity-catalog-alternative",
  name: "Unity Catalog alternative",
  metaTitle: "Unity Catalog Alternative Beyond Databricks, Open Source",
  metaDescription:
    "Govern data beyond Databricks: classification, column masks, row filters and an audit of every read across databases, lakehouses and files. Self-hosted.",
  keywords: [
    "Unity Catalog alternative",
    "open source Unity Catalog alternative",
    "data governance beyond Databricks",
    "column masking across sources",
    "lakehouse governance",
  ],
  h1: "Governance beyond Databricks: an alternative to Unity Catalog",
  lede: "Unity Catalog governs the Databricks lakehouse well. Classifyre governs everything around it too: on-premises databases, file shares, SaaS tools and lakehouse files, with the same masks whether people query in SQL, Excel or Power BI.",
  demo: "query",
  demoCaption: "A Databricks Delta table joined with an on-premises database, masks applied.",
  mascot: "looking-around",
  mascotAlt: "The Classifyre investigator glancing around",
  pointsTitle: "Where Classifyre is different",
  points: [
    {
      title: "Across systems, not one platform",
      body: "40+ source types under one set of grants, masks and audit, including the Databricks Delta tables themselves.",
    },
    {
      title: "Masks without writing functions",
      body: "Masks follow the classification: redacted, last four, hashed, empty or hidden, chosen in a dialog rather than written as SQL functions per column.",
    },
    {
      title: "Discovery included",
      body: "The personal data is found by the same product that masks it, in tables and in documents.",
    },
  ],
  detail: {
    title: "When each one fits",
    paragraphs: [
      "If your data and your users live in Databricks, Unity Catalog is the natural governance layer, and its row filters and column masks work inside Databricks compute.",
      "If your estate is wider than one platform, or must run on your own servers, Classifyre gives one governance layer across it and reads Databricks Delta tables as one source among many.",
    ],
  },
  comparison: {
    title: "Classifyre and Unity Catalog side by side",
    asOf: "As of November 2026, from each project's public documentation.",
    columns: { aspect: "", them: "Unity Catalog (Databricks)", us: "Classifyre" },
    rows: [
      {
        aspect: "Licence",
        them: "Part of the Databricks platform; an open-source Unity Catalog server (LF AI & Data) offers a subset",
        us: "Apache-2.0, every feature",
      },
      {
        aspect: "Scope",
        them: "The Databricks lakehouse and engines that use its APIs",
        us: "40+ source types: databases, lakehouses, files, SaaS tools",
      },
      {
        aspect: "Column masks",
        them: "SQL functions per column, or tag-based ABAC policies",
        us: "Chosen per column or by classification: redact, last four, hash, empty, hide",
      },
      {
        aspect: "Row filters",
        them: "SQL functions per table, or ABAC policies",
        us: "Per group, failing closed",
      },
      {
        aspect: "Finding personal data",
        them: "Data classification for Databricks tables",
        us: "Detectors across tables and documents, with scores and reasons",
      },
      {
        aspect: "Deployment",
        them: "Databricks cloud service",
        us: "Self-hosted: Docker or Kubernetes — on-premises, your own cloud, or public cloud (AWS, Azure, Google Cloud); runs offline",
      },
    ],
    note: "Databricks ships changes often; check their documentation for the current state. Corrections welcome at contact@classifyre.com.",
    sources: [
      {
        label: "Databricks: row filters and column masks",
        href: "https://docs.databricks.com/en/data-governance/unity-catalog/filters-and-masks/",
      },
      {
        label: "Databricks: open sourcing Unity Catalog",
        href: "https://www.databricks.com/blog/open-sourcing-unity-catalog",
      },
      { label: "Classifyre: lakehouse sources", href: docs.lakehouse },
    ],
  },
  notDo: {
    title: "What Classifyre does not do",
    body: "Classifyre does not enforce its masks inside Databricks compute. Notebooks and jobs that read Delta tables directly in Databricks follow Unity Catalog's rules, not Classifyre's.",
  },
  faq: [
    {
      q: "Can Classifyre read Unity Catalog tables?",
      a: "Yes. Databricks Delta tables are queryable as a source, and Iceberg catalogs including Unity Catalog's REST endpoint can be scanned.",
    },
  ],
  related: ["data-access-governance", "immuta-alternative"],
};

export const enTopics: Record<TopicId, TopicCopy> = {
  "data-access-governance": accessGovernance,
  "immuta-alternative": immuta,
  "unity-catalog-alternative": unity,
};
