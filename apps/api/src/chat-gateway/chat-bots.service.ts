import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ChatPlatform, Prisma, type ChatBot } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { MaskedConfigCryptoService } from '../masked-config-crypto.service';
import {
  CHAT_PLATFORM_VALUES,
  CHAT_STEERABLE_AGENT_KIND_VALUES,
  type ChatBotDiagnosticsDto,
  type ChatBotResponseDto,
  type ChatBotSimulateDto,
  type ChatBotSimulateResultDto,
  type ChatBotTestResultDto,
  type CreateChatBotDto,
  type UpdateChatBotDto,
} from '../dto/chat-bots.dto';
import { MCP_CAPABILITY_GROUPS } from '../mcp-catalog';
import { ChatAgentService } from './chat-agent.service';
import { ChatGatewayService } from './chat-gateway.service';

const CAPABILITY_GROUP_IDS = new Set(MCP_CAPABILITY_GROUPS.map((g) => g.id));
const STEERABLE_KINDS = new Set<string>(CHAT_STEERABLE_AGENT_KIND_VALUES);

/**
 * CRUD for chat bots. There is no global ValidationPipe, so every input is
 * normalized here: strings trimmed, arrays coerced and whitelisted, tokens
 * encrypted at rest and only ever returned as masked previews. Every mutation
 * rebuilds the live connectors.
 */
@Injectable()
export class ChatBotsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: MaskedConfigCryptoService,
    private readonly gateway: ChatGatewayService,
    private readonly agent: ChatAgentService,
  ) {}

  async list(): Promise<ChatBotResponseDto[]> {
    const bots = await this.prisma.chatBot.findMany({
      orderBy: { createdAt: 'asc' },
    });
    return bots.map((bot) => this.toResponse(bot));
  }

  async create(dto: CreateChatBotDto): Promise<ChatBotResponseDto> {
    const platform = this.normalizePlatform(dto.platform);
    const name = this.normalizeName(dto.name);
    const botToken = this.normalizeToken(dto.botToken);
    const appToken = this.normalizeToken(dto.appToken ?? '');
    if (!botToken) {
      throw new BadRequestException('A bot token is required.');
    }
    if (platform === ChatPlatform.SLACK && !appToken) {
      throw new BadRequestException(
        'Slack bots need an app-level token (xapp-…) for Socket Mode.',
      );
    }

    const created = await this.prisma.chatBot.create({
      data: {
        platform,
        name,
        enabled: dto.enabled === true,
        botTokenEnc: this.crypto.encryptString(botToken),
        appTokenEnc: appToken ? this.crypto.encryptString(appToken) : null,
        capabilityGroups: this.normalizeCapabilityGroups(dto.capabilityGroups),
        agentKinds: this.normalizeAgentKinds(dto.agentKinds),
        allowMutations: dto.allowMutations !== false,
      },
    });
    await this.refreshGateway();
    return this.toResponse(await this.findOrThrow(created.id));
  }

  async update(id: string, dto: UpdateChatBotDto): Promise<ChatBotResponseDto> {
    const existing = await this.findOrThrow(id);

    const data: Prisma.ChatBotUpdateInput = {};
    if (dto.name !== undefined) data.name = this.normalizeName(dto.name);
    if (dto.enabled !== undefined) data.enabled = dto.enabled === true;
    if (dto.allowMutations !== undefined) {
      data.allowMutations = dto.allowMutations === true;
    }
    if (dto.capabilityGroups !== undefined) {
      data.capabilityGroups = this.normalizeCapabilityGroups(
        dto.capabilityGroups,
      );
    }
    if (dto.agentKinds !== undefined) {
      data.agentKinds = this.normalizeAgentKinds(dto.agentKinds);
    }
    // Empty token strings mean "keep the stored value" — the UI cannot echo
    // the raw token back, so absence is not distinguishable from clearing.
    const botToken = this.normalizeToken(dto.botToken ?? '');
    if (botToken) data.botTokenEnc = this.crypto.encryptString(botToken);
    const appToken = this.normalizeToken(dto.appToken ?? '');
    if (appToken) data.appTokenEnc = this.crypto.encryptString(appToken);

    const willBeEnabled = dto.enabled ?? existing.enabled;
    if (
      existing.platform === ChatPlatform.SLACK &&
      willBeEnabled &&
      !existing.appTokenEnc &&
      !appToken
    ) {
      throw new BadRequestException(
        'Slack bots need an app-level token (xapp-…) before they can be enabled.',
      );
    }

    await this.prisma.chatBot.update({ where: { id }, data });
    await this.refreshGateway();
    return this.toResponse(await this.findOrThrow(id));
  }

  async diagnostics(id: string): Promise<ChatBotDiagnosticsDto> {
    const bot = await this.findOrThrow(id);
    return { ...this.gateway.getRuntime(bot.id), lastError: bot.lastError };
  }

  async test(id: string): Promise<ChatBotTestResultDto> {
    const bot = await this.findOrThrow(id);
    return this.gateway.testBot(bot);
  }

  /**
   * Run one agent turn without any platform in the middle — the settings UI
   * (and operators debugging a bot) can talk to the bot directly. Uses a
   * dedicated per-bot session so simulated history behaves like a real chat.
   */
  async simulate(
    id: string,
    dto: ChatBotSimulateDto,
  ): Promise<ChatBotSimulateResultDto> {
    const bot = await this.findOrThrow(id);
    const message = typeof dto.message === 'string' ? dto.message.trim() : '';
    if (!message) throw new BadRequestException('message must not be empty.');
    const reply = await this.agent.handleInboundMessage(bot, {
      chatKey: 'simulator',
      userId: 'simulator',
      text: message,
      title: 'Simulator',
    });
    return { reply };
  }

  async remove(id: string): Promise<void> {
    await this.findOrThrow(id);
    // Sessions and messages cascade with the bot.
    await this.prisma.chatBot.delete({ where: { id } });
    await this.refreshGateway();
  }

  private toResponse(bot: ChatBot): ChatBotResponseDto {
    return {
      id: bot.id,
      platform: bot.platform,
      name: bot.name,
      enabled: bot.enabled,
      botTokenPreview: this.preview(bot.botTokenEnc) ?? '••••••••',
      appTokenPreview: this.preview(bot.appTokenEnc),
      capabilityGroups: bot.capabilityGroups,
      agentKinds: bot.agentKinds,
      allowMutations: bot.allowMutations,
      lastError: bot.lastError,
      lastConnectedAt: bot.lastConnectedAt,
      createdAt: bot.createdAt,
      updatedAt: bot.updatedAt,
    };
  }

  private preview(encrypted: string | null): string | null {
    if (!encrypted) return null;
    try {
      const plaintext = this.crypto.decryptString(encrypted);
      if (plaintext.length <= 8) return '••••••••';
      return `${plaintext.slice(0, 4)}…${plaintext.slice(-3)}`;
    } catch {
      return '••••••••';
    }
  }

  private async findOrThrow(id: string): Promise<ChatBot> {
    const bot = await this.prisma.chatBot.findUnique({ where: { id } });
    if (!bot) throw new NotFoundException(`Chat bot "${id}" not found.`);
    return bot;
  }

  private async refreshGateway(): Promise<void> {
    // Connector failures land on the bot row's lastError — never fail the CRUD.
    await this.gateway.refresh().catch(() => undefined);
  }

  private normalizePlatform(value: unknown): ChatPlatform {
    if (
      typeof value === 'string' &&
      (CHAT_PLATFORM_VALUES as readonly string[]).includes(value)
    ) {
      return value as ChatPlatform;
    }
    throw new BadRequestException(
      `platform must be one of: ${CHAT_PLATFORM_VALUES.join(', ')}.`,
    );
  }

  private normalizeName(value: unknown): string {
    const name = typeof value === 'string' ? value.trim() : '';
    if (!name || name.length > 120) {
      throw new BadRequestException('name must be 1–120 characters.');
    }
    return name;
  }

  private normalizeToken(value: unknown): string {
    const token = typeof value === 'string' ? value.trim() : '';
    if (token.length > 500) {
      throw new BadRequestException('Tokens must be at most 500 characters.');
    }
    return token;
  }

  private normalizeCapabilityGroups(value: unknown): string[] {
    return this.normalizeStringArray(value).filter((v) =>
      CAPABILITY_GROUP_IDS.has(v),
    );
  }

  private normalizeAgentKinds(value: unknown): string[] {
    return this.normalizeStringArray(value).filter((v) =>
      STEERABLE_KINDS.has(v),
    );
  }

  private normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const out = new Set<string>();
    for (const item of value) {
      const s = typeof item === 'string' ? item.trim() : '';
      if (s && s.length <= 200) out.add(s);
    }
    return [...out];
  }
}
