import type { Locale } from "@/lib/locale";

import de from "./get-de";
import { docs } from "@/lib/site";

/**
 * /get ("Get Classifyre") copy, one typed object per locale.
 *
 * Every string that renders on the install page lives here, so the German
 * page is a translation of the English one by construction: `get-de.ts` is
 * type-checked against `GetCopy`, and a missing string fails the build
 * instead of silently falling back. Links point at shared URL constants
 * (`@/lib/site`) so the two locales cannot drift apart on destinations,
 * only on words.
 */

/* ── Types ──────────────────────────────────────────────────────────────── */

export type GetCopy = {
  hero: {
    /** Rendered as `titleLead` + an accent block with `titleHighlight`. */
    titleLead: string;
    titleHighlight: string;
    /** Prefixed with the version in the component: `v… · micro`. */
    micro: string;
    ctaDocker: string;
    ctaKubernetes: string;
  };
  /** Alt text for the hand-inked investigator drawing beside the headline. */
  mascots: {
    lookingAround: string;
  };
  quickstart: {
    marker: string;
    title: string;
    lede: string;
  };
  docker: {
    marker: string;
    title: string;
    lede: string;
    cardLabel: string;
    /** The localhost footnote: `beforeHost` + mono `host` + `afterHost` + link + `afterLink`. */
    footnote: {
      beforeHost: string;
      host: string;
      afterHost: string;
      linkLabel: string;
      afterLink: string;
    };
    includes: readonly { title: string; body: string }[];
  };
  firstRun: {
    marker: string;
    title: string;
    lede: string;
    action: { label: string; href: string };
    steps: readonly {
      step: string;
      title: string;
      body: string;
      href?: string;
      hrefLabel?: string;
    }[];
  };
  kubernetes: {
    marker: string;
    title: string;
    lede: string;
    ctaDocs: string;
    ctaChartReadme: string;
    helmLabel: string;
    helmTitle: string;
    inspectLabel: string;
    installLabel: string;
    prerequisitesLabel: string;
    prerequisites: readonly { label: string; value: string }[];
    imagesLabel: string;
    imagesValue: string;
    docsLinkLabel: string;
    docs: readonly { title: string; body: string; href: string }[];
  };
  which: {
    marker: string;
    title: string;
    lede: string;
    dockerHead: string;
    dockerPoints: readonly string[];
    kubernetesHead: string;
    kubernetesPoints: readonly string[];
    /** Where to turn for help: a contact, not a tier. */
    supportNote: string;
    supportCta: string;
  };
  closing: {
    /** Rendered as `titleLead` + an accent block with `titleHighlight`. */
    titleLead: string;
    titleHighlight: string;
    body: string;
    ctaShowcase: string;
    linkSource: string;
    linkSources: string;
    linkDocs: string;
  };
};

/* ── English ────────────────────────────────────────────────────────────── */

const enHero = {
  titleLead: "Deploy in minutes.",
  titleHighlight: "Scale on your cluster.",
  micro: "100% Apache-2.0 open source · no signup",
  ctaDocker: "Docker",
  ctaKubernetes: "Kubernetes & OpenShift",
} as const;

const enMascots = {
  lookingAround: "Classifyre deployment overview",
} as const;

const enDocker = {
  marker: "Option 01 · Docker",
  title: "Evaluate locally with Docker",
  lede: "One self-contained image for macOS, Windows, and Linux. PostgreSQL and the scan/query workers are bundled inside, so you can test Classifyre on real data in minutes.",
  cardLabel: "All-in-one container",
  footnote: {
    beforeHost: "Then open ",
    host: "localhost:3000",
    afterHost:
      ". Requires Docker and 4 GB RAM. Mounted volumes preserve your configuration across upgrades — see the ",
    linkLabel: "Docker guide",
    afterLink:
      " for environment variables, external databases, and object storage.",
  },
  includes: [
    {
      title: "Bundled PostgreSQL",
      body: "Ships with PostgreSQL tuned automatically to container memory. Point DATABASE_URL at your managed database whenever you are ready to scale.",
    },
    {
      title: "Isolated scan & query workers",
      body: "Extraction, detection, and SQL queries run in isolated short-lived workers — using the exact same engine that runs as Jobs on Kubernetes and OpenShift.",
    },
    {
      title: "Read local files in place",
      body: "Mount a local directory read-only to test classification and Parquet/CSV queries without copying data out of your environment.",
    },
    {
      title: "Everything stays on your machine",
      body: "Sources, encrypted credentials, classifications, policies, and audit logs live strictly in your local volumes.",
    },
  ],
} as const;

const enFirstRun = {
  marker: "First steps",
  title: "Four steps to governed access on your first source",
  lede: "Every step runs straight in the web UI — no hand-written config files required.",
  action: { label: "Tour the app", href: docs.inTheApp },
  steps: [
    {
      step: "01",
      title: "Start the container",
      body: "Run the Docker command and open localhost:3000. On first boot, Classifyre initialises the database, identity service, and default workspace.",
    },
    {
      step: "02",
      title: "Connect a source",
      body: "Point Classifyre at a database, Iceberg or Delta lakehouse, S3/Azure/GCS bucket, Confluence space, or local folder. Credentials are encrypted at rest.",
      href: docs.sourceConfiguration,
      hrefLabel: "Configuring sources",
    },
    {
      step: "03",
      title: "Run detectors & classify",
      body: "Enable built-in PII and secret packs or add custom regex, Python, local CPU AI extraction, or LLM detectors. Classifications drive column masking automatically.",
      href: docs.preBuiltDetectors,
      hrefLabel: "Detectors reference",
    },
    {
      step: "04",
      title: "Assign group access & query",
      body: "Grant a group access with row filters and column masks, then query live from the SQL workbench, Power BI, Excel, or ODBC — with every read logged.",
      href: docs.whoMayQuery,
      hrefLabel: "Access & masking guide",
    },
  ],
} as const;

const enKubernetes = {
  marker: "Option 02 · Kubernetes & OpenShift",
  title: "Run in production on your cluster",
  lede: "The exact same Apache-2.0 open-source core packaged as a Helm chart for Kubernetes and OpenShift: web UI, API, and stateless scan and query workers that scale to zero between runs.",
  ctaDocs: "Kubernetes & OpenShift guide",
  ctaChartReadme: "Helm chart README on GitHub",
  helmLabel: "OCI Helm chart",
  helmTitle: "Production-ready on Kubernetes & OpenShift",
  inspectLabel: "Inspect chart metadata",
  installLabel: "Install with Helm",
  prerequisitesLabel: "Prerequisites",
  prerequisites: [
    { label: "Kubernetes / OpenShift", value: "K8s ≥ 1.26 / OpenShift 4+" },
    { label: "Helm", value: "≥ 3.8" },
    { label: "Ingress / Route", value: "nginx or OpenShift Routes" },
    { label: "PostgreSQL", value: "14+ external (or embedded for demos)" },
  ],
  imagesLabel: "Container images · multi-arch",
  imagesValue: "linux/amd64 + linux/arm64",
  docsLinkLabel: "Read the docs",
  docs: [
    {
      title: "Kubernetes & OpenShift guide",
      body: "Production values files, external PostgreSQL, CloudNativePG, TLS ingress, autoscaling, and storage.",
      href: docs.kubernetes,
    },
    {
      title: "Database configuration",
      body: "Schema layout, automated migrations on upgrade, and connecting managed PostgreSQL.",
      href: docs.database,
    },
    {
      title: "Object storage",
      body: "Optional S3-compatible buckets for scan logs, exports, and governed data artifacts.",
      href: docs.storage,
    },
    {
      title: "Upgrades & versioning",
      body: "Predictable image tags aligned with chart versions and safe upgrade paths.",
      href: docs.upgrades,
    },
  ],
} as const;

const enWhich = {
  marker: "Choosing a runtime",
  title: "Start locally, move to your cluster when ready",
  lede: "Both distributions run the exact same open-source codebase and container images.",
  dockerHead: "Choose Docker when",
  dockerPoints: [
    "You are evaluating Classifyre or running a quick proof of concept.",
    "You want to test classification, masking, and Power BI/SQL locally in minutes.",
    "Everything needs to stay on a single workstation or VM.",
    "You do not want to provision external infrastructure yet.",
  ],
  kubernetesHead: "Choose Kubernetes or OpenShift when",
  kubernetesPoints: [
    "Multiple departments and teams share the platform across workspaces.",
    "Scans, quality checks, and shared datasets run continuously on a schedule.",
    "You need elastic worker scaling across large databases and lakehouses.",
    "Production security requires HA, TLS, and your existing cluster operations.",
  ],
  supportNote:
    "Every feature is open source under Apache-2.0 — SSO, roles, row filters, dynamic masking, SQL/BI gateway, and data products. If you want help tailoring Classifyre to your IAM, security architecture, custom sources, or Delta data products, talk directly with our engineers.",
  supportCta: "Support & tailored rollouts",
} as const;

const enClosing = {
  titleLead: "Test it on",
  titleHighlight: "real data.",
  body: "The clearest way to evaluate Classifyre is against a database or lakehouse you already run. Deploy the container, connect one source, and verify row filters and column masking live.",
  ctaShowcase: "Explore live demo",
  linkSource: "Source on GitHub",
  linkSources: "Supported sources",
  linkDocs: "Documentation",
} as const;

/* ── Assembled copy ─────────────────────────────────────────────────────── */

const en: GetCopy = {
  hero: enHero,
  mascots: enMascots,
  quickstart: {
    marker: "Quick start",
    title: "Two commands. Same open-source core.",
    lede: "Evaluate with one Docker container or deploy directly to Kubernetes and OpenShift with Helm.",
  },
  docker: enDocker,
  firstRun: enFirstRun,
  kubernetes: enKubernetes,
  which: enWhich,
  closing: enClosing,
};

export const getCopy: Record<Locale, GetCopy> = {
  en,
  de,
};

export function getGetCopy(locale: Locale): GetCopy {
  return getCopy[locale] ?? en;
}

export { en as englishGetCopy };
