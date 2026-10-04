import { z } from 'zod';
import type { GlossaryService } from '../glossary/glossary.service';
import type { GlossaryRelationsService } from '../glossary/glossary-relations.service';
import type { GlossaryImportExportService } from '../glossary/glossary-import-export.service';
import type { BindingsService } from './bindings/bindings.service';
import type { BindingSpec } from './bindings/binding-spec';
import type { VocabularyService } from './vocabulary/vocabulary.service';
import type { MeaningService } from './links/meaning.service';
import type { GlossaryPacksService } from './packs/glossary-packs.service';
import type { FindInTextService } from './find-in-text/find-in-text.service';
import type { GlossaryProposalsService } from './suggestions/glossary-proposals.service';
import type { SemanticSuggestionsService } from './suggestions/semantic-suggestions.service';
import type { SemanticMapService } from './map/semantic-map.service';

/** The MCP tools of the `glossary` group (SL1 R14, SL2 §12, SL3 R8, SL4 §11, SL5). */
export const SEMANTIC_MCP_TOOL_NAMES = [
  'list_glossary_terms',
  'lookup_glossary',
  'get_glossary_term',
  'upsert_glossary_term',
  'deprecate_glossary_term',
  'list_glossary_schemes',
  'upsert_glossary_scheme',
  'list_glossary_relations',
  'relate_glossary_terms',
  'remove_glossary_relation',
  'export_glossary',
  'import_glossary',
  'list_vocabulary',
  'list_bindings',
  'preview_binding',
  'create_binding',
  'approve_binding',
  'disable_binding',
  'find_term_in_text',
  'install_glossary_pack',
  'get_finding_meaning',
  'get_asset_meaning',
  'get_term_evidence',
  'get_term_summary',
  'link_term',
  'unlink_term',
  'list_glossary_proposals',
  'decide_glossary_proposal',
  'refresh_glossary_suggestions',
  'glossary_suggestion_stats',
  'get_semantic_map',
] as const;

export interface SemanticMcpDeps {
  glossary: GlossaryService;
  relations: GlossaryRelationsService;
  transfer: GlossaryImportExportService;
  bindings: BindingsService;
  vocabulary: VocabularyService;
  meaning: MeaningService;
  packs: GlossaryPacksService;
  findInText: FindInTextService;
  proposals: GlossaryProposalsService;
  suggestions: SemanticSuggestionsService;
  map: SemanticMapService;
}

export interface SemanticMcpHelpers {
  json: (payload: unknown) => unknown;
  /** Every write calls this first. */
  assertNotDemoMode: () => void;
}

/** The slice of the MCP server these registrations use. */
export interface SemanticMcpServer {
  registerTool(
    name: string,
    config: {
      title?: string;
      description?: string;
      inputSchema?: z.ZodTypeAny;
      annotations?: {
        readOnlyHint?: boolean;
        destructiveHint?: boolean;
        idempotentHint?: boolean;
      };
    },
    cb: (args: never, extra: unknown) => unknown,
  ): unknown;
}

const READ = { readOnlyHint: true, idempotentHint: true } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false } as const;
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true } as const;

const entityTypeEnum = z.enum([
  'PERSON',
  'ORGANIZATION',
  'LOCATION',
  'REFERENCE',
  'TERM',
  'OTHER',
]);
const kindEnum = z.enum(['CONCEPT', 'ENTITY']);
const statusEnum = z.enum(['DRAFT', 'APPROVED', 'DEPRECATED']);
const relationTypeEnum = z.enum([
  'BROADER',
  'RELATED',
  'PART_OF',
  'INSTANCE_OF',
  'CUSTOM',
]);
const termRef = z
  .string()
  .min(1)
  .max(200)
  .describe('Term id or key (previous keys redirect).');

/** C9, strict: an unknown key is refused, never stripped. */
const bindingSpec = z
  .strictObject({
    mode: z.enum([
      'OUTPUT',
      'OUTPUT_VALUES',
      'OUTPUT_LOOKUP',
      'METADATA_VALUES',
      'METADATA_LOOKUP',
    ]),
    output: z
      .strictObject({
        detectorType: z.string(),
        customDetectorKey: z.string().nullable().optional(),
        findingType: z.string(),
      })
      .nullable()
      .optional(),
    field: z.string().nullable().optional(),
    values: z.array(z.string()).max(1000).optional(),
    splitDelimiter: z.string().max(10).nullable().optional(),
    lookup: z
      .strictObject({
        schemeId: z.string().optional(),
        schemeKey: z.string().optional(),
        match: z.enum(['CODES', 'ANY']),
      })
      .nullable()
      .optional(),
    termKey: z.string().nullable().optional(),
    termId: z.string().nullable().optional(),
    noMeaning: z.boolean().optional(),
    sourceIds: z.array(z.string()).max(200).optional(),
    confidence: z.number().min(0).max(1).optional(),
  })
  .describe(
    'Binding spec (C9): what a detector output (OUTPUT*) or asset metadata field (METADATA_*) means. Never regex.',
  );

const schemas = {
  list_glossary_terms: z.strictObject({
    query: z.string().optional(),
    entityType: entityTypeEnum.optional(),
    kind: kindEnum.optional(),
    schemeKey: z.string().optional(),
    status: z.array(statusEnum).optional(),
    steward: z.string().optional(),
    take: z.number().int().min(1).max(200).optional(),
    skip: z.number().int().min(0).optional(),
  }),
  lookup_glossary: z.strictObject({
    query: z.string().min(1).max(200),
    limit: z.number().int().min(1).max(50).optional(),
    kind: kindEnum.optional(),
    schemeKey: z.string().optional(),
    status: z.array(statusEnum).optional(),
    includeDeprecated: z.boolean().optional(),
  }),
  get_glossary_term: z.strictObject({ term: termRef }),
  upsert_glossary_term: z.strictObject({
    id: z.string().optional(),
    term: z.string().min(1).max(200),
    kind: kindEnum.optional(),
    key: z.string().optional(),
    aliases: z.array(z.string()).max(50).optional(),
    codes: z.array(z.string()).max(50).optional(),
    hiddenAliases: z.array(z.string()).max(50).optional(),
    definition: z.string().max(4000).optional(),
    schemeKey: z.string().optional(),
    entityType: entityTypeEnum.optional(),
    steward: z.string().optional(),
    notes: z.string().optional(),
    createNew: z.boolean().optional(),
  }),
  deprecate_glossary_term: z.strictObject({
    term: termRef,
    replacedBy: termRef.optional(),
  }),
  list_glossary_schemes: z.strictObject({}),
  upsert_glossary_scheme: z.strictObject({
    id: z.string().optional(),
    key: z.string().optional(),
    name: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    color: z.string().max(20).optional(),
  }),
  list_glossary_relations: z.strictObject({
    term: termRef.optional(),
    type: relationTypeEnum.optional(),
    status: statusEnum.optional(),
    take: z.number().int().min(1).max(200).optional(),
  }),
  relate_glossary_terms: z.strictObject({
    from: termRef,
    to: termRef,
    type: relationTypeEnum,
    label: z.string().max(100).optional(),
    note: z.string().max(2000).optional(),
  }),
  remove_glossary_relation: z.strictObject({ relationId: z.string() }),
  export_glossary: z.strictObject({
    format: z.enum(['csv', 'skos']),
    schemeKey: z.string().optional(),
    kinds: z.array(kindEnum).optional(),
  }),
  import_glossary: z.strictObject({
    format: z.enum(['csv', 'skos']),
    content: z.string().min(1).max(5_000_000),
    dryRun: z.boolean().optional(),
    conflict: z.enum(['skip', 'overwrite', 'merge-labels']).optional(),
    asDraft: z.boolean().optional(),
    schemeKey: z.string().optional(),
    language: z.string().max(10).optional(),
  }),
  list_vocabulary: z.strictObject({
    kind: z.enum(['outputs', 'fields', 'all']).optional(),
    bound: z.enum(['true', 'false', 'any']).optional(),
    sourceId: z.string().optional(),
    q: z.string().optional(),
    take: z.number().int().min(1).max(200).optional(),
    skip: z.number().int().min(0).optional(),
  }),
  list_bindings: z.strictObject({
    term: termRef.optional(),
    status: z.enum(['DRAFT', 'APPROVED', 'DISABLED']).optional(),
    detectorType: z.string().optional(),
    customDetectorKey: z.string().optional(),
    findingType: z.string().optional(),
    take: z.number().int().min(1).max(200).optional(),
    skip: z.number().int().min(0).optional(),
  }),
  preview_binding: z.strictObject({ spec: bindingSpec }),
  create_binding: z.strictObject({
    spec: bindingSpec,
    status: z.enum(['DRAFT', 'APPROVED']).optional(),
    note: z.string().max(2000).optional(),
  }),
  approve_binding: z.strictObject({ bindingId: z.string() }),
  disable_binding: z.strictObject({ bindingId: z.string() }),
  find_term_in_text: z.strictObject({
    term: termRef,
    create: z
      .boolean()
      .optional()
      .describe('false (default) previews; true creates the detector.'),
    wholeWords: z.boolean().optional(),
    continuations: z.boolean().optional(),
    severity: z.enum(['info', 'low', 'medium', 'high', 'critical']).optional(),
    sourceIds: z.array(z.string()).optional(),
  }),
  install_glossary_pack: z.strictObject({
    key: z.string().optional(),
    pack: z.record(z.string(), z.unknown()).optional(),
    dryRun: z.boolean().optional(),
    resolutions: z.record(z.string(), z.enum(['skip', 'overwrite'])).optional(),
  }),
  get_finding_meaning: z.strictObject({ findingId: z.string() }),
  get_asset_meaning: z.strictObject({
    assetId: z.string(),
    includeHistory: z.boolean().optional(),
  }),
  get_term_evidence: z.strictObject({
    term: termRef,
    includeNarrower: z.boolean().optional(),
    sourceId: z.string().optional(),
    method: z
      .enum(['BINDING', 'DECLARED', 'MANUAL', 'SUGGESTED', 'MENTION'])
      .optional(),
    status: z.enum(['current', 'gone', 'all']).optional(),
    page: z.number().int().min(0).optional(),
  }),
  get_term_summary: z.strictObject({
    term: termRef,
    includeNarrower: z.boolean().optional(),
  }),
  link_term: z.strictObject({
    term: termRef,
    targetType: z.enum(['asset', 'finding', 'case']),
    targetId: z.string(),
    note: z.string().max(2000).optional(),
  }),
  unlink_term: z.strictObject({ referenceId: z.string() }),
  list_glossary_proposals: z.strictObject({
    kind: z
      .enum(['TERM', 'ALIAS', 'RELATION', 'BINDING', 'LINK', 'TERM_REF'])
      .optional(),
    minScore: z.number().min(0).max(1).optional(),
    take: z.number().int().min(1).max(200).optional(),
    skip: z.number().int().min(0).optional(),
  }),
  decide_glossary_proposal: z.strictObject({
    kind: z.enum(['TERM', 'ALIAS', 'RELATION', 'BINDING', 'LINK', 'TERM_REF']),
    id: z.string(),
    decision: z.enum(['accept', 'edit', 'dismiss', 'dismiss_forever', 'skip']),
    edit: z.record(z.string(), z.unknown()).optional(),
    reason: z.string().max(500).optional(),
  }),
  refresh_glossary_suggestions: z.strictObject({
    generators: z
      .array(z.enum(['binding', 'link', 'relation']))
      .optional()
      .describe('Default: all enabled generators.'),
  }),
  glossary_suggestion_stats: z.strictObject({
    days: z.number().int().min(1).max(365).optional(),
  }),
  get_semantic_map: z.strictObject({
    limit: z.number().int().min(1).max(100).optional(),
  }),
} satisfies Record<(typeof SEMANTIC_MCP_TOOL_NAMES)[number], z.ZodTypeAny>;

type Args<K extends keyof typeof schemas> = z.infer<(typeof schemas)[K]>;

const MCP_ACTOR = 'mcp';

/** Register the glossary group's tools. MCP writes are operator-level. */
export function registerSemanticMcpTools(
  server: SemanticMcpServer,
  deps: SemanticMcpDeps,
  helpers: SemanticMcpHelpers,
): void {
  const { json, assertNotDemoMode } = helpers;
  const tool = <K extends keyof typeof schemas>(
    name: K,
    title: string,
    description: string,
    annotations: typeof READ | typeof WRITE | typeof DESTRUCTIVE,
    run: (args: Args<K>) => Promise<unknown>,
  ) => {
    const write = annotations !== READ;
    server.registerTool(
      name,
      { title, description, inputSchema: schemas[name], annotations },
      async (args: Args<K>) => {
        if (write) assertNotDemoMode();
        return json(await run(args));
      },
    );
  };
  const termId = async (ref: string) =>
    (await deps.glossary.resolveOrThrow(ref)).id;

  // ── Terms, schemes, relations (SL1) ────────────────────────────────────

  tool(
    'list_glossary_terms',
    'List Glossary Terms',
    'List the shared glossary: concepts (kinds of things) and entities (particular things), with keys, schemes, aliases, codes and status. Filter by kind, scheme, status or steward.',
    READ,
    (args) =>
      deps.glossary.list({
        query: args.query,
        entityType: args.entityType,
        kind: args.kind,
        schemeKey: args.schemeKey,
        status: args.status,
        steward: args.steward,
        take: args.take,
        skip: args.skip,
      }),
  );
  tool(
    'lookup_glossary',
    'Lookup Glossary',
    'Resolve a name, alias, code or concept against the glossary (exact, code, alias, prefix and semantic matching); each hit says what it matched on. Use before treating two spellings as separate entities.',
    READ,
    (args) =>
      deps.glossary.lookup(args.query, args.limit ?? 10, {
        kind: args.kind,
        schemeKey: args.schemeKey,
        status: args.status,
        includeDeprecated: args.includeDeprecated,
      }),
  );
  tool(
    'get_glossary_term',
    'Get Glossary Term',
    'One term by id or key: definition, scheme, labels, relations, broader chain and narrower concepts.',
    READ,
    (args) => deps.glossary.getTerm(args.term),
  );
  tool(
    'upsert_glossary_term',
    'Upsert Glossary Term',
    'Create or update a glossary term. kind CONCEPT for kinds of things (GmbH, IBAN), ENTITY for particular things (ACME Holding GmbH). codes are exact notations; single letters go to hiddenAliases. Terms written through MCP are operator-curated and APPROVED.',
    WRITE,
    (args) =>
      deps.glossary.upsert({
        id: args.id,
        term: args.term,
        kind: args.kind,
        key: args.key,
        aliases: args.aliases,
        codes: args.codes,
        hiddenAliases: args.hiddenAliases,
        definition: args.definition,
        schemeKey: args.schemeKey,
        entityType: args.entityType,
        steward: args.steward,
        notes: args.notes,
        createNew: args.createNew,
        origin: 'OPERATOR',
        author: MCP_ACTOR,
      }),
  );
  tool(
    'deprecate_glossary_term',
    'Deprecate Glossary Term',
    'Deprecate a term, optionally naming the term that replaces it. Its bindings stop producing links; history is kept.',
    WRITE,
    async (args) =>
      deps.glossary.deprecate(
        args.term,
        args.replacedBy ? await termId(args.replacedBy) : null,
        MCP_ACTOR,
      ),
  );
  tool(
    'list_glossary_schemes',
    'List Glossary Schemes',
    'Schemes are controlled vocabularies (Rechtsformen, GDPR categories), with term counts.',
    READ,
    () => deps.glossary.listSchemes(),
  );
  tool(
    'upsert_glossary_scheme',
    'Upsert Glossary Scheme',
    'Create or rename a scheme. The key is generated from the name when omitted.',
    WRITE,
    (args) =>
      deps.glossary.upsertScheme({
        id: args.id,
        key: args.key,
        name: args.name,
        description: args.description,
        color: args.color,
        actor: MCP_ACTOR,
      }),
  );
  tool(
    'list_glossary_relations',
    'List Glossary Relations',
    'Relations between terms (BROADER, RELATED, PART_OF, INSTANCE_OF, CUSTOM), optionally for one term.',
    READ,
    async (args) =>
      deps.relations.list({
        termId: args.term ? await termId(args.term) : undefined,
        type: args.type,
        status: args.status,
        take: args.take,
      }),
  );
  tool(
    'relate_glossary_terms',
    'Relate Glossary Terms',
    'Relate two terms. BROADER only when the first concept is a kind of the second; INSTANCE_OF from an entity to its concept; CUSTOM needs a label. Cycles are refused with the path.',
    WRITE,
    async (args) =>
      deps.relations.create({
        fromTermId: await termId(args.from),
        toTermId: await termId(args.to),
        type: args.type,
        label: args.label,
        note: args.note ?? null,
        origin: 'OPERATOR',
        actor: MCP_ACTOR,
      }),
  );
  tool(
    'remove_glossary_relation',
    'Remove Glossary Relation',
    'Remove one relation.',
    DESTRUCTIVE,
    (args) => deps.relations.remove(args.relationId, MCP_ACTOR),
  );
  tool(
    'export_glossary',
    'Export Glossary',
    'Export the glossary as CSV or SKOS (JSON-LD), optionally one scheme.',
    READ,
    async (args) => {
      const scheme = args.schemeKey
        ? await deps.glossary.getScheme(args.schemeKey)
        : null;
      return deps.transfer.exportFile({
        format: args.format,
        schemeId: scheme?.id,
        kinds: args.kinds,
      });
    },
  );
  tool(
    'import_glossary',
    'Import Glossary',
    'Import CSV or SKOS. Defaults to a dry run that reports what would be created, updated and skipped; pass dryRun: false to write.',
    WRITE,
    (args) =>
      deps.transfer.importFile(args.format, args.content, {
        dryRun: args.dryRun ?? true,
        conflict: args.conflict ?? 'skip',
        asDraft: args.asDraft,
        schemeKey: args.schemeKey,
        language: args.language,
        actor: MCP_ACTOR,
      }),
  );

  // ── Vocabulary and bindings (SL2) ──────────────────────────────────────

  tool(
    'list_vocabulary',
    'List Vocabulary',
    'The detector outputs and metadata fields the data produces, with counts, whether each has a meaning (binding), and suggestions. bound=false lists what has no meaning yet.',
    READ,
    (args) => deps.vocabulary.list(args),
  );
  tool(
    'list_bindings',
    'List Bindings',
    'Bindings: what detector outputs and metadata fields mean, with status and the term or scheme they point to.',
    READ,
    async (args) =>
      deps.bindings.list({
        termId: args.term ? await termId(args.term) : undefined,
        status: args.status,
        detectorType: args.detectorType,
        customDetectorKey: args.customDetectorKey,
        findingType: args.findingType,
        take: args.take,
        skip: args.skip,
      }),
  );
  tool(
    'preview_binding',
    'Preview Binding',
    'What a binding would do before it exists: open findings, assets and sources it gives meaning, samples, the lookup table with unmatched values, and warnings.',
    READ,
    (args) => deps.bindings.preview(args.spec as BindingSpec),
  );
  tool(
    'create_binding',
    'Create Binding',
    'Create a binding (APPROVED by default; DRAFT to leave it for review). Links follow without a re-scan.',
    WRITE,
    (args) =>
      deps.bindings.create(args.spec as BindingSpec, {
        origin: 'OPERATOR',
        status: args.status ?? 'APPROVED',
        actor: MCP_ACTOR,
        note: args.note ?? null,
      }),
  );
  tool(
    'approve_binding',
    'Approve Binding',
    'Approve a DRAFT binding.',
    WRITE,
    (args) => deps.bindings.approve(args.bindingId, MCP_ACTOR),
  );
  tool(
    'disable_binding',
    'Disable Binding',
    'Disable an APPROVED binding; its links become GONE (history kept).',
    DESTRUCTIVE,
    (args) => deps.bindings.disable(args.bindingId, MCP_ACTOR),
  );
  tool(
    'find_term_in_text',
    'Find Term In Text',
    'Turn a concept that appears only as words into a tested REGEX detector bound to it. Previews by default; create: true creates the detector.',
    WRITE,
    async (args) => {
      const input = {
        wholeWords: args.wholeWords,
        continuations: args.continuations,
        severity: args.severity,
        sourceIds: args.sourceIds,
        actor: MCP_ACTOR,
      };
      return args.create
        ? deps.findInText.create(args.term, input)
        : deps.findInText.preview(args.term, input);
    },
  );
  tool(
    'install_glossary_pack',
    'Install Glossary Pack',
    'Install a glossary pack (a starter pack by key, or a pack JSON): schemes, concepts, relations and bindings. Defaults to a dry run.',
    WRITE,
    (args) =>
      deps.packs.install({
        key: args.key,
        pack: args.pack,
        dryRun: args.dryRun ?? true,
        resolutions: args.resolutions,
        actor: MCP_ACTOR,
      }),
  );

  // ── Meaning (SL3) ──────────────────────────────────────────────────────

  tool(
    'get_finding_meaning',
    'Get Finding Meaning',
    'What a finding means: the concepts it is evidence of, through which binding or manual link, and the broader concepts implied.',
    READ,
    (args) => deps.meaning.findingMeaning(args.findingId),
  );
  tool(
    'get_asset_meaning',
    'Get Asset Meaning',
    "An asset's concepts with method (binding, declared, manual, suggested), support and confidence.",
    READ,
    (args) => deps.meaning.assetMeaning(args.assetId, args.includeHistory),
  );
  tool(
    'get_term_evidence',
    'Get Term Evidence',
    'Assets that are evidence of a concept, sorted by severity then support. includeNarrower rolls up the taxonomy.',
    READ,
    async (args) =>
      deps.meaning.termEvidence(await termId(args.term), {
        includeNarrower: args.includeNarrower,
        sourceId: args.sourceId,
        method: args.method,
        status: args.status,
        page: args.page,
      }),
  );
  tool(
    'get_term_summary',
    'Get Term Summary',
    "A concept's evidence counts by method, source and severity, with a weekly trend.",
    READ,
    async (args) =>
      deps.meaning.termSummary(await termId(args.term), args.includeNarrower),
  );
  tool(
    'link_term',
    'Link Term',
    'Say by hand that an asset, finding or case is about a term (a MANUAL link).',
    WRITE,
    async (args) =>
      deps.meaning.link({
        termId: await termId(args.term),
        target: { type: args.targetType, id: args.targetId },
        note: args.note ?? null,
        actor: MCP_ACTOR,
      }),
  );
  tool(
    'unlink_term',
    'Unlink Term',
    'Remove a manual link.',
    DESTRUCTIVE,
    (args) => deps.meaning.unlink(args.referenceId, MCP_ACTOR),
  );

  // ── Review (SL4) ───────────────────────────────────────────────────────

  tool(
    'list_glossary_proposals',
    'List Glossary Proposals',
    'The review queue: term, alias, relation, binding, document-link and term-reference proposals, one list, highest score first.',
    READ,
    (args) =>
      deps.proposals.list({
        kind: args.kind,
        minScore: args.minScore,
        take: args.take,
        skip: args.skip,
      }),
  );
  tool(
    'decide_glossary_proposal',
    'Decide Glossary Proposal',
    'Accept, edit and accept, dismiss, dismiss forever, or skip one proposal. Operator level: every kind.',
    WRITE,
    (args) =>
      deps.proposals.decide({
        kind: args.kind,
        id: args.id,
        decision: args.decision,
        edit: args.edit,
        reason: args.reason,
        actor: { name: MCP_ACTOR },
      }),
  );
  tool(
    'refresh_glossary_suggestions',
    'Refresh Glossary Suggestions',
    'Run the suggestion generators now (bindings for unbound vocabulary, document links, relations).',
    WRITE,
    (args) => deps.suggestions.runAll({ generators: args.generators }),
  );
  tool(
    'glossary_suggestion_stats',
    'Glossary Suggestion Stats',
    'Acceptance rates per generator and score band, so thresholds can be tuned.',
    READ,
    (args) => deps.suggestions.stats(args.days ?? 90),
  );

  // ── Map (SL5) ──────────────────────────────────────────────────────────

  tool(
    'get_semantic_map',
    'Get Semantic Map',
    'A compact summary of the ontology: the top concepts by evidence, their relations, and how much vocabulary is still unbound.',
    READ,
    (args) => deps.map.summary(args.limit ?? 30),
  );
}
