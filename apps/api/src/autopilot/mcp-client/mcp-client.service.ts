import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { PrismaService } from '../../prisma.service';
import { MaskedConfigCryptoService } from '../../masked-config-crypto.service';
import { ToolRegistry } from '../tools/tool-registry.service';
import { adaptMcpTool, type RemoteTool } from './mcp-tool-adapter';
import { ClsService } from 'nestjs-cls';
import { CLS_SCHEMA } from '../../namespace/namespace.constants';

const CONNECT_TIMEOUT_MS = 15_000;
const CALL_TIMEOUT_MS = 60_000;

interface RegisteredTool {
  serverId: string;
  agentKinds: string[];
  trusted: boolean;
}

interface NamespaceMcpRuntime {
  tools: Map<string, RegisteredTool>;
  clients: Map<string, Client>;
  refreshing: boolean;
  refreshDone?: Promise<void>;
  finishRefresh?: () => void;
  disposed: boolean;
}

/**
 * MCP client: connects to enabled external MCP servers, discovers their tools
 * and registers adapted (namespaced, gated) tools into the harness registry.
 * Connections are best-effort — a failing server records its error and never
 * breaks the harness. Call refresh() after any server config change.
 */
@Injectable()
export class McpClientService implements OnModuleDestroy {
  private readonly logger = new Logger(McpClientService.name);
  private readonly runtimes = new Map<string, NamespaceMcpRuntime>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: MaskedConfigCryptoService,
    private readonly registry: ToolRegistry,
    private readonly cls: ClsService,
  ) {}

  // No boot-time refresh: there is no namespace context at startup, and the
  // outbound-MCP server list is per-namespace. refresh() is invoked at request
  // time (in a namespace context) when a server config changes.

  async onModuleDestroy(): Promise<void> {
    await Promise.all(
      [...this.runtimes.keys()].map((schema) => this.stopForSchema(schema)),
    );
  }

  /** Tool names a mission of `kind` may call (server agentKinds empty = all). */
  toolNamesForKind(kind: string): string[] {
    const out: string[] = [];
    for (const [name, meta] of this.runtime().tools) {
      if (meta.agentKinds.length === 0 || meta.agentKinds.includes(kind)) {
        out.push(name);
      }
    }
    return out;
  }

  /**
   * Reconnect every enabled server, rediscover tools and re-register them.
   * Updates each server's status row (discoveredTools / lastError / lastConnectedAt).
   */
  async refresh(): Promise<void> {
    const schema = this.requireSchema();
    const runtime = this.runtime();
    if (runtime.refreshing) return;
    runtime.refreshing = true;
    runtime.refreshDone = new Promise<void>((resolve) => {
      runtime.finishRefresh = resolve;
    });
    try {
      // Tear down previous registrations + clients.
      for (const name of runtime.tools.keys()) this.registry.unregister(name);
      runtime.tools.clear();
      await this.closeRuntime(runtime);

      const servers = await this.prisma.mcpServerConfig.findMany({
        where: { enabled: true },
      });

      for (const server of servers) {
        try {
          const client = await this.connect(server);
          const listed = await client.listTools();
          const remoteTools = (listed.tools ?? []) as RemoteTool[];
          const allow = new Set(server.toolAllowlist);
          const exposed = remoteTools.filter(
            (rt) => allow.size === 0 || allow.has(rt.name),
          );

          for (const rt of exposed) {
            const tool = adaptMcpTool({
              slug: server.slug,
              trusted: server.trusted,
              remote: rt,
              call: (toolName, args) =>
                this.callTool(schema, server.id, toolName, args),
            });
            this.registry.register(tool);
            runtime.tools.set(tool.name, {
              serverId: server.id,
              agentKinds: server.agentKinds,
              trusted: server.trusted,
            });
          }

          runtime.clients.set(server.id, client);
          await this.prisma.mcpServerConfig.update({
            where: { id: server.id },
            data: {
              discoveredTools: exposed.map((rt) => rt.name),
              lastError: null,
              lastConnectedAt: new Date(),
            },
          });
          this.logger.log(
            `MCP server "${server.slug}" connected — ${exposed.length} tool(s).`,
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(`MCP server "${server.slug}" failed: ${message}`);
          await this.prisma.mcpServerConfig
            .update({
              where: { id: server.id },
              data: { lastError: message, discoveredTools: [] },
            })
            .catch(() => undefined);
        }
      }
    } finally {
      runtime.refreshing = false;
      runtime.finishRefresh?.();
      runtime.finishRefresh = undefined;
      runtime.refreshDone = undefined;
    }
  }

  /** Connect to one server, throwing on failure (caller records the error). */
  async connect(server: {
    transport: string;
    command: string | null;
    args: string[];
    url: string | null;
    headersEnc: string | null;
  }): Promise<Client> {
    const client = new Client(
      { name: 'classifyre-harness', version: '1.0.0' },
      { capabilities: {} },
    );
    const transport =
      server.transport === 'stdio'
        ? new StdioClientTransport({
            command: server.command ?? '',
            args: server.args,
          })
        : new StreamableHTTPClientTransport(new URL(server.url ?? ''), {
            requestInit: { headers: this.decodeHeaders(server.headersEnc) },
          });
    await client.connect(transport, { timeout: CONNECT_TIMEOUT_MS });
    return client;
  }

  private async callTool(
    schema: string,
    serverId: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const client = this.runtimes.get(schema)?.clients.get(serverId);
    if (!client) {
      throw new Error(
        'MCP server is not connected — refresh the harness tools.',
      );
    }
    return client.callTool({ name, arguments: args }, undefined, {
      timeout: CALL_TIMEOUT_MS,
    });
  }

  private decodeHeaders(headersEnc: string | null): Record<string, string> {
    if (!headersEnc) return {};
    try {
      const json = this.crypto.decryptString(headersEnc);
      const parsed = JSON.parse(json) as Record<string, string>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  async stopForSchema(schema: string): Promise<void> {
    const runtime = this.runtimes.get(schema);
    if (!runtime) return;
    runtime.disposed = true;
    await runtime.refreshDone;
    this.runtimes.delete(schema);
    this.registry.clearScope(schema);
    await this.closeRuntime(runtime);
  }

  private async closeRuntime(runtime: NamespaceMcpRuntime): Promise<void> {
    for (const client of runtime.clients.values()) {
      await client.close().catch(() => undefined);
    }
    runtime.clients.clear();
  }

  private requireSchema(): string {
    const schema = this.cls.get<string>(CLS_SCHEMA);
    if (!schema) throw new Error('MCP client used outside a namespace context');
    return schema;
  }

  private runtime(): NamespaceMcpRuntime {
    const schema = this.requireSchema();
    let runtime = this.runtimes.get(schema);
    if (!runtime) {
      runtime = {
        tools: new Map(),
        clients: new Map(),
        refreshing: false,
        disposed: false,
      };
      this.runtimes.set(schema, runtime);
    }
    return runtime;
  }
}
