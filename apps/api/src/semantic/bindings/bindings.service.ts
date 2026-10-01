import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  GlossaryBinding,
  GlossaryBindingStatus,
  GlossaryOrigin,
  Prisma,
} from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../../prisma.service';
import { CLS_SCHEMA } from '../../namespace/namespace.constants';
import { glossaryNorm } from '../../glossary/glossary-norm';
import { recordGlossaryActivity } from '../../glossary/glossary-activity';
import { glossaryEvents } from '../../glossary/glossary-events';
import {
  BindingSpec,
  CompiledBinding,
  MAX_BINDINGS,
  bindingFingerprint,
  isLookupMode,
  isOutputMode,
  outputKey,
  splitValue,
  validateBindingShape,
  vocabularyLabel,
} from './binding-spec';
import {
  LookupIndex,
  assetTermsSql,
  buildLookupIndex,
  findingSelectorSql,
  findingTermsSql,
  lookupCandidates,
  metadataValues,
} from './binding-compiler';
import { excerpt, isStatementTimeout, withStatementTimeout } from '../semantic-sql';

/** Preview statement timeout (SL2 §6.1). */
const PREVIEW_TIMEOUT_MS = 5_000;
/** Warn above this many findings (SL2 §6.1). */
const LARGE_BINDING_FINDINGS = 10_000;
/** previewToken lifetime (SL2 §9.1). */
const PREVIEW_TOKEN_TTL_MS = 30 * 60_000;
/** Counts may move this much between preview and approval (SL2 §9.2). */
const PREVIEW_DRIFT = 0.2;

export type BindingTermSummary = {
  id: string;
  key: string;
  term: string;
  kind: string;
  status: string;
  schemeId: string | null;
  replacedById: string | null;
};

/** APPROVED bindings with an APPROVED target, ready for the compiler halves. */
export interface ActiveBindings {
  bindings: CompiledBinding[];
  index: LookupIndex;
  terms: Map<string, BindingTermSummary>;
  loadedAt: number;
}

export interface BindingPreview {
  counts: { findings: number; assets: number; sources: number };
  samples: Array<{
    findingId: string | null;
    assetId: string;
    assetName: string;
    value: string;
    term: { id: string; key: string; term: string } | null;
  }>;
  lookup?: {
    matched: Array<{
      value: string;
      count: number;
      term: { id: string; key: string; term: string };
    }>;
    unmatched: Array<{ value: string; count: number }>;
    ambiguous: Array<{
      value: string;
      count: number;
      candidates: Array<{ id: string; key: string; term: string }>;
    }>;
  };
  warnings: Array<{ code: string; message: string }>;
  timedOut: boolean;
  label: { label: string; detail: string } | null;
  previewToken?: string;
}

function toCompiled(row: GlossaryBinding): CompiledBinding {
  return {
    id: row.id,
    mode: row.mode,
    detectorType: row.detectorType,
    customDetectorKey: row.customDetectorKey,
    findingType: row.findingType,
    metadataPath: row.metadataPath,
    values: row.values,
    splitDelimiter: row.splitDelimiter,
    termId: row.termId,
    lookupSchemeId: row.lookupSchemeId,
    lookupMatch: row.lookupMatch,
    noMeaning: row.noMeaning,
    sourceIds: row.sourceIds,
    confidence: Number(row.confidence),
  };
}

export { toCompiled as compileBindingRow };

/** The process-wide cache of active bindings, per tenant schema. */
const activeCache = new Map<string, ActiveBindings>();
let cacheListenerInstalled = false;

/**
 * Bindings (SL2): say once what a detector output or metadata field means.
 * Only APPROVED bindings with an APPROVED target drive links (rule SL-5). An
 * APPROVED binding is never edited in place: it is disabled and replaced, so
 * history stays honest.
 */
@Injectable()
export class BindingsService {
  private readonly logger = new Logger(BindingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService,
  ) {
    if (!cacheListenerInstalled) {
      cacheListenerInstalled = true;
      // Any glossary change can change what an active binding resolves to (a
      // term approved, a code edited, a binding disabled), and bindings are
      // few, so the cache simply drops and reloads.
      const drop = () => activeCache.clear();
      glossaryEvents.on('glossary.binding_changed', drop);
      glossaryEvents.on('glossary.term_changed', drop);
      glossaryEvents.on('glossary.scheme_changed', drop);
      glossaryEvents.on('glossary.imported', drop);
      glossaryEvents.on('glossary.pack_installed', drop);
    }
  }

  private schemaKey(): string {
    try {
      return (this.cls.get(CLS_SCHEMA) as string | undefined) ?? 'default';
    } catch {
      return 'default';
    }
  }

  /** Forget the cached active bindings (tests and explicit refreshes). */
  invalidate(): void {
    activeCache.clear();
  }

  /**
   * The APPROVED bindings whose target is APPROVED (rule SL-5), with the
   * lookup index for their schemes. Cached per schema; invalidated by
   * `glossary.*` events, and reloaded at most once a minute regardless.
   */
  async active(): Promise<ActiveBindings> {
    const key = this.schemaKey();
    const cached = activeCache.get(key);
    if (cached && Date.now() - cached.loadedAt < 60_000) return cached;
    const rows = await this.prisma.glossaryBinding.findMany({
      where: {
        status: 'APPROVED',
        noMeaning: false,
        OR: [
          { term: { status: 'APPROVED' } },
          { termId: null, lookupSchemeId: { not: null } },
        ],
      },
    });
    const schemeIds = [
      ...new Set(
        rows
          .map((row) => row.lookupSchemeId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const termIds = rows
      .map((row) => row.termId)
      .filter((id): id is string => Boolean(id));
    const concepts = schemeIds.length
      ? await this.prisma.glossaryTerm.findMany({
          where: {
            schemeId: { in: schemeIds },
            kind: 'CONCEPT',
            status: 'APPROVED',
          },
          select: {
            id: true,
            key: true,
            term: true,
            kind: true,
            status: true,
            schemeId: true,
            replacedById: true,
            codes: true,
            matchKeys: true,
          },
        })
      : [];
    const fixed = termIds.length
      ? await this.prisma.glossaryTerm.findMany({
          where: { id: { in: termIds } },
          select: {
            id: true,
            key: true,
            term: true,
            kind: true,
            status: true,
            schemeId: true,
            replacedById: true,
          },
        })
      : [];
    const terms = new Map<string, BindingTermSummary>();
    for (const term of [...concepts, ...fixed]) {
      terms.set(term.id, {
        id: term.id,
        key: term.key,
        term: term.term,
        kind: term.kind,
        status: term.status,
        schemeId: term.schemeId,
        replacedById: term.replacedById,
      });
    }
    const value: ActiveBindings = {
      bindings: rows.map(toCompiled),
      index: buildLookupIndex(concepts),
      terms,
      loadedAt: Date.now(),
    };
    activeCache.set(key, value);
    return value;
  }

  // ── Resolution and validation ──────────────────────────────────────────

  private async resolveTarget(spec: BindingSpec): Promise<{
    termId: string | null;
    lookupSchemeId: string | null;
  }> {
    let termId: string | null = null;
    let lookupSchemeId: string | null = null;
    if (spec.termId || spec.termKey) {
      const value = (spec.termId ?? spec.termKey ?? '').trim();
      const term =
        (await this.prisma.glossaryTerm.findUnique({ where: { id: value } })) ??
        (await this.prisma.glossaryTerm.findUnique({
          where: { key: value.toLowerCase() },
        })) ??
        (await this.prisma.glossaryTerm.findFirst({
          where: { previousKeys: { has: value.toLowerCase() } },
        }));
      if (!term) throw new BadRequestException(`termKey: ${value} not found`);
      if (term.kind !== 'CONCEPT') {
        throw new BadRequestException(
          'termKey: bindings target concepts. Entities link through mentions (G5).',
        );
      }
      termId = term.id;
    }
    if (spec.lookup) {
      const id = spec.lookup.schemeId;
      const key = spec.lookup.schemeKey?.trim().toLowerCase();
      const scheme = id
        ? await this.prisma.glossaryScheme.findUnique({ where: { id } })
        : key
          ? await this.prisma.glossaryScheme.findUnique({ where: { key } })
          : null;
      if (!scheme) {
        throw new BadRequestException(`lookup.scheme: ${id ?? key} not found`);
      }
      lookupSchemeId = scheme.id;
    }
    return { termId, lookupSchemeId };
  }

  /** Validate and resolve a spec to the compiled form (no id yet). */
  async compileSpec(spec: BindingSpec): Promise<CompiledBinding> {
    const shape = validateBindingShape(spec);
    const target = await this.resolveTarget(spec);
    if (shape.sourceIds.length) {
      const found = await this.prisma.source.count({
        where: { id: { in: shape.sourceIds } },
      });
      if (found !== shape.sourceIds.length) {
        throw new BadRequestException('sourceIds: unknown source');
      }
    }
    return { id: '', ...shape, ...target };
  }

  // ── CRUD and lifecycle ─────────────────────────────────────────────────

  async list(params: {
    termId?: string;
    status?: GlossaryBindingStatus;
    origin?: GlossaryOrigin;
    detectorType?: string;
    customDetectorKey?: string;
    findingType?: string;
    schemeId?: string;
    take?: number;
    skip?: number;
  }) {
    const where: Prisma.GlossaryBindingWhereInput = {
      ...(params.termId ? { termId: params.termId } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(params.origin ? { origin: params.origin } : {}),
      ...(params.detectorType
        ? { detectorType: params.detectorType as never }
        : {}),
      ...(params.customDetectorKey
        ? { customDetectorKey: params.customDetectorKey }
        : {}),
      ...(params.findingType ? { findingType: params.findingType } : {}),
      ...(params.schemeId ? { lookupSchemeId: params.schemeId } : {}),
    };
    const take = Math.min(Math.max(Number(params.take ?? 100) || 100, 1), 500);
    const skip = Math.max(Number(params.skip ?? 0) || 0, 0);
    const [rows, total] = await Promise.all([
      this.prisma.glossaryBinding.findMany({
        where,
        include: {
          term: {
            select: {
              id: true,
              key: true,
              term: true,
              kind: true,
              status: true,
              replacedById: true,
            },
          },
          lookupScheme: { select: { id: true, key: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.glossaryBinding.count({ where }),
    ]);
    const customKeys = [
      ...new Set(
        rows
          .map((row) => row.customDetectorKey)
          .filter((key): key is string => Boolean(key)),
      ),
    ];
    const detectors = customKeys.length
      ? await this.prisma.customDetector.findMany({
          where: { key: { in: customKeys } },
          select: { key: true, name: true },
        })
      : [];
    const detectorNames = new Map(detectors.map((d) => [d.key, d.name]));
    return {
      bindings: rows.map((row) => this.toDto(row, detectorNames)),
      total,
    };
  }

  async get(id: string) {
    const row = await this.prisma.glossaryBinding.findUnique({
      where: { id },
      include: {
        term: {
          select: {
            id: true,
            key: true,
            term: true,
            kind: true,
            status: true,
            replacedById: true,
          },
        },
        lookupScheme: { select: { id: true, key: true, name: true } },
      },
    });
    if (!row) throw new NotFoundException(`Binding ${id} not found`);
    const detector = row.customDetectorKey
      ? await this.prisma.customDetector.findUnique({
          where: { key: row.customDetectorKey },
          select: { key: true, name: true },
        })
      : null;
    return this.toDto(
      row,
      new Map(detector ? [[detector.key, detector.name]] : []),
    );
  }

  toDto(
    row: GlossaryBinding & {
      term?: {
        id: string;
        key: string;
        term: string;
        kind: string;
        status: string;
        replacedById: string | null;
      } | null;
      lookupScheme?: { id: string; key: string; name: string } | null;
    },
    detectorNames: Map<string, string> = new Map(),
  ) {
    const customDetectorName = row.customDetectorKey
      ? (detectorNames.get(row.customDetectorKey) ?? null)
      : null;
    return {
      id: row.id,
      mode: row.mode,
      output: isOutputMode(row.mode)
        ? {
            detectorType: row.detectorType,
            customDetectorKey: row.customDetectorKey,
            customDetectorName,
            findingType: row.findingType,
          }
        : null,
      field: row.metadataPath,
      values: row.values,
      splitDelimiter: row.splitDelimiter,
      lookup: row.lookupSchemeId
        ? {
            schemeId: row.lookupSchemeId,
            scheme: row.lookupScheme ?? null,
            match: row.lookupMatch,
          }
        : null,
      term: row.term
        ? {
            id: row.term.id,
            key: row.term.key,
            term: row.term.term,
            kind: row.term.kind,
            status: row.term.status,
          }
        : null,
      noMeaning: row.noMeaning,
      sourceIds: row.sourceIds,
      confidence: Number(row.confidence),
      status: row.status,
      origin: row.origin,
      rationale: row.rationale,
      note: row.note,
      packKey: row.packKey,
      createdBy: row.createdBy,
      approvedBy: row.approvedBy,
      approvedAt: row.approvedAt,
      disabledBy: row.disabledBy,
      disabledAt: row.disabledAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      label: isOutputMode(row.mode)
        ? vocabularyLabel({
            detectorType: row.detectorType,
            customDetectorKey: row.customDetectorKey,
            customDetectorName,
            findingType: row.findingType,
          })
        : { label: row.metadataPath ?? '', detail: 'metadata' },
      flags: {
        targetDeprecated: row.term?.status === 'DEPRECATED',
        retargetTo: row.term?.status === 'DEPRECATED' ? row.term.replacedById : null,
        targetNotApproved: Boolean(row.term && row.term.status !== 'APPROVED'),
        waitingForDetector:
          row.detectorType === 'CUSTOM' &&
          Boolean(row.customDetectorKey) &&
          !customDetectorName,
        approvedByAgent:
          row.status === 'APPROVED' &&
          row.origin === 'AGENT' &&
          Boolean(row.approvedBy?.startsWith('agent:')),
      },
    };
  }

  async create(
    spec: BindingSpec,
    options: {
      status?: GlossaryBindingStatus;
      origin: GlossaryOrigin;
      actor?: string;
      rationale?: string | null;
      note?: string | null;
      packKey?: string | null;
    },
  ) {
    const compiled = await this.compileSpec(spec);
    const fingerprint = bindingFingerprint(compiled);
    const duplicate = await this.prisma.glossaryBinding.findUnique({
      where: { fingerprint },
    });
    if (duplicate) {
      throw new ConflictException({
        message: 'This binding already exists',
        bindingId: duplicate.id,
        status: duplicate.status,
      });
    }
    const total = await this.prisma.glossaryBinding.count();
    if (total >= MAX_BINDINGS) {
      throw new BadRequestException(
        `A workspace holds at most ${MAX_BINDINGS} bindings`,
      );
    }
    const status: GlossaryBindingStatus =
      options.origin === 'AGENT' || options.origin === 'SUGGESTION'
        ? 'DRAFT'
        : (options.status ?? 'APPROVED');
    const actor = options.actor ?? options.origin.toLowerCase();
    const row = await this.prisma.glossaryBinding.create({
      data: {
        mode: compiled.mode,
        detectorType: compiled.detectorType,
        customDetectorKey: compiled.customDetectorKey,
        findingType: compiled.findingType,
        metadataPath: compiled.metadataPath,
        values: compiled.values,
        splitDelimiter: compiled.splitDelimiter,
        termId: compiled.termId,
        lookupSchemeId: compiled.lookupSchemeId,
        lookupMatch: compiled.lookupMatch,
        noMeaning: compiled.noMeaning,
        sourceIds: compiled.sourceIds,
        confidence: new Prisma.Decimal(compiled.confidence),
        status,
        origin: options.origin,
        rationale: options.rationale ?? null,
        note: options.note ?? null,
        packKey: options.packKey ?? null,
        createdBy: actor,
        fingerprint,
        ...(status === 'APPROVED'
          ? { approvedBy: actor, approvedAt: new Date() }
          : {}),
      },
    });
    await this.recordChange(row, 'created', actor);
    if (status === 'APPROVED') await this.recordChange(row, 'approved', actor);
    return this.get(row.id);
  }

  /** Edit a DRAFT. An APPROVED binding is edited by disabling and replacing it. */
  async update(
    id: string,
    spec: BindingSpec,
    options: { actor?: string; rationale?: string | null; note?: string | null },
  ) {
    const existing = await this.prisma.glossaryBinding.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException(`Binding ${id} not found`);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException(
        'Only DRAFT bindings are edited in place. Disable this one and create a new binding, so history stays honest.',
      );
    }
    const compiled = await this.compileSpec(spec);
    const fingerprint = bindingFingerprint(compiled);
    const clash = await this.prisma.glossaryBinding.findUnique({
      where: { fingerprint },
    });
    if (clash && clash.id !== id) {
      throw new ConflictException({
        message: 'This binding already exists',
        bindingId: clash.id,
      });
    }
    await this.prisma.glossaryBinding.update({
      where: { id },
      data: {
        mode: compiled.mode,
        detectorType: compiled.detectorType,
        customDetectorKey: compiled.customDetectorKey,
        findingType: compiled.findingType,
        metadataPath: compiled.metadataPath,
        values: compiled.values,
        splitDelimiter: compiled.splitDelimiter,
        termId: compiled.termId,
        lookupSchemeId: compiled.lookupSchemeId,
        lookupMatch: compiled.lookupMatch,
        noMeaning: compiled.noMeaning,
        sourceIds: compiled.sourceIds,
        confidence: new Prisma.Decimal(compiled.confidence),
        fingerprint,
        ...(options.rationale !== undefined ? { rationale: options.rationale } : {}),
        ...(options.note !== undefined ? { note: options.note } : {}),
      },
    });
    return this.get(id);
  }

  async approve(id: string, actor = 'operator') {
    const row = await this.prisma.glossaryBinding.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Binding ${id} not found`);
    if (row.status === 'APPROVED') return this.get(id);
    if (row.status === 'DISABLED') {
      throw new BadRequestException('A DISABLED binding is enabled, not approved');
    }
    const updated = await this.prisma.glossaryBinding.update({
      where: { id },
      data: { status: 'APPROVED', approvedBy: actor, approvedAt: new Date() },
    });
    await this.recordChange(updated, 'approved', actor);
    return this.get(id);
  }

  async disable(id: string, actor = 'operator') {
    const row = await this.prisma.glossaryBinding.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Binding ${id} not found`);
    if (row.status === 'DISABLED') return this.get(id);
    const updated = await this.prisma.glossaryBinding.update({
      where: { id },
      data: { status: 'DISABLED', disabledBy: actor, disabledAt: new Date() },
    });
    await this.recordChange(updated, 'disabled', actor);
    return this.get(id);
  }

  async enable(id: string, actor = 'operator') {
    const row = await this.prisma.glossaryBinding.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Binding ${id} not found`);
    if (row.status !== 'DISABLED') {
      throw new BadRequestException('Only DISABLED bindings are enabled');
    }
    const updated = await this.prisma.glossaryBinding.update({
      where: { id },
      data: {
        status: 'APPROVED',
        disabledBy: null,
        disabledAt: null,
        approvedBy: actor,
        approvedAt: new Date(),
      },
    });
    await this.recordChange(updated, 'enabled', actor);
    return this.get(id);
  }

  /** Revert an agent approval: back to DRAFT (D7 undo). */
  async revertToDraft(id: string, actor = 'operator') {
    const row = await this.prisma.glossaryBinding.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Binding ${id} not found`);
    const updated = await this.prisma.glossaryBinding.update({
      where: { id },
      data: { status: 'DRAFT', approvedBy: null, approvedAt: null },
    });
    await recordGlossaryActivity(this.prisma, {
      type: 'BINDING_REVERTED',
      bindingId: id,
      termId: row.termId,
      actor,
      payload: { from: row.status, to: 'DRAFT' },
    });
    glossaryEvents.emit({
      type: 'glossary.binding_changed',
      change: 'disabled',
      bindingId: id,
      mode: updated.mode,
      output: isOutputMode(updated.mode) ? outputKey(updated) : updated.metadataPath ?? undefined,
      termKey: null,
    });
    return this.get(id);
  }

  async remove(id: string, actor = 'operator') {
    const row = await this.prisma.glossaryBinding.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Binding ${id} not found`);
    if (row.status === 'APPROVED') {
      throw new BadRequestException(
        'Disable an APPROVED binding before deleting it, so history is never silently rewritten.',
      );
    }
    await this.prisma.glossaryBinding.delete({ where: { id } });
    await this.recordChange(row, 'deleted', actor);
    return { deleted: true, id };
  }

  /**
   * A binding whose concept was deprecated with a successor: disable it and
   * create the same binding aimed at the successor.
   */
  async retarget(id: string, actor = 'operator') {
    const row = await this.prisma.glossaryBinding.findUnique({
      where: { id },
      include: { term: true },
    });
    if (!row) throw new NotFoundException(`Binding ${id} not found`);
    if (!row.term || row.term.status !== 'DEPRECATED' || !row.term.replacedById) {
      throw new BadRequestException(
        'Only bindings whose concept was deprecated with a successor can be retargeted',
      );
    }
    await this.disable(id, actor);
    return this.create(
      {
        mode: row.mode,
        output: row.detectorType
          ? {
              detectorType: row.detectorType,
              customDetectorKey: row.customDetectorKey,
              findingType: row.findingType ?? '',
            }
          : null,
        field: row.metadataPath,
        values: row.values,
        splitDelimiter: row.splitDelimiter,
        termId: row.term.replacedById,
        sourceIds: row.sourceIds,
        confidence: Number(row.confidence),
      },
      { origin: 'OPERATOR', status: 'APPROVED', actor, note: `Retargeted from ${row.term.key}` },
    );
  }

  private async recordChange(
    row: GlossaryBinding,
    change: 'created' | 'approved' | 'disabled' | 'enabled' | 'deleted',
    actor: string,
  ) {
    const term = row.termId
      ? await this.prisma.glossaryTerm.findUnique({
          where: { id: row.termId },
          select: { key: true },
        })
      : null;
    await recordGlossaryActivity(this.prisma, {
      type:
        change === 'created'
          ? 'BINDING_CREATED'
          : change === 'approved'
            ? 'BINDING_APPROVED'
            : change === 'disabled'
              ? 'BINDING_DISABLED'
              : change === 'enabled'
                ? 'BINDING_ENABLED'
                : 'BINDING_DELETED',
      bindingId: change === 'deleted' ? null : row.id,
      termId: row.termId,
      actor,
      payload: {
        bindingId: row.id,
        mode: row.mode,
        output: isOutputMode(row.mode) ? outputKey(row) : null,
        field: row.metadataPath,
        termKey: term?.key ?? null,
        noMeaning: row.noMeaning,
      },
    });
    glossaryEvents.emit({
      type: 'glossary.binding_changed',
      change,
      bindingId: row.id,
      mode: row.mode,
      output: isOutputMode(row.mode) ? outputKey(row) : (row.metadataPath ?? undefined),
      termKey: term?.key ?? null,
    });
  }

  // ── Preview (SL2 §6.1) ─────────────────────────────────────────────────

  async preview(
    spec: BindingSpec,
    options: { withToken?: boolean } = {},
  ): Promise<BindingPreview> {
    const binding = await this.compileSpec(spec);
    const warnings: BindingPreview['warnings'] = [];
    const preview: BindingPreview = {
      counts: { findings: 0, assets: 0, sources: 0 },
      samples: [],
      warnings,
      timedOut: false,
      label: isOutputMode(binding.mode)
        ? vocabularyLabel({
            detectorType: binding.detectorType,
            customDetectorKey: binding.customDetectorKey,
            findingType: binding.findingType,
          })
        : { label: binding.metadataPath ?? '', detail: 'metadata' },
    };

    if (binding.detectorType === 'CUSTOM' && binding.customDetectorKey) {
      const detector = await this.prisma.customDetector.findUnique({
        where: { key: binding.customDetectorKey },
        select: { name: true },
      });
      if (!detector) {
        warnings.push({
          code: 'MISSING_DETECTOR',
          message: `No custom detector with key "${binding.customDetectorKey}" exists yet. The binding waits for it.`,
        });
      } else if (preview.label) {
        preview.label = vocabularyLabel({
          detectorType: binding.detectorType,
          customDetectorKey: binding.customDetectorKey,
          customDetectorName: detector.name,
          findingType: binding.findingType,
        });
      }
    }
    await this.redundancyWarnings(binding, warnings);

    // The lookup index for this one scheme, also used for the value table.
    const concepts = binding.lookupSchemeId
      ? await this.prisma.glossaryTerm.findMany({
          where: {
            schemeId: binding.lookupSchemeId,
            kind: 'CONCEPT',
            status: 'APPROVED',
          },
          select: { id: true, key: true, term: true, schemeId: true, codes: true, matchKeys: true },
        })
      : [];
    if (isLookupMode(binding.mode) && concepts.length === 0) {
      warnings.push({
        code: 'EMPTY_SCHEME',
        message: 'The lookup scheme has no APPROVED concepts yet.',
      });
    }
    const index = buildLookupIndex(concepts);
    const conceptById = new Map(concepts.map((c) => [c.id, c]));

    try {
      await withStatementTimeout(this.prisma, PREVIEW_TIMEOUT_MS, async (tx) => {
        if (isOutputMode(binding.mode)) {
          const rows = findingTermsSql({ ...binding, noMeaning: false, termId: binding.termId ?? '__no_meaning__' });
          if (rows) {
            const [counts] = await tx.$queryRaw<
              Array<{ findings: bigint; assets: bigint; sources: bigint }>
            >(Prisma.sql`
              SELECT count(DISTINCT x.finding_id) AS findings,
                     count(DISTINCT x.asset_id) AS assets,
                     count(DISTINCT x.source_id) AS sources
                FROM (${rows}) x`);
            preview.counts = {
              findings: Number(counts?.findings ?? 0),
              assets: Number(counts?.assets ?? 0),
              sources: Number(counts?.sources ?? 0),
            };
            const samples = await tx.$queryRaw<
              Array<{
                finding_id: string;
                asset_id: string;
                asset_name: string;
                matched_content: string;
                redacted_content: string | null;
                term_id: string;
              }>
            >(Prisma.sql`
              SELECT x.finding_id, x.asset_id, a.name AS asset_name,
                     f.matched_content, f.redacted_content, x.term_id
                FROM (${rows}) x
                JOIN findings f ON f.id = x.finding_id
                JOIN assets a ON a.id = x.asset_id
               ORDER BY x.last_detected_at DESC NULLS LAST
               LIMIT 5`);
            preview.samples = samples.map((sample) => ({
              findingId: sample.finding_id,
              assetId: sample.asset_id,
              assetName: sample.asset_name,
              value: excerpt(sample.redacted_content ?? sample.matched_content),
              term: this.termRef(sample.term_id, conceptById),
            }));
          }
          if (isLookupMode(binding.mode) || binding.mode === 'OUTPUT_VALUES') {
            const values = await tx.$queryRaw<Array<{ value: string; count: bigint }>>(
              Prisma.sql`
                SELECT min(f.matched_content) AS value, count(*) AS count
                  FROM findings f
                 WHERE ${findingSelectorSql(binding)}
                 GROUP BY glossary_norm(f.matched_content)
                 ORDER BY count(*) DESC
                 LIMIT 200`,
            );
            if (isLookupMode(binding.mode)) {
              preview.lookup = this.lookupTable(binding, values, index, conceptById);
            }
          }
        } else {
          const rows = assetTermsSql({ ...binding, noMeaning: false, termId: binding.termId ?? '__no_meaning__' });
          if (rows) {
            const [counts] = await tx.$queryRaw<
              Array<{ assets: bigint; sources: bigint }>
            >(Prisma.sql`
              SELECT count(DISTINCT x.asset_id) AS assets,
                     count(DISTINCT x.source_id) AS sources
                FROM (${rows}) x`);
            preview.counts = {
              findings: 0,
              assets: Number(counts?.assets ?? 0),
              sources: Number(counts?.sources ?? 0),
            };
            const samples = await tx.$queryRaw<
              Array<{ asset_id: string; asset_name: string; metadata: unknown; term_id: string }>
            >(Prisma.sql`
              SELECT x.asset_id, a.name AS asset_name, a.metadata, x.term_id
                FROM (${rows}) x JOIN assets a ON a.id = x.asset_id
               LIMIT 5`);
            preview.samples = samples.map((sample) => ({
              findingId: null,
              assetId: sample.asset_id,
              assetName: sample.asset_name,
              value: excerpt(metadataValues(sample.metadata, binding.metadataPath ?? '').join(', ')),
              term: this.termRef(sample.term_id, conceptById),
            }));
          }
          if (isLookupMode(binding.mode)) {
            const path = (binding.metadataPath ?? '').split('.');
            const values = await tx.$queryRaw<Array<{ value: string; count: bigint }>>(
              Prisma.sql`
                SELECT min(v) AS value, count(*) AS count FROM (
                  SELECT a.metadata #>> ${path}::text[] AS v
                    FROM assets a
                   WHERE a.metadata IS NOT NULL
                     AND jsonb_typeof(a.metadata #> ${path}::text[]) IN ('string','number','boolean')
                     ${binding.sourceIds.length ? Prisma.sql`AND a.source_id = ANY(${binding.sourceIds}::text[])` : Prisma.empty}
                ) vals
                GROUP BY glossary_norm(v)
                ORDER BY count(*) DESC
                LIMIT 200`,
            );
            preview.lookup = this.lookupTable(binding, values, index, conceptById);
          }
        }
      });
    } catch (error) {
      if (isStatementTimeout(error)) {
        preview.timedOut = true;
        warnings.push({
          code: 'TIMEOUT',
          message: 'The preview took longer than 5 s; counts are incomplete.',
        });
      } else {
        throw error;
      }
    }
    if (preview.counts.findings > LARGE_BINDING_FINDINGS) {
      warnings.push({
        code: 'LARGE',
        message: `This binding touches more than ${LARGE_BINDING_FINDINGS.toLocaleString('en')} findings.`,
      });
    }
    if (binding.noMeaning) {
      warnings.push({
        code: 'NO_MEANING',
        message: 'A "no meaning" binding links nothing; it marks the vocabulary as deliberately unbound.',
      });
    }
    if (options.withToken) {
      preview.previewToken = this.issuePreviewToken(binding, preview.counts.findings);
    }
    return preview;
  }

  private termRef(
    termId: string,
    concepts: Map<string, { id: string; key: string; term: string }>,
  ): { id: string; key: string; term: string } | null {
    const concept = concepts.get(termId);
    return concept ? { id: concept.id, key: concept.key, term: concept.term } : null;
  }

  private lookupTable(
    binding: CompiledBinding,
    values: Array<{ value: string; count: bigint }>,
    index: LookupIndex,
    concepts: Map<string, { id: string; key: string; term: string }>,
  ): NonNullable<BindingPreview['lookup']> {
    const table: NonNullable<BindingPreview['lookup']> = {
      matched: [],
      unmatched: [],
      ambiguous: [],
    };
    const tally = new Map<string, { value: string; count: number; ids: string[] }>();
    for (const row of values) {
      for (const part of splitValue(row.value ?? '', binding.splitDelimiter)) {
        const ids = lookupCandidates(binding, part, index);
        const key = glossaryNorm(part);
        if (!key) continue;
        const entry = tally.get(key) ?? { value: part.trim(), count: 0, ids };
        entry.count += Number(row.count);
        tally.set(key, entry);
      }
    }
    for (const entry of [...tally.values()].sort((a, b) => b.count - a.count)) {
      if (entry.ids.length === 1) {
        const term = this.termRef(entry.ids[0], concepts);
        if (term) table.matched.push({ value: entry.value, count: entry.count, term });
      } else if (entry.ids.length === 0) {
        table.unmatched.push({ value: entry.value, count: entry.count });
      } else {
        table.ambiguous.push({
          value: entry.value,
          count: entry.count,
          candidates: entry.ids
            .map((id) => this.termRef(id, concepts))
            .filter((t): t is { id: string; key: string; term: string } => Boolean(t)),
        });
      }
    }
    return table;
  }

  private async redundancyWarnings(
    binding: CompiledBinding,
    warnings: BindingPreview['warnings'],
  ) {
    const same = await this.prisma.glossaryBinding.findMany({
      where: {
        status: 'APPROVED',
        ...(isOutputMode(binding.mode)
          ? {
              detectorType: binding.detectorType,
              findingType: binding.findingType,
              customDetectorKey: binding.customDetectorKey,
            }
          : { metadataPath: binding.metadataPath }),
      },
      include: { term: { select: { id: true, term: true } } },
    });
    const others = same.filter(
      (row) => bindingFingerprint(toCompiled(row)) !== bindingFingerprint(binding),
    );
    for (const other of others) {
      if (other.noMeaning) {
        warnings.push({
          code: 'NO_MEANING_EXISTS',
          message: 'This vocabulary is marked "no meaning".',
        });
        continue;
      }
      if (other.term) {
        warnings.push({
          code: 'ALREADY_BOUND',
          message: `Already means ${other.term.term} — add another meaning?`,
        });
      }
    }
    if (!binding.termId) return;
    const otherTerms = others
      .map((row) => row.termId)
      .filter((id): id is string => Boolean(id));
    if (!otherTerms.length) return;
    // Redundant when one target is broader than the other: broader concepts
    // follow from the taxonomy, so bind the narrowest.
    const related = await this.prisma.$queryRaw<Array<{ broader: string; narrower: string }>>`
      WITH RECURSIVE up(start_id, term_id, depth) AS (
        SELECT t, t, 0 FROM unnest(${[binding.termId, ...otherTerms]}::text[]) t
        UNION
        SELECT up.start_id, r.to_term_id, up.depth + 1
          FROM glossary_relations r JOIN up ON r.from_term_id = up.term_id
         WHERE r.type = 'BROADER' AND r.status = 'APPROVED' AND up.depth < 10
      )
      SELECT term_id AS broader, start_id AS narrower FROM up WHERE depth > 0
    `;
    for (const row of related) {
      if (row.narrower === binding.termId && otherTerms.includes(row.broader)) {
        warnings.push({
          code: 'REDUNDANT',
          message: 'Another binding of this output targets a broader concept; that one is now redundant.',
        });
      }
      if (row.broader === binding.termId && otherTerms.includes(row.narrower)) {
        warnings.push({
          code: 'REDUNDANT',
          message: 'This output is already bound to a narrower concept; this broader one follows from the taxonomy.',
        });
      }
    }
  }

  // ── Preview tokens (D7) ────────────────────────────────────────────────

  private tokenSecret(): string {
    return (
      process.env.CLASSIFYRE_PREVIEW_TOKEN_SECRET ??
      createHash('sha256')
        .update(`classifyre-preview:${process.env.DATABASE_URL ?? ''}`)
        .digest('hex')
    );
  }

  issuePreviewToken(binding: CompiledBinding, findings: number): string {
    const body = Buffer.from(
      JSON.stringify({
        fp: bindingFingerprint(binding),
        n: findings,
        iat: Date.now(),
      }),
    ).toString('base64url');
    const mac = createHmac('sha256', this.tokenSecret()).update(body).digest('base64url');
    return `${body}.${mac}`;
  }

  /**
   * Verify a preview token for `binding`: same spec, issued within 30 minutes,
   * and the open-finding count has not moved by more than 20% since.
   */
  async verifyPreviewToken(
    binding: CompiledBinding,
    token: string | undefined,
  ): Promise<{ ok: true; findings: number } | { ok: false; reason: string }> {
    if (!token) return { ok: false, reason: 'previewToken is missing: preview the binding first' };
    const [body, mac] = token.split('.');
    if (!body || !mac) return { ok: false, reason: 'previewToken is malformed' };
    const expected = createHmac('sha256', this.tokenSecret()).update(body).digest('base64url');
    const a = Buffer.from(mac);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, reason: 'previewToken is not valid' };
    }
    let payload: { fp: string; n: number; iat: number };
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      return { ok: false, reason: 'previewToken is malformed' };
    }
    if (Date.now() - payload.iat > PREVIEW_TOKEN_TTL_MS) {
      return { ok: false, reason: 'previewToken expired (30 minutes): preview again' };
    }
    if (payload.fp !== bindingFingerprint(binding)) {
      return { ok: false, reason: 'previewToken is for a different binding' };
    }
    const now = await this.preview(this.specOf(binding));
    const before = payload.n;
    const after = now.counts.findings;
    const drift = Math.abs(after - before) / Math.max(before, 1);
    if (drift > PREVIEW_DRIFT && Math.abs(after - before) > 5) {
      return {
        ok: false,
        reason: `The binding's impact moved from ${before} to ${after} findings since the preview: preview again`,
      };
    }
    return { ok: true, findings: after };
  }

  specOf(binding: CompiledBinding): BindingSpec {
    return {
      mode: binding.mode,
      output: binding.detectorType
        ? {
            detectorType: binding.detectorType,
            customDetectorKey: binding.customDetectorKey,
            findingType: binding.findingType ?? '',
          }
        : null,
      field: binding.metadataPath,
      values: binding.values,
      splitDelimiter: binding.splitDelimiter,
      lookup: binding.lookupSchemeId
        ? { schemeId: binding.lookupSchemeId, match: binding.lookupMatch ?? 'CODES' }
        : null,
      termId: binding.termId,
      noMeaning: binding.noMeaning,
      sourceIds: binding.sourceIds,
      confidence: binding.confidence,
    };
  }

  async compiledById(id: string): Promise<CompiledBinding> {
    const row = await this.prisma.glossaryBinding.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Binding ${id} not found`);
    return toCompiled(row);
  }

  async rowById(id: string): Promise<GlossaryBinding> {
    const row = await this.prisma.glossaryBinding.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Binding ${id} not found`);
    return row;
  }
}
