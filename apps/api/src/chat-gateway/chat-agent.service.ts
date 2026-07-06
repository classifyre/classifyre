import { Injectable, Logger } from '@nestjs/common';
import type { ChatBot } from '@prisma/client';
import {
  AgentKind,
  AgentRunStatus,
  ChatMessageRole,
  Prisma,
} from '@prisma/client';
import { AiClientService, type AiMessage } from '../ai';
import { PrismaService } from '../prisma.service';
import { AgentAuditService } from '../autopilot/audit/agent-audit.service';
import { AgentLoggerService } from '../autopilot/audit/agent-logger.service';
import { ToolDispatcherService } from '../autopilot/tools/tool-dispatcher.service';
import { ToolRegistry } from '../autopilot/tools/tool-registry.service';
import type { AgentContext } from '../autopilot/autopilot.types';
import { BuiltinMcpToolsService } from './builtin-mcp-tools.service';
import { CHAT_BOT_STATE_KEY } from './builtin-mcp-tool-adapter';
import { runChatTurn } from './chat-agent-loop';
import { ChatHarnessToolset } from './chat-harness.toolset';
import {
  allowedBuiltinToolNames,
  CHAT_INVESTIGATION_TOOL_NAMES,
} from './chat-permissions';
import { ChatSessionService } from './chat-session.service';

export interface InboundChatMessage {
  /** Platform conversation identity (Telegram chat id, Slack channel:thread). */
  chatKey: string;
  /** Platform user id of the sender, stored on the transcript message. */
  userId: string;
  text: string;
  /** Platform message id — duplicate deliveries are silently dropped. */
  externalMessageId?: string;
  /** Optional human-readable session title (chat/channel name). */
  title?: string;
}

/** Optional observers for turn-level events (fed into the activity log). */
export interface ChatTurnHooks {
  onTurnError?(reason: string): void;
}

/**
 * The chat gateway's brain: turns one inbound platform message into one agent
 * turn — session persistence, an AgentRun (kind CHAT) for
 * usage/audit, the ReAct chat loop over the bridged built-in MCP tools, and
 * history compaction. Returns the reply text, or null when the message must
 * be ignored (duplicate delivery).
 */
@Injectable()
export class ChatAgentService {
  private readonly logger = new Logger(ChatAgentService.name);
  /** Per-conversation promise chain: turns in one chat never interleave. */
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiClientService,
    private readonly registry: ToolRegistry,
    private readonly dispatcher: ToolDispatcherService,
    private readonly audit: AgentAuditService,
    private readonly log: AgentLoggerService,
    private readonly sessions: ChatSessionService,
    private readonly builtinTools: BuiltinMcpToolsService,
    private readonly harnessTools: ChatHarnessToolset,
  ) {}

  async handleInboundMessage(
    bot: ChatBot,
    message: InboundChatMessage,
    hooks: ChatTurnHooks = {},
  ): Promise<string | null> {
    const text = message.text.trim();
    if (!text) return null;

    const queueKey = `${bot.id}:${message.chatKey}`;
    const turn = (this.queues.get(queueKey) ?? Promise.resolve()).then(() =>
      this.runTurn(bot, { ...message, text }, hooks),
    );
    // Keep the chain alive on failure so the next message still runs.
    this.queues.set(
      queueKey,
      turn.catch(() => undefined),
    );
    try {
      return await turn;
    } finally {
      if (this.queues.get(queueKey) === turn) this.queues.delete(queueKey);
    }
  }

  private async runTurn(
    bot: ChatBot,
    message: InboundChatMessage,
    hooks: ChatTurnHooks,
  ): Promise<string | null> {
    const settings = await this.prisma.instanceSettings.findUnique({
      where: { id: 1 },
    });
    if (!settings?.aiEnabled || !settings.aiProviderConfigId) {
      return 'AI is not configured on this Classifyre instance. Enable AI and select a default provider in Settings first.';
    }

    const session = await this.sessions.getOrCreateSession(
      bot.id,
      message.chatKey,
      message.title,
    );
    if (
      message.externalMessageId &&
      (await this.sessions.isDuplicate(session.id, message.externalMessageId))
    ) {
      return null;
    }

    const context = await this.sessions.loadContext(session.id);
    const history: AiMessage[] = (context?.messages ?? []).map((m) => ({
      role: m.role === ChatMessageRole.USER ? 'user' : 'assistant',
      content: m.content,
    }));

    await this.sessions.appendMessage({
      sessionId: session.id,
      role: ChatMessageRole.USER,
      content: message.text,
      externalMessageId: message.externalMessageId,
      externalUserId: message.userId,
    });

    const run = await this.prisma.agentRun.create({
      data: {
        agentKind: AgentKind.CHAT,
        status: AgentRunStatus.RUNNING,
        trigger: 'chat',
        cycleKey: session.id,
        instruction: message.text.slice(0, 4000),
        attempts: 1,
        startedAt: new Date(),
      },
    });

    const ctx: AgentContext = {
      run,
      settings,
      sourceId: null,
      sourceName: 'chat',
      runnerId: null,
      manual: true,
      instruction: message.text,
      state: {
        [CHAT_BOT_STATE_KEY]: {
          id: bot.id,
          allowMutations: bot.allowMutations,
          agentKinds: bot.agentKinds,
        },
      },
    };

    const allowedTools = [
      ...allowedBuiltinToolNames(
        bot.capabilityGroups,
        this.builtinTools.names(),
      ),
      ...this.harnessTools.names(),
      // Investigation tools (cases/hypotheses/inquiries) — only those the
      // autopilot toolsets actually registered on this instance.
      ...CHAT_INVESTIGATION_TOOL_NAMES.filter((name) =>
        this.registry.get(name),
      ),
    ];

    try {
      const result = await runChatTurn(
        ctx,
        {
          userMessage: message.text,
          history,
          sessionSummary: context?.session.summary ?? '',
          allowedTools,
          platform: bot.platform === 'SLACK' ? 'Slack' : 'Telegram',
        },
        {
          ai: this.ai,
          registry: this.registry,
          dispatcher: this.dispatcher,
          audit: this.audit,
          log: this.log,
        },
      );

      await Promise.all([
        this.prisma.agentRun.update({
          where: { id: run.id },
          data: {
            status: AgentRunStatus.COMPLETED,
            summary: result.reply.slice(0, 4000),
            finishedAt: new Date(),
          },
        }),
        this.sessions.appendMessage({
          sessionId: session.id,
          role: ChatMessageRole.ASSISTANT,
          content: result.reply,
          toolCalls:
            result.toolCalls.length > 0
              ? (result.toolCalls as unknown as Prisma.InputJsonValue)
              : undefined,
          agentRunId: run.id,
        }),
      ]);

      // Compact after the reply; the summarizer's tokens bill to this run.
      const compactUsage = await this.sessions.maybeCompact(session.id);
      if (compactUsage) {
        await this.audit.saveUsage(
          run.id,
          result.inputTokens + compactUsage.inputTokens,
          result.outputTokens + compactUsage.outputTokens,
        );
      }

      return result.reply;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`Bot ${bot.name}: chat turn failed — ${reason}`);
      hooks.onTurnError?.(reason);
      await this.prisma.agentRun
        .update({
          where: { id: run.id },
          data: {
            status: AgentRunStatus.FAILED,
            error: reason.slice(0, 4000),
            finishedAt: new Date(),
          },
        })
        .catch(() => undefined);
      return 'Something went wrong while working on that. Please try again — the error has been logged.';
    }
  }
}
