import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  GlossaryOrigin,
  GlossaryRelationType,
  GlossaryStatus,
  GlossaryTerm,
  Prisma,
} from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../prisma.service';
import { EmbeddingQueueService } from '../embedding/embedding-queue.service';
import { embeddingContentHash } from '../embedding/embedding-text';
import { CLS_SLUG } from '../namespace/namespace.constants';
import {
  cleanLabels,
  isValidKey,
  keyBase,
  matchKeysFor,
} from './glossary-norm';
import {
  ExportTerm,
  ImportScheme,
  ImportTerm,
  ParsedGlossaryFile,
  parseGlossaryCsv,
  parseSkosJsonLd,
  toGlossaryCsv,
  toSkosJsonLd,
} from './glossary-formats';
import { validateRelationKinds } from './glossary-relations.service';
import { recordGlossaryActivity } from './glossary-activity';
import { glossaryEvents } from './glossary-events';

/** R12 limits. */
export const IMPORT_MAX_TERMS = 20_000;
export const IMPORT_MAX_BYTES = 20 * 1024 * 1024;
const REPORT_ITEM_CAP = 2_000;
const CREATE_CHUNK = 500;

export type ImportConflictPolicy = 'skip' | 'overwrite' | 'merge-labels';

export interface GlossaryImportOptions {
  dryRun: boolean;
  conflict: ImportConflictPolicy;
  /** Import everything as DRAFT (R12). */
  asDraft?: boolean;
  /** Put every term without a scheme into this scheme. */
  schemeKey?: string;
  actor?: string;
  origin?: Extract<GlossaryOrigin, 'IMPORT' | 'PACK'>;
  packKey?: string | null;
  packVersion?: string | null;
  /** Per-key resolution for conflicts (packs, SL2 §8.2). */
  resolutions?: Record<string, 'skip' | 'overwrite'>;
}

export type ImportAction = 'create' | 'update' | 'skip' | 'conflict' | 'refused';

export interface GlossaryImportReport {
  jobId: string | null;
  status: 'DONE' | 'DRY_RUN';
  format: string;
  dryRun: boolean;
  counts: {
    create: number;
    update: number;
    skip: number;
    conflict: number;
    refused: number;
    schemesCreated: number;
    relationsCreated: number;
    relationsRefused: number;
  };
  items: Array<{
    row: number;
    key: string;
    term: string;
    action: ImportAction;
    reason?: string;
    existingId?: string;
  }>;
  relations: Array<{ from: string; to: string; type: string; reason: string }>;
  truncated: boolean;
  /** Ids of the terms created or updated, for packs. */
  termIds: Record<string, string>;
}

type PlannedTerm = {
  item: ImportTerm;
  key: string;
  action: ImportAction;
  reason?: string;
  existing?: GlossaryTerm;
};

/**
 * CSV and SKOS JSON-LD import and export (SL1 R12), and the plan/apply engine
 * glossary packs reuse (SL2 §8). Imports always run a dry run first; the report
 * lists creates, updates, skips, conflicts and refused rows with reasons.
 *
 * Imports run inline with bounded batching rather than on a queue: the tables
 * are small and curated (EuroVoc, about 7,000 concepts, is the largest
 * realistic file) and a dry run is what the UI shows before anything is
 * written. The report is stored on the IMPORTED activity row, which is what
 * `GET /glossary/import/:jobId` reads back.
 */
@Injectable()
export class GlossaryImportExportService {
  private readonly logger = new Logger(GlossaryImportExportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: EmbeddingQueueService,
    private readonly cls: ClsService,
  ) {}

  parse(
    format: 'csv' | 'skos',
    content: string,
    language?: string,
  ): ParsedGlossaryFile {
    if (Buffer.byteLength(content, 'utf8') > IMPORT_MAX_BYTES) {
      throw new BadRequestException(
        `The file is larger than ${IMPORT_MAX_BYTES / 1024 / 1024} MB`,
      );
    }
    let parsed: ParsedGlossaryFile;
    try {
      parsed =
        format === 'csv'
          ? parseGlossaryCsv(content)
          : parseSkosJsonLd(content, language ?? 'en');
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : String(error),
      );
    }
    if (parsed.terms.length > IMPORT_MAX_TERMS) {
      throw new BadRequestException(
        `The file holds ${parsed.terms.length} terms; at most ${IMPORT_MAX_TERMS} are imported at once`,
      );
    }
    return parsed;
  }

  async importFile(
    format: 'csv' | 'skos',
    content: string,
    options: GlossaryImportOptions & { language?: string },
  ): Promise<GlossaryImportReport> {
    const parsed = this.parse(format, content, options.language);
    return this.apply(parsed, format, options);
  }

  /** Plan, and when not a dry run, write. Shared with packs. */
  async apply(
    parsed: ParsedGlossaryFile,
    format: string,
    options: GlossaryImportOptions,
  ): Promise<GlossaryImportReport> {
    const origin = options.origin ?? 'IMPORT';
    const actor = options.actor ?? 'operator';
    const forcedScheme = options.schemeKey?.trim().toLowerCase();
    const terms = parsed.terms.map((item) => ({
      ...item,
      schemeKey: item.schemeKey ?? forcedScheme,
    }));

    // Schemes: by key.
    const schemeKeys = new Set<string>([
      ...parsed.schemes.map((scheme) => scheme.key),
      ...terms
        .map((term) => term.schemeKey)
        .filter((key): key is string => Boolean(key)),
    ]);
    const existingSchemes = await this.prisma.glossaryScheme.findMany({
      where: { key: { in: [...schemeKeys] } },
    });
    const schemeIdByKey = new Map(
      existingSchemes.map((scheme) => [scheme.key, scheme.id]),
    );
    const schemesToCreate: ImportScheme[] = [];
    for (const key of schemeKeys) {
      if (schemeIdByKey.has(key)) continue;
      if (!isValidKey(key)) continue;
      const declared = parsed.schemes.find((scheme) => scheme.key === key);
      schemesToCreate.push(declared ?? { key, name: key });
    }

    // Everything taken: current and previous keys never get reused.
    const all = await this.prisma.glossaryTerm.findMany();
    const byKey = new Map<string, GlossaryTerm>();
    const byIri = new Map<string, GlossaryTerm>();
    const byConceptName = new Map<string, GlossaryTerm>();
    const taken = new Set<string>();
    for (const term of all) {
      byKey.set(term.key, term);
      taken.add(term.key);
      for (const previous of term.previousKeys) {
        if (!byKey.has(previous)) byKey.set(previous, term);
        taken.add(previous);
      }
      if (term.sourceIri) byIri.set(term.sourceIri, term);
      if (term.kind === 'CONCEPT') {
        byConceptName.set(
          `${term.schemeId ?? ''}\u0000${term.term.toLowerCase()}`,
          term,
        );
      }
    }

    const planned: PlannedTerm[] = [];
    const fileKeys = new Set<string>();
    for (const item of terms) {
      const wantedKey =
        item.key && isValidKey(item.key) ? item.key : undefined;
      const schemeId = item.schemeKey
        ? (schemeIdByKey.get(item.schemeKey) ?? `new:${item.schemeKey}`)
        : '';
      const existing =
        (wantedKey ? byKey.get(wantedKey) : undefined) ??
        (item.sourceIri ? byIri.get(item.sourceIri) : undefined) ??
        (item.kind === 'CONCEPT'
          ? byConceptName.get(`${schemeId}\u0000${item.term.toLowerCase()}`)
          : undefined);
      if (existing) {
        const resolution =
          options.resolutions?.[existing.key] ?? options.conflict;
        const sameKey = wantedKey === existing.key || !wantedKey;
        if (resolution === 'skip') {
          planned.push({
            item,
            key: existing.key,
            action: sameKey ? 'skip' : 'conflict',
            reason: sameKey
              ? 'Already exists (conflict policy: skip)'
              : `A concept with this name already exists in the scheme as "${existing.key}"`,
            existing,
          });
        } else {
          planned.push({ item, key: existing.key, action: 'update', existing });
        }
        fileKeys.add(existing.key);
        continue;
      }
      let key = wantedKey;
      if (!key || taken.has(key) || fileKeys.has(key)) {
        const base = keyBase(item.term);
        key = base;
        for (let n = 2; taken.has(key) || fileKeys.has(key); n += 1) {
          key = `${base}-${n}`;
        }
      }
      fileKeys.add(key);
      planned.push({ item, key, action: 'create' });
    }

    // Duplicate concept names inside the file itself.
    const seenNames = new Set<string>();
    for (const plan of planned) {
      if (plan.action !== 'create' || plan.item.kind !== 'CONCEPT') continue;
      const id = `${plan.item.schemeKey ?? ''}\u0000${plan.item.term.toLowerCase()}`;
      if (seenNames.has(id)) {
        plan.action = 'refused';
        plan.reason = 'The same concept name appears twice in this scheme in the file';
      }
      seenNames.add(id);
    }

    const keyToPlan = new Map(planned.map((plan) => [plan.key, plan]));
    // A file relation may name a term by the key it carries in the file even
    // when the term was matched to an existing one under another key.
    const fileKeyAlias = new Map<string, string>();
    for (const plan of planned) {
      if (plan.item.key && plan.item.key !== plan.key) {
        fileKeyAlias.set(plan.item.key, plan.key);
      }
    }
    const resolveKey = (key: string) => fileKeyAlias.get(key) ?? key;

    // Relations, validated against kinds and the BROADER/PART_OF acyclicity.
    type RelationPlan = {
      from: string;
      to: string;
      type: GlossaryRelationType;
      label: string;
    };
    const relationPlans: RelationPlan[] = [];
    for (const plan of planned) {
      if (plan.action === 'refused' || plan.action === 'conflict') continue;
      const item = plan.item;
      for (const to of item.broader) {
        relationPlans.push({ from: plan.key, to: resolveKey(to), type: 'BROADER', label: '' });
      }
      for (const to of item.related) {
        relationPlans.push({ from: plan.key, to: resolveKey(to), type: 'RELATED', label: '' });
      }
      for (const to of item.instanceOf) {
        relationPlans.push({ from: plan.key, to: resolveKey(to), type: 'INSTANCE_OF', label: '' });
      }
      for (const custom of item.custom) {
        relationPlans.push({
          from: plan.key,
          to: resolveKey(custom.to),
          type: 'CUSTOM',
          label: custom.label,
        });
      }
    }
    const kindOf = (key: string): 'CONCEPT' | 'ENTITY' | null => {
      const plan = keyToPlan.get(key);
      if (plan && plan.action !== 'refused') {
        return plan.existing ? plan.existing.kind : plan.item.kind;
      }
      return byKey.get(key)?.kind ?? null;
    };
    const existingBroader = await this.prisma.glossaryRelation.findMany({
      where: { type: { in: ['BROADER', 'PART_OF'] } },
      select: { fromTermId: true, toTermId: true, type: true },
    });
    const idToKey = new Map(all.map((term) => [term.id, term.key]));
    const graph = new Map<string, Set<string>>();
    const edgeKey = (type: string, from: string) => `${type}\u0000${from}`;
    for (const relation of existingBroader) {
      const from = idToKey.get(relation.fromTermId);
      const to = idToKey.get(relation.toTermId);
      if (!from || !to) continue;
      const k = edgeKey(relation.type, from);
      graph.set(k, (graph.get(k) ?? new Set()).add(to));
    }
    const reaches = (type: string, start: string, target: string) => {
      const stack = [start];
      const seen = new Set<string>();
      let hops = 0;
      while (stack.length && hops < 100_000) {
        hops += 1;
        const node = stack.pop()!;
        if (node === target) return true;
        if (seen.has(node)) continue;
        seen.add(node);
        for (const next of graph.get(edgeKey(type, node)) ?? []) stack.push(next);
      }
      return false;
    };
    const relationRefusals: GlossaryImportReport['relations'] = [];
    const acceptedRelations: RelationPlan[] = [];
    const seenRelations = new Set<string>();
    for (const relation of relationPlans) {
      const fromKind = kindOf(relation.from);
      const toKind = kindOf(relation.to);
      const refuse = (reason: string) =>
        relationRefusals.push({
          from: relation.from,
          to: relation.to,
          type: relation.type,
          reason,
        });
      if (!fromKind || !toKind) {
        refuse(`Unknown term key "${!toKind ? relation.to : relation.from}"`);
        continue;
      }
      if (relation.from === relation.to) {
        refuse('A term cannot relate to itself');
        continue;
      }
      const invalid = validateRelationKinds(
        relation.type,
        { kind: fromKind },
        { kind: toKind },
        relation.label,
      );
      if (invalid) {
        refuse(invalid);
        continue;
      }
      let { from, to } = relation;
      if (relation.type === 'RELATED' && from > to) [from, to] = [to, from];
      const id = `${from}\u0000${to}\u0000${relation.type}\u0000${relation.label}`;
      if (seenRelations.has(id)) continue;
      seenRelations.add(id);
      if (relation.type === 'BROADER' || relation.type === 'PART_OF') {
        if (reaches(relation.type, to, from)) {
          refuse(`Would close a ${relation.type} cycle`);
          continue;
        }
        const k = edgeKey(relation.type, from);
        graph.set(k, (graph.get(k) ?? new Set()).add(to));
      }
      acceptedRelations.push({ ...relation, from, to });
    }

    const counts = {
      create: planned.filter((plan) => plan.action === 'create').length,
      update: planned.filter((plan) => plan.action === 'update').length,
      skip: planned.filter((plan) => plan.action === 'skip').length,
      conflict: planned.filter((plan) => plan.action === 'conflict').length,
      refused:
        planned.filter((plan) => plan.action === 'refused').length +
        parsed.refused.length,
      schemesCreated: schemesToCreate.length,
      relationsCreated: acceptedRelations.length,
      relationsRefused: relationRefusals.length,
    };
    const items: GlossaryImportReport['items'] = [
      ...parsed.refused.map((refusal) => ({
        row: refusal.row,
        key: '',
        term: '',
        action: 'refused' as const,
        reason: refusal.reason,
      })),
      ...planned.map((plan) => ({
        row: plan.item.row,
        key: plan.key,
        term: plan.item.term,
        action: plan.action,
        ...(plan.reason ? { reason: plan.reason } : {}),
        ...(plan.existing ? { existingId: plan.existing.id } : {}),
      })),
    ];
    const report: GlossaryImportReport = {
      jobId: null,
      status: options.dryRun ? 'DRY_RUN' : 'DONE',
      format,
      dryRun: options.dryRun,
      counts,
      items: items.slice(0, REPORT_ITEM_CAP),
      relations: relationRefusals.slice(0, REPORT_ITEM_CAP),
      truncated:
        items.length > REPORT_ITEM_CAP ||
        relationRefusals.length > REPORT_ITEM_CAP,
      termIds: {},
    };
    if (options.dryRun) return report;

    // ── Write ──────────────────────────────────────────────────────────────
    const status: GlossaryStatus = options.asDraft ? 'DRAFT' : 'APPROVED';
    for (const scheme of schemesToCreate) {
      const created = await this.prisma.glossaryScheme.create({
        data: {
          key: scheme.key,
          name: scheme.name,
          description: scheme.description ?? null,
          origin,
          packKey: options.packKey ?? null,
          packVersion: options.packVersion ?? null,
          createdBy: actor,
        },
      });
      schemeIdByKey.set(created.key, created.id);
    }
    const now = new Date();
    const embedQueue: Array<{ hash: string; text: string }> = [];
    const idByKey = new Map<string, string>();
    for (const term of all) idByKey.set(term.key, term.id);

    const createRows: Prisma.GlossaryTermCreateManyInput[] = [];
    for (const plan of planned) {
      if (plan.action !== 'create') continue;
      const item = plan.item;
      const aliases = cleanLabels(item.aliases);
      const codes = cleanLabels(item.codes, { caseSensitive: true });
      const hiddenAliases = cleanLabels(item.hiddenAliases);
      const text = [item.term, ...aliases, ...codes, item.definition ?? '', item.notes ?? '']
        .filter(Boolean)
        .join('\n');
      const hash = embeddingContentHash(text);
      embedQueue.push({ hash, text });
      const id = randomUUID();
      idByKey.set(plan.key, id);
      const itemStatus: GlossaryStatus = options.asDraft
        ? 'DRAFT'
        : (item.status ?? status);
      createRows.push({
        id,
        key: plan.key,
        term: item.term,
        kind: item.kind,
        aliases,
        codes,
        hiddenAliases,
        matchKeys: matchKeysFor({ term: item.term, aliases, codes, hiddenAliases }),
        definition: item.definition ?? null,
        notes: item.notes ?? null,
        steward: item.steward ?? null,
        entityType: this.entityType(item),
        schemeId: item.schemeKey ? (schemeIdByKey.get(item.schemeKey) ?? null) : null,
        status: itemStatus,
        origin: 'OPERATOR',
        verifiedAt: itemStatus === 'APPROVED' ? now : null,
        verifiedBy: itemStatus === 'APPROVED' ? actor : null,
        deprecatedAt: itemStatus === 'DEPRECATED' ? now : null,
        sourceIri: item.sourceIri ?? null,
        packKey: options.packKey ?? null,
        embedContentHash: hash,
      });
    }
    for (let i = 0; i < createRows.length; i += CREATE_CHUNK) {
      await this.prisma.glossaryTerm.createMany({
        data: createRows.slice(i, i + CREATE_CHUNK),
      });
    }

    for (const plan of planned) {
      if (plan.action !== 'update' || !plan.existing) continue;
      const item = plan.item;
      const existing = plan.existing;
      const policy = options.resolutions?.[existing.key] ?? options.conflict;
      const merge = policy === 'merge-labels';
      const aliases = cleanLabels(merge ? [...existing.aliases, ...item.aliases] : item.aliases);
      const codes = cleanLabels(merge ? [...existing.codes, ...item.codes] : item.codes, {
        caseSensitive: true,
      });
      const hiddenAliases = cleanLabels(
        merge ? [...existing.hiddenAliases, ...item.hiddenAliases] : item.hiddenAliases,
      );
      const definition = merge
        ? (existing.definition ?? item.definition ?? null)
        : (item.definition ?? existing.definition);
      const text = [item.term, ...aliases, ...codes, definition ?? '', existing.notes ?? '']
        .filter(Boolean)
        .join('\n');
      const hash = embeddingContentHash(text);
      embedQueue.push({ hash, text });
      await this.prisma.glossaryTerm.update({
        where: { id: existing.id },
        data: {
          ...(merge ? {} : { term: item.term }),
          aliases,
          codes,
          hiddenAliases,
          matchKeys: matchKeysFor({
            term: merge ? existing.term : item.term,
            aliases,
            codes,
            hiddenAliases,
          }),
          definition,
          ...(merge
            ? {}
            : {
                notes: item.notes ?? existing.notes,
                steward: item.steward ?? existing.steward,
              }),
          ...(item.schemeKey && !merge
            ? { schemeId: schemeIdByKey.get(item.schemeKey) ?? existing.schemeId }
            : {}),
          sourceIri: existing.sourceIri ?? item.sourceIri ?? null,
          embedContentHash: hash,
        },
      });
      idByKey.set(plan.key, existing.id);
    }

    const relationStatus: GlossaryStatus = options.asDraft ? 'DRAFT' : 'APPROVED';
    const relationRows: Prisma.GlossaryRelationCreateManyInput[] = [];
    for (const relation of acceptedRelations) {
      const fromTermId = idByKey.get(relation.from);
      const toTermId = idByKey.get(relation.to);
      if (!fromTermId || !toTermId) continue;
      let from = fromTermId;
      let to = toTermId;
      if (relation.type === 'RELATED' && from > to) [from, to] = [to, from];
      relationRows.push({
        fromTermId: from,
        toTermId: to,
        type: relation.type,
        label: relation.label,
        status: relationStatus,
        origin,
        createdBy: actor,
        ...(relationStatus === 'APPROVED'
          ? { approvedBy: actor, approvedAt: now }
          : {}),
      });
    }
    let relationsCreated = 0;
    for (let i = 0; i < relationRows.length; i += CREATE_CHUNK) {
      const result = await this.prisma.glossaryRelation.createMany({
        data: relationRows.slice(i, i + CREATE_CHUNK),
        skipDuplicates: true,
      });
      relationsCreated += result.count;
    }
    report.counts.relationsCreated = relationsCreated;

    if (embedQueue.length) {
      try {
        this.queue.enqueue(embedQueue);
      } catch (error) {
        this.logger.warn(
          `Could not enqueue glossary embeddings after import: ${String(error)}`,
        );
      }
    }

    for (const plan of planned) {
      const id = idByKey.get(plan.key);
      if (id && (plan.action === 'create' || plan.action === 'update')) {
        report.termIds[plan.key] = id;
      }
    }

    const activity = await this.prisma.glossaryActivity.create({
      data: {
        type: origin === 'PACK' ? 'PACK_INSTALLED' : 'IMPORTED',
        actor,
        payload: report as unknown as Prisma.InputJsonValue,
      },
    });
    report.jobId = activity.id;
    await this.prisma.glossaryActivity.update({
      where: { id: activity.id },
      data: { payload: report as unknown as Prisma.InputJsonValue },
    });
    if (origin !== 'PACK') {
      glossaryEvents.emit({
        type: 'glossary.imported',
        format,
        created: report.counts.create,
        updated: report.counts.update,
        skipped: report.counts.skip,
      });
    }
    return report;
  }

  private entityType(item: ImportTerm): GlossaryTerm['entityType'] {
    const allowed = ['PERSON', 'ORGANIZATION', 'LOCATION', 'REFERENCE', 'TERM', 'OTHER'];
    if (item.entityType && allowed.includes(item.entityType)) {
      return item.entityType as GlossaryTerm['entityType'];
    }
    return item.kind === 'ENTITY' ? 'OTHER' : 'TERM';
  }

  async importJob(jobId: string): Promise<GlossaryImportReport> {
    const row = await this.prisma.glossaryActivity.findUnique({
      where: { id: jobId },
    });
    if (!row || (row.type !== 'IMPORTED' && row.type !== 'PACK_INSTALLED')) {
      throw new NotFoundException(`Import job ${jobId} not found`);
    }
    return row.payload as unknown as GlossaryImportReport;
  }

  // ── Export ───────────────────────────────────────────────────────────────

  async exportTerms(params: {
    schemeId?: string;
    kinds?: Array<'CONCEPT' | 'ENTITY'>;
  }): Promise<{ terms: ExportTerm[]; schemes: Array<{ key: string; name: string; description: string | null }> }> {
    const kinds = params.kinds?.length ? params.kinds : ['CONCEPT', 'ENTITY'];
    const terms = await this.prisma.glossaryTerm.findMany({
      where: {
        kind: { in: kinds as Array<'CONCEPT' | 'ENTITY'> },
        ...(params.schemeId ? { schemeId: params.schemeId } : {}),
      },
      include: { scheme: true },
      orderBy: { term: 'asc' },
    });
    const ids = terms.map((term) => term.id);
    const relations = ids.length
      ? await this.prisma.glossaryRelation.findMany({
          where: { fromTermId: { in: ids } },
          include: { to: { select: { key: true } } },
        })
      : [];
    const byFrom = new Map<string, typeof relations>();
    for (const relation of relations) {
      byFrom.set(relation.fromTermId, [...(byFrom.get(relation.fromTermId) ?? []), relation]);
    }
    const schemes = new Map<string, { key: string; name: string; description: string | null }>();
    const exportTerms: ExportTerm[] = terms.map((term) => {
      if (term.scheme) {
        schemes.set(term.scheme.key, {
          key: term.scheme.key,
          name: term.scheme.name,
          description: term.scheme.description,
        });
      }
      const own = byFrom.get(term.id) ?? [];
      const of = (type: GlossaryRelationType) =>
        own.filter((relation) => relation.type === type).map((relation) => relation.to.key);
      return {
        key: term.key,
        term: term.term,
        kind: term.kind,
        schemeKey: term.scheme?.key ?? null,
        schemeName: term.scheme?.name ?? null,
        status: term.status,
        entityType: term.entityType,
        definition: term.definition,
        aliases: term.aliases,
        codes: term.codes,
        hiddenAliases: term.hiddenAliases,
        broader: of('BROADER'),
        related: of('RELATED'),
        instanceOf: of('INSTANCE_OF'),
        custom: own
          .filter((relation) => relation.type === 'CUSTOM')
          .map((relation) => ({ to: relation.to.key, label: relation.label })),
        steward: term.steward,
        notes: term.notes,
        sourceIri: term.sourceIri,
      };
    });
    if (params.schemeId && !schemes.size) {
      const scheme = await this.prisma.glossaryScheme.findUnique({
        where: { id: params.schemeId },
      });
      if (scheme) {
        schemes.set(scheme.key, {
          key: scheme.key,
          name: scheme.name,
          description: scheme.description,
        });
      }
    }
    return { terms: exportTerms, schemes: [...schemes.values()] };
  }

  async exportFile(params: {
    format: 'csv' | 'skos';
    schemeId?: string;
    kinds?: Array<'CONCEPT' | 'ENTITY'>;
    baseUrl?: string;
  }): Promise<{ fileName: string; contentType: string; body: string }> {
    // SKOS exports concepts only, unless entities are asked for (R12).
    const kinds =
      params.kinds?.length || params.format === 'csv'
        ? params.kinds
        : (['CONCEPT'] as Array<'CONCEPT' | 'ENTITY'>);
    const { terms, schemes } = await this.exportTerms({
      schemeId: params.schemeId,
      kinds,
    });
    const stamp = new Date().toISOString().slice(0, 10);
    if (params.format === 'csv') {
      return {
        fileName: `glossary-${stamp}.csv`,
        contentType: 'text/csv; charset=utf-8',
        body: toGlossaryCsv(terms),
      };
    }
    const slug = (this.cls.get(CLS_SLUG) as string | undefined) ?? 'workspace';
    const host = (params.baseUrl ?? process.env.CLASSIFYRE_PUBLIC_URL ?? 'https://classifyre.local').replace(/\/+$/, '');
    return {
      fileName: `glossary-${stamp}.jsonld`,
      contentType: 'application/ld+json; charset=utf-8',
      body: JSON.stringify(
        toSkosJsonLd({ baseIri: `${host}/${slug}`, schemes, terms }),
        null,
        2,
      ),
    };
  }
}
