import { docs } from "@/lib/site";

import type { TopicChrome, TopicCopy, TopicId } from "./types";

export const enChrome: TopicChrome = {
  home: "Home",
  chip: "Open-source data governance",
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
    "Four to six weeks on your data: 3 to 5 sources, detection tuned, masking on, one BI connection, and a findings and access report. Fixed scope, fixed price.",
  pilotCta: "Talk to us about a pilot",
  relatedTitle: "Related",
  faqTitle: "Questions",
  sourcesLabel: "Sources",
};

const immuta: TopicCopy = {
  id: "immuta-alternative",
  name: "Immuta alternative",
  metaTitle: "Open-Source Immuta Alternative, Self-Hosted",
  metaDescription:
    "Looking for an open-source alternative to Immuta? Classifyre finds personal data, masks it inside the query and logs every read, on your own servers.",
  keywords: [
    "Immuta alternative",
    "open source Immuta",
    "Immuta competitor",
    "data access governance open source",
    "dynamic data masking open source",
  ],
  h1: "An open-source alternative to Immuta",
  lede: "Immuta is a mature commercial product that enforces access policies inside cloud data platforms. Classifyre covers the same ground differently: open source, self-hosted, and with discovery, masking, querying and the read audit in one product.",
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
      body: "Apache-2.0, including SSO, roles and the gateway. Enterprise customers pay for implementation and support, not for features.",
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
        us: "Self-hosted only: Docker, Kubernetes, OpenShift; runs offline",
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
        us: "Free; Enterprise is services and SLA",
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
      a: "Not automatically. Most teams start from the classification, which masks personal data by default, and then grant clear reading where it is needed. An Enterprise pilot includes mapping your existing access model.",
    },
  ],
  related: ["unity-catalog-alternative"],
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
        us: "Self-hosted: Docker, Kubernetes, OpenShift; runs offline",
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
  related: ["immuta-alternative"],
};

export const enTopics: Record<TopicId, TopicCopy> = {
  "immuta-alternative": immuta,
  "unity-catalog-alternative": unity,
};
