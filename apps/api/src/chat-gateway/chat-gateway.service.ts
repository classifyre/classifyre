import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { WebClient } from '@slack/web-api';
import { ChatPlatform, type ChatBot } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { MaskedConfigCryptoService } from '../masked-config-crypto.service';
import type {
  ChatBotDiagnosticsDto,
  ChatBotTestCheckDto,
  ChatBotTestResultDto,
} from '../dto/chat-bots.dto';
import { ChatAgentService } from './chat-agent.service';
import { renderChatEvent, type ChatEventCode } from './chat-activity';
import type { ChatConnector } from './connectors/connector.types';
import { SlackConnector } from './connectors/slack.connector';
import { TelegramConnector } from './connectors/telegram.connector';
import { runsBackgroundWorkers } from '../service-role';
import { stableJsonHash } from '../utils/stable-json';

interface ActivityEntry {
  at: Date;
  level: 'INFO' | 'ERROR';
  code: ChatEventCode;
  params: Record<string, string>;
  message: string;
}

/** Per-bot in-memory connector telemetry, reset on every refresh/restart. */
interface BotRuntime {
  connectedAt: Date | null;
  lastEventAt: Date | null;
  eventsReceived: number;
  repliesSent: number;
  /** Agent turns currently running for this bot. */
  processing: number;
  activity: ActivityEntry[];
}

const ACTIVITY_LIMIT = 50;
/** How often the worker checks for ChatBot config changes made via API pods. */
const CONFIG_WATCH_INTERVAL_MS = 60_000;

/**
 * Owns the live platform connections: one connector per enabled ChatBot,
 * started on bootstrap and rebuilt by refresh() after any bot config change
 * (mirrors McpClientService). Best-effort — a failing bot records its error
 * on the row and never breaks the API. Each connector reports its activity
 * (messages seen, turns running, replies sent, errors) into an in-memory
 * ring buffer served by the diagnostics endpoint; entries carry a stable
 * code + params so the web UI can translate them.
 *
 * NOTE: connectors assume a single running instance. In a scaled-out
 * deployment only the SERVICE_ROLE=worker process starts connectors —
 * multiple pollers would double-poll Telegram (surfaces as 409 lastError)
 * and double-reply on Slack. API pods that change bot config bump the
 * ChatBot rows; the worker picks the change up via a periodic revision
 * check instead of a direct refresh() call.
 */
@Injectable()
export class ChatGatewayService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(ChatGatewayService.name);
  private readonly connectors = new Map<string, ChatConnector>();
  private readonly runtimes = new Map<string, BotRuntime>();
  private refreshing = false;
  private configWatchTimer?: NodeJS.Timeout;
  private lastConfigRevision?: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: MaskedConfigCryptoService,
    private readonly agent: ChatAgentService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!runsBackgroundWorkers()) {
      this.logger.log(
        'SERVICE_ROLE=api: chat connectors left to the worker deployment',
      );
      return;
    }
    await this.refresh().catch((e) =>
      this.logger.warn(
        `Initial chat gateway refresh failed: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
    this.configWatchTimer = setInterval(() => {
      void this.refreshIfConfigChanged().catch(() => undefined);
    }, CONFIG_WATCH_INTERVAL_MS);
    this.configWatchTimer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.configWatchTimer) clearInterval(this.configWatchTimer);
    await this.stopAll();
  }

  /**
   * Hash of the connector-relevant ChatBot config. Deliberately excludes the
   * status fields the connectors themselves write (lastError, lastConnectedAt,
   * telegramLastUpdateId) — those bump updatedAt on every poll.
   */
  private async configRevision(): Promise<string> {
    const bots = await this.prisma.chatBot.findMany({
      select: {
        id: true,
        platform: true,
        name: true,
        enabled: true,
        botTokenEnc: true,
        appTokenEnc: true,
        capabilityGroups: true,
        agentKinds: true,
        allowMutations: true,
      },
      orderBy: { id: 'asc' },
    });
    return stableJsonHash(bots);
  }

  private async refreshIfConfigChanged(): Promise<void> {
    const revision = await this.configRevision();
    if (revision === this.lastConfigRevision) return;
    await this.refresh();
  }

  /** Rebuild every connector from the current ChatBot rows. */
  async refresh(): Promise<void> {
    if (!runsBackgroundWorkers()) return;
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      await this.stopAll();
      this.lastConfigRevision = await this.configRevision();
      const bots = await this.prisma.chatBot.findMany({
        where: { enabled: true },
      });
      for (const bot of bots) {
        this.runtimes.set(bot.id, {
          connectedAt: null,
          lastEventAt: null,
          eventsReceived: 0,
          repliesSent: 0,
          processing: 0,
          activity: [],
        });
        try {
          const connector = this.buildConnector(bot);
          await connector.start();
          this.connectors.set(bot.id, connector);
          const runtime = this.runtimes.get(bot.id);
          if (runtime) runtime.connectedAt = new Date();
          await this.saveStatus(bot.id, null, true);
          this.recordActivity(bot.id, 'INFO', 'connectorStarted');
          this.logger.log(`Connected ${bot.platform} bot "${bot.name}".`);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          this.logger.error(`Bot "${bot.name}" failed to start: ${reason}`);
          this.recordActivity(bot.id, 'ERROR', 'connectorStartFailed', {
            reason,
          });
          await this.saveStatus(bot.id, reason, false).catch(() => undefined);
        }
      }
    } finally {
      this.refreshing = false;
    }
  }

  /** Runtime telemetry for the settings UI (lastError is merged from the row). */
  getRuntime(botId: string): Omit<ChatBotDiagnosticsDto, 'lastError'> {
    const runtime = this.runtimes.get(botId);
    return {
      running: this.connectors.has(botId),
      processing: (runtime?.processing ?? 0) > 0,
      connectedAt: runtime?.connectedAt ?? null,
      lastEventAt: runtime?.lastEventAt ?? null,
      eventsReceived: runtime?.eventsReceived ?? 0,
      repliesSent: runtime?.repliesSent ?? 0,
      activity: [...(runtime?.activity ?? [])].reverse(),
    };
  }

  /**
   * Live credential checks with the stored tokens — independent of the
   * running connector, so a misconfigured bot can be debugged in place.
   */
  async testBot(bot: ChatBot): Promise<ChatBotTestResultDto> {
    const checks: ChatBotTestCheckDto[] =
      bot.platform === ChatPlatform.SLACK
        ? await this.testSlack(bot)
        : await this.testTelegram(bot);
    return { ok: checks.every((c) => c.ok), checks };
  }

  private async testTelegram(bot: ChatBot): Promise<ChatBotTestCheckDto[]> {
    const token = this.crypto.decryptString(bot.botTokenEnc);
    const checks: ChatBotTestCheckDto[] = [];
    let tokenOk = false;
    try {
      const me = await telegramApi<{ username?: string; first_name?: string }>(
        token,
        'getMe',
      );
      tokenOk = true;
      checks.push(
        check('botToken', true, 'telegramAuthenticated', {
          username: me.username ?? me.first_name ?? 'unknown',
        }),
      );
    } catch (error) {
      checks.push(
        check('botToken', false, 'telegramTokenRejected', {
          reason: errorMessage(error),
        }),
      );
    }
    if (tokenOk) {
      try {
        const info = await telegramApi<{ url?: string }>(
          token,
          'getWebhookInfo',
        );
        checks.push(
          info.url
            ? check('polling', false, 'telegramWebhookConflict', {
                url: info.url,
              })
            : check('polling', true, 'telegramPollingOk'),
        );
      } catch (error) {
        checks.push(
          check('polling', false, 'telegramWebhookInfoFailed', {
            reason: errorMessage(error),
          }),
        );
      }
    }
    return checks;
  }

  private async testSlack(bot: ChatBot): Promise<ChatBotTestCheckDto[]> {
    const checks: ChatBotTestCheckDto[] = [];
    const botToken = this.crypto.decryptString(bot.botTokenEnc);
    try {
      const auth = await new WebClient(botToken).auth.test();
      checks.push(
        check('botToken', true, 'slackAuthenticated', {
          user: String(auth.user ?? 'unknown'),
          team: String(auth.team ?? 'unknown'),
        }),
      );
    } catch (error) {
      checks.push(
        check('botToken', false, 'slackBotTokenRejected', {
          reason: errorMessage(error),
        }),
      );
    }
    if (!bot.appTokenEnc) {
      checks.push(check('appToken', false, 'slackAppTokenMissing'));
      return checks;
    }
    const appToken = this.crypto.decryptString(bot.appTokenEnc);
    try {
      // apps.connections.open validates the xapp token AND its
      // connections:write scope — exactly what Socket Mode needs.
      await new WebClient(appToken).apps.connections.open();
      checks.push(check('appToken', true, 'slackAppTokenOk'));
    } catch (error) {
      checks.push(
        check('appToken', false, 'slackAppTokenRejected', {
          reason: errorMessage(error),
        }),
      );
    }
    return checks;
  }

  private buildConnector(bot: ChatBot): ChatConnector {
    const botToken = this.crypto.decryptString(bot.botTokenEnc);
    const logActivity = (
      level: 'INFO' | 'ERROR',
      code: ChatEventCode,
      params?: Record<string, string>,
    ) => this.recordActivity(bot.id, level, code, params);
    if (bot.platform === ChatPlatform.SLACK) {
      if (!bot.appTokenEnc) {
        throw new Error(
          'Slack bots need an app-level token (xapp-…) for Socket Mode.',
        );
      }
      const appToken = this.crypto.decryptString(bot.appTokenEnc);
      return new SlackConnector(bot, botToken, appToken, {
        handleMessage: (b, m) => this.handleMessage(b, m),
        saveStatus: (botId, error) => this.saveStatus(botId, error),
        logActivity,
        hasSession: async (botId, chatKey) =>
          (await this.prisma.chatSession.findUnique({
            where: {
              botId_externalChatKey: { botId, externalChatKey: chatKey },
            },
            select: { id: true },
          })) !== null,
      });
    }
    return new TelegramConnector(bot, botToken, {
      handleMessage: (b, m) => this.handleMessage(b, m),
      saveOffset: async (botId, lastUpdateId) => {
        await this.prisma.chatBot.update({
          where: { id: botId },
          data: { telegramLastUpdateId: lastUpdateId },
        });
      },
      saveStatus: (botId, error) => this.saveStatus(botId, error),
      logActivity,
    });
  }

  /**
   * Wrap the agent call so every connector's counters and turn-level activity
   * (processing started / failed) stay in one place.
   */
  private async handleMessage(
    bot: ChatBot,
    message: Parameters<ChatAgentService['handleInboundMessage']>[1],
  ): Promise<string | null> {
    const runtime = this.runtimes.get(bot.id);
    if (runtime) {
      runtime.lastEventAt = new Date();
      runtime.eventsReceived += 1;
      runtime.processing += 1;
    }
    this.recordActivity(bot.id, 'INFO', 'processing');
    try {
      const reply = await this.agent.handleInboundMessage(bot, message, {
        onTurnError: (reason) =>
          this.recordActivity(bot.id, 'ERROR', 'turnFailed', { reason }),
      });
      if (reply && runtime) runtime.repliesSent += 1;
      return reply;
    } finally {
      if (runtime) runtime.processing = Math.max(0, runtime.processing - 1);
    }
  }

  private recordActivity(
    botId: string,
    level: 'INFO' | 'ERROR',
    code: ChatEventCode,
    params: Record<string, string> = {},
  ): void {
    const runtime = this.runtimes.get(botId);
    if (!runtime) return;
    runtime.activity.push({
      at: new Date(),
      level,
      code,
      params,
      message: renderChatEvent(code, params),
    });
    if (runtime.activity.length > ACTIVITY_LIMIT) {
      runtime.activity.splice(0, runtime.activity.length - ACTIVITY_LIMIT);
    }
  }

  private async saveStatus(
    botId: string,
    error: string | null,
    connected?: boolean,
  ): Promise<void> {
    await this.prisma.chatBot
      .update({
        where: { id: botId },
        data: {
          lastError: error,
          ...(connected || error === null
            ? { lastConnectedAt: new Date() }
            : {}),
        },
      })
      .catch(() => undefined); // bot deleted mid-flight — nothing to record
  }

  private async stopAll(): Promise<void> {
    const stopping = [...this.connectors.values()].map((c) =>
      c.stop().catch(() => undefined),
    );
    this.connectors.clear();
    await Promise.all(stopping);
  }
}

function check(
  id: string,
  ok: boolean,
  code: ChatEventCode,
  params: Record<string, string> = {},
): ChatBotTestCheckDto {
  return { id, ok, code, params, detail: renderChatEvent(code, params) };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function telegramApi<T>(token: string, method: string): Promise<T> {
  const response = await fetch(
    `https://api.telegram.org/bot${token}/${method}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(15_000),
    },
  );
  const payload = (await response.json()) as {
    ok: boolean;
    result?: T;
    description?: string;
    error_code?: number;
  };
  if (!payload.ok) {
    throw new Error(
      `Telegram ${method} failed (${payload.error_code ?? response.status}): ${payload.description ?? 'unknown error'}`,
    );
  }
  return payload.result as T;
}
