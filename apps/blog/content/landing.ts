import type { Locale } from "@/lib/locale";

import de from "./landing-de";
import {
  docs,
  routes,
} from "@/lib/site";

/**
 * Landing-page copy, one typed object per locale.
 *
 * Every string that renders on the marketing landing page lives here, so the
 * German page is a translation of the English one by construction: `de` is
 * type-checked against `LandingCopy`, and a missing string fails the build
 * instead of silently falling back. Links point at shared URL constants
 * (`@/lib/site`) so the two locales cannot drift apart on destinations,
 * only on words.
 */

/* ── Hero ───────────────────────────────────────────────────────────────── */

const enHero = {
  /** Small stamps above the headline. */
  chips: ["Open-source investigation platform"],
  titleA: "Follow the evidence.",
  /** Rendered as `titleBLead` + an accent block with `titleBHighlight`. */
  titleBLead: "Close the",
  titleBHighlight: "case.",
  lede: "Classifyre reads the systems you already run, finds the signals you define, then follows them across sources, like a detective, with an AI autopilot doing the legwork between scans.",
  ctaPrimary: "Run it on your machine",
  ctaSecondary: "Walk the live showcase",
  micro: "No signup. One Docker command. Your data stays with you.",
  /** The pinned case file beside the headline. */
  exhibit: {
    tab: "Case file · 042",
    stamp: "Case open",
    subject: "Exhibit A: the investigator",
    status: "On duty",
  },
} as const;

/** Alt text for the hand-inked investigator drawings. */
const enMascots = {
  questioning:
    "The Classifyre investigator in a trench coat, scratching his head over an unanswerable question mark",
  lookingAround:
    "The Classifyre investigator glancing around, searching for the trail",
  lookingAtYou:
    "The Classifyre investigator looking straight at you",
  hiddenGem:
    "The Classifyre investigator holding a magnifying glass over a hidden gem",
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
    "Ephemeral scan workers scale to zero between runs and fan out as far as your estate goes. Your cluster, your data.",
  helmCtaDocs: "Helm chart docs",
  helmCtaRepo: "Chart README on GitHub",
} as const;

/* ── Problem / tension ──────────────────────────────────────────────────── */

const enTension = {
  marker: "The problem",
  title: "Every system holds a fact. None of them holds the story.",
  lede: "A shipment went to the wrong address. The ERP knows the order, the support tool knows the complaint, the invoice run knows the money. On its own each is noise. Together they are a case, and today nobody can put them together.",
  /** Margin notes: the three ways the story stays buried. */
  notes: [
    {
      label: "Field note 01",
      title: "Exports don't add up",
      body: "Rows lose their joins the moment they leave the database. Six CSVs later the relationships are gone and every question starts the review from zero.",
    },
    {
      label: "Field note 02",
      title: "Findings tables dead-end",
      body: "A scanner lists 4,000 secrets and stops. Sorting them is still your job, and every rescan quietly adds a few hundred more.",
    },
    {
      label: "Field note 03",
      title: "Nobody can say how they knew",
      body: "When a regulator, a court or a CFO asks what you knew and when, “the model said so” is not an answer. Evidence without lineage is a rumour.",
    },
  ],
  kicker:
    "It is the same shape every time: someone inside the company leaking a spreadsheet to help it, a counterparty three shell companies deep, a fraud pattern spread across five record systems. Scattered facts. One story.",
  figureCaption:
    "Fig. 01: six systems, one story, no line between the facts",
} as const;

/* ── Method / solution ──────────────────────────────────────────────────── */

const enMethod = {
  marker: "The method",
  title: "One thread through every system.",
  lede: "Classifyre is less a business-intelligence tool than an operational data layer: it connects the systems you already run, models the real-world entities and relationships inside them, and keeps one thread from the first hit to the closed case.",
  stages: [
    {
      no: "01",
      word: "Read",
      title: "Read the systems you already run",
      body: "Databases, lakehouses, collaboration tools, storage, streams and public registers. Scans ingest assets on a schedule and everything found lands in one evidence stream.",
      href: "/sources/",
      linkLabel: "Browse the source catalogue",
    },
    {
      no: "02",
      word: "Signal",
      title: "Define what matters, in your own words",
      body: "Regex and rules for the deterministic things, entity classification with your labels, any Hugging Face model, or a prompt that becomes a detector. Built-in packs cover PII, secrets, code security and content quality from the first scan.",
      href: docs.detectors,
      linkLabel: "See the detector packs",
    },
    {
      no: "03",
      word: "Follow",
      title: "Follow it across sources",
      body: "Fingerprints tie the same fact together wherever it appears. Near-duplicates arrive grouped by cause, and lineage keeps the thread intact from the first hit to the last.",
      href: docs.duplicates,
      linkLabel: "How fingerprints and duplicates work",
    },
    {
      no: "04",
      word: "File",
      title: "Turn findings into a case",
      body: "Standing inquiries keep matching fresh evidence. Findings are ranked 0–1 with written reasons. A case collects the evidence, the competing hypotheses, an owner and an audit trail you can hand over.",
      href: docs.cases,
      linkLabel: "How cases work",
    },
    {
      no: "05",
      word: "Work",
      title: "Let the autopilot do the legwork",
      body: "Between scans, five agents wake in sequence: matching inquiries, opening cases, waking dead sources, drafting the detector you were missing, consolidating memory. Flip observe-only and everything stays a proposal.",
      href: docs.autopilot,
      linkLabel: "How the autopilot works",
    },
  ],
} as const;

/* ── Interactive demo ───────────────────────────────────────────────────── */

const enDemo = {
  marker: "Open the file",
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
  title: "The files look different. The method is the same.",
  lede: "Classifyre reads whatever the operation runs on; the sector only decides which signals you define first.",
  columns: {
    sector: "Sector",
    data: "Typical data",
    finds: "What gets followed",
  },
  rows: [
    {
      sector: "Finance · KYC · AML",
      data: "Customer master, transactions, sanctions, account networks",
      finds: "Layered counterparties, a sanctioned name resurfacing under a new one",
    },
    {
      sector: "Healthcare operations",
      data: "Admissions, transfers, theatre schedules, staffing, inventory",
      finds: "Capacity leaks, waitlist patterns, inventory drift",
    },
    {
      sector: "Energy · utilities",
      data: "SCADA, sensors, GIS, maintenance, market data",
      finds: "Sensor drift before failure, silent outages, contract anomalies",
    },
    {
      sector: "Supply chain · logistics",
      data: "ERP orders, inventory, shipments, supplier records",
      finds: "Shipments to the wrong address, ghost inventory, supplier overlap",
    },
    {
      sector: "Transportation",
      data: "Maintenance logs, engineering records, ground operations",
      finds: "Deferred defects, parts provenance, unlogged work",
    },
    {
      sector: "Telecommunications",
      data: "Network topology, telemetry, incidents, field work",
      finds: "Route abuse, SLA breaches before the complaints arrive",
    },
    {
      sector: "Retail · POS · SKU",
      data: "Sales, promotions, inventory, returns, competitor prices",
      finds: "Shrink, promotion abuse, return fraud",
    },
    {
      sector: "Law enforcement · civil investigation",
      data: "Case records, persons and entities, financial and travel records",
      finds: "One entity under three names, one thread across five record systems",
    },
    {
      sector: "Government · public sector",
      data: "Procurement, registers, correspondence, grants",
      finds: "Undeclared interests, tender patterns, leaked documents",
    },
    {
      sector: "Internal audit · compliance",
      data: "Access logs, contracts, expenses, communications",
      finds: "The leak, the conflict of interest, the control that stopped working",
    },
  ],
  footnote:
    "Sector data shapes from the published case literature of operational data platforms; outcome figures cited in the category context above are Palantir's published results, used to describe the market, not to claim Classifyre's.",
} as const;

/* ── Conversion ─────────────────────────────────────────────────────────── */

const enConvert = {
  marker: "Your move",
  title: "Open your first case tonight.",
  lede: "Point it at one system you already run and see what the investigator finds. Everything you build carries over when you go remote with Helm.",
  paths: [
    {
      label: "Tonight, on your machine",
      text: "One Docker command. Sources, findings and cases stay local.",
    },
    {
      label: "At scale, on Kubernetes",
      text: "The same core as a Helm chart: scan workers scale to zero between runs.",
    },
    {
      label: "When it becomes infrastructure",
      text: "Enterprise adds SSO, roles, per-workspace authorization, tuned models and our engineers. Until then, this is all you need.",
    },
  ],
  ctaPrimary: "Setup & configuration",
  ctaSecondary: "Walk the live showcase",
  ctaEnterprise: "Talk to us about enterprise",
  ctaBlog: "Read the field notes",
} as const;

/* ── FAQ ────────────────────────────────────────────────────────────────── */

const enFaq = {
  marker: "Straight answers",
  title: "Questions people actually ask.",
  lede: "",
  items: [
    {
      q: "What is an investigation platform?",
      a: "It is the layer between the systems you run and a decision you have to defend. Classifyre reads those systems, finds the signals you define, follows them across sources, and turns the evidence into cases with hypotheses, owners and an audit trail, instead of leaving you with a findings table and good luck.",
    },
    {
      q: "Is Classifyre really free and open source?",
      a: "The open-source core is free to run and free to read: source connectors, detector packs, custom detection, ranking, duplicates, cases and the AI autopilot are all in it. The enterprise edition adds governance and services: SSO, roles, per-workspace authorization, detection tuned to your terminology, and our engineers for rollout and support.",
    },
    {
      q: "How is Classifyre different from Palantir Foundry or Gotham?",
      a: "It is the same category of product: an operational data layer over fragmented source systems, with cases and AI on top. Palantir proved the category at scale, closed. Classifyre is open source, self-hosted, made in the EU, and sized so a team can start without a programme office.",
    },
    {
      q: "Which data sources can it read?",
      a: "Operational databases, lakehouses, collaboration tools, object storage, streams and public content; each connector is a documented source type, and the catalogue grows in the open. If a source is missing, custom sources are supported and the enterprise team builds them with you.",
    },
    {
      q: "Does it run on Kubernetes?",
      a: "Yes. The quickest start is a single all-in-one Docker image that runs on macOS, Windows and Linux; the same core ships as a Helm chart, where scan workers run as ephemeral jobs that scale to zero between runs. Everything you build locally carries over.",
    },
    {
      q: "Where does my data go? Does anything leave our infrastructure?",
      a: "Nowhere. Classifyre runs inside your estate and stores everything in your own PostgreSQL database and storage. AI features run against providers you configure (including models you host yourself) and the autopilot can be switched to observe-only.",
    },
    {
      q: "What does the enterprise edition add?",
      a: "Governance first: SSO, roles and per-workspace authorization, so one instance can serve several teams or cases without crossover. Then detection tuned to your terminology, custom detectors and sources for your industry's data, multilanguage tuning, architecture reviews, upgrade assistance and SLA-backed support.",
    },
    {
      q: "Do I need data scientists to use it?",
      a: "No. Built-in detector packs work on the first scan, custom detection starts at regex, and the autopilot drafts detectors for you. Data engineers and scientists get depth (schemas, models, an MCP endpoint to drive the whole product from their own AI client) without that being the entry fee.",
    },
  ],
} as const;

/* ── Assembled copy ─────────────────────────────────────────────────────── */

export const en = {
  hero: enHero,
  mascots: enMascots,
  install: enInstall,
  tension: enTension,
  method: enMethod,
  demo: enDemo,
  sectors: enSectors,
  convert: enConvert,
  faq: enFaq,
} as const;

export type LandingCopy = {
  hero: {
    chips: readonly string[];
    titleA: string;
    titleBLead: string;
    titleBHighlight: string;
    lede: string;
    ctaPrimary: string;
    ctaSecondary: string;
    micro: string;
    exhibit: {
      tab: string;
      stamp: string;
      subject: string;
      status: string;
    };
  };
  mascots: {
    questioning: string;
    lookingAround: string;
    lookingAtYou: string;
    hiddenGem: string;
  };
  install: {
    marker: string;
    title: string;
    lede: string;
    dockerLabel: string;
    dockerTitle: string;
    dockerCta: string;
    helmLabel: string;
    helmTitle: string;
    helmCopy: string;
    helmCtaDocs: string;
    helmCtaRepo: string;
  };
  tension: {
    marker: string;
    title: string;
    lede: string;
    notes: readonly { label: string; title: string; body: string }[];
    kicker: string;
    figureCaption?: string;
  };
  method: {
    marker: string;
    title: string;
    lede: string;
    stages: readonly {
      no: string;
      word: string;
      title: string;
      body: string;
      href: string;
      linkLabel: string;
    }[];
  };
  demo: {
    marker: string;
    title: string;
    tabs: {
      caseBoard: string;
      queue: string;
      autopilot: string;
    };
    caseBoard: {
      label: string;
      figcaption: string;
      exhibits: readonly { tag: string; text: string }[];
    };
    queue: {
      label: string;
      columns: {
        finding: string;
        where: string;
        score: string;
        reason: string;
      };
      rows: readonly {
        finding: string;
        where: string;
        score: string;
        reason: string;
      }[];
      footnote: string;
    };
    autopilot: {
      label: string;
      rows: readonly { time: string; agent: string; text: string }[];
      footnote: string;
    };
    cta: string;
  };
  sectors: {
    marker: string;
    title: string;
    lede: string;
    columns: {
      sector: string;
      data: string;
      finds: string;
    };
    rows: readonly {
      sector: string;
      data: string;
      finds: string;
    }[];
    footnote: string;
  };
  convert: {
    marker: string;
    title: string;
    lede: string;
    paths: readonly { label: string; text: string }[];
    ctaPrimary: string;
    ctaSecondary: string;
    ctaEnterprise: string;
    ctaBlog: string;
  };
  faq: {
    marker: string;
    title: string;
    lede: string;
    items: readonly { q: string; a: string }[];
  };
};

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
