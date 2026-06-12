import { Injectable, Logger } from '@nestjs/common';
import { AgentLogChannel, AgentLogLevel, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';

/** Raw model output is stored truncated to keep log rows bounded. */
const MAX_PAYLOAD_TEXT = 30_000;

/**
 * Per-run execution log, split into two channels:
 *  - BUSINESS: the analyst-facing narrative ("created inquiry X because …")
 *  - TECHNICAL: mechanics — step timings, prompt sizes, raw model output,
 *    retries, schema failures. Never fed back into the agent's own context.
 * Logging must never break a cycle, so every write is fire-safe.
 */
@Injectable()
export class AgentLoggerService {
  private readonly logger = new Logger(AgentLoggerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async business(
    runId: string,
    message: string,
    payload?: Record<string, unknown>,
    level: AgentLogLevel = AgentLogLevel.INFO,
  ): Promise<void> {
    await this.write(runId, AgentLogChannel.BUSINESS, level, message, payload);
  }

  async technical(
    runId: string,
    message: string,
    payload?: Record<string, unknown>,
    level: AgentLogLevel = AgentLogLevel.DEBUG,
  ): Promise<void> {
    await this.write(runId, AgentLogChannel.TECHNICAL, level, message, payload);
  }

  async error(
    runId: string,
    channel: AgentLogChannel,
    message: string,
    payload?: Record<string, unknown>,
  ): Promise<void> {
    await this.write(runId, channel, AgentLogLevel.ERROR, message, payload);
  }

  private async write(
    runId: string,
    channel: AgentLogChannel,
    level: AgentLogLevel,
    message: string,
    payload?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.agentLog.create({
        data: {
          runId,
          channel,
          level,
          message: message.slice(0, 4000),
          payload: payload
            ? (truncatePayload(payload) as Prisma.InputJsonValue)
            : undefined,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to write agent log for run ${runId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

/** Bound any string leaves (raw model output can be arbitrarily large). */
function truncatePayload(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.length > MAX_PAYLOAD_TEXT
      ? `${value.slice(0, MAX_PAYLOAD_TEXT)}… [truncated ${value.length - MAX_PAYLOAD_TEXT} chars]`
      : value;
  }
  if (Array.isArray(value)) return value.map(truncatePayload);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        truncatePayload(v),
      ]),
    );
  }
  return value;
}
