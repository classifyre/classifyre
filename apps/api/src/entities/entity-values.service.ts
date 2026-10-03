import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import {
  EntityValue,
  EntityValueMethod,
  GlossaryTerm,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { CLS_SCHEMA } from '../namespace/namespace.constants';
import {
  normalizeLabel,
  normalizeValue,
  phoneticFingerprint,
  valueHash,
} from '../correlation/value-normalizer';
import { recordGlossaryActivity } from '../glossary/glossary-activity';
import { glossaryEvents } from '../glossary/glossary-events';
import { matchKeysFor } from '../glossary/glossary-norm';
import {
  ENTITY_MAX_IDENTIFIERS,
  ENTITY_MAX_VALUE_CHARS,
  ENTITY_MIN_ALIAS_CHARS,
} from './entities.constants';
import {
  canBeIdentifierLabel,
  foldKey,
  nameLabelType,
  nameLabelsFor,
  type EntityLabelConfig,
} from './entity-labels';
import { EntitySwitchService } from './entity-switch.service';

export interface EntityActor {
  name: string;
  isAgent?: boolean;
}

/** How long the list of labels present in the value index is trusted. */
const OBSERVED_LABELS_TTL_MS = 60_000;

/** A value as the entity page and the review queue show it. */
export interface EntityValueView {
  id: string;
  termId: string;
  label: string;
  value: string;
  normalizedValue: string;
  valueHash: string;
  method: EntityValueMethod;
  verdict: string;
  score: number | null;
  /** `name` for name labels, `identifier` for everything else. */
  family: 'name' | 'identifier';
  conflictTermId: string | null;
  agentVerdict: string | null;
  agentNote: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
}

interface DesiredAlias {
  label: string;
  normalizedValue: string;
  rawValue: string;
  valueHash: string;
  phoneticHash: string | null;
  foldKey: string | null;
}

/**
 * The values of an entity (G5 R2, R3, R6): the one writer of `entity_values`
 * apart from the resolution worker, which only ever adds PROPOSED rows.
 *
 * Exact linking needs no per-run work. Saving an entity normalises its name and
 * aliases with the correlation normaliser, under every name label of its type,
 * and stores them CONFIRMED; identifiers are stored the same way under the
 * label a person chose. A finding that carries the same normalised value under
 * the same label is then a mention through the join with the value index — the
 * ones already scanned and the ones that arrive later.
 */
@Injectable()
export class EntityValuesService {
  private readonly logger = new Logger(EntityValuesService.name);
  private readonly observed = new Map<
    string,
    { labels: string[]; at: number }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly switchService: EntitySwitchService,
    private readonly cls: ClsService,
  ) {}

  // ── Labels ──────────────────────────────────────────────────────────────

  /**
   * Distinct labels in the value index. A loose index scan over
   * `(label, phonetic_hash)`: one index probe per label, where a plain
   * DISTINCT would read every row of a table that runs to millions.
   */
  async observedLabels(maxAgeMs = OBSERVED_LABELS_TTL_MS): Promise<string[]> {
    const key = this.cls?.get<string>(CLS_SCHEMA) ?? '__default__';
    const cached = this.observed.get(key);
    if (cached && Date.now() - cached.at <= maxAgeMs) return cached.labels;
    const rows = await this.prisma.$queryRaw<Array<{ label: string }>>`
      WITH RECURSIVE seen AS (
        (SELECT label FROM asset_correlation_values ORDER BY label LIMIT 1)
        UNION ALL
        SELECT (SELECT v.label FROM asset_correlation_values v
                 WHERE v.label > seen.label ORDER BY v.label LIMIT 1)
          FROM seen WHERE seen.label IS NOT NULL
      )
      SELECT label FROM seen WHERE label IS NOT NULL`;
    const labels = rows.map((row) => row.label);
    this.observed.set(key, { labels, at: Date.now() });
    return labels;
  }

  /** The name labels that take part, of everything observed and configured. */
  async activeNameLabels(config?: EntityLabelConfig): Promise<string[]> {
    const labels = config ?? (await this.switchService.labels());
    const observed = await this.observedLabels();
    return [
      ...new Set(
        [...observed, ...Object.keys(labels.nameLabels)].filter(
          (label) => nameLabelType(label, labels) !== null,
        ),
      ),
    ].sort();
  }

  // ── Exact aliases (R3) ──────────────────────────────────────────────────

  /**
   * The EXACT_ALIAS rows an entity's name and aliases amount to. Hidden
   * aliases are left out: they are lookup-only spellings and never match text.
   */
  desiredAliases(
    term: Pick<GlossaryTerm, 'term' | 'aliases' | 'entityType'>,
    observed: string[],
    config: EntityLabelConfig,
  ): DesiredAlias[] {
    const labels = nameLabelsFor(term.entityType, observed, config);
    const out = new Map<string, DesiredAlias>();
    for (const raw of [term.term, ...term.aliases]) {
      for (const label of labels) {
        const normalized = normalizeValue(label, raw);
        if (!normalized || normalized.length < ENTITY_MIN_ALIAS_CHARS) continue;
        const hash = valueHash(label, normalized);
        if (out.has(hash)) continue;
        out.set(hash, {
          label,
          normalizedValue: normalized,
          rawValue: raw,
          valueHash: hash,
          phoneticHash: phoneticFingerprint(label, normalized),
          foldKey: foldKey(normalized),
        });
      }
    }
    return [...out.values()];
  }

  /**
   * Bring one entity's EXACT_ALIAS rows in line with its name and aliases.
   * Returns whether anything changed. A value a person rejected as a candidate
   * and then typed in as an alias becomes CONFIRMED: the later, explicit
   * decision wins.
   */
  async syncTerm(
    termId: string,
    options: { emit?: boolean; observed?: string[] } = {},
  ): Promise<boolean> {
    const term = await this.prisma.glossaryTerm.findUnique({
      where: { id: termId },
      select: {
        id: true,
        kind: true,
        term: true,
        aliases: true,
        entityType: true,
        status: true,
      },
    });
    if (!term) return false;
    const config = await this.switchService.labels();
    const observed = options.observed ?? (await this.observedLabels());
    const desired =
      term.kind === 'ENTITY' && term.status !== 'DEPRECATED'
        ? this.desiredAliases(term, observed, config)
        : [];
    const existing = await this.prisma.entityValue.findMany({
      where: { termId },
      select: { id: true, valueHash: true, method: true, verdict: true },
    });
    const byHash = new Map(existing.map((row) => [row.valueHash, row]));
    const wanted = new Set(desired.map((row) => row.valueHash));
    const stale = existing.filter(
      (row) => row.method === 'EXACT_ALIAS' && !wanted.has(row.valueHash),
    );
    const create = desired.filter((row) => !byHash.has(row.valueHash));
    // A candidate (or a rejection) for exactly this value: the alias the
    // operator typed supersedes it.
    const promote = desired.filter((row) => {
      const current = byHash.get(row.valueHash);
      return current && current.verdict !== 'CONFIRMED';
    });
    if (!stale.length && !create.length && !promote.length) return false;

    await this.prisma.$transaction(async (tx) => {
      if (stale.length) {
        await tx.entityValue.deleteMany({
          where: { id: { in: stale.map((row) => row.id) } },
        });
      }
      if (create.length) {
        await tx.entityValue.createMany({
          data: create.map((row) => ({
            termId,
            ...row,
            method: 'EXACT_ALIAS' as const,
            verdict: 'CONFIRMED' as const,
            score: 1,
            decidedAt: new Date(),
          })),
          skipDuplicates: true,
        });
      }
      for (const row of promote) {
        await tx.entityValue.update({
          where: { termId_valueHash: { termId, valueHash: row.valueHash } },
          data: {
            method: 'EXACT_ALIAS',
            verdict: 'CONFIRMED',
            score: 1,
            rawValue: row.rawValue,
            phoneticHash: row.phoneticHash,
            foldKey: row.foldKey,
            conflictTermId: null,
            decidedAt: new Date(),
          },
        });
      }
    });
    if (options.emit !== false) this.changed([termId]);
    return true;
  }

  /**
   * Regenerate alias values for every entity, and remember which name labels
   * that covered. The one-off backfill when entities are turned on, and what a
   * run triggers when it brings a name label nothing was indexed under yet.
   */
  async syncAll(): Promise<{ entities: number; changed: number }> {
    const config = await this.switchService.labels();
    const observed = await this.observedLabels(0);
    let entities = 0;
    const changedIds: string[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await this.prisma.glossaryTerm.findMany({
        where: { kind: 'ENTITY' },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: 500,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (!page.length) break;
      for (const term of page) {
        entities += 1;
        if (await this.syncTerm(term.id, { emit: false, observed })) {
          changedIds.push(term.id);
        }
      }
      cursor = page[page.length - 1].id;
      if (page.length < 500) break;
    }
    await this.switchService.markSynced(
      [...new Set(observed)].filter(
        (label) => nameLabelType(label, config) !== null,
      ),
    );
    if (changedIds.length) this.changed(changedIds);
    return { entities, changed: changedIds.length };
  }

  /** Name labels of a set that alias values were never generated under. */
  async unsyncedNameLabels(labels: string[]): Promise<string[]> {
    const config = await this.switchService.labels();
    const synced = new Set(await this.switchService.syncedLabels());
    return [...new Set(labels.map(normalizeLabel))].filter(
      (label) => nameLabelType(label, config) !== null && !synced.has(label),
    );
  }

  // ── Reading ─────────────────────────────────────────────────────────────

  view(row: EntityValue, config: EntityLabelConfig): EntityValueView {
    return {
      id: row.id,
      termId: row.termId,
      label: row.label,
      value: row.rawValue ?? row.normalizedValue,
      normalizedValue: row.normalizedValue,
      valueHash: row.valueHash,
      method: row.method,
      verdict: row.verdict,
      score: row.score,
      family: nameLabelType(row.label, config) ? 'name' : 'identifier',
      conflictTermId: row.conflictTermId,
      agentVerdict: row.agentVerdict,
      agentNote: row.agentNote,
      decidedBy: row.decidedBy,
      decidedAt: row.decidedAt,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
    };
  }

  /**
   * An entity's values with how often each occurs, and — for names — which
   * other entities hold the same value (R6: ambiguous, not a conflict).
   */
  async list(termId: string) {
    const config = await this.switchService.labels();
    const rows = await this.prisma.entityValue.findMany({
      where: { termId },
      orderBy: [{ verdict: 'asc' }, { label: 'asc' }, { createdAt: 'asc' }],
    });
    const hashes = [...new Set(rows.map((row) => row.valueHash))];
    const [occurrences, shared] = await Promise.all([
      this.occurrenceCounts(hashes),
      hashes.length
        ? this.prisma.$queryRaw<
            Array<{
              value_hash: string;
              term_id: string;
              term: string;
              key: string;
            }>
          >`
            SELECT ev.value_hash, t.id AS term_id, t.term, t.key
              FROM entity_values ev
              JOIN glossary_terms t ON t.id = ev.term_id
             WHERE ev.value_hash = ANY(${hashes}::text[])
               AND ev.verdict = 'CONFIRMED' AND ev.term_id <> ${termId}
               AND t.kind = 'ENTITY' AND t.status <> 'DEPRECATED'`
        : Promise.resolve([]),
    ]);
    const sharedBy = new Map<
      string,
      Array<{ id: string; term: string; key: string }>
    >();
    for (const row of shared) {
      const list = sharedBy.get(row.value_hash) ?? [];
      list.push({ id: row.term_id, term: row.term, key: row.key });
      sharedBy.set(row.value_hash, list);
    }
    return rows.map((row) => ({
      ...this.view(row, config),
      occurrences: occurrences.get(row.valueHash) ?? 0,
      sharedWith: sharedBy.get(row.valueHash) ?? [],
    }));
  }

  /** How many assets carry each value, straight from the value index. */
  async occurrenceCounts(hashes: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (!hashes.length) return out;
    const rows = await this.prisma.$queryRaw<
      Array<{ value_hash: string; n: bigint }>
    >`
      SELECT value_hash, count(*) AS n FROM asset_correlation_values
       WHERE value_hash = ANY(${hashes}::text[]) GROUP BY value_hash`;
    for (const row of rows) out.set(row.value_hash, Number(row.n));
    return out;
  }

  // ── Writing ─────────────────────────────────────────────────────────────

  private async entityOrThrow(termId: string) {
    const term = await this.prisma.glossaryTerm.findUnique({
      where: { id: termId },
    });
    if (!term) throw new NotFoundException(`Entity ${termId} not found`);
    if (term.kind !== 'ENTITY') {
      throw new BadRequestException(
        `"${term.term}" is a concept. Only entities have values and mentions; change its kind first.`,
      );
    }
    return term;
  }

  /**
   * Confirm a labelled value for an entity: an identifier a person entered, a
   * finding value they promoted, or one a source declared.
   *
   * An identifier already confirmed for another entity is not double-linked
   * (R6). It is stored PROPOSED with the holder recorded, which puts it in the
   * review queue as a conflict, and the caller is told. A *name* may belong to
   * several entities: that is ambiguity, shown on both pages, not a conflict.
   */
  async confirmValue(
    termId: string,
    input: { label: string; value: string },
    actor: EntityActor,
    method: EntityValueMethod = 'IDENTIFIER',
  ): Promise<{
    value: EntityValueView;
    conflict: { id: string; term: string; key: string } | null;
  }> {
    const term = await this.entityOrThrow(termId);
    const config = await this.switchService.labels();
    const label = normalizeLabel(input.label ?? '');
    if (!label || !canBeIdentifierLabel(label)) {
      throw new BadRequestException(
        `"${input.label}" cannot be an entity value label. Tag, date and free-text labels never link (they would make every document a mention).`,
      );
    }
    const raw = (input.value ?? '').trim();
    if (!raw || raw.length > ENTITY_MAX_VALUE_CHARS) {
      throw new BadRequestException(
        `A value is 1 to ${ENTITY_MAX_VALUE_CHARS} characters.`,
      );
    }
    const normalized = normalizeValue(label, raw);
    if (!normalized) {
      throw new BadRequestException(
        `"${raw}" has no value to link once normalised.`,
      );
    }
    const isName = nameLabelType(label, config) !== null;
    if (isName && normalized.length < ENTITY_MIN_ALIAS_CHARS) {
      throw new BadRequestException(
        `A name shorter than ${ENTITY_MIN_ALIAS_CHARS} characters never links by itself: it would match everywhere. Add it as a hidden alias instead.`,
      );
    }
    const hash = valueHash(label, normalized);
    const existing = await this.prisma.entityValue.findUnique({
      where: { termId_valueHash: { termId, valueHash: hash } },
    });
    if (!existing) {
      const count = await this.prisma.entityValue.count({
        where: {
          termId,
          method: { in: ['IDENTIFIER', 'MANUAL', 'CONNECTOR'] },
        },
      });
      if (count >= ENTITY_MAX_IDENTIFIERS) {
        throw new BadRequestException(
          `An entity holds at most ${ENTITY_MAX_IDENTIFIERS} identifiers and promoted values.`,
        );
      }
    }
    const holder = isName
      ? null
      : await this.prisma.entityValue.findFirst({
          where: {
            valueHash: hash,
            verdict: 'CONFIRMED',
            termId: { not: termId },
            term: { kind: 'ENTITY', status: { not: 'DEPRECATED' } },
          },
          include: { term: { select: { id: true, term: true, key: true } } },
        });
    // An agent proposes; only a person confirms (R22).
    const confirmed = !holder && !actor.isAgent;
    if (existing) {
      // A source re-declares its records on every scan. What a person decided
      // about a declared value stands, and a value that is already in the
      // state this call would put it in is not written (or logged) again.
      const settled =
        existing.verdict === (confirmed ? 'CONFIRMED' : 'PROPOSED') &&
        existing.conflictTermId === (holder?.termId ?? null);
      if (
        settled ||
        (method === 'CONNECTOR' && existing.verdict === 'REJECTED')
      ) {
        return {
          value: this.view(existing, config),
          conflict:
            holder && existing.verdict === 'PROPOSED'
              ? {
                  id: holder.term.id,
                  term: holder.term.term,
                  key: holder.term.key,
                }
              : null,
        };
      }
    }
    const data = {
      label,
      normalizedValue: normalized,
      rawValue: raw,
      method,
      verdict: confirmed ? ('CONFIRMED' as const) : ('PROPOSED' as const),
      score: 1,
      phoneticHash: isName ? phoneticFingerprint(label, normalized) : null,
      foldKey: isName ? foldKey(normalized) : null,
      conflictTermId: holder?.termId ?? null,
      decidedBy: confirmed ? actor.name : null,
      decidedAt: confirmed ? new Date() : null,
    };
    const saved = await this.prisma.entityValue.upsert({
      where: { termId_valueHash: { termId, valueHash: hash } },
      create: { termId, valueHash: hash, createdBy: actor.name, ...data },
      update: data,
    });
    if (confirmed && !isName) {
      await this.switchService.rememberIdentifierLabel(label);
    }
    await recordGlossaryActivity(this.prisma, {
      type: holder ? 'ENTITY_VALUE_CONFLICT' : 'ENTITY_VALUE_ADDED',
      termId,
      actor: actor.name,
      payload: {
        label,
        value: raw,
        method,
        verdict: data.verdict,
        ...(holder ? { heldBy: holder.term.key } : {}),
      },
    });
    if (confirmed) this.changed([term.id]);
    return {
      value: this.view(saved, config),
      conflict: holder
        ? { id: holder.term.id, term: holder.term.term, key: holder.term.key }
        : null,
    };
  }

  /**
   * Take a value off an entity. A typed-in identifier is deleted; a value that
   * came from a candidate becomes REJECTED, so the worker does not propose it
   * again. Names and aliases are edited on the entity, not here.
   */
  async removeValue(valueId: string, actor: EntityActor) {
    if (actor.isAgent) {
      throw new ForbiddenException('Only a person removes an entity value.');
    }
    const row = await this.prisma.entityValue.findUnique({
      where: { id: valueId },
    });
    if (!row) throw new NotFoundException(`Entity value ${valueId} not found`);
    if (row.method === 'EXACT_ALIAS') {
      throw new BadRequestException(
        "This value is the entity's name or an alias. Edit the entity to remove it.",
      );
    }
    const wasConfirmed = row.verdict === 'CONFIRMED';
    if (row.method === 'PHONETIC' || row.method === 'FUZZY') {
      await this.prisma.entityValue.update({
        where: { id: valueId },
        data: {
          verdict: 'REJECTED',
          decidedBy: actor.name,
          decidedAt: new Date(),
        },
      });
    } else {
      await this.prisma.entityValue.delete({ where: { id: valueId } });
    }
    await recordGlossaryActivity(this.prisma, {
      type: 'ENTITY_VALUE_REMOVED',
      termId: row.termId,
      actor: actor.name,
      payload: { label: row.label, value: row.rawValue ?? row.normalizedValue },
    });
    if (wasConfirmed) this.changed([row.termId]);
    return { removed: true, id: valueId };
  }

  // ── Review (R15, R6) ────────────────────────────────────────────────────

  /**
   * Decide candidates. `accept` confirms the value for its entity; `reject`
   * remembers the refusal; `move` — for a conflict — confirms it here and
   * takes it away from the entity that held it. Only a person decides (R22).
   */
  async review(
    decisions: Array<{ id: string; decision: 'accept' | 'reject' | 'move' }>,
    actor: EntityActor,
  ): Promise<{
    accepted: number;
    rejected: number;
    moved: number;
    skipped: Array<{ id: string; reason: string }>;
  }> {
    if (actor.isAgent) {
      throw new ForbiddenException(
        'Agents never decide entity candidates; they propose a verdict and a person confirms it (G5 R22).',
      );
    }
    const result = {
      accepted: 0,
      rejected: 0,
      moved: 0,
      skipped: [] as Array<{ id: string; reason: string }>,
    };
    const ids = decisions.map((d) => d.id);
    const rows = await this.prisma.entityValue.findMany({
      where: { id: { in: ids } },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const touched = new Set<string>();
    const now = new Date();
    for (const { id, decision } of decisions) {
      const row = byId.get(id);
      if (!row) {
        result.skipped.push({ id, reason: 'not found' });
        continue;
      }
      if (row.verdict !== 'PROPOSED') {
        result.skipped.push({ id, reason: `already ${row.verdict}` });
        continue;
      }
      if (decision === 'reject') {
        await this.prisma.entityValue.update({
          where: { id },
          data: {
            verdict: 'REJECTED',
            conflictTermId: null,
            decidedBy: actor.name,
            decidedAt: now,
          },
        });
        result.rejected += 1;
        continue;
      }
      if (decision === 'move') {
        if (!row.conflictTermId) {
          result.skipped.push({ id, reason: 'not a conflict' });
          continue;
        }
        await this.prisma.$transaction([
          this.prisma.entityValue.updateMany({
            where: {
              termId: row.conflictTermId,
              valueHash: row.valueHash,
              verdict: 'CONFIRMED',
            },
            data: {
              verdict: 'REJECTED',
              decidedBy: actor.name,
              decidedAt: now,
            },
          }),
          this.prisma.entityValue.update({
            where: { id },
            data: {
              verdict: 'CONFIRMED',
              conflictTermId: null,
              decidedBy: actor.name,
              decidedAt: now,
            },
          }),
        ]);
        touched.add(row.termId);
        touched.add(row.conflictTermId);
        result.moved += 1;
        continue;
      }
      if (row.conflictTermId) {
        // Accepting would leave two entities holding one identifier (R6).
        result.skipped.push({
          id,
          reason: 'a conflict: move the identifier here, or reject it',
        });
        continue;
      }
      await this.prisma.entityValue.update({
        where: { id },
        data: {
          verdict: 'CONFIRMED',
          conflictTermId: null,
          decidedBy: actor.name,
          decidedAt: now,
        },
      });
      touched.add(row.termId);
      result.accepted += 1;
    }
    if (result.accepted + result.rejected + result.moved > 0) {
      await recordGlossaryActivity(this.prisma, {
        type: 'ENTITY_CANDIDATES_REVIEWED',
        actor: actor.name,
        payload: {
          accepted: result.accepted,
          rejected: result.rejected,
          moved: result.moved,
        },
      });
      glossaryEvents.emit({
        type: 'glossary.proposal_decided',
        kind: 'ENTITY_MENTION',
        decision: 'reviewed',
        count: result.accepted + result.rejected + result.moved,
      });
    }
    if (touched.size) this.changed([...touched]);
    return result;
  }

  /** An agent's supporting verdict on a candidate it may not decide (R22). */
  async proposeVerdict(
    valueId: string,
    verdict: 'accept' | 'reject',
    note: string | undefined,
  ) {
    const row = await this.prisma.entityValue.findUnique({
      where: { id: valueId },
    });
    if (!row) throw new NotFoundException(`Entity value ${valueId} not found`);
    if (row.verdict !== 'PROPOSED') {
      throw new BadRequestException(
        `Candidate ${valueId} is already ${row.verdict}`,
      );
    }
    return this.prisma.entityValue.update({
      where: { id: valueId },
      data: { agentVerdict: verdict, agentNote: note?.slice(0, 2000) ?? null },
    });
  }

  // ── Merge (R7) ──────────────────────────────────────────────────────────

  /**
   * Merge entity A into B: A's names, identifiers, values, references,
   * relations, graph edges and watches move to B, and A becomes DEPRECATED
   * with `replacedById` B, which is what already redirects a term. Two entities
   * are never merged automatically, and only a person merges.
   */
  async merge(fromIdOrKey: string, intoIdOrKey: string, actor: EntityActor) {
    if (actor.isAgent) {
      throw new ForbiddenException('Only a person merges entities (G5 R22).');
    }
    const [from, into] = await Promise.all([
      this.resolveEntity(fromIdOrKey),
      this.resolveEntity(intoIdOrKey),
    ]);
    if (from.id === into.id) {
      throw new BadRequestException('An entity cannot be merged into itself.');
    }
    if (from.status === 'DEPRECATED') {
      throw new ConflictException(
        `"${from.term}" is already deprecated${from.mergedAt ? ' (merged)' : ''}.`,
      );
    }
    if (into.status !== 'APPROVED') {
      throw new ConflictException(
        `Merge into an APPROVED entity: "${into.term}" is ${into.status}. Approve it first.`,
      );
    }
    const moved = await this.prisma.$transaction(async (tx) => {
      // Values: B keeps its own decision where both hold a value, unless A's
      // was confirmed and B's was not.
      const [fromValues, intoValues] = await Promise.all([
        tx.entityValue.findMany({ where: { termId: from.id } }),
        tx.entityValue.findMany({
          where: { termId: into.id },
          select: { id: true, valueHash: true, verdict: true },
        }),
      ]);
      const intoByHash = new Map(intoValues.map((v) => [v.valueHash, v]));
      let values = 0;
      for (const value of fromValues) {
        const clash = intoByHash.get(value.valueHash);
        if (!clash) {
          await tx.entityValue.update({
            where: { id: value.id },
            data: { termId: into.id, conflictTermId: null },
          });
          values += 1;
          continue;
        }
        if (value.verdict === 'CONFIRMED' && clash.verdict !== 'CONFIRMED') {
          await tx.entityValue.update({
            where: { id: clash.id },
            data: {
              verdict: 'CONFIRMED',
              conflictTermId: null,
              decidedBy: actor.name,
              decidedAt: new Date(),
            },
          });
          values += 1;
        }
        await tx.entityValue.delete({ where: { id: value.id } });
      }
      // A conflict between the two is settled by the merge itself.
      await tx.entityValue.updateMany({
        where: { conflictTermId: from.id },
        data: { conflictTermId: into.id },
      });
      await tx.entityValue.updateMany({
        where: {
          termId: into.id,
          conflictTermId: into.id,
          verdict: 'PROPOSED',
        },
        data: {
          verdict: 'CONFIRMED',
          conflictTermId: null,
          decidedBy: actor.name,
          decidedAt: new Date(),
        },
      });

      const references = await tx.$executeRaw`
        UPDATE glossary_references r SET glossary_term_id = ${into.id}
         WHERE r.glossary_term_id = ${from.id}
           AND NOT EXISTS (
             SELECT 1 FROM glossary_references k
              WHERE k.glossary_term_id = ${into.id} AND k.entity_type = r.entity_type
                AND k.entity_id = r.entity_id AND k.role = r.role)`;
      await tx.glossaryReference.deleteMany({
        where: { glossaryTermId: from.id },
      });

      const relations =
        (await tx.$executeRaw`
          UPDATE glossary_relations r SET from_term_id = ${into.id}
           WHERE r.from_term_id = ${from.id} AND r.to_term_id <> ${into.id}
             AND NOT EXISTS (
               SELECT 1 FROM glossary_relations k
                WHERE k.from_term_id = ${into.id} AND k.to_term_id = r.to_term_id
                  AND k.type = r.type AND k.label = r.label)`) +
        (await tx.$executeRaw`
          UPDATE glossary_relations r SET to_term_id = ${into.id}
           WHERE r.to_term_id = ${from.id} AND r.from_term_id <> ${into.id}
             AND NOT EXISTS (
               SELECT 1 FROM glossary_relations k
                WHERE k.to_term_id = ${into.id} AND k.from_term_id = r.from_term_id
                  AND k.type = r.type AND k.label = r.label)`);
      await tx.glossaryRelation.deleteMany({
        where: { OR: [{ fromTermId: from.id }, { toTermId: from.id }] },
      });

      // Declarations and entity-to-entity facts in the graph.
      const edges =
        (await tx.$executeRaw`
          UPDATE edges e SET to_id = ${into.id}
           WHERE e.to_type = 'term' AND e.to_id = ${from.id}
             AND NOT EXISTS (
               SELECT 1 FROM edges k
                WHERE k.to_type = 'term' AND k.to_id = ${into.id}
                  AND k.from_type = e.from_type AND k.from_id = e.from_id
                  AND k.relation_type = e.relation_type)`) +
        (await tx.$executeRaw`
          UPDATE edges e SET from_id = ${into.id}
           WHERE e.from_type = 'term' AND e.from_id = ${from.id}
             AND NOT EXISTS (
               SELECT 1 FROM edges k
                WHERE k.from_type = 'term' AND k.from_id = ${into.id}
                  AND k.to_type = e.to_type AND k.to_id = e.to_id
                  AND k.relation_type = e.relation_type)`);
      await tx.$executeRaw`
        DELETE FROM edges
         WHERE (to_type = 'term' AND to_id = ${from.id})
            OR (from_type = 'term' AND from_id = ${from.id})`;

      // The board: a TERM item for A now shows B, unless B is already there.
      await tx.$executeRaw`
        UPDATE case_board_items i SET ref_id = ${into.id}
         WHERE i.kind = 'TERM' AND i.ref_id = ${from.id}
           AND NOT EXISTS (
             SELECT 1 FROM case_board_items k
              WHERE k.board_id = i.board_id AND k.kind = 'TERM' AND k.ref_id = ${into.id})`;

      // Watches that named A by key follow it to B.
      const watches = await tx.$executeRaw`
        UPDATE inquiries SET term_keys = (
          SELECT array_agg(DISTINCT k) FROM unnest(array_replace(term_keys, ${from.key}, ${into.key})) k)
         WHERE ${from.key} = ANY(term_keys)`;

      const aliases = mergeLabels(
        into.aliases,
        [from.term, ...from.aliases],
        into.term,
      );
      const codes = mergeLabels(into.codes, from.codes, null, true);
      const hiddenAliases = mergeLabels(
        into.hiddenAliases,
        from.hiddenAliases,
        into.term,
      );
      await tx.glossaryTerm.update({
        where: { id: into.id },
        data: {
          aliases,
          codes,
          hiddenAliases,
          matchKeys: matchKeysFor({
            term: into.term,
            aliases,
            codes,
            hiddenAliases,
          }),
          anchorUrn: into.anchorUrn ?? from.anchorUrn,
          attributes:
            mergeAttributes(into.attributes, from.attributes) ?? Prisma.DbNull,
        },
      });
      // Entities already redirecting to A follow A to B, so a redirect is
      // always one hop.
      await tx.glossaryTerm.updateMany({
        where: { replacedById: from.id },
        data: { replacedById: into.id },
      });
      await tx.glossaryTerm.update({
        where: { id: from.id },
        data: {
          status: 'DEPRECATED',
          replacedById: into.id,
          deprecatedAt: new Date(),
          mergedAt: new Date(),
          // The anchor stays: it is how a source that re-declares this record
          // on its next scan is led to B instead of creating A again.
          mentionCount: 0,
          assetCount: 0,
          sourceCount: 0,
        },
      });
      return { values, references, relations, edges, watches };
    });
    for (const [termId, payload] of [
      [from.id, { into: into.key, ...moved }],
      [into.id, { from: from.key, ...moved }],
    ] as const) {
      await recordGlossaryActivity(this.prisma, {
        type: 'ENTITY_MERGED',
        termId,
        actor: actor.name,
        payload,
      });
    }
    // B's aliases changed: regenerate its exact values before anything links.
    await this.syncTerm(into.id, { emit: false });
    glossaryEvents.emit({
      type: 'glossary.term_changed',
      change: 'deprecated',
      termId: from.id,
      key: from.key,
      kind: from.kind,
    });
    glossaryEvents.emit({
      type: 'glossary.term_changed',
      change: 'updated',
      termId: into.id,
      key: into.key,
      kind: into.kind,
      labelsChanged: true,
      linkingChanged: true,
    });
    glossaryEvents.emit({
      type: 'entity.merged',
      fromTermId: from.id,
      fromKey: from.key,
      intoTermId: into.id,
      intoKey: into.key,
      valuesMoved: moved.values,
      referencesMoved: moved.references,
    });
    this.changed([from.id, into.id]);
    return {
      merged: true,
      from: { id: from.id, key: from.key, term: from.term },
      into: { id: into.id, key: into.key, term: into.term },
      moved,
    };
  }

  private async resolveEntity(idOrKey: string) {
    const needle = idOrKey.trim();
    const term =
      (await this.prisma.glossaryTerm.findUnique({ where: { id: needle } })) ??
      (await this.prisma.glossaryTerm.findUnique({
        where: { key: needle.toLowerCase() },
      })) ??
      (await this.prisma.glossaryTerm.findFirst({
        where: { previousKeys: { has: needle.toLowerCase() } },
      }));
    if (!term) throw new NotFoundException(`Entity ${idOrKey} not found`);
    if (term.kind !== 'ENTITY') {
      throw new BadRequestException(
        `"${term.term}" is a concept, not an entity.`,
      );
    }
    return term;
  }

  /** Values changed for these entities: links, counters and watches follow. */
  changed(termIds: string[]): void {
    if (!termIds.length) return;
    glossaryEvents.emit({
      type: 'entity.values_changed',
      termIds: [...new Set(termIds)],
    });
  }
}

function mergeLabels(
  keep: string[],
  add: string[],
  exclude: string | null,
  caseSensitive = false,
): string[] {
  const identity = (value: string) =>
    caseSensitive ? value.trim() : value.trim().toLowerCase();
  const seen = new Set(keep.map(identity));
  if (exclude) seen.add(identity(exclude));
  const out = [...keep];
  for (const raw of add) {
    const value = raw.trim();
    if (!value || seen.has(identity(value))) continue;
    seen.add(identity(value));
    out.push(value);
  }
  return out.slice(0, 50);
}

/** B's attributes win; A only fills what B does not say. */
function mergeAttributes(
  into: Prisma.JsonValue | null,
  from: Prisma.JsonValue | null,
): Prisma.InputJsonValue | null {
  const isObject = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  if (!isObject(from)) return isObject(into) ? into : null;
  if (!isObject(into)) return from;
  return { ...from, ...into };
}
