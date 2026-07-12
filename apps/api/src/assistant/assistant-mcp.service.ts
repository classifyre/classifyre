import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServerFactoryService } from '../mcp-server.factory';

/** Catalog entry for one MCP tool, as needed by the assistant loop. */
export interface AssistantMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Derived from MCP annotations; missing annotations fail closed to mutate. */
  readOnly: boolean;
  destructive: boolean;
}

export interface AssistantMcpCallResult {
  ok: boolean;
  /** Parsed structuredContent (or text content) on success; error text on failure. */
  result: unknown;
}

/**
 * Connects the in-app assistant to the real MCP server over an in-memory
 * transport. Every assistant tool call therefore exercises exactly the same
 * registration, zod input validation, and handler path that external MCP
 * clients hit — the assistant doubles as a continuous MCP integration test.
 */
@Injectable()
export class AssistantMcpService implements OnModuleDestroy {
  private readonly logger = new Logger(AssistantMcpService.name);
  private clientPromise: Promise<Client> | null = null;
  private toolCache: AssistantMcpTool[] | null = null;

  constructor(private readonly mcpServerFactory: McpServerFactoryService) {}

  private getClient(): Promise<Client> {
    this.clientPromise ??= this.connect().catch((error) => {
      // Reset so a transient failure doesn't poison every later request.
      this.clientPromise = null;
      throw error;
    });
    return this.clientPromise;
  }

  private async connect(): Promise<Client> {
    const server = this.mcpServerFactory.createServer();
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'classifyre-assistant', version: '1.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    this.logger.log('Assistant connected to in-process MCP server');
    return client;
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.clientPromise) {
      return;
    }
    try {
      const client = await this.clientPromise;
      await client.close();
    } catch {
      // Shutdown path — nothing useful to do with a close failure.
    }
  }

  /** Lists MCP tools with read/mutate classification (cached after first call). */
  async listTools(): Promise<AssistantMcpTool[]> {
    if (this.toolCache) {
      return this.toolCache;
    }
    const client = await this.getClient();
    const tools: AssistantMcpTool[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools({ cursor });
      for (const tool of page.tools) {
        tools.push({
          name: tool.name,
          description: tool.description ?? '',
          inputSchema: (tool.inputSchema ?? {}) as Record<string, unknown>,
          readOnly: tool.annotations?.readOnlyHint === true,
          destructive: tool.annotations?.destructiveHint === true,
        });
      }
      cursor = page.nextCursor;
    } while (cursor);
    this.toolCache = tools;
    return tools;
  }

  async getTool(name: string): Promise<AssistantMcpTool | undefined> {
    const tools = await this.listTools();
    return tools.find((tool) => tool.name === name);
  }

  /**
   * Calls an MCP tool and normalizes the result. MCP-level errors (isError
   * content) and thrown transport/validation errors both come back as
   * `{ ok: false, result: <error text> }` so the loop can feed them to the
   * model as observations instead of aborting the conversation.
   */
  async callTool(
    name: string,
    input: Record<string, unknown>,
  ): Promise<AssistantMcpCallResult> {
    try {
      const client = await this.getClient();
      const response = await client.callTool({ name, arguments: input });
      const textContent = Array.isArray(response.content)
        ? response.content
            .filter(
              (item): item is { type: 'text'; text: string } =>
                typeof item === 'object' &&
                item !== null &&
                (item as { type?: unknown }).type === 'text',
            )
            .map((item) => item.text)
            .join('\n')
        : '';

      if (response.isError) {
        return { ok: false, result: textContent || 'Tool call failed.' };
      }

      if (
        response.structuredContent &&
        typeof response.structuredContent === 'object'
      ) {
        return { ok: true, result: response.structuredContent };
      }

      try {
        return { ok: true, result: JSON.parse(textContent) };
      } catch {
        return { ok: true, result: textContent };
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Tool call failed.';
      this.logger.warn(`MCP tool "${name}" failed: ${message}`);
      return { ok: false, result: message };
    }
  }
}
