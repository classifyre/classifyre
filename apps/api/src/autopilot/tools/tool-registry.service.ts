import { Injectable, Logger } from '@nestjs/common';
import { ObserveToolset } from './observe/observe.toolset';
import { InvestigationToolset } from './investigation/investigation.toolset';
import { KnowledgeToolset } from './knowledge/knowledge.toolset';
import { ConfigToolset } from './config/config.toolset';
import { DetectorToolset } from './detector/detector.toolset';
import { FingerprintsToolset } from './fingerprints/fingerprints.toolset';
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
  private readonly tools = new Map<string, Tool>();

  constructor(
    private readonly observe: ObserveToolset,
    private readonly investigation: InvestigationToolset,
    private readonly knowledge: KnowledgeToolset,
    private readonly config: ConfigToolset,
    private readonly detector: DetectorToolset,
    private readonly fingerprints: FingerprintsToolset,
  ) {
    this.loadStatic([
      this.observe,
      this.investigation,
      this.knowledge,
      this.config,
      this.detector,
      this.fingerprints,
    ]);
  }

  private loadStatic(providers: ToolProvider[]): void {
    for (const provider of providers) {
      for (const tool of provider.list()) this.add(tool);
    }
  }

  /** Register a tool at runtime (e.g. an adapted MCP tool). Idempotent by name. */
  register(tool: Tool): void {
    this.add(tool);
  }

  /** Remove a runtime-registered tool (e.g. on MCP server refresh/disconnect). */
  unregister(name: string): void {
    this.tools.delete(name);
  }

  /** All registered tool names (used to scope MCP tools per mission). */
  names(): string[] {
    return [...this.tools.keys()];
  }

  private add(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      this.logger.warn(`Tool "${tool.name}" already registered — overwriting.`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /** All tools, or just the named subset (preserving registry definitions). */
  list(allowed?: string[]): Tool[] {
    if (!allowed) return [...this.tools.values()];
    return allowed
      .map((name) => this.tools.get(name))
      .filter((t): t is Tool => t !== undefined);
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
