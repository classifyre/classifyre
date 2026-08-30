import type {
  SupervisorGoal,
  SupervisorJournalEntry,
  SupervisorState,
} from '@prisma/client';
import { SupervisorGoalKind } from '@prisma/client';
import type { BudgetStatus } from './supervisor.service';
import {
  SUPERVISOR_JOURNAL_VERBATIM,
  SUPERVISOR_JOURNAL_WINDOW,
} from './supervisor.constants';

export interface ProjectionInput {
  state: Pick<
    SupervisorState,
    'wakeReason' | 'lastWakeAt' | 'consecutiveNoops'
  >;
  goals: SupervisorGoal[];
  journal: SupervisorJournalEntry[];
  budget: BudgetStatus;
  pendingEvents: number;
}

/**
 * Everything the supervisor knows about itself, as prompt text.
 *
 * This is the whole continuity mechanism. The supervisor starts each wake with
 * a fresh transcript — no conversation is carried across days, because one that
 * was would grow without bound and would invalidate the prompt cache on every
 * turn. What it gets instead is this: its goals, the tail of its own journal,
 * and what it has spent.
 *
 * Which makes the journal load-bearing in a way ordinary logging is not. The
 * agent is reading its own words back with no memory of writing them, so
 * `next` is rendered for every entry in the window while `situation` and `did`
 * are only rendered for the most recent few. What it decided to do next is what
 * the following wake acts on; how it got there stops mattering quickly.
 */
export function renderProjection(input: ProjectionInput): string {
  const lines: string[] = ['## Your situation'];

  // ── Where we are in time ──────────────────────────────────────────────────
  if (input.state.lastWakeAt) {
    const hours = (Date.now() - input.state.lastWakeAt.getTime()) / 3_600_000;
    lines.push(
      `Last wake: ${formatAge(hours)} ago. You scheduled this one because: ` +
        `${input.state.wakeReason || 'no reason recorded'}.`,
    );
  } else {
    lines.push(
      'This is your first wake. There is no journal yet, so start by finding ' +
        'out what this instance is and what state it is in.',
    );
  }

  if (input.state.consecutiveNoops >= 3) {
    lines.push(
      `You have now woken ${input.state.consecutiveNoops} times in a row without ` +
        `changing anything. A quiet system is a fine reason for one or two of ` +
        `those; ${input.state.consecutiveNoops} means either your goals no longer ` +
        `describe useful work or you are waking too often. Say which, in your ` +
        `journal, and act on it.`,
    );
  }

  lines.push(
    input.pendingEvents > 0
      ? `${input.pendingEvents} unread event(s) waiting in your inbox — call inbox.read first.`
      : 'Your inbox is empty: nothing the bridge considers significant has happened since your last wake.',
  );

  // ── Budget ────────────────────────────────────────────────────────────────
  lines.push('', '## Budget');
  if (input.budget.spentTodayUsd === null) {
    lines.push(
      'Cost cannot be measured on this instance — the AI provider has no pricing ' +
        'configured. That is not the same as free. Pace conservatively and prefer ' +
        'longer sleeps until someone configures it.',
    );
  } else if (input.budget.limitUsd === null) {
    lines.push(
      `Spent today: $${input.budget.spentTodayUsd.toFixed(4)} across ` +
        `${input.budget.wakesToday} wake(s). No daily cap is set, which makes your ` +
        `pacing the only thing bounding it.`,
    );
  } else {
    lines.push(
      `Spent today: $${input.budget.spentTodayUsd.toFixed(4)} of $${input.budget.limitUsd.toFixed(2)} ` +
        `across ${input.budget.wakesToday} wake(s). Remaining: ` +
        `$${(input.budget.remainingUsd ?? 0).toFixed(4)}.`,
    );
  }
  if (input.budget.purgeBudgetPerDay > 0) {
    lines.push(
      `Destructive calls today: ${input.budget.purgesToday} of ${input.budget.purgeBudgetPerDay} allowed.`,
    );
  }

  // ── Goals ─────────────────────────────────────────────────────────────────
  lines.push('', '## Goals');
  const charter = input.goals.find(
    (g) => g.kind === SupervisorGoalKind.CHARTER,
  );
  if (charter) {
    lines.push(`### Charter — ${charter.title}`, charter.body ?? '');
  }
  const rest = input.goals.filter((g) => g.kind !== SupervisorGoalKind.CHARTER);
  if (rest.length === 0) {
    lines.push(
      '',
      'No goals beyond the charter. If you find durable work the charter implies ' +
        'but nothing tracks, propose a goal for it.',
    );
  } else {
    lines.push('');
    for (const g of rest) {
      const who = g.origin === 'OPERATOR' ? 'set by an operator' : 'yours';
      lines.push(
        `- [${g.id}] (${g.kind}, ${g.status}, ${who}, priority ${g.priority}) ${g.title}`,
      );
      if (g.body) lines.push(`  ${g.body}`);
      if (g.progress) lines.push(`  Where it stands: ${g.progress}`);
    }
  }

  // ── Journal ───────────────────────────────────────────────────────────────
  lines.push('', '## Your journal');
  if (input.journal.length === 0) {
    lines.push('Empty. This is the first entry you will write.');
    return lines.join('\n');
  }

  lines.push(
    `The last ${Math.min(input.journal.length, SUPERVISOR_JOURNAL_WINDOW)} wake(s), newest first. ` +
      `You wrote these; you will not remember doing so.`,
    '',
  );

  input.journal.slice(0, SUPERVISOR_JOURNAL_WINDOW).forEach((entry, i) => {
    const when = entry.createdAt.toISOString().replace('T', ' ').slice(0, 16);
    if (i < SUPERVISOR_JOURNAL_VERBATIM) {
      lines.push(`### ${when} (${entry.wakeReason})`);
      lines.push(`Found: ${entry.situation}`);
      lines.push(`Did: ${entry.did}`);
      lines.push(`Next: ${entry.next}`);
    } else {
      lines.push(`### ${when} — next was: ${entry.next}`);
    }
    // An operator correction outranks anything in the entry it is attached to,
    // so it is rendered at every depth rather than elided with the body.
    if (entry.operatorNote) {
      lines.push(
        `**An operator corrected this entry: ${entry.operatorNote}** ` +
          `Treat that as authoritative over what you wrote.`,
      );
    }
    lines.push('');
  });

  return lines.join('\n');
}

function formatAge(hours: number): string {
  if (hours < 1) return `${Math.max(Math.round(hours * 60), 1)} minutes`;
  if (hours < 48) return `${Math.round(hours)} hours`;
  return `${Math.round(hours / 24)} days`;
}
