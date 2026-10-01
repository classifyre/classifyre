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
    /** The memo block: the enterprise layer, said out loud. */
    enterpriseNote: string;
    enterpriseCta: string;
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
  titleLead: "Get it running",
  titleHighlight: "tonight.",
  micro: "free · no signup",
  ctaDocker: "Docker",
  ctaKubernetes: "Kubernetes",
} as const;

const enMascots = {
  lookingAround:
    "The Classifyre investigator glancing around, searching for the trail",
} as const;

const enDocker = {
  marker: "Option 01 · Docker",
  title: "Run it on your machine",
  lede: "One image, the same on macOS, Windows and Linux. The database and the scan workers are already inside, so there is nothing to provision and nothing to connect.",
  cardLabel: "Run it",
  footnote: {
    beforeHost: "Then open ",
    host: "localhost:3000",
    afterHost:
      ". Needs Docker and 4 GB of memory. Those volumes are what keep your work across an upgrade: the ",
    linkLabel: "Docker guide",
    afterLink:
      " covers the environment variables, external databases and object storage.",
  },
  includes: [
    {
      title: "PostgreSQL, inside",
      body: "The database ships in the image, tuned at startup to the memory you gave the container. Point DATABASE_URL at your own server when you outgrow it.",
    },
    {
      title: "Scan workers, sandboxed",
      body: "Extraction and detection run as separate processes that exit with the scan, the same code the cluster runs as Kubernetes Jobs.",
    },
    {
      title: "Mount a folder, scan it",
      body: "Bind-mount a directory read-only and point a source at it. Nothing is copied out; the files are read where they sit.",
    },
    {
      title: "Everything stays put",
      body: "Sources, credentials, findings, and cases live in volumes on your disk. Nothing is uploaded to us.",
    },
  ],
} as const;

const enFirstRun = {
  marker: "First run",
  title: "Four steps to your first finding",
  lede: "Nothing here needs a config file. Every step is in the app, and each one has a page on the docs site when you want the detail.",
  action: { label: "Tour the app", href: docs.inTheApp },
  steps: [
    {
      step: "01",
      title: "Run the image",
      body: "One command, then open localhost:3000. The first boot initialises the database and creates a workspace; give it a few minutes on a laptop.",
    },
    {
      step: "02",
      title: "Connect a source",
      body: "Point it at something you already run: a database, an S3 bucket, a Confluence space, or just a local folder. Credentials are encrypted at rest.",
      href: docs.sourceConfiguration,
      hrefLabel: "Configuring sources",
    },
    {
      step: "03",
      title: "Switch on detectors",
      body: "Enable the built-in packs you care about: PII, secrets, security, moderation, quality. They work on the first scan with no model setup.",
      href: docs.preBuiltDetectors,
      hrefLabel: "Pre-built detectors",
    },
    {
      step: "04",
      title: "Run a scan, open a case",
      body: "Findings land ranked by importance. Group them into inquiries and cases, or add an AI provider and let the autopilot work them between scans.",
      href: docs.aiProviders,
      hrefLabel: "AI providers",
    },
  ],
} as const;

const enKubernetes = {
  marker: "Option 02 · Kubernetes",
  title: "Or scale it on your cluster",
  lede: "The same open-source core as a Helm chart: web, API, worker, and ephemeral scan Jobs that fan out under load and scale to zero between runs.",
  ctaDocs: "Full deployment guide",
  ctaChartReadme: "Chart README on GitHub",
  helmLabel: "No repo add step",
  helmTitle: "Helm, OCI-native",
  inspectLabel: "Inspect before installing",
  installLabel: "Install",
  prerequisitesLabel: "Prerequisites",
  prerequisites: [
    { label: "Kubernetes", value: "≥ 1.26" },
    { label: "Helm", value: "≥ 3.8 (OCI native)" },
    { label: "Ingress", value: "nginx by default" },
    { label: "PostgreSQL", value: "14+ external, or embedded for demos" },
  ],
  imagesLabel: "Images · multi-arch",
  imagesValue: "linux/amd64 + linux/arm64",
  docsLinkLabel: "Read the docs",
  docs: [
    {
      title: "Kubernetes deployment guide",
      body: "Values files for k3s, an external database, and CloudNativePG; ingress, TLS, scaling, and storage.",
      href: docs.kubernetes,
    },
    {
      title: "Database",
      body: "Schema layout, migrations on upgrade, and connecting managed PostgreSQL.",
      href: docs.database,
    },
    {
      title: "Object storage",
      body: "Optional buckets for scan logs and uploaded artifacts.",
      href: docs.storage,
    },
    {
      title: "Upgrades & versioning",
      body: "How image tags track the chart appVersion, and what a version bump implies.",
      href: docs.upgrades,
    },
  ],
} as const;

const enWhich = {
  marker: "Not sure which",
  title: "Pick by where the data has to stay",
  lede: "Both runtimes carry the same features, and a namespace export moves your work from one to the other, so this is not a decision you are locked into.",
  dockerHead: "Choose Docker when",
  dockerPoints: [
    "You are evaluating, or you investigate alone.",
    "The corpus is on your machine or reachable from it.",
    "Nothing may leave the laptop.",
    "You want to be scanning within ten minutes.",
  ],
  kubernetesHead: "Choose Kubernetes when",
  kubernetesPoints: [
    "A team shares the instance, split into workspaces.",
    "Scans need to run on a schedule, unattended.",
    "The estate is large enough to need workers fanning out.",
    "It has to sit inside your existing cluster and network.",
  ],
  enterpriseNote:
    "Wondering what the enterprise layer adds on top of either runtime? It is SSO, roles, and per-workspace authorization, not features held back from the open-source core.",
  enterpriseCta: "Open source vs Enterprise",
} as const;

const enClosing = {
  titleLead: "Point it at something",
  titleHighlight: "real.",
  body: "The fastest honest test is a system you already run. Install it, connect one source, and see what the investigator turns up.",
  ctaShowcase: "Try the live showcase",
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
    title: "Two commands. Two ways to run it.",
    lede: "One Docker image tonight, the same core as a Helm chart when the estate grows. The details and requirements are below.",
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
