import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  GlossaryEntityType,
  GlossaryOrigin,
  GlossaryReferenceRole,
  GlossaryScheme,
  GlossaryStatus,
  GlossaryTerm,
  GlossaryTermKind,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { EmbeddingQueueService } from '../embedding/embedding-queue.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { QueryEmbeddingService } from '../embedding/query-embedding.service';
import { embeddingContentHash } from '../embedding/embedding-text';
import { vectorCast } from '../embedding/embedding-vector';
import {
  MAX_PREVIOUS_KEYS,
  cleanLabels,
  generateKey,
  glossaryNorm,
  isValidKey,
  matchKeysFor,
} from './glossary-norm';
import { recordGlossaryActivity } from './glossary-activity';
import { glossaryEvents } from './glossary-events';

export type GlossaryUpsertInput = {
  id?: string;
  term: string;
  aliases?: string[];
  entityType?: GlossaryEntityType;
  notes?: string | null;
  refType?: string;
  refId?: string;
  origin: 'AGENT' | 'OPERATOR';
  author?: string;
  verified?: boolean;
  // SL1
  kind?: GlossaryTermKind;
  /** Operators only, on edit (R2). Agents never set keys. */
  key?: string;
  definition?: string | null;
  codes?: string[];
  hiddenAliases?: string[];
  schemeId?: string | null;
  schemeKey?: string | null;
  steward?: string | null;
  /** Requested status for operator writes (imports may ask for DRAFT). */
  status?: GlossaryStatus;
  sourceIri?: string | null;
  packKey?: string | null;
  /** Create a new ENTITY even when one with the same name exists (R4). */
  createNew?: boolean;
};

export type GlossaryMatchedOn =
  | 'term'
  | 'alias'
  | 'code'
  | 'hiddenAlias'
  | 'semantic';

export type GlossaryTermView = ReturnType<GlossaryService['toDto']>;

export type GlossaryLookupHit = GlossaryTermView & {
  /** Kept for existing callers; `matchedOn` is the precise answer. */
  matchType: 'exact' | 'alias' | 'partial' | 'semantic';
  matchedOn: GlossaryMatchedOn;
  deprecated: boolean;
  replacedBy?: { id: string; key: string; term: string } | null;
  similarity?: number;
};

export type GlossaryListParams = {
  query?: string;
  entityType?: GlossaryEntityType;
  kind?: GlossaryTermKind;
  schemeId?: string;
  schemeKey?: string;
  status?: GlossaryStatus | GlossaryStatus[];
  steward?: string;
  take?: number;
  skip?: number;
};

export type GlossaryLookupOptions = {
  kind?: GlossaryTermKind;
  schemeId?: string;
  schemeKey?: string;
  status?: GlossaryStatus[];
  includeDeprecated?: boolean;
};

/** How many candidates a lookup reads before ranking cuts to `limit`. */
const LEXICAL_OVERFETCH = 5;

/** Hard ceiling on that over-fetch, so a one-letter query stays bounded. */
const LEXICAL_FETCH_CAP = 200;

const MAX_DEFINITION = 10_000;
const MAX_STEWARD = 200;

type TermWithScheme = GlossaryTerm & { scheme?: GlossaryScheme | null };

/**
 * Lexical ranking tiers (SL1 R7), lower sorts first:
 * 0 exact term · 1 exact code, case-sensitive · 2 exact alias, code or hidden
 * alias · 3 prefix of the term or an alias · 4 substring of the term, an alias
 * or a code. Hidden aliases are never matched by substring.
 *
 * Matching used to be substring-based with a flat alphabetical order, so `GES`
 * returned Geschäftsführer and Gesellschafter ahead of GmbH — whose code is
 * literally `GES`, the register's own legal-form code for it.
 */
export function lexicalRank(
  raw: string,
  term: Pick<GlossaryTerm, 'term' | 'aliases' | 'codes' | 'hiddenAliases'>,
): { order: number; matchedOn: GlossaryMatchedOn } | null {
  const needle = glossaryNorm(raw);
  if (!needle) return null;
  const trimmed = raw.trim();
  if (glossaryNorm(term.term) === needle) return { order: 0, matchedOn: 'term' };
  if (term.codes.includes(trimmed)) return { order: 1, matchedOn: 'code' };
  if (term.aliases.some((alias) => glossaryNorm(alias) === needle)) {
    return { order: 2, matchedOn: 'alias' };
  }
  if (term.codes.some((code) => glossaryNorm(code) === needle)) {
    return { order: 2, matchedOn: 'code' };
  }
  if (term.hiddenAliases.some((alias) => glossaryNorm(alias) === needle)) {
    return { order: 2, matchedOn: 'hiddenAlias' };
  }
  const name = glossaryNorm(term.term);
  if (name.startsWith(needle)) return { order: 3, matchedOn: 'term' };
  if (term.aliases.some((alias) => glossaryNorm(alias).startsWith(needle))) {
    return { order: 3, matchedOn: 'alias' };
  }
  if (name.includes(needle)) return { order: 4, matchedOn: 'term' };
  if (term.aliases.some((alias) => glossaryNorm(alias).includes(needle))) {
    return { order: 4, matchedOn: 'alias' };
  }
  if (term.codes.some((code) => glossaryNorm(code).includes(needle))) {
    return { order: 4, matchedOn: 'code' };
  }
  return null;
}

function legacyMatchType(order: number): GlossaryLookupHit['matchType'] {
  if (order === 0) return 'exact';
  if (order <= 2) return 'alias';
  return 'partial';
}

/**
 * The glossary (SL1): concepts and entities in one model, with stable keys,
 * schemes, a status lifecycle and SKOS-shaped labels. Operators curate it; agents
 * propose DRAFT terms and aliases. Terms are embedded through the shared content
 * store so lookups resolve semantically as well as lexically.
 */
@Injectable()
export class GlossaryService {
  private readonly logger = new Logger(GlossaryService.name);

  // Query params arrive as strings (no global ValidationPipe), so numeric
  // inputs must be coerced here before they reach Prisma.
  private toInt(value: unknown, fallback: number, max: number): number {
    const parsed = Math.trunc(Number(value));
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return Math.min(parsed, max);
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: EmbeddingQueueService,
    private readonly embeddings: EmbeddingService,
    private readonly queryEmbedding: QueryEmbeddingService,
  ) {}

  /**
   * Term, aliases, codes, definition and notes (R7). Hidden aliases are
   * excluded, so misspellings and single letters do not pull the vector.
   */
  embeddingText(term: {
    term: string;
    aliases: string[];
    codes?: string[];
    definition?: string | null;
    notes?: string | null;
  }): string {
    return [
      term.term,
      ...term.aliases,
      ...(term.codes ?? []),
      term.definition ?? '',
      term.notes ?? '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private statusFilter(
    status: GlossaryListParams['status'],
  ): Prisma.GlossaryTermWhereInput {
    if (!status) return {};
    const list = Array.isArray(status) ? status : [status];
    return list.length ? { status: { in: list } } : {};
  }

  private async listWhere(
    params: GlossaryListParams,
  ): Promise<Prisma.GlossaryTermWhereInput> {
    const schemeId = params.schemeId
      ? params.schemeId === 'none'
        ? null
        : params.schemeId
      : params.schemeKey
        ? ((await this.prisma.glossaryScheme.findUnique({
            where: { key: params.schemeKey },
            select: { id: true },
          })) ?? { id: '__missing__' }).id
        : undefined;
    return {
      ...(params.entityType ? { entityType: params.entityType } : {}),
      ...(params.kind ? { kind: params.kind } : {}),
      ...(schemeId !== undefined ? { schemeId } : {}),
      ...this.statusFilter(params.status),
      ...(params.steward
        ? { steward: { contains: params.steward, mode: 'insensitive' } }
        : {}),
      ...(params.query
        ? {
            OR: [
              { term: { contains: params.query, mode: 'insensitive' } },
              { key: { contains: params.query.toLowerCase() } },
              { aliases: { has: params.query } },
              { codes: { has: params.query } },
              { matchKeys: { has: glossaryNorm(params.query) } },
              { notes: { contains: params.query, mode: 'insensitive' } },
              { definition: { contains: params.query, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
  }

  async list(params: GlossaryListParams) {
    const where = await this.listWhere(params);
    const [terms, total] = await Promise.all([
      this.prisma.glossaryTerm.findMany({
        where,
        include: { scheme: true },
        orderBy: { term: 'asc' },
        take: this.toInt(params.take ?? 25, 25, 500),
        skip: this.toInt(params.skip ?? 0, 0, Number.MAX_SAFE_INTEGER),
      }),
      this.prisma.glossaryTerm.count({ where }),
    ]);
    return { terms: terms.map((term) => this.toDto(term)), total };
  }

  // ── Resolution (C8) ────────────────────────────────────────────────────────

  /** Resolution order everywhere: id, then key, then previousKeys (R2). */
  async resolve(idOrKey: string): Promise<TermWithScheme | null> {
    const value = idOrKey.trim();
    if (!value) return null;
    const byId = await this.prisma.glossaryTerm.findUnique({
      where: { id: value },
      include: { scheme: true },
    });
    if (byId) return byId;
    const key = value.toLowerCase();
    const byKey = await this.prisma.glossaryTerm.findUnique({
      where: { key },
      include: { scheme: true },
    });
    if (byKey) return byKey;
    return this.prisma.glossaryTerm.findFirst({
      where: { previousKeys: { has: key } },
      include: { scheme: true },
    });
  }

  async resolveOrThrow(idOrKey: string): Promise<TermWithScheme> {
    const term = await this.resolve(idOrKey);
    if (!term) throw new NotFoundException(`Glossary term ${idOrKey} not found`);
    return term;
  }

  /** Resolve many keys at once: current keys first, then previous keys. */
  async resolveKeys(keys: string[]): Promise<Map<string, GlossaryTerm>> {
    const wanted = [...new Set(keys.map((key) => key.trim().toLowerCase()))];
    const out = new Map<string, GlossaryTerm>();
    if (wanted.length === 0) return out;
    const rows = await this.prisma.glossaryTerm.findMany({
      where: {
        OR: [{ key: { in: wanted } }, { previousKeys: { hasSome: wanted } }],
      },
    });
    for (const row of rows) {
      if (wanted.includes(row.key)) out.set(row.key, row);
    }
    for (const row of rows) {
      for (const previous of row.previousKeys) {
        if (wanted.includes(previous) && !out.has(previous)) {
          out.set(previous, row);
        }
      }
    }
    return out;
  }

  private async keyTaken(candidate: string, exceptId?: string) {
    const clash = await this.prisma.glossaryTerm.findFirst({
      where: {
        OR: [{ key: candidate }, { previousKeys: { has: candidate } }],
        ...(exceptId ? { NOT: { id: exceptId } } : {}),
      },
      select: { id: true },
    });
    return clash !== null;
  }

  async generateKey(name: string): Promise<string> {
    return generateKey(name, (candidate) => this.keyTaken(candidate));
  }

  private async resolveSchemeId(input: {
    schemeId?: string | null;
    schemeKey?: string | null;
  }): Promise<string | null | undefined> {
    if (input.schemeId === null || input.schemeKey === null) return null;
    if (input.schemeId) {
      const scheme = await this.prisma.glossaryScheme.findUnique({
        where: { id: input.schemeId },
        select: { id: true },
      });
      if (!scheme) {
        throw new BadRequestException(`Scheme ${input.schemeId} not found`);
      }
      return scheme.id;
    }
    if (input.schemeKey) {
      const scheme = await this.prisma.glossaryScheme.findUnique({
        where: { key: input.schemeKey.trim().toLowerCase() },
        select: { id: true },
      });
      if (!scheme) {
        throw new BadRequestException(
          `Scheme "${input.schemeKey}" not found. Look schemes up with list_glossary_schemes; a scheme is never invented for a single term.`,
        );
      }
      return scheme.id;
    }
    return undefined;
  }

  // Machine-style identifiers (snake/kebab slugs, uuid fragments, long hex)
  // are memory keys, not vocabulary. Rejecting them at the boundary keeps the
  // operator-facing glossary human and teaches agents in-run.
  private looksLikeMachineSlug(term: string): boolean {
    return (
      /^[a-z0-9]+([_-][a-z0-9]+)+$/.test(term) ||
      /[0-9a-f]{8,}/i.test(term.replace(/\s/g, ''))
    );
  }

  private deletionKey(term: string): string {
    const normalized = term.trim().toLowerCase().replace(/\s+/g, ' ');
    const slug = normalized
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 160);
    const digest = createHash('sha256')
      .update(normalized)
      .digest('hex')
      .slice(0, 12);
    return `deleted-glossary-${slug || 'term'}-${digest}`;
  }

  /** Relation types a term of `kind` may take part in (R1, R5). */
  private async assertKindChangeAllowed(
    termId: string,
    kind: GlossaryTermKind,
  ): Promise<void> {
    const relations = await this.prisma.glossaryRelation.findMany({
      where: { OR: [{ fromTermId: termId }, { toTermId: termId }] },
      include: {
        from: { select: { key: true, term: true } },
        to: { select: { key: true, term: true } },
      },
    });
    const offending = relations.filter((relation) => {
      const isFrom = relation.fromTermId === termId;
      if (kind === 'CONCEPT') {
        // A concept cannot be the subject of INSTANCE_OF.
        return relation.type === 'INSTANCE_OF' && isFrom;
      }
      // An entity takes part only as the subject of INSTANCE_OF.
      return !(relation.type === 'INSTANCE_OF' && isFrom);
    });
    if (offending.length) {
      throw new ConflictException({
        message: `Changing the kind to ${kind} would break ${offending.length} relation(s). Remove them first.`,
        relations: offending.map((relation) => ({
          id: relation.id,
          type: relation.type,
          label: relation.label,
          from: relation.from.key,
          to: relation.to.key,
        })),
      });
    }
  }

  private async findExisting(
    input: GlossaryUpsertInput,
    term: string,
    kind: GlossaryTermKind,
    schemeId: string | null | undefined,
  ): Promise<GlossaryTerm | null> {
    if (input.id) {
      const edited = await this.prisma.glossaryTerm.findUnique({
        where: { id: input.id },
      });
      if (!edited) {
        throw new NotFoundException(`Glossary term ${input.id} not found`);
      }
      return edited;
    }
    if (kind === 'ENTITY') {
      // Entity names are not unique (R4): an operator can deliberately create a
      // second "Jane Doe". Agents (and MCP upserts without `createNew`) land on
      // the existing entity so a repeated proposal does not multiply people.
      if (input.createNew && input.origin === 'OPERATOR') return null;
      return this.prisma.glossaryTerm.findFirst({
        where: { kind, term: { equals: term, mode: 'insensitive' } },
        orderBy: { createdAt: 'asc' },
      });
    }
    return this.prisma.glossaryTerm.findFirst({
      where: {
        kind,
        schemeId: schemeId ?? null,
        term: { equals: term, mode: 'insensitive' },
      },
    });
  }

  async upsert(input: GlossaryUpsertInput) {
    const term = input.term.trim();
    if (!term) throw new BadRequestException('Glossary term cannot be empty');
    if (term.length > 200) {
      throw new BadRequestException('Glossary term is at most 200 characters');
    }
    await this.assertValidReference(input.refType, input.refId);
    if (input.origin === 'AGENT' && this.looksLikeMachineSlug(term)) {
      throw new BadRequestException(
        `"${term}" looks like a machine identifier, not vocabulary. Glossary terms are real-world names as a human writes them ("Jane Doe", "Project Aurora", "NHS number"). Observations and summaries belong in memory.write, not the glossary.`,
      );
    }
    if (input.origin === 'AGENT' && input.key) {
      throw new BadRequestException(
        'Agents never set keys; the server generates them.',
      );
    }
    if (input.definition && input.definition.length > MAX_DEFINITION) {
      throw new BadRequestException(
        `Definition is at most ${MAX_DEFINITION} characters`,
      );
    }
    if (input.steward && input.steward.length > MAX_STEWARD) {
      throw new BadRequestException(
        `Steward is at most ${MAX_STEWARD} characters`,
      );
    }
    if (input.origin === 'AGENT') {
      const deleted = await this.prisma.agentMemory.findUnique({
        where: {
          kind_key: {
            kind: 'DECISION_PRECEDENT',
            key: this.deletionKey(term),
          },
        },
        select: { id: true },
      });
      if (deleted) {
        throw new BadRequestException(
          `"${term}" was deleted by an operator and cannot be re-proposed`,
        );
      }
    }
    const aliases = cleanLabels(input.aliases);
    const codes = cleanLabels(input.codes, { caseSensitive: true });
    const hiddenAliases = cleanLabels(input.hiddenAliases);
    const schemeId = await this.resolveSchemeId(input);
    const kind: GlossaryTermKind =
      input.kind ??
      (input.entityType &&
      ['PERSON', 'ORGANIZATION', 'LOCATION'].includes(input.entityType)
        ? 'ENTITY'
        : 'CONCEPT');

    const existing = await this.findExisting(
      input,
      term,
      input.id ? (input.kind ?? kind) : kind,
      schemeId,
    );

    // Agent aliases for operator vocabulary stay in a separate pending list.
    // They are deliberately excluded from lexical and semantic lookup until
    // an operator accepts them by saving the term. Agents never edit operator
    // items (rule SL-8).
    if (existing && existing.origin === 'OPERATOR' && input.origin === 'AGENT') {
      const proposedAliases = [
        ...new Set([
          ...existing.proposedAliases,
          ...[...aliases, ...codes].filter(
            (alias) =>
              !existing.aliases.includes(alias) &&
              !existing.codes.includes(alias),
          ),
        ]),
      ];
      const updated =
        proposedAliases.length === existing.proposedAliases.length
          ? existing
          : await this.prisma.glossaryTerm.update({
              where: { id: existing.id },
              data: { proposedAliases },
            });
      if (updated !== existing) {
        await recordGlossaryActivity(this.prisma, {
          type: 'ALIAS_PROPOSED',
          termId: existing.id,
          actor: input.author ?? 'agent',
          payload: {
            aliases: proposedAliases.filter(
              (alias) => !existing.proposedAliases.includes(alias),
            ),
          },
        });
      }
      await this.linkReference(updated.id, input);
      return { ...this.toDto(updated), merged: true };
    }

    const nextKind = input.kind ?? existing?.kind ?? kind;
    if (existing && nextKind !== existing.kind) {
      if (input.origin !== 'OPERATOR') {
        throw new BadRequestException('Only operators change a term kind.');
      }
      await this.assertKindChangeAllowed(existing.id, nextKind);
    }

    // Status (R6). Operators approve directly unless they ask for a draft;
    // agents' terms always start as DRAFT.
    let status: GlossaryStatus;
    if (input.origin === 'AGENT') {
      status = existing?.status ?? 'DRAFT';
    } else if (input.status) {
      status = input.status;
    } else if (existing?.status === 'DEPRECATED') {
      status = 'DEPRECATED';
    } else {
      status = 'APPROVED';
    }
    if (input.origin === 'OPERATOR' && input.verified === false) {
      status = 'DRAFT';
    }
    const approved = status === 'APPROVED';
    const approver = input.author ?? input.origin.toLowerCase();

    // Key (R2): generated on create, editable by operators on edit.
    let key = existing?.key;
    let previousKeys = existing?.previousKeys ?? [];
    if (!existing) {
      if (input.key) {
        const wanted = input.key.trim().toLowerCase();
        if (!isValidKey(wanted)) {
          throw new BadRequestException(
            `Key "${input.key}" must match ^[a-z0-9][a-z0-9._-]{0,99}$`,
          );
        }
        if (await this.keyTaken(wanted)) {
          throw new ConflictException(`Key "${wanted}" is already in use`);
        }
        key = wanted;
      } else {
        key = await this.generateKey(term);
      }
    } else if (input.key && input.key.trim().toLowerCase() !== existing.key) {
      const wanted = input.key.trim().toLowerCase();
      if (!isValidKey(wanted)) {
        throw new BadRequestException(
          `Key "${input.key}" must match ^[a-z0-9][a-z0-9._-]{0,99}$`,
        );
      }
      if (await this.keyTaken(wanted, existing.id)) {
        throw new ConflictException(
          `Key "${wanted}" is another term's current or previous key`,
        );
      }
      previousKeys = [
        existing.key,
        ...existing.previousKeys.filter((previous) => previous !== wanted),
      ].slice(0, MAX_PREVIOUS_KEYS);
      key = wanted;
    }

    const nextAliases =
      existing && input.origin !== 'OPERATOR'
        ? [...new Set([...existing.aliases, ...aliases])]
        : input.aliases !== undefined || !existing
          ? aliases
          : existing.aliases;
    const nextCodes =
      existing && input.origin !== 'OPERATOR'
        ? [...new Set([...existing.codes, ...codes])]
        : input.codes !== undefined || !existing
          ? codes
          : existing.codes;
    const nextHidden =
      existing && input.origin !== 'OPERATOR'
        ? [...new Set([...existing.hiddenAliases, ...hiddenAliases])]
        : input.hiddenAliases !== undefined || !existing
          ? hiddenAliases
          : existing.hiddenAliases;
    const nextScheme =
      schemeId !== undefined ? schemeId : (existing?.schemeId ?? null);

    const data = {
      term,
      kind: nextKind,
      key: key!,
      previousKeys,
      aliases: nextAliases,
      codes: nextCodes,
      hiddenAliases: nextHidden,
      matchKeys: matchKeysFor({
        term,
        aliases: nextAliases,
        codes: nextCodes,
        hiddenAliases: nextHidden,
      }),
      entityType:
        input.entityType ??
        existing?.entityType ??
        (nextKind === 'ENTITY' ? 'OTHER' : 'TERM'),
      notes:
        input.notes !== undefined ? input.notes : (existing?.notes ?? null),
      definition:
        input.definition !== undefined
          ? input.definition
          : (existing?.definition ?? null),
      steward:
        input.steward !== undefined
          ? input.steward?.trim() || null
          : (existing?.steward ?? null),
      schemeId: nextScheme,
      sourceIri:
        input.sourceIri !== undefined
          ? input.sourceIri
          : (existing?.sourceIri ?? null),
      packKey:
        input.packKey !== undefined
          ? input.packKey
          : (existing?.packKey ?? null),
      origin: existing?.origin ?? input.origin,
      status,
      // The approval stamp survives edits; it is set when a term becomes
      // APPROVED and cleared when it returns to DRAFT (APPROVED <=> verifiedAt).
      verifiedAt: approved
        ? existing?.status === 'APPROVED' && existing.verifiedAt
          ? existing.verifiedAt
          : new Date()
        : status === 'DEPRECATED'
          ? (existing?.verifiedAt ?? null)
          : null,
      verifiedBy: approved
        ? existing?.status === 'APPROVED' && existing.verifiedBy
          ? existing.verifiedBy
          : approver
        : status === 'DEPRECATED'
          ? (existing?.verifiedBy ?? null)
          : null,
      ...(input.origin === 'OPERATOR' ? { proposedAliases: [] } : {}),
      ...(status !== 'DEPRECATED'
        ? { deprecatedAt: null, replacedById: null }
        : {}),
    } satisfies Prisma.GlossaryTermUncheckedUpdateInput;

    let saved: GlossaryTerm;
    try {
      saved = existing
        ? await this.prisma.glossaryTerm.update({
            where: { id: existing.id },
            data,
          })
        : await this.prisma.glossaryTerm.create({ data });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          `A concept named "${term}" already exists in this scheme`,
        );
      }
      throw error;
    }
    if (input.origin === 'OPERATOR') {
      await this.prisma.agentMemory.deleteMany({
        where: {
          kind: 'DECISION_PRECEDENT',
          key: this.deletionKey(term),
        },
      });
    }
    await this.enqueueEmbedding(saved);
    await this.linkReference(saved.id, input);

    const labelsChanged =
      !existing ||
      existing.term !== saved.term ||
      existing.matchKeys.join('\u0000') !== saved.matchKeys.join('\u0000') ||
      existing.codes.join('\u0000') !== saved.codes.join('\u0000');
    await recordGlossaryActivity(this.prisma, {
      type: existing ? 'TERM_UPDATED' : 'TERM_CREATED',
      termId: saved.id,
      actor: input.author ?? input.origin.toLowerCase(),
      payload: this.changeSummary(existing, saved),
    });
    if (existing && existing.key !== saved.key) {
      await recordGlossaryActivity(this.prisma, {
        type: 'TERM_KEY_CHANGED',
        termId: saved.id,
        actor: input.author ?? 'operator',
        payload: { from: existing.key, to: saved.key },
      });
    }
    if (existing && existing.kind !== saved.kind) {
      await recordGlossaryActivity(this.prisma, {
        type: 'TERM_KIND_CHANGED',
        termId: saved.id,
        actor: input.author ?? 'operator',
        payload: { from: existing.kind, to: saved.kind },
      });
    }
    glossaryEvents.emit({
      type: 'glossary.term_changed',
      change: existing
        ? existing.status !== saved.status && saved.status === 'APPROVED'
          ? 'approved'
          : 'updated'
        : 'created',
      termId: saved.id,
      key: saved.key,
      kind: saved.kind,
      labelsChanged,
      keys: [saved.key],
    });
    const withScheme = saved.schemeId
      ? await this.prisma.glossaryTerm.findUnique({
          where: { id: saved.id },
          include: { scheme: true },
        })
      : saved;
    return { ...this.toDto(withScheme ?? saved), merged: false };
  }

  private changeSummary(
    before: GlossaryTerm | null,
    after: GlossaryTerm,
  ): Prisma.InputJsonValue {
    if (!before) {
      return { term: after.term, kind: after.kind, status: after.status };
    }
    const fields = [
      'term',
      'kind',
      'key',
      'status',
      'definition',
      'steward',
      'schemeId',
      'entityType',
      'notes',
    ] as const;
    const arrays = ['aliases', 'codes', 'hiddenAliases'] as const;
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const field of fields) {
      if (before[field] !== after[field]) {
        changes[field] = { from: before[field], to: after[field] };
      }
    }
    for (const field of arrays) {
      if (before[field].join('\u0000') !== after[field].join('\u0000')) {
        changes[field] = { from: before[field], to: after[field] };
      }
    }
    return changes as Prisma.InputJsonValue;
  }

  private async linkReference(
    glossaryTermId: string,
    input: Pick<GlossaryUpsertInput, 'refType' | 'refId' | 'author'>,
  ): Promise<void> {
    if (!input.refType || !input.refId) return;
    await this.prisma.glossaryReference.createMany({
      data: [
        {
          glossaryTermId,
          entityType: input.refType,
          entityId: input.refId,
          role: GlossaryReferenceRole.PROVENANCE,
          createdBy: input.author,
        },
      ],
      skipDuplicates: true,
    });
  }

  private async assertValidReference(
    refType?: string,
    refId?: string,
  ): Promise<void> {
    if (!refType && !refId) return;
    if (!refType || !refId) {
      throw new BadRequestException(
        'refType and refId must be supplied together',
      );
    }
    const supported = ['case', 'inquiry', 'source', 'finding'] as const;
    if (!supported.includes(refType as (typeof supported)[number])) {
      throw new BadRequestException(
        `Unsupported glossary refType "${refType}"`,
      );
    }
    const exists =
      refType === 'case'
        ? await this.prisma.case.findUnique({
            where: { id: refId },
            select: { id: true },
          })
        : refType === 'inquiry'
          ? await this.prisma.inquiry.findUnique({
              where: { id: refId },
              select: { id: true },
            })
          : refType === 'source'
            ? await this.prisma.source.findUnique({
                where: { id: refId },
                select: { id: true },
              })
            : await this.prisma.finding.findUnique({
                where: { id: refId },
                select: { id: true },
              });
    if (!exists) {
      throw new BadRequestException(
        `Glossary reference ${refType}:${refId} does not exist`,
      );
    }
  }

  async enqueueEmbedding(term: GlossaryTerm): Promise<GlossaryTerm> {
    try {
      const text = this.embeddingText(term);
      const hash = embeddingContentHash(text);
      if (hash !== term.embedContentHash) {
        term = await this.prisma.glossaryTerm.update({
          where: { id: term.id },
          data: { embedContentHash: hash },
        });
      }
      this.queue.enqueue([{ hash, text }]);
    } catch (error) {
      // Embedding is an enhancement; the term itself must always persist.
      this.logger.warn(
        `Failed to enqueue glossary embedding: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return term;
  }

  // ── Status lifecycle (R6) ─────────────────────────────────────────────────

  private async transition(
    idOrKey: string,
    next: GlossaryStatus,
    actor: string,
    options: { replacedById?: string | null } = {},
  ) {
    const existing = await this.resolveOrThrow(idOrKey);
    const allowed: Record<GlossaryStatus, GlossaryStatus[]> = {
      DRAFT: ['APPROVED'],
      APPROVED: ['DRAFT', 'DEPRECATED'],
      DEPRECATED: ['APPROVED'],
    };
    if (existing.status === next) return this.toDto(existing);
    if (!allowed[existing.status].includes(next)) {
      throw new BadRequestException(
        `A ${existing.status} term cannot become ${next}`,
      );
    }
    let replacedById: string | null = null;
    if (next === 'DEPRECATED' && options.replacedById) {
      const successor = await this.resolveOrThrow(options.replacedById);
      if (successor.id === existing.id) {
        throw new BadRequestException('A term cannot replace itself');
      }
      if (successor.status !== 'APPROVED' || successor.kind !== existing.kind) {
        throw new BadRequestException(
          'The successor must be an APPROVED term of the same kind',
        );
      }
      replacedById = successor.id;
    }
    const updated = await this.prisma.glossaryTerm.update({
      where: { id: existing.id },
      data: {
        status: next,
        ...(next === 'APPROVED'
          ? {
              // A reinstated term keeps its original approval stamp; an
              // approval out of DRAFT is stamped by whoever approved it.
              verifiedAt:
                existing.status === 'DEPRECATED'
                  ? (existing.verifiedAt ?? new Date())
                  : new Date(),
              verifiedBy:
                existing.status === 'DEPRECATED'
                  ? (existing.verifiedBy ?? actor)
                  : actor,
              deprecatedAt: null,
              replacedById: null,
            }
          : {}),
        ...(next === 'DRAFT'
          ? { verifiedAt: null, verifiedBy: null }
          : {}),
        ...(next === 'DEPRECATED'
          ? { deprecatedAt: new Date(), replacedById }
          : {}),
      },
      include: { scheme: true },
    });
    const change =
      next === 'APPROVED'
        ? existing.status === 'DEPRECATED'
          ? 'reinstated'
          : 'approved'
        : next === 'DRAFT'
          ? 'unapproved'
          : 'deprecated';
    await recordGlossaryActivity(this.prisma, {
      type:
        change === 'approved'
          ? 'TERM_APPROVED'
          : change === 'reinstated'
            ? 'TERM_REINSTATED'
            : change === 'unapproved'
              ? 'TERM_UNAPPROVED'
              : 'TERM_DEPRECATED',
      termId: existing.id,
      actor,
      payload: { from: existing.status, to: next, replacedById },
    });
    glossaryEvents.emit({
      type: 'glossary.term_changed',
      change,
      termId: updated.id,
      key: updated.key,
      kind: updated.kind,
    });
    return this.toDto(updated);
  }

  approve(idOrKey: string, actor = 'operator') {
    return this.transition(idOrKey, 'APPROVED', actor);
  }

  unapprove(idOrKey: string, actor = 'operator') {
    return this.transition(idOrKey, 'DRAFT', actor);
  }

  deprecate(idOrKey: string, replacedById?: string | null, actor = 'operator') {
    return this.transition(idOrKey, 'DEPRECATED', actor, { replacedById });
  }

  reinstate(idOrKey: string, actor = 'operator') {
    return this.transition(idOrKey, 'APPROVED', actor);
  }

  /** `PATCH /glossary/:id/verify` stays as an alias of approve (R6). */
  async verify(id: string, verifiedBy?: string) {
    const existing = await this.resolveOrThrow(id);
    if (existing.status === 'DEPRECATED') {
      return this.reinstate(id, verifiedBy ?? 'operator');
    }
    return this.approve(id, verifiedBy ?? 'operator');
  }

  /**
   * Operator-only batch edit over a selection of terms: approve or unapprove
   * (formerly verify), retype, move between schemes or change kind.
   */
  async bulkUpdate(input: {
    ids?: string[];
    filters?: GlossaryListParams;
    verified?: boolean;
    status?: GlossaryStatus;
    entityType?: GlossaryEntityType;
    schemeId?: string | null;
    kind?: GlossaryTermKind;
    verifiedBy?: string;
  }): Promise<{
    updatedCount: number;
    ids: string[];
    refused?: Array<{ id: string; reason: string }>;
  }> {
    const hasIds = Boolean(input.ids?.length);
    const hasFilters = input.filters !== undefined;
    if (hasIds === hasFilters) {
      throw new BadRequestException(
        'Provide either glossary term ids or filters, but not both.',
      );
    }
    if (
      input.verified === undefined &&
      !input.status &&
      !input.entityType &&
      input.schemeId === undefined &&
      !input.kind
    ) {
      throw new BadRequestException(
        'Provide a status change, a new entity type, a scheme or a kind.',
      );
    }

    const where: Prisma.GlossaryTermWhereInput = hasIds
      ? { id: { in: input.ids } }
      : await this.listWhere(input.filters ?? {});
    const selected = await this.prisma.glossaryTerm.findMany({
      where,
      select: { id: true },
    });
    if (selected.length === 0) return { updatedCount: 0, ids: [] };
    let ids = selected.map((term) => term.id);
    const refused: Array<{ id: string; reason: string }> = [];
    const actor = input.verifiedBy ?? 'operator';

    if (input.kind) {
      const ok: string[] = [];
      for (const id of ids) {
        try {
          await this.assertKindChangeAllowed(id, input.kind);
          ok.push(id);
        } catch (error) {
          refused.push({
            id,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
      ids = ok;
    }
    const schemeId =
      input.schemeId === undefined
        ? undefined
        : await this.resolveSchemeId({ schemeId: input.schemeId });

    const status =
      input.status ??
      (input.verified === true
        ? 'APPROVED'
        : input.verified === false
          ? 'DRAFT'
          : undefined);
    const data: Prisma.GlossaryTermUncheckedUpdateManyInput = {
      ...(input.entityType ? { entityType: input.entityType } : {}),
      ...(input.kind ? { kind: input.kind } : {}),
      ...(schemeId !== undefined ? { schemeId } : {}),
      ...(status === 'APPROVED'
        ? {
            status,
            verifiedAt: new Date(),
            verifiedBy: actor,
            deprecatedAt: null,
            replacedById: null,
          }
        : {}),
      ...(status === 'DRAFT'
        ? { status, verifiedAt: null, verifiedBy: null }
        : {}),
      ...(status === 'DEPRECATED'
        ? { status, deprecatedAt: new Date() }
        : {}),
    };
    let updated: { count: number };
    try {
      updated = await this.prisma.glossaryTerm.updateMany({
        where: { id: { in: ids } },
        data,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Moving these concepts would put two concepts with the same name into one scheme',
        );
      }
      throw error;
    }
    for (const id of ids) {
      await recordGlossaryActivity(this.prisma, {
        type: status === 'APPROVED'
          ? 'TERM_APPROVED'
          : status === 'DRAFT'
            ? 'TERM_UNAPPROVED'
            : status === 'DEPRECATED'
              ? 'TERM_DEPRECATED'
              : input.kind
                ? 'TERM_KIND_CHANGED'
                : 'TERM_UPDATED',
        termId: id,
        actor,
        payload: {
          bulk: true,
          ...(status ? { status } : {}),
          ...(input.kind ? { kind: input.kind } : {}),
          ...(schemeId !== undefined ? { schemeId } : {}),
          ...(input.entityType ? { entityType: input.entityType } : {}),
        },
      });
    }
    if (ids.length) {
      const rows = await this.prisma.glossaryTerm.findMany({
        where: { id: { in: ids } },
        select: { id: true, key: true, kind: true },
      });
      for (const row of rows) {
        glossaryEvents.emit({
          type: 'glossary.term_changed',
          change:
            status === 'APPROVED'
              ? 'approved'
              : status === 'DRAFT'
                ? 'unapproved'
                : status === 'DEPRECATED'
                  ? 'deprecated'
                  : 'updated',
          termId: row.id,
          key: row.key,
          kind: row.kind,
        });
      }
    }
    return {
      updatedCount: updated.count,
      ids,
      ...(refused.length ? { refused } : {}),
    };
  }

  async remove(idOrKey: string, actor = 'operator') {
    const target = await this.resolveOrThrow(idOrKey);
    const id = target.id;
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.glossaryTerm.findUnique({ where: { id } });
      if (!existing)
        throw new NotFoundException(`Glossary term ${id} not found`);
      const key = this.deletionKey(existing.term);
      await tx.agentMemory.upsert({
        where: { kind_key: { kind: 'DECISION_PRECEDENT', key } },
        create: {
          kind: 'DECISION_PRECEDENT',
          key,
          content: `Operator deleted glossary term "${existing.term}". Do not re-propose it.`,
          tags: ['glossary-deletion'],
          origin: 'OPERATOR',
          verifiedAt: new Date(),
          verifiedBy: 'operator',
        },
        update: {
          content: `Operator deleted glossary term "${existing.term}". Do not re-propose it.`,
          origin: 'OPERATOR',
          verifiedAt: new Date(),
          verifiedBy: 'operator',
        },
      });
      await tx.glossaryTerm.delete({ where: { id } });
    });
    await recordGlossaryActivity(this.prisma, {
      type: 'TERM_DELETED',
      termId: id,
      actor,
      payload: { term: target.term, key: target.key, kind: target.kind },
    });
    glossaryEvents.emit({
      type: 'glossary.term_changed',
      change: 'deleted',
      termId: id,
      key: target.key,
      kind: target.kind,
    });
    return { deleted: true, id };
  }

  // ── Lookup (R7) ───────────────────────────────────────────────────────────

  private async lookupScope(options: GlossaryLookupOptions) {
    const schemeId =
      options.schemeId ??
      (options.schemeKey
        ? ((
            await this.prisma.glossaryScheme.findUnique({
              where: { key: options.schemeKey.toLowerCase() },
              select: { id: true },
            })
          )?.id ?? '__missing__')
        : undefined);
    const statuses = new Set<GlossaryStatus>(
      options.status?.length ? options.status : ['DRAFT', 'APPROVED'],
    );
    if (options.includeDeprecated) statuses.add('DEPRECATED');
    return { schemeId, statuses };
  }

  /**
   * Resolve a name, alias, code or hidden alias to glossary terms: exact
   * tiers first, then prefix and substring, then semantic nearest terms when
   * a query embedding is available. An exact hit on a DEPRECATED term is still
   * returned, marked as such, with its successor.
   */
  async lookup(
    query: string,
    limitInput: unknown = 10,
    options: GlossaryLookupOptions = {},
  ): Promise<GlossaryLookupHit[]> {
    const limit = this.toInt(limitInput, 10, 50) || 10;
    const trimmed = query.trim();
    if (!trimmed) return [];
    const needle = glossaryNorm(trimmed);
    const { schemeId, statuses } = await this.lookupScope(options);

    // Exact tiers through the GIN index on match_keys, plus a case-sensitive
    // code hit. Deprecated terms are included here regardless of the filter.
    const exactRows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM glossary_terms
       WHERE match_keys @> ARRAY[${needle}]::text[]
          OR codes @> ARRAY[${trimmed}]::text[]
       LIMIT ${LEXICAL_FETCH_CAP}
    `;
    // Prefix/substring over aliases and codes. Hidden aliases never match by
    // substring. Codes and statute names usually live in aliases ('PKS 725000'),
    // and without embeddings nothing else reached them (GENESIS P10).
    const labelRows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT DISTINCT gt.id
        FROM glossary_terms gt
        CROSS JOIN LATERAL unnest(gt.aliases || gt.codes) AS label
       WHERE strpos(lower(label), lower(${trimmed})) > 0
       LIMIT ${LEXICAL_FETCH_CAP}
    `;
    const exactIds = new Set(exactRows.map((row) => row.id));
    const candidateIds = [
      ...exactIds,
      ...labelRows.map((row) => row.id),
    ];
    const lexical = await this.prisma.glossaryTerm.findMany({
      where: {
        AND: [
          {
            OR: [
              { term: { contains: trimmed, mode: 'insensitive' } },
              { id: { in: candidateIds } },
            ],
          },
          ...(options.kind ? [{ kind: options.kind }] : []),
          ...(schemeId !== undefined ? [{ schemeId }] : []),
        ],
      },
      include: { scheme: true, replacedBy: true },
      take: Math.min(
        limit * LEXICAL_OVERFETCH + exactIds.size,
        LEXICAL_FETCH_CAP,
      ),
      orderBy: { term: 'asc' },
    });

    const ranked = lexical
      .map((term) => ({ term, rank: lexicalRank(trimmed, term) }))
      .filter(
        (
          entry,
        ): entry is {
          term: (typeof lexical)[number];
          rank: { order: number; matchedOn: GlossaryMatchedOn };
        } => entry.rank !== null,
      )
      .filter(
        (entry) =>
          statuses.has(entry.term.status) ||
          (entry.term.status === 'DEPRECATED' && entry.rank.order <= 2),
      )
      // Shortest first inside a tier, so a code resolves to the entry it
      // names rather than to the longest word it happens to be embedded in.
      .sort(
        (a, b) =>
          a.rank.order - b.rank.order ||
          a.term.term.length - b.term.term.length ||
          a.term.term.localeCompare(b.term.term),
      )
      .slice(0, limit);

    const hits: GlossaryLookupHit[] = ranked.map(({ term, rank }) =>
      this.toHit(term, rank.order, rank.matchedOn),
    );
    const seen = new Set(hits.map((hit) => hit.id));

    if (hits.length < limit) {
      const semantic = await this.semanticLookup(
        trimmed,
        limit - hits.length,
        seen,
      );
      hits.push(
        ...semantic.filter(
          (hit) =>
            statuses.has(hit.status) &&
            (!options.kind || hit.kind === options.kind) &&
            (schemeId === undefined || hit.schemeId === schemeId),
        ),
      );
    }
    return hits;
  }

  private toHit(
    term: TermWithScheme & { replacedBy?: GlossaryTerm | null },
    order: number,
    matchedOn: GlossaryMatchedOn,
  ): GlossaryLookupHit {
    return {
      ...this.toDto(term),
      matchType: legacyMatchType(order),
      matchedOn,
      deprecated: term.status === 'DEPRECATED',
      replacedBy: term.replacedBy
        ? {
            id: term.replacedBy.id,
            key: term.replacedBy.key,
            term: term.replacedBy.term,
          }
        : null,
    };
  }

  private async semanticLookup(
    query: string,
    limit: number,
    excludeIds: Set<string>,
  ): Promise<GlossaryLookupHit[]> {
    let vector: number[];
    try {
      vector = await this.queryEmbedding.embed(query);
    } catch {
      return [];
    }
    try {
      const space = await this.embeddings.configuredSpace();
      const dim = Prisma.raw(String(space.dim));
      // Must match the expression ensureHnswIndex built, or the planner
      // silently ignores the index and falls back to a sequential scan.
      const vecType = Prisma.raw(vectorCast(space.dim).type);
      const rows = await this.prisma.$queryRaw<
        Array<{ id: string; score: number }>
      >(Prisma.sql`
        SELECT gt.id, 1 - (
          ce.vec::public.${vecType}(${dim}) <=>
          ${JSON.stringify(vector)}::public.${vecType}(${dim})
        ) AS score
        FROM glossary_terms gt
        JOIN content_embeddings ce
          ON ce.content_hash = gt.embed_content_hash
         AND ce.space_id = ${space.id}
        ORDER BY ce.vec::public.${vecType}(${dim}) <=>
          ${JSON.stringify(vector)}::public.${vecType}(${dim})
        LIMIT ${limit + excludeIds.size}
      `);
      const candidates = rows.filter((row) => !excludeIds.has(row.id));
      const terms = await this.prisma.glossaryTerm.findMany({
        where: { id: { in: candidates.map((row) => row.id) } },
        include: { scheme: true, replacedBy: true },
      });
      const byId = new Map(terms.map((term) => [term.id, term]));
      return candidates.slice(0, limit).flatMap((row) => {
        const term = byId.get(row.id);
        return term
          ? [
              {
                ...this.toHit(term, 5, 'semantic'),
                matchType: 'semantic' as const,
                similarity: Math.round(Number(row.score) * 100) / 100,
              },
            ]
          : [];
      });
    } catch (error) {
      this.logger.warn(
        `Semantic glossary lookup failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  // ── Term page (R10) ──────────────────────────────────────────────────────

  async getTerm(idOrKey: string) {
    const term = await this.resolveOrThrow(idOrKey);
    const [relationsOut, relationsIn, replacedBy, broaderChain] =
      await Promise.all([
        this.prisma.glossaryRelation.findMany({
          where: { fromTermId: term.id },
          include: { to: { include: { scheme: true } } },
          orderBy: [{ type: 'asc' }, { createdAt: 'asc' }],
        }),
        this.prisma.glossaryRelation.findMany({
          where: { toTermId: term.id },
          include: { from: { include: { scheme: true } } },
          orderBy: [{ type: 'asc' }, { createdAt: 'asc' }],
        }),
        term.replacedById
          ? this.prisma.glossaryTerm.findUnique({
              where: { id: term.replacedById },
            })
          : Promise.resolve(null),
        this.broaderChain(term.id),
      ]);
    const generatedDetectors = await this.prisma.customDetector.findMany({
      where: { generatedFromTermId: term.id },
      select: {
        id: true,
        key: true,
        name: true,
        generatedLabelsHash: true,
        isActive: true,
      },
    });
    const relationView = (
      relation: (typeof relationsOut)[number] | (typeof relationsIn)[number],
      other: TermWithScheme,
      direction: 'out' | 'in',
    ) => ({
      id: relation.id,
      type: relation.type,
      label: relation.label,
      status: relation.status,
      origin: relation.origin,
      note: relation.note,
      direction,
      approvedBy: relation.approvedBy,
      approvedAt: relation.approvedAt,
      createdBy: relation.createdBy,
      createdAt: relation.createdAt,
      term: this.summary(other),
    });
    return {
      ...this.toDto(term),
      proposedAliases: term.proposedAliases,
      replacedBy: replacedBy ? this.summary(replacedBy) : null,
      relations: [
        ...relationsOut.map((relation) =>
          relationView(relation, relation.to, 'out'),
        ),
        ...relationsIn.map((relation) =>
          relationView(relation, relation.from, 'in'),
        ),
      ],
      broaderChain: broaderChain.map((chain) =>
        chain.map((entry) => this.summary(entry)),
      ),
      narrower: relationsIn
        .filter((relation) => relation.type === 'BROADER')
        .map((relation) => this.summary(relation.from)),
      broader: relationsOut
        .filter((relation) => relation.type === 'BROADER')
        .map((relation) => this.summary(relation.to)),
      instanceOf: relationsOut
        .filter((relation) => relation.type === 'INSTANCE_OF')
        .map((relation) => this.summary(relation.to)),
      generatedDetectors,
    };
  }

  /**
   * Breadcrumb paths up the APPROVED and DRAFT broader relations, shortest
   * first, at most 5 paths of depth ≤ 10 (poly-hierarchy allows several).
   */
  private async broaderChain(termId: string): Promise<TermWithScheme[][]> {
    const relations = await this.prisma.$queryRaw<
      Array<{ path: string[] }>
    >`
      WITH RECURSIVE up(term_id, path, depth) AS (
        SELECT r.to_term_id, ARRAY[r.to_term_id], 1
          FROM glossary_relations r
         WHERE r.from_term_id = ${termId} AND r.type = 'BROADER'
           AND r.status = 'APPROVED'
        UNION ALL
        SELECT r.to_term_id, up.path || r.to_term_id, up.depth + 1
          FROM glossary_relations r
          JOIN up ON r.from_term_id = up.term_id
         WHERE r.type = 'BROADER' AND r.status = 'APPROVED'
           AND up.depth < 10 AND NOT r.to_term_id = ANY(up.path)
      )
      SELECT path FROM up u
       WHERE NOT EXISTS (
         SELECT 1 FROM glossary_relations r
          WHERE r.from_term_id = u.term_id AND r.type = 'BROADER'
            AND r.status = 'APPROVED'
            AND NOT r.to_term_id = ANY(u.path)
       )
       ORDER BY array_length(path, 1)
       LIMIT 5
    `;
    const ids = [...new Set(relations.flatMap((row) => row.path))];
    if (!ids.length) return [];
    const terms = await this.prisma.glossaryTerm.findMany({
      where: { id: { in: ids } },
      include: { scheme: true },
    });
    const byId = new Map(terms.map((term) => [term.id, term]));
    // Root first, so it reads as a breadcrumb: Company › Kapitalgesellschaft.
    return relations.map((row) =>
      row.path
        .map((id) => byId.get(id))
        .filter((term): term is NonNullable<typeof term> => Boolean(term))
        .reverse(),
    );
  }

  async activity(idOrKey: string, take = 50, skip = 0) {
    const term = await this.resolve(idOrKey);
    const termId = term?.id ?? idOrKey;
    const [rows, total] = await Promise.all([
      this.prisma.glossaryActivity.findMany({
        where: { termId },
        orderBy: { createdAt: 'desc' },
        take: this.toInt(take, 50, 200),
        skip: this.toInt(skip, 0, Number.MAX_SAFE_INTEGER),
      }),
      this.prisma.glossaryActivity.count({ where: { termId } }),
    ]);
    return { activities: rows, total };
  }

  /** "We classified N terms as concepts and M as entities — review" (R8). */
  async migrationBanner() {
    const settings = await this.prisma.instanceSettings.findUnique({
      where: { id: 1 },
      select: { glossaryKindBannerDismissedAt: true },
    });
    const cutoff = await this.prisma.$queryRaw<Array<{ applied: Date | null }>>`
      SELECT finished_at AS applied FROM _prisma_migrations
       WHERE migration_name = '20261001120000_glossary_model'
       LIMIT 1
    `.catch(() => [] as Array<{ applied: Date | null }>);
    const appliedAt = cutoff[0]?.applied ?? null;
    const where: Prisma.GlossaryTermWhereInput = appliedAt
      ? { createdAt: { lt: appliedAt } }
      : { id: '__none__' };
    const [concepts, entities] = await Promise.all([
      this.prisma.glossaryTerm.count({ where: { ...where, kind: 'CONCEPT' } }),
      this.prisma.glossaryTerm.count({ where: { ...where, kind: 'ENTITY' } }),
    ]);
    return {
      show:
        !settings?.glossaryKindBannerDismissedAt && concepts + entities > 0,
      concepts,
      entities,
      migratedAt: appliedAt,
      dismissedAt: settings?.glossaryKindBannerDismissedAt ?? null,
    };
  }

  async dismissMigrationBanner() {
    await this.prisma.instanceSettings.upsert({
      where: { id: 1 },
      create: { id: 1, glossaryKindBannerDismissedAt: new Date() },
      update: { glossaryKindBannerDismissedAt: new Date() },
    });
    return this.migrationBanner();
  }

  // ── Schemes (R4) ─────────────────────────────────────────────────────────

  async listSchemes() {
    const schemes = await this.prisma.glossaryScheme.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { terms: true } } },
    });
    return schemes.map((scheme) => this.schemeDto(scheme));
  }

  async getScheme(idOrKey: string) {
    const scheme = await this.prisma.glossaryScheme.findFirst({
      where: { OR: [{ id: idOrKey }, { key: idOrKey.toLowerCase() }] },
      include: { _count: { select: { terms: true } } },
    });
    if (!scheme) throw new NotFoundException(`Scheme ${idOrKey} not found`);
    return this.schemeDto(scheme);
  }

  async upsertScheme(input: {
    id?: string;
    key?: string;
    name: string;
    description?: string | null;
    color?: string | null;
    origin?: GlossaryOrigin;
    packKey?: string | null;
    packVersion?: string | null;
    actor?: string;
  }) {
    const name = input.name.trim();
    if (!name) throw new BadRequestException('A scheme needs a name');
    const existing = input.id
      ? await this.prisma.glossaryScheme.findUnique({ where: { id: input.id } })
      : input.key
        ? await this.prisma.glossaryScheme.findUnique({
            where: { key: input.key.trim().toLowerCase() },
          })
        : null;
    if (input.id && !existing) {
      throw new NotFoundException(`Scheme ${input.id} not found`);
    }
    let key = existing?.key;
    if (input.key) {
      const wanted = input.key.trim().toLowerCase();
      if (!isValidKey(wanted)) {
        throw new BadRequestException(
          `Key "${input.key}" must match ^[a-z0-9][a-z0-9._-]{0,99}$`,
        );
      }
      const clash = await this.prisma.glossaryScheme.findUnique({
        where: { key: wanted },
        select: { id: true },
      });
      if (clash && clash.id !== existing?.id) {
        throw new ConflictException(`Scheme key "${wanted}" is in use`);
      }
      key = wanted;
    }
    if (!key) {
      key = await generateKey(name, async (candidate) =>
        Boolean(
          await this.prisma.glossaryScheme.findUnique({
            where: { key: candidate },
            select: { id: true },
          }),
        ),
      );
    }
    const data = {
      key,
      name,
      description:
        input.description !== undefined
          ? input.description
          : (existing?.description ?? null),
      color: input.color !== undefined ? input.color : (existing?.color ?? null),
      ...(input.packKey !== undefined ? { packKey: input.packKey } : {}),
      ...(input.packVersion !== undefined
        ? { packVersion: input.packVersion }
        : {}),
    };
    const saved = existing
      ? await this.prisma.glossaryScheme.update({
          where: { id: existing.id },
          data,
          include: { _count: { select: { terms: true } } },
        })
      : await this.prisma.glossaryScheme.create({
          data: {
            ...data,
            origin: input.origin ?? 'OPERATOR',
            createdBy: input.actor ?? null,
          },
          include: { _count: { select: { terms: true } } },
        });
    await recordGlossaryActivity(this.prisma, {
      type: existing ? 'SCHEME_UPDATED' : 'SCHEME_CREATED',
      schemeId: saved.id,
      actor: input.actor ?? 'operator',
      payload: { key: saved.key, name: saved.name },
    });
    glossaryEvents.emit({
      type: 'glossary.scheme_changed',
      change: existing ? 'updated' : 'created',
      schemeId: saved.id,
      key: saved.key,
    });
    return this.schemeDto(saved);
  }

  async deleteScheme(idOrKey: string, actor = 'operator') {
    const scheme = await this.prisma.glossaryScheme.findFirst({
      where: { OR: [{ id: idOrKey }, { key: idOrKey.toLowerCase() }] },
      include: { _count: { select: { terms: true } } },
    });
    if (!scheme) throw new NotFoundException(`Scheme ${idOrKey} not found`);
    if (scheme._count.terms > 0) {
      throw new ConflictException(
        `Scheme "${scheme.name}" still holds ${scheme._count.terms} term(s). Move or delete them first.`,
      );
    }
    await this.prisma.glossaryScheme.delete({ where: { id: scheme.id } });
    await recordGlossaryActivity(this.prisma, {
      type: 'SCHEME_DELETED',
      schemeId: scheme.id,
      actor,
      payload: { key: scheme.key, name: scheme.name },
    });
    glossaryEvents.emit({
      type: 'glossary.scheme_changed',
      change: 'deleted',
      schemeId: scheme.id,
      key: scheme.key,
    });
    return { deleted: true, id: scheme.id };
  }

  /**
   * One level of a scheme's taxonomy (R5): roots (concepts with no broader
   * concept in the scheme) when `parentId` is empty, else the parent's narrower
   * concepts in the scheme. Children are loaded lazily.
   */
  async schemeTree(schemeIdOrKey: string, parentId?: string) {
    const scheme =
      schemeIdOrKey === 'none'
        ? null
        : await this.prisma.glossaryScheme.findFirst({
            where: {
              OR: [{ id: schemeIdOrKey }, { key: schemeIdOrKey.toLowerCase() }],
            },
          });
    if (schemeIdOrKey !== 'none' && !scheme) {
      throw new NotFoundException(`Scheme ${schemeIdOrKey} not found`);
    }
    const schemeId = scheme?.id ?? null;
    const nodes = parentId
      ? await this.prisma.glossaryTerm.findMany({
          where: {
            kind: 'CONCEPT',
            schemeId,
            relationsFrom: {
              some: { type: 'BROADER', toTermId: parentId },
            },
          },
          include: { scheme: true },
          orderBy: { term: 'asc' },
        })
      : await this.prisma.glossaryTerm.findMany({
          where: {
            kind: 'CONCEPT',
            schemeId,
            NOT: {
              relationsFrom: {
                some: { type: 'BROADER', to: { schemeId } },
              },
            },
          },
          include: { scheme: true },
          orderBy: { term: 'asc' },
        });
    const childCounts = nodes.length
      ? await this.prisma.glossaryRelation.groupBy({
          by: ['toTermId'],
          where: {
            type: 'BROADER',
            toTermId: { in: nodes.map((node) => node.id) },
            from: { schemeId },
          },
          _count: { _all: true },
        })
      : [];
    const counts = new Map(
      childCounts.map((row) => [row.toTermId, row._count._all]),
    );
    return {
      scheme: scheme ? this.schemeDto({ ...scheme }) : null,
      parentId: parentId ?? null,
      nodes: nodes.map((node) => ({
        ...this.toDto(node),
        childCount: counts.get(node.id) ?? 0,
      })),
    };
  }

  schemeDto(
    scheme: GlossaryScheme & { _count?: { terms: number } },
  ): {
    id: string;
    key: string;
    name: string;
    description: string | null;
    color: string | null;
    origin: GlossaryOrigin;
    packKey: string | null;
    packVersion: string | null;
    termCount: number;
    createdAt: Date;
    updatedAt: Date;
  } {
    return {
      id: scheme.id,
      key: scheme.key,
      name: scheme.name,
      description: scheme.description,
      color: scheme.color,
      origin: scheme.origin,
      packKey: scheme.packKey,
      packVersion: scheme.packVersion,
      termCount: scheme._count?.terms ?? 0,
      createdAt: scheme.createdAt,
      updatedAt: scheme.updatedAt,
    };
  }

  summary(term: TermWithScheme) {
    return {
      id: term.id,
      key: term.key,
      term: term.term,
      kind: term.kind,
      status: term.status,
      scheme: term.scheme
        ? {
            id: term.scheme.id,
            key: term.scheme.key,
            name: term.scheme.name,
            color: term.scheme.color,
          }
        : null,
    };
  }

  toDto(term: TermWithScheme) {
    return {
      id: term.id,
      key: term.key,
      previousKeys: term.previousKeys ?? [],
      term: term.term,
      kind: term.kind,
      status: term.status,
      aliases: term.aliases,
      codes: term.codes ?? [],
      hiddenAliases: term.hiddenAliases ?? [],
      proposedAliases: term.proposedAliases,
      definition: term.definition ?? null,
      entityType: term.entityType,
      notes: term.notes,
      steward: term.steward ?? null,
      schemeId: term.schemeId ?? null,
      scheme: term.scheme
        ? {
            id: term.scheme.id,
            key: term.scheme.key,
            name: term.scheme.name,
            color: term.scheme.color,
          }
        : null,
      replacedById: term.replacedById ?? null,
      deprecatedAt: term.deprecatedAt ?? null,
      sourceIri: term.sourceIri ?? null,
      packKey: term.packKey ?? null,
      origin: String(term.origin),
      verified: term.status === 'APPROVED',
      verifiedBy: term.verifiedBy,
      approvedAt: term.verifiedAt,
      createdAt: term.createdAt,
      updatedAt: term.updatedAt,
    };
  }
}
