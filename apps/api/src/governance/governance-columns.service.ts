import { Injectable } from '@nestjs/common';
import {
  effectiveColumnPolicy,
  isColumnAction,
  isMaskKind,
  type ColumnAction,
  type ColumnPolicy,
  type MaskKind,
} from '../data-query/column-masks';
import { PrismaService } from '../prisma.service';
import { QueryCatalogService } from '../data-query/query-catalog.service';
import {
  datasetColumnPolicy,
  parseDatasetColumns,
  stricterClassification,
} from '../data-query/dataset-floor';
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
  /** The steward's access (`clear`, `mask`, `hide`); null follows the classification. */
  access: ColumnAction | null;
  /** The steward's mask kind, for a mask (theirs or the default one). */
  maskKind: MaskKind | null;
  /** What people who do not read it in clear get (DQ §5.8). */
  effectiveAccess: ColumnPolicy;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  updatedAt: Date | null;
  updatedBy: string | null;
  /**
   * A shared dataset's column (DQ §5.12): the classification it inherits from
   * the input columns it comes from — a floor it cannot go below.
   */
  inherited?: {
    floor: Classification | null;
    from: { assetId: string; table: string; column: string }[];
    traced: boolean;
  };
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: QueryCatalogService,
  ) {}

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
    const inherited = await this.inheritedFloors(assetId);

    const build = (name: string, type: string): ColumnState => {
      const note = noteOf.get(name);
      const findings = (byColumn.get(name) ?? []).sort(
        (a, b) => b.count - a.count,
      );
      const floor = inherited?.get(name);
      if (inherited) {
        // A shared dataset: what its inputs give is its floor (§5.12).
        const own = note?.classification ?? null;
        return {
          name,
          type,
          businessName: note?.businessName ?? null,
          description: note?.description ?? null,
          term: note?.term ?? null,
          criticalDataElement: note?.criticalDataElement ?? false,
          classification: own,
          derivedClassification: floor?.floor ?? null,
          effectiveClassification: stricterClassification(
            own,
            floor?.floor ?? null,
          ),
          findings,
          access: isColumnAction(note?.access) ? note.access : null,
          maskKind: isMaskKind(note?.maskKind) ? note.maskKind : null,
          effectiveAccess: datasetColumnPolicy({
            floor: floor?.floor ?? null,
            access: note?.access,
            maskKind: note?.maskKind,
            classification: own,
          }),
          reviewedAt: note?.classificationReviewedAt ?? null,
          reviewedBy: note?.classificationReviewedBy ?? null,
          updatedAt: note?.updatedAt ?? null,
          updatedBy: note?.updatedBy ?? null,
          inherited: {
            floor: floor?.floor ?? null,
            from: floor?.from ?? [],
            traced: floor?.traced ?? false,
          },
        };
      }
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
        access: isColumnAction(note?.access) ? note.access : null,
        maskKind: isMaskKind(note?.maskKind) ? note.maskKind : null,
        effectiveAccess: effectiveColumnPolicy({
          access: note?.access,
          maskKind: note?.maskKind,
          classification: note?.classification ?? derived,
        }),
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

  /** A shared dataset's floors by column, or null for any other asset. */
  private async inheritedFloors(assetId: string): Promise<Map<
    string,
    {
      floor: Classification | null;
      from: { assetId: string; table: string; column: string }[];
      traced: boolean;
    }
  > | null> {
    const dataset = await this.prisma.sharedDataset.findUnique({
      where: { assetId },
      select: { columns: true },
    });
    if (!dataset) return null;
    const [floors, tables] = await Promise.all([
      this.catalog.datasetFloors(assetId),
      this.catalog.tables(),
    ]);
    const sqlOf = new Map(tables.tables.map((t) => [t.assetId, t.sqlName]));
    const traced = new Map(
      parseDatasetColumns(dataset.columns).map((c) => [c.name, c.traced]),
    );
    return new Map(
      [...floors].map(([name, value]) => [
        name,
        {
          floor: value.floor,
          from: value.from.map((u) => ({
            assetId: u.assetId,
            table: sqlOf.get(u.assetId) ?? u.assetId,
            column: u.column,
          })),
          traced: traced.get(name) ?? false,
        },
      ]),
    );
  }
}
