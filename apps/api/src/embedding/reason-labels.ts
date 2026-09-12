/**
 * Evidence-ranking reasons: stored as codes, read as sentences.
 *
 * A reason has always been `{ code, label, impact }`, and the label is the
 * only part a person reads. It is also the only part that is pure decoration
 * of the code: "unique_evidence" is always "Unique evidence in this corpus",
 * and the handful that vary vary by a number the row already has to carry.
 *
 * Writing the finished sentence out per row cost 250 MB across 577,321
 * analyses on one workspace — for 845 distinct values. Storing
 * `{ c: 'unique_evidence' }` instead is about a fifth of that, and the
 * rendering moves here where the wording can be changed without a backfill.
 *
 * `impact` is dropped from storage for the same reason: every code has exactly
 * one, so it belongs in the table below rather than on every row.
 *
 * Rows written before this change carry the full shape, and are passed through
 * untouched — there is no migration, and no moment where the reason list is
 * empty.
 */

import type { Prisma } from '@prisma/client';

export type ReasonImpact = 'up' | 'down' | 'neutral';

/** What the API returns, and what the UI and the agents read. */
export interface RenderedReason {
  code: string;
  label: string;
  impact: ReasonImpact;
}

/**
 * What goes into the database.
 *
 * Short keys on purpose: this object is repeated a few hundred thousand times
 * and JSONB stores every key name in every row, so `c` against `code` is not
 * micro-optimisation here, it is most of the saving.
 */
export interface StoredReason {
  /** Reason code. */
  c: string;
  /** Primary count, for the codes whose sentence includes one. */
  n?: number;
  /** Secondary count (sources, where a reason names both). */
  n2?: number;
  /** Free text the sentence embeds — currently only the severity name. */
  s?: string;
}

/**
 * Above this many co-members, `duplicate_group` reads as a register-wide value
 * rather than a duplicate.
 *
 * Deliberately a local constant and not `BOILERPLATE_GROUP_BREADTH_CAP`, which
 * this mirrors: that cap counts DISTINCT ASSETS per group, while `n` here is
 * `similarCount` — findings sharing the content hash, which is the cohort size
 * MINUS ONE. On the corpus this was measured against the two coincide (every
 * one of the 24 register-wide groups had exactly one finding per asset), but
 * they are not the same unit and a shared constant would imply they are.
 *
 * The comparisons look inconsistent and are not. `n >= 2000` here and
 * `COUNT(DISTINCT asset_id) > 2000` there pick out the same groups precisely
 * because `n` is off by one: a cohort of 2,001 has `n = 2000` and 2,001 assets,
 * so both fire; a cohort of 2,000 has `n = 1999` and 2,000 assets, so neither
 * does. Changing this to `>` to match the other would introduce the skew it
 * looks like it is removing.
 *
 * Rendering only; nothing scores on it.
 */
const BREADTH_LABEL_THRESHOLD = 2000;

/**
 * The boundary cast for writing reasons to a JSONB column.
 *
 * Prisma's `InputJsonValue` only accepts objects carrying an index signature,
 * which {@link StoredReason} deliberately does not have — an index signature
 * would make `{ cc: 'typo' }` compile. One cast here beats one at every write.
 */
export function reasonsForStorage(
  reasons: StoredReason[],
): Prisma.InputJsonValue {
  return reasons as unknown as Prisma.InputJsonValue;
}

/** Reasons read back off a row, ready to render. */
type Template = {
  impact: ReasonImpact;
  label: (r: StoredReason) => string;
};

/**
 * `impact` is evidential strength, not text hygiene.
 *
 * `readable_context` and `context` used to be `up`, and that killed the
 * autopilot evidence floor. `readable_context` fires whenever `qualityScore`
 * clears `QUALITY_GATE` (0.45), and the *minimum* quality on the Firmenbuch
 * corpus is 0.690 — so it fired on 603,633 of 603,633 analyses.
 * `hasPositiveImpact` was therefore always true, `strong === analyzed` always
 * held, and `provablyWeak` was unreachable: both refusals it gates
 * (`inquiries.create` over a boilerplate cluster, `cases.create` over noise)
 * could never fire. Its unit test passed only because the `weak()` fixture
 * omitted the one reason the analyzer always writes.
 *
 * "The text is readable" says nothing about whether a finding is evidence. The
 * `up` set is now the three codes that make an evidential claim:
 * `unique_evidence`, `cross_document_recurrence`, `semantic_outlier`.
 *
 * The general rule, which is the one to check when adding a code: a signal that
 * fires on ~100% of the corpus carries no information, and if it carries a
 * direction it breaks whatever reads that direction.
 */
const TEMPLATES: Record<string, Template> = {
  ocr_fragment: { impact: 'down', label: () => 'Possible OCR fragment' },
  readable_context: {
    impact: 'neutral',
    label: () => 'Readable supporting context',
  },
  duplicate_group: {
    impact: 'down',
    // Breadth changes what this means. A four-member group is a duplicate; a
    // group spanning most of the register is a taxonomy value, and saying
    // "56,404 identical findings grouped" about it is accurate and useless.
    label: (r) =>
      (r.n ?? 0) >= BREADTH_LABEL_THRESHOLD
        ? `Register-wide value: ${(r.n ?? 0) + 1} findings carry it`
        : `${r.n ?? 0} identical findings grouped`,
  },
  unique_evidence: {
    impact: 'up',
    label: () => 'Unique evidence in this corpus',
  },
  context: {
    impact: 'neutral',
    label: () => 'Substantial surrounding context',
  },
  cross_document_recurrence: {
    impact: 'up',
    label: (r) =>
      `Same value found in ${r.n ?? 0} assets` +
      ((r.n2 ?? 0) > 1 ? ` across ${r.n2} sources` : ''),
  },
  common_value: {
    impact: 'down',
    label: (r) =>
      `Common value shared by ${r.n ?? 0} assets; not discriminating`,
  },
  known_test_value: {
    impact: 'down',
    label: () => 'Matches a documented payment-network test number',
  },
  repeated_digit_pattern: {
    impact: 'down',
    label: () => 'Digit string dominated by repeated digits; likely artifact',
  },
  severity_separate: {
    impact: 'neutral',
    label: (r) => `${r.s ?? 'unknown'} detector severity (not importance)`,
  },
  near_duplicate: {
    impact: 'down',
    label: (r) => `${r.n ?? 0} near-duplicate findings grouped semantically`,
  },
  insufficient_neighborhood: {
    impact: 'neutral',
    label: () => 'Too few comparable findings for semantic analysis',
  },
  isolated_ocr: {
    impact: 'down',
    label: () => 'Isolated low-quality text; possible OCR noise',
  },
  semantic_outlier: {
    impact: 'up',
    label: () => 'Semantically unusual for its neighbours',
  },
  semantic_support: {
    impact: 'neutral',
    label: () => 'Consistent with its semantic neighbours',
  },
};

/** The impact a code carries, for callers that only need the direction. */
export function impactOf(code: string): ReasonImpact {
  return TEMPLATES[code]?.impact ?? 'neutral';
}

function renderOne(entry: unknown): RenderedReason | null {
  if (!entry || typeof entry !== 'object') return null;
  const row = entry as Partial<StoredReason> &
    Partial<RenderedReason> & { code?: string };

  // Written before this change: already a finished sentence, kept as-is so an
  // existing corpus reads identically without a backfill.
  //
  // The stored `impact` is deliberately IGNORED. It is a property of the code,
  // as the header says, so the table is the only place it should come from —
  // and honouring the row instead meant a reclassification took effect only on
  // rows recalibration had already rewritten. 206,700 legacy rows still carried
  // `readable_context: 'up'` when that impact was the reason the evidence floor
  // could not fire, so a third of the corpus would have stayed broken for as
  // long as it took the refresh to rotate through.
  if (typeof row.label === 'string' && typeof row.code === 'string') {
    return { code: row.code, label: row.label, impact: impactOf(row.code) };
  }

  const code = typeof row.c === 'string' ? row.c : row.code;
  if (typeof code !== 'string') return null;
  const template = TEMPLATES[code];
  if (!template) {
    // An unknown code is still worth showing — a reason the reader cannot see
    // is worse than one phrased plainly — so it degrades to its own name.
    return { code, label: code.replace(/_/g, ' '), impact: 'neutral' };
  }
  return {
    code,
    label: template.label(row as StoredReason),
    impact: template.impact,
  };
}

/**
 * Turn whatever is stored on a row into the shape the API returns.
 *
 * Tolerant by design: this runs on every finding read, and a malformed entry
 * must cost that entry, never the response.
 */
export function renderReasons(stored: unknown): RenderedReason[] {
  if (!Array.isArray(stored)) return [];
  const out: RenderedReason[] = [];
  for (const entry of stored) {
    const rendered = renderOne(entry);
    if (rendered) out.push(rendered);
  }
  return out;
}
