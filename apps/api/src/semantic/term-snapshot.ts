import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ClsServiceManager } from 'nestjs-cls';
import type { PrismaService } from '../prisma.service';
import { CLS_SCHEMA } from '../namespace/namespace.constants';
import { glossaryEvents } from '../glossary/glossary-events';
import type { ActiveBindings } from './bindings/bindings.service';
import { loadActiveBindings } from './bindings/bindings.service';
import type { CompiledBinding } from './bindings/binding-spec';
import { isLookupMode, isOutputMode } from './bindings/binding-spec';
import {
  findingPredicateSql,
  findingSelectorWhere,
  matchFindingTerms,
} from './bindings/binding-compiler';
import { normalizeValue, valueHash } from '../correlation/value-normalizer';

/** Depth of the narrower closure (SL1, same as `narrowerClosure`). */
const CLOSURE_DEPTH = 10;
/** A snapshot is reloaded at least this often, events aside. */
const SNAPSHOT_TTL_MS = 60_000;

/**
 * Everything needed to answer "is this finding evidence of term X?"
 * synchronously: the active bindings, key resolution, the BROADER hierarchy
 * and the manually linked findings (SL3 R7.5, R7.6).
 *
 * Synchronous on purpose. The watch matcher (`CompiledMatcher`) is built in a
 * dozen places, all synchronously, from inquiry rows; the term dimension reads
 * this snapshot instead of making every one of them async. Callers that build
 * matchers call {@link ensureTermSnapshot} first; a matcher with term keys and
 * no snapshot throws rather than guessing (see {@link termMatcherFor}).
 */
export interface TermSnapshot {
  loadedAt: number;
  active: ActiveBindings;
  /** Current and previous keys → term id. */
  keys: Map<string, string>;
  /** Broader term id → its direct narrower term ids (APPROVED BROADER). */
  narrower: Map<string, string[]>;
  /** Term id → finding ids with a MANUAL (ABOUT) reference. */
  manualFindings: Map<string, Set<string>>;
  /**
   * Entity id → value hashes of its CONFIRMED values (G5): what makes a
   * finding a mention. APPROVED entities only, and empty while the Entities
   * feature is off.
   */
  mentionHashes?: Map<string, Set<string>>;
}

const snapshots = new Map<string, TermSnapshot>();
let listenerInstalled = false;

function installListener(): void {
  if (listenerInstalled) return;
  listenerInstalled = true;
  const drop = () => snapshots.clear();
  glossaryEvents.on('glossary.term_changed', drop);
  glossaryEvents.on('glossary.relation_changed', drop);
  glossaryEvents.on('glossary.binding_changed', drop);
  glossaryEvents.on('glossary.scheme_changed', drop);
  glossaryEvents.on('glossary.imported', drop);
  glossaryEvents.on('glossary.pack_installed', drop);
  glossaryEvents.on('semantic.reference_changed', drop);
  glossaryEvents.on('entity.values_changed', drop);
  glossaryEvents.on('entity.merged', drop);
}

function schemaKey(): string {
  try {
    const cls = ClsServiceManager.getClsService();
    return cls.get(CLS_SCHEMA) ?? 'default';
  } catch {
    return 'default';
  }
}

/** Forget every snapshot (tests and explicit refreshes). */
export function dropTermSnapshots(): void {
  snapshots.clear();
}

/** Install a snapshot for the current namespace (specs). */
export function primeTermSnapshot(
  snapshot: Omit<TermSnapshot, 'loadedAt'>,
): void {
  installListener();
  snapshots.set(schemaKey(), { ...snapshot, loadedAt: Date.now() });
}

/** The current namespace's snapshot, if loaded and fresh. */
export function currentTermSnapshot(): TermSnapshot | undefined {
  const snapshot = snapshots.get(schemaKey());
  if (!snapshot || Date.now() - snapshot.loadedAt >= SNAPSHOT_TTL_MS) {
    return undefined;
  }
  return snapshot;
}

/** Load (or reuse) the current namespace's snapshot. */
export async function ensureTermSnapshot(
  prisma: PrismaService,
): Promise<TermSnapshot> {
  installListener();
  const cached = currentTermSnapshot();
  if (cached) return cached;
  const key = schemaKey();
  const [active, terms, relations, references, mentions] = await Promise.all([
    loadActiveBindings(prisma),
    prisma.glossaryTerm.findMany({
      select: { id: true, key: true, previousKeys: true },
    }),
    prisma.glossaryRelation.findMany({
      where: { type: 'BROADER', status: 'APPROVED' },
      select: { fromTermId: true, toTermId: true },
    }),
    prisma.glossaryReference.findMany({
      where: { role: 'ABOUT', entityType: 'finding' },
      select: { glossaryTermId: true, entityId: true },
    }),
    loadMentionHashes(prisma),
  ]);
  const keys = new Map<string, string>();
  for (const term of terms) keys.set(term.key, term.id);
  for (const term of terms) {
    for (const previous of term.previousKeys) {
      if (!keys.has(previous)) keys.set(previous, term.id);
    }
  }
  const narrower = new Map<string, string[]>();
  for (const relation of relations) {
    // BROADER points from the narrower concept to the broader one.
    const list = narrower.get(relation.toTermId) ?? [];
    list.push(relation.fromTermId);
    narrower.set(relation.toTermId, list);
  }
  const manualFindings = new Map<string, Set<string>>();
  for (const reference of references) {
    const set = manualFindings.get(reference.glossaryTermId) ?? new Set();
    set.add(reference.entityId);
    manualFindings.set(reference.glossaryTermId, set);
  }
  const snapshot: TermSnapshot = {
    loadedAt: Date.now(),
    active,
    keys,
    narrower,
    manualFindings,
    mentionHashes: mentions,
  };
  snapshots.set(key, snapshot);
  return snapshot;
}

/**
 * The confirmed value hashes of every APPROVED entity, when entities are on.
 * A curated set: entities times their names and identifiers, not mentions.
 */
async function loadMentionHashes(
  prisma: PrismaService,
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  try {
    const config = await prisma.entityConfig.findUnique({
      where: { id: 1 },
      select: { enabled: true },
    });
    if (config && !config.enabled) return out;
    const rows = await prisma.$queryRaw<
      Array<{ term_id: string; value_hash: string }>
    >`
      SELECT ev.term_id, ev.value_hash
        FROM entity_values ev
        JOIN glossary_terms t ON t.id = ev.term_id
       WHERE ev.verdict = 'CONFIRMED' AND t.kind = 'ENTITY' AND t.status = 'APPROVED'`;
    for (const row of rows) {
      const set = out.get(row.term_id) ?? new Set<string>();
      set.add(row.value_hash);
      out.set(row.term_id, set);
    }
  } catch {
    // A namespace that has not migrated yet has no entities to mention.
  }
  return out;
}

/**
 * Load the snapshot when any of these matchers names terms; a no-op (no
 * queries) otherwise, so watches without a term dimension cost nothing.
 */
export async function ensureTermSnapshotFor(
  prisma: PrismaService,
  matchers: Array<{ termKeys?: string[] | null }>,
): Promise<void> {
  if (matchers.some((m) => (m.termKeys ?? []).length > 0)) {
    await ensureTermSnapshot(prisma);
  }
}

/** Term ids for keys, optionally with their narrower concepts. */
export function resolveTermKeys(
  snapshot: TermSnapshot,
  keys: string[],
  includeNarrower: boolean,
): { termIds: string[]; unknown: string[] } {
  const unknown: string[] = [];
  const roots: string[] = [];
  for (const raw of keys) {
    const key = raw.trim().toLowerCase();
    if (!key) continue;
    const id = snapshot.keys.get(key);
    if (id) roots.push(id);
    else unknown.push(raw);
  }
  const out = new Set(roots);
  if (includeNarrower) {
    let frontier = roots;
    for (let depth = 0; depth < CLOSURE_DEPTH && frontier.length; depth++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const child of snapshot.narrower.get(id) ?? []) {
          if (!out.has(child)) {
            out.add(child);
            next.push(child);
          }
        }
      }
      frontier = next;
    }
  }
  return { termIds: [...out], unknown };
}

/** Throw 400 for term keys that resolve to nothing (fail closed). */
export function assertKnownTermKeys(unknown: string[]): void {
  if (unknown.length === 0) return;
  throw new BadRequestException({
    message:
      `Unknown glossary term key(s): ${unknown.join(', ')}. ` +
      'An unknown term is rejected rather than ignored, because ignoring it ' +
      'would widen the match.',
    unknownTermKeys: unknown,
  });
}

/** The finding shape the term dimension reads. */
export interface TermFindingCandidate {
  id?: string;
  sourceId: string;
  detectorType: string;
  findingType: string;
  customDetectorKey?: string | null;
  matchedContent?: string | null;
}

/**
 * "Is this finding evidence of one of these terms?", both halves (SL3 R7.6).
 * Status is left to the caller's own status dimension.
 *
 * For an entity (G5 R18) the evidence is a mention: the finding is the value
 * index's representative finding for one of the entity's confirmed values in
 * its asset. That makes "watch this entity" count documents and values, not
 * every repetition of a name inside one document, and it is the definition
 * the SQL halves state exactly. The in-memory half cannot read the index, so
 * it recomputes the finding's own value hash instead — always applied after
 * the `where`, where it can only agree. (A code detector's declared
 * `normalized_value` is not visible in memory; such a finding is a mention
 * through the SQL halves only.)
 */
export class TermMatcher {
  readonly termIds: Set<string>;
  private readonly bindings: CompiledBinding[];
  private readonly manual: Set<string>;
  private readonly mentions: Set<string>;

  constructor(
    private readonly snapshot: TermSnapshot,
    termIds: string[],
  ) {
    this.termIds = new Set(termIds);
    this.bindings = snapshot.active.bindings.filter((binding) =>
      this.relevant(binding),
    );
    this.manual = new Set<string>();
    this.mentions = new Set<string>();
    for (const termId of termIds) {
      for (const id of snapshot.manualFindings.get(termId) ?? []) {
        this.manual.add(id);
      }
      for (const hash of snapshot.mentionHashes?.get(termId) ?? []) {
        this.mentions.add(hash);
      }
    }
  }

  private relevant(binding: CompiledBinding): boolean {
    if (binding.noMeaning || !isOutputMode(binding.mode)) return false;
    // A lookup can resolve to any concept of its scheme.
    if (isLookupMode(binding.mode)) return true;
    return Boolean(binding.termId && this.termIds.has(binding.termId));
  }

  /** In-memory half. */
  matches(finding: TermFindingCandidate): boolean {
    if (finding.id && this.manual.has(finding.id)) return true;
    for (const binding of this.bindings) {
      const terms = matchFindingTerms(
        binding,
        {
          id: finding.id ?? '',
          sourceId: finding.sourceId,
          detectorType: finding.detectorType,
          findingType: finding.findingType,
          customDetectorKey: finding.customDetectorKey ?? null,
          matchedContent: finding.matchedContent ?? '',
        },
        this.snapshot.active.index,
        { anyStatus: true },
      );
      if (terms.some((termId) => this.termIds.has(termId))) return true;
    }
    if (this.mentions.size && finding.matchedContent) {
      const normalized = normalizeValue(
        finding.findingType,
        finding.matchedContent,
      );
      if (
        normalized &&
        this.mentions.has(valueHash(finding.findingType, normalized))
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Whether {@link where} is the exact answer. Value and lookup bindings test
   * the matched value, which the Prisma half cannot express.
   */
  get exactInWhere(): boolean {
    return this.bindings.every((binding) => binding.mode === 'OUTPUT');
  }

  /** True when the in-memory half needs `matchedContent`. */
  get needsContent(): boolean {
    return !this.exactInWhere || this.mentions.size > 0;
  }

  /**
   * Prisma half: a superset of {@link matches} (exact when
   * {@link exactInWhere}). Matches nothing when no binding or reference can
   * make a finding evidence of these terms.
   */
  where(): Prisma.FindingWhereInput {
    const or: Prisma.FindingWhereInput[] = [];
    for (const binding of this.bindings) {
      const selector = findingSelectorWhere(binding);
      if (selector) or.push(selector);
    }
    if (this.manual.size) or.push({ id: { in: [...this.manual] } });
    const mention = this.mentionWhere();
    if (mention) or.push(mention);
    if (or.length === 0) return { id: { in: [] } };
    return { OR: or };
  }

  /** Mentions as a Prisma `where` (exact), or null when no entity is named. */
  mentionWhere(): Prisma.FindingWhereInput | null {
    if (!this.mentions.size) return null;
    return {
      correlationValues: { some: { valueHash: { in: [...this.mentions] } } },
    };
  }

  /** SQL half over `findings f` (exact), for filters that can run SQL. */
  sql(): Prisma.Sql {
    const parts: Prisma.Sql[] = [];
    const termIds = [...this.termIds];
    for (const binding of this.bindings) {
      const predicate = findingPredicateSql(binding, termIds, {
        anyStatus: true,
      });
      if (predicate) parts.push(predicate);
    }
    if (this.manual.size) {
      parts.push(Prisma.sql`f.id = ANY(${[...this.manual]}::text[])`);
    }
    if (this.mentions.size) {
      parts.push(Prisma.sql`EXISTS (
        SELECT 1 FROM asset_correlation_values acv
         WHERE acv.finding_id = f.id
           AND acv.value_hash = ANY(${[...this.mentions]}::text[]))`);
    }
    if (parts.length === 0) return Prisma.sql`FALSE`;
    return Prisma.sql`(${Prisma.join(parts, ' OR ')})`;
  }

  /** The value-testing bindings, whose matches need SQL or memory. */
  get valueBindings(): CompiledBinding[] {
    return this.bindings.filter((binding) => binding.mode !== 'OUTPUT');
  }

  /** The OUTPUT bindings, exact as a Prisma `where`. */
  get outputBindings(): CompiledBinding[] {
    return this.bindings.filter((binding) => binding.mode === 'OUTPUT');
  }

  get manualFindingIds(): string[] {
    return [...this.manual];
  }
}

/**
 * The term dimension of a watch matcher, or null when it names no terms.
 * Throws when the snapshot was not loaded: a silently missing dimension would
 * widen the watch, and an empty one would drop its coverage.
 */
export function termMatcherFor(m: {
  termKeys?: string[] | null;
  termsIncludeNarrower?: boolean | null;
}): TermMatcher | null {
  const keys = m.termKeys ?? [];
  if (keys.length === 0) return null;
  const snapshot = currentTermSnapshot();
  if (!snapshot) {
    throw new Error(
      'Term snapshot not loaded: call ensureTermSnapshot() before building a matcher with term keys',
    );
  }
  const { termIds } = resolveTermKeys(
    snapshot,
    keys,
    Boolean(m.termsIncludeNarrower),
  );
  return new TermMatcher(snapshot, termIds);
}
