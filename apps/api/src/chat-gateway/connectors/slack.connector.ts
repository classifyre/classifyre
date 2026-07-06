import { Logger } from '@nestjs/common';
import { SocketModeClient } from '@slack/socket-mode';
import { WebClient } from '@slack/web-api';
import type { ChatBot } from '@prisma/client';
import type { ChatConnector } from './connector.types';
import type { ChatEventCode } from '../chat-activity';
import type { InboundChatMessage } from '../chat-agent.service';

interface SlackMessageEvent {
  type: string;
  subtype?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  channel: string;
  ts: string;
  thread_ts?: string;
  event_ts?: string;
}

export interface SlackConnectorDeps {
  handleMessage(
    bot: ChatBot,
    message: InboundChatMessage,
  ): Promise<string | null>;
  saveStatus(botId: string, error: string | null): Promise<void>;
  /** Feed the settings-UI activity log (in-memory, per bot). */
  logActivity(
    level: 'INFO' | 'ERROR',
    code: ChatEventCode,
    params?: Record<string, string>,
  ): void;
  /** Whether a session already exists for this thread (restart-safe follow). */
  hasSession(botId: string, chatKey: string): Promise<boolean>;
}

/**
 * Slack connector: Socket Mode (app-level token) + Web API (bot token) — no
 * public URL. The bot answers @-mentions in channels and keeps following the
 * resulting thread; each thread is one chat session. Slack requires the
 * envelope to be acked fast, so the agent turn runs after the ack and the
 * reply is posted asynchronously into the thread.
 */
export class SlackConnector implements ChatConnector {
  private readonly logger: Logger;
  private readonly socket: SocketModeClient;
  private readonly web: WebClient;
  private botUserId: string | null = null;
  /** Threads the bot participates in — plain thread replies are handled too. */
  private readonly activeThreads = new Set<string>();

  constructor(
    private readonly bot: ChatBot,
    botToken: string,
    appToken: string,
    private readonly deps: SlackConnectorDeps,
  ) {
    this.logger = new Logger(`SlackConnector:${bot.name}`);
    this.web = new WebClient(botToken);
    this.socket = new SocketModeClient({ appToken });

    this.socket.on('app_mention', ({ event, ack }) => {
      void ack();
      void this.onEvent(event as SlackMessageEvent, true);
    });
    this.socket.on('message', ({ event, ack }) => {
      void ack();
      void this.onEvent(event as SlackMessageEvent, false);
    });
    this.socket.on('connected', () => {
      this.deps.logActivity('INFO', 'socketConnected');
    });
    this.socket.on('disconnected', (error?: Error) => {
      if (error) {
        this.deps.logActivity('ERROR', 'socketDisconnected', {
          reason: error.message,
        });
        void this.deps
          .saveStatus(this.bot.id, error.message)
          .catch(() => undefined);
      }
    });
  }

  async start(): Promise<void> {
    const auth = await this.web.auth.test();
    this.botUserId = (auth.user_id as string) ?? null;
    this.deps.logActivity('INFO', 'slackAuthenticated', {
      user: String(auth.user ?? 'unknown'),
      team: String(auth.team ?? 'unknown'),
    });
    await this.socket.start();
  }

  async stop(): Promise<void> {
    await this.socket.disconnect().catch(() => undefined);
  }

  private async onEvent(
    event: SlackMessageEvent,
    isMention: boolean,
  ): Promise<void> {
    try {
      if (!event.user || event.bot_id || event.user === this.botUserId) return;
      if (event.subtype) return; // edits, joins, bot posts…
      const text = stripMention(event.text ?? '', this.botUserId);
      if (!text) return;

      const threadTs = event.thread_ts ?? event.ts;
      const chatKey = `${event.channel}:${threadTs}`;

      // Non-mention messages only count when they continue a thread the bot
      // is already part of (otherwise it would answer every channel message).
      // The in-memory set is a cache; the session table survives restarts.
      if (!isMention && !this.activeThreads.has(chatKey)) {
        if (!(await this.deps.hasSession(this.bot.id, chatKey))) return;
      }
      this.activeThreads.add(chatKey);

      this.deps.logActivity(
        'INFO',
        isMention ? 'slackMention' : 'slackThreadMessage',
        { user: event.user, channel: event.channel },
      );
      // Instant in-channel feedback: mark the message as seen. Best-effort —
      // needs the reactions:write scope; without it the turn still runs.
      void this.web.reactions
        .add({ channel: event.channel, timestamp: event.ts, name: 'eyes' })
        .catch(() => undefined);
      const reply = await this.deps.handleMessage(this.bot, {
        chatKey,
        userId: event.user,
        text,
        externalMessageId: `${event.channel}:${event.ts}`,
      });
      if (reply) {
        await this.web.chat.postMessage({
          channel: event.channel,
          thread_ts: threadTs,
          text: reply,
        });
        this.deps.logActivity('INFO', 'slackReplyPosted', {
          thread: chatKey,
          chars: String(reply.length),
        });
      }
      await this.deps.saveStatus(this.bot.id, null);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`Event handling failed: ${reason}`);
      this.deps.logActivity('ERROR', 'eventFailed', { reason });
      await this.deps.saveStatus(this.bot.id, reason).catch(() => undefined);
    }
  }
}

/** Remove the bot's own <@Uxxx> mention token(s) from the message text. */
function stripMention(text: string, botUserId: string | null): string {
  const cleaned = botUserId ? text.replaceAll(`<@${botUserId}>`, ' ') : text;
  return cleaned.replace(/\s+/g, ' ').trim();
}
