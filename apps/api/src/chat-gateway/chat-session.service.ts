import { Injectable, Logger } from '@nestjs/common';
import type { ChatMessage, ChatSession, Prisma } from '@prisma/client';
import { ChatMessageRole } from '@prisma/client';
import { AiClientService, type AiUsage } from '../ai';
import { PrismaService } from '../prisma.service';

/** Messages kept verbatim in the model context (sliding window). */
export const CHAT_HISTORY_WINDOW = 30;
/** Un-summarized message count that triggers compaction of older history. */
const COMPACT_THRESHOLD = 60;
/** Upper bound on the text handed to the summarizer in one pass. */
const COMPACT_INPUT_CHAR_LIMIT = 60_000;

export interface ChatContext {
  session: ChatSession;
  /** Last CHAT_HISTORY_WINDOW messages, oldest first. */
  messages: ChatMessage[];
}

/**
 * Chat session persistence: one session per Telegram chat / Slack thread,
 * with a sliding message window plus an LLM-compacted summary of everything
 * older — so long-running conversations never outgrow the model context.
 */
@Injectable()
export class ChatSessionService {
  private readonly logger = new Logger(ChatSessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiClientService,
  ) {}

  async getOrCreateSession(
    botId: string,
    externalChatKey: string,
    title?: string,
  ): Promise<ChatSession> {
    return this.prisma.chatSession.upsert({
      where: { botId_externalChatKey: { botId, externalChatKey } },
      create: { botId, externalChatKey, title: title ?? null },
      update: {},
    });
  }

  async loadContext(sessionId: string): Promise<ChatContext | null> {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) return null;
    const recent = await this.prisma.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      take: CHAT_HISTORY_WINDOW,
    });
    return { session, messages: recent.reverse() };
  }

  async appendMessage(data: {
    sessionId: string;
    role: ChatMessageRole;
    content: string;
    toolCalls?: Prisma.InputJsonValue;
    agentRunId?: string;
    externalMessageId?: string;
    externalUserId?: string;
  }): Promise<ChatMessage> {
    const [message] = await Promise.all([
      this.prisma.chatMessage.create({
        data: {
          sessionId: data.sessionId,
          role: data.role,
          content: data.content,
          toolCalls: data.toolCalls,
          agentRunId: data.agentRunId ?? null,
          externalMessageId: data.externalMessageId ?? null,
          externalUserId: data.externalUserId ?? null,
        },
      }),
      this.prisma.chatSession.update({
        where: { id: data.sessionId },
        data: { lastMessageAt: new Date() },
      }),
    ]);
    return message;
  }

  /** True when this platform message was already ingested (redelivery). */
  async isDuplicate(
    sessionId: string,
    externalMessageId: string,
  ): Promise<boolean> {
    const existing = await this.prisma.chatMessage.findFirst({
      where: { sessionId, externalMessageId, role: ChatMessageRole.USER },
      select: { id: true },
    });
    return existing !== null;
  }

  /**
   * When the un-summarized backlog outgrows the threshold, fold everything
   * older than the sliding window into `session.summary` with one LLM call.
   * Returns the summarizer's token usage (billed to the current chat turn) or
   * null when no compaction ran. Best-effort: a failing summarizer never
   * breaks the turn — compaction retries on a later message.
   */
  async maybeCompact(sessionId: string): Promise<AiUsage | null> {
    const session = await this.prisma.chatSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) return null;

    const unsummarizedFilter = {
      sessionId,
      ...(session.summarizedUpToAt
        ? { createdAt: { gt: session.summarizedUpToAt } }
        : {}),
    };
    const backlog = await this.prisma.chatMessage.count({
      where: unsummarizedFilter,
    });
    if (backlog <= COMPACT_THRESHOLD) return null;

    // Everything except the most recent window gets folded into the summary.
    const toSummarize = await this.prisma.chatMessage.findMany({
      where: unsummarizedFilter,
      orderBy: { createdAt: 'asc' },
      take: backlog - CHAT_HISTORY_WINDOW,
    });
    if (toSummarize.length === 0) return null;

    let transcript = toSummarize
      .map(
        (m) =>
          `${m.role === ChatMessageRole.USER ? 'User' : 'Assistant'}: ${m.content}`,
      )
      .join('\n');
    if (transcript.length > COMPACT_INPUT_CHAR_LIMIT) {
      transcript = transcript.slice(-COMPACT_INPUT_CHAR_LIMIT);
    }

    try {
      const { content, usage } = await this.ai.completeText([
        {
          role: 'system',
          content:
            'You maintain the long-term memory of an operations chat between a user and the Classifyre assistant. ' +
            'Merge the existing summary with the new transcript into ONE updated summary (max ~300 words). ' +
            'Keep durable facts: entities mentioned (sources, detectors, cases, inquiries and their ids), ' +
            'decisions taken, user preferences and unresolved follow-ups. Drop chit-chat.',
        },
        {
          role: 'user',
          content: `Existing summary:\n${session.summary || '(none)'}\n\nNew transcript:\n${transcript}`,
        },
      ]);
      const lastSummarized = toSummarize[toSummarize.length - 1];
      await this.prisma.chatSession.update({
        where: { id: sessionId },
        data: {
          summary: content.trim(),
          summarizedUpToAt: lastSummarized ? lastSummarized.createdAt : null,
        },
      });
      return usage;
    } catch (error) {
      this.logger.warn(
        `Session ${sessionId}: history compaction failed — ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}
