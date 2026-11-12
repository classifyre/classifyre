import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { GlossaryService } from '../glossary/glossary.service';
import { MeaningService } from '../semantic/links/meaning.service';
import { columnsOf } from './governance-columns.service';

export interface MeaningTermRef {
  id: string;
  key: string;
  term: string;
  status: string;
  definition: string | null;
}

export interface GovernanceMeaningTerm {
  term: MeaningTermRef;
  /** How it is linked: MANUAL, BINDING, DECLARED, SUGGESTED, MENTION. */
  methods: string[];
  /** The hand-made link, which can be removed here; bindings cannot. */
  referenceId: string | null;
  /** Linked by hand moments ago: the linker has not caught up yet. */
  pending: boolean;
}

export interface GovernanceMeaningSuggestion {
  term: MeaningTermRef;
  /** Where it came from: the semantic layer, or a name of the table. */
  source: 'semantic' | 'name' | 'column';
  /** The suggestion row, for semantic ones (dismissable). */
  suggestionId: string | null;
  /** What it matched: a column, the table name, a passage. */
  reason: string;
  score: number;
}

export interface GovernanceMeaning {
  terms: GovernanceMeaningTerm[];
  suggestions: GovernanceMeaningSuggestion[];
}

const MAX_NAME_LOOKUPS = 12;
const MAX_SUGGESTIONS = 8;

/** `crm.customer_orders.parquet` → `customer orders`; short or numeric parts dropped. */
export function nameQuery(name: string): string | null {
  const file = (name.split(/[/\\]/).pop() ?? name).replace(
    /\.(csv|tsv|parquet|json|jsonl|avro|xlsx?|delta|lance)$/i,
    '',
  );
  // `schema.table`: the table is what it is about.
  const last = file.split('.').filter(Boolean).pop() ?? file;
  const words = last
    .split(/[_\-\s]+/)
    .filter((word) => word.length > 1 && !/^\d+$/.test(word));
  const tail = words.slice(-3).join(' ').trim();
  return tail.length >= 3 ? tail.replace(/([a-z])([A-Z])/g, '$1 $2') : null;
}

/**
 * The meaning step of governance (GOV §5.7): the glossary terms an asset is
 * about, and terms it probably is about. Links are the semantic layer's own
 * manual links (SL3 R5), made here under governance rights rather than
 * `glossary.edit`, and shown at once even before the linker has rolled them
 * into `asset_terms`.
 */
@Injectable()
export class GovernanceMeaningService {
  private readonly logger = new Logger(GovernanceMeaningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly meaning: MeaningService,
    private readonly glossary: GlossaryService,
  ) {}

  async state(assetId: string): Promise<GovernanceMeaning> {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      select: { id: true, name: true, metadata: true },
    });
    if (!asset) throw new NotFoundException(`Asset ${assetId} not found`);
    const termSelect = {
      id: true,
      key: true,
      term: true,
      status: true,
      definition: true,
    } as const;
    const [linked, references, suggestions] = await Promise.all([
      this.prisma.assetTerm.findMany({
        where: { assetId, goneAt: null },
        select: { method: true, term: { select: termSelect } },
      }),
      this.prisma.glossaryReference.findMany({
        where: { entityType: 'asset', entityId: assetId, role: 'ABOUT' },
        select: { id: true, term: { select: termSelect } },
      }),
      this.prisma.semanticSuggestion.findMany({
        where: {
          kind: 'LINK',
          status: 'PROPOSED',
          assetId,
          suppressed: false,
          termId: { not: null },
        },
        select: {
          id: true,
          score: true,
          rationale: true,
          term: { select: termSelect },
        },
        orderBy: { score: 'desc' },
        take: MAX_SUGGESTIONS,
      }),
    ]);

    const byTerm = new Map<string, GovernanceMeaningTerm>();
    for (const row of linked) {
      const entry = byTerm.get(row.term.id) ?? {
        term: row.term,
        methods: [],
        referenceId: null,
        pending: false,
      };
      if (!entry.methods.includes(row.method)) entry.methods.push(row.method);
      byTerm.set(row.term.id, entry);
    }
    for (const reference of references) {
      const entry = byTerm.get(reference.term.id);
      if (entry) {
        entry.referenceId = reference.id;
        if (!entry.methods.includes('MANUAL')) entry.methods.push('MANUAL');
      } else {
        byTerm.set(reference.term.id, {
          term: reference.term,
          methods: ['MANUAL'],
          referenceId: reference.id,
          pending: true,
        });
      }
    }

    const out: GovernanceMeaningSuggestion[] = [];
    const seen = new Set(byTerm.keys());
    for (const row of suggestions) {
      if (!row.term || seen.has(row.term.id)) continue;
      seen.add(row.term.id);
      out.push({
        term: row.term,
        source: 'semantic',
        suggestionId: row.id,
        reason: row.rationale,
        score: Number(row.score),
      });
    }

    // Terms whose names match the table's or its columns' (cheap, lexical).
    const queries: {
      query: string;
      source: 'name' | 'column';
      reason: string;
    }[] = [];
    const tableQuery = nameQuery(asset.name);
    if (tableQuery) {
      queries.push({ query: tableQuery, source: 'name', reason: asset.name });
    }
    for (const column of columnsOf(asset.metadata)) {
      const query = nameQuery(column.name);
      if (query) queries.push({ query, source: 'column', reason: column.name });
      if (queries.length >= MAX_NAME_LOOKUPS) break;
    }
    const hits = await Promise.all(
      queries.map((item) =>
        this.glossary
          .lookup(item.query, 3, { kind: 'CONCEPT' })
          .then((found) => ({ item, found }))
          .catch((error: unknown) => {
            this.logger.debug(`lookup ${item.query}: ${String(error)}`);
            return { item, found: [] };
          }),
      ),
    );
    for (const { item, found } of hits) {
      for (const hit of found) {
        if (seen.has(hit.id) || hit.deprecated) continue;
        // Semantic matches on a bare column name are too loose to offer.
        if (hit.matchedOn === 'semantic' && (hit.similarity ?? 0) < 0.75) {
          continue;
        }
        seen.add(hit.id);
        out.push({
          term: {
            id: hit.id,
            key: hit.key,
            term: hit.term,
            status: hit.status,
            definition: hit.definition ?? null,
          },
          source: item.source,
          suggestionId: null,
          reason: item.reason,
          score: hit.matchedOn === 'semantic' ? (hit.similarity ?? 0.5) : 0.9,
        });
      }
    }

    return {
      terms: [...byTerm.values()].sort((a, b) =>
        a.term.term.localeCompare(b.term.term),
      ),
      suggestions: out.slice(0, MAX_SUGGESTIONS),
    };
  }

  /** Link by hand; a pending semantic suggestion for it counts as accepted. */
  async link(assetId: string, termId: string, actor: string): Promise<void> {
    await this.meaning.link({
      termId,
      target: { type: 'asset', id: assetId },
      actor,
    });
    await this.prisma.semanticSuggestion.updateMany({
      where: { kind: 'LINK', status: 'PROPOSED', assetId, termId },
      data: { status: 'ACCEPTED', decidedBy: actor, decidedAt: new Date() },
    });
  }

  /** Remove a hand-made link; links from bindings or sources stay. */
  async unlink(assetId: string, termId: string, actor: string): Promise<void> {
    const reference = await this.prisma.glossaryReference.findFirst({
      where: {
        entityType: 'asset',
        entityId: assetId,
        role: 'ABOUT',
        glossaryTermId: termId,
      },
      select: { id: true },
    });
    if (!reference) {
      throw new BadRequestException(
        'This term was not linked by hand: it comes from a binding or the source, and changes there.',
      );
    }
    await this.meaning.unlink(reference.id, actor);
  }

  async dismiss(
    assetId: string,
    suggestionId: string,
    actor: string,
  ): Promise<void> {
    const { count } = await this.prisma.semanticSuggestion.updateMany({
      where: { id: suggestionId, assetId, kind: 'LINK', status: 'PROPOSED' },
      data: { status: 'DISMISSED', decidedBy: actor, decidedAt: new Date() },
    });
    if (!count) throw new NotFoundException('No such suggestion here.');
  }
}
