import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { AgentDecisionAction, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';

/**
 * How an entry is taken back.
 *
 * `restore_value` replays a snapshot of what the setting was before, and is
 * only offered where the prior value is small, complete and still meaningful.
 *
 * `rescan` does not restore anything — it re-derives. Findings and assets are
 * computed from a source, so scanning it again rebuilds them; what a re-scan
 * cannot bring back is anything a person added on top, which is exactly why
 * the purge tools refuse to touch findings a case cites in the first place.
 */
export type RevertKind = 'restore_value' | 'rescan';

export interface UndoEntryView {
  id: string;
  action: AgentDecisionAction;
  label: string;
  entityType: string | null;
  entityId: string | null;
  revertKind: RevertKind;
  createdAt: Date;
  expiresAt: Date;
  revertedAt: Date | null;
  revertedBy: string | null;
  /** Whether reverting it now would still do what it says. */
  undoable: boolean;
  /** Why not, when it is not. */
  blockedReason: string | null;
}

/**
 * The undo log for agent actions.
 *
 * Modelled on the correlation review's decision batches, which is the undo log
 * in this codebase that already works — including the part people usually skip:
 * it is honest that undo is not time travel. Whether an entry still applies is
 * computed when the log is read, never stored, because a flag written at
 * capture time starts lying the moment anything else changes.
 */
@Injectable()
export class UndoService {
  private readonly logger = new Logger(UndoService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: {
    runId: string;
    decisionId?: string | null;
    action: AgentDecisionAction;
    label: string;
    entityType?: string | null;
    entityId?: string | null;
    revertKind: RevertKind;
    revertPayload: Prisma.InputJsonValue;
    retentionDays: number;
  }): Promise<void> {
    try {
      await this.prisma.agentUndoEntry.create({
        data: {
          runId: entry.runId,
          decisionId: entry.decisionId ?? null,
          action: entry.action,
          label: entry.label,
          entityType: entry.entityType ?? null,
          entityId: entry.entityId ?? null,
          revertKind: entry.revertKind,
          revertPayload: entry.revertPayload,
          expiresAt: new Date(
            Date.now() + Math.max(entry.retentionDays, 1) * 86_400_000,
          ),
        },
      });
    } catch (error) {
      // Never fail the action because its undo record could not be written —
      // that would turn a recoverable mistake into a failed tool call, and the
      // decision row already carries what happened.
      this.logger.warn(
        `Failed to record undo entry for ${entry.action}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async list(limit = 50): Promise<UndoEntryView[]> {
    const rows = await this.prisma.agentUndoEntry.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
    });
    const now = new Date();
    return rows.map((row) => {
      let blockedReason: string | null = null;
      if (row.revertedAt) {
        blockedReason = 'Already reverted.';
      } else if (row.expiresAt < now) {
        blockedReason = 'This entry has expired.';
      }
      return {
        id: row.id,
        action: row.action,
        label: row.label,
        entityType: row.entityType,
        entityId: row.entityId,
        revertKind: row.revertKind as RevertKind,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        revertedAt: row.revertedAt,
        revertedBy: row.revertedBy,
        undoable: blockedReason === null,
        blockedReason,
      };
    });
  }

  /**
   * Mark an entry reverted and hand back what the caller must do.
   *
   * The service does not perform the revert itself: `restore_value` payloads
   * belong to whichever service owns that setting, and `rescan` is a scan the
   * runner owns. Keeping the bookkeeping here and the effect there is what
   * stops this from becoming a second, half-informed copy of every write path
   * in the system.
   */
  async claim(
    id: string,
    revertedBy: string,
  ): Promise<{
    revertKind: RevertKind;
    payload: Prisma.JsonValue;
    action: AgentDecisionAction;
    label: string;
  }> {
    const row = await this.prisma.agentUndoEntry.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Undo entry ${id} not found`);
    if (row.revertedAt) {
      throw new Error(
        `Already reverted on ${row.revertedAt.toISOString()} by ${row.revertedBy ?? 'unknown'}.`,
      );
    }
    if (row.expiresAt < new Date()) {
      throw new Error(
        'This entry has expired. Undo is not time travel — too much has ' +
          'happened since for replaying it to mean what it did.',
      );
    }
    await this.prisma.agentUndoEntry.update({
      where: { id },
      data: { revertedAt: new Date(), revertedBy },
    });
    return {
      revertKind: row.revertKind as RevertKind,
      payload: row.revertPayload,
      action: row.action,
      label: row.label,
    };
  }
}
