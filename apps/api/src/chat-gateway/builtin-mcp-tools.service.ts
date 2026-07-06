import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServerFactoryService } from '../mcp-server.factory';
import { ToolRegistry } from '../autopilot/tools/tool-registry.service';
import {
  adaptBuiltinMcpTool,
  type BuiltinRemoteTool,
} from './builtin-mcp-tool-adapter';

const CALL_TIMEOUT_MS = 60_000;

/**
 * Bridges the built-in Classifyre MCP server into the harness tool registry —
 * in-process over a linked in-memory transport pair, so the chat agent (and,
 * if explicitly assigned, autopilot missions) can call the same ~36 tools an
 * external MCP client sees, without HTTP or an access token.
 */
@Injectable()
export class BuiltinMcpToolsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BuiltinMcpToolsService.name);
  private client: Client | null = null;
  private readonly registered: string[] = [];

  constructor(
    private readonly factory: McpServerFactoryService,
    private readonly registry: ToolRegistry,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.connect();
      this.logger.log(
        `Bridged ${this.registered.length} built-in MCP tool(s) into the harness registry.`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to bridge built-in MCP tools: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    for (const name of this.registered) this.registry.unregister(name);
    this.registered.length = 0;
    await this.client?.close().catch(() => undefined);
    this.client = null;
  }

  /** Registry names of every bridged tool (`mcp.builtin.*`). */
  names(): string[] {
    return [...this.registered];
  }

  private async connect(): Promise<void> {
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await this.factory.createServer().connect(serverTransport);

    const client = new Client({
      name: 'classifyre-chat-gateway',
      version: '1.0.0',
    });
    await client.connect(clientTransport);
    this.client = client;

    const listed = await client.listTools();
    for (const remote of (listed.tools ?? []) as BuiltinRemoteTool[]) {
      const tool = adaptBuiltinMcpTool({
        remote,
        call: (toolName, args) => this.callTool(toolName, args),
      });
      this.registry.register(tool);
      this.registered.push(tool.name);
    }
  }

  private async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this.client) {
      throw new Error('Built-in MCP bridge is not connected.');
    }
    const result = await this.client.callTool(
      { name, arguments: args },
      undefined,
      { timeout: CALL_TIMEOUT_MS },
    );
    const text = Array.isArray(result.content)
      ? result.content
          .filter(
            (c): c is { type: 'text'; text: string } =>
              typeof c === 'object' &&
              c !== null &&
              (c as { type?: unknown }).type === 'text',
          )
          .map((c) => c.text)
          .join('\n')
      : '';
    if (result.isError) {
      throw new Error(text || `Tool "${name}" failed.`);
    }
    return result.structuredContent ?? text;
  }
}
