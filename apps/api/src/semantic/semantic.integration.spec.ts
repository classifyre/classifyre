import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { GlossaryService } from '../glossary/glossary.service';
import { GlossaryRelationsService } from '../glossary/glossary-relations.service';
import { GlossaryImportExportService } from '../glossary/glossary-import-export.service';
import { BindingsService } from './bindings/bindings.service';
import { SemanticJobsScheduler } from './semantic-jobs.scheduler';
import { SemanticLinkerService } from './linker/semantic-linker.service';
import { MeaningService } from './links/meaning.service';
import { VocabularyService } from './vocabulary/vocabulary.service';
import { SemanticSuggestionsService } from './suggestions/semantic-suggestions.service';
import { GlossaryProposalsService } from './suggestions/glossary-proposals.service';
import { SemanticMapService } from './map/semantic-map.service';
import { GlossaryPacksService } from './packs/glossary-packs.service';
import { SemanticBoardLayerService } from './board/semantic-board-layer.service';
import { stitchTermRefs, unknownTermRefs } from './term-refs';

/**
 * The semantic layer end to end against Postgres: a pack installs schemes,
 * codes and template bindings; a lookup binding links register records to
 * legal forms without a re-scan; disabling it makes the links GONE and
 * enabling revives them; manual links, connector declarations and unknown
 * term references; the term page's evidence with narrower concepts; binding
 * suggestions and the review queue; the semantic map; the board layer.
 *
 * Needs a database whose schema is fully migrated:
 *   SEMANTIC_TEST_DATABASE_URL=postgresql://…  SEMANTIC_TEST_SCHEMA=ns_test
 * The schema's tables are TRUNCATED. Skipped when either is unset.
 */
const url = process.env.SEMANTIC_TEST_DATABASE_URL;
const schema = process.env.SEMANTIC_TEST_SCHEMA;
const describeDb = url && schema ? describe : describe.skip;

describeDb('semantic layer (integration)', () => {
  let prisma: PrismaClient;
  let glossary: GlossaryService;
  let relations: GlossaryRelationsService;
  let bindings: BindingsService;
  let linker: SemanticLinkerService;
  let meaning: MeaningService;
  let vocabulary: VocabularyService;
  let suggestions: SemanticSuggestionsService;
  let proposals: GlossaryProposalsService;
  let map: SemanticMapService;
  let packs: GlossaryPacksService;
  let scheduler: SemanticJobsScheduler;
  let layer: SemanticBoardLayerService;
  let transfer: GlossaryImportExportService;
  const sent: Array<{ queue: string; data: unknown }> = [];

  const ids = {
    source: randomUUID(),
    a1: randomUUID(),
    a2: randomUUID(),
    a3: randomUUID(),
  };
  const findings: Record<string, string> = {};

  beforeAll(async () => {
    const raw = new URL(url!);
    raw.searchParams.delete('schema');
    prisma = new PrismaClient({
      adapter: new PrismaPg(
        { connectionString: raw.toString(), options: `-c search_path=${schema},public` },
        { schema },
      ),
    });
    const cls = { get: () => schema };
    const boss = {
      getBossAsync: async () => ({
        send: async (queue: string, data: unknown) => {
          sent.push({ queue, data });
          return 'job';
        },
      }),
    };
    const queue = { enqueue: jest.fn() };
    const noEmbeddings = { embed: jest.fn().mockRejectedValue(new Error('off')) };
    const db = prisma as never;
    glossary = new GlossaryService(db, queue as never, {} as never, noEmbeddings as never);
    relations = new GlossaryRelationsService(db);
    bindings = new BindingsService(db, cls as never);
    scheduler = new SemanticJobsScheduler(db, boss as never);
    linker = new SemanticLinkerService(db, bindings);
    meaning = new MeaningService(db, bindings, relations, scheduler);
    vocabulary = new VocabularyService(db);
    suggestions = new SemanticSuggestionsService(db, vocabulary);
    proposals = new GlossaryProposalsService(db, glossary, relations, bindings, suggestions, scheduler);
    map = new SemanticMapService(db, vocabulary);
    transfer = new GlossaryImportExportService(db, queue as never, cls as never);
    packs = new GlossaryPacksService(db, transfer, bindings);
    layer = new SemanticBoardLayerService(db, meaning);

    await prisma.$executeRawUnsafe(`TRUNCATE TABLE
      sources, glossary_terms, glossary_schemes, glossary_bindings, glossary_activities,
      custom_detectors, cases, semantic_suggestions, semantic_link_jobs, vocabulary_items,
      vocabulary_fields, asset_terms, edges, term_graph_nodes, term_graph_links,
      term_graph_state, semantic_stats, instance_settings CASCADE`);
    await prisma.instanceSettings.create({ data: { id: 1 } });
    await prisma.source.create({
      data: { id: ids.source, name: 'Firmenbuch', type: 'CUSTOM' as never, config: {} },
    });
    for (const [id, name, metadata] of [
      [ids.a1, 'FN 606601k', { legal_form: 'GES', doc_type: 'register' }],
      [ids.a2, 'FN 12345a', { legal_form: 'AG' }],
      [ids.a3, 'FN 99999z', { legal_form: 'EU' }],
    ] as const) {
      await prisma.asset.create({
        data: {
          id,
          name,
          checksum: id,
          hash: id,
          externalUrl: `https://example.test/${id}`,
          sourceType: 'CUSTOM' as never,
          sourceId: ids.source,
          assetType: 'RECORD',
          metadata,
        },
      });
    }
    const finding = async (
      key: string,
      assetId: string,
      detectorType: string,
      findingType: string,
      value: string,
      customDetectorKey: string | null,
      severity = 'LOW',
    ) => {
      const id = randomUUID();
      findings[key] = id;
      await prisma.finding.create({
        data: {
          id,
          sourceId: ids.source,
          assetId,
          findingType,
          category: 'CLASSIFICATION',
          severity: severity as never,
          confidence: 1,
          matchedContent: value,
          detectedAt: new Date(),
          detectorType: detectorType as never,
          detectionIdentity: id.replace(/-/g, '').slice(0, 64),
          customDetectorKey,
          customDetectorName: customDetectorKey,
        },
      });
    };
    await finding('ges', ids.a1, 'CUSTOM', 'tag:legal_form', 'GES', 'legal_form');
    await finding('ag', ids.a2, 'CUSTOM', 'tag:legal_form', 'AG', 'legal_form');
    await finding('eu', ids.a3, 'CUSTOM', 'tag:legal_form', 'EU', 'legal_form');
    await finding('iban', ids.a1, 'PII', 'IBAN_CODE', 'AT61 1904 3002 3457 3201', null, 'HIGH');
    await finding('fm', ids.a2, 'CUSTOM', 'force_majeure', 'force majeure clause', 'supplier-mail');
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('installs a pack: schemes, codes, taxonomy, template bindings waiting for their detector', async () => {
    const dry = await packs.install({ key: 'dach-company-law', dryRun: true });
    expect(dry.terms.counts.create).toBeGreaterThan(10);
    expect(await prisma.glossaryTerm.count()).toBe(0);

    const real = await packs.install({ key: 'dach-company-law', dryRun: false });
    expect(real.bindings.counts.waiting).toBe(2);
    const gmbh = await glossary.resolveOrThrow('gmbh');
    expect(gmbh.codes).toEqual(['GES']);
    expect(gmbh.status).toBe('APPROVED');
    expect(await relations.broaderClosure(gmbh.id)).toHaveLength(3);
    const waiting = await prisma.glossaryBinding.findMany({ where: { packKey: 'dach-company-law' } });
    expect(waiting.every((b) => b.status === 'DRAFT')).toBe(true);
  });

  it('activates the waiting binding once the TAG detector exists, and links without a re-scan', async () => {
    await prisma.customDetector.create({
      data: { key: 'legal_form', name: 'legal_form', pipelineSchema: { type: 'TAG' } },
    });
    expect(await packs.activateWaitingBindings()).toBe(1);
    await scheduler.scheduleBackfill({ all: true, reason: 'test' });
    await linker.drain();
    const rows = await prisma.assetTerm.findMany({ include: { term: true } });
    expect(rows.map((r) => [r.assetId, r.term.key, r.method]).sort()).toEqual(
      [
        [ids.a1, 'gmbh', 'BINDING'],
        [ids.a2, 'aktiengesellschaft', 'BINDING'],
      ].sort(),
    );
    const job = await prisma.semanticLinkJob.findFirst({ orderBy: { createdAt: 'desc' } });
    expect(job?.status).toBe('DONE');
  });

  it('rolls evidence up the taxonomy on read (include narrower)', async () => {
    const kap = await glossary.resolveOrThrow('kapitalgesellschaft');
    const direct = await meaning.termEvidence(kap.id, {});
    const rolled = await meaning.termEvidence(kap.id, { includeNarrower: true });
    expect(direct.total).toBe(0);
    expect(rolled.total).toBe(2);
    const summary = await meaning.termSummary(kap.id, true);
    expect(summary.counts.withNarrower).toBe(2);
    expect(summary.counts.direct).toBe(0);
  });

  it('explains a finding: the binding, and the broader concept implied', async () => {
    const result = await meaning.findingMeaning(findings.ges);
    const keys = result.meanings.map((m) => `${m.term.key}:${m.method}`);
    expect(keys).toEqual(expect.arrayContaining(['gmbh:BINDING', 'kapitalgesellschaft:BROADER']));
    const unmatched = await meaning.findingMeaning(findings.eu);
    expect(unmatched.meanings).toEqual([]);
  });

  it('previews a lookup binding: the value table with unmatched values', async () => {
    const preview = await bindings.preview({
      mode: 'OUTPUT_LOOKUP',
      output: { detectorType: 'CUSTOM', customDetectorKey: 'legal_form', findingType: 'tag:legal_form' },
      lookup: { schemeKey: 'rechtsformen', match: 'CODES' },
    });
    expect(preview.counts.findings).toBe(2);
    expect(preview.lookup?.matched.map((m) => m.value).sort()).toEqual(['AG', 'GES']);
    expect(preview.lookup?.unmatched.map((m) => m.value)).toEqual(['EU']);
  });

  it('marks links GONE when a binding is disabled and revives them, keeping firstLinkedAt', async () => {
    const binding = await prisma.glossaryBinding.findFirstOrThrow({
      where: { packKey: 'dach-company-law', status: 'APPROVED' },
    });
    const before = await prisma.assetTerm.findFirstOrThrow({ where: { assetId: ids.a1 } });
    await bindings.disable(binding.id);
    await scheduler.scheduleBackfill({ bindingIds: [binding.id] });
    await linker.drain();
    const gone = await prisma.assetTerm.findFirstOrThrow({ where: { assetId: ids.a1 } });
    expect(gone.goneAt).not.toBeNull();
    expect(gone.supportCount).toBe(0);

    await bindings.enable(binding.id);
    await scheduler.scheduleBackfill({ bindingIds: [binding.id] });
    await linker.drain();
    const revived = await prisma.assetTerm.findFirstOrThrow({ where: { assetId: ids.a1 } });
    expect(revived.goneAt).toBeNull();
    expect(revived.firstLinkedAt.getTime()).toBe(before.firstLinkedAt.getTime());
  });

  it('adds MANUAL and DECLARED links, and stitches a declaration made before its term existed', async () => {
    const stammkapital = await glossary.resolveOrThrow('stammkapital');
    await meaning.link({ termId: stammkapital.id, target: { type: 'finding', id: findings.ges } });
    const euid = await glossary.resolveOrThrow('euid');
    await prisma.edge.create({
      data: { fromType: 'asset', fromId: ids.a2, toType: 'term', toId: euid.id, relationType: 'MEANS', origin: 'SOURCE_DERIVED' as never },
    });
    // A declaration to a key nobody has defined yet.
    await prisma.edge.create({
      data: { fromType: 'asset', fromId: ids.a3, toType: 'term_ref', toId: 'term://glossary/einzelunternehmen', relationType: 'MEANS', origin: 'SOURCE_DERIVED' as never },
    });
    expect((await unknownTermRefs(prisma as never)).map((r) => r.key)).toEqual(['einzelunternehmen']);
    await glossary.upsert({ term: 'Einzelunternehmen', key: 'einzelunternehmen', origin: 'OPERATOR' });
    const stitched = await stitchTermRefs(prisma as never, ['einzelunternehmen']);
    expect(stitched.assetIds).toEqual([ids.a3]);

    await linker.relinkAssets([ids.a1, ids.a2, ids.a3]);
    const rows = await prisma.assetTerm.findMany({ where: { goneAt: null }, include: { term: true } });
    const view = rows.map((r) => `${r.term.key}:${r.method}`).sort();
    expect(view).toEqual(
      expect.arrayContaining(['stammkapital:MANUAL', 'euid:DECLARED', 'einzelunternehmen:DECLARED']),
    );
  });

  it('keeps DRAFT terms inert (rule SL-5)', async () => {
    const draft = await glossary.upsert({ term: 'Scheinfirma', kind: 'CONCEPT', origin: 'AGENT' });
    await meaning.link({ termId: draft.id, target: { type: 'asset', id: ids.a2 } });
    await linker.relinkAssets([ids.a2]);
    expect(await prisma.assetTerm.count({ where: { termId: draft.id } })).toBe(0);
  });

  it('suggests a binding for unbound vocabulary and accepting it links the findings', async () => {
    await glossary.upsert({ term: 'Force majeure', kind: 'CONCEPT', origin: 'OPERATOR' });
    await vocabulary.refreshSource(ids.source);
    const unbound = await vocabulary.list({ kind: 'outputs', bound: 'false' });
    expect(unbound.rows.map((r) => r.output?.findingType)).toEqual(
      expect.arrayContaining(['force_majeure', 'IBAN_CODE']),
    );
    await suggestions.runAll({ generators: ['binding'] });
    const queue = await proposals.list({ kind: 'BINDING' });
    const item = queue.items.find((i) => i.title.startsWith('force_majeure'));
    expect(item?.score).toBeGreaterThanOrEqual(0.9);
    await proposals.decide({ kind: 'BINDING', id: item!.id, decision: 'accept', actor: { name: 'tester' } });
    await linker.relinkAssets([ids.a2]);
    const fm = await glossary.resolveOrThrow('force-majeure');
    expect(await prisma.assetTerm.count({ where: { termId: fm.id, goneAt: null } })).toBe(1);

    // Accepted: never proposed again.
    await suggestions.runAll({ generators: ['binding'] });
    const again = await prisma.semanticSuggestion.count({ where: { generator: 'binding', status: 'PROPOSED', termId: fm.id } });
    expect(again).toBe(0);
  });

  it('refuses agent decisions on documents, terms and aliases (D7)', async () => {
    await expect(
      proposals.decide({ kind: 'TERM', id: 'draft:x', decision: 'accept', actor: { name: 'agent:CASE', isAgent: true } }),
    ).rejects.toThrow(/operator decisions/);
  });

  it('installs the GDPR pack: PII outputs gain meaning, coverage is recorded', async () => {
    await packs.install({ key: 'gdpr-personal-data', dryRun: false });
    await scheduler.scheduleBackfill({ all: true });
    await linker.drain();
    const iban = await glossary.resolveOrThrow('bank-account-iban');
    expect(await prisma.assetTerm.count({ where: { termId: iban.id, goneAt: null } })).toBe(1);
    const stat = await prisma.semanticStat.findFirst();
    expect(stat?.openFindings).toBe(5);
    // GES, AG, IBAN and force_majeure carry meaning; EU does not resolve.
    expect(stat?.findingsWithMeaning).toBe(4);
  });

  it('builds the semantic map with taxonomy roll-up and a case overlay', async () => {
    await map.rebuild();
    const result = await map.map({ minAssets: 1 });
    const kap = result.nodes.find((n) => n.key === 'kapitalgesellschaft');
    expect(kap?.totalAssetCount).toBe(2);
    expect(kap?.directAssetCount).toBe(0);
    expect(result.nodes.find((n) => n.key === 'gesellschaft')).toBeTruthy();
    expect(result.links.some((l) => l.kind === 'BROADER')).toBe(true);
  });

  it('computes the board Meaning layer for a case', async () => {
    const caseRow = await prisma.case.create({ data: { title: 'Counterparty' } });
    const evidence = await prisma.caseEvidence.create({
      data: { caseId: caseRow.id, entityType: 'asset', entityId: ids.a1 },
    });
    const board = await prisma.caseBoard.create({ data: { caseId: caseRow.id } });
    const item = await prisma.caseBoardItem.create({
      data: { id: randomUUID(), boardId: board.id, kind: 'EVIDENCE', refId: evidence.id },
    });
    const semantic = await layer.compute(caseRow.id, [{ id: item.id, kind: 'EVIDENCE', refId: evidence.id }]);
    const keys = semantic.terms.map((t) => t.key);
    expect(keys).toEqual(expect.arrayContaining(['gmbh', 'bank-account-iban', 'stammkapital']));
    expect(semantic.broader.some((b) => b.parent.key === 'kapitalgesellschaft')).toBe(true);
    const trace = await layer.meaningTrace([ids.a1], 10);
    expect(trace.edges.every((e) => String(e.id).startsWith('sl:'))).toBe(true);
  });

  it('round-trips SKOS: export, then a dry-run import skips every term', async () => {
    const file = await transfer.exportFile({ format: 'skos' });
    const report = await transfer.importFile('skos', file.body, { dryRun: true, conflict: 'skip' });
    expect(report.counts.create).toBe(0);
    expect(report.counts.skip).toBeGreaterThan(30);
    const csv = await transfer.exportFile({ format: 'csv' });
    const csvReport = await transfer.importFile('csv', csv.body, { dryRun: true, conflict: 'skip' });
    expect(csvReport.counts.create).toBe(0);
  });
});
