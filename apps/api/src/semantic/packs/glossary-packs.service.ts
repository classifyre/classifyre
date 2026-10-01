import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { resolveSchemasDir } from '../../utils/schema-path';
import { isValidKey } from '../../glossary/glossary-norm';
import {
  ImportTerm,
  ParsedGlossaryFile,
} from '../../glossary/glossary-formats';
import { GlossaryImportExportService } from '../../glossary/glossary-import-export.service';
import { glossaryEvents } from '../../glossary/glossary-events';
import { recordGlossaryActivity } from '../../glossary/glossary-activity';
import { BindingsService } from '../bindings/bindings.service';
import { BindingSpec, bindingFingerprint } from '../bindings/binding-spec';

export const PACK_FORMAT = 'classifyre.glossary-pack/v1';

/** Contract C10. */
export interface GlossaryPack {
  format: typeof PACK_FORMAT;
  key: string;
  version: string;
  name: string;
  description?: string;
  language?: string;
  sources?: string[];
  schemes?: Array<{
    key: string;
    name: string;
    description?: string;
    color?: string;
  }>;
  terms?: Array<{
    key: string;
    kind?: 'CONCEPT' | 'ENTITY';
    term: string;
    scheme?: string;
    definition?: string;
    aliases?: string[];
    codes?: string[];
    hiddenAliases?: string[];
    entityType?: string;
    steward?: string;
    notes?: string;
  }>;
  relations?: Array<{ from: string; to: string; type: string; label?: string }>;
  bindings?: Array<
    BindingSpec & {
      lookup?: {
        schemeKey?: string;
        schemeId?: string;
        match: 'CODES' | 'ANY';
      } | null;
    }
  >;
}

/** Two seconds of slack between createdAt and updatedAt still count as untouched. */
const EDIT_SLACK_MS = 2_000;

function edited(row: { createdAt: Date; updatedAt: Date }): boolean {
  return row.updatedAt.getTime() - row.createdAt.getTime() > EDIT_SLACK_MS;
}

/**
 * Glossary packs (SL2 §8, C10): schemes, terms, relations and bindings shipped
 * together — the starter packs, a G2 detector bundle's `glossary` section, or
 * a file. Installing never overwrites an item the workspace already has under
 * the same key: it is reported as a conflict with a per-item choice. Uninstall
 * removes what nobody edited and detaches the rest.
 */
@Injectable()
export class GlossaryPacksService {
  private readonly logger = new Logger(GlossaryPacksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transfer: GlossaryImportExportService,
    private readonly bindings: BindingsService,
  ) {}

  private packsDir(): string {
    return join(resolveSchemasDir(__dirname), 'glossary_packs');
  }

  /** The bundled starter packs (packages/schemas/src/schemas/glossary_packs). */
  starterPacks(): GlossaryPack[] {
    try {
      return readdirSync(this.packsDir())
        .filter((file) => file.endsWith('.json'))
        .sort()
        .map(
          (file) =>
            JSON.parse(
              readFileSync(join(this.packsDir(), file), 'utf8'),
            ) as GlossaryPack,
        );
    } catch (error) {
      this.logger.warn(`Starter packs unavailable: ${String(error)}`);
      return [];
    }
  }

  validate(pack: unknown): GlossaryPack {
    if (!pack || typeof pack !== 'object')
      throw new BadRequestException('A pack is a JSON object');
    const p = pack as GlossaryPack;
    if (p.format !== PACK_FORMAT)
      throw new BadRequestException(`format must be ${String(PACK_FORMAT)}`);
    if (!p.key || !isValidKey(p.key))
      throw new BadRequestException(
        'key must match ^[a-z0-9][a-z0-9._-]{0,99}$',
      );
    if (!p.version || !p.name)
      throw new BadRequestException('version and name are required');
    const allowed = new Set([
      'format',
      'key',
      'version',
      'name',
      'description',
      'language',
      'sources',
      'schemes',
      'terms',
      'relations',
      'bindings',
    ]);
    const unknown = Object.keys(p).filter((k) => !allowed.has(k));
    if (unknown.length)
      throw new BadRequestException(
        `Unknown pack field(s): ${unknown.join(', ')}`,
      );
    for (const term of p.terms ?? []) {
      if (!isValidKey(term.key))
        throw new BadRequestException(
          `Term key "${term.key}" is not a valid key`,
        );
    }
    return p;
  }

  private toParsed(pack: GlossaryPack): ParsedGlossaryFile {
    const relations = pack.relations ?? [];
    const terms: ImportTerm[] = (pack.terms ?? []).map((term, index) => ({
      row: index + 1,
      key: term.key,
      term: term.term,
      kind: term.kind ?? 'CONCEPT',
      schemeKey: term.scheme,
      definition: term.definition,
      aliases: term.aliases ?? [],
      codes: term.codes ?? [],
      hiddenAliases: term.hiddenAliases ?? [],
      entityType: term.entityType,
      steward: term.steward,
      notes: term.notes,
      broader: relations
        .filter((r) => r.from === term.key && r.type === 'BROADER')
        .map((r) => r.to),
      related: relations
        .filter((r) => r.from === term.key && r.type === 'RELATED')
        .map((r) => r.to),
      instanceOf: relations
        .filter((r) => r.from === term.key && r.type === 'INSTANCE_OF')
        .map((r) => r.to),
      custom: relations
        .filter(
          (r) =>
            r.from === term.key &&
            (r.type === 'CUSTOM' || r.type === 'PART_OF'),
        )
        .map((r) => ({ to: r.to, label: r.label ?? r.type.toLowerCase() })),
    }));
    return {
      schemes: (pack.schemes ?? []).map((s) => ({
        key: s.key,
        name: s.name,
        description: s.description,
      })),
      terms,
      refused: [],
    };
  }

  async installed() {
    const [schemes, terms, bindings, installs] = await Promise.all([
      this.prisma.glossaryScheme.groupBy({
        by: ['packKey', 'packVersion'],
        where: { packKey: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.glossaryTerm.groupBy({
        by: ['packKey'],
        where: { packKey: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.glossaryBinding.groupBy({
        by: ['packKey'],
        where: { packKey: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.glossaryActivity.findMany({
        where: { type: 'PACK_INSTALLED' },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    const keys = new Set<string>([
      ...schemes.map((s) => s.packKey!),
      ...terms.map((t) => t.packKey!),
      ...bindings.map((b) => b.packKey!),
    ]);
    return [...keys].map((key) => {
      const last = installs.find(
        (row) => (row.payload as { packKey?: string } | null)?.packKey === key,
      );
      const payload = last?.payload as {
        pack?: GlossaryPack;
        packVersion?: string;
      } | null;
      return {
        key,
        name: payload?.pack?.name ?? key,
        version:
          schemes.find((s) => s.packKey === key)?.packVersion ??
          payload?.packVersion ??
          null,
        installedAt: last?.createdAt ?? null,
        counts: {
          schemes: schemes
            .filter((s) => s.packKey === key)
            .reduce((n, s) => n + s._count._all, 0),
          terms: terms.find((t) => t.packKey === key)?._count._all ?? 0,
          bindings: bindings.find((b) => b.packKey === key)?._count._all ?? 0,
        },
      };
    });
  }

  async list() {
    const installed = await this.installed();
    return {
      installed,
      available: this.starterPacks().map((pack) => ({
        key: pack.key,
        name: pack.name,
        version: pack.version,
        description: pack.description ?? null,
        language: pack.language ?? null,
        counts: {
          schemes: pack.schemes?.length ?? 0,
          terms: pack.terms?.length ?? 0,
          relations: pack.relations?.length ?? 0,
          bindings: pack.bindings?.length ?? 0,
        },
        installedVersion:
          installed.find((i) => i.key === pack.key)?.version ?? null,
      })),
    };
  }

  resolvePack(input: { pack?: unknown; key?: string }): GlossaryPack {
    if (input.pack) return this.validate(input.pack);
    const found = this.starterPacks().find((p) => p.key === input.key);
    if (!found) throw new NotFoundException(`No starter pack "${input.key}"`);
    return found;
  }

  async install(input: {
    pack?: unknown;
    key?: string;
    dryRun?: boolean;
    resolutions?: Record<string, 'skip' | 'overwrite'>;
    actor?: string;
  }) {
    const pack = this.resolvePack(input);
    const dryRun = input.dryRun !== false;
    const actor = input.actor ?? 'operator';
    const report = await this.transfer.apply(this.toParsed(pack), 'pack', {
      dryRun,
      conflict: 'skip',
      origin: 'PACK',
      packKey: pack.key,
      packVersion: pack.version,
      resolutions: input.resolutions,
      actor,
    });
    const bindings = await this.installBindings(pack, dryRun, actor);
    if (!dryRun) {
      await recordGlossaryActivity(this.prisma, {
        type: 'PACK_INSTALLED',
        actor,
        payload: {
          packKey: pack.key,
          packVersion: pack.version,
          pack: pack as unknown as Prisma.InputJsonValue,
          counts: { ...report.counts, ...bindings.counts },
        },
      });
      glossaryEvents.emit({
        type: 'glossary.pack_installed',
        packKey: pack.key,
        version: pack.version,
        counts: {
          terms: report.counts.create + report.counts.update,
          bindings: bindings.counts.created,
        },
      });
    }
    return {
      pack: { key: pack.key, name: pack.name, version: pack.version },
      dryRun,
      terms: report,
      bindings,
    };
  }

  private async installBindings(
    pack: GlossaryPack,
    dryRun: boolean,
    actor: string,
  ) {
    const items: Array<{
      index: number;
      action: string;
      reason?: string;
      bindingId?: string;
    }> = [];
    const counts = { created: 0, waiting: 0, skipped: 0, refused: 0 };
    const keys = [
      ...new Set(
        (pack.bindings ?? [])
          .map((b) => b.termKey)
          .filter((k): k is string => Boolean(k)),
      ),
    ];
    const fileTermKeys = new Set((pack.terms ?? []).map((t) => t.key));
    const existingTerms = await this.prisma.glossaryTerm.findMany({
      where: {
        OR: [{ key: { in: keys } }, { previousKeys: { hasSome: keys } }],
      },
      select: { id: true, key: true, previousKeys: true },
    });
    for (const [index, spec] of (pack.bindings ?? []).entries()) {
      const termKnown =
        !spec.termKey ||
        fileTermKeys.has(spec.termKey) ||
        existingTerms.some(
          (t) =>
            t.key === spec.termKey || t.previousKeys.includes(spec.termKey!),
        );
      if (!termKnown) {
        items.push({
          index,
          action: 'refused',
          reason: `Unknown term key ${spec.termKey}`,
        });
        counts.refused += 1;
        continue;
      }
      const missingDetector =
        spec.output?.detectorType === 'CUSTOM' && spec.output.customDetectorKey
          ? !(await this.prisma.customDetector.findUnique({
              where: { key: spec.output.customDetectorKey },
              select: { id: true },
            }))
          : false;
      if (dryRun) {
        items.push({
          index,
          action: missingDetector ? 'waiting' : 'create',
          ...(missingDetector ? { reason: 'waiting for detector' } : {}),
        });
        if (missingDetector) counts.waiting += 1;
        else counts.created += 1;
        continue;
      }
      try {
        const compiled = await this.bindings.compileSpec(spec);
        const duplicate = await this.prisma.glossaryBinding.findUnique({
          where: { fingerprint: bindingFingerprint(compiled) },
          select: { id: true },
        });
        if (duplicate) {
          items.push({
            index,
            action: 'skip',
            reason: 'Already bound',
            bindingId: duplicate.id,
          });
          counts.skipped += 1;
          continue;
        }
        const created = await this.bindings.create(spec, {
          origin: 'PACK',
          status: missingDetector ? 'DRAFT' : 'APPROVED',
          actor,
          packKey: pack.key,
          rationale: missingDetector
            ? 'Waiting for detector: installs APPROVED when it exists.'
            : null,
        });
        items.push({
          index,
          action: missingDetector ? 'waiting' : 'create',
          bindingId: created.id,
        });
        if (missingDetector) counts.waiting += 1;
        else counts.created += 1;
      } catch (error) {
        items.push({
          index,
          action: 'refused',
          reason: error instanceof Error ? error.message : String(error),
        });
        counts.refused += 1;
      }
    }
    return { counts, items };
  }

  /**
   * Pack bindings waiting for a detector become APPROVED once a detector with
   * that key exists (SL2 §4.5). Called after runs and detector changes.
   */
  async activateWaitingBindings(): Promise<number> {
    const waiting = await this.prisma.glossaryBinding.findMany({
      where: {
        status: 'DRAFT',
        origin: 'PACK',
        detectorType: 'CUSTOM',
        customDetectorKey: { not: null },
      },
    });
    let activated = 0;
    for (const binding of waiting) {
      const detector = await this.prisma.customDetector.findUnique({
        where: { key: binding.customDetectorKey! },
        select: { id: true },
      });
      if (!detector) continue;
      await this.bindings.approve(binding.id, `pack:${binding.packKey ?? ''}`);
      activated += 1;
    }
    return activated;
  }

  /**
   * Upgrade a pack: items nobody edited follow the new version; items edited
   * locally are kept and flagged; items the new version dropped are removed if
   * untouched.
   */
  async upgrade(
    key: string,
    input: { pack?: unknown; dryRun?: boolean; actor?: string },
  ) {
    const pack = this.resolvePack({ pack: input.pack, key });
    if (pack.key !== key)
      throw new BadRequestException('The pack key does not match');
    const dryRun = input.dryRun !== false;
    const ownTerms = await this.prisma.glossaryTerm.findMany({
      where: { packKey: key },
    });
    const resolutions: Record<string, 'skip' | 'overwrite'> = {};
    const flagged: string[] = [];
    for (const term of ownTerms) {
      if (edited(term)) {
        resolutions[term.key] = 'skip';
        flagged.push(term.key);
      } else {
        resolutions[term.key] = 'overwrite';
      }
    }
    const newKeys = new Set((pack.terms ?? []).map((t) => t.key));
    const dropped = ownTerms.filter((t) => !newKeys.has(t.key) && !edited(t));
    const result = await this.install({
      pack,
      dryRun,
      resolutions,
      actor: input.actor,
    });
    if (!dryRun && dropped.length) {
      await this.prisma.glossaryTerm.deleteMany({
        where: { id: { in: dropped.map((t) => t.id) } },
      });
    }
    if (!dryRun) {
      await this.prisma.glossaryScheme.updateMany({
        where: { packKey: key },
        data: { packVersion: pack.version },
      });
    }
    return {
      ...result,
      keptEdited: flagged,
      removed: dropped.map((t) => t.key),
    };
  }

  /** Remove pack items nobody edited; keep and detach the rest. */
  async uninstall(
    key: string,
    input: { dryRun?: boolean; actor?: string } = {},
  ) {
    const dryRun = input.dryRun !== false;
    const [terms, bindings, schemes] = await Promise.all([
      this.prisma.glossaryTerm.findMany({ where: { packKey: key } }),
      this.prisma.glossaryBinding.findMany({ where: { packKey: key } }),
      this.prisma.glossaryScheme.findMany({ where: { packKey: key } }),
    ]);
    if (!terms.length && !bindings.length && !schemes.length) {
      throw new NotFoundException(`Pack ${key} is not installed`);
    }
    const termsRemove = terms.filter((t) => !edited(t));
    const termsKeep = terms.filter((t) => edited(t));
    const bindingsRemove = bindings.filter(
      (b) => !edited(b) && b.status !== 'DISABLED',
    );
    const bindingsKeep = bindings.filter((b) => !bindingsRemove.includes(b));
    const plan = {
      terms: {
        remove: termsRemove.map((t) => t.key),
        detach: termsKeep.map((t) => t.key),
      },
      bindings: { remove: bindingsRemove.length, detach: bindingsKeep.length },
      schemes: schemes.map((s) => s.key),
    };
    if (dryRun) return { key, dryRun, plan };
    await this.prisma.$transaction(async (tx) => {
      await tx.glossaryBinding.deleteMany({
        where: { id: { in: bindingsRemove.map((b) => b.id) } },
      });
      await tx.glossaryBinding.updateMany({
        where: { id: { in: bindingsKeep.map((b) => b.id) } },
        data: { packKey: null },
      });
      await tx.glossaryTerm.deleteMany({
        where: { id: { in: termsRemove.map((t) => t.id) } },
      });
      await tx.glossaryTerm.updateMany({
        where: { id: { in: termsKeep.map((t) => t.id) } },
        data: { packKey: null },
      });
      for (const scheme of schemes) {
        const left = await tx.glossaryTerm.count({
          where: { schemeId: scheme.id },
        });
        if (left === 0) {
          await tx.glossaryBinding.deleteMany({
            where: { lookupSchemeId: scheme.id },
          });
          await tx.glossaryScheme.delete({ where: { id: scheme.id } });
        } else {
          await tx.glossaryScheme.update({
            where: { id: scheme.id },
            data: { packKey: null, packVersion: null },
          });
        }
      }
    });
    await recordGlossaryActivity(this.prisma, {
      type: 'PACK_UNINSTALLED',
      actor: input.actor ?? 'operator',
      payload: { packKey: key, ...plan },
    });
    glossaryEvents.emit({
      type: 'glossary.pack_installed',
      packKey: key,
      version: 'uninstalled',
      counts: { removedTerms: termsRemove.length },
    });
    return { key, dryRun, plan };
  }
}
