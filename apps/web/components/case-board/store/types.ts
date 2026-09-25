import type {
  BoardColor,
  BoardLinkCertainty,
  BoardStance,
} from "@workspace/schemas/case-board";

/**
 * The client-side board domain (docs/architecture/CASE_BOARD_PRD.md §8.3).
 *
 * Built once per load from the board response by `buildDomain`, then kept up
 * to date optimistically by `applyLocal`. React Flow nodes only ever carry
 * `{ itemId }`; components look the domain record up here, so a change to one
 * bubble re-renders that bubble and nothing else.
 */

export type ItemKind = "EVIDENCE" | "HYPOTHESIS" | "COMMENT" | "NOTE" | "FRAME";

export interface BoardItemStyle {
  color?: BoardColor;
  highlight?: BoardColor;
  rowHighlights?: Record<string, BoardColor>;
  anchorFindingId?: string;
  /** EVIDENCE: finding nodes the user moved, relative to their asset node. */
  findingPositions?: Record<string, { x: number; y: number }>;
}

export interface BoardItemContent {
  text?: string;
  title?: string;
}

export interface BoardItem {
  id: string;
  kind: ItemKind;
  refId: string | null;
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
  z: number;
  parentId: string | null;
  collapsed: boolean;
  style: BoardItemStyle;
  content: BoardItemContent;
  createdBy: string | null;
  updatedBy: string | null;
  /** ISO timestamp; sent back as `expectedUpdatedAt` when editing text. */
  updatedAt: string;
  /** Created optimistically and not yet confirmed by the server. */
  pending?: boolean;
}

export interface BoardLink {
  id: string;
  sourceItemId: string;
  sourceFindingId: string | null;
  targetItemId: string;
  targetFindingId: string | null;
  kind: string;
  label: string | null;
  certainty: BoardLinkCertainty;
  confidence: number | null;
  note: string | null;
  promotedEdgeId: string | null;
  createdBy: string | null;
  updatedAt: string;
}

export type SeverityKey = "critical" | "high" | "medium" | "low" | "info";

/** Six visible states, top-down priority; see finding-state.ts. */
export type FindingVisualState =
  | "deleted"
  | "gone"
  | "resolved"
  | "dismissed"
  | "new"
  | "open";

export interface BubbleRow {
  findingId: string;
  /** Null for an unattached row in "+n more on this asset". */
  caseFindingId: string | null;
  typeLabel: string;
  value: string | null;
  severity: SeverityKey | null;
  detector: string | null;
  status: string | null;
  matchState: "NEW" | "GONE" | null;
  missing: boolean;
  state: FindingVisualState;
  note: string | null;
}

export interface Bubble {
  itemId: string;
  evidenceId: string;
  assetId: string;
  label: string;
  assetType: string | null;
  sourceType: string | null;
  sourceName: string | null;
  /** The asset row is gone from the source. */
  missing: boolean;
  /** Attached findings, sorted by state, severity, detector. */
  rows: BubbleRow[];
  /** Live findings of the asset that are not attached to the case. */
  unattached: BubbleRow[];
  severityCounts: Record<SeverityKey, number>;
  newCount: number;
  maxSeverity: SeverityKey | null;
  /** Placeholder until the server confirms (evidence just added). */
  pending?: boolean;
}

export interface BoardThread {
  id: string;
  kind: "HYPOTHESIS" | "DISCUSSION";
  title: string;
  status: string | null;
  confidence: number | null;
  color: string | null;
  createdBy: string | null;
  entryCount: number;
  lastEntryAt: string | null;
  lastAuthor: string | null;
  lastExcerpt: string | null;
  supportingCount: number;
  contradictingCount: number;
  neutralCount: number;
  resolvedAt: string | null;
  resolvedBy: string | null;
  itemId: string | null;
  onBoard: boolean;
  pending?: boolean;
}

export interface BoardEndpointRef {
  itemId: string;
  findingId: string | null;
}

export interface BoardSupport {
  id: string;
  threadId: string;
  stance: BoardStance;
  weight: number | null;
  note: string | null;
  endpoint: BoardEndpointRef | null;
  pending?: boolean;
}

/** A platform-produced edge (lineage, duplicate, reference) or a legacy global manual edge. */
export interface SystemEdge {
  id: string;
  /** Node keys, `asset:<id>` / `finding:<id>` / `external:<urn>`. */
  from: string;
  to: string;
  relationType: string;
  relationClass: string;
  origin: "SOURCE_DERIVED" | "INFERRED" | "MANUAL";
  confidence: number;
  method: string | null;
}

/** A depth-1 neighbour asset that is not evidence (drawn as a faint ghost). */
export interface SuggestedAsset {
  key: string;
  assetId: string;
  label: string;
  assetType: string | null;
  sourceType: string | null;
  sourceName: string | null;
  /** Evidence items it connects to. */
  neighbourOf: string[];
}

/** Display hints for an item the client created before the server described it. */
export interface ItemPreview {
  label?: string;
  assetType?: string | null;
  sourceType?: string | null;
  title?: string;
  body?: string;
}

export interface BoardDomain {
  items: Map<string, BoardItem>;
  links: Map<string, BoardLink>;
  bubbles: Map<string, Bubble>;
  threads: Map<string, BoardThread>;
  supports: Map<string, BoardSupport>;
  systemEdges: Map<string, SystemEdge>;
  suggested: Map<string, SuggestedAsset>;
  /** assetId → evidence item id */
  itemByAsset: Map<string, string>;
  /** findingId → evidence item id (attached or unattached row) */
  itemByFinding: Map<string, string>;
  /** Recently removed items/links, so a local undo can bring them back. */
  graveyard: { items: Map<string, BoardItem>; links: Map<string, BoardLink> };
  truncated: boolean;
}
