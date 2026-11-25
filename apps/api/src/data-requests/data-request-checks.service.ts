import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import {
  generateRequestSql,
  type RequestTableMeta,
} from '@workspace/schemas/data-request';
import { PrismaService } from '../prisma.service';
import { ActorDirectoryService } from '../identity/actor-directory.service';
import {
  QueryCatalogService,
  type CatalogTable,
} from '../data-query/query-catalog.service';
import { SharedDatasetResolver } from '../data-query/shared-dataset-resolver';
import {
  extractThreePartNames,
  precheckSql,
  stripLiteralsAndComments,
} from '../data-query/sql-precheck';
import { SharedDatasetsService } from '../shared-datasets/shared-datasets.service';
import { parseSpecSafe } from './data-request.mapper';
import type {
  DataRequestCheckResultDto,
  DataRequestCheckTableDto,
  DataRequestDescribeResultDto,
} from './dto/data-request.dto';

export function sqlHashOf(sql: string, routeGroupId: string): string {
  return createHash('sha256')
    .update(`${routeGroupId}\n${sql}`)
    .digest('hex')
    .slice(0, 32);
}

/**
 * Static precheck and routed-group DuckDB describe for data requests
 * (docs/prd/DR-data-requests.md §4.3, §4.4).
 */
@Injectable()
export class DataRequestChecksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly directory: ActorDirectoryService,
    private readonly catalog: QueryCatalogService,
    private readonly resolver: SharedDatasetResolver,
    private readonly sharedDatasets: SharedDatasetsService,
  ) {}

  async tableLookup(): Promise<Map<string, RequestTableMeta>> {
    const { tables } = await this.catalog.tables();
    return this.buildLookup(tables);
  }

  private buildLookup(
    tables: ReadonlyArray<{
      assetId: string;
      sqlName: string;
      columns: ReadonlyArray<{ name: string; type: string }>;
    }>,
  ): Map<string, RequestTableMeta> {
    return new Map(
      tables.map((t) => [
        t.assetId,
        {
          sqlName: t.sqlName,
          exists: true,
          columns: t.columns.map((c) => ({ name: c.name, type: c.type })),
        },
      ]),
    );
  }

  private async resolveGroupName(groupId: string): Promise<string> {
    try {
      const resolved = await this.directory.resolve([`group:${groupId}`]);
      const match = resolved.find((a) => a.ref === `group:${groupId}`);
      return match?.path ?? match?.displayName ?? groupId;
    } catch {
      return groupId;
    }
  }

  async runStaticCheck(row: {
    routeGroupId: string;
    spec: Prisma.JsonValue;
    draftSql: string;
    sqlEdited: boolean;
  }): Promise<DataRequestCheckResultDto> {
    const spec = parseSpecSafe(row.spec);
    const [tablesInfo, groupCatalog, routeGroupName] = await Promise.all([
      this.catalog.tables(),
      this.resolver.catalogForGroup(row.routeGroupId),
      this.resolveGroupName(row.routeGroupId),
    ]);

    const lookup = this.buildLookup(tablesInfo.tables);
    const generated = generateRequestSql(spec, lookup);
    const sql = row.sqlEdited ? row.draftSql.trim() : generated.sql;

    const groupTablesBySql = new Map<string, CatalogTable>();
    const groupTablesByAsset = new Map<string, CatalogTable>();
    if (groupCatalog) {
      for (const src of groupCatalog.sources) {
        for (const t of src.tables) {
          groupTablesBySql.set(t.sqlName.toLowerCase(), t);
          groupTablesByAsset.set(t.assetId, t);
        }
      }
    }
    const allTablesBySql = new Map(
      tablesInfo.tables.map((t) => [t.sqlName.toLowerCase(), t]),
    );
    const allTablesByAsset = new Map(
      tablesInfo.tables.map((t) => [t.assetId, t]),
    );

    const allowedInGroup = new Set(
      [...groupTablesBySql.values()]
        .filter((t) => t.canQuery && t.location)
        .map((t) => t.sqlName.toLowerCase()),
    );
    const allSources = new Set(
      (groupCatalog?.sources ?? []).map((s) => s.sqlName.toLowerCase()),
    );
    for (const t of tablesInfo.tables) {
      const src = t.sqlName.split('.')[0];
      if (src) allSources.add(src.toLowerCase());
    }

    const precheckError = sql
      ? precheckSql(sql, allowedInGroup, allSources)
      : null;

    const referencedSqlNames = new Set<string>();
    const specTableBySql = new Map<
      string,
      { assetId: string; sqlName: string }
    >();
    for (const t of spec.tables) {
      const resolved = allTablesByAsset.get(t.assetId)?.sqlName ?? t.sqlName;
      const key = resolved.toLowerCase();
      referencedSqlNames.add(key);
      specTableBySql.set(key, { assetId: t.assetId, sqlName: resolved });
    }
    if (sql) {
      for (const name of extractThreePartNames(
        stripLiteralsAndComments(sql).toLowerCase(),
      )) {
        referencedSqlNames.add(name);
      }
    }

    const problems: string[] = [];
    if (!groupCatalog) {
      problems.push(
        `Data team ${routeGroupName} is not active in this workspace.`,
      );
    }

    const checkTables: DataRequestCheckTableDto[] = [];
    for (const sqlName of referencedSqlNames) {
      const fromSpec = specTableBySql.get(sqlName);
      const catalogEntry =
        (fromSpec ? allTablesByAsset.get(fromSpec.assetId) : undefined) ??
        allTablesBySql.get(sqlName);
      const groupEntry =
        (catalogEntry
          ? groupTablesByAsset.get(catalogEntry.assetId)
          : undefined) ?? groupTablesBySql.get(sqlName);

      const exists = Boolean(catalogEntry);
      const groupCanQuery = Boolean(groupEntry?.canQuery);
      const maskedColumns = (groupEntry?.masks ?? [])
        .filter((m) => m.action === 'mask')
        .map((m) => m.column);
      const hiddenColumnCount = groupEntry?.hiddenColumns ?? 0;

      checkTables.push({
        assetId: catalogEntry?.assetId ?? fromSpec?.assetId ?? null,
        sqlName: catalogEntry?.sqlName ?? fromSpec?.sqlName ?? sqlName,
        sourceId: catalogEntry?.sourceId ?? null,
        exists,
        groupCanQuery,
        maskedColumns,
        hiddenColumnCount,
      });

      if (!exists) {
        problems.push(`Table ${sqlName} no longer exists in the catalog.`);
      } else if (!groupCanQuery) {
        problems.push(
          `Data team ${routeGroupName} cannot query ${catalogEntry?.sqlName ?? sqlName}.`,
        );
      }
    }

    if (!row.sqlEdited) {
      for (const d of generated.diagnostics) {
        if (d.level === 'error') problems.push(d.message);
      }
    }
    if (precheckError) {
      problems.push(precheckError.message);
    }

    const uniqueProblems = [...new Set(problems)];
    return {
      ok: uniqueProblems.length === 0 && Boolean(sql),
      sql,
      routeGroup: { id: row.routeGroupId, name: routeGroupName },
      precheckError: precheckError
        ? { code: precheckError.code, message: precheckError.message }
        : null,
      diagnostics: row.sqlEdited
        ? []
        : (generated.diagnostics as unknown as Array<Record<string, unknown>>),
      tables: checkTables,
      problems: uniqueProblems,
    };
  }

  async describe(
    caseId: string,
    row: {
      routeGroupId: string;
      spec: Prisma.JsonValue;
      draftSql: string;
      sqlEdited: boolean;
      lastCheck: Prisma.JsonValue | null;
      lastCheckSqlHash: string | null;
    },
  ): Promise<DataRequestDescribeResultDto> {
    const check = await this.runStaticCheck(row);
    const sql = check.sql.trim();
    const hash = sqlHashOf(sql, row.routeGroupId);

    if (!sql) {
      return {
        cached: false,
        sqlHash: hash,
        describe: null,
        error: {
          code: 'empty_sql',
          message:
            check.problems[0] ??
            'Complete the request before running describe.',
        },
        check,
      };
    }

    if (row.lastCheck && row.lastCheckSqlHash === hash) {
      return {
        cached: true,
        sqlHash: hash,
        describe: row.lastCheck as Record<string, unknown>,
        error: null,
        check,
      };
    }

    try {
      const described = await this.sharedDatasets.describeForGroup(
        sql,
        row.routeGroupId,
      );
      await this.prisma.dataRequest.update({
        where: { caseId },
        data: {
          lastCheck: described as unknown as Prisma.InputJsonValue,
          lastCheckSqlHash: hash,
        },
      });
      return {
        cached: false,
        sqlHash: hash,
        describe: described as unknown as Record<string, unknown>,
        error: null,
        check,
      };
    } catch (error) {
      const resp =
        error &&
        typeof error === 'object' &&
        'getResponse' in error &&
        typeof (error as { getResponse: () => unknown }).getResponse ===
          'function'
          ? (error as { getResponse: () => unknown }).getResponse()
          : null;
      const obj =
        resp && typeof resp === 'object'
          ? (resp as Record<string, unknown>)
          : null;
      const code = typeof obj?.code === 'string' ? obj.code : 'describe_failed';
      const message =
        typeof obj?.message === 'string'
          ? obj.message
          : error instanceof Error
            ? error.message
            : 'Could not describe SQL as the routed group.';
      return {
        cached: false,
        sqlHash: hash,
        describe: null,
        error: { code, message },
        check,
      };
    }
  }
}
