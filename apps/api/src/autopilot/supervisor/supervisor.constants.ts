/**
 * Queue the supervisor's wakes are enqueued on.
 *
 * Its own queue rather than a flag on `autopilot.cycle`: a cycle is a batch of
 * workers reacting to a scan, and a wake is one agent deciding what should
 * happen next. Sharing a queue would put them in the same singleton slot, so a
 * busy scan cadence would swallow wakes exactly when there was most to decide.
 */
export const SUPERVISOR_QUEUE = 'autopilot.supervisor';

/**
 * Singleton key for a wake. pg-boss 12 dedupes on `singletonSeconds`, not on a
 * bare `singletonKey` — see the note in correlation.worker.ts — so this pairs
 * with a window below.
 */
export const SUPERVISOR_SINGLETON_KEY = 'supervisor:wake';

/**
 * Coalescing window for event-driven wakes.
 *
 * Five minutes because the events that trigger one arrive in bursts: a corpus
 * cycle finishing writes an `agent_finished` per worker within seconds of each
 * other, and waking five times to read five lines of the same story is the
 * cost mistake this whole design is trying to avoid.
 */
export const SUPERVISOR_COALESCE_SECONDS = 300;

/**
 * How often to check whether a wake is due.
 *
 * Its own cron rather than a hook into the autopilot heartbeat, which fires
 * every fifteen minutes: this agent can legitimately ask to be woken in five,
 * and a checker coarser than the finest interval the agent may request would
 * quietly round every short sleep up. The tick itself is one indexed read on a
 * single row, so a quiet instance pays almost nothing for it.
 */
export const SUPERVISOR_TICK_CRON = '*/5 * * * *';

/** Floor on a self-declared sleep. Below this it is a loop, not a schedule. */
export const SUPERVISOR_MIN_SLEEP_MINUTES = 5;

/** Fallback sleep when the agent fails to declare one. */
export const SUPERVISOR_DEFAULT_SLEEP_MINUTES = 120;

/**
 * Journal entries fed into a wake.
 *
 * Eight is roughly a day of activity at the default pacing — enough for the
 * agent to notice it has tried something twice, few enough that the projection
 * stays a digest. Only the most recent few are rendered in full; the rest
 * contribute their `next` line, which is the part the following wake acts on.
 */
export const SUPERVISOR_JOURNAL_WINDOW = 8;

/** Of that window, how many are rendered with situation/did as well as next. */
export const SUPERVISOR_JOURNAL_VERBATIM = 3;

/** Inbox lines rendered into one wake before the digest is summarised. */
export const SUPERVISOR_INBOX_LINES = 40;

/**
 * Event types the observation bridge writes.
 *
 * A closed list on purpose. The supervisor is an LLM loop, so it only sees what
 * enters its context; subscribing it to every session event would spend its
 * window on narration within a few worker turns. Everything not named here
 * stays in agent_runs/agent_decisions and is read on demand, which is safe
 * precisely because those rows are durable.
 */
export const SUPERVISOR_EVENT_TYPES = [
  'scan_completed',
  'agent_finished',
  'agent_failed',
  'provider_error',
  'case_escalated',
  'budget_exhausted',
] as const;

export type SupervisorEventType = (typeof SUPERVISOR_EVENT_TYPES)[number];

/** Actor recorded on journal notes and undo reverts made by a person. */
export const OPERATOR_ACTOR = 'operator';

/**
 * The charter every instance starts with, until an operator rewrites it.
 *
 * Deliberately broad, because the request it answers was "do anything that is
 * possible" — but broad is not the same as vague, so it names the levers
 * rather than gesturing at them. An agent told to "improve things" optimises
 * whatever it can measure; an agent told what it may change, and what changing
 * it costs, has something to be right or wrong about.
 *
 * Seeded as OPERATOR-authored so the agent cannot rewrite it: if it disagrees
 * with the charter, that disagreement belongs in the journal where a person
 * will see it.
 */
export const DEFAULT_CHARTER = {
  title: 'Keep this workspace worth investigating',
  body: `Your standing job is to make the evidence in this workspace worth an
investigator's time, and to keep the investigation moving. Nobody will tell you
which of those needs attention this week — working that out is the job.

Roughly, in the order they usually matter:

- **Coverage.** Findings from a fraction of a corpus are a sample, and a sample
  reasoned about as if it were the whole is how this system produces confident
  nonsense. Sources that have never scanned, keep failing, or are still
  sweeping are the first thing to look at.
- **Detection quality.** Detectors that fire constantly on boilerplate cost more
  than they find; hypotheses nobody wrote a detector for stay untested. Both are
  yours to change — carefully, and priced first.
- **Noise.** Duplicates, boilerplate and dead detectors bury the few things that
  matter. Reducing them is real work, but it is destructive work: a person's
  triage decisions do not come back.
- **The investigation itself.** Inquiries that watch nothing, cases that have
  stalled, high-importance findings no inquiry matches. Command the workers that
  own these rather than doing their jobs yourself.
- **Cost.** Every wake is money. An instance nobody is scanning does not need
  hourly attention.

You may change anything you have a tool for: source configuration and sampling,
scan scheduling, detectors built-in and custom, duplicate matching, the inquiry
and case portfolio, and how often the other agents run. What you may not do is
decide something a person has decided — an operator's goal, an operator's
switch, and an operator's triage all outrank your judgement. Where you disagree,
say so in your journal and propose the alternative.`,
} as const;
