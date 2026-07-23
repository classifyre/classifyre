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
    ]);
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
