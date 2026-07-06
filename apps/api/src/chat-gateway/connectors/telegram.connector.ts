import { Logger } from '@nestjs/common';
import type { ChatBot } from '@prisma/client';
import type { ChatConnector } from './connector.types';
import type { ChatEventCode } from '../chat-activity';
import type { InboundChatMessage } from '../chat-agent.service';

/** Long-poll wait — Telegram holds the request until updates arrive. */
const POLL_TIMEOUT_S = 50;
/** Backoff after an errored poll, so a broken token never busy-loops. */
const ERROR_BACKOFF_MS = 15_000;
/** Refresh the "typing…" chat action while a turn is running. */
const TYPING_REFRESH_MS = 5_000;

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    from?: { id: number; is_bot?: boolean };
    chat: { id: number; type: string; title?: string; username?: string };
  };
}

interface TelegramResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

export interface TelegramConnectorDeps {
  /** Runs the agent turn; null reply = ignore (duplicate/empty). */
  handleMessage(
    bot: ChatBot,
    message: InboundChatMessage,
  ): Promise<string | null>;
  /** Persist the getUpdates offset so restarts never replay old messages. */
  saveOffset(botId: string, lastUpdateId: bigint): Promise<void>;
  /** Record connector health on the bot row. */
  saveStatus(botId: string, error: string | null): Promise<void>;
  /** Feed the settings-UI activity log (in-memory, per bot). */
  logActivity(
    level: 'INFO' | 'ERROR',
    code: ChatEventCode,
    params?: Record<string, string>,
  ): void;
}

/**
 * Telegram connector: raw Bot API long-polling — no public URL and no SDK.
 * One instance per enabled Telegram bot. A 409 Conflict means another poller
 * (a second API instance or an external webhook) owns the token; that is
 * recorded as the bot's lastError and polling backs off.
 */
export class TelegramConnector implements ChatConnector {
  private readonly logger: Logger;
  private running = false;
  private loop: Promise<void> | null = null;
  private offset: bigint | null;

  constructor(
    private readonly bot: ChatBot,
    private readonly token: string,
    private readonly deps: TelegramConnectorDeps,
  ) {
    this.logger = new Logger(`TelegramConnector:${bot.name}`);
    this.offset = bot.telegramLastUpdateId;
  }

  async start(): Promise<void> {
    // Fail fast on a bad token so the settings UI shows the error immediately.
    const me = await this.api<{ username?: string }>('getMe', {});
    this.deps.logActivity('INFO', 'telegramAuthenticated', {
      username: me.username ?? 'unknown',
    });
    this.running = true;
    this.loop = this.pollLoop();
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.loop?.catch(() => undefined);
    this.loop = null;
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        const updates = await this.api<TelegramUpdate[]>('getUpdates', {
          timeout: POLL_TIMEOUT_S,
          allowed_updates: ['message'],
          ...(this.offset !== null ? { offset: Number(this.offset) + 1 } : {}),
        });
        for (const update of updates ?? []) {
          this.offset = BigInt(update.update_id);
          await this.handleUpdate(update).catch((e) =>
            this.logger.error(
              `Update ${update.update_id} failed: ${e instanceof Error ? e.message : String(e)}`,
            ),
          );
        }
        if ((updates?.length ?? 0) > 0 && this.offset !== null) {
          await this.deps.saveOffset(this.bot.id, this.offset);
        }
        await this.deps.saveStatus(this.bot.id, null);
      } catch (error) {
        if (!this.running) return;
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Poll failed: ${reason}`);
        this.deps.logActivity('ERROR', 'telegramPollFailed', { reason });
        await this.deps.saveStatus(this.bot.id, reason).catch(() => undefined);
        await sleep(ERROR_BACKOFF_MS);
      }
    }
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    const msg = update.message;
    if (!msg?.text || !msg.from || msg.from.is_bot) return;

    const chatId = msg.chat.id;
    this.deps.logActivity('INFO', 'telegramMessage', {
      user: String(msg.from.id),
      chat: String(chatId),
    });
    const stopTyping = this.keepTyping(chatId);
    let reply: string | null = null;
    try {
      reply = await this.deps.handleMessage(this.bot, {
        chatKey: String(chatId),
        userId: String(msg.from.id),
        text: msg.text,
        externalMessageId: `${chatId}:${msg.message_id}`,
        title: msg.chat.title ?? msg.chat.username ?? undefined,
      });
    } finally {
      stopTyping();
    }
    if (reply) {
      await this.sendMessage(chatId, reply);
      this.deps.logActivity('INFO', 'telegramReplySent', {
        chat: String(chatId),
        chars: String(reply.length),
      });
    }
  }

  private keepTyping(chatId: number): () => void {
    const send = () =>
      this.api('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(
        () => undefined,
      );
    void send();
    const timer = setInterval(() => void send(), TYPING_REFRESH_MS);
    return () => clearInterval(timer);
  }

  private async sendMessage(chatId: number, text: string): Promise<void> {
    try {
      await this.api('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
      });
    } catch {
      // Model Markdown does not always survive Telegram's strict parser.
      await this.api('sendMessage', { chat_id: chatId, text });
    }
  }

  private async api<T>(
    method: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetch(
      `https://api.telegram.org/bot${this.token}/${method}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        // Long polls hold the connection; leave headroom over the poll wait.
        signal: AbortSignal.timeout((POLL_TIMEOUT_S + 15) * 1000),
      },
    );
    const payload = (await response.json()) as TelegramResponse<T>;
    if (!payload.ok) {
      throw new Error(
        `Telegram ${method} failed (${payload.error_code ?? response.status}): ${payload.description ?? 'unknown error'}`,
      );
    }
    return payload.result as T;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
