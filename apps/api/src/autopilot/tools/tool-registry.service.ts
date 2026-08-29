import { Injectable, Logger, Optional } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { CLS_SCHEMA } from '../../namespace/namespace.constants';
import { ObserveToolset } from './observe/observe.toolset';
import { InvestigationToolset } from './investigation/investigation.toolset';
import { KnowledgeToolset } from './knowledge/knowledge.toolset';
import { ConfigToolset } from './config/config.toolset';
import { DetectorToolset } from './detector/detector.toolset';
import { FingerprintsToolset } from './fingerprints/fingerprints.toolset';
import { AlertToolset } from './alert/alert.toolset';
import { SemanticToolset } from './semantic/semantic.toolset';
import { GlossaryToolset } from './glossary/glossary.toolset';
import { CaseLeadsToolset } from './leads/case-leads.toolset';
import { ScheduleToolset } from './schedule/schedule.toolset';
import { HypothesesToolset } from './hypotheses/hypotheses.toolset';
import { SupervisorToolset } from './supervisor/supervisor.toolset';
import { HygieneToolset } from './hygiene/hygiene.toolset';
import { grantedToolsFor } from './granted-tools';
import type { Tool } from './tool.types';

/** A provider that contributes a set of statically-defined tools. */
export interface ToolProvider {
  list(): Tool[];
}

/**
 * Central catalog of every tool the agent loop may invoke. Static tools are
 * contributed by grouped toolset providers (observe, investigation, …);
 * runtime tools (e.g. adapted MCP server tools) are added via `register()`.
 *
 * `catalog()` renders the allowed tools for the model's system prompt.
 */
/** Hard ceiling on one tools.search page, so a search cannot flood a turn. */
const MAX_SEARCH_RESULTS = 40;

@Injectable()
export class ToolRegistry {
  private readonly logger = new Logger(ToolRegistry.name);
  /** Static and process-wide runtime tools (built-ins). */
  private readonly tools = new Map<string, Tool>();
  /** External MCP tools, isolated by tenant schema. */
  private readonly scopedTools = new Map<string, Map<string, Tool>>();

  constructor(
    private readonly observe: ObserveToolset,
    private readonly investigation: InvestigationToolset,
    private readonly knowledge: KnowledgeToolset,
    private readonly config: ConfigToolset,
    private readonly detector: DetectorToolset,
    private readonly fingerprints: FingerprintsToolset,
    private readonly alert: AlertToolset,
    private readonly semantic: SemanticToolset,
    private readonly glossaryTools: GlossaryToolset,
    private readonly caseLeads: CaseLeadsToolset,
    private readonly schedule: ScheduleToolset,
    private readonly hypotheses: HypothesesToolset,
    private readonly supervisorTools: SupervisorToolset,
    private readonly hygiene: HygieneToolset,
    @Optional() private readonly cls?: ClsService,
  ) {
    this.loadStatic([
      this.observe,
      this.investigation,
      this.knowledge,
      this.config,
      this.detector,
      this.fingerprints,
      this.alert,
      this.semantic,
      this.glossaryTools,
      this.caseLeads,
      this.schedule,
      this.hypotheses,
      this.supervisorTools,
      this.hygiene,
    ]);
    for (const tool of this.metaTools()) this.add(tool);
  }

  /**
   * Search and namespace-listing tools, defined here because this is where the
   * catalog lives — a toolset injecting the registry that constructs it would
   * be a cycle, and routing the search through the model instead of the harness
   * would leave "which tools might be relevant" stuck in the transcript forever.
   */
  private metaTools(): Tool[] {
    return [
      {
        name: 'tools.search',
        description:
          'Find tools you are allowed to call but whose details are not in the list above. Returns ' +
          'the full input schema for each match, which is what you need in order to call it. Search ' +
          'by what you want to do ("purge", "detector", "duplicate") rather than by exact name. Your ' +
          'prompt lists only the tools you need every run; everything else in the system is reachable ' +
          'through here.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description:
                'Words to match against tool names and descriptions. Empty returns the first page of everything you may call.',
            },
            limit: { type: 'number', description: 'Default 12, max 40.' },
          },
          additionalProperties: false,
        },
        sideEffect: 'read',
        handler: (input, tc) => {
          const query = typeof input.query === 'string' ? input.query : '';
          const granted = grantedToolsFor(tc);
          if (!granted) {
            return Promise.resolve({
              matches: [],
              note: 'This run holds a fixed toolset; every tool it may call is already listed in the prompt.',
            });
          }
          const limit = Math.min(
            Math.max(Number(input.limit) || 12, 1),
            MAX_SEARCH_RESULTS,
          );
          const matches = this.search(query, granted, limit);
          return Promise.resolve({
            query,
            totalCallable: granted.length,
            shown: matches.length,
            matches: matches.map((t) => ({
              name: t.name,
              sideEffect: t.sideEffect,
              description: t.description,
              inputSchema: t.inputSchema,
            })),
          });
        },
      },
      {
        name: 'tools.list_namespaces',
        description:
          'The namespaces of every tool you may call, with how many are in each. Use it to orient ' +
          'before searching when you do not yet know what vocabulary this system uses.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        sideEffect: 'read',
        handler: (_input, tc) => {
          const granted = grantedToolsFor(tc);
          if (!granted) {
            return Promise.resolve({
              namespaces: [],
              note: 'This run holds a fixed toolset; see the prompt.',
            });
          }
          const counts = new Map<string, { read: number; mutate: number }>();
          for (const tool of this.list(granted)) {
            const ns = tool.name.slice(0, tool.name.lastIndexOf('.'));
            const entry = counts.get(ns) ?? { read: 0, mutate: 0 };
            entry[tool.sideEffect] += 1;
            counts.set(ns, entry);
          }
          return Promise.resolve({
            namespaces: [...counts.entries()]
              .sort((a, b) => a[0].localeCompare(b[0]))
              .map(([namespace, n]) => ({ namespace, ...n })),
          });
        },
      },
    ];
  }

  /**
   * Rank the granted tools against a free-text query.
   *
   * Substring scoring rather than anything cleverer: tool names here are
   * `namespace.verb` and descriptions are written for a model to read, so the
   * words an agent reaches for are usually literally present. A name hit
   * outranks a description hit because an agent that half-remembers a tool is
   * far more often right about its name than about its prose.
   */
  search(query: string, allowed: string[], limit: number): Tool[] {
    const tools = this.list(allowed);
    const terms = query
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .filter(Boolean);
    if (terms.length === 0) return tools.slice(0, limit);

    const scored = tools
      .map((tool) => {
        const name = tool.name.toLowerCase();
        const description = tool.description.toLowerCase();
        let score = 0;
        for (const term of terms) {
          if (name.includes(term)) score += 3;
          if (description.includes(term)) score += 1;
        }
        return { tool, score };
      })
      .filter((s) => s.score > 0)
      .sort(
        (a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name),
      );

    return scored.slice(0, limit).map((s) => s.tool);
  }

  /** Full definitions for named tools, for callers assembling a catalog. */
  describe(names: string[]): Tool[] {
    return this.list(names);
  }

  private loadStatic(providers: ToolProvider[]): void {
    for (const provider of providers) {
      for (const tool of provider.list()) this.add(tool);
    }
  }

  /** Register a tool at runtime (e.g. an adapted MCP tool). Idempotent by name. */
  register(tool: Tool): void {
    const scoped = this.currentScopedTools(true);
    if (scoped) this.add(tool, scoped);
    else this.add(tool, this.tools);
  }

  /** Remove a runtime-registered tool (e.g. on MCP server refresh/disconnect). */
  unregister(name: string): void {
    const scoped = this.currentScopedTools(false);
    if (scoped) scoped.delete(name);
    else this.tools.delete(name);
  }

  /** Remove every runtime tool registered for a deleted namespace. */
  clearScope(schema: string): void {
    this.scopedTools.delete(schema);
  }

  /** All registered tool names (used to scope MCP tools per mission). */
  names(): string[] {
    return [...this.mergedTools().keys()];
  }

  private add(tool: Tool, target = this.tools): void {
    if (target.has(tool.name)) {
      this.logger.warn(`Tool "${tool.name}" already registered — overwriting.`);
    }
    target.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.currentScopedTools(false)?.get(name) ?? this.tools.get(name);
  }

  /** All tools, or just the named subset (preserving registry definitions). */
  list(allowed?: string[]): Tool[] {
    const tools = this.mergedTools();
    if (!allowed) return [...tools.values()];
    return allowed
      .map((name) => tools.get(name))
      .filter((t): t is Tool => t !== undefined);
  }

  private currentScopedTools(create: boolean): Map<string, Tool> | undefined {
    const schema = this.cls?.get<string>(CLS_SCHEMA);
    if (!schema) return undefined;
    let tools = this.scopedTools.get(schema);
    if (!tools && create) {
      tools = new Map<string, Tool>();
      this.scopedTools.set(schema, tools);
    }
    return tools;
  }

  private mergedTools(): Map<string, Tool> {
    const merged = new Map(this.tools);
    const scoped = this.currentScopedTools(false);
    if (scoped) {
      for (const [name, tool] of scoped) merged.set(name, tool);
    }
    return merged;
  }

  /**
   * Render the allowed tools as a compact catalog for the system prompt:
   * name, side-effect, description and input schema.
   */
  catalog(allowed?: string[]): string {
    const tools = this.list(allowed);
    return tools
      .map((t) => {
        const tag = t.sideEffect === 'mutate' ? '[mutate]' : '[read]';
        return [
          `### ${t.name} ${tag}`,
          t.description,
          `input schema: ${JSON.stringify(t.inputSchema)}`,
        ].join('\n');
      })
      .join('\n\n');
  }
}
