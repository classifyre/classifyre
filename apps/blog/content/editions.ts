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
  extras: {
    title: string;
    lede: string;
    items: readonly { title: string; body: string }[];
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
    mark: "Open source and Enterprise",
    titleA: "Same engine.",
    titleBLead: "Different",
    titleBHighlight: "room.",
    lede: "Every feature is open source, including SSO, roles and masking. Run it yourself or with your integrator. Enterprise is the same product tailored to your organisation, with support and an SLA behind it.",
    ctaPrimary: "Get Classifyre",
    ctaSecondary: "Book a pilot call",
  },
  editions: {
    mark: "At a glance",
    title: "One product. Two ways to run it.",
    lede: "The open-source repository is the whole product. Keep your ETL tools, pipelines and data products; Classifyre governs what they produce, in either edition. Enterprise adds tailoring and someone accountable, never a feature behind a licence key.",
    core: {
      eyebrow: "Open source, free forever",
      title: "Open source",
      body: "Every connector, detector, mask, grant and log line, under Apache-2.0. Run it on a laptop or across a cluster, for as long as you like, with no seat count and no expiry.",
      points: [
        "PII and secret discovery across 40+ source types",
        "Column masks, grants, row filters and access requests",
        "SQL, exports and a PostgreSQL endpoint for Power BI and Excel",
        "SSO, roles, tenants, workspaces and the audit of every read",
      ],
      ctaPrimary: "Get it",
      ctaSecondary: "Read the source",
    },
    governed: {
      eyebrow: "Enterprise, tailored to your organisation",
      title: "Enterprise",
      body: "The same code, shaped to how your organisation works: your identity provider and groups, your access model, your terminology and models. Rolled out by your team, your integrator or ours, and supported when it matters.",
      points: [
        "Your ETL and data products stay; Classifyre governs what they produce",
        "Governance tailored to your organisation",
        "Detection models tuned to your data, on your hardware",
        "OpenShift support and an SLA",
      ],
      ctaPrimary: "Book a pilot call",
    },
  },
  mascots: {
    lookingAtYou: "The Classifyre investigator looking straight at you",
    hiddenGem:
      "The Classifyre investigator holding a magnifying glass over a hidden gem",
  },
  engagement: {
    marker: "What you can buy",
    title: "Pilot, rollout support, subscription.",
    lede: "You don't need us to run it: many teams roll it out alone or with their integrator. When you want help, it is priced per environment, not per seat: self-service is the point, so more readers should never cost more.",
    steps: [
      {
        no: "01",
        title: "Pilot",
        body: "4 to 6 weeks, fixed scope, fixed price. One workspace, 3 to 5 sources, detection tuned on your data, masking on, one BI connection, and a findings and access report.",
      },
      {
        no: "02",
        title: "Rollout support",
        body: "For your team or your integrator, as much or as little as you need: SSO and group mapping (Entra ID, Keycloak, LDAP), the access model, connectors and network, Kubernetes or OpenShift install, training for admins and stewards.",
      },
      {
        no: "03",
        title: "Subscription with SLA",
        body: "Supported releases and security patches, published business-hours response times, a named engineer, upgrade help, a quarterly health check and a say in the roadmap.",
      },
      {
        no: "04",
        title: "Tailoring",
        body: "Detectors and models for your terminology and German-language documents, Austrian identifiers, industry sources, custom masks, investigation cases and reports for your auditors.",
      },
    ],
  },
  comparison: {
    mark: "Line by line",
    title: "The whole comparison",
    lede: "Every feature row is ticked on both sides. The difference is people.",
    caption:
      "Comparison between Classifyre open source and Classifyre Enterprise",
    columns: {
      capability: "Capability",
      oss: "Open source",
      ent: "Enterprise",
    },
    included: "Included",
    excluded: "Not included",
    groups: [
      {
        group: "Discovery",
        summary: "Identical. The engine is the open-source project.",
        rows: [
          {
            capability: "Every source connector",
            detail: "Databases, lakehouses, collaboration tools, storage, streams",
            oss: true,
            ent: true,
          },
          {
            capability: "PII and secret detectors",
            detail: "41 PII entities, including EU identifiers; 27 secret patterns",
            oss: true,
            ent: true,
          },
          {
            capability: "Custom detectors",
            detail: "Regex, entity models, Hugging Face models, any LLM",
            oss: true,
            ent: "Built with you",
          },
          {
            capability: "Models tuned to your terminology",
            detail: "Deployed on your hardware, for your languages and documents",
            oss: false,
            ent: true,
          },
        ],
      },
      {
        group: "Protection and access",
        summary: "Identical. Governance is in the core, not behind a key.",
        rows: [
          {
            capability: "Column masks",
            detail: "Redacted, last four, hashed, empty, hidden; masked by default",
            oss: true,
            ent: true,
          },
          {
            capability: "Grants, row filters and access requests",
            detail: "Per group, source and table, with end dates",
            oss: true,
            ent: true,
          },
          { capability: "Single sign-on (SSO) and roles", oss: true, ent: true },
          {
            capability: "Tenants and per-workspace authorization",
            oss: true,
            ent: true,
          },
          {
            capability: "Audit of every read",
            detail: "Who, which table, which tool, when",
            oss: true,
            ent: "Connected to your SIEM",
          },
          {
            capability: "Governance blueprint",
            detail: "A written access model your DPO can sign",
            oss: false,
            ent: true,
          },
        ],
      },
      {
        group: "Use",
        summary: "Identical.",
        rows: [
          { capability: "SQL page, exports, shared datasets", oss: true, ent: true },
          {
            capability: "PostgreSQL endpoint",
            detail: "Power BI, Excel, Tableau, DBeaver",
            oss: true,
            ent: true,
          },
          {
            capability: "Cases, inquiries, lineage and autopilot",
            oss: true,
            ent: "Cases built for your incidents",
          },
          { capability: "MCP endpoint for AI agents", oss: true, ent: true },
        ],
      },
      {
        group: "Deployment",
        summary: "No runtime is held back; OpenShift comes with us.",
        rows: [
          {
            capability: "All-in-one Docker image",
            detail: "macOS, Windows, Linux; PostgreSQL inside",
            oss: true,
            ent: true,
          },
          { capability: "Helm chart on Kubernetes", oss: true, ent: true },
          {
            capability: "OpenShift",
            detail: "Installation and support by our engineers",
            oss: false,
            ent: true,
          },
        ],
      },
      {
        group: "People",
        summary: "What you pay for.",
        rows: [
          {
            capability: "Support",
            oss: "GitHub issues",
            ent: "SLA, named engineer",
          },
          {
            capability: "Onboarding",
            oss: "Docs and the showcase",
            ent: "Pilot and implementation",
          },
          {
            capability: "Roadmap influence",
            oss: "Open issues and pull requests",
            ent: "A seat at the table",
          },
          {
            capability: "Price",
            oss: "Free, forever",
            ent: "Per environment, not per seat",
          },
        ],
      },
    ],
    workspaceNote:
      "SSO, roles, tenants and per-workspace authorization used to be enterprise features. They are open source now, because a governance tool whose access control is a paid add-on is not one you can trust in procurement.",
    workspaceCta: "Roles in the docs",
  },
  extras: {
    title: "For larger estates",
    lede: "What public bodies, banks and hospitals usually ask for next. Each is part of a subscription or a fixed-price work package.",
    items: [
      {
        title: "Audit log to your SIEM",
        body: "Every read and every change delivered to Splunk, Elastic or Sentinel.",
      },
      {
        title: "Long-term support releases",
        body: "A release line with backported security fixes, for change windows measured in quarters.",
      },
      {
        title: "Air-gapped installation",
        body: "Signed images, a software bill of materials and an offline bundle for networks without internet.",
      },
      {
        title: "Compliance documentation",
        body: "Records of processing, privacy-by-design evidence and control mappings your auditors can use. Documentation, not a certificate.",
      },
      {
        title: "Procurement-ready contracts",
        body: "A pilot sized for direct award, standard public-sector contract templates, and an integrator as prime contractor where needed.",
      },
      {
        title: "Training",
        body: "For admins, stewards and data protection officers: who decides what, and how to read the log.",
      },
    ],
  },
  closing: {
    titleLead: "Start free.",
    titleHighlight: "Call us for the rest.",
    lede: "Most teams start on the open-source image and run it themselves or with their integrator. Talk to us when you want it tailored to your organisation, or someone accountable behind it.",
    ctaPrimary: "Get Classifyre",
    ctaSecondary: "Book a pilot call",
    ctaTertiary: "Or walk the live showcase first",
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
