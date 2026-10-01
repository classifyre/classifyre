import type { Locale } from "@/lib/locale";

import de from "./sources-de";
import { docs } from "@/lib/site";

/**
 * /sources copy, one typed object per locale.
 *
 * Every string that renders on the sources page lives here, so the German
 * page is a translation of the English one by construction: `sources-de.ts`
 * is type-checked against `SourcesCopy`, and a missing string fails the
 * build instead of silently falling back. Links point at shared URL
 * constants (`@/lib/site`) so the two locales cannot drift apart on
 * destinations, only on words. Connector counts are never written down
 * here: they are derived from the schema at render time, and `{count}` in
 * a string is substituted by the component.
 */

/* ── Types ──────────────────────────────────────────────────────────── */

export type SourcesCopy = {
  hero: {
    /** Exhibit chip naming the exhibit. */
    mark: string;
    /**
     * Display headline: `titleA` on the first line, then `titleBLead`
     * followed by an accent block with `titleBHighlight`.
     */
    titleA: string;
    titleBLead: string;
    titleBHighlight: string;
    /** Lede: the live count plus `lede.count` is rendered bold, then `lede.tail`. */
    lede: {
      /** The noun after the live count: "N connectors". */
      count: string;
      tail: string;
    };
    /** The live-count line; `{count}` is substituted with `sourceCount()`. */
    micro: string;
    ctaCatalog: string;
    ctaGet: string;
  };
  catalog: {
    marker: string;
    /** Template with `{count}` for the live connector count. */
    title: string;
    lede: string;
    action: string;
  };
  categories: {
    marker: string;
    title: string;
    lede: string;
    /** Paper index head: the category name column. */
    label: string;
    /** Short label for the index treatment: the count column head. */
    shortLabel: string;
  };
  capabilities: {
    marker: string;
    title: string;
    lede: string;
    items: readonly {
      title: string;
      body: string;
      href: string;
      hrefLabel: string;
    }[];
  };
  closing: {
    /** Rendered as `titleLead` plus an accent block with `titleHighlight`. */
    titleLead: string;
    titleHighlight: string;
    body: string;
    ctaPrimary: string;
    ctaSecondary: string;
  };
  /** Alt text for the hand-inked investigator drawing in the hero. */
  mascots: {
    hiddenGem: string;
  };
};

/* ── English ────────────────────────────────────────────────────────── */

const en: SourcesCopy = {
  hero: {
    mark: "Sources",
    titleA: "Scan the systems",
    titleBLead: "you",
    titleBHighlight: "already own.",
    lede: {
      count: "connectors",
      tail: "across databases, warehouses and lakehouses, streaming, object storage, collaboration tools, analytics, and public content, all feeding one evidence stream.",
    },
    micro: "{count} connectors · straight from the schema",
    ctaCatalog: "Browse the catalog",
    ctaGet: "Run it and connect one",
  },
  catalog: {
    marker: "Full catalog",
    title: "All {count} connectors",
    lede: "Search by name, category, or capability. Every entry links to its configuration reference on the docs site: required fields, auth, and a worked example.",
    action: "Configuration reference",
  },
  categories: {
    marker: "By category",
    title: "Where the evidence comes from",
    lede: "Connectors are grouped by what they are, not by vendor. Counts come straight from the schema, so this page can never drift from what the product actually supports.",
    label: "Category",
    shortLabel: "Connectors",
  },
  capabilities: {
    marker: "Every connector",
    title: "What they all have in common",
    lede: "The system on the other end changes. What Classifyre does with what it reads does not.",
    items: [
      {
        title: "Assets, not just rows",
        body: "Each connector yields assets with source metadata attached (owner, path, timestamps), so a finding always carries where it came from.",
        href: docs.sources,
        hrefLabel: "Assets & metadata",
      },
      {
        title: "Test before you scan",
        body: "Every source can be dry-run from the app: check the credentials, see what it would read, and only then commit to a full scan.",
        href: docs.sourceTesting,
        hrefLabel: "Testing sources",
      },
      {
        title: "Sampling that bounds cost",
        body: "Large tables and files are read through sampling windows with a per-asset cursor, so a scan reads a bounded slice instead of everything.",
        href: docs.sampling,
        hrefLabel: "Sampling",
      },
      {
        title: "Cross-source fingerprints",
        body: "The same value showing up in two different systems gets linked by identity, which is where most real investigations actually begin.",
        href: docs.howItWorks,
        hrefLabel: "How it works",
      },
    ],
  },
  closing: {
    titleLead: "Missing the one",
    titleHighlight: "you need?",
    body: "Connectors are plugins, and the project is open source, so the answer is either a pull request or a conversation. Enterprise customers get sources built for their industry's systems by our engineers.",
    ctaPrimary: "Request a connector",
    ctaSecondary: "Talk to us about enterprise",
  },
  mascots: {
    hiddenGem:
      "The Classifyre investigator holding a magnifying glass over a hidden gem",
  },
};

/* ── Assembled copy ─────────────────────────────────────────────────── */

export const sourcesCopy: Record<Locale, SourcesCopy> = {
  en,
  de,
};

export function getSourcesCopy(locale: Locale): SourcesCopy {
  return sourcesCopy[locale] ?? en;
}

export { en as englishSourcesCopy };
