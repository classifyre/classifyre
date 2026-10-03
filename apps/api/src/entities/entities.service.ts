import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { GlossaryEntityType, GlossaryStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { GlossaryService } from '../glossary/glossary.service';
import { recordGlossaryActivity } from '../glossary/glossary-activity';
import { isValidKey } from '../glossary/glossary-norm';
import {
  normalizeLabel,
  normalizeValue,
  valueHash,
} from '../correlation/value-normalizer';
import { nameLabelType, type NameLabelType } from './entity-labels';
import { EntityMentionsService } from './entity-mentions.service';
import { EntityResolutionService } from './entity-resolution.service';
import { EntitySwitchService } from './entity-switch.service';
import { EntityValuesService, type EntityActor } from './entity-values.service';

const ENTITY_TYPES = new Set<string>(Object.values(GlossaryEntityType));

/** Relation type of the edge from an entity to the record that is it (R19). */
export const ANCHOR_RELATION = 'IDENTIFIES';

export interface CreateEntityInput {
  name?: string;
  entityType?: string;
  aliases?: string[];
  identifiers?: Array<{ label: string; value: string }>;
  definition?: string | null;
  notes?: string | null;
  /** Promote this finding's value: the entity's first alias or identifier. */
  findingId?: string;
  /** Or promote a value from the value index. */
  value?: { label: string; value: string };
  /** Create a second entity even if one with this name exists. */
  createNew?: boolean;
}

export interface DeclaredEntity {
  type?: string;
  name: string;
  key?: string;
  identifiers?: Record<string, string>;
  aliases?: string[];
  attributes?: Record<string, unknown>;
}

/** Reserved asset-metadata key a source declares an entity under (R12). */
export const ENTITY_DECLARATION_KEY = '_entity';

export interface EntityDeclaration {
  assetId: string;
  urn: string | null;
  sourceId: string;
  entity: DeclaredEntity;
}

/** The declaration in an asset's metadata, if it carries a usable one. */
export function declaredEntityOf(metadata: unknown): DeclaredEntity | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }
  const raw = (metadata as Record<string, unknown>)[ENTITY_DECLARATION_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const entity = raw as Record<string, unknown>;
  if (typeof entity.name !== 'string' || !entity.name.trim()) return null;
  const strings = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((v): v is string => typeof v === 'string' && !!v.trim())
      : [];
  const identifiers: Record<string, string> = {};
  if (
    entity.identifiers &&
    typeof entity.identifiers === 'object' &&
    !Array.isArray(entity.identifiers)
  ) {
    for (const [label, value] of Object.entries(entity.identifiers)) {
      if (typeof value === 'string' && value.trim()) identifiers[label] = value;
      else if (typeof value === 'number') identifiers[label] = String(value);
    }
  }
  return {
    name: entity.name.trim(),
    type: typeof entity.type === 'string' ? entity.type : undefined,
    key: typeof entity.key === 'string' ? entity.key : undefined,
    identifiers,
    aliases: strings(entity.aliases),
    attributes:
      entity.attributes &&
      typeof entity.attributes === 'object' &&
      !Array.isArray(entity.attributes)
        ? (entity.attributes as Record<string, unknown>)
        : undefined,
  };
}

function entityTypeFor(
  requested: string | undefined,
  inferred: NameLabelType | null,
): GlossaryEntityType {
  if (requested) {
    const upper = requested.trim().toUpperCase();
    if (!ENTITY_TYPES.has(upper)) {
      throw new BadRequestException(
        `entityType is one of ${[...ENTITY_TYPES].join(', ')}`,
      );
    }
    return upper as GlossaryEntityType;
  }
  if (inferred && inferred !== 'ANY') return inferred;
  return 'OTHER';
}

/**
 * Entities (G5): the named things findings refer to. An entity is an
 * ENTITY-kind glossary term, so its name, aliases, lifecycle, relations and
 * history are the glossary's; this service adds what makes it a *thing* —
 * creating one from a finding, its values and mentions, and sources that
 * declare one with the record they ingest.
 */
@Injectable()
export class EntitiesService {
  private readonly logger = new Logger(EntitiesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly glossary: GlossaryService,
    private readonly values: EntityValuesService,
    private readonly mentions: EntityMentionsService,
    private readonly resolution: EntityResolutionService,
    private readonly switchService: EntitySwitchService,
  ) {}

  // ── Search ──────────────────────────────────────────────────────────────

  async search(params: {
    query?: string;
    entityType?: string;
    status?: GlossaryStatus[];
    sort?: 'mentions' | 'name' | 'lastSeen';
    take?: number;
    skip?: number;
  }) {
    const take = Math.min(Math.max(Number(params.take ?? 25) || 25, 1), 200);
    const skip = Math.max(Number(params.skip ?? 0) || 0, 0);
    const query = params.query?.trim();
    const entityType = params.entityType
      ? entityTypeFor(params.entityType, null)
      : undefined;
    const byValue = query
      ? await this.prisma.entityValue.findMany({
          where: {
            verdict: 'CONFIRMED',
            OR: [
              { normalizedValue: { contains: query.toLowerCase() } },
              { rawValue: { contains: query, mode: 'insensitive' } },
            ],
          },
          select: { termId: true },
          take: 500,
        })
      : [];
    const where: Prisma.GlossaryTermWhereInput = {
      kind: 'ENTITY',
      ...(entityType ? { entityType } : {}),
      status: {
        in: params.status?.length ? params.status : ['DRAFT', 'APPROVED'],
      },
      ...(query
        ? {
            OR: [
              { term: { contains: query, mode: 'insensitive' } },
              { key: { contains: query.toLowerCase() } },
              { aliases: { has: query } },
              { id: { in: [...new Set(byValue.map((row) => row.termId))] } },
            ],
          }
        : {}),
    };
    const orderBy: Prisma.GlossaryTermOrderByWithRelationInput[] =
      params.sort === 'name'
        ? [{ term: 'asc' }]
        : params.sort === 'lastSeen'
          ? [{ lastSeenAt: { sort: 'desc', nulls: 'last' } }, { term: 'asc' }]
          : [{ mentionCount: 'desc' }, { term: 'asc' }];
    const [terms, total] = await Promise.all([
      this.prisma.glossaryTerm.findMany({ where, orderBy, take, skip }),
      this.prisma.glossaryTerm.count({ where }),
    ]);
    const pending = await this.pendingCounts(terms.map((term) => term.id));
    return {
      entities: terms.map((term) => ({
        ...this.glossary.toDto(term),
        pendingCandidates: pending.get(term.id) ?? 0,
      })),
      total,
    };
  }

  private async pendingCounts(termIds: string[]): Promise<Map<string, number>> {
    if (!termIds.length) return new Map();
    const rows = await this.prisma.entityValue.groupBy({
      by: ['termId'],
      where: { termId: { in: termIds }, verdict: 'PROPOSED' },
      _count: { _all: true },
    });
    return new Map(rows.map((row) => [row.termId, row._count._all]));
  }

  // ── One entity ──────────────────────────────────────────────────────────

  async resolveEntity(idOrKey: string) {
    const term = await this.glossary.resolveOrThrow(idOrKey);
    if (term.kind !== 'ENTITY') {
      throw new BadRequestException(
        `"${term.term}" is a concept. Only entities have values and mentions.`,
      );
    }
    return term;
  }

  /**
   * What the entity page adds to the term page: values, live counters, the
   * anchor record, pending candidates and, for a merged entity, where it went.
   */
  async get(idOrKey: string) {
    const term = await this.resolveEntity(idOrKey);
    const [values, live, anchor, replacedBy, enabled] = await Promise.all([
      this.values.list(term.id),
      this.mentions.counters([term.id]),
      this.anchorAsset(term.anchorUrn),
      term.replacedById
        ? this.prisma.glossaryTerm.findUnique({
            where: { id: term.replacedById },
            select: { id: true, key: true, term: true },
          })
        : Promise.resolve(null),
      this.switchService.isEnabled(),
    ]);
    const counters = live.get(term.id) ?? {
      mentionCount: 0,
      assetCount: 0,
      sourceCount: 0,
      firstSeenAt: term.firstSeenAt,
      lastSeenAt: term.lastSeenAt,
    };
    return {
      ...this.glossary.toDto(term),
      ...counters,
      // Mentions link (and count towards meaning) only once it is approved.
      linking: term.status === 'APPROVED' && enabled,
      featureEnabled: enabled,
      anchor,
      mergedInto: term.mergedAt ? replacedBy : null,
      values: values.filter((value) => value.verdict === 'CONFIRMED'),
      candidates: values.filter((value) => value.verdict === 'PROPOSED'),
      rejected: values.filter((value) => value.verdict === 'REJECTED'),
      ambiguous: values.some(
        (value) => value.verdict === 'CONFIRMED' && value.sharedWith.length > 0,
      ),
    };
  }

  private async anchorAsset(urn: string | null) {
    if (!urn) return null;
    const asset = await this.prisma.asset.findFirst({
      where: { urn },
      select: { id: true, name: true, sourceId: true, externalUrl: true },
      orderBy: { updatedAt: 'desc' },
    });
    return { urn, asset };
  }

  // ── Create (R16) ────────────────────────────────────────────────────────

  /**
   * Create an entity, optionally from a finding or an indexed value, which
   * becomes its first alias (a name) or identifier (anything else).
   * An agent's entity is a DRAFT, like every agent term, and links nothing
   * until a person approves it (R22).
   */
  async create(input: CreateEntityInput, actor: EntityActor) {
    const config = await this.switchService.labels();
    let promoted: { label: string; value: string } | null = null;
    let refId: string | undefined;
    if (input.findingId) {
      const finding = await this.prisma.finding.findUnique({
        where: { id: input.findingId },
        select: {
          id: true,
          findingType: true,
          matchedContent: true,
          metadata: true,
        },
      });
      if (!finding) {
        throw new NotFoundException(`Finding ${input.findingId} not found`);
      }
      // A code detector's value is the one it declared (contract C2).
      const declared = (finding.metadata as Record<string, unknown> | null)
        ?.normalized_value;
      promoted = {
        label: finding.findingType,
        value:
          typeof declared === 'string' && declared.trim()
            ? declared
            : finding.matchedContent,
      };
      refId = finding.id;
    } else if (input.value?.label && input.value.value) {
      promoted = { label: input.value.label, value: input.value.value };
    }

    const nameType = promoted ? nameLabelType(promoted.label, config) : null;
    const name = (input.name ?? (nameType ? promoted?.value : '') ?? '').trim();
    if (!name) {
      throw new BadRequestException(
        promoted
          ? `"${promoted.value}" is a ${normalizeLabel(promoted.label)} value, not a name. Give the entity a name; the value becomes its identifier.`
          : 'An entity needs a name.',
      );
    }
    const aliases = [...(input.aliases ?? [])];
    // A promoted name that is not the entity's name is its first alias.
    if (
      promoted &&
      nameType &&
      promoted.value.trim().toLowerCase() !== name.toLowerCase()
    ) {
      aliases.push(promoted.value.trim());
    }

    const saved = await this.glossary.upsert({
      term: name,
      kind: 'ENTITY',
      entityType: entityTypeFor(input.entityType, nameType),
      aliases,
      definition: input.definition,
      notes: input.notes,
      origin: actor.isAgent ? 'AGENT' : 'OPERATOR',
      author: actor.name,
      createNew: input.createNew,
      ...(refId ? { refType: 'finding', refId } : {}),
    });

    // Exact values now, not when the event listener gets to it: the caller is
    // about to look at the mentions.
    await this.values.syncTerm(saved.id, { emit: false });
    const conflicts: Array<{
      label: string;
      value: string;
      heldBy: { id: string; term: string; key: string };
    }> = [];
    const identifiers = [...(input.identifiers ?? [])];
    if (promoted && !nameType) identifiers.push(promoted);
    for (const identifier of identifiers) {
      const result = await this.values.confirmValue(
        saved.id,
        identifier,
        actor,
        promoted === identifier ? 'MANUAL' : 'IDENTIFIER',
      );
      if (result.conflict) {
        conflicts.push({ ...identifier, heldBy: result.conflict });
      }
    }
    this.values.changed([saved.id]);
    await this.mentions.recount([saved.id]);
    await this.resolution.scheduleResolveTerms([saved.id], 'entity created');
    return { ...(await this.get(saved.id)), merged: saved.merged, conflicts };
  }

  /** Edit what only entities have: the anchor record and free-form attributes. */
  async update(
    idOrKey: string,
    input: {
      anchorUrn?: string | null;
      attributes?: Record<string, unknown> | null;
    },
    actor: EntityActor,
  ) {
    const term = await this.resolveEntity(idOrKey);
    if (
      input.attributes != null &&
      (typeof input.attributes !== 'object' || Array.isArray(input.attributes))
    ) {
      throw new BadRequestException('attributes is an object');
    }
    const anchorUrn =
      input.anchorUrn === undefined
        ? undefined
        : input.anchorUrn?.trim() || null;
    await this.prisma.glossaryTerm.update({
      where: { id: term.id },
      data: {
        ...(anchorUrn !== undefined ? { anchorUrn } : {}),
        ...(input.attributes !== undefined
          ? {
              attributes:
                (input.attributes as Prisma.InputJsonValue | null) ??
                Prisma.DbNull,
            }
          : {}),
      },
    });
    if (anchorUrn !== undefined) await this.anchor(term.id, anchorUrn);
    await recordGlossaryActivity(this.prisma, {
      type: 'TERM_UPDATED',
      termId: term.id,
      actor: actor.name,
      payload: {
        ...(anchorUrn !== undefined
          ? { anchorUrn: { from: term.anchorUrn, to: anchorUrn } }
          : {}),
        ...(input.attributes !== undefined ? { attributes: 'changed' } : {}),
      },
    });
    return this.get(term.id);
  }

  /**
   * The graph edge from an entity to the record that *is* it (R19): class
   * IDENTITY, so a meaning trace from the entity reaches its register entry
   * and everything that record leads to. One anchor per entity.
   */
  private async anchor(termId: string, urn: string | null): Promise<void> {
    await this.prisma.$executeRaw`
      DELETE FROM edges
       WHERE from_type = 'term' AND from_id = ${termId}
         AND relation_type = ${ANCHOR_RELATION}`;
    if (!urn) return;
    const asset = await this.prisma.asset.findFirst({
      where: { urn },
      select: { id: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (!asset) return;
    await this.prisma.edge.upsert({
      where: {
        fromType_fromId_toType_toId_relationType: {
          fromType: 'term',
          fromId: termId,
          toType: 'asset',
          toId: asset.id,
          relationType: ANCHOR_RELATION,
        },
      },
      create: {
        fromType: 'term',
        fromId: termId,
        toType: 'asset',
        toId: asset.id,
        relationType: ANCHOR_RELATION,
        relationClass: 'IDENTITY',
        origin: 'SOURCE_DERIVED',
        method: 'SYSTEM_CATALOG',
        metadata: { urn },
      },
      update: { lastSeenAt: new Date() },
    });
  }

  // ── Sources declaring entities (R12, R13) ───────────────────────────────

  /**
   * Upsert the entity a source declared with a record, idempotent by the
   * record's URN. The register is the authority: a declared entity is
   * `origin=CONNECTOR` and APPROVED from the start, and its identifiers are
   * CONFIRMED. A later declaration never overwrites what an operator edited:
   * it only adds aliases, identifiers and attributes, and it leaves the
   * entity's status alone.
   */
  async declare(
    input: EntityDeclaration,
  ): Promise<{ termId: string; key: string; created: boolean } | null> {
    const declared = input.entity;
    const name = typeof declared?.name === 'string' ? declared.name.trim() : '';
    if (!name) return null;
    // Idempotent by URN, or by the key the source chose: with neither, every
    // scan would create the entity again.
    if (!input.urn && !declared.key) return null;
    const actor: EntityActor = { name: `connector:${input.sourceId}` };
    const wantedKey =
      typeof declared.key === 'string' && isValidKey(declared.key.toLowerCase())
        ? declared.key.toLowerCase()
        : undefined;
    const existing =
      (input.urn
        ? await this.prisma.glossaryTerm.findFirst({
            where: { anchorUrn: input.urn, kind: 'ENTITY' },
            orderBy: { createdAt: 'asc' },
          })
        : null) ??
      (wantedKey
        ? await this.prisma.glossaryTerm.findFirst({
            where: {
              kind: 'ENTITY',
              OR: [{ key: wantedKey }, { previousKeys: { has: wantedKey } }],
            },
          })
        : null);
    // A merged entity redirects: the record now belongs to its successor.
    const target =
      existing?.status === 'DEPRECATED' && existing.replacedById
        ? await this.prisma.glossaryTerm.findUnique({
            where: { id: existing.replacedById },
          })
        : existing;
    const aliases = [
      ...(Array.isArray(declared.aliases) ? declared.aliases : []),
      ...(target && target.term.toLowerCase() !== name.toLowerCase()
        ? [name]
        : []),
    ].filter((alias): alias is string => typeof alias === 'string');
    const attributes =
      declared.attributes &&
      typeof declared.attributes === 'object' &&
      !Array.isArray(declared.attributes)
        ? {
            ...declared.attributes,
            ...((target?.attributes as Record<string, unknown> | null) ?? {}),
          }
        : undefined;
    const saved = await this.glossary.upsert({
      ...(target ? { id: target.id } : { createNew: true }),
      term: target?.term ?? name,
      kind: 'ENTITY',
      entityType: target?.entityType ?? entityTypeFor(declared.type, null),
      aliases,
      origin: 'CONNECTOR',
      author: actor.name,
      ...(!target && wantedKey ? { key: wantedKey } : {}),
      // An entity an operator anchored elsewhere keeps its anchor.
      ...(input.urn && !target?.anchorUrn ? { anchorUrn: input.urn } : {}),
      ...(attributes ? { attributes } : {}),
      refType: 'source',
      refId: input.sourceId,
    });
    await this.values.syncTerm(saved.id, { emit: false });
    for (const [label, value] of Object.entries(declared.identifiers ?? {})) {
      if (typeof value !== 'string' || !value.trim()) continue;
      try {
        await this.values.confirmValue(
          saved.id,
          { label, value },
          actor,
          'CONNECTOR',
        );
      } catch (error) {
        // One unusable identifier must not lose the entity or the scan.
        this.logger.debug(
          `Declared identifier ${label} of "${name}" skipped: ${String(error)}`,
        );
      }
    }
    if (input.urn && saved.anchorUrn === input.urn) {
      await this.anchor(saved.id, input.urn);
    }
    if (!target) {
      await recordGlossaryActivity(this.prisma, {
        type: 'ENTITY_DECLARED',
        termId: saved.id,
        actor: actor.name,
        payload: { urn: input.urn, assetId: input.assetId },
      });
    }
    this.values.changed([saved.id]);
    return { termId: saved.id, key: saved.key, created: !target };
  }

  /**
   * The declarations of one ingest batch. A source re-declares its records on
   * every scan, so the common case is "nothing changed": two reads for the
   * whole batch settle that, and only a new or changed declaration is written.
   */
  async declareMany(
    declarations: EntityDeclaration[],
  ): Promise<{ declared: number; created: number; unchanged: number }> {
    const out = { declared: 0, created: 0, unchanged: 0 };
    if (!declarations.length || !(await this.switchService.isEnabled())) {
      return out;
    }
    const urns = declarations
      .map((d) => d.urn)
      .filter((urn): urn is string => Boolean(urn));
    const anchored = urns.length
      ? await this.prisma.glossaryTerm.findMany({
          where: { anchorUrn: { in: urns }, kind: 'ENTITY' },
          select: {
            id: true,
            anchorUrn: true,
            term: true,
            aliases: true,
            status: true,
            attributes: true,
            replacedById: true,
          },
          orderBy: { createdAt: 'asc' },
        })
      : [];
    // A merged entity redirects: its record is compared with (and declared
    // onto) the entity it was merged into, so a scan never undoes a merge.
    const successorIds = anchored
      .filter((term) => term.status === 'DEPRECATED' && term.replacedById)
      .map((term) => term.replacedById!);
    const successors = successorIds.length
      ? await this.prisma.glossaryTerm.findMany({
          where: { id: { in: successorIds }, kind: 'ENTITY' },
          select: {
            id: true,
            anchorUrn: true,
            term: true,
            aliases: true,
            status: true,
            attributes: true,
            replacedById: true,
          },
        })
      : [];
    const successorById = new Map(successors.map((term) => [term.id, term]));
    const byUrn = new Map<string, (typeof anchored)[number]>();
    // Oldest first, so the entity a record was first declared as wins.
    for (const term of anchored) {
      const target =
        term.status === 'DEPRECATED' && term.replacedById
          ? (successorById.get(term.replacedById) ?? term)
          : term;
      if (!byUrn.has(term.anchorUrn!)) byUrn.set(term.anchorUrn!, target);
    }
    const targets = [...new Set([...byUrn.values()].map((term) => term.id))];
    const held = targets.length
      ? await this.prisma.entityValue.findMany({
          // Every value the entity already knows, whatever was decided about
          // it: a declared identifier that is waiting as a conflict, or that a
          // person rejected, is not news on the next scan.
          where: { termId: { in: targets } },
          select: { termId: true, valueHash: true },
        })
      : [];
    const hashesOf = new Map<string, Set<string>>();
    for (const row of held) {
      const set = hashesOf.get(row.termId) ?? new Set<string>();
      set.add(row.valueHash);
      hashesOf.set(row.termId, set);
    }
    const touched: string[] = [];
    for (const declaration of declarations) {
      const existing = declaration.urn ? byUrn.get(declaration.urn) : null;
      if (
        existing &&
        this.declarationUnchanged(
          existing,
          hashesOf.get(existing.id) ?? new Set(),
          declaration.entity,
        )
      ) {
        out.unchanged += 1;
        continue;
      }
      try {
        const result = await this.declare(declaration);
        if (!result) continue;
        out.declared += 1;
        if (result.created) out.created += 1;
        touched.push(result.termId);
      } catch (error) {
        // One bad declaration must not lose the batch: the asset is ingested.
        this.logger.warn(
          `Entity declaration on asset ${declaration.assetId} skipped: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    if (touched.length) {
      await this.mentions.recount(touched);
      await this.resolution.scheduleResolveTerms(touched, 'entities declared');
    }
    return out;
  }

  private declarationUnchanged(
    existing: {
      term: string;
      aliases: string[];
      status: string;
      attributes: Prisma.JsonValue | null;
    },
    heldHashes: Set<string>,
    declared: DeclaredEntity,
  ): boolean {
    if (existing.status === 'DEPRECATED') return false;
    const names = new Set(
      [existing.term, ...existing.aliases].map((name) => name.toLowerCase()),
    );
    for (const name of [declared.name, ...(declared.aliases ?? [])]) {
      if (!names.has(name.trim().toLowerCase())) return false;
    }
    for (const [label, value] of Object.entries(declared.identifiers ?? {})) {
      const normalized = normalizeValue(label, value);
      // An identifier that normalises to nothing is never stored either.
      if (normalized && !heldHashes.has(valueHash(label, normalized))) {
        return false;
      }
    }
    const attributes =
      (existing.attributes as Record<string, unknown> | null) ?? {};
    return Object.keys(declared.attributes ?? {}).every(
      (key) => key in attributes,
    );
  }

  /**
   * Replay the declarations already stored on assets — for entities turned on
   * after a register was scanned, and after an import. Paged by asset id.
   */
  async replayDeclarations(): Promise<{ declared: number; created: number }> {
    const totals = { declared: 0, created: 0 };
    let after = '';
    for (;;) {
      const rows = await this.prisma.$queryRaw<
        Array<{
          id: string;
          urn: string | null;
          source_id: string;
          metadata: unknown;
        }>
      >`
        SELECT id, urn, source_id, metadata FROM assets
         WHERE metadata ? ${ENTITY_DECLARATION_KEY} AND id > ${after}
         ORDER BY id LIMIT 500`;
      if (!rows.length) break;
      after = rows[rows.length - 1].id;
      const declarations: EntityDeclaration[] = [];
      for (const row of rows) {
        const entity = declaredEntityOf(row.metadata);
        if (entity) {
          declarations.push({
            assetId: row.id,
            urn: row.urn,
            sourceId: row.source_id,
            entity,
          });
        }
      }
      const result = await this.declareMany(declarations);
      totals.declared += result.declared;
      totals.created += result.created;
      if (rows.length < 500) break;
    }
    return totals;
  }
}
