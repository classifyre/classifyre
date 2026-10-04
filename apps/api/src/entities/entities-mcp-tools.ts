import { z } from 'zod';
import type { EntitiesService } from './entities.service';
import type { EntityCandidatesService } from './entity-candidates.service';
import type { EntityMentionsService } from './entity-mentions.service';
import type { EntitySwitchService } from './entity-switch.service';
import type { EntityValuesService } from './entity-values.service';

/** The MCP tools of the `entities` group (G5 R21). */
export const ENTITY_MCP_TOOL_NAMES = [
  'search_entities',
  'get_entity',
  'get_entity_mentions',
  'get_co_mentioned_entities',
  'create_entity',
  'update_entity',
  'list_entity_candidates',
  'review_entity_candidates',
  'merge_entities',
] as const;

export interface EntityMcpDeps {
  entities: EntitiesService;
  values: EntityValuesService;
  mentions: EntityMentionsService;
  candidates: EntityCandidatesService;
  switchService: EntitySwitchService;
}

export interface EntityMcpHelpers {
  json: (payload: unknown) => unknown;
  /** Every write calls this first. */
  assertNotDemoMode: () => void;
}

/** The slice of the MCP server these registrations use. */
export interface EntityMcpServer {
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

const entityRef = z
  .string()
  .min(1)
  .max(200)
  .describe('Entity id or glossary key (previous keys redirect).');
const entityTypeEnum = z.enum([
  'PERSON',
  'ORGANIZATION',
  'LOCATION',
  'REFERENCE',
  'OTHER',
]);
const labelledValue = z.strictObject({
  label: z
    .string()
    .min(1)
    .max(100)
    .describe(
      'The finding label the value is detected under (e.g. iban_code, email_address, a custom detector label). It is what links findings to the entity.',
    ),
  value: z.string().min(1).max(512),
});

/** Strict objects: an unknown key is refused, never stripped (rule 4). */
const schemas = {
  search_entities: z.strictObject({
    query: z
      .string()
      .max(200)
      .optional()
      .describe('Matches names, aliases, keys and identifier values.'),
    entityType: entityTypeEnum.optional(),
    status: z.array(z.enum(['DRAFT', 'APPROVED', 'DEPRECATED'])).optional(),
    sort: z.enum(['mentions', 'name', 'lastSeen']).optional(),
    take: z.number().int().min(1).max(200).optional(),
    skip: z.number().int().min(0).optional(),
  }),
  get_entity: z.strictObject({ entity: entityRef }),
  get_entity_mentions: z.strictObject({
    entity: entityRef,
    sourceId: z.string().optional(),
    limit: z.number().int().min(1).max(200).optional(),
    after: z
      .string()
      .optional()
      .describe('The `next` cursor of the previous page.'),
  }),
  get_co_mentioned_entities: z.strictObject({
    entity: entityRef,
    limit: z.number().int().min(1).max(100).optional(),
  }),
  create_entity: z.strictObject({
    name: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe(
        'Required unless the promoted value is itself a name (a person or organisation finding).',
      ),
    entityType: entityTypeEnum.optional(),
    aliases: z.array(z.string().max(200)).max(50).optional(),
    identifiers: z.array(labelledValue).max(50).optional(),
    definition: z.string().max(4000).optional(),
    notes: z.string().max(4000).optional(),
    findingId: z
      .string()
      .optional()
      .describe(
        "Promote this finding's value: it becomes the entity's first alias (a name) or identifier.",
      ),
    value: labelledValue
      .optional()
      .describe('Or promote a value from get_value_occurrences.'),
    createNew: z
      .boolean()
      .optional()
      .describe('Create a second entity even if one has this name.'),
  }),
  update_entity: z.strictObject({
    entity: entityRef,
    addIdentifiers: z.array(labelledValue).max(50).optional(),
    removeValueIds: z.array(z.string()).max(50).optional(),
    anchorUrn: z
      .string()
      .max(1000)
      .nullable()
      .optional()
      .describe('URN of the record that is this entity; null clears it.'),
    attributes: z.record(z.string(), z.unknown()).nullable().optional(),
  }),
  list_entity_candidates: z.strictObject({
    entity: entityRef.optional(),
    kind: z
      .enum(['mention', 'conflict'])
      .optional()
      .describe(
        'mention: a spelling variant to confirm. conflict: an identifier two entities claim.',
      ),
    minScore: z.number().min(0).max(1).optional(),
    take: z.number().int().min(1).max(200).optional(),
    skip: z.number().int().min(0).optional(),
  }),
  review_entity_candidates: z.strictObject({
    decisions: z
      .array(
        z.strictObject({
          id: z.string(),
          decision: z
            .enum(['accept', 'reject', 'move'])
            .describe(
              'accept: the value refers to the entity. reject: it does not (remembered, never proposed again). move: for a conflict, take the identifier from the entity that holds it.',
            ),
        }),
      )
      .min(1)
      .max(500),
  }),
  merge_entities: z.strictObject({
    from: entityRef.describe('The entity that goes away (it will redirect).'),
    into: entityRef.describe('The entity that stays; it must be APPROVED.'),
  }),
} as const;

type Args<K extends keyof typeof schemas> = z.infer<(typeof schemas)[K]>;

/** MCP writes are operator-level, as everywhere else in the glossary group. */
const MCP_ACTOR = { name: 'mcp' } as const;

export function registerEntityMcpTools(
  server: EntityMcpServer,
  deps: EntityMcpDeps,
  helpers: EntityMcpHelpers,
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
  const entityId = async (ref: string) =>
    (await deps.entities.resolveEntity(ref)).id;

  tool(
    'search_entities',
    'Search Entities',
    'Find entities — the named things findings refer to (a person, an organisation, an account) — by name, alias, key or identifier value, with their mention counters. An entity is an ENTITY-kind glossary term, so its key works wherever a term key does (the `term` finding filter, watches, Ref.term).',
    READ,
    (args) => deps.entities.search(args),
  );
  tool(
    'get_entity',
    'Get Entity',
    'One entity: its names and identifiers (confirmed values), live mention counters, the record it is anchored to, pending candidates, and which names it shares with other entities (ambiguous, not wrong). Mentions link — and count as meaning — only while the entity is APPROVED.',
    READ,
    (args) => deps.entities.get(args.entity),
  );
  tool(
    'get_entity_mentions',
    'Get Entity Mentions',
    "Where an entity is mentioned, across every source: asset, source, finding, the value that matched and a snippet. Derived by joining the entity's confirmed values with the value index, so a value confirmed today lists documents scanned long ago. Keyset-paged: pass `next` back as `after`.",
    READ,
    async (args) =>
      deps.mentions.mentions(await entityId(args.entity), {
        after: args.after,
        limit: args.limit,
        sourceId: args.sourceId,
      }),
  );
  tool(
    'get_co_mentioned_entities',
    'Get Co-mentioned Entities',
    'The entities that appear in the same assets as this one, most shared first: who appears with whom. Computed on demand over the latest mention assets; nothing is stored as graph edges.',
    READ,
    async (args) =>
      deps.mentions.coMentions(await entityId(args.entity), args.limit ?? 20),
  );
  tool(
    'create_entity',
    'Create Entity',
    'Create an entity, optionally from a finding (`findingId`) or an indexed value (`value`), which becomes its first alias or identifier. Every existing and future finding carrying one of its names or identifiers is then a mention, with no further step. Returns the entity with its mentions counted, and any identifier another entity already holds as `conflicts` (those wait in the review queue).',
    WRITE,
    async (args) => {
      await deps.switchService.assertEnabled();
      return deps.entities.create(args, MCP_ACTOR);
    },
  );
  tool(
    'update_entity',
    'Update Entity',
    'Add identifiers to an entity, remove values, or set its anchor URN and attributes. Rename it or edit aliases with upsert_glossary_term (it is a glossary term). An identifier another entity holds is not double-linked: it comes back under `conflicts` and waits for review.',
    WRITE,
    async (args) => {
      const id = await entityId(args.entity);
      const conflicts: unknown[] = [];
      for (const identifier of args.addIdentifiers ?? []) {
        const result = await deps.values.confirmValue(
          id,
          identifier,
          MCP_ACTOR,
        );
        if (result.conflict) {
          conflicts.push({ ...identifier, heldBy: result.conflict });
        }
      }
      for (const valueId of args.removeValueIds ?? []) {
        await deps.values.removeValue(valueId, MCP_ACTOR);
      }
      if (args.anchorUrn !== undefined || args.attributes !== undefined) {
        await deps.entities.update(
          id,
          { anchorUrn: args.anchorUrn, attributes: args.attributes },
          MCP_ACTOR,
        );
      }
      await deps.mentions.recount([id]);
      return { ...(await deps.entities.get(id)), conflicts };
    },
  );
  tool(
    'list_entity_candidates',
    'List Entity Candidates',
    'The entity review queue: values that may refer to an entity (a spelling variant found by sound or by folded spelling), each with a score, how many assets carry it and up to three occurrences to judge it by — plus identifier conflicts. Nothing here links until it is accepted.',
    READ,
    async (args) =>
      deps.candidates.list({
        termId: args.entity ? await entityId(args.entity) : undefined,
        kind: args.kind,
        minScore: args.minScore,
        take: args.take,
        skip: args.skip,
      }),
  );
  tool(
    'review_entity_candidates',
    'Review Entity Candidates',
    'Accept or reject candidates in one call. Accepting confirms the value for its entity, so every asset that carries it becomes a mention; rejecting is remembered and the value is not proposed for that entity again.',
    WRITE,
    (args) => deps.values.review(args.decisions, MCP_ACTOR),
  );
  tool(
    'merge_entities',
    'Merge Entities',
    'Merge one entity into another: its names, identifiers, values, references, relations and watches move to the target, and it becomes deprecated and redirects there. Two entities are never merged automatically. This cannot be undone by a single call.',
    DESTRUCTIVE,
    async (args) => {
      const result = await deps.values.merge(args.from, args.into, MCP_ACTOR);
      await deps.mentions.recount([result.from.id, result.into.id]);
      return result;
    },
  );
}
