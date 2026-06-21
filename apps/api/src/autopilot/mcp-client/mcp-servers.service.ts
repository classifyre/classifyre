import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { MaskedConfigCryptoService } from '../../masked-config-crypto.service';
import { McpClientService } from './mcp-client.service';
import type {
  CreateMcpServerDto,
  McpServerResponseDto,
  McpServerTestResultDto,
  UpdateMcpServerDto,
} from './mcp-server.dto';

/** CRUD + connectivity for external MCP servers. Mutations trigger a refresh. */
@Injectable()
export class McpServersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: MaskedConfigCryptoService,
    private readonly mcp: McpClientService,
  ) {}

  async list(): Promise<McpServerResponseDto[]> {
    const rows = await this.prisma.mcpServerConfig.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.map(r));
  }

  async create(dto: CreateMcpServerDto): Promise<McpServerResponseDto> {
    if (dto.transport === 'http' && !dto.url?.trim()) {
      throw new BadRequestException('An http MCP server requires a url.');
    }
    if (dto.transport === 'stdio' && !dto.command?.trim()) {
      throw new BadRequestException('A stdio MCP server requires a command.');
    }
    const slug = this.normalizeSlug(dto.slug || dto.name);
    try {
      const row = await this.prisma.mcpServerConfig.create({
        data: {
          name: dto.name,
          slug,
          transport: dto.transport,
          command: dto.command ?? null,
          args: dto.args ?? [],
          url: dto.url ?? null,
          headersEnc: this.encodeHeaders(dto.headers),
          enabled: dto.enabled ?? false,
          trusted: dto.trusted ?? false,
          agentKinds: dto.agentKinds ?? [],
          toolAllowlist: dto.toolAllowlist ?? [],
        },
      });
      await this.mcp.refresh();
      return this.map(row);
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(
          `MCP server slug "${slug}" already exists.`,
        );
      }
      throw e;
    }
  }

  async update(
    id: string,
    dto: UpdateMcpServerDto,
  ): Promise<McpServerResponseDto> {
    await this.requireExists(id);
    const row = await this.prisma.mcpServerConfig.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.transport !== undefined ? { transport: dto.transport } : {}),
        ...(dto.command !== undefined ? { command: dto.command } : {}),
        ...(dto.args !== undefined ? { args: dto.args } : {}),
        ...(dto.url !== undefined ? { url: dto.url } : {}),
        ...(dto.headers !== undefined
          ? { headersEnc: this.encodeHeaders(dto.headers ?? undefined) }
          : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(dto.trusted !== undefined ? { trusted: dto.trusted } : {}),
        ...(dto.agentKinds !== undefined ? { agentKinds: dto.agentKinds } : {}),
        ...(dto.toolAllowlist !== undefined
          ? { toolAllowlist: dto.toolAllowlist }
          : {}),
      },
    });
    await this.mcp.refresh();
    return this.map(row);
  }

  async remove(id: string): Promise<void> {
    await this.requireExists(id);
    await this.prisma.mcpServerConfig.delete({ where: { id } });
    await this.mcp.refresh();
  }

  /** Reconnect all enabled servers and rediscover their tools. */
  async refresh(): Promise<McpServerResponseDto[]> {
    await this.mcp.refresh();
    return this.list();
  }

  /** Probe one server: connect + list tools without changing registration. */
  async test(id: string): Promise<McpServerTestResultDto> {
    const server = await this.prisma.mcpServerConfig.findUnique({
      where: { id },
    });
    if (!server) throw new NotFoundException(`MCP server ${id} not found`);
    try {
      const client = await this.mcp.connect(server);
      const listed = await client.listTools();
      await client.close().catch(() => undefined);
      const tools = (listed.tools ?? []).map((tool) => tool.name);
      await this.prisma.mcpServerConfig.update({
        where: { id },
        data: { lastError: null, discoveredTools: tools },
      });
      return { ok: true, tools, error: null };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await this.prisma.mcpServerConfig
        .update({ where: { id }, data: { lastError: error } })
        .catch(() => undefined);
      return { ok: false, tools: [], error };
    }
  }

  private async requireExists(id: string): Promise<void> {
    const found = await this.prisma.mcpServerConfig.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!found) throw new NotFoundException(`MCP server ${id} not found`);
  }

  private encodeHeaders(
    headers: Record<string, string> | undefined,
  ): string | null {
    if (!headers || Object.keys(headers).length === 0) return null;
    return this.crypto.encryptString(JSON.stringify(headers));
  }

  private normalizeSlug(value: string): string {
    return (
      value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64) || 'mcp-server'
    );
  }

  private map(
    row: Prisma.McpServerConfigGetPayload<object>,
  ): McpServerResponseDto {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      transport: row.transport,
      command: row.command,
      args: row.args,
      url: row.url,
      hasHeaders: !!row.headersEnc,
      enabled: row.enabled,
      trusted: row.trusted,
      agentKinds: row.agentKinds,
      toolAllowlist: row.toolAllowlist,
      discoveredTools: row.discoveredTools,
      lastError: row.lastError,
      lastConnectedAt: row.lastConnectedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
