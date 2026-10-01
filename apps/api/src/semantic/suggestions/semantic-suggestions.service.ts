import { Injectable, Logger, Optional } from '@nestjs/common';
import {
  Prisma,
  SemanticSuggestion,
  SemanticSuggestionKind,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma.service';
import { EmbeddingService } from '../../embedding/embedding.service';
import { EmbeddingSettingsService } from '../../embedding/embedding-settings.service';
import { QueryEmbeddingService } from '../../embedding/query-embedding.service';
import { vectorCast } from '../../embedding/embedding-vector';
import { glossaryNorm } from '../../glossary/glossary-norm';
import { glossaryEvents } from '../../glossary/glossary-events';
import {
  VocabularyService,
  VocabularyRow,
} from '../vocabulary/vocabulary.service';
import {
  BindingSpec,
  CompiledBinding,
  bindingFingerprint,
  humaniseOutput,
} from '../bindings/binding-spec';
import { excerpt } from '../semantic-sql';

export type GeneratorName = 'binding' | 'link' | 'relation';
export const GENERATORS: GeneratorName[] = ['binding', 'link', 'relation'];

/** Defaults (SL4 §4, §9). */
export const DEFAULT_MIN_SCORE: Record<
  'binding' | 'link' | 'relation',
  number
> = {
  binding: 0.6,
  link: 0.78,
  relation: 0.5,
};
const CONTENT_FLOOR = 0.35;
const PROPOSAL_THRESHOLDS = [10, 50, 100, 500];
const MAX_LINK_CANDIDATES = 200;
const COOCCURRENCE_HUB = 50_000;

type Concept = {
  id: string;
  key: string;
  term: string;
  schemeId: string | null;
  codes: string[];
  matchKeys: string[];
  embedContentHash: string | null;
  definition: string | null;
  aliases: string[];
  status: string;
};

type Signal = {
  termId: string;
  score: number;
  kind: 'lexical' | 'meaning' | 'content' | 'lookup';
};

function tokens(value: string): Set<string> {
  return new Set(
    glossaryNorm(value)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length > 1),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const token of a) if (b.has(token)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/** Lexical signal (SL4 G-1): 0.9 exact, else 0.6 + 0.3 × Jaccard when ≥ 0.5. */
export function lexicalScore(
  label: string,
  concept: Pick<Concept, 'matchKeys'>,
): number {
  const normalized = glossaryNorm(label);
  if (!normalized) return 0;
  if (concept.matchKeys.includes(normalized)) return 0.9;
  const own = tokens(label);
  let best = 0;
  for (const key of concept.matchKeys) {
    const j = jaccard(own, tokens(key));
    if (j >= 0.5) best = Math.max(best, 0.6 + 0.3 * j);
  }
  return Math.round(best * 1000) / 1000;
}

/** Combine signals: max, +0.05 per agreeing signal, −0.2 on contradiction. */
export function combineSignals(
  signals: Signal[],
  termId: string,
  contentContradicts: boolean,
): number {
  const own = signals.filter((signal) => signal.termId === termId);
  if (!own.length) return 0;
  const max = Math.max(...own.map((s) => s.score));
  const kinds = new Set(own.map((s) => s.kind));
  let score = max + 0.05 * Math.max(kinds.size - 1, 0);
  if (contentContradicts) score -= 0.2;
  return Math.round(Math.min(Math.max(score, 0), 1) * 1000) / 1000;
}

function linkFingerprint(assetId: string, termId: string): string {
  return createHash('sha256').update(`link:${assetId}:${termId}`).digest('hex');
}

function relationFingerprint(a: string, b: string, type: string): string {
  const [x, y] = a < b ? [a, b] : [b, a];
  return createHash('sha256')
    .update(`relation:${x}:${y}:${type}`)
    .digest('hex');
}

/**
 * The suggestion generators of the review queue (SL4 §4). Each writes
 * `semantic_suggestions` with a score, a one-sentence rationale and evidence,
 * and remembers decisions: a dismissed proposal returns only when its evidence
 * changes materially (score +0.1 or support doubled), and an accepted or
 * "dismissed forever" one never returns.
 */
@Injectable()
export class SemanticSuggestionsService {
  private readonly logger = new Logger(SemanticSuggestionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly vocabulary: VocabularyService,
    @Optional() private readonly embeddings?: EmbeddingService,
    @Optional() private readonly embeddingSettings?: EmbeddingSettingsService,
    @Optional() private readonly queryEmbedding?: QueryEmbeddingService,
  ) {}

  async settings() {
    const row = await this.prisma.instanceSettings.findUnique({
      where: { id: 1 },
    });
    const generators = {
      binding: true,
      link: true,
      relation: true,
      ...((row?.suggestionGenerators as Record<string, boolean> | null) ?? {}),
    };
    const minScore = {
      ...DEFAULT_MIN_SCORE,
      ...((row?.suggestionMinScore as Record<string, number> | null) ?? {}),
    };
    return {
      generators,
      minScore,
      linkCapPerConcept: row?.suggestionLinkCapPerConcept ?? 200,
      cooccurrenceMinSupport: row?.suggestionCooccurrenceMinSupport ?? 20,
      cooccurrenceMinLift: row?.suggestionCooccurrenceMinLift ?? 3,
    };
  }

  async updateSettings(input: {
    generators?: Record<string, boolean>;
    minScore?: Record<string, number>;
    linkCapPerConcept?: number;
    cooccurrenceMinSupport?: number;
    cooccurrenceMinLift?: number;
  }) {
    const current = await this.settings();
    await this.prisma.instanceSettings.upsert({
      where: { id: 1 },
      create: { id: 1 },
      update: {},
    });
    await this.prisma.instanceSettings.update({
      where: { id: 1 },
      data: {
        ...(input.generators
          ? {
              suggestionGenerators: {
                ...current.generators,
                ...input.generators,
              },
            }
          : {}),
        ...(input.minScore
          ? { suggestionMinScore: { ...current.minScore, ...input.minScore } }
          : {}),
        ...(input.linkCapPerConcept !== undefined
          ? {
              suggestionLinkCapPerConcept: Math.max(
                1,
                Math.trunc(input.linkCapPerConcept),
              ),
            }
          : {}),
        ...(input.cooccurrenceMinSupport !== undefined
          ? {
              suggestionCooccurrenceMinSupport: Math.max(
                1,
                Math.trunc(input.cooccurrenceMinSupport),
              ),
            }
          : {}),
        ...(input.cooccurrenceMinLift !== undefined
          ? {
              suggestionCooccurrenceMinLift: Math.max(
                1,
                input.cooccurrenceMinLift,
              ),
            }
          : {}),
      },
    });
    return this.settings();
  }

  async embeddingsOn(): Promise<boolean> {
    try {
      return Boolean(
        this.embeddingSettings && (await this.embeddingSettings.enabledNow()),
      );
    } catch {
      return false;
    }
  }

  async runAll(
    options: {
      generators?: string[];
      termIds?: string[];
      nightly?: boolean;
    } = {},
  ): Promise<Record<string, number>> {
    const settings = await this.settings();
    const wanted = new Set(
      options.generators?.length ? options.generators : GENERATORS,
    );
    const out: Record<string, number> = {};
    await this.expire();
    if (wanted.has('binding') && settings.generators.binding) {
      out.binding = await this.safe('binding', () =>
        this.generateBindings(settings.minScore.binding),
      );
    }
    if (wanted.has('link') && settings.generators.link) {
      out.link = await this.safe('link', () =>
        this.generateLinks(
          settings.minScore.link,
          settings.linkCapPerConcept,
          options.termIds,
        ),
      );
    }
    // Co-occurrence is nightly (SL4 G-3), or on demand.
    if (
      wanted.has('relation') &&
      settings.generators.relation &&
      (options.nightly || options.generators?.includes('relation'))
    ) {
      out.relation = await this.safe('relation', () =>
        this.generateRelations(
          settings.cooccurrenceMinSupport,
          settings.cooccurrenceMinLift,
          settings.minScore.relation,
        ),
      );
    }
    await this.notifyPending().catch(() => undefined);
    return out;
  }

  private async safe(name: string, fn: () => Promise<number>): Promise<number> {
    try {
      return await fn();
    } catch (error) {
      this.logger.warn(`Suggestion generator ${name} failed: ${String(error)}`);
      return 0;
    }
  }

  // ── Memory (SL4 §6) ────────────────────────────────────────────────────

  /**
   * Write or refresh one suggestion under the decision memory. Returns the
   * row, or null when memory says the proposal must not come back.
   */
  async propose(input: {
    kind: SemanticSuggestionKind;
    fingerprint: string;
    termId: string | null;
    assetId?: string | null;
    payload: Prisma.InputJsonValue;
    score: number;
    generator: string;
    rationale: string;
    evidence?: Prisma.InputJsonValue;
    supportCount: number;
    origin?: 'SUGGESTION' | 'AGENT';
    createdBy?: string | null;
  }): Promise<SemanticSuggestion | null> {
    const history = await this.prisma.semanticSuggestion.findMany({
      where: { kind: input.kind, fingerprint: input.fingerprint },
      orderBy: { createdAt: 'desc' },
    });
    const live = history.find((row) => row.status === 'PROPOSED');
    if (live) {
      return this.prisma.semanticSuggestion.update({
        where: { id: live.id },
        data: {
          score: new Prisma.Decimal(input.score),
          rationale: input.rationale,
          evidence: input.evidence,
          payload: input.payload,
          supportCount: input.supportCount,
        },
      });
    }
    if (history.some((row) => row.status === 'ACCEPTED' || row.suppressed))
      return null;
    const dismissed = history.find((row) => row.status === 'DISMISSED');
    let rationale = input.rationale;
    if (dismissed) {
      const scoreUp = input.score >= Number(dismissed.score) + 0.1;
      const supportDoubled =
        dismissed.supportCount > 0 &&
        input.supportCount >= dismissed.supportCount * 2;
      if (!scoreUp && !supportDoubled) return null;
      const when = dismissed.decidedAt?.toISOString().slice(0, 10) ?? 'earlier';
      rationale = `${input.rationale} (Dismissed on ${when}${
        dismissed.dismissReason ? ` for "${dismissed.dismissReason}"` : ''
      }; ${supportDoubled ? 'evidence doubled since' : 'score rose since'}.)`;
    }
    try {
      return await this.prisma.semanticSuggestion.create({
        data: {
          kind: input.kind,
          fingerprint: input.fingerprint,
          termId: input.termId,
          assetId: input.assetId ?? null,
          payload: input.payload,
          score: new Prisma.Decimal(Math.min(Math.max(input.score, 0), 1)),
          generator: input.generator,
          origin: input.origin ?? 'SUGGESTION',
          rationale,
          evidence: input.evidence,
          supportCount: input.supportCount,
          previousId: dismissed?.id ?? null,
          createdBy: input.createdBy ?? null,
        },
      });
    } catch (error) {
      // The partial unique index raced another generator run: fine.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return null;
      }
      throw error;
    }
  }

  /** Pending suggestions whose reason disappeared become EXPIRED (SL4 §6). */
  async expire(): Promise<number> {
    let expired = 0;
    // BINDING: the output got an APPROVED binding some other way.
    expired += await this.prisma.$executeRaw`
      UPDATE semantic_suggestions s SET status = 'EXPIRED', updated_at = now()
       WHERE s.kind = 'BINDING' AND s.status = 'PROPOSED'
         AND EXISTS (
           SELECT 1 FROM glossary_bindings b
            WHERE b.status = 'APPROVED'
              AND b.detector_type::text IS NOT DISTINCT FROM (s.payload #>> '{output,detectorType}')
              AND b.finding_type IS NOT DISTINCT FROM (s.payload #>> '{output,findingType}')
              AND b.custom_detector_key IS NOT DISTINCT FROM (s.payload #>> '{output,customDetectorKey}')
              AND b.metadata_path IS NOT DISTINCT FROM (s.payload ->> 'field')
         )`;
    // LINK: the asset is already linked, or the concept is no longer APPROVED.
    expired += await this.prisma.$executeRaw`
      UPDATE semantic_suggestions s SET status = 'EXPIRED', updated_at = now()
       WHERE s.kind = 'LINK' AND s.status = 'PROPOSED'
         AND (
           EXISTS (SELECT 1 FROM asset_terms t WHERE t.asset_id = s.asset_id
                     AND t.term_id = s.term_id AND t.gone_at IS NULL)
           OR NOT EXISTS (SELECT 1 FROM glossary_terms g WHERE g.id = s.term_id AND g.status = 'APPROVED')
         )`;
    // RELATION: the relation exists now.
    expired += await this.prisma.$executeRaw`
      UPDATE semantic_suggestions s SET status = 'EXPIRED', updated_at = now()
       WHERE s.kind = 'RELATION' AND s.status = 'PROPOSED'
         AND EXISTS (
           SELECT 1 FROM glossary_relations r
            WHERE (r.from_term_id = s.payload ->> 'fromTermId' AND r.to_term_id = s.payload ->> 'toTermId')
               OR (r.from_term_id = s.payload ->> 'toTermId' AND r.to_term_id = s.payload ->> 'fromTermId')
         )`;
    return expired;
  }

  // ── G-1 Binding suggestions ────────────────────────────────────────────

  private async concepts(): Promise<Concept[]> {
    return this.prisma.glossaryTerm.findMany({
      where: { kind: 'CONCEPT', status: 'APPROVED' },
      select: {
        id: true,
        key: true,
        term: true,
        schemeId: true,
        codes: true,
        matchKeys: true,
        embedContentHash: true,
        definition: true,
        aliases: true,
        status: true,
      },
    });
  }

  /** Value lookup signal: the best scheme by share of top values it names. */
  lookupSignal(
    row: Pick<VocabularyRow, 'topValues' | 'categorical'>,
    concepts: Concept[],
  ): {
    schemeId: string;
    share: number;
    match: 'CODES' | 'ANY';
    matched: number;
  } | null {
    if (!row.categorical || !row.topValues.length) return null;
    const total = row.topValues.reduce((sum, v) => sum + v.count, 0);
    if (!total) return null;
    const bySchemeCodes = new Map<string, number>();
    const bySchemeAny = new Map<string, number>();
    for (const value of row.topValues) {
      const trimmed = value.value.replace(/^ +| +$/g, '');
      const normalized = glossaryNorm(value.value);
      const codeSchemes = new Set<string>();
      const anySchemes = new Set<string>();
      for (const concept of concepts) {
        if (!concept.schemeId) continue;
        if (concept.codes.includes(trimmed)) codeSchemes.add(concept.schemeId);
        if (concept.matchKeys.includes(normalized))
          anySchemes.add(concept.schemeId);
      }
      for (const scheme of codeSchemes)
        bySchemeCodes.set(
          scheme,
          (bySchemeCodes.get(scheme) ?? 0) + value.count,
        );
      for (const scheme of anySchemes)
        bySchemeAny.set(scheme, (bySchemeAny.get(scheme) ?? 0) + value.count);
    }
    let best: {
      schemeId: string;
      share: number;
      match: 'CODES' | 'ANY';
      matched: number;
    } | null = null;
    for (const [schemeId, count] of bySchemeCodes) {
      const share = count / total;
      if (!best || share > best.share)
        best = { schemeId, share, match: 'CODES', matched: count };
    }
    for (const [schemeId, count] of bySchemeAny) {
      const share = count / total;
      if (!best || share > best.share + 0.05)
        best = { schemeId, share, match: 'ANY', matched: count };
    }
    return best && best.share >= 0.5 ? best : null;
  }

  async generateBindings(minScore: number): Promise<number> {
    const [inventory, concepts] = await Promise.all([
      this.vocabulary.list({ kind: 'all', bound: 'false', take: 1000 }),
      this.concepts(),
    ]);
    if (!concepts.length) return 0;
    const embeddingsOn = await this.embeddingsOn();
    const conceptById = new Map(concepts.map((c) => [c.id, c]));
    const schemes = await this.prisma.glossaryScheme.findMany({
      select: { id: true, key: true, name: true },
    });
    const schemeById = new Map(schemes.map((s) => [s.id, s]));
    let written = 0;
    for (const row of inventory.rows) {
      if (row.bindings.some((b) => b.noMeaning || b.status === 'APPROVED'))
        continue;
      const label = row.output
        ? humaniseOutput(row.output.findingType)
        : glossaryNorm(row.field ?? '');
      const signals: Signal[] = [];
      for (const concept of concepts) {
        const score = lexicalScore(label, concept);
        if (score > 0)
          signals.push({ termId: concept.id, score, kind: 'lexical' });
      }
      let meaningVector: number[] | null = null;
      if (embeddingsOn && this.queryEmbedding) {
        try {
          meaningVector = await this.queryEmbedding.embed(
            [label, row.label.detail, row.output?.customDetectorName ?? '']
              .filter(Boolean)
              .join(' · '),
          );
          for (const hit of await this.nearestConcepts(meaningVector, 3)) {
            signals.push({
              termId: hit.termId,
              score: hit.score,
              kind: 'meaning',
            });
          }
        } catch {
          meaningVector = null;
        }
      }
      // Content: do sampled findings of this output sit near the candidate?
      const content = new Map<string, number>();
      if (embeddingsOn && row.output) {
        const candidates = [...new Set(signals.map((s) => s.termId))].slice(
          0,
          5,
        );
        for (const termId of candidates) {
          const cos = await this.contentCosine(
            row,
            conceptById.get(termId)!,
          ).catch(() => null);
          if (cos !== null) {
            content.set(termId, cos);
            if (cos >= CONTENT_FLOOR)
              signals.push({ termId, score: cos, kind: 'content' });
          }
        }
      }
      const lookup = this.lookupSignal(row, concepts);

      let best: {
        score: number;
        spec: BindingSpec;
        compiled: CompiledBinding;
        termId: string | null;
        rationale: string;
      } | null = null;
      const termIds = [...new Set(signals.map((s) => s.termId))];
      for (const termId of termIds) {
        const contradicts =
          content.has(termId) && content.get(termId)! < CONTENT_FLOOR;
        const score = combineSignals(signals, termId, contradicts);
        if (score < minScore || (best && best.score >= score)) continue;
        const concept = conceptById.get(termId)!;
        const parts: string[] = [];
        const lex = signals.find(
          (s) => s.termId === termId && s.kind === 'lexical',
        );
        if (lex)
          parts.push(
            `'${label}' matches ${concept.term} (lexical ${lex.score.toFixed(2)})`,
          );
        const meaning = signals.find(
          (s) => s.termId === termId && s.kind === 'meaning',
        );
        if (meaning)
          parts.push(
            `the label means ${concept.term} (meaning ${meaning.score.toFixed(2)})`,
          );
        if (content.has(termId))
          parts.push(
            `sampled findings are ${content.get(termId)! >= CONTENT_FLOOR ? 'close' : 'not close'} (content ${content.get(termId)!.toFixed(2)})`,
          );
        const spec: BindingSpec = row.output
          ? {
              mode: 'OUTPUT',
              output: {
                detectorType: row.output.detectorType,
                customDetectorKey: row.output.customDetectorKey,
                findingType: row.output.findingType,
              },
              termId,
              termKey: concept.key,
            }
          : {
              mode: 'METADATA_VALUES',
              field: row.field,
              values: row.topValues.slice(0, 1).map((v) => v.value),
              termId,
              termKey: concept.key,
            };
        if (!row.output && !row.topValues.length) continue;
        best = {
          score,
          spec,
          compiled: this.compileLocal(spec, termId, null),
          termId,
          rationale: `${parts.join('. ')}.`,
        };
      }
      if (
        lookup &&
        lookup.share >= minScore &&
        (!best || lookup.share >= best.score)
      ) {
        const scheme = schemeById.get(lookup.schemeId);
        const spec: BindingSpec = row.output
          ? {
              mode: 'OUTPUT_LOOKUP',
              output: {
                detectorType: row.output.detectorType,
                customDetectorKey: row.output.customDetectorKey,
                findingType: row.output.findingType,
              },
              lookup: {
                schemeId: lookup.schemeId,
                schemeKey: scheme?.key,
                match: lookup.match,
              },
            }
          : {
              mode: 'METADATA_LOOKUP',
              field: row.field,
              lookup: {
                schemeId: lookup.schemeId,
                schemeKey: scheme?.key,
                match: lookup.match,
              },
            };
        best = {
          score: Math.round(lookup.share * 1000) / 1000,
          spec,
          compiled: this.compileLocal(spec, null, lookup.schemeId),
          termId: null,
          rationale: `${Math.round(lookup.share * 100)}% of the top values are ${lookup.match === 'CODES' ? 'codes' : 'labels'} of concepts in ${scheme?.name ?? 'one scheme'} (value lookup ${lookup.share.toFixed(2)}).`,
        };
      }
      if (!best) continue;
      const written1 = await this.propose({
        kind: 'BINDING',
        fingerprint: bindingFingerprint(best.compiled),
        termId: best.termId,
        payload: best.spec as unknown as Prisma.InputJsonValue,
        score: best.score,
        generator: 'binding',
        rationale: best.rationale,
        evidence: {
          vocabulary: row.id,
          label: row.label,
          openCount: row.openCount,
          assetCount: row.assetCount,
          topValues: row.topValues.slice(0, 5),
        },
        supportCount: row.openCount || row.assetCount,
      });
      if (written1) written += 1;
    }
    return written;
  }

  private compileLocal(
    spec: BindingSpec,
    termId: string | null,
    lookupSchemeId: string | null,
  ): CompiledBinding {
    return {
      id: '',
      mode: spec.mode,
      detectorType: spec.output?.detectorType ?? null,
      customDetectorKey: spec.output?.customDetectorKey ?? null,
      findingType: spec.output?.findingType ?? null,
      metadataPath: spec.field ?? null,
      values: (spec.values ?? [])
        .map((v) => glossaryNorm(v))
        .filter(Boolean)
        .sort(),
      splitDelimiter: null,
      termId,
      lookupSchemeId,
      lookupMatch: spec.lookup?.match ?? null,
      noMeaning: false,
      sourceIds: [],
      confidence: 1,
    };
  }

  private async space() {
    if (!this.embeddings) throw new Error('embeddings unavailable');
    return this.embeddings.configuredSpace();
  }

  /** Nearest APPROVED concepts to a vector, by the terms' own embeddings. */
  private async nearestConcepts(
    vector: number[],
    limit: number,
  ): Promise<Array<{ termId: string; score: number }>> {
    const space = await this.space();
    const dim = Prisma.raw(String(space.dim));
    const vecType = Prisma.raw(vectorCast(space.dim).type);
    const rows = await this.prisma.$queryRaw<
      Array<{ id: string; score: number }>
    >(Prisma.sql`
      SELECT gt.id, 1 - (ce.vec::public.${vecType}(${dim}) <=> ${JSON.stringify(vector)}::public.${vecType}(${dim})) AS score
        FROM glossary_terms gt
        JOIN content_embeddings ce ON ce.content_hash = gt.embed_content_hash AND ce.space_id = ${space.id}
       WHERE gt.kind = 'CONCEPT' AND gt.status = 'APPROVED'
       ORDER BY ce.vec::public.${vecType}(${dim}) <=> ${JSON.stringify(vector)}::public.${vecType}(${dim})
       LIMIT ${limit}`);
    return rows.map((row) => ({
      termId: row.id,
      score: Math.round(Number(row.score) * 1000) / 1000,
    }));
  }

  /** Mean cosine of up to 20 sampled findings of an output to a concept. */
  private async contentCosine(
    row: VocabularyRow,
    concept: Concept,
  ): Promise<number | null> {
    if (!row.output || !concept.embedContentHash) return null;
    const space = await this.space();
    const dim = Prisma.raw(String(space.dim));
    const vecType = Prisma.raw(vectorCast(space.dim).type);
    const [result] = await this.prisma.$queryRaw<
      Array<{ cos: number | null; n: bigint }>
    >(Prisma.sql`
      WITH sample AS (
        SELECT f.embed_content_hash FROM findings f
         WHERE f.status = 'OPEN' AND f.embed_content_hash IS NOT NULL
           AND f.detector_type = ${row.output.detectorType}::"DetectorType"
           AND COALESCE(f.custom_detector_key, '') = ${row.output.customDetectorKey ?? ''}
           AND f.finding_type = ${row.output.findingType}
         LIMIT 20
      )
      SELECT avg(1 - (fe.vec::public.${vecType}(${dim}) <=> te.vec::public.${vecType}(${dim}))) AS cos, count(*) AS n
        FROM sample s
        JOIN content_embeddings fe ON fe.content_hash = s.embed_content_hash AND fe.space_id = ${space.id}
        JOIN content_embeddings te ON te.content_hash = ${concept.embedContentHash} AND te.space_id = ${space.id}`);
    if (!result || Number(result.n) === 0 || result.cos === null) return null;
    return Math.round(Number(result.cos) * 1000) / 1000;
  }

  // ── G-2 Link suggestions ───────────────────────────────────────────────

  async generateLinks(
    minScore: number,
    cap: number,
    termIds?: string[],
  ): Promise<number> {
    if (!(await this.embeddingsOn()) || !this.embeddings) return 0;
    const concepts = (await this.concepts()).filter(
      (c) =>
        (!termIds?.length || termIds.includes(c.id)) &&
        c.embedContentHash &&
        (c.definition || c.aliases.length),
    );
    if (!concepts.length) return 0;
    const space = await this.space();
    let written = 0;
    for (const concept of concepts) {
      const [vecRow] = await this.prisma.$queryRaw<Array<{ vec: string }>>`
        SELECT vec::text AS vec FROM content_embeddings
         WHERE content_hash = ${concept.embedContentHash} AND space_id = ${space.id}`;
      if (!vecRow) continue;
      let vector: number[];
      try {
        vector = JSON.parse(vecRow.vec) as number[];
      } catch {
        continue;
      }
      const hits = await this.embeddings.semanticAssetIds(
        vector,
        MAX_LINK_CANDIDATES,
      );
      const candidates = hits.filter((hit) => Number(hit.score) >= minScore);
      if (!candidates.length) continue;
      const linked = await this.prisma.assetTerm.findMany({
        where: {
          termId: concept.id,
          goneAt: null,
          assetId: { in: candidates.map((c) => c.id) },
        },
        select: { assetId: true },
      });
      const already = new Set(linked.map((row) => row.assetId));
      const fresh = candidates.filter((c) => !already.has(c.id)).slice(0, cap);
      for (const hit of fresh) {
        const chunk = await this.bestChunk(hit.id, vector, space).catch(
          () => null,
        );
        const similarity = Math.round(Number(hit.score) * 1000) / 1000;
        const row = await this.propose({
          kind: 'LINK',
          fingerprint: linkFingerprint(hit.id, concept.id),
          termId: concept.id,
          assetId: hit.id,
          payload: {
            similarity,
            chunkHash: chunk?.hash ?? null,
          },
          score: similarity,
          generator: 'link',
          rationale: chunk
            ? `Mentions the idea: '${excerpt(chunk.text, 140)}' (similarity ${similarity.toFixed(2)}).`
            : `Semantically close to ${concept.term} (similarity ${similarity.toFixed(2)}).`,
          evidence: chunk
            ? {
                chunk: excerpt(chunk.text, 400),
                page: chunk.page,
                similarity,
              }
            : { similarity },
          supportCount: 1,
        });
        if (row) written += 1;
      }
      // Keep the highest scores within the cap per concept.
      const pending = await this.prisma.semanticSuggestion.findMany({
        where: { kind: 'LINK', status: 'PROPOSED', termId: concept.id },
        orderBy: { score: 'desc' },
        select: { id: true },
        skip: cap,
      });
      if (pending.length) {
        await this.prisma.semanticSuggestion.updateMany({
          where: { id: { in: pending.map((p) => p.id) } },
          data: { status: 'EXPIRED' },
        });
      }
    }
    return written;
  }

  private async bestChunk(
    assetId: string,
    vector: number[],
    space: { id: string; dim: number },
  ): Promise<{ text: string; page: number | null; hash: string } | null> {
    const dim = Prisma.raw(String(space.dim));
    const vecType = Prisma.raw(vectorCast(space.dim).type);
    const [row] = await this.prisma.$queryRaw<
      Array<{ text: string; page: number | null; content_hash: string }>
    >(Prisma.sql`
      SELECT ac.text, ac.page, ac.content_hash FROM asset_chunks ac
        JOIN content_embeddings ce ON ce.content_hash = ac.content_hash AND ce.space_id = ${space.id}
       WHERE ac.asset_id = ${assetId}
       ORDER BY ce.vec::public.${vecType}(${dim}) <=> ${JSON.stringify(vector)}::public.${vecType}(${dim})
       LIMIT 1`);
    return row
      ? { text: row.text, page: row.page, hash: row.content_hash }
      : null;
  }

  // ── G-3 Relation suggestions ───────────────────────────────────────────

  async generateRelations(
    minSupport: number,
    minLift: number,
    minScore: number,
  ): Promise<number> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        a: string;
        b: string;
        support: bigint;
        na: bigint;
        nb: bigint;
        total: bigint;
      }>
    >`
      WITH current AS (
        SELECT DISTINCT t.asset_id, t.term_id FROM asset_terms t
          JOIN glossary_terms g ON g.id = t.term_id AND g.kind = 'CONCEPT' AND g.status = 'APPROVED'
         WHERE t.gone_at IS NULL
      ),
      per_term AS (
        SELECT term_id, count(*) AS n FROM current GROUP BY term_id
      ),
      sampled AS (
        SELECT c.* FROM current c JOIN per_term p USING (term_id)
         WHERE p.n <= ${COOCCURRENCE_HUB}
            OR abs(hashtext(c.asset_id)) % GREATEST(p.n / ${COOCCURRENCE_HUB}, 1) = 0
      ),
      pairs AS (
        SELECT x.term_id AS a, y.term_id AS b, count(*) AS support
          FROM sampled x JOIN sampled y ON y.asset_id = x.asset_id AND x.term_id < y.term_id
         GROUP BY 1, 2 HAVING count(*) >= ${minSupport}
      )
      SELECT p.a, p.b, p.support, pa.n AS na, pb.n AS nb,
             (SELECT count(DISTINCT asset_id) FROM current) AS total
        FROM pairs p JOIN per_term pa ON pa.term_id = p.a JOIN per_term pb ON pb.term_id = p.b
       WHERE NOT EXISTS (
         SELECT 1 FROM glossary_relations r
          WHERE (r.from_term_id = p.a AND r.to_term_id = p.b) OR (r.from_term_id = p.b AND r.to_term_id = p.a)
       )`;
    if (!rows.length) return 0;
    const ancestors = await this.ancestorPairs([
      ...new Set(rows.flatMap((r) => [r.a, r.b])),
    ]);
    const terms = await this.prisma.glossaryTerm.findMany({
      where: { id: { in: [...new Set(rows.flatMap((r) => [r.a, r.b]))] } },
      select: { id: true, term: true },
    });
    const name = new Map(terms.map((t) => [t.id, t.term]));
    let written = 0;
    for (const row of rows) {
      if (
        ancestors.has(`${row.a}:${row.b}`) ||
        ancestors.has(`${row.b}:${row.a}`)
      )
        continue;
      const total = Number(row.total);
      const lift =
        (Number(row.support) * total) /
        Math.max(Number(row.na) * Number(row.nb), 1);
      if (lift < minLift) continue;
      // Score: support and lift both matter; saturates around lift 10, support 200.
      const score =
        Math.round(
          Math.min(
            1,
            0.5 +
              0.25 * Math.min(lift / 10, 1) +
              0.25 * Math.min(Number(row.support) / 200, 1),
          ) * 1000,
        ) / 1000;
      if (score < minScore) continue;
      const proposed = await this.propose({
        kind: 'RELATION',
        fingerprint: relationFingerprint(row.a, row.b, 'RELATED'),
        termId: row.a,
        payload: {
          fromTermId: row.a,
          toTermId: row.b,
          type: 'RELATED',
        },
        score,
        generator: 'relation',
        rationale: `Co-occur on ${Number(row.support)} assets (lift ${lift.toFixed(1)}): ${name.get(row.a)} and ${name.get(row.b)}.`,
        evidence: {
          support: Number(row.support),
          lift: Math.round(lift * 100) / 100,
        },
        supportCount: Number(row.support),
      });
      if (proposed) written += 1;
    }
    return written;
  }

  /** Pairs where one concept is a BROADER ancestor of the other. */
  private async ancestorPairs(termIds: string[]): Promise<Set<string>> {
    if (!termIds.length) return new Set();
    const rows = await this.prisma.$queryRaw<
      Array<{ start_id: string; term_id: string }>
    >`
      WITH RECURSIVE up(start_id, term_id, depth) AS (
        SELECT t, t, 0 FROM unnest(${termIds}::text[]) t
        UNION
        SELECT up.start_id, r.to_term_id, up.depth + 1 FROM glossary_relations r
          JOIN up ON r.from_term_id = up.term_id
         WHERE r.type = 'BROADER' AND up.depth < 10
      )
      SELECT start_id, term_id FROM up WHERE depth > 0`;
    return new Set(rows.map((r) => `${r.start_id}:${r.term_id}`));
  }

  // ── Agent link proposals (SL3 R5, D7) ──────────────────────────────────

  async proposeAgentLink(input: {
    termId: string;
    assetId: string;
    note?: string;
    agent: string;
  }) {
    return this.propose({
      kind: 'LINK',
      fingerprint: linkFingerprint(input.assetId, input.termId),
      termId: input.termId,
      assetId: input.assetId,
      payload: { note: input.note ?? null },
      score: 0.9,
      generator: 'agent',
      origin: 'AGENT',
      rationale: input.note
        ? `Proposed by ${input.agent}: ${input.note}`
        : `Proposed by ${input.agent}.`,
      supportCount: 1,
      createdBy: input.agent,
    });
  }

  // ── Events and stats ───────────────────────────────────────────────────

  async pendingCounts(): Promise<Record<string, number>> {
    const [suggestions, terms, aliases, relations, bindings, refs] =
      await Promise.all([
        this.prisma.semanticSuggestion.groupBy({
          by: ['kind'],
          where: { status: 'PROPOSED' },
          _count: { _all: true },
        }),
        this.prisma.glossaryTerm.count({ where: { status: 'DRAFT' } }),
        this.prisma.glossaryTerm.count({
          where: { proposedAliases: { isEmpty: false } },
        }),
        this.prisma.glossaryRelation.count({ where: { status: 'DRAFT' } }),
        this.prisma.glossaryBinding.count({ where: { status: 'DRAFT' } }),
        this.prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(DISTINCT to_id) AS n FROM edges WHERE to_type = 'term_ref'`,
      ]);
    const byKind = new Map(suggestions.map((s) => [s.kind, s._count._all]));
    return {
      TERM: terms,
      ALIAS: aliases,
      RELATION: relations + (byKind.get('RELATION') ?? 0),
      BINDING: bindings + (byKind.get('BINDING') ?? 0),
      LINK: byKind.get('LINK') ?? 0,
      TERM_REF: Number(refs[0]?.n ?? 0),
    };
  }

  /** `glossary.proposals_pending` when the count crosses 10/50/100/500, once a day. */
  async notifyPending(): Promise<void> {
    const counts = await this.pendingCounts();
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    const settings = await this.prisma.instanceSettings.findUnique({
      where: { id: 1 },
    });
    const today = new Date().toISOString().slice(0, 10);
    const state =
      (settings?.glossaryProposalsNotified as {
        day?: string;
        thresholds?: number[];
      } | null) ?? {};
    const fired = state.day === today ? (state.thresholds ?? []) : [];
    const crossed = PROPOSAL_THRESHOLDS.filter(
      (t) => total >= t && !fired.includes(t),
    );
    if (!crossed.length || !settings) return;
    const threshold = Math.max(...crossed);
    glossaryEvents.emit({
      type: 'glossary.proposals_pending',
      threshold,
      counts,
    });
    await this.prisma.instanceSettings.update({
      where: { id: 1 },
      data: {
        glossaryProposalsNotified: {
          day: today,
          thresholds: [...fired, ...crossed],
        },
      },
    });
  }

  /** Acceptance per generator and score band (SL4 R7). */
  async stats(days = 90) {
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await this.prisma.$queryRaw<
      Array<{
        generator: string;
        band: number;
        accepted: bigint;
        dismissed: bigint;
      }>
    >`
      SELECT generator, floor(score * 10) / 10 AS band,
             count(*) FILTER (WHERE status = 'ACCEPTED') AS accepted,
             count(*) FILTER (WHERE status = 'DISMISSED') AS dismissed
        FROM semantic_suggestions
       WHERE decided_at >= ${since} AND status IN ('ACCEPTED', 'DISMISSED')
       GROUP BY 1, 2 ORDER BY 1, 2`;
    const reasons = await this.prisma.$queryRaw<
      Array<{ generator: string; reason: string | null; n: bigint }>
    >`
      SELECT generator, dismiss_reason AS reason, count(*) AS n FROM semantic_suggestions
       WHERE decided_at >= ${since} AND status = 'DISMISSED' GROUP BY 1, 2`;
    return {
      days,
      bands: rows.map((r) => {
        const accepted = Number(r.accepted);
        const dismissed = Number(r.dismissed);
        return {
          generator: r.generator,
          band: Number(r.band),
          accepted,
          dismissed,
          rate: accepted + dismissed ? accepted / (accepted + dismissed) : null,
        };
      }),
      dismissReasons: reasons.map((r) => ({
        generator: r.generator,
        reason: r.reason,
        count: Number(r.n),
      })),
      embeddings: await this.embeddingsOn(),
    };
  }
}
