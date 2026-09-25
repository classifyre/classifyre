import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  BoardLinkCertainty,
  CaseBoardItemKind,
  CaseThreadKind,
  EvidenceStance,
  HypothesisStatus,
} from '@prisma/client';
import { CaseEvidenceDto } from './case.dto';
import { GraphResponseDto } from './graph.dto';

// Swagger shapes for the case board (docs/architecture/CASE_BOARD_PRD.md §7).
// Request bodies are validated with the zod schemas in
// `@workspace/schemas/case-board` — there is no global ValidationPipe, so the
// decorators here only describe the contract for the generated client.

export class CaseBoardMetaDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  caseId!: string;

  @ApiProperty({
    description:
      'Bumped once per applied ops batch. A client compares it with the version it loaded to tell whether someone else wrote meanwhile.',
  })
  version!: number;

  @ApiProperty({
    description:
      'True when the case is CLOSED or ARCHIVED: the board can be viewed but not changed.',
  })
  readOnly!: boolean;

  @ApiProperty({ description: 'Case status at read time' })
  caseStatus!: string;
}

/** Anything placed on the board. Positions of children are relative to `parentId`. */
export class BoardItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: CaseBoardItemKind, enumName: 'CaseBoardItemKind' })
  kind!: CaseBoardItemKind;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description:
      'EVIDENCE → case_evidence.id; HYPOTHESIS/COMMENT → case_threads.id; null for notes and frames',
  })
  refId!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: Number,
    description: 'Null until placed; the client auto-places and writes back.',
  })
  x!: number | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  y!: number | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  width!: number | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  height!: number | null;

  @ApiProperty()
  z!: number;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description:
      'The frame an item sits in, or the item a comment pin is anchored to',
  })
  parentId!: string | null;

  @ApiProperty()
  collapsed!: boolean;

  @ApiPropertyOptional({
    nullable: true,
    type: 'object',
    additionalProperties: true,
    description:
      '{ color?, highlight?, rowHighlights?: { [findingId]: color }, anchorFindingId? }',
  })
  style!: Record<string, unknown> | null;

  @ApiPropertyOptional({
    nullable: true,
    type: 'object',
    additionalProperties: true,
    description: 'NOTE: { text }, FRAME: { title }',
  })
  content!: Record<string, unknown> | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  createdBy!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  updatedBy!: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({
    description: 'Send back as expectedUpdatedAt when editing note/frame text.',
  })
  updatedAt!: Date;
}

/** A link a person drew on this board. Never part of the global graph unless promoted. */
export class BoardLinkDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  sourceItemId!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  sourceFindingId!: string | null;

  @ApiProperty()
  targetItemId!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  targetFindingId!: string | null;

  @ApiProperty({ description: 'Free-form link kind, e.g. "related_to"' })
  kind!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  label!: string | null;

  @ApiProperty({ enum: BoardLinkCertainty, enumName: 'BoardLinkCertainty' })
  certainty!: BoardLinkCertainty;

  @ApiPropertyOptional({ nullable: true, type: Number })
  confidence!: number | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  note!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'The global MANUAL edge this link was promoted to, if any',
  })
  promotedEdgeId!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  createdBy!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  updatedBy!: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

/** Where a stance edge lands on the board. */
export class BoardEndpointDto {
  @ApiProperty()
  itemId!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  findingId?: string | null;
}

/** Hypothesis ⇄ evidence stance (a case_thread_support row) resolved to board endpoints. */
export class BoardSupportDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'The hypothesis thread' })
  threadId!: string;

  @ApiProperty({ description: '"evidence" | "finding"' })
  targetType!: string;

  @ApiProperty({ description: 'case_evidence.id or case_findings.id' })
  targetId!: string;

  @ApiProperty({ enum: EvidenceStance, enumName: 'EvidenceStance' })
  stance!: EvidenceStance;

  @ApiPropertyOptional({ nullable: true, type: Number })
  weight!: number | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  note!: string | null;

  @ApiPropertyOptional({
    type: BoardEndpointDto,
    nullable: true,
    description:
      'The evidence item (and finding row) the stance points at; null when its target is no longer on the board',
  })
  endpoint!: BoardEndpointDto | null;

  @ApiProperty()
  createdAt!: Date;
}

/** What a hypothesis card or comment pin needs to render without loading the thread. */
export class BoardThreadSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: CaseThreadKind, enumName: 'CaseThreadKind' })
  kind!: CaseThreadKind;

  @ApiProperty()
  title!: string;

  @ApiPropertyOptional({
    enum: HypothesisStatus,
    enumName: 'HypothesisStatus',
    nullable: true,
  })
  status!: HypothesisStatus | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  confidence!: number | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  color!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  createdBy!: string | null;

  @ApiProperty()
  entryCount!: number;

  @ApiPropertyOptional({ nullable: true, type: Date })
  lastEntryAt!: Date | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  lastAuthor!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description: 'The first 280 characters of the newest entry',
  })
  lastExcerpt!: string | null;

  @ApiProperty()
  supportingCount!: number;

  @ApiProperty()
  contradictingCount!: number;

  @ApiProperty()
  neutralCount!: number;

  @ApiPropertyOptional({ nullable: true, type: Date })
  resolvedAt!: Date | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  resolvedBy!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description:
      'The board item showing this thread (live or removed from the board); null when it was never placed',
  })
  itemId!: string | null;

  @ApiProperty({ description: 'Whether that item is currently on the board' })
  onBoard!: boolean;

  @ApiProperty()
  createdAt!: Date;
}

export class CaseBoardResponseDto {
  @ApiProperty({ type: CaseBoardMetaDto })
  board!: CaseBoardMetaDto;

  @ApiProperty({ type: [BoardItemDto] })
  items!: BoardItemDto[];

  @ApiProperty({ type: [BoardLinkDto] })
  links!: BoardLinkDto[];

  @ApiProperty({
    type: [CaseEvidenceDto],
    description: 'Case evidence with attached-finding snapshots (the bubbles)',
  })
  evidence!: CaseEvidenceDto[];

  @ApiProperty({
    type: GraphResponseDto,
    description:
      'The live layer: GraphService.caseGraph — nodes with live status, NEW/GONE, missing flags, and system edges',
  })
  graph!: GraphResponseDto;

  @ApiProperty({ type: [BoardSupportDto] })
  supports!: BoardSupportDto[];

  @ApiProperty({ type: [BoardThreadSummaryDto] })
  threads!: BoardThreadSummaryDto[];
}

/** Body of POST /cases/:id/board/ops. See `ApplyBoardOpsSchema`. */
export class ApplyBoardOpsDto {
  @ApiProperty({
    description: 'Identifies the writing tab so it can ignore its own echo',
    maxLength: 64,
  })
  clientId!: string;

  @ApiProperty({ description: 'The board version the client last saw' })
  baseVersion!: number;

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description:
      'Board ops (1–200), discriminated by `type`: item.create/update/delete/restore, link.create/update/delete/restore/promote, evidence.add/remove, finding.attach/detach, hypothesis.create, stance.set/remove, comment.create/resolve, thread.place.',
  })
  ops!: Record<string, unknown>[];
}

export class AppliedBoardOpDto {
  @ApiProperty()
  opId!: string;

  @ApiPropertyOptional({
    description:
      'The row the op wrote (item, link or stance). Differs from the requested id when the op merged into an existing item.',
  })
  id?: string;

  @ApiPropertyOptional({
    description: 'New updatedAt of that row, for the next expectedUpdatedAt',
  })
  updatedAt?: Date;

  @ApiPropertyOptional({ description: 'A note about what the server did' })
  note?: string;
}

export class RejectedBoardOpDto {
  @ApiProperty()
  opId!: string;

  @ApiProperty({ description: 'Why the op was refused, in words for a person' })
  reason!: string;

  @ApiProperty({
    description:
      'Machine-readable reason: NOT_FOUND, STALE, INVALID, ALREADY_ON_BOARD, READ_ONLY_KIND, CONFLICT',
  })
  code!: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description: 'Current server state of the row, when the op lost a race',
  })
  current?: Record<string, unknown>;
}

export class ApplyBoardOpsResponseDto {
  @ApiProperty()
  version!: number;

  @ApiProperty({ type: [AppliedBoardOpDto] })
  applied!: AppliedBoardOpDto[];

  @ApiProperty({ type: [RejectedBoardOpDto] })
  rejected!: RejectedBoardOpDto[];

  @ApiProperty({
    description:
      'True when someone else wrote after baseVersion: refetch and merge.',
  })
  stale!: boolean;
}

export class BoardNeighboursDto {
  @ApiProperty({ description: 'The evidence item to expand' })
  itemId!: string;
}

export enum BoardTraceKind {
  LINEAGE = 'lineage',
  LINKS = 'links',
  DUPLICATES = 'duplicates',
  SIMILAR = 'similar',
}

export enum BoardTraceDirection {
  UP = 'up',
  DOWN = 'down',
  BOTH = 'both',
}

export enum BoardTraceSide {
  SEED = 'seed',
  UP = 'up',
  DOWN = 'down',
  SIDE = 'side',
}

export class BoardTraceRequestDto {
  @ApiProperty({
    type: [String],
    description: 'Assets to trace from (1–500)',
  })
  assetIds!: string[];

  @ApiPropertyOptional({ enum: BoardTraceDirection, enumName: 'BoardTraceDirection' })
  direction?: BoardTraceDirection;

  @ApiPropertyOptional({
    description: 'Hops to walk (1–6; 6 stands for "all")',
    minimum: 1,
    maximum: 6,
  })
  depth?: number;

  @ApiPropertyOptional({
    enum: BoardTraceKind,
    enumName: 'BoardTraceKind',
    isArray: true,
    description: 'Kinds of connection to follow (default: all)',
  })
  kinds?: BoardTraceKind[];

  @ApiPropertyOptional({
    description: 'Most nodes to return (default 150, at most 300)',
    minimum: 1,
    maximum: 300,
  })
  limit?: number;
}

export class BoardTraceNodeDto {
  @ApiProperty() id!: string;
  @ApiProperty({ description: "'asset' or 'external'" }) type!: string;
  @ApiProperty() label!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) assetType!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) sourceType!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) sourceName!: string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) status!: string | null;
  @ApiProperty() missing!: boolean;
  @ApiProperty({ description: 'Hops from the nearest seed' }) depth!: number;
  @ApiProperty({ enum: BoardTraceSide, enumName: 'BoardTraceSide' }) side!: BoardTraceSide;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'The node this one was first reached from',
  })
  via!: string | null;
  @ApiPropertyOptional({ enum: BoardTraceKind, enumName: 'BoardTraceKind', nullable: true })
  viaKind!: BoardTraceKind | null;
}

export class BoardTraceEdgeDto {
  @ApiProperty() id!: string;
  @ApiProperty() fromType!: string;
  @ApiProperty() fromId!: string;
  @ApiProperty() toType!: string;
  @ApiProperty() toId!: string;
  @ApiProperty() relationType!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) relationClass!: string | null;
  @ApiProperty({ enum: BoardTraceKind, enumName: 'BoardTraceKind' }) kind!: BoardTraceKind;
  @ApiPropertyOptional({ type: Number, nullable: true }) confidence!: number | null;
}

export class BoardTraceResponseDto {
  @ApiProperty({ type: [BoardTraceNodeDto] }) nodes!: BoardTraceNodeDto[];
  @ApiProperty({ type: [BoardTraceEdgeDto] }) edges!: BoardTraceEdgeDto[];
  @ApiProperty({
    description: 'True when the walk hit its node limit or ran out of time',
  })
  truncated!: boolean;
}

export class CaseBoardSnapshotSummaryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'CASE_CLOSED | MANUAL' })
  reason!: string;

  @ApiProperty({ description: 'Board version captured' })
  version!: number;

  @ApiPropertyOptional({ nullable: true, type: String })
  createdBy!: string | null;

  @ApiProperty()
  createdAt!: Date;
}

export class CaseBoardSnapshotDto extends CaseBoardSnapshotSummaryDto {
  @ApiProperty({
    type: CaseBoardResponseDto,
    description: 'The board exactly as it was served when captured',
  })
  payload!: CaseBoardResponseDto;
}
