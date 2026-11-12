import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import {
  classificationReviewed,
  deriveClassification,
  type Classification,
  type ColumnFindingGroup,
} from './governance-rules';

export interface ColumnState {
  name: string;
  /** The type the scan recorded; empty when the format has none (CSV). */
  type: string;
  businessName: string | null;
  description: string | null;
  term: { id: string; key: string; term: string; status: string } | null;
  criticalDataElement: boolean;
  /** The steward's classification, when they set one. */
  classification: string | null;
  /** What open findings in this column say (GOV §5.1). */
  derivedClassification: Classification | null;
  /** The steward's, else the derived one. */
  effectiveClassification: string | null;
  findings: ColumnFindingGroup[];
  reviewedAt: Date | null;
  reviewedBy: string | null;
  updatedAt: Date | null;
  updatedBy: string | null;
}

export interface AssetColumns {
  columns: ColumnState[];
  /** Annotations of columns the last scan no longer has (renamed or dropped). */
  removed: ColumnState[];
  /** Open findings of the asset that name no column (older scans, free text). */
  findingsWithoutColumn: number;
  /** Undefined without columns; see `classificationReviewed`. */
  classificationReviewed?: boolean;
}

/** `metadata.columns` as the tabular sources write it: `[{name, type}]`. */
export function columnsOf(metadata: unknown): { name: string; type: string }[] {
  const columns = (metadata as { columns?: unknown } | null)?.columns;
  if (!Array.isArray(columns)) return [];
  const out: { name: string; type: string }[] = [];
  const seen = new Set<string>();
  for (const column of columns) {
    const name =
      typeof column === 'string'
        ? column
        : typeof (column as { name?: unknown })?.name === 'string'
          ? (column as { name: string }).name
          : '';
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const type = (column as { type?: unknown })?.type;
    out.push({ name, type: typeof type === 'string' ? type : '' });
  }
  return out;
}

const SEVERITY_RANK = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

/**
 * The columns of a table with what stewards said about them and what open
 * findings say (GOV R6). Reads only; changes go through GovernanceService,
 * which checks rights and audits.
 */
@Injectable()
export class GovernanceColumnsService {
  constructor(private readonly prisma: PrismaService) {}

  async state(assetId: string, metadata?: unknown): Promise<AssetColumns> {
    const meta =
      metadata !== undefined
        ? metadata
        : (
            await this.prisma.asset.findUnique({
              where: { id: assetId },
              select: { metadata: true },
            })
          )?.metadata;
    const scanned = columnsOf(meta);
    const [annotations, groups, loose] = await Promise.all([
      this.prisma.assetColumnAnnotation.findMany({
        where: { assetId },
        include: {
          term: { select: { id: true, key: true, term: true, status: true } },
        },
      }),
      this.prisma.$queryRaw<
        {
          column: string;
          detector_type: string;
          finding_type: string;
          count: bigint;
          max_rank: number;
        }[]
      >`
        SELECT metadata->>'tabular_column_name' AS column,
               detector_type::text AS detector_type,
               finding_type,
               count(*) AS count,
               max(array_position(
                 ARRAY['INFO','LOW','MEDIUM','HIGH','CRITICAL'], severity::text
               )) AS max_rank
          FROM findings
         WHERE asset_id = ${assetId}
           AND status = 'OPEN'
           AND metadata ? 'tabular_column_name'
         GROUP BY 1, 2, 3`,
      this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) AS count
          FROM findings
         WHERE asset_id = ${assetId}
           AND status = 'OPEN'
           AND (metadata IS NULL OR NOT (metadata ? 'tabular_column_name'))`,
    ]);

    const byColumn = new Map<string, ColumnFindingGroup[]>();
    for (const row of groups) {
      const list = byColumn.get(row.column) ?? [];
      list.push({
        detectorType: row.detector_type,
        findingType: row.finding_type,
        count: Number(row.count),
        maxSeverity: SEVERITY_RANK[(row.max_rank ?? 1) - 1] ?? 'INFO',
      });
      byColumn.set(row.column, list);
    }
    const noteOf = new Map(annotations.map((row) => [row.columnName, row]));

    const build = (name: string, type: string): ColumnState => {
      const note = noteOf.get(name);
      const findings = (byColumn.get(name) ?? []).sort(
        (a, b) => b.count - a.count,
      );
      const derived = deriveClassification(findings);
      return {
        name,
        type,
        businessName: note?.businessName ?? null,
        description: note?.description ?? null,
        term: note?.term ?? null,
        criticalDataElement: note?.criticalDataElement ?? false,
        classification: note?.classification ?? null,
        derivedClassification: derived,
        effectiveClassification: note?.classification ?? derived,
        findings,
        reviewedAt: note?.classificationReviewedAt ?? null,
        reviewedBy: note?.classificationReviewedBy ?? null,
        updatedAt: note?.updatedAt ?? null,
        updatedBy: note?.updatedBy ?? null,
      };
    };

    const columns = scanned.map((column) => build(column.name, column.type));
    const names = new Set(scanned.map((column) => column.name));
    const removed = annotations
      .filter((row) => !names.has(row.columnName))
      .map((row) => build(row.columnName, ''));
    return {
      columns,
      removed,
      findingsWithoutColumn: scanned.length ? Number(loose[0]?.count ?? 0) : 0,
      ...(columns.length
        ? {
            classificationReviewed: classificationReviewed(
              columns.map((column) => ({
                derived: column.derivedClassification,
                reviewedAt: column.reviewedAt,
              })),
            ),
          }
        : {}),
    };
  }
}
