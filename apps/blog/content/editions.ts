import type { Locale } from "@/lib/locale";

import de from "./editions-de";

/**
 * Copy for /open-source-vs-enterprise, one typed object per locale.
 *
 * `oss` / `ent` cells are either a boolean (rendered as a tick or a dash) or
 * a short string when the two editions differ by degree rather than
 * presence. Nothing in the open-source column is a teaser for a paid
 * feature, that is the entire point of the page, and the data is written
 * to make it obvious.
 */

export type EditionCell = boolean | string;

export type EditionRow = {
  capability: string;
  detail?: string;
  oss: EditionCell;
  ent: EditionCell;
};

export type EditionRowGroup = {
  group: string;
  summary: string;
  rows: EditionRow[];
};

export type EditionsCopy = {
  hero: {
    mark: string;
    titleA: string;
    titleBLead: string;
    titleBHighlight: string;
    lede: string;
    ctaPrimary: string;
    ctaSecondary: string;
  };
  editions: {
    mark: string;
    title: string;
    lede: string;
    core: {
      eyebrow: string;
      title: string;
      body: string;
      points: readonly string[];
      ctaPrimary: string;
      ctaSecondary: string;
    };
    governed: {
      eyebrow: string;
      title: string;
      body: string;
      points: readonly string[];
      ctaPrimary: string;
    };
  };
  mascots: {
    lookingAtYou: string;
    hiddenGem: string;
  };
  engagement: {
    marker: string;
    title: string;
    lede: string;
    steps: readonly { no: string; title: string; body: string }[];
  };
  comparison: {
    mark: string;
    title: string;
    lede: string;
    caption: string;
    columns: {
      capability: string;
      oss: string;
      ent: string;
    };
    included: string;
    excluded: string;
    groups: readonly EditionRowGroup[];
    workspaceNote: string;
    workspaceCta: string;
  };
  closing: {
    titleLead: string;
    titleHighlight: string;
    lede: string;
    ctaPrimary: string;
    ctaSecondary: string;
    ctaTertiary: string;
  };
};

const en: EditionsCopy = {
  hero: {
    mark: "Open source vs enterprise",
    titleA: "Same engine.",
    titleBLead: "Different",
    titleBHighlight: "room.",
    lede: "The open-source core is the whole product, not a funnel into a paid one. Enterprise sells the governance layer, tuning and people, the things a large organisation cannot self-serve.",
    ctaPrimary: "Get the core",
    ctaSecondary: "Start the conversation",
  },
  editions: {
    mark: "At a glance",
    title: "Two editions. One engine.",
    lede: "Detecting, investigating and deploying are open source in full. Enterprise adds the lock on the cabinet and the engineers who know your domain.",
    core: {
      eyebrow: "Open source · free forever",
      title: "Core",
      body: "Everything that detects, investigates and deploys. Run it on a laptop or across a cluster, for as long as you like, no seat count, no expiry.",
      points: [
        "Every connector, detector pack and custom-detector tier",
        "Inquiries, fingerprints, cases and the AI autopilot",
        "The Docker image and the Helm chart, both fully featured",
        "Workspace isolation is in the core and always on",
      ],
      ctaPrimary: "Get it",
      ctaSecondary: "Read the source",
    },
    governed: {
      eyebrow: "Enterprise · a partnership",
      title: "Governed",
      body: "The core plus the lock on the cabinet, and engineers who learn your domain. Our people work with your team from the first pilot instead of handing over a licence key.",
      points: [
        "SSO, roles and per-workspace authorization",
        "Models tuned on your terminology and your languages",
        "Detectors and sources built for your industry's data",
        "Architecture reviews, OpenShift, SLA-backed support",
      ],
      ctaPrimary: "Start the conversation",
    },
  },
  mascots: {
    lookingAtYou:
      "The Classifyre investigator looking straight at you",
    hiddenGem:
      "The Classifyre investigator holding a magnifying glass over a hidden gem",
  },
  engagement: {
    marker: "How we work",
    title: "A partnership, not a licence key.",
    lede: "Our engineers work with your team from the first pilot. We learn how your business names things and tune Classifyre to how your company actually works.",
    steps: [
      {
        no: "01",
        title: "Pilot",
        body: "We pick one real investigation together and run it on your data, inside your estate.",
      },
      {
        no: "02",
        title: "Architecture review",
        body: "Your cluster, your identity provider, your database. The deployment is reviewed before it becomes infrastructure.",
      },
      {
        no: "03",
        title: "Tuned detection",
        body: "Models and detectors tuned on your terminology and your industry's data, built by our engineers together with yours.",
      },
      {
        no: "04",
        title: "Rollout and support",
        body: "Upgrade assistance, OpenShift, SLA-backed support and named engineers who know your cases.",
      },
    ],
  },
  comparison: {
    mark: "Line by line",
    title: "The whole comparison",
    lede: "Four of the five groups below are identical between editions.",
    caption:
      "Feature comparison between the Classifyre open-source core and the enterprise edition",
    columns: {
      capability: "Capability",
      oss: "Open source",
      ent: "Enterprise",
    },
    included: "Included",
    excluded: "Not included",
    groups: [
      {
        group: "Detection",
        summary: "Identical. The engine is the open-source project.",
        rows: [
          {
            capability: "Every source connector",
            detail: "Databases, lakehouses, collaboration tools, storage, streams",
            oss: true,
            ent: true,
          },
          {
            capability: "Built-in detector packs",
            detail: "PII, secrets, code security, threats, content quality",
            oss: true,
            ent: true,
          },
          {
            capability: "Custom detectors",
            detail: "Regex, entity classification, Hugging Face models, any LLM",
            oss: true,
            ent: "Built with you",
          },
          {
            capability: "Semantic ranking",
            detail: "Importance 0–1 with written reasons, not just severity",
            oss: true,
            ent: "Calibrated to your corpus",
          },
          {
            capability: "Detection tuned to your terminology",
            detail: "Models trained so a term means what it means at your company",
            oss: false,
            ent: true,
          },
          {
            capability: "Multilanguage detection tuning",
            oss: false,
            ent: true,
          },
        ],
      },
      {
        group: "Investigation",
        summary: "Identical. Cases are the product, in both editions.",
        rows: [
          {
            capability: "Findings, inquiries and fingerprints",
            oss: true,
            ent: true,
          },
          {
            capability: "Cases, hypotheses and evidence trails",
            oss: true,
            ent: true,
          },
          {
            capability: "AI investigation autopilot",
            detail: "Five agents working the investigation between scans",
            oss: true,
            ent: "Tuned to your workflows",
          },
          {
            capability: "In-app assistant and MCP server",
            detail: "Drive the whole product from your own AI client",
            oss: true,
            ent: true,
          },
          { capability: "Notifications and data export", oss: true, ent: true },
        ],
      },
      {
        group: "Deployment",
        summary: "Identical. No runtime is held back.",
        rows: [
          {
            capability: "All-in-one Docker image",
            detail: "macOS, Windows, Linux; PostgreSQL inside",
            oss: true,
            ent: true,
          },
          {
            capability: "Helm chart on Kubernetes",
            detail: "Scales as far as the estate demands",
            oss: true,
            ent: true,
          },
          {
            capability: "Workspace isolation",
            detail: "Own schema, evidence, AI memory and endpoint per workspace",
            oss: true,
            ent: true,
          },
          {
            capability: "OpenShift",
            detail: "With upgrade assistance from our engineers",
            oss: false,
            ent: true,
          },
        ],
      },
      {
        group: "Governance",
        summary: "The real difference: the lock on the cabinet.",
        rows: [
          { capability: "Single sign-on (SSO)", oss: false, ent: true },
          { capability: "Roles and permissions", oss: false, ent: true },
          {
            capability: "Per-workspace authorization",
            detail: "An auditor opens the audit workspace and nothing else",
            oss: false,
            ent: true,
          },
        ],
      },
      {
        group: "People",
        summary: "What you get besides software.",
        rows: [
          {
            capability: "Support",
            oss: "GitHub issues",
            ent: "SLA-backed, named engineers",
          },
          {
            capability: "Onboarding",
            oss: "Docs and the showcase",
            ent: "Guided pilot, architecture review",
          },
          {
            capability: "Roadmap influence",
            oss: "Open issues and PRs",
            ent: "Direct, on your industry's data",
          },
          { capability: "Price", oss: "Free, forever", ent: "Talk to us" },
        ],
      },
    ],
    workspaceNote:
      "Workspace isolation lives in the open-source core and is always on; a workspace has its own database schema, evidence, AI memory and endpoint. Enterprise does not add the wall; it adds the authorization that decides who may open which drawer.",
    workspaceCta: "How workspaces work",
  },
  closing: {
    titleLead: "Start free.",
    titleHighlight: "Call us later.",
    lede: "Almost everyone starts on the open-source core and stays there. The conversation is worth having when SSO, roles and a tuned model start mattering more than the scan itself.",
    ctaPrimary: "Get the free core",
    ctaSecondary: "Talk about enterprise",
    ctaTertiary: "Or poke at the live showcase first",
  },
};

export const editionsCopy: Record<Locale, EditionsCopy> = {
  en,
  de,
};

export function getEditionsCopy(locale: Locale): EditionsCopy {
  return editionsCopy[locale] ?? en;
}

export { en as englishEditionsCopy };
