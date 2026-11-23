import { Inject, Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../prisma.service';
import { readsInClear } from '../data-query/clear-scope';
import { QueryCatalogService } from '../data-query/query-catalog.service';
import { ACCESS_POLICY, type AccessPolicy } from '../identity/access-policy';
import { ActorContextService } from '../identity/actor-context.service';
import {
  assetIdOf,
  findingAssetIds,
  redactFindingContent,
  sourceIdOf,
} from './finding-content';

/** Set on a request once its findings were passed through {@link FindingContentService.redact}. */
export const FINDING_CONTENT_CHECKED = 'findingContentChecked';

/**
 * Who reads what a finding found (docs/prd/DQ-data-query.md §5.8a): people
 * with `finding.content` (investigators, curators, source managers, admins,
 * visitors of a published workspace) read every finding; everyone else reads
 * the values of the tables they read in clear — `data.unmask` there, owning
 * or stewarding it — and sees the rest hidden. The same rule as a masked
 * column, so the findings list cannot show what SQL masks.
 */
@Injectable()
export class FindingContentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly actors: ActorContextService,
    private readonly catalog: QueryCatalogService,
    private readonly cls: ClsService,
    @Inject(ACCESS_POLICY) private readonly policy: AccessPolicy,
  ) {}

  /** Whether the current request reads every finding's content. */
  async readsAll(): Promise<boolean> {
    const actor = this.actors.current();
    // The CLI jobs (internal key) work on the values themselves.
    if (actor.kind === 'system') return true;
    const capabilities = await this.policy.capabilities(actor);
    return capabilities.has('finding.content');
  }

  /**
   * `body` with the content of every finding the current person may not read
   * hidden (finding-content.ts). Cheap when there is nothing to hide: no
   * lookups unless the body holds a finding and the person lacks
   * `finding.content`.
   */
  async redact<T>(body: T): Promise<T> {
    if (body === null || body === undefined || typeof body !== 'object') {
      return body;
    }
    let holdsFindings = false;
    redactFindingContent(body, () => {
      holdsFindings = true;
      return true;
    });
    if (!holdsFindings || (await this.readsAll())) return body;
    const scope = await this.catalog.clearScope();
    if (scope.all) return body;
    const sourceOf = new Map<string, string>();
    if (scope.sourceIds.size) {
      const ids = [...findingAssetIds(body)];
      if (ids.length) {
        const rows = await this.prisma.asset.findMany({
          where: { id: { in: ids } },
          select: { id: true, sourceId: true },
        });
        for (const row of rows) sourceOf.set(row.id, row.sourceId);
      }
    }
    return redactFindingContent(body, (finding) => {
      const assetId = assetIdOf(finding);
      const sourceId =
        sourceIdOf(finding) ?? (assetId ? sourceOf.get(assetId) : null);
      if (!assetId && !sourceId) return false; // fail closed
      return readsInClear(scope, { sourceId: sourceId ?? '', assetId });
    }).body;
  }

  /**
   * Whether a search may match on finding values: only for someone who reads
   * every value. Anyone else could confirm or rebuild a hidden value from
   * which searches return a row (a prefix search is a character-by-character
   * oracle).
   */
  async maySearchContent(): Promise<boolean> {
    return this.cls.isActive() ? this.readsAll() : true;
  }
}
