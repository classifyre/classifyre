import type { DemoId } from "@/components/demos";
import type { MascotName } from "@/components/mascot";

/**
 * Topic pages: one page per search term, in both languages.
 *
 * Each answers its term in the H1 and the first paragraph, shows a
 * self-running demo of the product doing it, explains how Classifyre does it with links
 * into the docs, says plainly what it does not do, and ends on the Docker
 * command and a pilot. The comparison pages add a dated, sourced table.
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

export type TopicComparison = {
  title: string;
  asOf: string;
  columns: { aspect: string; them: string; us: string };
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
    compare: string;
    notDo: string;
    run: string;
    faq: string;
    related: string;
  };
  runTitle: string;
  runBody: string;
  runDocs: string;
  pilotTitle: string;
  pilotBody: string;
  pilotCta: string;
  relatedTitle: string;
  faqTitle: string;
  sourcesLabel: string;
};
