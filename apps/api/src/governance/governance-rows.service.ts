import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { ActorContextService } from '../identity/actor-context.service';
import { ActorDirectoryService } from '../identity/actor-directory.service';
import {
  DATA_RESOURCE,
  governanceResources,
} from '../identity/audit-resources';
import {
  AuditTrailService,
  type AuditChange,
} from '../identity/audit-trail.service';
import {
  EVERYONE,
  MAX_ROW_RULES,
  RowRuleError,
  describeCondition,
  parseConditions,
  parseRowPrincipal,
  rowPolicyLoosens,
  storedConditions,
  type RowCondition,
  type RowRule,
} from '../data-query/row-filters';
import { governedDataScope } from './governance-filter';
import { GovernanceColumnsService } from './governance-columns.service';
import { GovernanceService } from './governance.service';
import type { GovernancePrincipalDto } from './governance.dto';

export interface AssetRowRuleView {
  id: string;
  principalRef: string;
  principal: GovernancePrincipalDto | null;
  conditions: RowCondition[];
  updatedAt: Date;
  updatedBy: string | null;
}

export interface AssetRows {
  assetId: string;
  /** Rows are filtered: readers see only what a rule for them selects. */
  enabled: boolean;
  /** Empty for people who do not govern the table: the rules are theirs. */
  rules: AssetRowRuleView[];
  canGovern: boolean;
  /** The caller sees every row (owner or steward): only they may show more. */
  readsEveryRow: boolean;
  updatedAt: Date | null;
  updatedBy: string | null;
}

export interface RowRuleInput {
  id?: string;
  principalRef: unknown;
  conditions: unknown;
}

/**
 * Row filters of a table (docs/prd/DQ-data-query.md §5.10), as its owners and
 * stewards set them on the Governance tab. Who may change them is
 * governance's rule (`asset.govern`, or owner or steward); who may make them
 * show more is narrower: only someone who sees every row — the table's or
 * its source's owner or steward. Nobody gives more than they have, so an
 * admin who is filtered may turn filtering on and remove rules, never widen.
 */
@Injectable()
export class GovernanceRowsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly governance: GovernanceService,
    private readonly columns: GovernanceColumnsService,
    private readonly actors: ActorContextService,
    private readonly directory: ActorDirectoryService,
    private readonly audit: AuditTrailService,
  ) {}

  /** Groups by name; none when the directory cannot answer. */
  private async resolve(refs: string[]) {
    if (!refs.length) return [];
    try {
      return await this.directory.resolve([...new Set(refs)]);
    } catch {
      return [];
    }
  }

  private async readsEveryRow(target: {
    assetId: string;
    sourceId: string;
  }): Promise<boolean> {
    const governed = await governedDataScope(
      this.prisma,
      this.governance.person(),
    );
    return (
      governed.assetIds.includes(target.assetId) ||
      governed.sourceIds.includes(target.sourceId)
    );
  }

  async assetRows(assetId: string): Promise<AssetRows> {
    const rights = await this.governance.mayGovernScope({
      scopeType: 'ASSET',
      scopeId: assetId,
    });
    const target = { assetId, sourceId: rights.sourceId };
    const policy = await this.prisma.assetRowPolicy.findUnique({
      where: { assetId },
      include: { rules: { orderBy: { createdAt: 'asc' } } },
    });
    const rules = rights.allowed ? (policy?.rules ?? []) : [];
    const named = new Map(
      (
        await this.resolve(
          rules
            .map((rule) => rule.principalRef)
            .filter((ref) => ref !== EVERYONE),
        )
      ).map((actor) => [actor.ref, actor] as const),
    );
    return {
      assetId,
      enabled: Boolean(policy),
      rules: rules.map((rule) => {
        const actor = named.get(rule.principalRef);
        return {
          id: rule.id,
          principalRef: rule.principalRef,
          principal:
            rule.principalRef === EVERYONE
              ? null
              : {
                  ref: rule.principalRef,
                  kind: 'group' as const,
                  displayName: actor?.displayName ?? 'Removed group',
                  ...(actor?.path ? { path: actor.path } : {}),
                },
          conditions: storedConditions(rule.conditions) ?? [],
          updatedAt: rule.updatedAt,
          updatedBy: rule.updatedBy,
        };
      }),
      canGovern: rights.allowed,
      readsEveryRow: await this.readsEveryRow(target),
      updatedAt: policy?.updatedAt ?? null,
      updatedBy: policy?.updatedBy ?? null,
    };
  }

  async updateAssetRows(
    assetId: string,
    body: { enabled?: unknown; rules?: unknown },
  ): Promise<AssetRows> {
    const rights = await this.governance.mayGovernScope({
      scopeType: 'ASSET',
      scopeId: assetId,
    });
    if (!rights.allowed) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: 'CAPABILITY_REQUIRED',
        capability: 'asset.govern',
        message:
          'Filtering rows needs asset.govern, or the owner or steward role on this table or its source.',
      });
    }
    if (typeof body.enabled !== 'boolean') {
      throw new BadRequestException('Say whether rows are filtered (enabled).');
    }
    const enabled = body.enabled;
    const input = enabled ? (body.rules ?? []) : [];
    if (!Array.isArray(input)) {
      throw new BadRequestException('Rules are a list.');
    }
    if (input.length > MAX_ROW_RULES) {
      throw new BadRequestException(
        `A table has at most ${MAX_ROW_RULES} row rules.`,
      );
    }

    const known = new Map(
      (await this.columns.state(assetId)).columns.map((column) => [
        column.name.toLowerCase(),
        column.name,
      ]),
    );
    let rules: {
      id?: string;
      principalRef: string;
      conditions: RowCondition[];
    }[];
    try {
      rules = (input as RowRuleInput[]).map((raw) => {
        const principalRef = parseRowPrincipal(raw?.principalRef);
        const conditions = parseConditions(raw?.conditions).map((c) => {
          const column = known.get(c.column.toLowerCase());
          if (!column) {
            throw new RowRuleError(`This table has no column ${c.column}.`);
          }
          return { ...c, column };
        });
        return {
          ...(typeof raw?.id === 'string' ? { id: raw.id } : {}),
          principalRef,
          conditions,
        };
      });
    } catch (error) {
      if (error instanceof RowRuleError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
    for (const ref of new Set(rules.map((rule) => rule.principalRef))) {
      if (ref !== EVERYONE) await this.governance.assertPrincipalExists(ref);
    }

    const before = await this.prisma.assetRowPolicy.findUnique({
      where: { assetId },
      include: { rules: true },
    });
    const beforeRules: RowRule[] = (before?.rules ?? []).map((rule) => ({
      id: rule.id,
      principalRef: rule.principalRef,
      conditions: storedConditions(rule.conditions) ?? [],
    }));
    const target = { assetId, sourceId: rights.sourceId };
    if (
      rowPolicyLoosens(
        { enabled: Boolean(before), rules: beforeRules },
        { enabled, rules },
      ) &&
      !(await this.readsEveryRow(target))
    ) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: 'ALL_ROWS_REQUIRED',
        message:
          'Only the owner or a steward of this table, who see every row, can show readers more rows: turning filtering off, or adding or widening a rule.',
      });
    }

    const actor = this.actors.current().ref ?? null;
    const kept = new Set(
      rules.map((rule) => rule.id).filter((id): id is string => Boolean(id)),
    );
    await this.prisma.$transaction(async (tx) => {
      if (!enabled) {
        await tx.assetRowPolicy.deleteMany({ where: { assetId } });
        return;
      }
      await tx.assetRowPolicy.upsert({
        where: { assetId },
        create: { assetId, updatedBy: actor },
        update: { updatedBy: actor },
      });
      await tx.assetRowRule.deleteMany({
        where: { assetId, id: { notIn: [...kept] } },
      });
      for (const rule of rules) {
        const data = {
          principalRef: rule.principalRef,
          conditions: rule.conditions as unknown as Prisma.InputJsonValue,
        };
        const was = rule.id
          ? beforeRules.find((old) => old.id === rule.id)
          : undefined;
        if (was) {
          if (
            was.principalRef !== rule.principalRef ||
            JSON.stringify(was.conditions) !== JSON.stringify(rule.conditions)
          ) {
            await tx.assetRowRule.update({
              where: { id: was.id },
              data: { ...data, updatedBy: actor },
            });
          }
        } else {
          await tx.assetRowRule.create({
            data: { ...data, assetId, createdBy: actor, updatedBy: actor },
          });
        }
      }
    });

    void this.audit.record({
      actor: this.actors.current(),
      channel: 'rest',
      capability: 'asset.govern',
      operation: 'governance.rows.update',
      entityType: 'asset',
      entityId: assetId,
      entityName: rights.name,
      resources: [
        ...governanceResources({ assetId, sourceId: rights.sourceId }),
        DATA_RESOURCE,
      ],
      fields: ['rows'],
      changes: await this.changes(
        { enabled: Boolean(before), rules: beforeRules },
        { enabled, rules },
      ),
    });
    return this.assetRows(assetId);
  }

  /** What an audit event says changed: the switch, then each rule as text. */
  private async changes(
    before: { enabled: boolean; rules: RowRule[] },
    after: {
      enabled: boolean;
      rules: { principalRef: string; conditions: RowCondition[] }[];
    },
  ): Promise<AuditChange[]> {
    const refs = [...before.rules, ...after.rules]
      .map((rule) => rule.principalRef)
      .filter((ref) => ref !== EVERYONE);
    const names = new Map(
      (await this.resolve(refs)).map(
        (actor) => [actor.ref, actor.displayName] as const,
      ),
    );
    const text = (rule: { principalRef: string; conditions: RowCondition[] }) =>
      `${rule.principalRef === EVERYONE ? 'Everyone' : (names.get(rule.principalRef) ?? rule.principalRef)}: ${
        rule.conditions.length
          ? rule.conditions.map(describeCondition).join(' and ')
          : 'every row'
      }`;
    const out: AuditChange[] = [];
    if (before.enabled !== after.enabled) {
      out.push({
        field: 'rows',
        from: before.enabled ? 'filtered' : 'every row',
        to: after.enabled ? 'filtered' : 'every row',
      });
    }
    const was = before.rules.map(text);
    const now = after.rules.map(text);
    for (const rule of was.filter((rule) => !now.includes(rule))) {
      out.push({ field: 'rows.rule', from: rule, to: null });
    }
    for (const rule of now.filter((rule) => !was.includes(rule))) {
      out.push({ field: 'rows.rule', from: null, to: rule });
    }
    return out;
  }
}
