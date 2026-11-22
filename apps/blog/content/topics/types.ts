import type { DemoId } from "@/components/demos";
import type { MascotName } from "@/components/mascot";

/**
 * Topic & comparison pages, typed for full EN/DE parity.
 *
 * Each page answers its core query concisely in the H1 and opening lede (ideal
 * for both executive readers and AI search citation engines), demonstrates the
 * capability live, and for comparisons provides an architectural diagram,
 * capability scorecard, balanced pros/cons for BOTH platforms, a clear decision
 * guide, and a dated, source-cited specification table.
 */

export type TopicId =
  | "data-access-governance"
  | "immuta-alternative"
  | "unity-catalog-alternative";

export type { DemoId } from "@/components/demos";

export type TopicPoint = {
  title: string;
  body: string;
  href?: string;
  linkLabel?: string;
};

export type ScorecardLevel = "native" | "supported" | "partial" | "none";

export type ScorecardEntry = {
  dimension: string;
  them: { level: ScorecardLevel; label: string };
  us: { level: ScorecardLevel; label: string };
};

export type ComparisonArchitectureSide = {
  name: string;
  badge: string;
  flow: readonly { step: string; detail: string }[];
  takeaway: string;
};

export type TopicComparison = {
  title: string;
  asOf: string;
  columns: { aspect: string; them: string; us: string };
  /** Visual side-by-side architecture flow showing how each platform enforces rules. */
  architecture?: {
    title: string;
    lede: string;
    them: ComparisonArchitectureSide;
    us: ComparisonArchitectureSide;
  };
  /** Visual capability scorecard for fast executive scanning. */
  scorecard?: {
    title: string;
    lede: string;
    items: readonly ScorecardEntry[];
  };
  /** Honest strengths and limitations of BOTH platforms. */
  tradeoffs?: {
    title: string;
    lede: string;
    themPros: { heading: string; items: readonly string[] };
    themCons: { heading: string; items: readonly string[] };
    usPros: { heading: string; items: readonly string[] };
    usCons: { heading: string; items: readonly string[] };
  };
  /** Direct decision guide: when to pick them vs when to pick Classifyre. */
  chooseWhen?: {
    title: string;
    them: { heading: string; items: readonly string[] };
    us: { heading: string; items: readonly string[] };
  };
  rows: readonly { aspect: string; them: string; us: string }[];
  note: string;
  sources: readonly { label: string; href: string }[];
};

export type TopicCopy = {
  id: TopicId;
  /** Short name for menus, footers and breadcrumbs. */
  name: string;
  metaTitle: string;
  metaDescription: string;
  keywords: readonly string[];
  /** The term, answered: the page's H1. */
  h1: string;
  lede: string;
  demo: DemoId;
  demoCaption: string;
  mascot: MascotName;
  mascotAlt: string;
  pointsTitle: string;
  points: readonly TopicPoint[];
  /** A longer, plain explanation for the reader who searched the term. */
  detail: { title: string; paragraphs: readonly string[] };
  comparison?: TopicComparison;
  notDo: { title: string; body: string };
  faq: readonly { q: string; a: string }[];
  related: readonly TopicId[];
};

/** Labels shared by every topic page of a locale. */
export type TopicChrome = {
  home: string;
  chip: string;
  marks: {
    points: string;
    detail: string;
    architecture: string;
    scorecard: string;
    tradeoffs: string;
    decision: string;
    compare: string;
    notDo: string;
    run: string;
    faq: string;
    related: string;
  };
  runTitle: string;
  runBody: string;
  runDocs: string;
  tailoringTitle: string;
  tailoringBody: string;
  tailoringCta: string;
  relatedTitle: string;
  faqTitle: string;
  sourcesLabel: string;
};
